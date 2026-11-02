#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Configures a freshly promoted domain controller for TempDesk.

.DESCRIPTION
    Run once after Install-Forest.ps1 and the reboot, signed in as a domain administrator.
    Safe to re-run: every step checks what already exists.

    Creates:
      * OU=TempDesk with child OUs Guests and Computers (protected from accidental deletion)
      * Groups "TempDesk Guests" and "TempDesk Admins"
      * SYSVOL folder TempDesk\{wifi,scripts\startup,scripts\logon,client} with locked-down ACLs
      * GPO "TempDesk - Guest Computers" (startup script: Wi-Fi profiles, session watcher, profile cleanup)
      * GPO "TempDesk - Guest User Policy" (standard user, app allowlist, logon scripts)
      * Scheduled task "TempDesk Guest Reaper" that deletes expired guest accounts

.PARAMETER RedirectNewComputers
    Sends newly joined computers to OU=Computers,OU=TempDesk so the computer GPO applies to them.

.PARAMETER AdminUser
    Optional account to add to TempDesk Admins (it can then sign in to the admin console).
#>
[CmdletBinding()]
param(
    [string] $SettingsTemplate = (Join-Path $PSScriptRoot 'config\settings.default.json'),
    [string] $ClientScripts = (Join-Path $PSScriptRoot '..\client'),
    [string] $AdminUser = 'Administrator',
    [switch] $RedirectNewComputers = $true
)

$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory, GroupPolicy
Import-Module (Join-Path $PSScriptRoot 'TempDesk.Gpo.psm1') -Force

$dataDir = Join-Path $env:ProgramData 'TempDesk'
New-Item -ItemType Directory -Force -Path (Join-Path $dataDir 'logs') | Out-Null
Start-Transcript -Path (Join-Path $dataDir ("logs\initialize-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))) -Append | Out-Null

function Write-Step([string] $Text) { Write-Host "==> $Text" -ForegroundColor Cyan }

try {
    $domain = Get-ADDomain
    $domainDn = $domain.DistinguishedName
    $dns = $domain.DNSRoot
    $netbios = $domain.NetBIOSName

    # --- Settings --------------------------------------------------------------------------
    $settingsPath = Join-Path $dataDir 'settings.json'
    if (-not (Test-Path $settingsPath)) { Copy-Item -LiteralPath $SettingsTemplate -Destination $settingsPath }
    $settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json

    # --- OUs -------------------------------------------------------------------------------
    Write-Step 'Organizational units'
    function Ensure-OU([string] $Name, [string] $Parent) {
        $dn = "OU=$Name,$Parent"
        if (-not (Get-ADOrganizationalUnit -Filter "DistinguishedName -eq '$dn'" -ErrorAction SilentlyContinue)) {
            New-ADOrganizationalUnit -Name $Name -Path $Parent -ProtectedFromAccidentalDeletion $true
            Write-Host "    created $dn"
        }
        $dn
    }
    $rootOu = Ensure-OU 'TempDesk' $domainDn
    $guestOuDn = "$($settings.guestOu),$domainDn"
    $computersOuDn = "$($settings.computersOu),$domainDn"
    foreach ($ouDn in @($guestOuDn, $computersOuDn)) {
        $first = ($ouDn -split ',', 2)
        Ensure-OU ($first[0] -replace '^OU=') $first[1] | Out-Null
    }

    # --- Groups ----------------------------------------------------------------------------
    Write-Step 'Groups'
    foreach ($g in @($settings.guestGroup, $settings.adminGroup)) {
        if (-not (Get-ADGroup -Filter "Name -eq '$g'" -ErrorAction SilentlyContinue)) {
            New-ADGroup -Name $g -SamAccountName ($g -replace '\s', '') -GroupScope Global -GroupCategory Security -Path $rootOu
            Write-Host "    created $g"
        }
    }
    if ($AdminUser) {
        Add-ADGroupMember -Identity ($settings.adminGroup -replace '\s', '') -Members $AdminUser -ErrorAction SilentlyContinue
    }

    # The AD Recycle Bin lets the admin console undo deletions (Restore-ADObject keeps all attributes).
    Write-Step 'Active Directory Recycle Bin'
    $rb = Get-ADOptionalFeature -Filter "Name -eq 'Recycle Bin Feature'"
    if (-not $rb.EnabledScopes) {
        Enable-ADOptionalFeature -Identity 'Recycle Bin Feature' -Scope ForestOrConfigurationSet -Target $domain.Forest -Confirm:$false
        Write-Host '    enabled (this cannot be turned off)'
    }

    if ($RedirectNewComputers) {
        Write-Step 'Redirecting newly joined computers to the TempDesk Computers OU'
        & redircmp.exe $computersOuDn | Out-Host
    }

    # --- SYSVOL folders --------------------------------------------------------------------
    Write-Step 'SYSVOL folders'
    $sysvolTd = "C:\Windows\SYSVOL\domain\TempDesk"
    foreach ($sub in 'wifi', 'scripts\startup', 'scripts\logon', 'client') {
        New-Item -ItemType Directory -Force -Path (Join-Path $sysvolTd $sub) | Out-Null
    }
    $admins = "$netbios\Domain Admins"
    # Wi-Fi keys are readable by computers only (startup scripts run as SYSTEM), never by guests.
    Set-TempDeskFolderAcl -Path (Join-Path $sysvolTd 'wifi') -Rules @(
        @('NT AUTHORITY\SYSTEM', 'FullControl'), @($admins, 'FullControl'),
        @("$netbios\Domain Computers", 'ReadAndExecute'), @("$netbios\Domain Controllers", 'ReadAndExecute'))
    # Startup scripts may contain secrets too: computers only.
    Set-TempDeskFolderAcl -Path (Join-Path $sysvolTd 'scripts\startup') -Rules @(
        @('NT AUTHORITY\SYSTEM', 'FullControl'), @($admins, 'FullControl'),
        @("$netbios\Domain Computers", 'ReadAndExecute'), @("$netbios\Domain Controllers", 'ReadAndExecute'))

    New-Item -ItemType Directory -Force -Path (Join-Path $sysvolTd 'software') | Out-Null

    Write-Step 'Copying client scripts to SYSVOL'
    Copy-Item -Path (Join-Path $ClientScripts '*.ps1') -Destination (Join-Path $sysvolTd 'client') -Force
    # Seed default presetup scripts (for example Google Chrome) without overwriting admin edits.
    foreach ($kind in 'startup', 'logon') {
        $defaults = Join-Path $ClientScripts "defaults\$kind"
        if (Test-Path $defaults) {
            foreach ($f in Get-ChildItem -LiteralPath $defaults -File) {
                $dest = Join-Path $sysvolTd "scripts\$kind\$($f.Name)"
                if (-not (Test-Path $dest)) { Copy-Item -LiteralPath $f.FullName -Destination $dest; Write-Host "    seeded $kind\$($f.Name)" }
            }
        }
    }
    @{
        guestOuDn          = $guestOuDn
        guestGroup         = $settings.guestGroup
        usernamePrefix     = $settings.usernamePrefix
        logoffWarningMinutes = $settings.logoffWarningMinutes
        domainDns          = $dns
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $sysvolTd 'client\client.json') -Encoding utf8

    $uncTd = "\\$dns\SYSVOL\$dns\TempDesk"

    # --- Computer GPO ----------------------------------------------------------------------
    Write-Step "GPO: $($settings.computerGpoName)"
    $cg = Get-GPO -Name $settings.computerGpoName -ErrorAction SilentlyContinue
    if (-not $cg) { $cg = New-GPO -Name $settings.computerGpoName -Comment 'TempDesk: Wi-Fi, session watcher and profile cleanup on guest PCs.' }
    if (-not (Get-GPInheritance -Target $computersOuDn).GpoLinks.DisplayName -contains $cg.DisplayName) {
        New-GPLink -Guid $cg.Id -Target $computersOuDn -LinkEnabled Yes | Out-Null
    }
    $hklmSys = 'HKLM\Software\Microsoft\Windows\CurrentVersion\Policies\System'
    Set-GPRegistryValue -Guid $cg.Id -Key $hklmSys -ValueName 'DontDisplayLastUserName' -Type DWord -Value 1 | Out-Null
    # Backstop: Windows removes profiles unused for 1 day even if the cleanup task never ran.
    Set-GPRegistryValue -Guid $cg.Id -Key 'HKLM\Software\Policies\Microsoft\Windows\System' -ValueName 'CleanupProfiles' -Type DWord -Value 1 | Out-Null
    Set-TempDeskGpoScript -GpoId $cg.Id -Kind Startup -ScriptUncPath "$uncTd\client\TempDesk-Startup.ps1"

    # --- Guest user GPO --------------------------------------------------------------------
    Write-Step "GPO: $($settings.guestGpoName)"
    $ug = Get-GPO -Name $settings.guestGpoName -ErrorAction SilentlyContinue
    if (-not $ug) { $ug = New-GPO -Name $settings.guestGpoName -Comment 'TempDesk: restrictions for temporary guest users.' }
    if (-not (Get-GPInheritance -Target $guestOuDn).GpoLinks.DisplayName -contains $ug.DisplayName) {
        New-GPLink -Guid $ug.Id -Target $guestOuDn -LinkEnabled Yes | Out-Null
    }
    $exp = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer'
    $sys = 'HKCU\Software\Policies\Microsoft\Windows\System'
    # Terminals stay available because guests use the preinstalled CLIs (Claude Code, Codex, Git, Node).
    # To lock them down later, set DisableCMD to 2 in the admin console (Group Policy > Administrative Templates).
    Set-GPRegistryValue -Guid $ug.Id -Key 'HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System' -ValueName 'DisableRegistryTools' -Type DWord -Value 1 | Out-Null
    Set-GPRegistryValue -Guid $ug.Id -Key $exp -ValueName 'NoDriveTypeAutoRun' -Type DWord -Value 255 | Out-Null
    # App allowlist ("Run only specified Windows applications"). Edit it later in the admin console.
    $apps = @('msedge.exe', 'chrome.exe', 'firefox.exe', 'notepad.exe', 'mspaint.exe', 'WINWORD.EXE', 'EXCEL.EXE', 'POWERPNT.EXE',
        'AcroRd32.exe', 'Acrobat.exe', 'Code.exe', 'git-bash.exe', 'claude.exe', 'GitHubDesktop.exe', 'notepad++.exe', '7zFM.exe',
        'WindowsTerminal.exe', 'wt.exe', 'pwsh.exe', 'powershell.exe', 'cmd.exe', 'Codex.exe', 'mstsc.exe')
    $existing = Get-GPRegistryValue -Guid $ug.Id -Key "$exp\RestrictRun" -ErrorAction SilentlyContinue
    if (-not $existing) {
        Set-GPRegistryValue -Guid $ug.Id -Key $exp -ValueName 'RestrictRun' -Type DWord -Value 1 | Out-Null
        for ($i = 0; $i -lt $apps.Count; $i++) {
            Set-GPRegistryValue -Guid $ug.Id -Key "$exp\RestrictRun" -ValueName ([string]($i + 1)) -Type String -Value $apps[$i] | Out-Null
        }
    }
    Set-TempDeskGpoScript -GpoId $ug.Id -Kind Logon -ScriptUncPath "$uncTd\client\TempDesk-Logon.ps1"

    # --- Reaper task -----------------------------------------------------------------------
    Write-Step 'Scheduled task: TempDesk Guest Reaper'
    $reaperDir = Join-Path $env:ProgramFiles 'TempDesk\Server'
    New-Item -ItemType Directory -Force -Path $reaperDir | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Invoke-GuestReaper.ps1') -Destination $reaperDir -Force
    $interval = [int]$settings.reaperIntervalMinutes
    if ($interval -lt 1) { $interval = 5 }
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"{0}`"" -f (Join-Path $reaperDir 'Invoke-GuestReaper.ps1'))
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $interval)
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $taskSettings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
    Register-ScheduledTask -TaskName 'TempDesk Guest Reaper' -TaskPath '\TempDesk\' -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings -Force | Out-Null

    Write-Host ''
    Write-Host 'TempDesk domain setup complete.' -ForegroundColor Green
    Write-Host "  Guest OU:      $guestOuDn"
    Write-Host "  Computers OU:  $computersOuDn (join guest PCs here)"
    Write-Host "  Next step:     agent\install.ps1 to install the TempDesk Agent service"
}
finally {
    Stop-Transcript | Out-Null
}
