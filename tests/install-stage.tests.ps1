# Windows PowerShell 5.1; staging only, no plugin linking or binary replacement.
$ErrorActionPreference = 'Stop'
$installer = Join-Path (Split-Path $PSScriptRoot -Parent) 'install.ps1'
$live = Join-Path $env:APPDATA 'herdr\config.toml'
$original = (Get-FileHash -LiteralPath $live).Hash
$destination = Join-Path ([IO.Path]::GetTempPath()) ('cockpit-test-' + [guid]::NewGuid())
function Assert($Value, [string]$Message) { if (-not $Value) { throw $Message } }
function Run-Installer([string[]]$Arguments, [int]$Code = 0) {
    $ErrorActionPreference = 'Continue'
    $output = & powershell.exe -NoProfile -File $installer @Arguments 2>&1
    $actual = $LASTEXITCODE
    Assert ($actual -eq $Code) ("Installer exit $actual instead of $Code`: " + ($output -join "`n"))
    return ($output -join "`n")
}
$tokens = $null; $errors = $null
$null = [Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
Assert (-not $errors.Count) 'Installer syntax errors'
$null = Run-Installer @('-StageOnly','-Destination',$destination)
$config = Join-Path $destination 'config.toml'
Assert (Test-Path -LiteralPath $config) 'No staged configuration'
Assert (Test-Path -LiteralPath (Join-Path $destination 'tools\cockpit-status.ps1')) 'No staged context panel'
Assert (Test-Path -LiteralPath (Join-Path $destination 'local-plugins\neura-usage\usage-report.mjs')) 'No staged usage plugin'
Assert (Test-Path -LiteralPath (Join-Path $destination 'agent-detection\codex.toml')) 'No staged detector'
Assert (-not ([IO.File]::ReadAllText($config) -match '@HERDR_CONFIG_DIR@|@LEAF_EXE@')) 'Unexpanded installation placeholders'
$staged = (Get-FileHash -LiteralPath $config).Hash
$null = Run-Installer @('-StageOnly','-Destination',$destination)
$backups = @(Get-ChildItem -LiteralPath $destination -Filter 'config.toml.before-*')
Assert ($backups.Count -eq 1) 'Expected exactly one config backup after second stage'
Assert ((Get-FileHash -LiteralPath $backups[0].FullName).Hash -eq $staged) 'Backup did not preserve the original staged configuration'
$errorText = Run-Installer @('-StageOnly','-Destination',(Join-Path $env:APPDATA 'herdr')) -Code 1
Assert ($errorText -match 'StageOnly must use a separate directory') 'Live destination was not refused'
Assert ((Get-FileHash -LiteralPath $live).Hash -eq $original) 'Live configuration changed'
Write-Host 'PASS: installer parsed; isolated staging, placeholder expansion, backups, and live-destination refusal verified. No live config replacement or plugin linking.'
Write-Host "Owned staging artifacts retained at $destination"
