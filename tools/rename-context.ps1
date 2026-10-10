param([string]$TestLabel)

function ConvertTo-AgentName([string]$Value) {
    $name = [regex]::Replace($Value.ToLowerInvariant(), '[^a-z0-9_-]+', '-').Trim('-', '_')
    if (-not $name) { return '' }
    if ($name[0] -notmatch '[a-z]') { $name = "agent-$name" }
    return $name.Substring(0, [Math]::Min(32, $name.Length)).TrimEnd('-', '_')
}

# Keep the original noninteractive normalization probe compatible.
if ($PSBoundParameters.ContainsKey('TestLabel')) {
    ConvertTo-AgentName $TestLabel
    exit
}

function Invoke-HerdrCommand([string[]]$Arguments) {
    $binary = if ($env:HERDR_BIN_PATH) { $env:HERDR_BIN_PATH } else { 'herdr' }
    # PS 5.1 represents native stderr as ErrorRecords. Capture it, then inspect
    # the exit code rather than letting a caller's Stop preference hide it.
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = 0
    $output = & $binary @Arguments 2>&1
    $code = $global:LASTEXITCODE
    $text = (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
    $reply = $null
    try { $reply = $text | ConvertFrom-Json -ErrorAction Stop } catch { }
    if ($code -ne 0 -or $null -eq $reply -or $reply.error -or $null -eq $reply.result) {
        $detail = if ($text) { $text } else { 'No JSON response from Herdr.' }
        $exception = [System.Exception]::new("herdr $($Arguments -join ' ') (exit $code): $detail")
        if ($reply.error.code) { $exception.Data['HerdrCode'] = [string]$reply.error.code }
        throw $exception
    }
    return $reply.result
}

function Rename-HerdrContext {
    param([bool]$Agent, [bool]$Workspace, [string]$Label)

    if (-not ($Agent -or $Workspace)) { throw 'Select Agent, Workspace, or Both. Nothing was changed.' }
    $labelText = $Label.Trim()
    if (-not $labelText) { throw 'Enter a nonblank label. Nothing was changed.' }
    # Never fall back to caller IDs, --current, or UI-focused defaults in a popup.
    $paneId = $env:HERDR_ACTIVE_PANE_ID
    $workspaceId = $env:HERDR_ACTIVE_WORKSPACE_ID
    $oldAgent = $null
    $oldWorkspace = $null
    $base = ''
    $names = @()

    # Finish all read-only checks before either mutation.
    if ($Agent) {
        if (-not $paneId) { throw 'No underlying HERDR_ACTIVE_PANE_ID. Nothing was changed.' }
        $base = ConvertTo-AgentName $labelText
        if (-not $base) { throw 'The agent label needs at least one ASCII letter or number. Nothing was changed.' }
        $oldAgent = (Invoke-HerdrCommand @('agent', 'get', $paneId)).agent
        if (-not $oldAgent -or $oldAgent.pane_id -ne $paneId) { throw 'Herdr did not return the underlying agent. Nothing was changed.' }
        $inventory = Invoke-HerdrCommand @('agent', 'list')
        if ($null -eq $inventory.agents) { throw 'Herdr did not return an agent inventory. Nothing was changed.' }
        $names = @($inventory.agents | Where-Object { $_.pane_id -ne $paneId -and $_.name } | ForEach-Object { $_.name })
    }
    if ($Workspace) {
        if (-not $workspaceId) { throw 'No underlying HERDR_ACTIVE_WORKSPACE_ID. Nothing was changed.' }
        $oldWorkspace = (Invoke-HerdrCommand @('workspace', 'get', $workspaceId)).workspace
        if (-not $oldWorkspace -or $oldWorkspace.workspace_id -ne $workspaceId -or $null -eq $oldWorkspace.label) {
            throw 'Herdr did not return the underlying workspace label. Nothing was changed.'
        }
        if ($Agent -and $oldAgent.workspace_id -ne $workspaceId) { throw 'Popup agent/workspace IDs disagree. Nothing was changed.' }
    }

    $agentAttempted = $false
    $workspaceAttempted = $false
    $agentName = ''
    try {
        if ($Agent) {
            # Skip known collisions, and retry only the structured collision error
            # if another caller claims a name after our read-only inventory.
            for ($n = 1; $n -le 20; $n++) {
                $suffix = if ($n -eq 1) { '' } else { "-$n" }
                $stemLength = [Math]::Min(32 - $suffix.Length, $base.Length)
                $candidate = $base.Substring(0, $stemLength).TrimEnd('-', '_') + $suffix
                if ($names -contains $candidate) { continue }
                $agentAttempted = $true
                try {
                    $null = Invoke-HerdrCommand @('agent', 'rename', $paneId, $candidate)
                    $agentName = $candidate
                    break
                } catch {
                    if ($_.Exception.Data['HerdrCode'] -ne 'agent_name_taken') { throw }
                }
            }
            if (-not $agentName) { throw 'No unique agent name available after 20 candidates.' }
        }
        if ($Workspace) {
            $workspaceAttempted = $true
            $null = Invoke-HerdrCommand @('workspace', 'rename', $workspaceId, $labelText)
        }
    } catch {
        $failure = $_.Exception.Message
        if ($Agent -and $Workspace -and ($agentAttempted -or $workspaceAttempted)) {
            # CLI has no atomic two-entity rename. Compensate every attempted
            # write, including an ambiguous failure (e.g. malformed response).
            $rollbackErrors = @()
            if ($workspaceAttempted) {
                try { $null = Invoke-HerdrCommand @('workspace', 'rename', $workspaceId, [string]$oldWorkspace.label) }
                catch { $rollbackErrors += "Workspace: $($_.Exception.Message)" }
            }
            if ($agentAttempted) {
                $restoreName = if ($oldAgent.name) { [string]$oldAgent.name } else { '--clear' }
                try { $null = Invoke-HerdrCommand @('agent', 'rename', $paneId, $restoreName) }
                catch { $rollbackErrors += "Agent: $($_.Exception.Message)" }
            }
            if ($rollbackErrors.Count) {
                throw "Both rename failed: $failure`nROLLBACK INCOMPLETE; partial changes may remain. Check pane $paneId and workspace $workspaceId.`n$($rollbackErrors -join "`n")"
            }
            throw "Both rename failed; original values restored: $failure"
        }
        throw "Rename failed (no success reported): $failure"
    }
    # Publish success only after every selected write succeeds.
    return [pscustomobject]@{ Agent = $Agent; Workspace = $Workspace; AgentName = $agentName; WorkspaceLabel = $labelText }
}

function Read-RenameKey { return [Console]::ReadKey($true) }

function Show-RenameDialog($State, [string]$Phase, [string]$Label, [string]$Message) {
    Clear-Host
    Write-Host 'Rename active context'
    $checked = @($State.Agent, $State.Workspace, ($State.Agent -and $State.Workspace))
    $rows = @('Agent', 'Workspace', 'Both')
    for ($i = 0; $i -lt 3; $i++) {
        $cursor = if ($Phase -eq 'select' -and $State.Focus -eq $i) { '>' } else { ' ' }
        $mark = if ($checked[$i]) { 'x' } else { ' ' }
        Write-Host "$cursor [$mark] $($rows[$i])"
    }
    Write-Host 'Space toggles; Up/Down/Tab moves; Esc cancels.'
    if ($Phase -eq 'select') {
        Write-Host 'Enter: next, then type a label and Enter to apply.'
    } else {
        Write-Host 'Agent name is normalized; workspace keeps the label.'
        Write-Host "Label: $Label"
        Write-Host 'Enter: apply; Backspace: edit; Esc: cancel.'
    }
    if ($Message) { Write-Host $Message -ForegroundColor Yellow }
}

function Read-RenameRequest {
    $state = [pscustomobject]@{ Agent = $false; Workspace = $false; Focus = 0 }
    $phase = 'select'
    $label = ''
    $message = ''
    while ($true) {
        Show-RenameDialog $state $phase $label $message
        $key = Read-RenameKey
        $message = ''
        if ($key.Key -eq [ConsoleKey]::Escape) { return $null }
        if ($phase -eq 'select') {
            switch ($key.Key) {
                'UpArrow' { $state.Focus = ($state.Focus + 2) % 3 }
                'DownArrow' { $state.Focus = ($state.Focus + 1) % 3 }
                'Tab' {
                    $step = if ($key.Modifiers -band [ConsoleModifiers]::Shift) { 2 } else { 1 }
                    $state.Focus = ($state.Focus + $step) % 3
                }
                'Spacebar' {
                    switch ($state.Focus) {
                        0 { $state.Agent = -not $state.Agent }
                        1 { $state.Workspace = -not $state.Workspace }
                        2 {
                            $both = -not ($state.Agent -and $state.Workspace)
                            $state.Agent = $both
                            $state.Workspace = $both
                        }
                    }
                }
                'Enter' {
                    if ($state.Agent -or $state.Workspace) { $phase = 'label' }
                    else { $message = 'Select at least one checkbox. Nothing was changed.' }
                }
            }
        } else {
            if ($key.Key -eq [ConsoleKey]::Enter) {
                if (-not $label.Trim()) { $message = 'Enter a nonblank label.'; continue }
                if ($state.Agent -and -not (ConvertTo-AgentName $label)) {
                    $message = 'Agent label needs an ASCII letter or number.'
                    continue
                }
                return [pscustomobject]@{ Agent = $state.Agent; Workspace = $state.Workspace; Label = $label }
            }
            if ($key.Key -eq [ConsoleKey]::Backspace) {
                if ($label.Length) { $label = $label.Substring(0, $label.Length - 1) }
            } elseif (-not [char]::IsControl($key.KeyChar)) {
                $label += $key.KeyChar
            }
        }
    }
}

# Dot sourcing exposes the small testable functions without opening a popup.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        $request = Read-RenameRequest
        if ($null -eq $request) { exit 0 }
        $result = Rename-HerdrContext -Agent $request.Agent -Workspace $request.Workspace -Label $request.Label
        if ($result.Agent) { Write-Host "Agent renamed to $($result.AgentName)" -ForegroundColor Green }
        if ($result.Workspace) { Write-Host "Workspace renamed to $($result.WorkspaceLabel)" -ForegroundColor Green }
        Start-Sleep -Milliseconds 700
        exit 0
    } catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
        Write-Host 'Press Enter or Esc to close.'
        try {
            do { $key = Read-RenameKey } while ($key.Key -notin @([ConsoleKey]::Enter, [ConsoleKey]::Escape))
        } catch { }
        exit 1
    }
}
