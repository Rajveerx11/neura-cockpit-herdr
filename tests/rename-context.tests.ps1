# Self-contained Windows PowerShell 5.1 tests; no live Herdr writes or Pester.
$ErrorActionPreference = 'Stop'
$target = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools/rename-context.ps1'
$tokens = $null
$parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($target, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
. $target

$script:passed = 0
function Assert($Condition, [string]$Message = 'Assertion failed') {
    if (-not $Condition) { throw $Message }
}
function Case([string]$Name, [scriptblock]$Body) {
    Reset-Mock
    try { & $Body; $script:passed++; Write-Output "PASS $Name" }
    catch { throw "FAIL ${Name}: $($_.Exception.Message)" }
}
function Expect-Error([scriptblock]$Body, [string]$Pattern) {
    $errorText = $null
    try { $null = & $Body } catch { $errorText = $_.Exception.Message }
    Assert ($null -ne $errorText) 'Expected an error'
    Assert ($errorText -match $Pattern) "Unexpected error: $errorText"
}
function Reset-Mock {
    $env:HERDR_BIN_PATH = 'Mock-Herdr'
    $env:HERDR_ACTIVE_PANE_ID = 'w-popup:p7'
    $env:HERDR_ACTIVE_WORKSPACE_ID = 'w-popup'
    $env:HERDR_PANE_ID = 'w-focused:p9'
    $env:HERDR_WORKSPACE_ID = 'w-focused'
    $script:agentName = 'original-agent'
    $script:workspaceLabel = 'Original workspace'
    $script:otherNames = @()
    $script:calls = [System.Collections.Generic.List[object]]::new()
    $script:failures = [System.Collections.Generic.List[object]]::new()
    $script:keys = [System.Collections.Generic.Queue[object]]::new()
    $script:frames = [System.Collections.Generic.List[object]]::new()
}
function Fail-Command([string]$Command, [string]$Code = 'test_failure', [string]$Text = '', [bool]$Apply = $false) {
    $script:failures.Add([pscustomobject]@{ Command = $Command; Code = $Code; Text = $Text; Apply = $Apply })
}
function Apply-MockRename($Arguments) {
    if ($Arguments[0] -eq 'agent') {
        $script:agentName = if ($Arguments[3] -eq '--clear') { $null } else { $Arguments[3] }
    } else { $script:workspaceLabel = $Arguments[3] }
}
function Mock-Herdr {
    $arguments = @($args)
    $script:calls.Add($arguments)
    $command = $arguments -join '|'
    $global:LASTEXITCODE = 0
    for ($i = 0; $i -lt $script:failures.Count; $i++) {
        $failure = $script:failures[$i]
        if ($failure.Command -eq $command) {
            $script:failures.RemoveAt($i)
            if ($failure.Apply) { Apply-MockRename $arguments }
            $global:LASTEXITCODE = 1
            if ($failure.Text) { return $failure.Text }
            return (@{ error = @{ code = $failure.Code; message = 'simulated CLI failure' } } | ConvertTo-Json -Compress)
        }
    }
    switch ($arguments[0] + ' ' + $arguments[1]) {
        'agent get' {
            Assert ($arguments[2] -eq 'w-popup:p7') 'Wrong agent target'
            $result = @{ agent = @{ pane_id = 'w-popup:p7'; workspace_id = 'w-popup'; agent = 'fx'; name = $script:agentName } }
        }
        'agent list' {
            $agents = @(@{ pane_id = 'w-popup:p7'; name = $script:agentName })
            foreach ($name in $script:otherNames) { $agents += @{ pane_id = 'w-other:p1'; name = $name } }
            $result = @{ agents = $agents }
        }
        'workspace get' {
            Assert ($arguments[2] -eq 'w-popup') 'Wrong workspace target'
            $result = @{ workspace = @{ workspace_id = 'w-popup'; label = $script:workspaceLabel } }
        }
        'agent rename' {
            Assert ($arguments[2] -eq 'w-popup:p7') 'Wrong agent mutation target'
            Assert ($arguments[3] -eq '--clear' -or $arguments[3] -cmatch '^[a-z][a-z0-9_-]{0,31}$') 'Invalid agent name'
            Apply-MockRename $arguments
            $result = @{ renamed = $true }
        }
        'workspace rename' {
            Assert ($arguments[2] -eq 'w-popup') 'Wrong workspace mutation target'
            Apply-MockRename $arguments
            $result = @{ renamed = $true }
        }
        default { throw "Unexpected mock command: $command" }
    }
    return (@{ result = $result } | ConvertTo-Json -Depth 6 -Compress)
}
function Read-RenameKey {
    Assert ($script:keys.Count -gt 0) 'UI requested an unexpected key'
    return $script:keys.Dequeue()
}
function Show-RenameDialog($State, [string]$Phase, [string]$Label, [string]$Message) {
    $script:frames.Add([pscustomobject]@{ Agent = $State.Agent; Workspace = $State.Workspace; Focus = $State.Focus; Phase = $Phase; Label = $Label; Message = $Message })
}
function Key([string]$Name, [bool]$Shift = $false) {
    $script:keys.Enqueue([ConsoleKeyInfo]::new([char]0, [ConsoleKey]::$Name, $Shift, $false, $false))
}
function Text([string]$Value) {
    foreach ($character in $Value.ToCharArray()) {
        $script:keys.Enqueue([ConsoleKeyInfo]::new($character, [ConsoleKey]::A, $false, $false, $false))
    }
}
function Renames { return ,@($script:calls | Where-Object { $_[1] -eq 'rename' }) }

$envNames = @('HERDR_BIN_PATH', 'HERDR_ACTIVE_PANE_ID', 'HERDR_ACTIVE_WORKSPACE_ID', 'HERDR_PANE_ID', 'HERDR_WORKSPACE_ID')
$savedEnv = @{}
foreach ($name in $envNames) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name) }
try {
    Case 'syntax and legacy -TestLabel in a separate PowerShell process' {
        $output = & (Join-Path $PSHOME 'powershell.exe') -NoProfile -ExecutionPolicy Bypass -File $target -TestLabel '42 Agent / Tests'
        Assert ($LASTEXITCODE -eq 0) 'Legacy probe exit code'
        Assert (($output | Out-String).Trim() -eq 'agent-42-agent-tests') 'Legacy probe output'
    }
    Case 'normalization retains old behavior and valid length' {
        $samples = @(
            @('Fix Login / API', 'fix-login-api'), @('42 tasks', 'agent-42-tasks'),
            @('__Hello__', 'hello'), @('---', ''), @('', ''), @('A_B-C', 'a_b-c'),
            @(([string][char]0x4E2D), '')
        )
        foreach ($sample in $samples) { Assert ((ConvertTo-AgentName $sample[0]) -ceq $sample[1]) "Normalization: $($sample[0])" }
        $long = ConvertTo-AgentName ('9' * 80)
        Assert ($long.Length -eq 32 -and $long -cmatch '^[a-z][a-z0-9_-]{0,31}$') 'Long normalization'
    }
    Case 'Agent only: popup ID, no workspace reads/writes' {
        $env:HERDR_ACTIVE_WORKSPACE_ID = ''
        $result = Rename-HerdrContext -Agent $true -Workspace $false -Label ' Fix API '
        Assert ($result.AgentName -eq 'fix-api' -and -not $result.Workspace)
        Assert ($script:workspaceLabel -eq 'Original workspace')
        Assert (@($script:calls | Where-Object { $_[0] -eq 'workspace' }).Count -eq 0)
    }
    Case 'Workspace only: exact trimmed label, no agent reads/writes' {
        $env:HERDR_ACTIVE_PANE_ID = ''
        $label = '  Roadmap / Q4 & "review"  '
        $result = Rename-HerdrContext -Agent $false -Workspace $true -Label $label
        Assert ($result.WorkspaceLabel -ceq $label.Trim())
        Assert ($script:agentName -eq 'original-agent')
        Assert (@($script:calls | Where-Object { $_[0] -eq 'agent' }).Count -eq 0)
        Assert ($script:calls[1][3] -ceq $label.Trim()) 'Label must be a single data argument'
    }
    Case 'Both: normalized agent and human workspace label after preflight' {
        $result = Rename-HerdrContext -Agent $true -Workspace $true -Label ' New API / Tests '
        Assert ($result.AgentName -eq 'new-api-tests' -and $result.WorkspaceLabel -eq 'New API / Tests')
        Assert ($script:agentName -eq 'new-api-tests' -and $script:workspaceLabel -eq 'New API / Tests')
        Assert (($script:calls[2] -join '|') -eq 'workspace|get|w-popup') 'Preflight must precede writes'
        Assert ((Renames).Count -eq 2)
    }
    Case 'None: no CLI calls' {
        Expect-Error { Rename-HerdrContext -Agent $false -Workspace $false -Label 'unused' } 'Select'
        Assert ($script:calls.Count -eq 0)
    }
    Case 'Blank label: no calls' {
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label '   ' } 'nonblank'
        Assert ($script:calls.Count -eq 0)
    }
    Case 'Invalid agent label: no calls, even Both' {
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label '!!!' } 'ASCII'
        Assert ($script:calls.Count -eq 0)
    }
    Case 'Workspace permits label that is not an agent name' {
        $null = Rename-HerdrContext -Agent $false -Workspace $true -Label '!!!'
        Assert ($script:workspaceLabel -eq '!!!')
    }
    Case 'Missing popup pane never falls back to focused/caller pane' {
        $env:HERDR_ACTIVE_PANE_ID = ''
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $false -Label 'new' } 'HERDR_ACTIVE_PANE_ID'
        Assert ($script:calls.Count -eq 0)
    }
    Case 'Missing popup workspace never falls back to focused/caller workspace' {
        $env:HERDR_ACTIVE_WORKSPACE_ID = ''
        Expect-Error { Rename-HerdrContext -Agent $false -Workspace $true -Label 'new' } 'HERDR_ACTIVE_WORKSPACE_ID'
        Assert ($script:calls.Count -eq 0)
    }
    Case 'Known collisions skip names without writes' {
        $script:otherNames = @('fix-api', 'fix-api-2')
        $result = Rename-HerdrContext -Agent $true -Workspace $false -Label 'Fix API'
        Assert ($result.AgentName -eq 'fix-api-3') "Expected fix-api-3; got $($result.AgentName)"
        Assert ((Renames).Count -eq 1) "Expected one rename; calls: $($script:calls | ConvertTo-Json -Depth 6 -Compress)"
    }
    Case 'Own existing name is not a collision' {
        $script:agentName = 'fix-api'
        $result = Rename-HerdrContext -Agent $true -Workspace $false -Label 'Fix API'
        Assert ($result.AgentName -eq 'fix-api')
    }
    Case 'Long collision suffix stays within 32 characters' {
        $base = 'a' * 32
        $script:otherNames = @($base)
        $result = Rename-HerdrContext -Agent $true -Workspace $false -Label ('a' * 70)
        Assert ($result.AgentName -eq (('a' * 30) + '-2'))
    }
    Case 'Collision race retries structured agent_name_taken only' {
        Fail-Command 'agent|rename|w-popup:p7|new' 'agent_name_taken'
        $result = Rename-HerdrContext -Agent $true -Workspace $false -Label 'new'
        Assert ($result.AgentName -eq 'new-2')
        Assert ((Renames).Count -eq 2)
    }
    Case '20 preflight collisions: Both performs no writes' {
        $script:otherNames = @('new') + @(2..20 | ForEach-Object { "new-$_" })
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } '20 candidates'
        Assert ((Renames).Count -eq 0)
    }
    Case '20 racing collisions: bounded retries and Both rollback' {
        Fail-Command 'agent|rename|w-popup:p7|new' 'agent_name_taken'
        foreach ($n in 2..20) { Fail-Command "agent|rename|w-popup:p7|new-$n" 'agent_name_taken' }
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } 'original values restored'
        Assert ((Renames).Count -eq 21)
        Assert ($script:agentName -eq 'original-agent' -and $script:workspaceLabel -eq 'Original workspace')
    }
    Case 'Agent discovery error: no mutation' {
        Fail-Command 'agent|get|w-popup:p7' 'agent_not_found'
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } 'agent_not_found'
        Assert ((Renames).Count -eq 0)
    }
    Case 'Agent inventory error: no mutation' {
        Fail-Command 'agent|list' 'list_failed'
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } 'list_failed'
        Assert ((Renames).Count -eq 0)
    }
    Case 'Workspace preflight error: no mutation' {
        Fail-Command 'workspace|get|w-popup' 'workspace_not_found'
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } 'workspace_not_found'
        Assert ((Renames).Count -eq 0)
    }
    Case 'Noncollision error is not retried, even when message mentions collision' {
        Fail-Command 'agent|rename|w-popup:p7|new' 'permission_denied' '{"error":{"code":"permission_denied","message":"not agent_name_taken"}}'
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $false -Label 'new' } 'permission_denied'
        Assert ((Renames).Count -eq 1)
    }
    Case 'Workspace-only failure never touches agent' {
        Fail-Command 'workspace|rename|w-popup|new' 'permission_denied'
        Expect-Error { Rename-HerdrContext -Agent $false -Workspace $true -Label 'new' } 'no success reported'
        Assert (@($script:calls | Where-Object { $_[0] -eq 'agent' }).Count -eq 0)
    }
    Case 'Both second write failure restores both snapshots' {
        Fail-Command 'workspace|rename|w-popup|new' 'permission_denied'
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } 'original values restored'
        Assert ($script:agentName -eq 'original-agent' -and $script:workspaceLabel -eq 'Original workspace')
        Assert ((Renames).Count -eq 4)
    }
    Case 'Both failure clears previously unnamed agent' {
        $script:agentName = $null
        Fail-Command 'workspace|rename|w-popup|new' 'permission_denied'
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } 'original values restored'
        Assert ($null -eq $script:agentName)
        Assert ($script:calls[$script:calls.Count - 1][3] -eq '--clear')
    }
    Case 'Both first write failure rolls back and does not attempt workspace write' {
        Fail-Command 'agent|rename|w-popup:p7|new' 'permission_denied'
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } 'original values restored'
        Assert (@($script:calls | Where-Object { $_[0] -eq 'workspace' -and $_[1] -eq 'rename' }).Count -eq 0)
    }
    Case 'Ambiguous first write response restores agent' {
        Fail-Command 'agent|rename|w-popup:p7|new' 'unused' 'malformed JSON' $true
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } 'original values restored'
        Assert ($script:agentName -eq 'original-agent')
    }
    Case 'Ambiguous second write response restores both' {
        Fail-Command 'workspace|rename|w-popup|new' 'unused' 'malformed JSON' $true
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } 'original values restored'
        Assert ($script:agentName -eq 'original-agent' -and $script:workspaceLabel -eq 'Original workspace')
    }
    Case 'Rollback agent failure reports partial changes, never success' {
        Fail-Command 'workspace|rename|w-popup|new' 'permission_denied'
        Fail-Command 'agent|rename|w-popup:p7|original-agent' 'agent_name_taken'
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } 'ROLLBACK INCOMPLETE; partial changes may remain'
        Assert ($script:agentName -eq 'new')
    }
    Case 'Rollback workspace failure still attempts agent restore' {
        Fail-Command 'workspace|rename|w-popup|new' 'unused' 'malformed JSON' $true
        Fail-Command 'workspace|rename|w-popup|Original workspace' 'permission_denied'
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $true -Label 'new' } 'ROLLBACK INCOMPLETE'
        Assert ($script:workspaceLabel -eq 'new' -and $script:agentName -eq 'original-agent')
    }
    Case 'CLI launch failure is caught before writes' {
        $env:HERDR_BIN_PATH = Join-Path $env:TEMP ([guid]::NewGuid().ToString('N') + '.exe')
        # Suppress expected command-not-found ErrorRecord while retaining exception.
        Expect-Error { Rename-HerdrContext -Agent $true -Workspace $false -Label 'new' } 'not recognized|No JSON'
        Assert ($script:calls.Count -eq 0)
    }
    Case 'Actual native stderr JSON and exit 1 work under PS 5.1' {
        $mockPath = Join-Path $env:TEMP ('herdr-mock-' + [guid]::NewGuid().ToString('N') + '.cmd')
        try {
            Set-Content -LiteralPath $mockPath -Encoding ASCII -Value '@echo off', 'echo {"error":{"code":"agent_name_taken","message":"native stderr"}} 1>&2', 'exit /b 1'
            $env:HERDR_BIN_PATH = $mockPath
            $caught = $null
            try { $null = Invoke-HerdrCommand @('agent', 'rename', 'w-popup:p7', 'new') } catch { $caught = $_.Exception }
            Assert ($null -ne $caught -and $caught.Data['HerdrCode'] -eq 'agent_name_taken') "Native structured error lost: $($caught.Message)"
            Assert ($caught.Message -match 'exit 1') 'Native exit code lost'
        } finally { Remove-Item -LiteralPath $mockPath -ErrorAction SilentlyContinue }
    }
    Case 'UI Agent only: Space, Enter label, Enter apply' {
        Key Spacebar; Key Enter; Text 'Fix API'; Key Enter
        $request = Read-RenameRequest
        Assert ($request.Agent -and -not $request.Workspace -and $request.Label -eq 'Fix API')
        Assert ($script:calls.Count -eq 0) 'UI must not mutate while editing'
        $null = Rename-HerdrContext -Agent $request.Agent -Workspace $request.Workspace -Label $request.Label
        Assert ($script:agentName -eq 'fix-api' -and $script:workspaceLabel -eq 'Original workspace')
    }
    Case 'UI Workspace only via Down' {
        Key DownArrow; Key Spacebar; Key Enter; Text 'New Workspace'; Key Enter
        $request = Read-RenameRequest
        Assert (-not $request.Agent -and $request.Workspace)
        $null = Rename-HerdrContext -Agent $request.Agent -Workspace $request.Workspace -Label $request.Label
        Assert ($script:workspaceLabel -eq 'New Workspace' -and $script:agentName -eq 'original-agent')
    }
    Case 'UI Both via Tab, including Backspace edit' {
        Key Tab; Key Tab; Key Spacebar; Key Enter; Text 'NewX'; Key Backspace; Text ' API'; Key Enter
        $request = Read-RenameRequest
        Assert ($request.Agent -and $request.Workspace -and $request.Label -eq 'New API')
        $null = Rename-HerdrContext -Agent $request.Agent -Workspace $request.Workspace -Label $request.Label
        Assert ($script:agentName -eq 'new-api' -and $script:workspaceLabel -eq 'New API')
    }
    Case 'UI Both checkbox toggles both off; none cannot advance' {
        Key UpArrow; Key Spacebar; Key Spacebar; Key Enter; Key Escape
        Assert ($null -eq (Read-RenameRequest))
        Assert ($script:frames[$script:frames.Count - 1].Message -match 'at least one')
        Assert ($script:calls.Count -eq 0)
    }
    Case 'UI individual toggles unlink Both and only selected entity changes' {
        Key UpArrow; Key Spacebar; Key DownArrow; Key Spacebar; Key Enter; Text 'workspace'; Key Enter
        $request = Read-RenameRequest
        Assert (-not $request.Agent -and $request.Workspace)
    }
    Case 'UI independent Agent and Workspace toggles select Both' {
        Key Spacebar; Key Tab; Key Spacebar; Key Enter; Text 'both'; Key Enter
        $request = Read-RenameRequest
        Assert ($request.Agent -and $request.Workspace)
    }
    Case 'UI Shift-Tab wraps to Both' {
        Key Tab $true; Key Spacebar; Key Enter; Text 'both'; Key Enter
        $request = Read-RenameRequest
        Assert ($request.Agent -and $request.Workspace)
    }
    Case 'UI Esc from selection: no calls' {
        Key Spacebar; Key Escape
        Assert ($null -eq (Read-RenameRequest))
        Assert ($script:calls.Count -eq 0)
    }
    Case 'UI Esc from label: no calls' {
        Key Spacebar; Key Enter; Text 'never applied'; Key Escape
        Assert ($null -eq (Read-RenameRequest))
        Assert ($script:calls.Count -eq 0)
    }
    Case 'UI blank and invalid label stay open until cancel' {
        Key Spacebar; Key Enter; Key Enter; Text '!!!'; Key Enter; Key Escape
        Assert ($null -eq (Read-RenameRequest))
        Assert (@($script:frames | Where-Object { $_.Message -match 'nonblank' }).Count -eq 1)
        Assert (@($script:frames | Where-Object { $_.Message -match 'ASCII' }).Count -eq 1)
        Assert ($script:calls.Count -eq 0)
    }
    Write-Output "PASS: $script:passed cases; target parsed; no live Herdr mutations."
} finally {
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name]) }
}
