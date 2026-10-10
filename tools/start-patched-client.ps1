param(
    [Parameter(Mandatory = $true)][string]$ClientPath,
    [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $ClientPath -PathType Leaf)) { throw 'Specify an existing, reviewed patched client executable.' }
$exe = (Resolve-Path -LiteralPath $ClientPath).Path
$config = Join-Path $env:APPDATA 'herdr\config.toml'
if (!(Test-Path -LiteralPath $config -PathType Leaf)) { throw 'Existing live configuration required.' }
# This child client must not inherit an agent identity, test root, or remote socket.
Get-ChildItem Env:HERDR_* | Remove-Item
Remove-Item Env:XDG_CONFIG_HOME, Env:XDG_STATE_HOME -ErrorAction SilentlyContinue
$env:HERDR_CONFIG_PATH = $config
$env:HERDR_SOCKET_PATH = Join-Path $env:APPDATA 'herdr\herdr.sock'
$status = (& $exe status | Out-String)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect existing main server.' }
if ($status -notmatch '(?ms)server:\s*\r?\n\s*status:\s*running' -or $status -notmatch 'endpoint_compatible:\s*yes') {
    throw 'Compatible already-running main server required; refusing to start or replace one.'
}
& $exe config check
if ($LASTEXITCODE -ne 0) { throw 'Live configuration validation failed.' }
if ($CheckOnly) {
    Write-Output $status
    exit 0
}
# Attach only. Never stop a server, replace an executable, or close the old client.
& $exe
exit $LASTEXITCODE
