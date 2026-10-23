# Windows PowerShell 5.1. Native boundary mocked; fixture executable is inert text.
$ErrorActionPreference = 'Stop'
$target = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools/cockpit-integrations.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($target, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('cockpit-integrations-test-' + [guid]::NewGuid())
$null = [IO.Directory]::CreateDirectory($fixture)
$binary = Join-Path $fixture 'trusted herdr.exe'
[IO.File]::WriteAllText($binary, 'inert fixture; never execute')
$savedExit = $global:LASTEXITCODE
$passed = 0
function Assert($Condition, [string]$Message = 'Assertion failed') {
    if (-not $Condition) { throw $Message }
}
function Inventory {
    return ((Get-CockpitIntegrationTargets | ForEach-Object {
        $label = if ($_ -ceq 'letta') { 'letta (experimental)' } else { $_ }
        "${label}: not installed (C:\fixture private\hooks\state (copy).ps1)"
    }) -join "`r`n") + "`r`n"
}
function Reset-Mock {
    $global:CockpitIntegrationsTest = @{
        Text = Inventory; ExitCode = 0; Timeout = $false; StartFailure = $false
        Calls = [Collections.Generic.List[object]]::new(); Disposed = 0; Killed = 0
    }
}
function Case([string]$Name, [scriptblock]$Body) {
    Reset-Mock
    try { & $Body; $script:passed++; Write-Output "PASS $Name" }
    catch { throw "FAIL ${Name}: $($_.Exception.Message)" }
}
# Mock the actual process boundary, leaving decoding, parsing and entrypoint intact.
function New-Object([string]$TypeName) {
    Assert ($TypeName -ceq 'System.Diagnostics.Process') 'Unexpected native boundary'
    $process = [pscustomobject]@{
        StartInfo = [Diagnostics.ProcessStartInfo]::new(); ExitCode = 0
        StandardOutput = $null; StandardError = $null; Killed = $false
    }
    $process | Add-Member ScriptMethod Start {
        $s = $global:CockpitIntegrationsTest
        Assert ($this.StartInfo.Arguments -ceq 'integration status') 'Mutation or extra CLI command attempted'
        Assert ($this.StartInfo.FileName -ceq $script:binary) 'Unexpected executable'
        Assert (-not $this.StartInfo.UseShellExecute -and $this.StartInfo.CreateNoWindow)
        Assert ($this.StartInfo.RedirectStandardOutput -and $this.StartInfo.RedirectStandardError)
        Assert ($this.StartInfo.StandardOutputEncoding.CodePage -eq 65001)
        Assert ($this.StartInfo.StandardErrorEncoding.CodePage -eq 65001)
        $s.Calls.Add($this.StartInfo.Arguments)
        if ($s.StartFailure) { throw 'C:\fixture private\cannot-start.exe' }
        $this.ExitCode = $s.ExitCode
        $bytes = [Text.Encoding]::UTF8.GetBytes($s.Text)
        $this.StandardOutput = [IO.StreamReader]::new([IO.MemoryStream]::new($bytes), $this.StartInfo.StandardOutputEncoding, $false)
        $this.StandardError = [IO.StringReader]::new('C:\fixture private\native-error with secret detail')
        return $true
    }
    $process | Add-Member ScriptMethod WaitForExit {
        param($Milliseconds)
        Assert ($Milliseconds -in @(3000, 1000)) 'Unbounded wait'
        return (-not $global:CockpitIntegrationsTest.Timeout -or $this.Killed)
    }
    $process | Add-Member ScriptMethod Kill { $this.Killed = $true; $global:CockpitIntegrationsTest.Killed++ }
    $process | Add-Member ScriptMethod Dispose { $global:CockpitIntegrationsTest.Disposed++ }
    return $process
}
try {
    $ErrorActionPreference = 'Continue'
    . $target -Binary $binary
    Assert ($binary -ceq (Join-Path $fixture 'trusted herdr.exe')) 'Import replaced the inert fixture path'
    Assert ($ErrorActionPreference -eq 'Continue') 'Import changed preferences'
    $ErrorActionPreference = 'Stop'
    Assert ($null -eq $global:CockpitIntegrationsTest) 'Import started a probe'
    Case 'complete native inventory reports not-installed without availability guesses' {
        $result = Get-CockpitIntegrations $binary
        Assert ($result.Available -and $result.Rows.Count -eq 18)
        Assert (@($result.Rows | Where-Object { $_.State -cne 'not-installed' }).Count -eq 0)
        Assert ($CockpitIntegrationsTest.Calls.Count -eq 1 -and $CockpitIntegrationsTest.Disposed -eq 1)
    }
    Case 'current outdated legacy and needs repair reflect native evidence' {
        $s = $CockpitIntegrationsTest
        $s.Text = $s.Text.Replace('pi: not installed', 'pi: current (v10)').
            Replace('claude: not installed', 'claude: outdated (v10 < v11)').
            Replace('codex: not installed', 'codex: outdated (legacy < v10)').
            Replace('grok: not installed', 'grok: needs repair (v99)')
        $result = Get-CockpitIntegrations $binary
        Assert $result.Available
        Assert (($result.Rows | Where-Object Target -eq 'pi').State -ceq 'current')
        Assert (($result.Rows | Where-Object Target -eq 'claude').Detail -ceq 'outdated (v10 < v11)')
        Assert (($result.Rows | Where-Object Target -eq 'codex').Detail -ceq 'outdated (legacy < v10)')
        Assert (($result.Rows | Where-Object Target -eq 'grok').State -ceq 'outdated')
        Assert (($result.Rows | Where-Object Target -eq 'grok').Detail -ceq 'needs repair (v99)')
    }
    Case 'omitted rows are unavailable; partial inventory is a failure' {
        $CockpitIntegrationsTest.Text = 'claude: current (v11) (/home/fixture/.claude/hooks/state.sh)'
        $result = Get-CockpitIntegrations $binary
        Assert (-not $result.Available -and $result.Rows.Count -eq 18)
        Assert (($result.Rows | Where-Object Target -eq 'claude').State -ceq 'current')
        Assert (($result.Rows | Where-Object Target -eq 'codex').State -ceq 'unavailable')
        Assert ($result.Message -match 'Incomplete native inventory')
    }
    Case 'malformed empty duplicated unknown and control-bearing output fails closed' {
        $valid = Inventory
        foreach ($text in @('', ' ', 'not status', '{}', ($valid + 'warning: C:\fixture private'),
            ($valid + 'claude: current (v11) (C:\fixture\duplicate.ps1)'),
            $valid.Replace('pi: not installed', 'pi: newest'),
            $valid.Replace('pi: not installed', 'unknown-agent: not installed'),
            $valid.Replace('pi: not installed', 'pi (experimental): not installed'),
            $valid.Replace('pi: not installed', 'PI: not installed'),
            $valid.Replace('pi: not installed', "pi: current (v10$([char]27)[31m)"),
            $valid.Replace('pi: not installed', 'pi: current (v10) extra'),
            $valid.Replace('pi: not installed', 'pi: outdated (v9 < vX)'))) {
            $CockpitIntegrationsTest.Text = $text
            $result = Get-CockpitIntegrations $binary
            Assert (-not $result.Available -and $result.Message -match '^Status unavailable:')
            Assert (@($result.Rows | Where-Object State -ne 'unavailable').Count -eq 0) 'Partial parse escaped failure'
        }
    }
    Case 'nonzero exit ignores valid-looking stdout and hides stderr' {
        $CockpitIntegrationsTest.ExitCode = 2
        $result = Get-CockpitIntegrations $binary
        Assert (-not $result.Available -and $result.Message -match '^CLI unavailable:')
        Assert (@($result.Rows | Where-Object State -ne 'unavailable').Count -eq 0)
        $text = Show-CockpitIntegrations $binary | Out-String
        Assert ($text -notmatch 'fixture private|secret detail')
        Assert ($global:LASTEXITCODE -eq 1 -and $CockpitIntegrationsTest.Disposed -eq 2)
    }
    Case 'timeout and start failure dispose probes; only timed-out child is terminated' {
        $CockpitIntegrationsTest.Timeout = $true
        Assert (-not (Get-CockpitIntegrations $binary).Available)
        Assert ($CockpitIntegrationsTest.Killed -eq 1 -and $CockpitIntegrationsTest.Disposed -eq 1)
        $CockpitIntegrationsTest.Timeout = $false; $CockpitIntegrationsTest.StartFailure = $true
        Assert (-not (Get-CockpitIntegrations $binary).Available)
        Assert ($CockpitIntegrationsTest.Killed -eq 1 -and $CockpitIntegrationsTest.Disposed -eq 2)
    }
    Case 'missing invalid or ambiguous binary never falls back to PATH' {
        foreach ($path in @('', 'herdr', 'C:herdr.exe', 'C:\fixture\missing.exe', $fixture,
            ($binary + ';other.exe'), ($binary + "`n"))) {
            Assert (-not (Get-CockpitIntegrations $path).Available)
        }
        Assert ($CockpitIntegrationsTest.Calls.Count -eq 0)
    }
    Case 'summary hides Unicode and parenthesized paths; entrypoint returns success' {
        $CockpitIntegrationsTest.Text = $CockpitIntegrationsTest.Text.Replace('fixture private', ('private-' + [char]0x03a9))
        $text = & $target -Binary $binary | Out-String
        Assert ($LASTEXITCODE -eq 0)
        Assert ($text -match 'READ-ONLY' -and $text -match 'not-installed')
        Assert ($text -notmatch 'C:\\|private-|copy|secret|fixture') 'Private native text leaked'
        Assert (-not $text.Contains([string][char]0x03a9))
        Assert ($text -match 'Running agent code.*remain unverified')
    }
    Case 'entrypoint uses caller-injected binary; absent default never searches PATH' {
        $savedBinary = $env:HERDR_BIN_PATH
        try {
            $env:HERDR_BIN_PATH = $binary
            $text = & $target | Out-String
            Assert ($LASTEXITCODE -eq 0 -and $text -match 'READ-ONLY')
            $env:HERDR_BIN_PATH = $null
            $text = & $target | Out-String
            Assert ($LASTEXITCODE -eq 1 -and $text -match 'No PATH fallback')
            Assert ($CockpitIntegrationsTest.Calls.Count -eq 1)
        } finally { $env:HERDR_BIN_PATH = $savedBinary }
    }
    Case 'entrypoint command parse and partial failures return nonzero' {
        foreach ($kind in @('command', 'parse', 'partial')) {
            Reset-Mock
            switch ($kind) {
                'command' { $CockpitIntegrationsTest.ExitCode = 1 }
                'parse' { $CockpitIntegrationsTest.Text = 'bad native output' }
                'partial' { $CockpitIntegrationsTest.Text = 'claude: not installed (C:\fixture\state.ps1)' }
            }
            $text = & $target -Binary $binary | Out-String
            Assert ($LASTEXITCODE -eq 1 -and $text -match 'unavailable')
        }
    }
    Case 'static command allowlist excludes mutation and secret-reading commands' {
        $allowed = @('Get-CockpitIntegrationTargets', 'New-Object', 'ConvertFrom-CockpitIntegrationsText',
            'Invoke-CockpitIntegrationsNative', 'Get-CockpitIntegrations', 'Show-CockpitIntegrations',
            'Get-Item', 'Where-Object', 'Write-Output')
        $commands = $ast.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] }, $true)
        foreach ($command in $commands) {
            Assert ($command.GetCommandName() -cin $allowed) ('Unexpected command: ' + $command.GetCommandName())
        }
        $source = [IO.File]::ReadAllText($target)
        Assert ($source -notmatch '(?i)integration (install|uninstall)|server (stop|reload)|agent (start|prompt)|Invoke-Expression|Set-Content|ReadAllText|Get-Content|EnvironmentVariables\[')
        Assert ($source -match "Arguments = 'integration status'")
    }
    Write-Output "PASS: $passed cases; syntax parsed; native processes mocked; no live integrations changed."
} finally {
    $global:LASTEXITCODE = $savedExit
    Remove-Item -LiteralPath $fixture -Recurse -Force
    Remove-Variable -Name CockpitIntegrationsTest -Scope Global -ErrorAction SilentlyContinue
}
