#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Hosts the TempDesk guest portal and admin console directly on the server, without Docker.

.DESCRIPTION
    For a single-box setup on Windows Server Core. Installs Python (official python.org installer,
    signature checked), creates a virtual environment in C:\Program Files\TempDesk\Portal, and
    registers two startup tasks that keep the portals running:
      * TempDesk Guest Portal  -> http://<server>:8081  (PORTAL_MODE=guest, guest key)
      * TempDesk Admin Console -> http://<server>:8082  (PORTAL_MODE=admin, admin key)
    Both talk to the local agent at http://127.0.0.1:8080, so the agent keys never cross the network.
    Docker remains the recommended way to run the portals on another machine.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $PortalSource,
    [string] $PythonVersion = '3.12.10',
    [int] $GuestPort = 8081,
    [int] $AdminPort = 8082
)
$ErrorActionPreference = 'Stop'
$installDir = Join-Path $env:ProgramFiles 'TempDesk\Portal'
$dataDir = Join-Path $env:ProgramData 'TempDesk\portal-data'
New-Item -ItemType Directory -Force -Path $installDir, $dataDir | Out-Null
& icacls.exe $dataDir /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-20:(OI)(CI)M' | Out-Null

# --- Python ---------------------------------------------------------------------------------
$python = Join-Path $env:ProgramFiles 'Python312\python.exe'
if (-not (Test-Path $python)) {
    $url = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-amd64.exe"
    $tmp = Join-Path $env:TEMP "python-$PythonVersion-amd64.exe"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp
    $sig = Get-AuthenticodeSignature -FilePath $tmp
    if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notmatch 'Python Software Foundation') {
        throw "Python installer signature check failed: $($sig.Status)"
    }
    $p = Start-Process -FilePath $tmp -ArgumentList '/quiet InstallAllUsers=1 PrependPath=0 Include_test=0 Include_launcher=0' -Wait -PassThru
    if ($p.ExitCode -ne 0) { throw "Python installer exit code $($p.ExitCode)" }
    Remove-Item -LiteralPath $tmp -Force
}

# --- Portal code and virtual environment ----------------------------------------------------
Copy-Item -Path (Join-Path $PortalSource '*') -Destination $installDir -Recurse -Force
$venv = Join-Path $installDir '.venv'
if (-not (Test-Path (Join-Path $venv 'Scripts\python.exe'))) { & $python -m venv $venv }
& (Join-Path $venv 'Scripts\python.exe') -m pip install --disable-pip-version-check -q -r (Join-Path $installDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip install failed.' }

# --- Configuration from the agent's keys ----------------------------------------------------
$agent = Get-Content -LiteralPath (Join-Path $env:ProgramData 'TempDesk\agent.json') -Raw | ConvertFrom-Json
$agentUrl = 'http://127.0.0.1:{0}' -f ($(if ($agent.port) { $agent.port } else { 8080 }))
$secretBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($secretBytes)
$sessionSecret = [Convert]::ToBase64String($secretBytes)

function Write-Env([string] $Path, [hashtable] $Values) {
    ($Values.GetEnumerator() | Sort-Object Name | ForEach-Object { '{0}={1}' -f $_.Name, $_.Value }) -join "`r`n" |
        Set-Content -LiteralPath $Path -Encoding ascii
    # SYSTEM and Administrators full control, NETWORK SERVICE (the portals' account) read only.
    & icacls.exe $Path /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' '*S-1-5-20:R' | Out-Null
}
Write-Env (Join-Path $dataDir 'guest.env') @{ PORTAL_MODE = 'guest'; AGENT_URL = $agentUrl; AGENT_KEY = $agent.guestKey; PORT = $GuestPort; PORTAL_DATA_DIR = $dataDir }
Write-Env (Join-Path $dataDir 'admin.env') @{ PORTAL_MODE = 'admin'; AGENT_URL = $agentUrl; AGENT_KEY = $agent.adminKey; PORT = $AdminPort; SESSION_SECRET = $sessionSecret; PORTAL_DATA_DIR = $dataDir }

# --- Runner script and startup tasks --------------------------------------------------------
$runner = Join-Path $installDir 'Start-Portal.ps1'
@'
param([Parameter(Mandatory)] [string] $EnvFile)
Get-Content -LiteralPath $EnvFile | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
Set-Location -LiteralPath $PSScriptRoot
while ($true) {
    & (Join-Path $PSScriptRoot '.venv\Scripts\python.exe') -m uvicorn app.main:app --host 0.0.0.0 --port $env:PORT --proxy-headers
    Start-Sleep -Seconds 5   # restart after a crash
}
'@ | Set-Content -LiteralPath $runner -Encoding utf8

foreach ($p in @(@('TempDesk Guest Portal', 'guest.env', $GuestPort), @('TempDesk Admin Console', 'admin.env', $AdminPort))) {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`" -EnvFile `"{1}`"" -f $runner, (Join-Path $dataDir $p[1]))
    $trigger = New-ScheduledTaskTrigger -AtStartup
    # Least privilege: the portals only need the network and their data folder, not SYSTEM.
    $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\NETWORK SERVICE' -LogonType ServiceAccount
    $set = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
    Register-ScheduledTask -TaskName $p[0] -TaskPath '\TempDesk\' -Action $action -Trigger $trigger -Principal $principal -Settings $set -Force | Out-Null
    Start-ScheduledTask -TaskName $p[0] -TaskPath '\TempDesk\'
    $rule = "TempDesk-Portal-$($p[2])"
    if (-not (Get-NetFirewallRule -Name $rule -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -Name $rule -DisplayName "TempDesk: $($p[0]) (HTTP $($p[2]))" -Protocol TCP -LocalPort $p[2] -Direction Inbound -Action Allow -Profile Domain, Private | Out-Null
    }
}
Write-Host "Portals running: guest http://$($env:COMPUTERNAME):$GuestPort  admin http://$($env:COMPUTERNAME):$AdminPort" -ForegroundColor Green
