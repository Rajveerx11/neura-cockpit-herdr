# Deterministic Windows PowerShell 5.1 tests; no Pester or live Herdr calls.
$ErrorActionPreference = 'Stop'
$target = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools/worker-launcher.ps1'
$tokens = $null
$parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($target, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
. $target
$script:nativeAdapter = ${function:Invoke-WorkerLauncherNode}
$script:passed = 0

function Assert($Condition, [string]$Message = 'Assertion failed') {
    if (-not $Condition) { throw $Message }
}
function Expect-Error([scriptblock]$Body, [string]$Pattern) {
    $text = $null
    try { $null = & $Body } catch { $text = $_.Exception.Message }
    Assert ($null -ne $text) 'Expected an error'
    Assert ($text -match $Pattern) "Unexpected error: $text"
    return $text
}
function Case([string]$Name, [scriptblock]$Body) {
    Reset-Mock
    try { & $Body; $script:passed++; Write-Output "PASS $Name" }
    catch { throw "FAIL ${Name}: $($_.Exception.Message)" }
}
$envNames = @('HERDR_ENV', 'HERDR_BIN_PATH', 'HERDR_WORKSPACE_ID', 'HERDR_TAB_ID', 'HERDR_PANE_ID',
    'HERDR_ACTIVE_PANE_ID', 'HERDR_ACTIVE_WORKSPACE_ID', 'HERDR_ACTIVE_TAB_ID', 'HERDR_ACTIVE_PANE_CWD')
$savedEnv = @{}
foreach ($key in $envNames) { $savedEnv[$key] = [Environment]::GetEnvironmentVariable($key) }
function Reset-Mock {
    foreach ($key in $envNames) { [Environment]::SetEnvironmentVariable($key, $null) }
    $env:HERDR_ENV = '1'
    $env:HERDR_BIN_PATH = 'C:\Apps\Herdr\herdr.exe'
    $env:HERDR_WORKSPACE_ID = 'w-test'
    $env:HERDR_TAB_ID = 'w-test:t3'
    $env:HERDR_PANE_ID = 'w-test:p7'
    $script:answers = [System.Collections.Generic.Queue[string]]::new()
    $script:prompts = [System.Collections.Generic.List[string]]::new()
    $script:calls = [System.Collections.Generic.List[object]]::new()
    $script:nativeCalls = [System.Collections.Generic.List[object]]::new()
    $script:exitCode = 0
    $script:rawText = $null
    $script:adapterThrows = $false
    $script:interrupt = $false
    $script:changeContext = $false
    $script:reply = @{
        parent_pane_id = 'w-test:p7'; workspace_id = 'w-test'; tab_id = 'w-test:t3'
        pane_id = 'w-test:p9'; kind = 'codex'; name = 'reviewer'; direction = 'right'
        focus = $false; ready = $true; prompt_submitted = $false; turn_activity_verified = $false
    }
}
function Read-WorkerLauncherValue([string]$Prompt) {
    $script:prompts.Add($Prompt)
    if ($script:interrupt) { throw [System.OperationCanceledException]::new('User cancelled') }
    Assert ($script:answers.Count -gt 0) 'Unexpected prompt'
    if ($script:changeContext -and $script:prompts.Count -eq 2) { $env:HERDR_PANE_ID = '' }
    return $script:answers.Dequeue()
}
function Invoke-WorkerLauncherNode([string[]]$Arguments) {
    $script:calls.Add($Arguments)
    if ($script:adapterThrows) { throw 'mock transport loss' }
    $text = if ($null -ne $script:rawText) { $script:rawText } else { $script:reply | ConvertTo-Json -Compress }
    return [pscustomobject]@{ ExitCode = $script:exitCode; Text = $text }
}
function Answers([string]$Kind = 'codex', [string]$Name = 'reviewer') {
    $script:answers.Enqueue($Kind)
    $script:answers.Enqueue($Name)
}
function Mock-WorkerNode {
    $script:nativeCalls.Add(@($args))
    $global:LASTEXITCODE = $script:exitCode
    if ($script:exitCode) { Write-Error 'mock native stderr' -ErrorAction Continue }
    else { '{"ready":true}' }
}

try {
    Case 'cancel at kind invokes nothing' {
        Answers ''
        Assert ($null -eq (Invoke-WorkerLauncher))
        Assert ($script:calls.Count -eq 0 -and $script:prompts.Count -eq 1)
    }
    Case 'cancel at name invokes nothing' {
        Answers 'codex' ''
        Assert ($null -eq (Invoke-WorkerLauncher))
        Assert ($script:calls.Count -eq 0 -and $script:prompts.Count -eq 2)
    }
    Case 'whitespace cancels without a worker' {
        Answers 'codex' '  '
        Assert ($null -eq (Invoke-WorkerLauncher))
        Assert ($script:calls.Count -eq 0)
    }
    Case 'interrupted input never invokes helper' {
        $script:interrupt = $true
        $null = Expect-Error { Invoke-WorkerLauncher } 'cancelled'
        Assert ($script:calls.Count -eq 0)
    }
    foreach ($kind in @('fx', 'unknown', 'CODEX', '--kind', 'codex;whoami', ' codex')) {
        Case "reject kind [$kind] before name prompt" {
            Answers $kind
            $null = Expect-Error { Invoke-WorkerLauncher } 'Unsupported worker kind'
            Assert ($script:calls.Count -eq 0 -and $script:prompts.Count -eq 1)
        }
    }
    foreach ($name in @('Bad', 'two names', '9worker', '--name', 'a;whoami', ('a' * 33), "valid`n")) {
        Case "reject invalid name of length $($name.Length)" {
            Answers 'codex' $name
            $null = Expect-Error { Invoke-WorkerLauncher } 'Invalid worker name'
            Assert ($script:calls.Count -eq 0)
        }
    }
    foreach ($key in @('HERDR_ENV', 'HERDR_BIN_PATH', 'HERDR_WORKSPACE_ID', 'HERDR_TAB_ID', 'HERDR_PANE_ID')) {
        Case "missing $key fails before prompts or native calls" {
            [Environment]::SetEnvironmentVariable($key, $null)
            $null = Expect-Error { Invoke-WorkerLauncher } $key
            Assert ($script:calls.Count -eq 0 -and $script:prompts.Count -eq 0)
        }
    }
    Case 'invalid injected context is not accepted' {
        $env:HERDR_PANE_ID = "w-test:p7`n"
        $null = Expect-Error { Invoke-WorkerLauncher } 'invalid injected HERDR_PANE_ID'
        Assert ($script:calls.Count -eq 0)
    }
    Case 'non-Windows binary is refused' {
        $env:HERDR_BIN_PATH = '/usr/bin/herdr'
        $null = Expect-Error { Invoke-WorkerLauncher } 'Windows Herdr binary'
        Assert ($script:calls.Count -eq 0)
    }
    Case 'explicit popup fails even with plausible manager IDs' {
        $null = Expect-Error { Invoke-WorkerLauncher -FromPopup $true } 'Popup manager identity is unverified'
        Assert ($script:calls.Count -eq 0 -and $script:prompts.Count -eq 0)
    }
    foreach ($key in @('HERDR_ACTIVE_PANE_ID', 'HERDR_ACTIVE_WORKSPACE_ID', 'HERDR_ACTIVE_TAB_ID', 'HERDR_ACTIVE_PANE_CWD')) {
        Case "popup marker $key fails closed without remapping" {
            [Environment]::SetEnvironmentVariable($key, 'w-test:p7')
            $null = Expect-Error { Invoke-WorkerLauncher } 'not authoritative manager context'
            Assert ($script:calls.Count -eq 0 -and $script:prompts.Count -eq 0)
            Assert ($env:HERDR_PANE_ID -ceq 'w-test:p7')
        }
    }
    Case 'context loss during input fails without invoking helper' {
        Answers
        $script:changeContext = $true
        $null = Expect-Error { Invoke-WorkerLauncher } 'HERDR_PANE_ID'
        Assert ($script:calls.Count -eq 0)
    }
    Case 'valid but substituted manager IDs during input are refused' {
        function Read-WorkerLauncherValue([string]$Prompt) {
            if ($Prompt -match 'Worker kind') { return 'codex' }
            $env:HERDR_PANE_ID = 'w-other:p2'
            $env:HERDR_TAB_ID = 'w-other:t1'
            $env:HERDR_WORKSPACE_ID = 'w-other'
            return 'reviewer'
        }
        $null = Expect-Error { Invoke-WorkerLauncher } 'Manager context changed during input'
        Assert ($script:calls.Count -eq 0)
    }
    Case 'exactly one guarded invocation and no context/cwd changes' {
        Answers
        $cwd = (Get-Location).Path
        $before = @{}
        foreach ($key in $envNames) { $before[$key] = [Environment]::GetEnvironmentVariable($key) }
        $result = Invoke-WorkerLauncher
        Assert ($result.ready -and -not $result.prompt_submitted -and -not $result.turn_activity_verified)
        Assert ($script:calls.Count -eq 1 -and $script:prompts.Count -eq 2)
        Assert ($script:prompts[0] -match 'Worker kind' -and $script:prompts[1] -match 'Unique worker name')
        $expected = @($script:workerSpawnPath, '--kind', 'codex', '--name', 'reviewer')
        Assert (($script:calls[0] -join '|') -ceq ($expected -join '|')) 'Unexpected helper arguments'
        Assert ((Get-Location).Path -ceq $cwd)
        foreach ($key in $envNames) { Assert ([Environment]::GetEnvironmentVariable($key) -ceq $before[$key]) "Environment changed: $key" }
    }
    Case 'advertised kinds exactly match the existing guarded helper' {
        $source = Get-Content -LiteralPath $script:workerSpawnPath -Raw
        $match = [regex]::Match($source, "const KINDS = '([^']+)'\.split\(' '\);")
        Assert $match.Success 'Existing helper kind declaration changed; review contract'
        Assert (((Get-WorkerLauncherKinds) -join ' ') -ceq $match.Groups[1].Value)
        foreach ($kind in (Get-WorkerLauncherKinds)) {
            Answers $kind
            $script:reply.kind = $kind
            $null = Invoke-WorkerLauncher
        }
        Assert ($script:calls.Count -eq @(Get-WorkerLauncherKinds).Count)
    }
    foreach ($failure in @('duplicate name', 'narrow geometry', 'agent_not_ready', 'timeout')) {
        Case "helper failure [$failure] preserves retained-pane evidence without retry" {
            Answers
            $script:exitCode = 1
            $script:rawText = '{"error":"' + $failure + '","pane_id":"w-test:p9","cleanup":"retained"}'
            $message = Expect-Error { Invoke-WorkerLauncher } 'exit 1'
            Assert ($message.Contains($script:rawText)) 'Helper evidence lost'
            Assert ($message -match 'Inspect manager layout' -and $script:calls.Count -eq 1)
        }
    }
    Case 'lost native invocation response is ambiguous, never retried' {
        Answers
        $script:adapterThrows = $true
        $null = Expect-Error { Invoke-WorkerLauncher } 'ambiguous.*Inspect manager layout'
        Assert ($script:calls.Count -eq 1)
    }
    foreach ($text in @('{', '', '{"ready":true}', '{"error":"lost reply"}')) {
        Case "invalid success response [$text] is not readiness" {
            Answers
            $script:rawText = $text
            $null = Expect-Error { Invoke-WorkerLauncher } 'outcome may be ambiguous'
            Assert ($script:calls.Count -eq 1)
        }
    }
    foreach ($field in @('parent_pane_id', 'workspace_id', 'tab_id', 'kind', 'name', 'pane_id', 'ready', 'focus', 'prompt_submitted', 'turn_activity_verified')) {
        Case "wrong response field $field never reports success" {
            Answers
            $script:reply[$field] = if ($field -eq 'pane_id') { 'w-test:p7' } else { 'wrong' }
            $null = Expect-Error { Invoke-WorkerLauncher } 'did not prove startup'
            Assert ($script:calls.Count -eq 1)
        }
    }
    Case 'native adapter passes spaced script path as a single argument' {
        function Get-Command { param($Name, $CommandType, $ErrorAction)
            Assert ($Name -ceq 'node.exe' -and $CommandType -ceq 'Application')
            return [pscustomobject]@{ Source = 'Mock-WorkerNode' }
        }
        $result = & $script:nativeAdapter @('C:\Example Repo\tools\spawn-agent.mjs', '--kind', 'codex', '--name', 'reviewer')
        Assert ($result.ExitCode -eq 0 -and $result.Text -ceq '{"ready":true}')
        Assert ($script:nativeCalls.Count -eq 1)
        Assert ($script:nativeCalls[0].Count -eq 5 -and $script:nativeCalls[0][0] -ceq 'C:\Example Repo\tools\spawn-agent.mjs')
    }
    Case 'native adapter retains nonzero exit and stderr' {
        function Get-Command { param($Name, $CommandType, $ErrorAction)
            return [pscustomobject]@{ Source = 'Mock-WorkerNode' }
        }
        $script:exitCode = 7
        $result = & $script:nativeAdapter @('C:\Example Repo\tools\spawn-agent.mjs', '--kind', 'codex', '--name', 'reviewer')
        Assert ($result.ExitCode -eq 7 -and $result.Text -match 'mock native stderr')
        Assert ($script:nativeCalls.Count -eq 1)
    }
    Case 'actual PowerShell entrypoint refuses popup with exit 1' {
        $output = & (Join-Path $PSHOME 'powershell.exe') -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $target -Popup
        Assert ($LASTEXITCODE -eq 1 -and ($output -join ' ') -match 'Popup manager identity is unverified')
        Assert ($script:calls.Count -eq 0)
    }
    Case 'actual PowerShell entrypoint refuses missing manager context with exit 1' {
        $env:HERDR_PANE_ID = ''
        $output = & (Join-Path $PSHOME 'powershell.exe') -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $target
        Assert ($LASTEXITCODE -eq 1 -and ($output -join ' ') -match 'HERDR_PANE_ID')
        Assert ($script:calls.Count -eq 0)
    }
    Write-Output "All $script:passed worker launcher tests passed. No live Herdr calls."
} finally {
    foreach ($key in $envNames) { [Environment]::SetEnvironmentVariable($key, $savedEnv[$key]) }
}
