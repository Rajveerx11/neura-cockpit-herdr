param([string]$Binary, [string]$EndpointSocket, [string]$ManifestPath, [string]$ManifestSha256)
# Windows PowerShell 5.1. Import only defines helpers; every probe requires an explicit call.
function Read-CockpitDoctorFile([string]$Path, [int]$MaxBytes, [switch]$HashOnly) {
    $ErrorActionPreference = 'Stop'
    if ($Path -notmatch '\A[A-Za-z]:[\\/]' -or $Path -match '[\x00-\x1f\x7f-\x9f]' -or
        $Path.Substring(2).Contains(':')) { throw 'Unsafe file path.' }
    $full = [IO.Path]::GetFullPath($Path)
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($full))
    if ($drive.DriveType -ne [IO.DriveType]::Fixed) { throw 'Local fixed disk required.' }
    # shortcut: ancestry checks assume stable directories; use handle-based checks for hostile concurrent replacement.
    $part = $full
    while ($part) {
        $item = Get-Item -LiteralPath $part -Force -ErrorAction Stop
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked path refused.' }
        $part = [IO.Path]::GetDirectoryName($part)
    }
    $stream = [IO.File]::Open($full, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        if ($stream.Length -gt $MaxBytes) { throw 'File exceeds limit.' }
        if ($HashOnly) {
            $sha = [Security.Cryptography.SHA256]::Create()
            try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
            finally { $sha.Dispose() }
        }
        $reader = [IO.BinaryReader]::new($stream)
        try { return ,$reader.ReadBytes([int]$stream.Length) } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
}

function Get-CockpitDoctorIntegrity([string]$ManifestPath, [string]$ManifestSha256) {
    $ErrorActionPreference = 'Stop'
    $result = [pscustomobject]@{ State = 'not requested'; Checked = 0; Mismatched = 0 }
    if (-not $ManifestPath -and -not $ManifestSha256) { return $result }
    $result.State = 'unavailable (invalid, unsafe, missing, or oversized evidence)'
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        if ($ManifestSha256 -notmatch '\A[0-9a-fA-F]{64}\z') { return $result }
        $bytes = Read-CockpitDoctorFile $ManifestPath 65536
        $actual = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '')
        if ($actual -ine $ManifestSha256) { $result.State = 'manifest hash mismatch'; return $result }
        $manifest = ConvertFrom-CockpitIdentityJson ([Text.UTF8Encoding]::new($false, $true).GetString($bytes))
        if ($manifest.Count -lt 1 -or $manifest.Count -gt 32) { throw 'Invalid manifest size.' }
        $directory = [IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($ManifestPath))
        $prefix = $directory.TrimEnd('\') + '\'
        $files = @()
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($name in $manifest.Keys) {
            # Narrow portable relative names exclude traversal, ADS, device paths and aliases.
            if ($name -cnotmatch '\A[A-Za-z0-9_-][A-Za-z0-9_. -]*(?:/[A-Za-z0-9_-][A-Za-z0-9_. -]*)*\z' -or
                $manifest[$name] -isnot [string] -or $manifest[$name] -notmatch '\A[0-9a-fA-F]{64}\z') {
                throw 'Invalid manifest entry.'
            }
            foreach ($segment in ($name -split '/')) {
                if ($segment -match '[. ]\z|\A(?:CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|\z)') { throw 'Unsafe file name.' }
            }
            $path = [IO.Path]::GetFullPath([IO.Path]::Combine($directory, $name.Replace('/', '\')))
            if (-not $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or -not $seen.Add($path)) {
                throw 'Path escapes manifest root or repeats.'
            }
            $files += [pscustomobject]@{ Path = $path; Hash = $manifest[$name] }
        }
        foreach ($file in $files) {
            $actual = Read-CockpitDoctorFile $file.Path 268435456 -HashOnly
            $result.Checked++
            if ($actual -ine $file.Hash) { $result.Mismatched++ }
        }
        $result.State = if ($result.Mismatched) { 'file hash mismatch' } else { 'matched supplied hashes' }
    } catch {
        # Never emit receipt contents, paths, native errors, or exception messages.
    } finally { $sha.Dispose() }
    return $result
}

function Get-CockpitDoctor {
    param([string]$Binary, [string]$EndpointSocket, [string]$ManifestPath, [string]$ManifestSha256)
    $ErrorActionPreference = 'Stop'
    . (Join-Path $PSScriptRoot 'cockpit-identity.ps1')
    . (Join-Path $PSScriptRoot 'cockpit-integrations.ps1') -Binary $Binary
    $oldBinary = $env:HERDR_BIN_PATH
    try {
        # Existing identity adapter accepts only this environment input; restore even on failure.
        $env:HERDR_BIN_PATH = $Binary
        $identity = Get-CockpitIdentity $EndpointSocket
    } finally { $env:HERDR_BIN_PATH = $oldBinary }
    $integrations = Get-CockpitIntegrations $Binary
    $integrity = Get-CockpitDoctorIntegrity $ManifestPath $ManifestSha256
    $compatibility = 'unknown'
    if ($identity.EndpointState -ceq 'connected (CLI probe only)' -and $identity.EndpointVersion -ne 'unknown') {
        $compatibility = 'observed 0.9.5 status contract; broader compatibility unverified'
    }
    $attention = $identity.CliVersion -eq 'unknown' -or $compatibility -eq 'unknown' -or
        -not $integrations.Available -or @($integrations.Rows | Where-Object State -eq 'outdated').Count -gt 0 -or
        $integrity.State -notin @('not requested', 'matched supplied hashes')
    [pscustomobject]@{
        CliVersion = $identity.CliVersion; CliSha256 = $identity.CliSha256
        EndpointState = $identity.EndpointState; ServerVersion = $identity.EndpointVersion
        ServerCompatibility = $compatibility; AttachedClient = 'unknown'; IdentityMessage = $identity.Message
        Integrations = $integrations; Integrity = $integrity; ExitCode = [int][bool]$attention
    }
}

function Show-CockpitDoctor {
    param([string]$Binary, [string]$EndpointSocket, [string]$ManifestPath, [string]$ManifestSha256)
    $result = Get-CockpitDoctor @PSBoundParameters
    Write-Output 'NEURA COCKPIT | DOCTOR (READ-ONLY SNAPSHOT)'
    Write-Output ('Invoked CLI build: ' + $result.CliVersion)
    Write-Output ('Invoked CLI SHA256: ' + $result.CliSha256)
    Write-Output 'CLI provenance: unknown; hashes do not establish official/custom origin.'
    Write-Output ('Explicit server endpoint (address hidden): ' + $result.EndpointState)
    Write-Output ('Server build: ' + $result.ServerVersion)
    Write-Output ('Server compatibility: ' + $result.ServerCompatibility)
    Write-Output 'Attached-client build, selected host and connection: unknown.'
    if ($result.IdentityMessage) { Write-Output $result.IdentityMessage }
    Write-Output 'Integration freshness: invoked CLI and inherited integration homes only; paths hidden.'
    foreach ($row in $result.Integrations.Rows) {
        Write-Output ('{0}: {1} [{2}]' -f $row.Target, $row.State, $row.Detail)
    }
    if ($result.Integrations.Message) { Write-Output $result.Integrations.Message }
    Write-Output ('Integrity: {0}; checked: {1}; mismatched: {2}.' -f $result.Integrity.State, $result.Integrity.Checked, $result.Integrity.Mismatched)
    Write-Output 'Running agent code, hook registration and live behavior remain unverified. No repairs or restarts.'
    $global:LASTEXITCODE = $result.ExitCode
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Show-CockpitDoctor @PSBoundParameters; exit $LASTEXITCODE }
    catch { Write-Output 'Doctor unavailable. Evidence could not be read; nothing changed.'; exit 1 }
}
