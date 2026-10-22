# Windows PowerShell 5.1. Inert fixture bytes; all native processes mocked, including script entry.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$target = Join-Path $root 'tools/cockpit-status.ps1'
foreach ($path in @($target, (Join-Path $root 'tools/cockpit-identity.ps1'))) {
    $tokens = $null; $errors = $null
    $null = [Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors)
    if ($errors.Count) { throw ($errors | Out-String) }
}
$envNames = @('HERDR_BIN_PATH', 'HERDR_SOCKET_PATH', 'HERDR_ACTIVE_PANE_ID', 'HERDR_ACTIVE_WORKSPACE_ID')
$savedEnv = @{}
foreach ($name in $envNames) { $savedEnv[$name] = [Environment]::GetEnvironmentVariable($name) }
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('cockpit-identity-test-' + [guid]::NewGuid())
$null = [IO.Directory]::CreateDirectory($fixture)
$original = Join-Path $fixture 'herdr.exe'; $custom = Join-Path $fixture 'renamed-client.exe'
[IO.File]::WriteAllText($original, 'inert original fixture bytes')
[IO.File]::WriteAllText($custom, 'inert custom fixture bytes')
$passed = 0
function Assert($Condition, [string]$Message = 'Assertion failed') {
    if (-not $Condition) { throw $Message }
}
function Reset-Mock {
    $env:HERDR_BIN_PATH = $original; $env:HERDR_SOCKET_PATH = 'C:\fixture\inherited-local.sock'
    $env:HERDR_ACTIVE_PANE_ID = 'w1:p1'; $env:HERDR_ACTIVE_WORKSPACE_ID = 'w1'
    # Global only so mocks invoked from the separate script entry share this fixture state.
    $global:CockpitIdentityTest = @{
        Socket = 'C:\fixture\explicit-local.sock'
        Calls = [Collections.Generic.List[object]]::new(); Lines = [Collections.Generic.List[string]]::new()
        ClientOverride = $null; ServerOverride = $null; TimeoutScope = ''; ExitScope = ''
        Running = $true; ServerVersion = '0.9.5'; Disposed = 0; Killed = 0
    }
}
function Case([string]$Name, [scriptblock]$Body) {
    Reset-Mock
    try { & $Body; $script:passed++; Write-Output "PASS $Name" }
    catch { throw "FAIL ${Name}: $($_.Exception.Message)" }
}
# Intercept the exact native boundary, not the identity parser or renderer.
function New-Object([string]$TypeName) {
    if ($TypeName -ne 'System.Diagnostics.Process') { throw "Unexpected construction: $TypeName" }
    $process = [pscustomobject]@{
        StartInfo = [Diagnostics.ProcessStartInfo]::new(); ExitCode = 0
        StandardOutput = $null; StandardError = $null; Scope = ''; Killed = $false
    }
    $process | Add-Member ScriptMethod Start {
        $s = $global:CockpitIdentityTest
        $command = $this.StartInfo.Arguments
        Assert ($command -cin @('status client --json', 'status server --json')) 'Non-read-only command'
        Assert (-not $this.StartInfo.UseShellExecute -and $this.StartInfo.CreateNoWindow)
        Assert ($this.StartInfo.RedirectStandardOutput -and $this.StartInfo.RedirectStandardError)
        Assert ($this.StartInfo.StandardOutputEncoding.CodePage -eq 65001 -and $this.StartInfo.StandardErrorEncoding.CodePage -eq 65001) 'Native JSON must decode as UTF-8'
        $this.Scope = ($command -split ' ')[1]
        $socket = $this.StartInfo.EnvironmentVariables['HERDR_SOCKET_PATH']
        $s.Calls.Add([pscustomobject]@{ Binary = $this.StartInfo.FileName; Scope = $this.Scope; Socket = $socket })
        if ($this.Scope -eq 'client') {
            $json = @{ version = '0.9.5'; binary = $this.StartInfo.FileName } | ConvertTo-Json -Compress
            if ($null -ne $s.ClientOverride) { $json = $s.ClientOverride }
        } else {
            $state = if ($s.Running) { 'running' } else { 'not_running' }
            $json = @{ status = $state; running = $s.Running; version = $s.ServerVersion; socket = $socket } | ConvertTo-Json -Compress
            if ($null -ne $s.ServerOverride) { $json = $s.ServerOverride }
        }
        if ($this.Scope -eq $s.ExitScope) { $this.ExitCode = 1 }
        # Exercise the byte-decoding boundary instead of bypassing it with StringReader.
        $bytes = [Text.Encoding]::UTF8.GetBytes($json)
        $this.StandardOutput = [IO.StreamReader]::new([IO.MemoryStream]::new($bytes), $this.StartInfo.StandardOutputEncoding, $false)
        $this.StandardError = [IO.StringReader]::new('fixture private error detail')
        return $true
    }
    $process | Add-Member ScriptMethod WaitForExit {
        param($Milliseconds)
        Assert ($Milliseconds -in @(3000, 1000)) 'Probe wait is not bounded'
        return ($this.Scope -ne $global:CockpitIdentityTest.TimeoutScope -or $this.Killed)
    }
    $process | Add-Member ScriptMethod Kill { $this.Killed = $true; $global:CockpitIdentityTest.Killed++ }
    $process | Add-Member ScriptMethod Dispose { $global:CockpitIdentityTest.Disposed++ }
    return $process
}
function Write-Host($Object, $ForegroundColor) { $global:CockpitIdentityTest.Lines.Add([string]$Object) }
function Read-CockpitKey { throw 'TestRender requested an interactive key' }
try {
    Reset-Mock
    $ErrorActionPreference = 'Continue'
    . $target
    Assert ($ErrorActionPreference -eq 'Continue') 'Import changed preferences'
    $ErrorActionPreference = 'Stop'
    Assert ($CockpitIdentityTest.Calls.Count -eq 0) 'Import called native process'
    Case 'original identity is CLI evidence, never official or displayed UI identity' {
        $s = $CockpitIdentityTest
        Show-CockpitStatus -Identity -EndpointSocket $s.Socket -TestRender
        $text = $s.Lines -join "`n"
        Assert ($text -match 'Invoked CLI executable: herdr.exe' -and $text -match 'Invoked CLI build: 0.9.5')
        Assert ($text.Contains((Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash))
        Assert ($text -match 'Displayed client build: unknown; displayed host/connection: unknown')
        Assert ($text -match 'CLI provenance: unknown' -and $text -match 'connected \(CLI probe only\)')
        Assert (-not $text.Contains($fixture) -and -not $text.Contains($s.Socket)) 'Private path rendered'
        Assert (($s.Calls.Scope -join ',') -eq 'client,server' -and $s.Disposed -eq 2)
        Assert (@($s.Calls | Where-Object { $_.Socket -cne $s.Socket }).Count -eq 0)
    }
    Case 'custom fingerprint differs even with the same reported version' {
        $s = $CockpitIdentityTest
        $a = Get-CockpitIdentity $s.Socket
        $env:HERDR_BIN_PATH = $custom
        $b = Get-CockpitIdentity $s.Socket
        Assert ($a.CliVersion -eq $b.CliVersion -and $a.CliSha256 -cne $b.CliSha256)
        Show-CockpitStatus -Identity -EndpointSocket $s.Socket -TestRender
        Assert (($s.Lines -join "`n") -match 'renamed-client.exe')
        Assert (($s.Lines -join "`n").Contains($b.CliSha256))
    }
    Case 'absent relative invalid and ambiguous executable never uses PATH' {
        foreach ($binary in @('', 'herdr', 'C:herdr.exe', (Join-Path $fixture 'missing.exe'), $fixture, ($original + ';other.exe'))) {
            $env:HERDR_BIN_PATH = $binary
            Assert ((Get-CockpitIdentity $CockpitIdentityTest.Socket).EndpointState -eq 'unavailable')
        }
        Assert ($CockpitIdentityTest.Calls.Count -eq 0)
    }
    Case 'absent or invalid explicit endpoint never inherits local routing' {
        foreach ($socket in @('', 'relative.sock', 'C:relative.sock', '\relative.sock', "C:\fixture\bad`n.sock")) {
            Show-CockpitStatus -Identity -EndpointSocket $socket -TestRender
        }
        Assert ($CockpitIdentityTest.Calls.Count -eq 0)
        Assert (($CockpitIdentityTest.Lines -join "`n") -match 'No fallback')
    }
    Case 'absent malformed array mismatched and unsupported CLI build stays unknown' {
        foreach ($json in @('{}', 'bad JSON', '[]', '{"version":"0.9.5","binary":"C:\\fixture\\other.exe"}',
            ('[' + (@{ version = '0.9.5'; binary = $original } | ConvertTo-Json -Compress) + ']'),
            (@{ version = "0.9.5$([char]27)[31m"; binary = $original } | ConvertTo-Json -Compress),
            (@{ version = '0.9.6'; binary = $original } | ConvertTo-Json -Compress))) {
            $CockpitIdentityTest.ClientOverride = $json
            $identity = Get-CockpitIdentity $CockpitIdentityTest.Socket
            Assert ($identity.CliVersion -eq 'unknown')
            Assert ($identity.EndpointState -match '^connected')
        }
    }
    Case 'endpoint disconnected is separate from failed or ambiguous probe' {
        $s = $CockpitIdentityTest; $s.Running = $false
        Assert ((Get-CockpitIdentity $s.Socket).EndpointState -match '^disconnected')
        foreach ($json in @('{}', 'not JSON', '[]', '{"status":"running","running":true,"socket":"C:\\fixture\\other.sock"}',
            ('[' + (@{ status = 'running'; running = $true; socket = $s.Socket } | ConvertTo-Json -Compress) + ']'),
            (@{ status = 'not_running'; running = $true; socket = $s.Socket } | ConvertTo-Json -Compress),
            (@{ status = 'running'; running = 'true'; socket = $s.Socket } | ConvertTo-Json -Compress),
            (@{ status = @('running', 'not_running'); running = $true; socket = $s.Socket } | ConvertTo-Json -Compress))) {
            $s.ServerOverride = $json
            Assert ((Get-CockpitIdentity $s.Socket).EndpointState -match '^unknown')
        }
    }
    Case 'timeout and nonzero exit hide stderr and dispose children without changing caller route' {
        $s = $CockpitIdentityTest; $s.TimeoutScope = 'server'
        Show-CockpitStatus -Identity -EndpointSocket $s.Socket -TestRender
        Assert ($s.Killed -eq 1 -and $s.Disposed -eq 2)
        $s.TimeoutScope = 'client'; $s.ExitScope = 'server'
        Show-CockpitStatus -Identity -EndpointSocket $s.Socket -TestRender
        Assert ($s.Killed -eq 2 -and $s.Disposed -eq 4)
        $text = $s.Lines -join "`n"
        Assert ($text -match 'timed out' -and $text -notmatch 'private error')
        Assert ($env:HERDR_SOCKET_PATH -ceq 'C:\fixture\inherited-local.sock')
    }
    Case 'local to remote-labelled pipe to disconnect to local uses fresh explicit snapshots' {
        $s = $CockpitIdentityTest
        foreach ($socket in @('C:\fixture\local.sock', '\\.\pipe\fixture-remote-bridge', 'C:\fixture\local.sock')) {
            $s.Running = $true
            Assert ((Get-CockpitIdentity $socket).EndpointState -match '^connected')
            $s.Running = $false
            Assert ((Get-CockpitIdentity $socket).EndpointState -match '^disconnected')
        }
        Assert (($s.Calls.Socket | Select-Object -Unique).Count -eq 2)
        Assert (@($s.Calls | Where-Object { $_.Socket -eq $env:HERDR_SOCKET_PATH }).Count -eq 0)
        Assert ($env:HERDR_SOCKET_PATH -eq 'C:\fixture\inherited-local.sock')
    }
    Case 'absent inherited socket stays absent and suffix follows build_info contract' {
        $env:HERDR_SOCKET_PATH = $null
        $CockpitIdentityTest.ClientOverride = @{ version = '0.9.5-preview.fixture'; binary = $original } | ConvertTo-Json -Compress
        Assert ((Get-CockpitIdentity $CockpitIdentityTest.Socket).CliVersion -eq '0.9.5-preview.fixture')
        Assert ($null -eq $env:HERDR_SOCKET_PATH)
    }
    Case 'one-shot user flow uses actual script parameters and mocked native process' {
        & $target -Identity -EndpointSocket $CockpitIdentityTest.Socket -TestRender
        Assert ($LASTEXITCODE -eq 0)
        Assert (($CockpitIdentityTest.Lines -join "`n") -match 'CONNECTION / BUILD \(READ-ONLY\)')
        Assert ($CockpitIdentityTest.Calls.Count -eq 2)
        Write-Output ($CockpitIdentityTest.Lines -join "`n")
    }
    Case 'UTF-8 executable and endpoint paths survive native byte decoding' {
        $unicodeBinary = Join-Path $fixture (('herdr-' + [char]0x03a9) + '.exe')
        [IO.File]::WriteAllText($unicodeBinary, 'inert Unicode executable fixture')
        $env:HERDR_BIN_PATH = $unicodeBinary
        $socket = 'C:\fixture\' + [char]0x03a9 + '.sock'
        $identity = Get-CockpitIdentity $socket
        Assert ($identity.CliVersion -eq '0.9.5' -and $identity.EndpointState -match '^connected')
    }
    Case 'duplicate exact escaped and case-conflicting fields remain unknown' {
        $s = $CockpitIdentityTest
        $binary = $original | ConvertTo-Json -Compress
        foreach ($members in @('"version":"0.9.5","version":"0.9.5"',
            '"version":"0.9.5","\u0076ersion":"0.9.5"', '"version":"0.9.5","Version":"0.9.5"')) {
            $s.ClientOverride = '{' + $members + ',"binary":' + $binary + '}'
            Assert ((Get-CockpitIdentity $s.Socket).CliVersion -eq 'unknown')
        }
        $s.ClientOverride = $null
        $socket = $s.Socket | ConvertTo-Json -Compress
        foreach ($members in @('"status":"not_running","running":false,"status":"running","running":true',
            '"status":"running","running":true,"\u0072unning":true',
            '"status":"running","running":true,"Running":true')) {
            $s.ServerOverride = '{' + $members + ',"socket":' + $socket + '}'
            Assert ((Get-CockpitIdentity $s.Socket).EndpointState -match '^unknown')
        }
    }
    Case 'multiple JSON roots trailing commas and non-JSON primitives stay unknown' {
        $s = $CockpitIdentityTest
        $client = @{ version = '0.9.5'; binary = $original } | ConvertTo-Json -Compress
        $server = @{ status = 'running'; running = $true; socket = $s.Socket } | ConvertTo-Json -Compress
        foreach ($suffix in @('}{"extra":true}', ',}', ',"extra":[1,]}', ',"extra":NaN}',
            ',"extra":Infinity}', ',"extra":01}', ',"extra":1.}', ',extra:true}')) {
            $s.ClientOverride = $client.Substring(0, $client.Length - 1) + $suffix
            $s.ServerOverride = $server.Substring(0, $server.Length - 1) + $suffix
            $identity = Get-CockpitIdentity $s.Socket
            Assert ($identity.CliVersion -eq 'unknown' -and $identity.EndpointState -match '^unknown')
        }
        $s.ClientOverride = '{"version":"0.9.5"}{"binary":' + ($original | ConvertTo-Json -Compress) + '}'
        $s.ServerOverride = '{"status":"running"}{"running":true,"socket":' + ($s.Socket | ConvertTo-Json -Compress) + '}'
        $identity = Get-CockpitIdentity $s.Socket
        Assert ($identity.CliVersion -eq 'unknown' -and $identity.EndpointState -match '^unknown')
    }
    Case 'version control characters never become known build labels' {
        $s = $CockpitIdentityTest
        foreach ($version in @("0.9.5`n", "0.9.5`r", "0.9.5`t", "0.9.5$([char]0)")) {
            $s.ClientOverride = @{ version = $version; binary = $original } | ConvertTo-Json -Compress
            $s.ServerVersion = $version
            $identity = Get-CockpitIdentity $s.Socket
            Assert ($identity.CliVersion -eq 'unknown' -and $identity.EndpointVersion -eq 'unknown')
        }
    }
    Case 'native nested capability fields and arrays preserve expected identity fields' {
        $s = $CockpitIdentityTest
        $s.ClientOverride = @{ version = '0.9.5'; binary = $original; endpoint_capabilities = @('surface-interest', 'health-check') } | ConvertTo-Json -Compress
        $s.ServerOverride = @{ status = 'running'; running = $true; socket = $s.Socket; capabilities = @{ health_check = $true }; version = '0.9.5' } | ConvertTo-Json -Depth 4 -Compress
        $identity = Get-CockpitIdentity $s.Socket
        Assert ($identity.CliVersion -eq '0.9.5' -and $identity.EndpointState -match '^connected')
    }
    Case 'conflicting modes fail before any endpoint read' {
        $failed = $false
        try { Show-CockpitStatus -Identity -Attention -EndpointSocket $CockpitIdentityTest.Socket -TestRender } catch { $failed = $true }
        Assert ($failed -and $CockpitIdentityTest.Calls.Count -eq 0)
    }
    Write-Output "PASS: $passed cases; parser checked; process mocked; no live endpoint or agent."
} finally {
    foreach ($name in $envNames) { [Environment]::SetEnvironmentVariable($name, $savedEnv[$name]) }
    Remove-Item -LiteralPath $fixture -Recurse -Force
    Remove-Variable -Name CockpitIdentityTest -Scope Global -ErrorAction SilentlyContinue
}
