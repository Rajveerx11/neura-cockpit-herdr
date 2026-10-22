param([switch]$TestRender, [switch]$Attention, [switch]$Identity, [string]$EndpointSocket)
# Reuse the existing tested CLI adapter; dot sourcing never opens its rename UI.
. (Join-Path $PSScriptRoot 'rename-context.ps1')
. (Join-Path $PSScriptRoot 'cockpit-identity.ps1')
function Format-CockpitText($Value) {
    return [regex]::Replace([string]$Value, '[\x00-\x1f\x7f-\x9f]', ' ')
}

function Get-CockpitAttention([string]$EndpointSocket) {
    $ErrorActionPreference = 'Stop'
    $result = [pscustomobject]@{
        Endpoint = $EndpointSocket; Available = $false; Rows = @(); Message = ''
    }
    # Popup IDs and inherited socket/session defaults cannot identify the displayed host.
    # Require an explicit socket; never discover profiles or fall back to local.
    if ([string]::IsNullOrWhiteSpace($EndpointSocket) -or
        $EndpointSocket -match '[\x00-\x1f\x7f-\x9f]' -or
        $EndpointSocket -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+\\[^\\/]+(?:\\|$))') {
        $result.Message = 'Attention unavailable: supply -EndpointSocket with an explicit absolute API socket path.'
        return $result
    }
    $oldSocket = $env:HERDR_SOCKET_PATH
    try {
        $env:HERDR_SOCKET_PATH = $EndpointSocket
        $inventory = Invoke-HerdrCommand @('agent', 'list')
        if ($inventory.agents -isnot [array]) { throw 'Invalid agent inventory.' }
        $agents = @($inventory.agents)
        $rows = foreach ($agent in $agents) {
            $status = [string]$agent.agent_status
            $duplicate = @($agents | Where-Object { $_.pane_id -ceq $agent.pane_id }).Count -gt 1
            $reason = ''
            $category = 'Unknown'
            if (-not $agent.pane_id -or $duplicate) { $reason = 'Missing or duplicate pane identity.' }
            elseif ($status -ceq 'blocked') { $category = 'Blocked' }
            elseif ($status -ceq 'done') { $reason = 'CLI done; client unseen completion cannot be established.' }
            elseif ($status -ceq 'unknown') { $reason = 'Native unknown.' }
            elseif ($status -cin @('idle', 'working')) { continue }
            else { $reason = 'Missing or unsupported native status.' }
            [pscustomobject]@{
                Category = $category; WorkspaceId = [string]$agent.workspace_id
                TabId = [string]$agent.tab_id; PaneId = [string]$agent.pane_id
                NativeStatus = $status; Reason = $reason
            }
        }
        $result.Rows = @($rows | Sort-Object Category, WorkspaceId, TabId, PaneId, NativeStatus, Reason)
        $result.Available = $true
    } catch {
        # Do not print raw CLI errors, which can contain endpoint/profile details.
        $result.Message = 'Attention unavailable: endpoint disconnected or native inventory invalid. No local fallback.'
    } finally {
        $env:HERDR_SOCKET_PATH = $oldSocket
    }
    return $result
}

function Read-CockpitKey { return [Console]::ReadKey($true) }

function Show-CockpitAttention([string]$EndpointSocket, [switch]$TestRender) {
    $queue = Get-CockpitAttention $EndpointSocket
    Write-Host 'NEURA COCKPIT | ATTENTION (READ-ONLY)' -ForegroundColor Cyan
    Write-Host ('Explicit CLI endpoint: ' + (Format-CockpitText $queue.Endpoint))
    Write-Host 'Not verified against the displayed client host or its seen state.'
    if (-not $queue.Available) { Write-Host $queue.Message -ForegroundColor Yellow }
    Write-Host ''
    Write-Host 'BLOCKED' -ForegroundColor Cyan
    foreach ($row in @($queue.Rows | Where-Object { $_.Category -eq 'Blocked' })) {
        Write-Host (Format-CockpitText "$($row.WorkspaceId) | $($row.TabId) | $($row.PaneId) | native blocked")
    }
    if ($queue.Available -and -not @($queue.Rows | Where-Object { $_.Category -eq 'Blocked' }).Count) {
        Write-Host '(none in this snapshot)'
    }
    Write-Host ''
    Write-Host 'UNSEEN COMPLETION: unavailable (not established by CLI inventory).' -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'UNKNOWN / COMPLETION UNVERIFIED' -ForegroundColor Cyan
    foreach ($row in @($queue.Rows | Where-Object { $_.Category -eq 'Unknown' })) {
        Write-Host (Format-CockpitText "$($row.WorkspaceId) | $($row.TabId) | $($row.PaneId) | native $($row.NativeStatus) | $($row.Reason)")
    }
    if ($queue.Available -and -not @($queue.Rows | Where-Object { $_.Category -eq 'Unknown' }).Count) {
        Write-Host '(none in this snapshot)'
    }
    Write-Host ''
    Write-Host 'Jump unavailable: no verified displayed-client endpoint/selection contract.'
    Write-Host 'Snapshot only; panes may close after listing. No prompts, approvals, or focus commands.'
    Write-Host 'Esc or Q closes.'
    if (-not $TestRender) {
        do { $key = Read-CockpitKey } while ($key.Key -notin @([ConsoleKey]::Escape, [ConsoleKey]::Q))
    }
}

function Show-CockpitStatus([switch]$TestRender, [switch]$Attention, [switch]$Identity, [string]$EndpointSocket) {
    $ErrorActionPreference = 'Stop'
    if ($Identity -and $Attention) { throw 'Choose either -Identity or -Attention. No query was made.' }
    if ($Identity) {
        Show-CockpitIdentity -EndpointSocket $EndpointSocket -TestRender:$TestRender
        return
    }
    if ($Attention) {
        Show-CockpitAttention -EndpointSocket $EndpointSocket -TestRender:$TestRender
        return
    }
    $paneId = $env:HERDR_ACTIVE_PANE_ID
    $workspaceId = $env:HERDR_ACTIVE_WORKSPACE_ID
    if (-not $paneId -or -not $workspaceId) { throw 'Open this panel with F4 inside Herdr.' }
    $pane = (Invoke-HerdrCommand @('pane', 'get', $paneId)).pane
    $workspace = (Invoke-HerdrCommand @('workspace', 'get', $workspaceId)).workspace
    $agents = (Invoke-HerdrCommand @('agent', 'list')).agents
    if ($pane.pane_id -ne $paneId -or $workspace.workspace_id -ne $workspaceId) {
        throw 'Herdr returned a different context. Nothing was changed.'
    }
    Write-Host 'NEURA COCKPIT | ACTIVE CONTEXT' -ForegroundColor Cyan
    Write-Host ('Space:  ' + (Format-CockpitText $workspace.label) + " [$workspaceId]")
    Write-Host ('Pane:   ' + (Format-CockpitText $paneId))
    Write-Host ('Folder: ' + (Format-CockpitText $pane.cwd))
    Write-Host ''
    Write-Host 'VISIBLE AGENTS IN THIS SPACE' -ForegroundColor Cyan
    foreach ($agent in @($agents | Where-Object { $_.workspace_id -eq $workspaceId })) {
        $name = if ($agent.name) { $agent.name } else { $agent.agent }
        Write-Host (Format-CockpitText "$($agent.pane_id) | $name | $($agent.agent_status)")
        Write-Host ('  ' + (Format-CockpitText $agent.cwd))
        if ($agent.tokens.usage) { Write-Host ('  Limits: ' + (Format-CockpitText $agent.tokens.usage)) }
    }
    Write-Host ''
    Write-Host 'Different projects can share a Space. New workers follow the manager folder.'
    Write-Host 'Native state describes each visible agent, not hidden runtime children.'
    Write-Host 'Ctrl+K jump | F2 rename | Ctrl+Shift+M Markdown | Ctrl+Shift+R reload'
    Write-Host 'Esc or Q closes.'
    Write-Host 'Read-only: no files, names, or agent state are changed.'
    if (-not $TestRender) {
        do { $key = Read-CockpitKey } while ($key.Key -notin @([ConsoleKey]::Escape, [ConsoleKey]::Q))
    }
}

# Import exposes helpers without reads, UI, exits, or preference changes.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        Show-CockpitStatus -TestRender:$TestRender -Attention:$Attention -Identity:$Identity -EndpointSocket $EndpointSocket
        exit 0
    } catch {
        Write-Host (Format-CockpitText $_.Exception.Message) -ForegroundColor Red
        if (-not $TestRender) { [void](Read-CockpitKey) }
        exit 1
    }
}
