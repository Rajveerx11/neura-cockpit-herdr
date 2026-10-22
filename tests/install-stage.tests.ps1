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
foreach ($helper in @('rename-context.ps1','cockpit-status.ps1','cockpit-identity.ps1','spawn-agent.mjs','workspace-preset.mjs','workspace-notes.mjs')) {
    Assert (Test-Path -LiteralPath (Join-Path $destination "tools\$helper")) ("No staged helper: $helper")
}
Assert (Test-Path -LiteralPath (Join-Path $destination 'local-plugins\neura-usage\usage-report.mjs')) 'No staged usage plugin'
Assert (Test-Path -LiteralPath (Join-Path $destination 'agent-detection\codex.toml')) 'No staged detector'
Assert (-not ([IO.File]::ReadAllText($config) -match '@HERDR_CONFIG_DIR@|@LEAF_EXE@')) 'Unexpanded installation placeholders'
$staged = (Get-FileHash -LiteralPath $config).Hash
$null = Run-Installer @('-StageOnly','-Destination',$destination)
$backups = @(Get-ChildItem -LiteralPath $destination -Filter 'config.toml.before-*')
Assert ($backups.Count -eq 1) 'Expected exactly one config backup after second stage'
Assert ((Get-FileHash -LiteralPath $backups[0].FullName).Hash -eq $staged) 'Backup did not preserve the original staged configuration'
# The optional layout must remove every per-agent override, not just the default.
$defaultText = [IO.File]::ReadAllText($config)
$null = Run-Installer @('-StageOnly','-CompactRows','-Destination',$destination)
$compactText = [IO.File]::ReadAllText($config)
$agentLayout = [regex]::Match($compactText, '(?ms)^\[ui\.sidebar\.agents\]\r?\n(.*?)(?=^\[ui\.sidebar\.spaces\])').Groups[1].Value
Assert ($agentLayout -ne '') 'No compact agent section'
Assert (-not ($agentLayout -match 'rows_by_agent|\$mode|\$phase|\$usage')) 'Detailed rows still override compact rows'
Assert (([regex]::Matches($agentLayout, '(?m)^  \[')).Count -eq 2) 'Compact layout must contain exactly two rows'
foreach ($nativeToken in @('state_icon','state_text','agent','workspace','machine','$herdr_brand_icon')) {
    Assert ($agentLayout.Contains('"' + $nativeToken + '"')) ("Missing compact token: $nativeToken")
}
foreach ($state in @('blocked','working','done','idle')) {
    Assert ($agentLayout.Contains('equals = "' + $state + '"')) ("Missing native state style: $state")
}
# Everything outside the agent section, including F4 and workspace aggregates, is unchanged.
$sectionPattern = '(?ms)^(?:# Optional Herdr 0\.9\.5 agent layout\..*?\n)?\[ui\.sidebar\.agents\]\r?\n.*?(?=^\[ui\.sidebar\.spaces\])'
$defaultRemainder = [regex]::Replace($defaultText, $sectionPattern, '')
$compactRemainder = [regex]::Replace($compactText, $sectionPattern, '')
Assert ($defaultRemainder -eq $compactRemainder) 'Compact option changed unrelated configuration'
# Staging without the flag restores the default layout and keeps the compact backup.
$null = Run-Installer @('-StageOnly','-Destination',$destination)
Assert ([IO.File]::ReadAllText($config) -eq $defaultText) 'Default layout changed after compact staging'
$errorText = Run-Installer @('-StageOnly','-Destination',(Join-Path $env:APPDATA 'herdr')) -Code 1
Assert ($errorText -match 'StageOnly must use a separate directory') 'Live destination was not refused'
Assert ((Get-FileHash -LiteralPath $live).Hash -eq $original) 'Live configuration changed'
Write-Host 'PASS: installer parsed; default/compact staging, native config validation, placeholders, backups, rollback, and live-destination refusal verified. No live config replacement or plugin linking.'
Write-Host "Owned staging artifacts retained at $destination"
