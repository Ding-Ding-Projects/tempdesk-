<#
.SYNOPSIS
    Stage 1 of the fully unattended TempDesk server install (Windows Server 2025 Core).
    Windows Setup runs it once at the first automatic sign-in, from the TempDesk install media.

.DESCRIPTION
    1. Copies the TempDesk folder from the install media to C:\TempDesk (Administrators only).
    2. Applies the static IPv4 settings from firstboot.json.
    3. Enables PowerShell remoting (WinRM HTTP 5985) so the Deployer can watch progress.
    4. Registers the "TempDesk Setup" startup task (Continue-Setup.ps1) that finishes everything
       after each reboot: domain setup, policies, agent and optional portals.
    5. Promotes the server to the first domain controller of the new forest. The server reboots.
    Progress: C:\ProgramData\TempDesk\setup-status.json and C:\ProgramData\TempDesk\logs\.
#>
$ErrorActionPreference = 'Stop'
$data = 'C:\ProgramData\TempDesk'
New-Item -ItemType Directory -Force -Path "$data\logs" | Out-Null
Start-Transcript -Path "$data\logs\firstlogon.log" -Append | Out-Null
. (Join-Path $PSScriptRoot 'SetupStatus.ps1')
try {
    Set-SetupStatus -Stage 'copy' -State 'running' -Message 'Copying TempDesk files from the install media'
    $target = 'C:\TempDesk'
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    & icacls.exe $target /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    Copy-Item -Path (Join-Path $PSScriptRoot '*') -Destination $target -Recurse -Force
    $cfg = Get-Content -LiteralPath (Join-Path $target 'firstboot.json') -Raw | ConvertFrom-Json

    # --- Static IP ---------------------------------------------------------------------------
    Set-SetupStatus -Stage 'network' -State 'running' -Message 'Configuring the network'
    $nic = Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | Sort-Object ifIndex | Select-Object -First 1
    if (-not $nic) { $nic = Get-NetAdapter | Where-Object Status -eq 'Up' | Sort-Object ifIndex | Select-Object -First 1 }
    if ($cfg.ipAddress -and $nic) {
        Set-NetIPInterface -InterfaceIndex $nic.ifIndex -Dhcp Disabled
        Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
        Get-NetRoute -InterfaceIndex $nic.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
        New-NetIPAddress -InterfaceIndex $nic.ifIndex -IPAddress $cfg.ipAddress -PrefixLength ([int]$cfg.prefixLength) -DefaultGateway $cfg.gateway | Out-Null
        Set-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -ServerAddresses @($cfg.dnsServers)
    }

    # --- Remoting (plain HTTP by owner choice; Windows encrypts at the message level) -------
    Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private
    Enable-PSRemoting -Force -SkipNetworkProfileCheck | Out-Null
    Enable-NetFirewallRule -Name 'WINRM-HTTP-In-TCP' -ErrorAction SilentlyContinue

    # --- Continue after every reboot until ready -------------------------------------------
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$target\Continue-Setup.ps1`""
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $set = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Hours 2) -StartWhenAvailable
    Register-ScheduledTask -TaskName 'TempDesk Setup' -TaskPath '\TempDesk\' -Action $action -Trigger $trigger -Principal $principal -Settings $set -Force | Out-Null

    # --- Turn off Setup's one-time automatic sign-in -----------------------------------------
    $wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    Set-ItemProperty -Path $wl -Name AutoAdminLogon -Value '0'
    Remove-ItemProperty -Path $wl -Name DefaultPassword -ErrorAction SilentlyContinue

    # --- Promote ---------------------------------------------------------------------------
    Set-SetupStatus -Stage 'forest' -State 'running' -Message "Creating the forest $($cfg.domainName). The server restarts when this finishes."
    $dsrm = ConvertTo-SecureString -String $cfg.dsrmPassword -AsPlainText -Force
    & (Join-Path $target 'server\Install-Forest.ps1') -DomainName $cfg.domainName -NetbiosName $cfg.netbiosName -SafeModePassword $dsrm -FunctionalLevel ([string]$cfg.functionalLevel)
}
catch {
    Set-SetupStatus -Stage 'firstlogon' -State 'failed' -Message $_.Exception.Message
    Write-Error $_
}
finally {
    Stop-Transcript | Out-Null
}
