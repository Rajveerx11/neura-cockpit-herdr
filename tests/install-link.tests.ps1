# Windows PowerShell 5.1. Run the real installer against an owned strict CLI stub.
$ErrorActionPreference = 'Stop'
$installer = Join-Path (Split-Path $PSScriptRoot -Parent) 'install.ps1'
$root = Join-Path ([IO.Path]::GetTempPath()) ('cockpit-link-test-' + [guid]::NewGuid())
$null = New-Item -ItemType Directory -Path $root
$names = @('APPDATA','LOCALAPPDATA','HERDR_ENV','HERDR_BIN_PATH','HERDR_CONFIG_PATH',
    'COCKPIT_LINK_TEST_LOG','COCKPIT_LINK_TEST_VERSION','COCKPIT_LINK_TEST_FAIL')
$saved = @{}
foreach ($name in $names) { $saved[$name] = [Environment]::GetEnvironmentVariable($name) }
function Assert($Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Run-Installer([string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    $text = & powershell.exe -NoProfile -File $installer @Arguments 2>&1
    return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($text -join "`n") }
}
try {
    $env:APPDATA = Join-Path $root 'appdata'
    $env:LOCALAPPDATA = Join-Path $root 'localappdata'
    $env:HERDR_ENV = '1'
    $env:HERDR_CONFIG_PATH = $null
    $env:COCKPIT_LINK_TEST_LOG = Join-Path $root 'calls.jsonl'
    $env:COCKPIT_LINK_TEST_VERSION = 'herdr 0.9.5'
    $env:COCKPIT_LINK_TEST_FAIL = $null
    $env:HERDR_BIN_PATH = Join-Path $root 'fake herdr.ps1'
    @'
$global:LASTEXITCODE = 0
Add-Content -LiteralPath $env:COCKPIT_LINK_TEST_LOG -Value (ConvertTo-Json -InputObject @($args) -Compress)
if (($args -join '|') -eq '--version') { Write-Output $env:COCKPIT_LINK_TEST_VERSION; return }
if (($args -join '|') -eq 'plugin|list|--json') { Write-Output '{"result":{"plugins":[]}}'; return }
if (($args -join '|') -eq 'config|check' -and (Test-Path -LiteralPath $env:HERDR_CONFIG_PATH)) { return }
# Official 0.9.5 consumes args.first() as the path. Only documented path-first linking is allowed here.
if ($args.Count -eq 3 -and $args[0] -eq 'plugin' -and $args[1] -eq 'link' -and
    (Test-Path -LiteralPath (Join-Path $args[2] 'herdr-plugin.toml') -PathType Leaf)) {
    if ((Split-Path $args[2] -Leaf) -ne $env:COCKPIT_LINK_TEST_FAIL) { Write-Output '{"result":{"type":"plugin"}}'; return }
}
$global:LASTEXITCODE = 2
Write-Output '{"error":{"code":"strict_mock_refusal"}}'
'@ | Set-Content -LiteralPath $env:HERDR_BIN_PATH -Encoding UTF8
    $destination = Join-Path $root 'stage with spaces'
    $run = Run-Installer @('-Destination',$destination,'-CompactRows')
    Assert ($run.Code -eq 0) ('Installer failed: ' + $run.Text)
    foreach ($helper in @('rename-context.ps1','cockpit-status.ps1','cockpit-identity.ps1','spawn-agent.mjs','workspace-preset.mjs','workspace-notes.mjs')) {
        $source = Join-Path (Split-Path $PSScriptRoot -Parent) "tools\$helper"
        $installed = Join-Path $destination "tools\$helper"
        Assert (Test-Path -LiteralPath $installed -PathType Leaf) ("Missing staged helper: $helper")
        Assert ((Get-FileHash -LiteralPath $source).Hash -ceq (Get-FileHash -LiteralPath $installed).Hash) ("Staged helper differs: $helper")
    }
    $calls = @([IO.File]::ReadAllLines($env:COCKPIT_LINK_TEST_LOG) | ForEach-Object { ,($_ | ConvertFrom-Json) })
    $links = @($calls | Where-Object { $_[0] -eq 'plugin' -and $_[1] -eq 'link' })
    Assert ($links.Count -eq 2) 'Expected two native plugin links'
    for ($i = 0; $i -lt 2; $i++) {
        $plugin = @('neura-branding','neura-usage')[$i]
        Assert ($links[$i].Count -eq 3 -and $links[$i][2] -ceq (Join-Path $destination "local-plugins\$plugin")) 'Plugin path was not the first link argument'
    }
    Write-Output 'PASS: real non-staging installer links both plugins with path-first arguments in an isolated root.'
    $env:COCKPIT_LINK_TEST_FAIL = 'neura-usage'
    $failedDestination = Join-Path $root 'failed link'
    $run = Run-Installer @('-Destination',$failedDestination)
    Assert ($run.Code -ne 0) 'Failed plugin link was reported as success'
    Assert ($run.Text -match 'Plugin linking failed') 'Missing explicit link failure'
    Assert ($run.Text -notmatch 'NEURA COCKPIT staged at') 'Success banner followed a link failure'
    Write-Output 'PASS: second-plugin failure is explicit and never reports installation success.'
    $env:COCKPIT_LINK_TEST_FAIL = $null
    foreach ($version in @('herdr 0.9.3','herdr 0.9.4','herdr 0.9.6','herdr 0.9.5-preview')) {
        $env:COCKPIT_LINK_TEST_VERSION = $version
        $refusedDestination = Join-Path $root ([guid]::NewGuid().ToString())
        $run = Run-Installer @('-StageOnly','-Destination',$refusedDestination)
        Assert ($run.Code -ne 0) ("Unexpected version accepted: $version")
        Assert (-not (Test-Path -LiteralPath $refusedDestination)) 'Unsupported version touched the destination'
        Write-Output "PASS: $version refused before destination writes."
    }
    Write-Output 'PASS: 6 cases. Fake CLI only; no live configuration, plugin registry, or endpoint used.'
} finally {
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $saved[$name]) }
    # This directory was created exclusively by this test, never supplied by a caller.
    Remove-Item -LiteralPath $root -Recurse -Force
}
