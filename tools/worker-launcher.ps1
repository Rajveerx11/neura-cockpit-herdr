param([switch]$Popup)

# Terminal-only, opt-in frontend to the existing guarded helper (Herdr 0.9.5).
# Do not remap popup/focused IDs into the manager's inherited caller context.
$script:workerSpawnPath = Join-Path $PSScriptRoot 'spawn-agent.mjs'

function Get-WorkerLauncherKinds {
    return 'pi claude codex gemini cursor devin agy cline omp mastracode opencode copilot kimi kiro droid amp grok hermes kilo qodercli qwen letta maki muse'.Split(' ')
}

function Assert-WorkerLauncherContext([bool]$FromPopup) {
    if ($FromPopup) { throw 'Popup manager identity is unverified. Invoke worker-launcher.ps1 manually in the intended manager terminal.' }
    foreach ($key in @('HERDR_ACTIVE_PANE_ID', 'HERDR_ACTIVE_WORKSPACE_ID', 'HERDR_ACTIVE_TAB_ID', 'HERDR_ACTIVE_PANE_CWD')) {
        if ([Environment]::GetEnvironmentVariable($key)) {
            throw 'Popup/active context is not authoritative manager context. Invoke manually in the intended manager terminal; do not copy or unset IDs to bypass this check.'
        }
    }
    if ($env:HERDR_ENV -cne '1') { throw 'Not inside Herdr (HERDR_ENV must be 1). Nothing was created.' }
    foreach ($key in @('HERDR_WORKSPACE_ID', 'HERDR_TAB_ID', 'HERDR_PANE_ID')) {
        $value = [Environment]::GetEnvironmentVariable($key)
        if (-not $value -or $value -cnotmatch '\A[a-zA-Z0-9:_-]+\z') {
            throw "Missing/invalid injected $key. Never using UI focus or popup IDs as manager."
        }
    }
    if (-not $env:HERDR_BIN_PATH -or $env:HERDR_BIN_PATH -match '[\x00-\x1f\x7f]' -or
        $env:HERDR_BIN_PATH -notmatch '\A(?:[a-z]:[\\/]|\\\\[^\\/?.]+\\[^\\/]+(?:\\|$))' -or
        $env:HERDR_BIN_PATH -notmatch '\.exe\z') {
        throw 'HERDR_BIN_PATH must identify the injected Windows Herdr binary.'
    }
    if (-not (Test-Path -LiteralPath $script:workerSpawnPath -PathType Leaf)) {
        throw 'Keep worker-launcher.ps1 beside the existing spawn-agent.mjs. Nothing was created.'
    }
    # The helper, not this UI, validates API parent identity, version, cwd,
    # geometry and live unique names immediately before its guarded split.
}

function Read-WorkerLauncherValue([string]$Prompt) { return Read-Host $Prompt }

function Invoke-WorkerLauncherNode([string[]]$Arguments) {
    # Resolve a native executable, not shell text. No cmd, Invoke-Expression,
    # task arguments, raw terminal input, fallback, or second invocation.
    $node = (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source
    $ErrorActionPreference = 'Continue'
    $global:LASTEXITCODE = 0
    $output = & $node @Arguments 2>&1
    $code = $global:LASTEXITCODE
    return [pscustomobject]@{
        ExitCode = $code
        Text = (($output | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine).Trim()
    }
}

function Invoke-WorkerLauncher([bool]$FromPopup = $false) {
    Assert-WorkerLauncherContext $FromPopup
    $context = @{}
    foreach ($key in @('HERDR_ENV', 'HERDR_BIN_PATH', 'HERDR_WORKSPACE_ID', 'HERDR_TAB_ID', 'HERDR_PANE_ID')) {
        $context[$key] = [Environment]::GetEnvironmentVariable($key)
    }
    $kinds = @(Get-WorkerLauncherKinds)
    $kind = Read-WorkerLauncherValue "Worker kind [$($kinds -join ', ')] (blank/Ctrl+C cancels)"
    if ([string]::IsNullOrWhiteSpace($kind)) { return $null }
    if ($kinds -cnotcontains $kind) { throw 'Unsupported worker kind; use an exact listed kind. Nothing was created.' }
    $name = Read-WorkerLauncherValue 'Unique worker name [a-z][a-z0-9_-]{0,31} (blank/Ctrl+C cancels)'
    if ([string]::IsNullOrWhiteSpace($name)) { return $null }
    if ($name -cnotmatch '\A[a-z][a-z0-9_-]{0,31}\z') { throw 'Invalid worker name. Nothing was created.' }
    # Check again after interactive input; never repair or substitute context.
    Assert-WorkerLauncherContext $FromPopup
    foreach ($key in $context.Keys) {
        if ([Environment]::GetEnvironmentVariable($key) -cne $context[$key]) {
            throw 'Manager context changed during input. Nothing was created; invoke manually in the intended manager terminal.'
        }
    }
    try {
        $native = Invoke-WorkerLauncherNode @($script:workerSpawnPath, '--kind', $kind, '--name', $name)
    } catch {
        throw "Guarded invocation failed; outcome may be ambiguous. Inspect manager layout before retrying. No automatic retry or cleanup: $($_.Exception.Message)"
    }
    if ($native.ExitCode -ne 0) {
        # Preserve the helper's pane_id/cleanup/startup error verbatim. It may
        # have retained a pane even though no successful startup was reported.
        throw "Guarded helper failed (exit $($native.ExitCode)): $($native.Text)`nInspect manager layout and any retained pane before retrying. No automatic retry, prompt, approval response or cleanup was attempted by this launcher."
    }
    $reply = $null
    try { $reply = $native.Text | ConvertFrom-Json -ErrorAction Stop } catch { }
    if ($null -eq $reply -or $reply.error -or $reply.ready -isnot [bool] -or -not $reply.ready -or
        $reply.prompt_submitted -isnot [bool] -or $reply.prompt_submitted -or
        $reply.turn_activity_verified -isnot [bool] -or $reply.turn_activity_verified -or
        $reply.focus -isnot [bool] -or $reply.focus -or $reply.direction -cne 'right' -or
        $reply.parent_pane_id -cne $env:HERDR_PANE_ID -or $reply.workspace_id -cne $env:HERDR_WORKSPACE_ID -or
        $reply.tab_id -cne $env:HERDR_TAB_ID -or $reply.kind -cne $kind -or $reply.name -cne $name -or
        $reply.pane_id -isnot [string] -or $reply.pane_id -cnotmatch '\A[a-zA-Z0-9:_-]+\z' -or
        $reply.pane_id -ceq $reply.parent_pane_id) {
        throw "Guarded helper response did not prove startup; outcome may be ambiguous. Inspect manager layout before retrying. No retry or cleanup attempted. Helper output: $($native.Text)"
    }
    return $reply
}

# Dot-source for deterministic tests or explicit session-local function setup.
if ($MyInvocation.InvocationName -ne '.') {
    try {
        $result = Invoke-WorkerLauncher -FromPopup $Popup.IsPresent
        if ($null -eq $result) { Write-Host 'Cancelled. Nothing was created.'; exit 0 }
        Write-Host "Worker '$($result.name)' ready in $($result.pane_id). No task submitted or activity/completion verified."
        exit 0
    } catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}
