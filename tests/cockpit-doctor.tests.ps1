# Windows PowerShell 5.1. Real adapters, synthetic files, mocked native processes only.
$ErrorActionPreference = 'Stop'
$target = Join-Path (Split-Path $PSScriptRoot -Parent) 'tools/cockpit-doctor.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($target, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('cockpit-doctor-test-' + [guid]::NewGuid())
$null = [IO.Directory]::CreateDirectory($fixture)
$doctorBinary = Join-Path $fixture 'private-name.exe'
$manifestFile = Join-Path $fixture 'receipt.json'
[IO.File]::WriteAllText($doctorBinary, 'inert fixture; never execute')
$savedBinary = $env:HERDR_BIN_PATH; $savedSocket = $env:HERDR_SOCKET_PATH; $savedExit = $global:LASTEXITCODE
$passed = 0
function Assert($Condition, [string]$Message = 'Assertion failed') { if (-not $Condition) { throw $Message } }
function Reset-Mock {
    $global:CockpitDoctorTest = @{
        Calls = [Collections.Generic.List[string]]::new(); Killed = 0; Disposed = 0; Binary = $doctorBinary
        Timeout = ''; Exit = ''; StartFailure = ''; Client = $null; Server = $null
        ServerVersion = '0.9.5'; Running = $true; LinkedPath = ''
        Text = ((@('pi', 'omp', 'claude', 'codex', 'copilot', 'devin', 'droid', 'kimi',
            'opencode', 'kilo', 'hermes', 'qodercli', 'qwen', 'cursor', 'mastracode',
            'antigravity-cli', 'grok', 'letta') | ForEach-Object {
                "${_}: not installed (C:\private-native\hook.ps1)"
            }) -join "`n")
    }
    $env:HERDR_BIN_PATH = 'C:\private-inherited\wrong.exe'
    $env:HERDR_SOCKET_PATH = 'C:\private-inherited\wrong.sock'
}
function Case([string]$Name, [scriptblock]$Body) {
    Reset-Mock
    try { & $Body; $script:passed++; Write-Output "PASS $Name" }
    catch { throw "FAIL ${Name}: $($_.Exception.Message)" }
}
function Get-Item {
    param([string]$LiteralPath, [switch]$Force, [string]$ErrorAction)
    $item = Microsoft.PowerShell.Management\Get-Item -LiteralPath $LiteralPath -Force -ErrorAction Stop
    if ($LiteralPath -ieq $global:CockpitDoctorTest.LinkedPath) {
        return [pscustomobject]@{ Attributes = [IO.FileAttributes]::ReparsePoint }
    }
    return $item
}
function New-Object([string]$TypeName) {
    Assert ($TypeName -ceq 'System.Diagnostics.Process') 'Unexpected process boundary'
    $process = [pscustomobject]@{
        StartInfo = [Diagnostics.ProcessStartInfo]::new(); ExitCode = 0
        StandardOutput = $null; StandardError = $null; Killed = $false
    }
    $process | Add-Member ScriptMethod Start {
        $s = $global:CockpitDoctorTest; $command = $this.StartInfo.Arguments
        Assert ($command -cin @('status client --json', 'status server --json', 'integration status')) 'Mutation attempted'
        Assert ($this.StartInfo.FileName -ceq $s.Binary) 'Wrong executable'
        Assert (-not $this.StartInfo.UseShellExecute -and $this.StartInfo.CreateNoWindow)
        Assert ($this.StartInfo.RedirectStandardOutput -and $this.StartInfo.RedirectStandardError)
        $s.Calls.Add($command)
        if ($s.StartFailure -ceq $command) { throw 'C:\private-native\failed.exe secret error' }
        $json = $s.Text
        if ($command -ceq 'status client --json') {
            $json = @{ binary = $this.StartInfo.FileName; version = '0.9.5' } | ConvertTo-Json -Compress
            if ($null -ne $s.Client) { $json = $s.Client }
        } elseif ($command -ceq 'status server --json') {
            Assert ($this.StartInfo.EnvironmentVariables['HERDR_SOCKET_PATH'] -ceq 'C:\private-explicit\server.sock')
            $state = if ($s.Running) { 'running' } else { 'not_running' }
            $json = @{ socket = 'C:\private-explicit\server.sock'; running = $s.Running; status = $state; version = $s.ServerVersion } | ConvertTo-Json -Compress
            if ($null -ne $s.Server) { $json = $s.Server }
        }
        if ($s.Exit -ceq $command) { $this.ExitCode = 1 }
        $this.StandardOutput = [IO.StringReader]::new($json)
        $this.StandardError = [IO.StringReader]::new('C:\private-native\stderr secret')
        return $true
    }
    $process | Add-Member ScriptMethod WaitForExit {
        param($Milliseconds)
        Assert ($Milliseconds -in @(3000, 1000)) 'Unbounded wait'
        return ($this.StartInfo.Arguments -cne $global:CockpitDoctorTest.Timeout -or $this.Killed)
    }
    $process | Add-Member ScriptMethod Kill { $this.Killed = $true; $global:CockpitDoctorTest.Killed++ }
    $process | Add-Member ScriptMethod Dispose { $global:CockpitDoctorTest.Disposed++ }
    return $process
}
function Doctor {
    Get-CockpitDoctor -Binary $doctorBinary -EndpointSocket 'C:\private-explicit\server.sock'
}
function Integrity([string]$Json) {
    [IO.File]::WriteAllText($manifestFile, $Json)
    $hash = (Get-FileHash -LiteralPath $manifestFile -Algorithm SHA256).Hash
    return (Get-CockpitDoctor -Binary $doctorBinary -EndpointSocket 'C:\private-explicit\server.sock' -ManifestPath $manifestFile -ManifestSha256 $hash).Integrity
}
try {
    Reset-Mock
    $ErrorActionPreference = 'Continue'
    $import = . $target
    Assert ($ErrorActionPreference -eq 'Continue') 'Import changed preference'
    $ErrorActionPreference = 'Stop'
    Assert ($null -eq $import -and $CockpitDoctorTest.Calls.Count -eq 0) 'Import emitted output or probed'
    Assert ($env:HERDR_BIN_PATH -ceq 'C:\private-inherited\wrong.exe') 'Import changed environment'
    Case 'complete evidence keeps CLI server and attached client distinct' {
        $result = Doctor
        Assert ($result.ExitCode -eq 0 -and $result.CliVersion -ceq '0.9.5')
        Assert ($result.ServerCompatibility -match '^observed 0.9.5 status contract')
        Assert ($result.AttachedClient -ceq 'unknown' -and $result.Integrity.State -ceq 'not requested')
        Assert (($CockpitDoctorTest.Calls -join ',') -ceq 'status client --json,status server --json,integration status') 'Repeated or unexpected probes'
        Assert ($CockpitDoctorTest.Disposed -eq 3)
    }
    Case 'outdated but parsed integration makes health nonzero' {
        $CockpitDoctorTest.Text = $CockpitDoctorTest.Text.Replace('claude: not installed', 'claude: outdated (v10 < v11)')
        $result = Doctor
        Assert ($result.Integrations.Available -and $result.ExitCode -eq 1)
        Assert (($result.Integrations.Rows | Where-Object Target -eq 'claude').State -ceq 'outdated')
    }
    Case 'partial integration evidence preserves known rows' {
        $CockpitDoctorTest.Text = 'claude: current (v11) (C:\private-native\hook.ps1)'
        $result = Doctor
        Assert ($result.ExitCode -eq 1 -and -not $result.Integrations.Available)
        Assert (($result.Integrations.Rows | Where-Object Target -eq 'claude').State -ceq 'current')
        Assert (($result.Integrations.Rows | Where-Object Target -eq 'codex').State -ceq 'unavailable')
    }
    Case 'disconnected and unsupported server evidence remains unknown compatibility' {
        $CockpitDoctorTest.Running = $false
        $result = Doctor
        Assert ($result.ExitCode -eq 1 -and $result.EndpointState -match '^disconnected')
        $CockpitDoctorTest.Running = $true; $CockpitDoctorTest.ServerVersion = '0.9.6'
        $result = Doctor
        Assert ($result.EndpointState -match '^connected' -and $result.ServerCompatibility -ceq 'unknown' -and $result.ExitCode -eq 1)
    }
    Case 'invalid evidence does not erase independent valid evidence' {
        $CockpitDoctorTest.Client = '{}'
        $result = Doctor
        Assert ($result.CliVersion -ceq 'unknown' -and $result.ServerVersion -ceq '0.9.5' -and $result.ExitCode -eq 1)
        $CockpitDoctorTest.Client = $null; $CockpitDoctorTest.Server = 'private invalid JSON'; $CockpitDoctorTest.Text = '{}'
        $result = Doctor
        Assert ($result.CliVersion -ceq '0.9.5' -and $result.ServerCompatibility -ceq 'unknown')
        Assert (-not $result.Integrations.Available -and $result.ExitCode -eq 1)
    }
    Case 'missing explicit inputs never use inherited binary or socket' {
        $result = Get-CockpitDoctor
        Assert ($result.ExitCode -eq 1 -and $CockpitDoctorTest.Calls.Count -eq 0)
        $result = Get-CockpitDoctor -Binary $doctorBinary
        Assert ($result.ServerCompatibility -ceq 'unknown')
        Assert (($CockpitDoctorTest.Calls -join ',') -ceq 'integration status')
    }
    Case 'each native timeout is bounded disposed and never retried' {
        foreach ($command in @('status client --json', 'status server --json', 'integration status')) {
            Reset-Mock; $CockpitDoctorTest.Timeout = $command
            Assert ((Doctor).ExitCode -eq 1)
            Assert ($CockpitDoctorTest.Killed -eq 1 -and $CockpitDoctorTest.Disposed -eq 3 -and $CockpitDoctorTest.Calls.Count -eq 3)
            Assert ($env:HERDR_BIN_PATH -ceq 'C:\private-inherited\wrong.exe' -and $env:HERDR_SOCKET_PATH -ceq 'C:\private-inherited\wrong.sock')
        }
    }
    Case 'native start and exit failures fail closed without private errors' {
        foreach ($kind in @('Exit', 'StartFailure')) {
            foreach ($command in @('status client --json', 'status server --json', 'integration status')) {
                Reset-Mock; $CockpitDoctorTest[$kind] = $command
                $text = Show-CockpitDoctor -Binary $doctorBinary -EndpointSocket 'C:\private-explicit\server.sock' | Out-String
                Assert ($global:LASTEXITCODE -eq 1 -and $text -notmatch 'private-|secret|C:\\')
                Assert ($CockpitDoctorTest.Disposed -eq 3)
            }
        }
    }
    Case 'manual entrypoint redacts paths and returns meaningful exit status' {
        $text = & $target -Binary $doctorBinary -EndpointSocket 'C:\private-explicit\server.sock' | Out-String
        Assert ($LASTEXITCODE -eq 0 -and $text -match 'Attached-client.*unknown') ('Entry failed: ' + $text)
        Assert ($text -notmatch 'private-|secret|C:\\|receipt.json') 'Entry leaked private text'
        $text = & $target | Out-String
        Assert ($LASTEXITCODE -eq 1 -and $text -match 'unavailable') ('Absent input status: ' + $LASTEXITCODE + ' ' + $text)
    }
    Case 'hash-only manifest verifies explicitly listed helper bytes' {
        $hash = (Get-FileHash -LiteralPath $doctorBinary -Algorithm SHA256).Hash
        $result = Integrity ('{"private-name.exe":"' + $hash + '"}')
        Assert ($result.State -ceq 'matched supplied hashes' -and $result.Checked -eq 1)
        Assert (($result | ConvertTo-Json -Compress) -notmatch 'private-|receipt|C:\\')
    }
    Case 'real bundle size streams successfully with bounded file size' {
        $large = Join-Path $fixture 'bundle.exe'
        $stream = [IO.File]::Open($large, [IO.FileMode]::Create, [IO.FileAccess]::Write)
        try { $stream.SetLength(26955264) } finally { $stream.Dispose() }
        $hash = (Get-FileHash -LiteralPath $large -Algorithm SHA256).Hash
        $result = Integrity ('{"bundle.exe":"' + $hash + '"}')
        Assert ($result.State -ceq 'matched supplied hashes' -and $result.Checked -eq 1)
        $stream = [IO.File]::Open($large, [IO.FileMode]::Open, [IO.FileAccess]::Write)
        try { $stream.SetLength(268435457) } finally { $stream.Dispose() }
        Assert ((Integrity ('{"bundle.exe":"' + $hash + '"}')).State -match '^unavailable')
        Remove-Item -LiteralPath $large
    }
    Case 'manifest and file hash mismatches stay distinct' {
        $result = Integrity ('{"private-name.exe":"' + ('0' * 64) + '"}')
        Assert ($result.State -ceq 'file hash mismatch' -and $result.Mismatched -eq 1)
        $result = Get-CockpitDoctor -Binary $doctorBinary -EndpointSocket 'C:\private-explicit\server.sock' -ManifestPath $manifestFile -ManifestSha256 ('0' * 64)
        Assert ($result.ExitCode -eq 1 -and $result.Integrity.State -ceq 'manifest hash mismatch' -and $result.Integrity.Checked -eq 0)
    }
    Case 'malformed manifests commands duplicates and unsafe paths fail closed' {
        $hash = '0' * 64
        foreach ($json in @('{}', '[]', 'bad JSON', '{"command":"Start-Process secret"}',
            ('{"a":"' + $hash + '","A":"' + $hash + '"}'), ('{"a":"' + $hash + '","a":"' + $hash + '"}'))) {
            Assert ((Integrity $json).State -match '^unavailable')
        }
        foreach ($name in @('../escape.exe', 'sub/../../escape.exe', '/root.exe', 'C:/outside.exe',
            'file:stream', 'sub\\file', '//host/share/file', 'CON', 'nul.txt', 'COM1.exe', 'a./file', 'a /file', 'a//b', './file', "bad`nfile")) {
            $json = @{}; $json[$name] = $hash
            $result = Integrity ($json | ConvertTo-Json -Compress)
            Assert ($result.State -match '^unavailable' -and $result.Checked -eq 0) 'Unsafe name accepted'
        }
    }
    Case 'linked file linked parent and linked manifest rejected before reading' {
        $hash = (Get-FileHash -LiteralPath $doctorBinary -Algorithm SHA256).Hash
        foreach ($linked in @($doctorBinary, $fixture, $manifestFile)) {
            $CockpitDoctorTest.LinkedPath = $linked
            $result = Integrity ('{"private-name.exe":"' + $hash + '"}')
            Assert ($result.State -match '^unavailable' -and $result.Checked -eq 0)
        }
    }
    Case 'missing file incomplete optional inputs and oversized manifest stay unavailable' {
        Assert ((Integrity ('{"missing.exe":"' + ('0' * 64) + '"}')).State -match '^unavailable')
        Assert ((Integrity (' ' * 65537)).State -match '^unavailable')
        Assert ((Get-CockpitDoctor -ManifestPath $manifestFile).Integrity.State -match '^unavailable')
        Assert ((Get-CockpitDoctor -ManifestSha256 ('0' * 64)).Integrity.State -match '^unavailable')
        $files = @{}; 1..33 | ForEach-Object { $files["file$_.ps1"] = '0' * 64 }
        Assert ((Integrity ($files | ConvertTo-Json -Compress)).State -match '^unavailable')
    }
    Case 'read-only invocation preserves files and caller environment' {
        $before = (Get-FileHash -LiteralPath $doctorBinary -Algorithm SHA256).Hash
        $null = Doctor
        Assert ((Get-FileHash -LiteralPath $doctorBinary -Algorithm SHA256).Hash -ceq $before)
        Assert ($env:HERDR_BIN_PATH -ceq 'C:\private-inherited\wrong.exe' -and $env:HERDR_SOCKET_PATH -ceq 'C:\private-inherited\wrong.sock')
        $env:HERDR_BIN_PATH = $null; $null = Doctor
        Assert ($null -eq $env:HERDR_BIN_PATH)
        $allowed = @('Get-Item', 'Read-CockpitDoctorFile', 'ConvertFrom-CockpitIdentityJson', 'Join-Path',
            'Get-CockpitIdentity', 'Get-CockpitIntegrations', 'Get-CockpitDoctorIntegrity', 'Where-Object',
            'Get-CockpitDoctor', 'Write-Output', 'Show-CockpitDoctor')
        foreach ($command in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.CommandAst] }, $true)) {
            if ($command.InvocationOperator -eq [Management.Automation.Language.TokenKind]::Dot) { continue }
            Assert ($command.GetCommandName() -cin $allowed) 'Unexpected command'
        }
        $source = [IO.File]::ReadAllText($target)
        Assert ($source -notmatch 'Invoke-Expression|Start-Process|Set-Content|WriteAll|FileMode\]::(?:Create|Append)|FileAccess\]::Write')
        Assert ($source -match 'ComputeHash\(\$stream\)') 'Bundle hashing must stream'
    }
    Write-Output "PASS: $passed cases; PowerShell syntax checked; native processes mocked; no live probes."
} finally {
    $env:HERDR_BIN_PATH = $savedBinary; $env:HERDR_SOCKET_PATH = $savedSocket; $global:LASTEXITCODE = $savedExit
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedFixture.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($resolvedFixture) -notlike 'cockpit-doctor-test-*') { throw 'Unsafe cleanup path.' }
    Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
    Remove-Variable -Name CockpitDoctorTest -Scope Global -ErrorAction SilentlyContinue
}
