# Windows PowerShell 5.1. Import is inert; only explicit identity mode calls these helpers.
function ConvertFrom-CockpitIdentityJson([string]$Json) {
    # PowerShell rejects trailing commas/extra roots; the dictionary decoder below
    # rejects repeated keys. Both accept some non-JSON primitives, so check tokens too.
    $null = ConvertFrom-Json -InputObject $Json -ErrorAction Stop
    $unquoted = [regex]::Replace($Json, '"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"', ' ')
    foreach ($token in [regex]::Matches($unquoted, '[^ \t\r\n{}\[\]:,]+')) {
        if ($token.Value -cnotmatch '\A(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\z') {
            throw 'Invalid JSON token.'
        }
    }
    Add-Type -AssemblyName System.Runtime.Serialization
    $settings = [Runtime.Serialization.Json.DataContractJsonSerializerSettings]::new()
    $settings.UseSimpleDictionaryFormat = $true
    $decoder = [Runtime.Serialization.Json.DataContractJsonSerializer]::new([Collections.Generic.Dictionary[string,object]], $settings)
    $stream = [IO.MemoryStream]::new([Text.Encoding]::UTF8.GetBytes($Json))
    try {
        $reply = $decoder.ReadObject($stream)
        if ($null -eq $reply) { throw 'Missing status object.' }
        $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($name in $reply.Keys) {
            if (-not $names.Add($name)) { throw 'Conflicting status fields.' }
        }
        return ,$reply
    } finally {
        $stream.Dispose()
    }
}

function Invoke-CockpitIdentityNative {
    param([string]$Binary, [ValidateSet('client', 'server')][string]$Scope, [string]$Socket)
    $ErrorActionPreference = 'Stop'
    $process = New-Object System.Diagnostics.Process
    try {
        $process.StartInfo.FileName = $Binary
        $process.StartInfo.Arguments = "status $Scope --json"
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        $process.StartInfo.StandardOutputEncoding = [Text.UTF8Encoding]::new($false, $true)
        $process.StartInfo.StandardErrorEncoding = [Text.UTF8Encoding]::new($false, $true)
        # Override only the child's socket. Never change the caller's routing environment.
        $process.StartInfo.EnvironmentVariables['HERDR_SOCKET_PATH'] = $Socket
        if (-not $process.Start()) { throw 'CLI unavailable.' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(3000)) {
            $process.Kill()
            $null = $process.WaitForExit(1000)
            throw 'CLI probe timed out.'
        }
        if ($process.ExitCode -ne 0 -or -not $stdout.Wait(1000) -or -not $stderr.Wait(1000)) {
            throw 'CLI probe unavailable.'
        }
        # Status uses a bare JSON object, not the normal result envelope.
        $reply = ConvertFrom-CockpitIdentityJson $stdout.Result
        return ,$reply
    } finally {
        $process.Dispose()
    }
}

function Get-CockpitIdentity([string]$EndpointSocket) {
    $ErrorActionPreference = 'Stop'
    $identity = [pscustomobject]@{
        CliName = 'unavailable'; CliVersion = 'unknown'; CliSha256 = 'unavailable'
        EndpointState = 'unavailable'; EndpointVersion = 'unknown'; Message = ''
    }
    # Neither popup IDs nor an inherited socket establishes the displayed endpoint.
    if ([string]::IsNullOrWhiteSpace($EndpointSocket) -or
        $EndpointSocket -match '[\x00-\x1f\x7f-\x9f]' -or
        $EndpointSocket -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+\\[^\\/]+(?:\\|$))') {
        $identity.Message = 'Supply -EndpointSocket with an explicit absolute API socket path. No fallback.'
        return $identity
    }
    $binary = $env:HERDR_BIN_PATH
    # Require the trusted caller-injected executable, never PATH, aliases, or discovery.
    if ([string]::IsNullOrWhiteSpace($binary) -or $binary -match '[\x00-\x1f\x7f-\x9f]' -or
        $binary -notmatch '^[A-Za-z]:[\\/]' -or $binary -notmatch '\.exe$') {
        $identity.Message = 'CLI unavailable: require a trusted absolute HERDR_BIN_PATH executable. No PATH fallback.'
        return $identity
    }
    try {
        $file = Get-Item -LiteralPath $binary -ErrorAction Stop
        if ($file.PSIsContainer) { throw 'Not an executable file.' }
        $binary = $file.FullName
        $identity.CliSha256 = (Get-FileHash -LiteralPath $binary -Algorithm SHA256 -ErrorAction Stop).Hash
        $identity.CliName = $file.Name
    } catch {
        $identity.Message = 'CLI unavailable: executable missing or fingerprint unreadable.'
        return $identity
    }
    try {
        $client = Invoke-CockpitIdentityNative -Binary $binary -Scope client -Socket $EndpointSocket
        # This identifies the invoked CLI, not an attached UI process. Reject conflicting evidence.
        if ($client -is [array] -or $client.binary -isnot [string] -or
            -not [string]::Equals($client.binary, $binary, [StringComparison]::OrdinalIgnoreCase) -or
            $client.version -isnot [string] -or $client.version -notmatch '\A0\.9\.5(?:-[A-Za-z0-9._-]+)?\z') {
            throw 'Unknown CLI identity.'
        }
        $identity.CliVersion = $client.version
    } catch {
        $identity.Message = 'CLI build unknown: status absent, ambiguous, unsupported, invalid, or timed out.'
    }
    try {
        $server = Invoke-CockpitIdentityNative -Binary $binary -Scope server -Socket $EndpointSocket
        if ($server -is [array] -or $server.socket -isnot [string] -or
            -not [string]::Equals($server.socket, $EndpointSocket, [StringComparison]::OrdinalIgnoreCase) -or
            $server.running -isnot [bool] -or $server.status -isnot [string]) { throw 'Unknown endpoint.' }
        if ($server.status -ceq 'running' -and $server.running) {
            $identity.EndpointState = 'connected (CLI probe only)'
            if ($server.version -is [string] -and $server.version -match '\A0\.9\.5(?:-[A-Za-z0-9._-]+)?\z') {
                $identity.EndpointVersion = $server.version
            }
        } elseif ($server.status -ceq 'not_running' -and -not $server.running) {
            $identity.EndpointState = 'disconnected (CLI probe only)'
        } else { throw 'Conflicting endpoint status.' }
    } catch {
        # Errors can contain private sockets, paths, or profiles. Never render raw errors.
        $identity.EndpointState = 'unknown (disconnected, invalid, or timed out)'
    }
    return $identity
}

function Show-CockpitIdentity([string]$EndpointSocket, [switch]$TestRender) {
    $identity = Get-CockpitIdentity $EndpointSocket
    Write-Host 'NEURA COCKPIT | CONNECTION / BUILD (READ-ONLY)' -ForegroundColor Cyan
    Write-Host 'Displayed client build: unknown; displayed host/connection: unknown.' -ForegroundColor Yellow
    Write-Host 'Herdr 0.9.5 CLI status does not identify the attached UI client or its selected host.'
    Write-Host ('Invoked CLI executable: ' + (Format-CockpitText $identity.CliName))
    Write-Host ('Invoked CLI build: ' + $identity.CliVersion)
    Write-Host ('Invoked CLI SHA256: ' + $identity.CliSha256)
    Write-Host 'CLI provenance: unknown (a filename or fingerprint does not prove official/custom).'
    Write-Host ('Explicit CLI endpoint (address hidden): ' + $identity.EndpointState)
    Write-Host ('Explicit CLI endpoint server build: ' + $identity.EndpointVersion)
    if ($identity.Message) { Write-Host $identity.Message -ForegroundColor Yellow }
    Write-Host 'Snapshot only. No machine selection, local fallback, prompts, or focus changes.'
    Write-Host 'Esc or Q closes.'
    if (-not $TestRender) {
        do { $key = Read-CockpitKey } while ($key.Key -notin @([ConsoleKey]::Escape, [ConsoleKey]::Q))
    }
}
