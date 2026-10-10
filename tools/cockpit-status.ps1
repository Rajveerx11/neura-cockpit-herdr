param([switch]$TestRender)
$ErrorActionPreference = 'Stop'
# Reuse the existing tested CLI adapter; dot sourcing never opens its rename UI.
. (Join-Path $PSScriptRoot 'rename-context.ps1')
function Format-CockpitText($Value) {
    return [regex]::Replace([string]$Value, '[\x00-\x1f\x7f]', ' ')
}
try {
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
    Write-Host 'Esc or Q closes. Read-only: no files, names, or agent state are changed.'
    if (-not $TestRender) {
        do { $key = [Console]::ReadKey($true) } while ($key.Key -notin @([ConsoleKey]::Escape, [ConsoleKey]::Q))
    }
    exit 0
} catch {
    Write-Host (Format-CockpitText $_.Exception.Message) -ForegroundColor Red
    if (-not $TestRender) { [void][Console]::ReadKey($true) }
    exit 1
}
