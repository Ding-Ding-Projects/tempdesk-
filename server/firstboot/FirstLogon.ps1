<#
.SYNOPSIS
    First sign-in script for a new TempDesk server (Windows Server 2025 Core).
    Windows Setup runs it once, from the TempDesk install media, through FirstLogonCommands.

.DESCRIPTION
    * Applies the static IPv4 settings from TempDesk\firstboot.json on the media
    * Marks the network Private and enables PowerShell remoting (WinRM HTTP, port 5985)
      so the TempDesk Deployer can finish the setup from your PC
    * Turns off the one-time automatic sign-in used by Setup
    Logs to C:\ProgramData\TempDesk\logs\firstlogon.log.
#>
$ErrorActionPreference = 'Stop'
$logDir = 'C:\ProgramData\TempDesk\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Start-Transcript -Path (Join-Path $logDir 'firstlogon.log') -Append | Out-Null
try {
    $cfg = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'firstboot.json') -Raw | ConvertFrom-Json

    # --- Static IP on the first connected adapter -----------------------------------------
    $nic = Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | Sort-Object ifIndex | Select-Object -First 1
    if (-not $nic) { $nic = Get-NetAdapter | Where-Object Status -eq 'Up' | Sort-Object ifIndex | Select-Object -First 1 }
    if ($cfg.ipAddress) {
        Write-Host "Configuring $($nic.Name) with $($cfg.ipAddress)/$($cfg.prefixLength)"
        Set-NetIPInterface -InterfaceIndex $nic.ifIndex -Dhcp Disabled
        Get-NetIPAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false -ErrorAction SilentlyContinue
        Get-NetRoute -InterfaceIndex $nic.ifIndex -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Remove-NetRoute -Confirm:$false -ErrorAction SilentlyContinue
        New-NetIPAddress -InterfaceIndex $nic.ifIndex -IPAddress $cfg.ipAddress -PrefixLength ([int]$cfg.prefixLength) -DefaultGateway $cfg.gateway | Out-Null
        Set-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -ServerAddresses @($cfg.dnsServers)
    }

    # --- Remoting (WinRM over HTTP, port 5985) -------------------------------------------
    # Owner choice: plain HTTP so no certificate is needed. Windows still encrypts the remoting
    # traffic at the message level with NTLM/Kerberos session keys.
    Get-NetConnectionProfile | Set-NetConnectionProfile -NetworkCategory Private
    Enable-PSRemoting -Force -SkipNetworkProfileCheck | Out-Null
    Enable-NetFirewallRule -Name 'WINRM-HTTP-In-TCP' -ErrorAction SilentlyContinue
    Write-Host 'WinRM HTTP listener ready on port 5985.'

    # --- Clean up Setup's automatic sign-in ------------------------------------------------
    $wl = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon'
    Set-ItemProperty -Path $wl -Name AutoAdminLogon -Value '0'
    Remove-ItemProperty -Path $wl -Name DefaultPassword -ErrorAction SilentlyContinue

    Set-Content -LiteralPath 'C:\ProgramData\TempDesk\firstboot.done' -Value (Get-Date -Format o)
    Write-Host 'First sign-in setup complete. Run the TempDesk Deployer "Deploy" step from your PC.' -ForegroundColor Green
}
catch {
    Write-Error $_
}
finally {
    Stop-Transcript | Out-Null
}
