# Windows PowerShell 5.1; injected CLI JSON only, no live endpoint or pane access.
$ErrorActionPreference = 'Stop'
$target = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools/cockpit-status.ps1'
$tokens = $null
$parseErrors = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($target, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$envNames = @('HERDR_BIN_PATH', 'HERDR_SOCKET_PATH', 'HERDR_ACTIVE_PANE_ID', 'HERDR_ACTIVE_WORKSPACE_ID')
$savedEnv = @{}
foreach ($name in $envNames) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name) }
$script:passed = 0
function Assert($Condition, [string]$Message = 'Assertion failed') {
    if (-not $Condition) { throw $Message }
}
function Agent([string]$Id, [string]$Status, [string]$Workspace = 'w1') {
    return @{ pane_id = $Id; workspace_id = $Workspace; tab_id = "$Workspace`:t1"; agent_status = $Status }
}
function Reset-Mock {
    $env:HERDR_BIN_PATH = 'Mock-Herdr'
    $env:HERDR_SOCKET_PATH = 'C:\fixture\inherited-local.sock'
    $env:HERDR_ACTIVE_PANE_ID = 'w1:p1'
    $env:HERDR_ACTIVE_WORKSPACE_ID = 'w1'
    $script:calls = [Collections.Generic.List[object]]::new()
    $script:lines = [Collections.Generic.List[string]]::new()
    $script:keys = [Collections.Generic.Queue[object]]::new()
    $script:agents = @()
    $script:failure = ''
    $script:socketA = 'C:\fixture\host-a.sock'
    $script:socketB = 'C:\fixture\host-b.sock'
}
function Case([string]$Name, [scriptblock]$Body) {
    Reset-Mock
    try { & $Body; $script:passed++; Write-Output "PASS $Name" }
    catch { throw "FAIL ${Name}: $($_.Exception.Message)" }
}
function Mock-Herdr {
    $arguments = @($args)
    $command = $arguments -join '|'
    $script:calls.Add([pscustomobject]@{ Command = $command; Endpoint = $env:HERDR_SOCKET_PATH })
    $global:LASTEXITCODE = 0
    if ($script:failure -eq 'disconnect') {
        $global:LASTEXITCODE = 1
        return '{"error":{"code":"unavailable","message":"fixture private detail"}}'
    }
    if ($script:failure -eq 'malformed') { return 'not JSON' }
    if ($script:failure -eq 'missing') { return '{"result":{}}' }
    if ($script:failure -eq 'scalar') { return '{"result":{"agents":"invalid"}}' }
    switch ($command) {
        'agent|list' { $result = @{ agents = @($script:agents) } }
        'pane|get|w1:p1' { $result = @{ pane = @{ pane_id = 'w1:p1'; cwd = 'C:\fixture\project' } } }
        'workspace|get|w1' { $result = @{ workspace = @{ workspace_id = 'w1'; label = 'Fixture space' } } }
        default { throw "Forbidden mock command: $command" }
    }
    return (@{ result = $result } | ConvertTo-Json -Depth 8 -Compress)
}
try {
    Reset-Mock
    $ErrorActionPreference = 'Continue'
    . $target
    $importPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Stop'
    Assert ($script:calls.Count -eq 0) 'Dot sourcing called Herdr'
    Assert ($importPreference -eq 'Continue') 'Dot sourcing changed preferences'
    # Capture the UI without an interactive host; keep the actual CLI adapter.
    function Write-Host($Object, $ForegroundColor) { $script:lines.Add([string]$Object) }
    function Read-CockpitKey {
        Assert ($script:keys.Count -gt 0) 'Unexpected key request'
        return $script:keys.Dequeue()
    }
    Case 'missing endpoint never uses inherited local socket or popup IDs' {
        foreach ($endpoint in @('', 'relative.sock', 'C:drive-relative.sock', '\drive-root-relative.sock', "C:\fixture\bad`n.sock")) {
            $queue = Get-CockpitAttention $endpoint
            Assert (-not $queue.Available)
            Assert ($queue.Message -match 'explicit absolute')
        }
        Assert ($script:calls.Count -eq 0)
    }
    Case 'explicit Windows named pipe is accepted and absent inherited socket stays absent' {
        $env:HERDR_SOCKET_PATH = $null
        $endpoint = '\\.\pipe\fixture-herdr'
        $queue = Get-CockpitAttention $endpoint
        Assert $queue.Available
        Assert ($script:calls[0].Endpoint -ceq $endpoint)
        Assert ($null -eq $env:HERDR_SOCKET_PATH)
    }
    Case 'blocked, unknown and server done stay separate from client unseen' {
        $script:agents = @((Agent 'w1:p5' 'done'), (Agent 'w1:p4' 'working'),
            (Agent 'w1:p3' 'unknown'), (Agent 'w1:p2' 'idle'), (Agent 'w1:p1' 'blocked'))
        $queue = Get-CockpitAttention $script:socketA
        Assert $queue.Available
        Assert ($queue.Rows.Count -eq 3)
        Assert ($queue.Rows[0].Category -eq 'Blocked')
        Assert ($queue.Rows[1].NativeStatus -eq 'unknown')
        Assert ($queue.Rows[2].Category -eq 'Unknown' -and $queue.Rows[2].NativeStatus -eq 'done')
        Assert ($queue.Rows[2].Reason -match 'cannot be established')
        Assert ($env:HERDR_SOCKET_PATH -eq 'C:\fixture\inherited-local.sock')
        Assert ($script:calls.Count -eq 1 -and $script:calls[0].Endpoint -ceq $script:socketA)
    }
    Case 'stable ordering does not depend on inventory order' {
        $script:agents = @((Agent 'w2:p2' 'blocked' 'w2'), (Agent 'w1:p2' 'unknown'), (Agent 'w1:p1' 'blocked'))
        $first = (Get-CockpitAttention $script:socketA).Rows | ConvertTo-Json -Compress
        [array]::Reverse($script:agents)
        $second = (Get-CockpitAttention $script:socketA).Rows | ConvertTo-Json -Compress
        Assert ($first -ceq $second)
    }
    Case 'duplicate IDs within endpoint fail closed as unknown' {
        $script:agents = @((Agent 'w1:p1' 'blocked'), (Agent 'w1:p1' 'done'), (Agent '' 'blocked'), (Agent 'w1:p4' 'new-state'))
        $queue = Get-CockpitAttention $script:socketA
        Assert ($queue.Rows.Count -eq 4)
        Assert (@($queue.Rows | Where-Object { $_.Category -ne 'Unknown' }).Count -eq 0)
    }
    Case 'identical pane IDs on two explicit hosts never merge or fall back' {
        $script:agents = @((Agent 'w1:p1' 'blocked'))
        $a = Get-CockpitAttention $script:socketA
        $script:agents = @((Agent 'w1:p1' 'unknown'))
        $b = Get-CockpitAttention $script:socketB
        Assert ($a.Endpoint -cne $b.Endpoint)
        Assert ($a.Rows[0].Category -eq 'Blocked' -and $b.Rows[0].Category -eq 'Unknown')
        Assert ($script:calls[0].Endpoint -ceq $script:socketA -and $script:calls[1].Endpoint -ceq $script:socketB)
    }
    Case 'closed pane disappears on next on-demand read; empty is not unavailable' {
        $script:agents = @((Agent 'w1:p1' 'blocked'))
        Assert ((Get-CockpitAttention $script:socketA).Rows.Count -eq 1)
        $script:agents = @()
        $queue = Get-CockpitAttention $script:socketA
        Assert ($queue.Available -and $queue.Rows.Count -eq 0)
        Show-CockpitAttention -EndpointSocket $script:socketA -TestRender
        Assert (@($script:lines | Where-Object { $_ -eq '(none in this snapshot)' }).Count -eq 2)
    }
    Case 'disconnect and invalid responses restore routing; no misleading empty result' {
        foreach ($failure in @('disconnect', 'malformed', 'missing', 'scalar')) {
            $script:failure = $failure
            $queue = Get-CockpitAttention $script:socketB
            Assert (-not $queue.Available -and $queue.Rows.Count -eq 0)
            Assert ($queue.Message -match 'unavailable' -and $queue.Message -notmatch 'private detail')
            Assert ($env:HERDR_SOCKET_PATH -eq 'C:\fixture\inherited-local.sock')
        }
        Assert ($script:calls.Count -eq 4)
        Assert (@($script:calls | Where-Object { $_.Endpoint -cne $script:socketB }).Count -eq 0)
        Show-CockpitAttention -EndpointSocket $script:socketB -TestRender
        Assert (($script:lines -join "`n") -match 'Attention unavailable')
        Assert (($script:lines -join "`n") -notmatch 'none in this snapshot|private detail')
    }
    Case 'attention renders without popup context and never jumps on Enter or numbers' {
        $env:HERDR_ACTIVE_PANE_ID = ''
        $env:HERDR_ACTIVE_WORKSPACE_ID = ''
        $script:agents = @((Agent "w1:p1$([char]27)[31m" 'blocked'), (Agent 'w1:p2' 'done'))
        foreach ($key in @('Enter', 'D1', 'Q')) { $script:keys.Enqueue(@{ Key = [ConsoleKey]$key }) }
        Show-CockpitStatus -Attention -EndpointSocket $script:socketA
        $text = $script:lines -join "`n"
        Assert ($text -match 'UNSEEN COMPLETION: unavailable' -and $text -match 'Jump unavailable')
        Assert (-not $text.Contains([string][char]27)) 'Terminal escape leaked'
        Assert ($script:calls.Count -eq 1 -and $script:calls[0].Command -eq 'agent|list')
    }
    Case 'F4 default retains its original read-only commands' {
        $script:keys.Enqueue(@{ Key = [ConsoleKey]::Q })
        Show-CockpitStatus
        Assert (($script:calls.Command -join ',') -eq 'pane|get|w1:p1,workspace|get|w1,agent|list')
        Assert (($script:lines -join "`n") -match 'ACTIVE CONTEXT')
        Assert (($script:lines -join "`n") -notmatch 'ATTENTION \(READ-ONLY\)')
    }
    Case 'F4 adds no default attention shortcut or ambiguous endpoint read' {
        $script:keys.Enqueue(@{ Key = [ConsoleKey]::A })
        $script:keys.Enqueue(@{ Key = [ConsoleKey]::Q })
        Show-CockpitStatus
        Assert ($script:calls.Count -eq 3)
        Assert (($script:lines -join "`n") -notmatch 'ATTENTION \(READ-ONLY\)|A: attention')
    }
    Write-Output "PASS: $script:passed cases; target parsed; mock CLI only; no focus or mutations."
} finally {
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name]) }
}
