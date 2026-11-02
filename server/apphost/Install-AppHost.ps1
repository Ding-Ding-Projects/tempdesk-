#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Prepares a domain-joined Windows Server (Desktop Experience) as a TempDesk
    RemoteApp host for browser streaming (Guacamole) and .rdp downloads.

.DESCRIPTION
    - Installs the Remote Desktop Session Host role (RDS-RD-Server), and
      optionally RDS-Licensing.
    - Sets RD licensing mode to Per User and the license server(s).
    - Enables Remote Desktop with Network Level Authentication and the
      "Remote Desktop" firewall rule group.
    - Adds the TempDesk guest group to the local "Remote Desktop Users" group.
    - Publishes RemoteApps without a full RDS deployment by writing
      TSAppAllowList entries, from -AppsJson or from the "apps" list of a
      TempDesk settings file (only entries whose host is this machine).
    - Safe to run again: every step checks the current state first.

    Must not run on a domain controller or on Server Core.

.PARAMETER AppsJson
    JSON array of apps: [{"id","name","program":"||alias","hostPath":"C:\\...","arguments","host"}].
    "hostPath" (full path of the exe on this server) is required for each app to
    publish. Entries without "||" in program are skipped (full path RemoteApps
    need no allow list entry when fDisabledAllowList is 0? No: they are blocked,
    so publish them through an alias instead).

.PARAMETER SettingsPath
    Path to a TempDesk settings JSON (for example a copy of the agent's
    settings). Its "apps" list is used when -AppsJson is not given.

.PARAMETER GuestGroup
    Domain group whose members may sign in over RDP. Default "TempDesk Guests".

.PARAMETER LicenseServer
    One or more RD license server names. When the name is this computer,
    RDS-Licensing is installed here too.

.PARAMETER InstallLicensing
    Install the RDS-Licensing role on this server even without -LicenseServer.

.PARAMETER RemoveUnlisted
    Remove TSAppAllowList entries previously published by this script
    (marked TempDeskManaged=1) that are no longer in the list.

.PARAMETER Reboot
    Restart the computer at the end if a role install requires it.

.EXAMPLE
    .\Install-AppHost.ps1 -AppsJson '[{"id":"notepad","name":"Notepad","program":"||notepad","hostPath":"C:\\Windows\\System32\\notepad.exe"}]' -LicenseServer lic01.corp.example -Reboot
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$AppsJson,
    [string]$SettingsPath,
    [string]$GuestGroup,
    [string[]]$LicenseServer,
    [switch]$InstallLicensing,
    [switch]$RemoveUnlisted,
    [switch]$Reboot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TsKey       = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server'
$RdpTcpKey   = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp'
$PolicyKey   = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services'
$AllowRoot   = 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Terminal Server\TSAppAllowList'
$AllowApps   = Join-Path $AllowRoot 'Applications'
$AliasRegex  = '^[A-Za-z0-9._-]{1,64}$'

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }

function Set-RegValue {
    param([string]$Path, [string]$Name, $Value, [Microsoft.Win32.RegistryValueKind]$Type)
    if (-not (Test-Path -LiteralPath $Path)) {
        if ($PSCmdlet.ShouldProcess($Path, 'Create registry key')) { New-Item -Path $Path -Force | Out-Null }
    }
    $current = $null
    $item = Get-ItemProperty -LiteralPath $Path -Name $Name -ErrorAction SilentlyContinue
    if ($null -ne $item) { $current = $item.$Name }
    $same = $false
    if ($null -ne $current) {
        if ($current -is [array] -or $Value -is [array]) { $same = (@($current) -join "`n") -ceq (@($Value) -join "`n") }
        else { $same = ("$current" -ceq "$Value") }
    }
    if (-not $same -and $PSCmdlet.ShouldProcess("$Path\$Name", "Set to '$Value'")) {
        New-ItemProperty -LiteralPath $Path -Name $Name -Value $Value -PropertyType $Type -Force | Out-Null
    }
}

# ---------------------------------------------------------------- preflight
Write-Step 'Checking this server'
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
if ($os.ProductType -eq 1) { throw 'This is a client OS. Use Windows Server (see README.md for the single-session Windows 11 Pro option).' }
if ($os.ProductType -eq 2 -or $cs.DomainRole -ge 4) { throw 'This computer is a domain controller. Never use a DC as an app host.' }
if (-not $cs.PartOfDomain) { throw 'This computer is not joined to the domain. Join it first so guests can sign in.' }
$installType = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').InstallationType
if ($installType -eq 'Server Core') { throw 'Server Core cannot be a Remote Desktop Session Host. Use Windows Server with Desktop Experience.' }
if ([Environment]::OSVersion.Version.Build -lt 26100) {
    Write-Warning 'Written for Windows Server 2025 (build 26100). Older versions usually work but are untested.'
}

$domainNetbios = (Get-CimInstance Win32_NTDomain -Filter "DnsForestName IS NOT NULL" -ErrorAction SilentlyContinue |
    Where-Object { $_.DomainName } | Select-Object -First 1).DomainName
$computerNames = @($env:COMPUTERNAME, "$($env:COMPUTERNAME).$($cs.Domain)") | ForEach-Object { $_.ToLowerInvariant() }
try {
    $ips = Get-NetIPAddress -ErrorAction Stop | Where-Object { $_.IPAddress -notmatch '^(127\.|::1|fe80)' } | ForEach-Object { $_.IPAddress.ToLowerInvariant() }
    $computerNames += $ips
} catch { Write-Verbose 'Could not list IP addresses; host matching uses names only.' }

# ---------------------------------------------------------------- settings
$settings = $null
if ($SettingsPath) {
    if (-not (Test-Path -LiteralPath $SettingsPath)) { throw "Settings file not found: $SettingsPath" }
    $settings = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
}
if (-not $GuestGroup) {
    if ($settings -and $settings.PSObject.Properties['guestGroup'] -and $settings.guestGroup) { $GuestGroup = $settings.guestGroup }
    else { $GuestGroup = 'TempDesk Guests' }
}

# ---------------------------------------------------------------- roles
Write-Step 'Installing Remote Desktop Session Host'
$restartNeeded = $false
$features = @('RDS-RD-Server')
$thisIsLicenseServer = $false
foreach ($ls in @($LicenseServer)) {
    if ($ls -and $computerNames -contains $ls.ToLowerInvariant()) { $thisIsLicenseServer = $true }
}
if ($InstallLicensing -or $thisIsLicenseServer) { $features += 'RDS-Licensing' }
foreach ($f in $features) {
    $state = Get-WindowsFeature -Name $f
    if ($state.Installed) { Write-Host "    $f already installed"; continue }
    if ($PSCmdlet.ShouldProcess($f, 'Install-WindowsFeature')) {
        $r = Install-WindowsFeature -Name $f -IncludeManagementTools
        if (-not $r.Success) { throw "Install of $f failed." }
        if ($r.RestartNeeded -eq 'Yes') { $restartNeeded = $true }
        Write-Host "    $f installed"
    }
}
$pending = (Get-WindowsFeature -Name 'RDS-RD-Server').InstallState -eq 'InstallPending'
if ($pending) { $restartNeeded = $true }

# ---------------------------------------------------------------- licensing
if ($LicenseServer) {
    Write-Step 'Setting RD licensing to Per User'
    $done = $false
    if (-not $restartNeeded) {
        try {
            $ts = Get-CimInstance -Namespace 'root\cimv2\TerminalServices' -ClassName Win32_TerminalServiceSetting -ErrorAction Stop
            if ($ts.LicensingType -ne 4 -and $PSCmdlet.ShouldProcess('Win32_TerminalServiceSetting', 'ChangeMode 4 (Per User)')) {
                Invoke-CimMethod -InputObject $ts -MethodName ChangeMode -Arguments @{ LicensingType = [uint32]4 } | Out-Null
            }
            $current = @($ts.GetSpecifiedLicenseServerList | Out-Null)
            if ($PSCmdlet.ShouldProcess('Win32_TerminalServiceSetting', "SetSpecifiedLicenseServerList $($LicenseServer -join ',')")) {
                Invoke-CimMethod -InputObject $ts -MethodName SetSpecifiedLicenseServerList -Arguments @{ SpecifiedLSList = [string[]]$LicenseServer } | Out-Null
            }
            $done = $true
        } catch {
            Write-Verbose "WMI licensing settings not available yet: $($_.Exception.Message)"
        }
    }
    # The policy values work before the reboot and override local settings.
    Set-RegValue -Path $PolicyKey -Name 'LicensingMode' -Value 4 -Type DWord
    Set-RegValue -Path $PolicyKey -Name 'LicenseServers' -Value ($LicenseServer -join ',') -Type String
    if (-not $done) { Write-Host '    Policy values written (WMI settings apply after the reboot).' }
    else { Write-Host "    Per User, license servers: $($LicenseServer -join ', ')" }
} else {
    Write-Warning 'No -LicenseServer given. Without RDS CALs only two admin sessions work after the 120-day grace period.'
}

# ---------------------------------------------------------------- remote desktop + NLA
Write-Step 'Enabling Remote Desktop with Network Level Authentication'
Set-RegValue -Path $TsKey -Name 'fDenyTSConnections' -Value 0 -Type DWord
Set-RegValue -Path $RdpTcpKey -Name 'UserAuthentication' -Value 1 -Type DWord
Set-RegValue -Path $RdpTcpKey -Name 'SecurityLayer' -Value 2 -Type DWord   # TLS
$rules = Get-NetFirewallRule -Group '@FirewallAPI.dll,-28752' -ErrorAction SilentlyContinue
if (-not $rules) { $rules = Get-NetFirewallRule -DisplayGroup 'Remote Desktop' -ErrorAction SilentlyContinue }
if ($rules) {
    $off = @($rules | Where-Object { $_.Enabled -ne 'True' })
    if ($off.Count -gt 0 -and $PSCmdlet.ShouldProcess('Remote Desktop firewall rules', 'Enable')) { $off | Enable-NetFirewallRule }
    Write-Host '    Firewall rule group "Remote Desktop" enabled'
} else {
    Write-Warning 'Remote Desktop firewall rule group not found. Allow TCP and UDP 3389 manually.'
}

# ---------------------------------------------------------------- guest group
Write-Step "Allowing '$GuestGroup' to sign in over RDP"
$rduSid = 'S-1-5-32-555'   # BUILTIN\Remote Desktop Users (name differs per language)
$rdu = Get-LocalGroup -SID $rduSid
$member = if ($domainNetbios) { "$domainNetbios\$GuestGroup" } else { $GuestGroup }
$already = @(Get-LocalGroupMember -SID $rduSid -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ieq $member -or $_.Name -like "*\$GuestGroup" })
if ($already.Count -gt 0) {
    Write-Host "    already a member of $($rdu.Name)"
} elseif ($PSCmdlet.ShouldProcess($rdu.Name, "Add $member")) {
    Add-LocalGroupMember -SID $rduSid -Member $member
    Write-Host "    added to $($rdu.Name)"
}

# ---------------------------------------------------------------- RemoteApps
Write-Step 'Publishing RemoteApps (TSAppAllowList)'
$apps = @()
if ($AppsJson) {
    $apps = @($AppsJson | ConvertFrom-Json)
} elseif ($settings -and $settings.PSObject.Properties['apps']) {
    $apps = @($settings.apps)
}
Set-RegValue -Path $AllowRoot -Name 'fDisabledAllowList' -Value 0 -Type DWord
if (-not (Test-Path -LiteralPath $AllowApps) -and $PSCmdlet.ShouldProcess($AllowApps, 'Create registry key')) {
    New-Item -Path $AllowApps -Force | Out-Null
}

$published = New-Object System.Collections.Generic.List[string]
foreach ($app in $apps) {
    $get = { param($n) if ($app.PSObject.Properties[$n]) { $app.$n } else { $null } }
    $id = & $get 'id'; $program = & $get 'program'; $hostName = & $get 'host'
    if ($hostName -and -not ($computerNames -contains "$hostName".ToLowerInvariant())) {
        Write-Verbose "Skipping '$id': host '$hostName' is not this machine."
        continue
    }
    if ((& $get 'enabled') -eq $false) { Write-Host "    skip ${id}: disabled"; continue }
    if (-not $program -or -not "$program".StartsWith('||')) {
        Write-Warning "Skipping '$id': program must be a '||alias'. Full path RemoteApps are blocked while the allow list is on."
        continue
    }
    $alias = "$program".Substring(2)
    if ($alias -notmatch $AliasRegex) { Write-Warning "Skipping '$id': alias '$alias' has unsupported characters."; continue }
    $path = & $get 'hostPath'
    if (-not $path) { Write-Warning "Skipping '$id': hostPath (full path of the program on this server) is missing."; continue }
    $expanded = [Environment]::ExpandEnvironmentVariables($path)
    if (-not (Test-Path -LiteralPath $expanded -PathType Leaf)) { Write-Warning "Skipping '$id': '$expanded' does not exist on this server."; continue }
    $name = & $get 'name'; if (-not $name) { $name = $alias }
    $args = & $get 'arguments'

    $key = Join-Path $AllowApps $alias
    Set-RegValue -Path $key -Name 'Name' -Value $name -Type String
    Set-RegValue -Path $key -Name 'Path' -Value $expanded -Type String
    Set-RegValue -Path $key -Name 'VPath' -Value $expanded -Type String
    Set-RegValue -Path $key -Name 'IconPath' -Value $expanded -Type String
    Set-RegValue -Path $key -Name 'IconIndex' -Value 0 -Type DWord
    Set-RegValue -Path $key -Name 'ShowInTSWA' -Value 0 -Type DWord
    Set-RegValue -Path $key -Name 'SecurityDescriptor' -Value '' -Type String
    if ($args) {
        # 2 = always use these arguments; clients cannot add their own.
        Set-RegValue -Path $key -Name 'CommandLineSetting' -Value 2 -Type DWord
        Set-RegValue -Path $key -Name 'RequiredCommandLine' -Value "$args" -Type String
    } else {
        # 0 = do not allow command-line arguments from the client.
        Set-RegValue -Path $key -Name 'CommandLineSetting' -Value 0 -Type DWord
        Set-RegValue -Path $key -Name 'RequiredCommandLine' -Value '' -Type String
    }
    Set-RegValue -Path $key -Name 'TempDeskManaged' -Value 1 -Type DWord
    $published.Add($alias.ToLowerInvariant())
    Write-Host "    ||$alias -> $expanded"
}

if ($RemoveUnlisted -and (Test-Path -LiteralPath $AllowApps)) {
    foreach ($k in Get-ChildItem -LiteralPath $AllowApps) {
        $managed = (Get-ItemProperty -LiteralPath $k.PSPath -Name 'TempDeskManaged' -ErrorAction SilentlyContinue)
        if ($managed -and -not $published.Contains($k.PSChildName.ToLowerInvariant())) {
            if ($PSCmdlet.ShouldProcess($k.PSChildName, 'Remove RemoteApp')) {
                Remove-Item -LiteralPath $k.PSPath -Recurse -Force
                Write-Host "    removed ||$($k.PSChildName)"
            }
        }
    }
}
if ($published.Count -eq 0) { Write-Warning 'No RemoteApps were published from the list given.' }

# ---------------------------------------------------------------- finish
Write-Step 'Done'
Write-Host "    RemoteApps published: $($published.Count)"
Write-Host '    Install a certificate the clients trust for RDP so the portal can keep ignoreCert = false (see README.md).'
if ($restartNeeded) {
    if ($Reboot) {
        if ($PSCmdlet.ShouldProcess($env:COMPUTERNAME, 'Restart')) { Restart-Computer -Force }
    } else {
        Write-Warning 'A restart is required to finish the role install. Run again with -Reboot, or restart manually.'
    }
}
