<#
.SYNOPSIS
    Starts the guest portal, admin console and app streaming with docker compose, on this PC
    (Docker Desktop) or on the Linux host over SSH, and checks the agent health.

.DESCRIPTION
    Uses the env files written by the deploy phases (deployment folder: portal\.env.guest,
    portal\.env.admin, streaming\.env). The portal compose project is expected at portal/compose.yaml
    and reads .env.guest and .env.admin from its own folder (see portal/README.md).
#>
Set-StrictMode -Version 3

function Get-TdPortalUrls {
    param([Parameter(Mandatory)][string] $HostName, [int] $GuestPort = 8080, [int] $AdminPort = 8081, [int] $StreamingPort = 8090)
    [ordered]@{
        guest     = 'http://{0}:{1}/' -f $HostName, $GuestPort
        admin     = 'http://{0}:{1}/' -f $HostName, $AdminPort
        streaming = 'http://{0}:{1}/' -f $HostName, $StreamingPort
    }
}

function Invoke-TdHealthCheck {
    <#
    GET /api/v1/health on the agent. Returns the parsed body or throws.
    With -CertSha256 the agent is reached over HTTPS and its certificate must match that pin.
    -Key is the guest key: the API contract requires X-TempDesk-Key on every route, health included.
    #>
    param([Parameter(Mandatory)][string] $AgentUrl, [int] $TimeoutSec = 10, [string] $CertSha256 = '', [string] $Key = '')
    $u = $AgentUrl.TrimEnd('/')
    if ($u -notmatch '/api/v1$') { $u += '/api/v1' }
    if ($Key -and $Key -notmatch '^[!-~]{1,256}$') { throw 'The saved agent key is not valid.' }
    if (-not $CertSha256) {
        $headers = @{}
        if ($Key) { $headers['X-TempDesk-Key'] = $Key }
        return Invoke-RestMethod -Uri ($u + '/health') -Method Get -Headers $headers -TimeoutSec $TimeoutSec -ErrorAction Stop
    }
    $uri = [Uri]($u + '/health')
    $tcp = New-Object System.Net.Sockets.TcpClient
    try {
        $tcp.ReceiveTimeout = $TimeoutSec * 1000; $tcp.SendTimeout = $TimeoutSec * 1000
        $tcp.Connect($uri.Host, $uri.Port)
        # The certificate is checked against the pin right after the handshake, before anything is sent.
        $ssl = New-Object System.Net.Security.SslStream($tcp.GetStream(), $false, ([System.Net.Security.RemoteCertificateValidationCallback] { param($a, $b, $c, $d) $true }))
        $ssl.AuthenticateAsClient($uri.Host)
        $sha = [System.Security.Cryptography.SHA256]::Create()
        try { $seen = -join ($sha.ComputeHash($ssl.RemoteCertificate.GetRawCertData()) | ForEach-Object { $_.ToString('x2') }) } finally { $sha.Dispose() }
        if ($seen -ne $CertSha256.ToLowerInvariant()) { throw 'The agent certificate does not match the saved fingerprint.' }
        $keyLine = if ($Key) { "X-TempDesk-Key: $Key`r`n" } else { '' }
        $req = [Text.Encoding]::ASCII.GetBytes(("GET {0} HTTP/1.0`r`nHost: {1}`r`nAccept: application/json`r`n{2}`r`n" -f $uri.AbsolutePath, $uri.Host, $keyLine))
        $ssl.Write($req, 0, $req.Length); $ssl.Flush()
        $ms = New-Object System.IO.MemoryStream
        $buf = New-Object byte[] 8192
        while (($n = $ssl.Read($buf, 0, $buf.Length)) -gt 0) { $ms.Write($buf, 0, $n); if ($ms.Length -gt 1MB) { throw 'The health reply is too large.' } }
        $text = [Text.Encoding]::UTF8.GetString($ms.ToArray())
        $cut = $text.IndexOf("`r`n`r`n")
        if ($cut -lt 0 -or $text -notmatch '^HTTP/1\.[01] 200') { throw ('The agent health check failed: ' + ($text -split "`r`n")[0]) }
        $body = $text.Substring($cut + 4)
        $a = $body.IndexOf('{'); $z = $body.LastIndexOf('}')
        if ($a -lt 0 -or $z -lt $a) { throw 'The agent health reply is not JSON.' }
        $body.Substring($a, $z - $a + 1) | ConvertFrom-Json
    }
    finally { $tcp.Close() }
}

function Start-TdPortalsLocal {
    param([Parameter(Mandatory)][string] $PayloadRoot, [Parameter(Mandatory)][string] $Directory, [string] $WorkDir)
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) { throw 'Docker was not found. Install Docker Desktop, start it, and try again.' }
    if (-not $WorkDir) { $WorkDir = Join-Path $Directory 'run' }
    New-TdProtectedDirectory -Path $WorkDir | Out-Null
    foreach ($f in @('portal', 'streaming')) {
        $dst = Join-Path $WorkDir $f
        if (Test-Path -LiteralPath $dst) { Remove-Item -LiteralPath $dst -Recurse -Force }
        Copy-Item -LiteralPath (Join-Path $PayloadRoot $f) -Destination $dst -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $Directory 'portal\.env.guest') -Destination (Join-Path $WorkDir 'portal\.env.guest') -Force
    Copy-Item -LiteralPath (Join-Path $Directory 'portal\.env.admin') -Destination (Join-Path $WorkDir 'portal\.env.admin') -Force
    Copy-Item -LiteralPath (Join-Path $Directory 'streaming\.env') -Destination (Join-Path $WorkDir 'streaming\.env') -Force
    foreach ($f in @('streaming', 'portal')) {
        Push-Location (Join-Path $WorkDir $f)
        try {
            & $docker.Source compose up -d --build 2>&1 | ForEach-Object { Write-TdLog ([string]$_) }
            if ($LASTEXITCODE -ne 0) { throw "docker compose up failed in $f (exit $LASTEXITCODE)." }
        } finally { Pop-Location }
    }
}

function Start-TdPortalsRemote {
    param([Parameter(Mandatory)] $Ssh, [Parameter(Mandatory)][string] $Directory, [string] $RemoteDir = 'tempdesk')
    $q = ConvertTo-TdShellQuote $RemoteDir
    foreach ($pair in @(@('portal\.env.guest', 'portal/.env.guest'), @('portal\.env.admin', 'portal/.env.admin'), @('streaming\.env', 'streaming/.env'))) {
        $text = Get-Content -LiteralPath (Join-Path $Directory $pair[0]) -Raw
        Invoke-TdSsh -Ssh $Ssh -Command ("umask 077 && cat > $q/" + $pair[1]) -InputText $text -Quiet | Out-Null
    }
    Invoke-TdSsh -Ssh $Ssh -Command ("cd $q/streaming && docker compose up -d 2>&1 && cd ../portal && docker compose up -d --build 2>&1") | Out-Null
}

Export-ModuleMember -Function Get-TdPortalUrls, Invoke-TdHealthCheck, Start-TdPortalsLocal, Start-TdPortalsRemote
