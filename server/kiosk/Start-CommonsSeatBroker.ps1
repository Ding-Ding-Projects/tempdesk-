<#
.SYNOPSIS
    Runs the fixed HTTPS seat endpoints on one dedicated Windows 11 workstation.
.DESCRIPTION
    Run as LocalSystem from an administrator-protected installation. Supply
    the portal host IP and an HTTP.sys HTTPS binding for this workstation FQDN.
    The operator creates protected broker.key and initializes state once.
#>
[CmdletBinding(DefaultParameterSetName='Listen')]
param(
    [Parameter(Mandatory)][string]$DomainDns,
    [Parameter(Mandatory,ParameterSetName='Listen')][ipaddress]$PortalAddress,
    [Parameter(ParameterSetName='Listen')][ValidateRange(1024,65535)][int]$Port=9443,
    [Parameter(Mandatory,ParameterSetName='Initialize')][switch]$Initialize
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell 5.1.' }
if ([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-18') { throw 'The broker requires its protected LocalSystem service identity.' }
$script:SeatDomain = $DomainDns
$script:SeatComputer = $env:COMPUTERNAME
$script:SeatTarget = ("{0}.{1}" -f $script:SeatComputer,$DomainDns).ToLowerInvariant()
$script:SeatDirectory = Join-Path $env:ProgramData 'TempDesk/seat'
. (Join-Path $PSScriptRoot '../apphost/VirtualCommonsHost.ps1')
. (Join-Path $PSScriptRoot 'SeatAuthorization.ps1')
. (Join-Path $PSScriptRoot 'SeatTransitions.ps1')
. (Join-Path $PSScriptRoot 'SeatSessions.ps1')
Set-TdVirtualCommonsLocale -Language en
Assert-SeatStorage
$lock = [IO.File]::Open((Join-Path $script:SeatDirectory 'broker.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
$listener = $null
try {
    Initialize-SeatSessionReader
    if ($Initialize) {
        Assert-SeatHost
        Assert-SeatEmptySessions
        if (@(Get-SeatMembers).Count) { throw 'Initialize only an empty workstation.' }
        Save-SeatState (New-SeatState) -Initialize
        return
    }
    $null = Get-SeatState
    $key = [IO.File]::ReadAllText((Join-Path $script:SeatDirectory 'broker.key')).Trim()
    if ($key -cnotmatch '^[a-zA-Z0-9_-]{43,128}$') { throw 'Invalid broker credential file.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    $expected = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes("Bearer $key"))
    $key = $null
    $listener = [Net.HttpListener]::new()
    $listener.Prefixes.Add("https://${script:SeatTarget}:$Port/")
    $listener.TimeoutManager.HeaderWait = [timespan]::FromSeconds(5)
    $listener.TimeoutManager.EntityBody = [timespan]::FromSeconds(5)
    $listener.Start()
    $pending = $listener.GetContextAsync()
    $maintenance = [datetime]::MinValue
    while ($listener.IsListening) {
        if ([datetime]::UtcNow -ge $maintenance) {
            $state = Get-SeatState
            if ($state.state -eq 'revoking' -or ($state.state -in @('assigned','granting') -and [datetimeoffset]::Parse($state.expiresAt) -le [datetimeoffset]::UtcNow)) {
                try { $null = Invoke-SeatTransition '/seat/cancel' $state } catch { }
            }
            $maintenance = [datetime]::UtcNow.AddSeconds(5)
        }
        if (-not $pending.Wait(1000)) { continue }
        $context = $pending.Result
        $pending = $listener.GetContextAsync()
        $req = $context.Request
        $res = $context.Response
        try {
            $res.StatusCode=403
            if (-not $req.IsSecureConnection -or -not $req.RemoteEndPoint.Address.MapToIPv6().Equals($PortalAddress.MapToIPv6())) { continue }
            $header = [string]$req.Headers['Authorization']
            if ($header.Length -gt 150) { continue }
            $actual = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($header))
            $difference=0
            for ($i=0; $i -lt $expected.Length; $i++) { $difference = $difference -bor ($expected[$i] -bxor $actual[$i]) }
            if ($difference -ne 0) { continue }
            $route = $req.RawUrl
            $res.StatusCode=404
            if ($route -ceq '/seat' -and $req.HttpMethod -ceq 'GET') { $body=$null }
            elseif ($route -cin @('/seat/reserve','/seat/assign','/seat/cancel') -and $req.HttpMethod -ceq 'POST') {
                $res.StatusCode=400
                if ($req.ContentLength64 -lt 2 -or $req.ContentLength64 -gt 2048 -or $req.ContentType -notmatch '^application/json(?:;|$)') { continue }
                $bytes = [byte[]]::new([int]$req.ContentLength64)
                $offset=0
                $deadline=[Diagnostics.Stopwatch]::StartNew()
                while ($offset -lt $bytes.Length) {
                    $operation=$req.InputStream.BeginRead($bytes,$offset,$bytes.Length-$offset,$null,$null)
                    $wait=$operation.AsyncWaitHandle
                    try {
                        if (-not $wait.WaitOne([math]::Max(0,5000-[int]$deadline.ElapsedMilliseconds))) { $req.InputStream.Close(); throw 'Request timed out.' }
                        $read=$req.InputStream.EndRead($operation)
                    } finally { $wait.Close() }
                    if (-not $read) { throw 'Incomplete request.' }
                    $offset += $read
                }
                $body = [Text.UTF8Encoding]::new($false,$true).GetString($bytes) | ConvertFrom-Json
                $fields = if ($route -ceq '/seat/assign') { @('lease','target','username','expiresAt') } else { @('lease','target') }
                if ($body -isnot [pscustomobject] -or $body.PSObject.Properties.Name.Count -ne $fields.Count) { continue }
                if (@($fields | Where-Object { $body.$_ -isnot [string] }).Count) { continue }
            } else { continue }
            $res.StatusCode=409
            $result = Invoke-SeatTransition $route $body
            $output = [Text.Encoding]::UTF8.GetBytes(($result | ConvertTo-Json -Compress))
            $res.StatusCode=200
            $res.ContentType='application/json'
            $res.Headers['Cache-Control']='no-store'
            $res.ContentLength64=$output.Length
            $res.OutputStream.Write($output,0,$output.Length)
        } catch {
            if ($res.StatusCode -eq 200) { $res.Abort() }
        } finally { $res.Close() }
    }
} finally {
    if ($listener) { $listener.Close() }
    if ($sha) { $sha.Dispose() }
    $lock.Dispose()
}
