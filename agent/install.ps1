<#
.SYNOPSIS
  Installs (or uninstalls) the TempDesk Agent on a domain controller.

.DESCRIPTION
  Must be run elevated on the domain controller. The default transport is plain
  HTTP on port 8080, which needs no certificate. Pass -Tls to use HTTPS on port
  8443 with a self-signed certificate instead. The script is idempotent: running
  it again updates the binaries and leaves existing keys and settings in place.

  Steps (install):
    1. Build the agent (build.ps1).
    2. Copy binaries to C:\Program Files\TempDesk\Agent.
    3. Create C:\ProgramData\TempDesk with an ACL limited to SYSTEM and
       Administrators.
    4. Generate agent.json with random keys and HMAC secret if it is missing.
    5. Copy settings.default.json to settings.json if it is missing.
    6. HTTPS only: create a self-signed certificate (5 year lifetime) and bind
       it to the port with netsh; export the public certificate.
    7. Open the firewall for the chosen port (Domain and Private profiles).
    8. Register the event log source.
    9. Create or update the service, set recovery to restart, and start it.
   10. Print a summary.

.PARAMETER Tls
  Use HTTPS on 8443 with a self-signed certificate. Without it the agent serves
  plain HTTP on 8080.

.PARAMETER Uninstall
  Remove the service, the firewall rule and (HTTPS) the SSL binding. ProgramData
  is kept unless -Purge is also given.

.PARAMETER Purge
  With -Uninstall, also delete C:\ProgramData\TempDesk (keys, settings, backups).

.PARAMETER SettingsTemplate
  Path to the settings template copied to settings.json on first install.
#>
[CmdletBinding()]
param(
    [switch]$Tls,
    [switch]$Uninstall,
    [switch]$Purge,
    [string]$SettingsTemplate = (Join-Path $PSScriptRoot '..\server\config\settings.default.json'),
    [int]$Port = 0
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
$ServiceName   = 'TempDeskAgent'
$DisplayName   = 'TempDesk Agent'
$EventSource   = 'TempDesk Agent'
$InstallDir    = 'C:\Program Files\TempDesk\Agent'
$DataDir       = 'C:\ProgramData\TempDesk'
$ConfigPath    = Join-Path $DataDir 'agent.json'
$SettingsPath  = Join-Path $DataDir 'settings.json'
$CertExport    = Join-Path $DataDir 'agent-cert.cer'
$BackupPath    = Join-Path $DataDir 'gpo-backups'
$AppId         = '{4b6f0b8e-6f5a-4d84-9d3c-1a1e3f5e7d21}'
$HttpsPort     = 8443
$HttpPort      = 8080

function Assert-Admin {
    $id = [System.Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object System.Security.Principal.WindowsPrincipal($id)
    if (-not $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This script must be run as an administrator (elevated) on the domain controller.'
    }
}

function New-RandomKey {
    # 32 random bytes as URL-safe base64 without padding.
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RNGCryptoServiceProvider]::new().GetBytes($bytes)
    $b64 = [Convert]::ToBase64String($bytes)
    return $b64.TrimEnd('=').Replace('+','-').Replace('/','_')
}

function New-RandomSecretB64 {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RNGCryptoServiceProvider]::new().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Get-DomainDn {
    try {
        return ([ADSI]'LDAP://RootDSE').defaultNamingContext[0]
    } catch {
        throw "Could not read the domain DN from RootDSE. Run this on a domain controller. ($_)"
    }
}

function Get-SysvolWifiPath {
    param([string]$dnsDomain)
    return "\\$dnsDomain\SYSVOL\$dnsDomain\TempDesk\wifi"
}

function Get-SysvolScriptsPath {
    param([string]$dnsDomain)
    return "\\$dnsDomain\SYSVOL\$dnsDomain\TempDesk\scripts"
}

# ---------------------------------------------------------------------------
# Uninstall
# ---------------------------------------------------------------------------
function Invoke-Uninstall {
    Write-Host 'Uninstalling TempDesk Agent...'

    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        if ($svc.Status -ne 'Stopped') {
            Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
        }
        & sc.exe delete $ServiceName | Out-Null
        Write-Host "  Removed service $ServiceName"
    }

    foreach ($p in @($HttpsPort, $HttpPort)) {
        $null = & netsh http delete sslcert ipport=0.0.0.0:$p 2>$null
    }

    foreach ($ruleName in @('TempDesk Agent (HTTP)', 'TempDesk Agent (HTTPS)')) {
        $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
        if ($rule) {
            Remove-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
            Write-Host "  Removed firewall rule: $ruleName"
        }
    }

    if ($Purge) {
        if (Test-Path $DataDir) {
            Remove-Item -Path $DataDir -Recurse -Force
            Write-Host "  Purged $DataDir"
        }
    } else {
        Write-Host "  Kept $DataDir (use -Purge to remove it)."
    }

    Write-Host 'Uninstall complete.' -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
function Invoke-Install {
    $usePort = $Port
    if ($usePort -le 0) { $usePort = if ($Tls) { $HttpsPort } else { $HttpPort } }

    Write-Host 'Installing TempDesk Agent'
    Write-Host '========================='
    Write-Host ("Transport: {0} on port {1}" -f $(if ($Tls) { 'HTTPS' } else { 'HTTP' }), $usePort)

    # 1. Build.
    Write-Host 'Building...'
    & (Join-Path $PSScriptRoot 'build.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Build failed; see the output above.' }
    $builtExe = Join-Path $PSScriptRoot 'bin\TempDeskAgent.exe'
    if (-not (Test-Path $builtExe)) { throw "Build did not produce $builtExe." }

    # 2. Copy binaries.
    if (-not (Test-Path $InstallDir)) {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    # A running service keeps the executable locked: stop it first so installing again (an upgrade,
    # or setup continuing after a failure) can replace the file. It is started again further down, when the service is registered.
    $running = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($running -and $running.Status -ne 'Stopped') {
        Stop-Service -Name $ServiceName -Force
        $running.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(60))
    }
    Copy-Item -Path $builtExe -Destination (Join-Path $InstallDir 'TempDeskAgent.exe') -Force
    Write-Host "  Installed binaries to $InstallDir"
    $installedExe = Join-Path $InstallDir 'TempDeskAgent.exe'

    # 3. ProgramData with a tight ACL.
    if (-not (Test-Path $DataDir)) {
        New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
    }
    if (-not (Test-Path $BackupPath)) {
        New-Item -ItemType Directory -Path $BackupPath -Force | Out-Null
    }
    Set-TightAcl -Path $DataDir
    Write-Host "  Secured $DataDir (SYSTEM and Administrators only)"

    # 4. Domain facts.
    $domainDn  = Get-DomainDn
    $dnsDomain = ($domainDn -split ',' | ForEach-Object { ($_ -replace '^DC=','') }) -join '.'
    $fqdn      = [System.Net.Dns]::GetHostEntry($env:COMPUTERNAME).HostName
    $hostname  = $env:COMPUTERNAME

    # 5. agent.json (generated once; preserved on re-run).
    if (-not (Test-Path $ConfigPath)) {
        $config = [ordered]@{
            port         = $usePort
            tls          = [bool]$Tls
            guestKey     = (New-RandomKey)
            adminKey     = (New-RandomKey)
            hmacSecret   = (New-RandomSecretB64)
            domainDn     = $domainDn
            settingsPath = $SettingsPath
            wifiPath     = (Get-SysvolWifiPath -dnsDomain $dnsDomain)
            scriptsPath  = (Get-SysvolScriptsPath -dnsDomain $dnsDomain)
            backupPath   = $BackupPath
        }
        ($config | ConvertTo-Json -Depth 4) | Set-Content -Path $ConfigPath -Encoding UTF8
        Write-Host "  Generated $ConfigPath with new random keys"
    } else {
        # Keep keys, but make sure the transport fields match this run.
        $existing = Get-Content -Path $ConfigPath -Raw | ConvertFrom-Json
        $existing.port = $usePort
        $existing | Add-Member -NotePropertyName 'tls' -NotePropertyValue ([bool]$Tls) -Force
        ($existing | ConvertTo-Json -Depth 4) | Set-Content -Path $ConfigPath -Encoding UTF8
        Write-Host "  Updated transport in existing $ConfigPath (keys preserved)"
    }

    # 6. settings.json copied from the template once.
    if (-not (Test-Path $SettingsPath)) {
        if (-not (Test-Path $SettingsTemplate)) {
            throw "Settings template not found: $SettingsTemplate"
        }
        Copy-Item -Path $SettingsTemplate -Destination $SettingsPath -Force
        Write-Host "  Copied settings template to $SettingsPath"
    }

    # 7. TLS certificate and binding, or HTTP note.
    $certThumb = $null
    $certSha256 = $null
    if ($Tls) {
        $cert = New-SelfSignedCertificate -DnsName $fqdn, $hostname `
            -CertStoreLocation 'Cert:\LocalMachine\My' `
            -KeyExportPolicy NonExportable `
            -NotAfter (Get-Date).AddYears(5)
        $certThumb = $cert.Thumbprint
        $certSha256 = (Get-FileHash -InputStream ([System.IO.MemoryStream]::new($cert.RawData)) -Algorithm SHA256).Hash

        Export-Certificate -Cert $cert -FilePath $CertExport -Force | Out-Null

        # Rebind cleanly.
        $null = & netsh http delete sslcert ipport=0.0.0.0:$usePort 2>$null
        $add = & netsh http add sslcert ipport=0.0.0.0:$usePort certhash=$certThumb appid=$AppId
        if ($LASTEXITCODE -ne 0) { throw "netsh failed to bind the certificate: $add" }
        Write-Host "  Bound certificate $certThumb to 0.0.0.0:$usePort"
        Write-Host "  Exported public certificate to $CertExport"
    }

    # 8. Firewall.
    $ruleName = if ($Tls) { 'TempDesk Agent (HTTPS)' } else { 'TempDesk Agent (HTTP)' }
    $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $existingRule) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $usePort -Profile Domain,Private | Out-Null
        Write-Host "  Opened firewall TCP $usePort (Domain, Private) as '$ruleName'"
    }
    # A new Windows Server 2025 domain controller can stay on the Public network profile, where the
    # rule above does not apply and nothing else on the network can reach the agent. Allow the same
    # port on Public for the local subnet only.
    $publicRule = "$ruleName (Public profile, local subnet)"
    if (-not (Get-NetFirewallRule -DisplayName $publicRule -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $publicRule -Direction Inbound -Action Allow `
            -Protocol TCP -LocalPort $usePort -Profile Public -RemoteAddress LocalSubnet | Out-Null
        Write-Host "  Opened firewall TCP $usePort (Public, local subnet only) as '$publicRule'"
    }

    # 9. Event log source.
    if (-not [System.Diagnostics.EventLog]::SourceExists($EventSource)) {
        New-EventLog -LogName 'Application' -Source $EventSource
        Write-Host "  Registered event log source '$EventSource'"
    }

    # 10. Service create/update.
    $binPath = '"' + $installedExe + '"'
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        if ($svc.Status -ne 'Stopped') {
            Stop-Service -Name $ServiceName -Force
        }
        & sc.exe config $ServiceName binPath= $binPath start= auto | Out-Null
        Write-Host "  Updated existing service $ServiceName"
    } else {
        New-Service -Name $ServiceName -BinaryPathName $installedExe `
            -DisplayName $DisplayName -StartupType Automatic `
            -Description 'TempDesk Agent API for Active Directory and Group Policy.' | Out-Null
        Write-Host "  Created service $ServiceName"
    }
    # Recovery: restart on failure.
    & sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

    Start-Service -Name $ServiceName
    Write-Host "  Started service $ServiceName"

    # 10b. Administrative Templates central store so the ADMX service has the
    # full set of policies to serve. Seed from this machine's local image and,
    # when the DC can reach the Internet, merge the latest signed Microsoft MSI.
    $admxScript = Join-Path (Split-Path -Parent $PSScriptRoot) 'server\Install-AdmxCentralStore.ps1'
    if (Test-Path $admxScript) {
        Write-Host '  Setting up the Administrative Templates central store...'
        try {
            $download = $false
            try { $download = (Test-Connection -ComputerName 'download.microsoft.com' -Count 1 -Quiet -ErrorAction SilentlyContinue) } catch { }
            & $admxScript -Download:$download -Quiet
        } catch {
            Write-Warning "  ADMX central store setup skipped: $($_.Exception.Message)"
        }
    }

    # 11. Summary.
    Write-Host ''
    Write-Host 'TempDesk Agent installed.' -ForegroundColor Green
    Write-Host '---------------------------------------------'
    if ($Tls) {
        Write-Host ("  URL:              https://{0}:{1}/api/v1" -f $fqdn, $usePort)
        Write-Host ("  Cert SHA-256:     {0}" -f $certSha256)
        Write-Host ("  Public cert file: {0}" -f $CertExport)
    } else {
        Write-Host ("  URL:              http://{0}:{1}/api/v1" -f $fqdn, $usePort)
        Write-Host ''
        Write-Host '  WARNING: Plain HTTP is in use. API keys, admin sign-ins, guest' -ForegroundColor Yellow
        Write-Host '  passwords and Wi-Fi keys cross the LAN UNENCRYPTED. Keep the agent' -ForegroundColor Yellow
        Write-Host '  and portals on a trusted network segment, or re-run with -Tls.' -ForegroundColor Yellow
    }
    Write-Host ("  Keys and config:  {0}" -f $ConfigPath)
    Write-Host ("  Settings:         {0}" -f $SettingsPath)
    Write-Host '---------------------------------------------'
}

function Set-TightAcl {
    param([string]$Path)
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)  # disable inheritance, drop inherited

    $system = New-Object System.Security.Principal.SecurityIdentifier(
        [System.Security.Principal.WellKnownSidType]::LocalSystemSid, $null)
    $admins = New-Object System.Security.Principal.SecurityIdentifier(
        [System.Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)

    foreach ($sid in @($system, $admins)) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
             [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow)
        $acl.AddAccessRule($rule)
    }
    $acl.SetOwner($admins)
    Set-Acl -Path $Path -AclObject $acl
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
Assert-Admin
if ($Uninstall) {
    Invoke-Uninstall
} else {
    Invoke-Install
}
