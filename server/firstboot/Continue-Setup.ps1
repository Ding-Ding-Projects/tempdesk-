<#
.SYNOPSIS
    Stage 2 of the fully unattended TempDesk server install. Runs as SYSTEM at every startup
    (scheduled task "\TempDesk\TempDesk Setup") until the server is ready, then removes itself.

.DESCRIPTION
    After the forest reboot:
      1. waits for Active Directory Web Services
      2. runs Initialize-TempDesk.ps1 (OUs, groups, GPOs, SYSVOL, reaper)
      3. builds and installs the TempDesk Agent service (agent\install.ps1)
      4. optionally hosts the guest portal and admin console natively on this server (no Docker)
      5. removes the passwords from C:\TempDesk\firstboot.json, removes this task and writes READY
    Safe to re-run: every step is idempotent and the status file records where it stopped.
#>
$ErrorActionPreference = 'Stop'
$root = 'C:\TempDesk'
$data = 'C:\ProgramData\TempDesk'
New-Item -ItemType Directory -Force -Path "$data\logs" | Out-Null
Start-Transcript -Path ("$data\logs\continue-setup-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date)) | Out-Null
. (Join-Path $root 'SetupStatus.ps1')

try {
    $cfgPath = Join-Path $root 'firstboot.json'
    $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json

    if ((Get-CimInstance Win32_ComputerSystem).DomainRole -lt 4) {
        # Promotion did not happen (for example stage 1 failed before it). Try again.
        Set-SetupStatus -Stage 'forest' -State 'running' -Message 'Server is not a domain controller yet: creating the forest'
        $dsrm = ConvertTo-SecureString -String $cfg.dsrmPassword -AsPlainText -Force
        & (Join-Path $root 'server\Install-Forest.ps1') -DomainName $cfg.domainName -NetbiosName $cfg.netbiosName -SafeModePassword $dsrm -FunctionalLevel ([string]$cfg.functionalLevel)
        return
    }

    Set-SetupStatus -Stage 'adws' -State 'running' -Message 'Waiting for Active Directory to come online'
    Import-Module ActiveDirectory
    $deadline = (Get-Date).AddMinutes(30)
    while ($true) {
        try { Get-ADDomain | Out-Null; break }
        catch {
            if ((Get-Date) -gt $deadline) { throw 'Active Directory Web Services did not start within 30 minutes.' }
            Start-Sleep -Seconds 15
        }
    }

    Set-SetupStatus -Stage 'domain' -State 'running' -Message 'Creating TempDesk OUs, groups and Group Policy'
    & (Join-Path $root 'server\Initialize-TempDesk.ps1') -ClientScripts (Join-Path $root 'client') -AdminUser ([string]$cfg.initialAdminUser)

    Set-SetupStatus -Stage 'agent' -State 'running' -Message 'Building and installing the TempDesk Agent service'
    $agentArgs = @{}
    if ($cfg.agent -and $cfg.agent.tls) { $agentArgs.Tls = $true }
    & (Join-Path $root 'agent\install.ps1') @agentArgs -SettingsTemplate (Join-Path $root 'server\config\settings.default.json')

    if ($cfg.portals -and $cfg.portals.mode -eq 'native') {
        Set-SetupStatus -Stage 'portals' -State 'running' -Message 'Installing the portals natively on this server'
        & (Join-Path $root 'server\Install-NativePortals.ps1') -PortalSource (Join-Path $root 'portal')
    }

    # Remove secrets from the local copy of the answer data.
    $clean = $cfg | Select-Object -Property * -ExcludeProperty dsrmPassword, administratorPassword
    # The file may still be read-only when it was copied from a CD or ISO by an older first-logon step.
    $cfgItem = Get-Item -LiteralPath $cfgPath -Force
    if ($cfgItem.IsReadOnly) { $cfgItem.IsReadOnly = $false }
    $clean | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $cfgPath -Encoding utf8

    Unregister-ScheduledTask -TaskName 'TempDesk Setup' -TaskPath '\TempDesk\' -Confirm:$false
    $ip = $cfg.ipAddress
    $port = if ($cfg.agent -and $cfg.agent.tls) { 8443 } else { 8080 }
    $msg = "TempDesk is ready. Agent: http$(if ($port -eq 8443) {'s'})://${ip}:$port/api/v1/health"
    if ($cfg.portals -and $cfg.portals.mode -eq 'native') { $msg += "  Guest portal: http://${ip}:8081  Admin console: http://${ip}:8082" }
    Set-SetupStatus -Stage 'ready' -State 'ready' -Message $msg
    Set-Content -LiteralPath "$data\READY.txt" -Value $msg
    # Show it on the server console sign-in screen as well.
    Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'legalnoticecaption' -Value 'TempDesk'
    Set-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' -Name 'legalnoticetext' -Value $msg
}
catch {
    Set-SetupStatus -Stage 'continue' -State 'failed' -Message $_.Exception.Message
    Write-Error $_
}
finally {
    Stop-Transcript | Out-Null
}
