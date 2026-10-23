param([string]$Binary = $env:HERDR_BIN_PATH)
# Windows PowerShell 5.1. Dot sourcing defines functions without running a probe.
function Get-CockpitIntegrationTargets {
    # Targets exposed by the inspected Herdr 0.9.5 CLI. Missing rows are not absence evidence.
    return @('pi', 'omp', 'claude', 'codex', 'copilot', 'devin', 'droid', 'kimi',
        'opencode', 'kilo', 'hermes', 'qodercli', 'qwen', 'cursor', 'mastracode',
        'antigravity-cli', 'grok', 'letta')
}

function Invoke-CockpitIntegrationsNative([string]$Binary) {
    $ErrorActionPreference = 'Stop'
    $process = New-Object System.Diagnostics.Process
    try {
        $process.StartInfo.FileName = $Binary
        # Fixed arguments: no installer, socket API, shell, or caller-supplied command.
        $process.StartInfo.Arguments = 'integration status'
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        $process.StartInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false, $true)
        $process.StartInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false, $true)
        if (-not $process.Start()) { throw 'CLI could not start.' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(3000)) {
            # Only terminate this read-only child probe, never a server or agent.
            $process.Kill()
            $null = $process.WaitForExit(1000)
            throw 'CLI probe timed out.'
        }
        if ($process.ExitCode -ne 0 -or -not $stdout.Wait(1000) -or -not $stderr.Wait(1000)) {
            throw 'CLI probe failed.'
        }
        return $stdout.Result
    } finally {
        $process.Dispose()
    }
}

function ConvertFrom-CockpitIntegrationsText([string]$Text) {
    $ErrorActionPreference = 'Stop'
    if ([string]::IsNullOrWhiteSpace($Text) -or $Text -match '[\x00-\x09\x0b\x0c\x0e-\x1f\x7f-\x9f]') {
        throw 'Empty or unsafe status output.'
    }
    $targets = @(Get-CockpitIntegrationTargets)
    $found = @{}
    $pattern = '\A(?<target>[a-z][a-z0-9-]*)(?<experimental> \(experimental\))?: (?<detail>current \((?:v[0-9]+|legacy)\)|outdated \((?:v[0-9]+|legacy) < v[0-9]+\)|needs repair \(v[0-9]+\)|not installed) \((?<path>[^\r\n]+)\)\z'
    foreach ($line in ($Text -split '\r?\n')) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $match = [regex]::Match($line, $pattern)
        if (-not $match.Success) { throw 'Unsupported status output.' }
        $target = $match.Groups['target'].Value
        if ($target -cnotin $targets -or $found.ContainsKey($target) -or
            ($match.Groups['experimental'].Success -and $target -cne 'letta')) {
            throw 'Unknown or duplicate integration target.'
        }
        $detail = $match.Groups['detail'].Value
        $state = if ($detail -ceq 'not installed') { 'not-installed' }
            elseif ($detail.StartsWith('current ')) { 'current' }
            else { 'outdated' } # Native needs repair is also non-current, not an instruction.
        # Discard the native path. Only allowlisted target/state/version text leaves the parser.
        $found[$target] = [pscustomobject]@{ Target = $target; State = $state; Detail = $detail }
    }
    if (-not $found.Count) { throw 'No status rows.' }
    foreach ($target in $targets) {
        if ($found.ContainsKey($target)) { $found[$target] }
        else { [pscustomobject]@{ Target = $target; State = 'unavailable'; Detail = 'not reported by native CLI' } }
    }
}

function Get-CockpitIntegrations([string]$Binary) {
    $ErrorActionPreference = 'Stop'
    $result = [pscustomobject]@{ Available = $false; Rows = @(); Message = '' }
    $result.Rows = @(foreach ($target in (Get-CockpitIntegrationTargets)) {
        [pscustomobject]@{ Target = $target; State = 'unavailable'; Detail = 'probe unavailable' }
    })
    # Like the identity helper: explicit trusted executable only, no PATH/alias fallback.
    if ([string]::IsNullOrWhiteSpace($Binary) -or $Binary -match '[\x00-\x1f\x7f-\x9f]' -or
        $Binary -notmatch '\A[A-Za-z]:[\\/]' -or $Binary -notmatch '\.exe\z') {
        $result.Message = 'CLI unavailable: supply a trusted absolute Windows .exe path with -Binary or HERDR_BIN_PATH. No PATH fallback.'
        return $result
    }
    try {
        $file = Get-Item -LiteralPath $Binary -ErrorAction Stop
        if ($file.PSIsContainer) { throw 'Executable missing.' }
        $text = Invoke-CockpitIntegrationsNative $file.FullName
    } catch {
        # Never echo raw errors, executable/home paths, or native stderr.
        $result.Message = 'CLI unavailable: executable missing, command failed, or probe timed out. Nothing changed.'
        return $result
    }
    try {
        $result.Rows = @(ConvertFrom-CockpitIntegrationsText $text)
        $result.Available = @($result.Rows | Where-Object { $_.State -eq 'unavailable' }).Count -eq 0
        if (-not $result.Available) { $result.Message = 'Incomplete native inventory: omitted targets are unavailable, not not-installed.' }
    } catch {
        $result.Message = 'Status unavailable: native output was empty, malformed, duplicated, or unsupported. Nothing changed.'
    }
    return $result
}

function Show-CockpitIntegrations([string]$Binary) {
    $result = Get-CockpitIntegrations $Binary
    Write-Output 'NEURA COCKPIT | INTEGRATION FRESHNESS (READ-ONLY)'
    Write-Output 'Invoked Windows CLI and inherited integration homes only; paths hidden.'
    foreach ($row in $result.Rows) {
        Write-Output ("{0}: {1} [{2}]" -f $row.Target, $row.State, $row.Detail)
    }
    if ($result.Message) { Write-Output $result.Message }
    Write-Output 'Installed files only. Running agent code, hook registration and live behavior remain unverified.'
    Write-Output 'No updates or restarts. See docs/integration-maintenance.md before any manual change.'
    if (-not $result.Available) { $global:LASTEXITCODE = 1 }
    else { $global:LASTEXITCODE = 0 }
}

if ($MyInvocation.InvocationName -ne '.') {
    Show-CockpitIntegrations $Binary
    exit $LASTEXITCODE
}
