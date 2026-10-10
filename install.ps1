param(
    [string]$Destination = (Join-Path $env:APPDATA 'herdr'),
    [switch]$StageOnly
)
$ErrorActionPreference = 'Stop'
if ($StageOnly -and -not $PSBoundParameters.ContainsKey('Destination')) {
    $Destination = Join-Path ([IO.Path]::GetTempPath()) ('cockpit-stage-' + [guid]::NewGuid())
}
$root = [IO.Path]::GetFullPath($Destination)
$liveRoot = [IO.Path]::GetFullPath((Join-Path $env:APPDATA 'herdr'))
if ($StageOnly -and $root.TrimEnd('\').Equals($liveRoot.TrimEnd('\'), [StringComparison]::OrdinalIgnoreCase)) {
    throw 'StageOnly must use a separate directory, not the live Herdr config directory.'
}
$binary = $env:HERDR_BIN_PATH
if (-not $binary -or -not [IO.Path]::IsPathRooted($binary) -or -not (Test-Path -LiteralPath $binary -PathType Leaf)) {
    $binary = (Get-Command herdr.exe -CommandType Application -ErrorAction Stop).Path
}
$version = & $binary --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^herdr 0\.9\.3\b') { throw 'This profile is validated for Herdr 0.9.3; use StageOnly only with that version too.' }
if (-not $StageOnly) {
    if ($env:HERDR_ENV -ne '1') { throw 'Run installation inside Herdr, or use -StageOnly for an offline preview.' }
    $text = & $binary plugin list --json
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the installed plugin registry.' }
    $reply = ($text -join "`n") | ConvertFrom-Json
    if ($reply.error -or $null -eq $reply.result.plugins) { throw 'Invalid plugin inventory.' }
    if (@($reply.result.plugins | Where-Object { $_.plugin_id -in @('neura.branding','neura.usage') }).Count) {
        throw 'A Neura plugin already exists. Use -StageOnly and review/merge it instead of replacing its source.'
    }
}
$leaf = Join-Path $env:LOCALAPPDATA 'Programs\leaf\leaf.exe'
if (-not (Test-Path -LiteralPath $leaf)) {
    $command = Get-Command leaf.exe -CommandType Application -ErrorAction SilentlyContinue
    $leaf = if ($command) { $command.Path } else { 'leaf.exe' }
}
$template = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'config.windows.toml'))
$config = $template.Replace('@HERDR_CONFIG_DIR@', $root.Replace('\','/')).Replace('@LEAF_EXE@', $leaf.Replace('\','/').Replace("'", "''"))
# Validate offline before touching the destination or registry. Do not reload a live client.
$temp = Join-Path ([IO.Path]::GetTempPath()) ('cockpit-config-' + [guid]::NewGuid() + '.toml')
$oldConfig = $env:HERDR_CONFIG_PATH
try {
    [IO.File]::WriteAllText($temp, $config, [Text.UTF8Encoding]::new($false))
    $env:HERDR_CONFIG_PATH = $temp
    & $binary config check
    if ($LASTEXITCODE -ne 0) { throw 'Generated configuration failed validation; nothing installed.' }
} finally {
    $env:HERDR_CONFIG_PATH = $oldConfig
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp }
}
$stamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fffffff')
function Save-CockpitFile([string]$Source, [string]$Relative) {
    $target = Join-Path $root $Relative
    $null = New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent)
    if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination ($target + '.before-' + $stamp) }
    Copy-Item -LiteralPath $Source -Destination $target
}
foreach ($name in @('rename-context.ps1','cockpit-status.ps1','spawn-agent.mjs')) {
    Save-CockpitFile (Join-Path $PSScriptRoot "tools\$name") "tools\$name"
}
Save-CockpitFile (Join-Path $PSScriptRoot 'agent-detection\codex.toml') 'agent-detection\codex.toml'
foreach ($plugin in @('neura-branding','neura-usage')) {
    foreach ($file in Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot "plugins\$plugin") -File) {
        Save-CockpitFile $file.FullName "local-plugins\$plugin\$($file.Name)"
    }
}
$targetConfig = Join-Path $root 'config.toml'
if (Test-Path -LiteralPath $targetConfig) { Copy-Item -LiteralPath $targetConfig -Destination ($targetConfig + '.before-' + $stamp) }
[IO.File]::WriteAllText($targetConfig, $config, [Text.UTF8Encoding]::new($false))
if (-not $StageOnly) {
    foreach ($plugin in @('neura-branding','neura-usage')) {
        & $binary plugin link --enabled (Join-Path $root "local-plugins\$plugin")
        if ($LASTEXITCODE -ne 0) { throw 'Plugin linking failed; files are staged and backed up. No success is reported. Inspect the registry before retrying.' }
    }
}
Write-Host ("NEURA COCKPIT staged at $root")
Write-Host 'Existing destination files have timestamped backups. No terminal binary, SSH profile, or existing session was replaced.'
if (-not $StageOnly) { Write-Host 'Press Ctrl+Shift+R in the client; then run herdr server reload-agent-manifests.' }
exit 0
