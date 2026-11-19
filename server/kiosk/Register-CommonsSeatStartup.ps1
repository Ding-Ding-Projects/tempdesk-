<#
.SYNOPSIS
    Registers the installed workstation seat broker for native startup in its dedicated guest.
.DESCRIPTION
    Run the installed script from an operator-approved 64-bit Windows PowerShell
    administrator console. The host receipt supplies the manifest digest. HTTP.sys,
    certificates, firewall restrictions and credential distribution are managed
    separately. This entrypoint never starts a listener or replaces an existing task.
#>
[CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
param(
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedManifestSha256,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9-]{2,15}$')][string]$ComputerName,
    [Parameter(Mandatory)][ValidatePattern('^(?=.{1,253}$)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$')][string]$DomainDns,
    [Parameter(Mandatory)][ipaddress]$PortalAddress,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$CertificateThumbprint,
    [ValidateRange(1024,65535)][int]$Port=9443,
    [switch]$InitializeEmptySeat
)
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell 5.1.' }
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Open an approved administrator console inside the intended guest.' }
$ip=$PortalAddress.GetAddressBytes()
if ($ip.Length -ne 4 -or -not ($ip[0] -eq 10 -or ($ip[0] -eq 172 -and $ip[1] -ge 16 -and $ip[1] -le 31) -or ($ip[0] -eq 192 -and $ip[1] -eq 168))) { throw 'Use the private IPv4 address of the authorized portal.' }
$script:SeatComputer=$ComputerName
$script:SeatDomain=$DomainDns
$script:SeatTarget=("$ComputerName.$DomainDns").ToLowerInvariant()
$script:SeatDirectory=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) 'TempDesk/seat'
$programs=[Environment]::GetFolderPath('ProgramFiles')
$root=Join-Path $programs ('TempDesk-Seat-'+$ExpectedManifestSha256.ToUpperInvariant())
if ([IO.Path]::GetFullPath($PSScriptRoot) -ine (Join-Path $root 'kiosk')) { throw 'Use the verified installation identified by the independent host receipt.' }

function Assert-PrivateInstalledItem([string]$Path) {
    $item=Get-Item -LiteralPath $Path -Force
    $acl=Get-Acl -LiteralPath $Path
    $trusted=@('S-1-5-18','S-1-5-32-544')
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $trusted) { throw 'Unexpected installation path or owner.' }
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted) { throw 'The broker installation is not privately protected.' }
    }
}
Assert-PrivateInstalledItem $root
$manifestPath=Join-Path $root 'GuestFiles.json'
Assert-PrivateInstalledItem $manifestPath
if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ine $ExpectedManifestSha256) { throw 'Installed manifest differs from the trusted receipt.' }
$manifest=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schema -ne 1 -or $manifest.computerName -ine $ComputerName) { throw 'The manifest does not describe this workstation.' }
$required=@('kiosk/Register-CommonsSeatStartup.ps1','kiosk/Get-CommonsKioskReadiness.ps1','kiosk/Start-CommonsSeatBroker.ps1','kiosk/SeatAuthorization.ps1','kiosk/SeatTransitions.ps1','kiosk/SeatSessions.ps1','apphost/VirtualCommonsHost.ps1','apphost/i18n/en.json','apphost/i18n/zh-HK.json')
foreach ($name in $required) {
    $path=$root
    foreach ($part in $name.Split('/')) { $path=Join-Path $path $part; Assert-PrivateInstalledItem $path }
    $hash=$manifest.files.PSObject.Properties[$name]
    if (-not $hash -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $hash.Value) { throw "Installed file differs from manifest: $name" }
}
. (Join-Path $root 'apphost/VirtualCommonsHost.ps1')
. (Join-Path $PSScriptRoot 'SeatAuthorization.ps1')
. (Join-Path $PSScriptRoot 'SeatSessions.ps1')
Set-TdVirtualCommonsLocale -Language en
# The existing policy reader creates and removes its own temporary export.
# Let that cleanup run during preview; registration remains under ShouldProcess.
& { $WhatIfPreference=$false; Assert-SeatHost }
Assert-SeatStorage
$null=Get-Command Get-ADUser,Get-ADAccountAuthorizationGroup -ErrorAction Stop
if (-not (Test-Path -LiteralPath (Join-Path $script:SeatDirectory 'broker.key') -PathType Leaf)) { throw 'Provision the protected broker credential first.' }
$certificate=Get-Item -LiteralPath ("Cert:/LocalMachine/My/$CertificateThumbprint")
if (-not $certificate.HasPrivateKey -or -not (Test-Certificate -Cert $certificate -Policy SSL -DNSName ("dns="+$script:SeatTarget))) { throw 'A trusted server certificate and private key for the workstation FQDN are required.' }
# Require a pre-existing SNI binding for this exact name and port. The public
# certificate fingerprint is language-independent; never parse or log private keys.
$systemDirectory=[Environment]::SystemDirectory
$binding=& (Join-Path $systemDirectory 'netsh.exe') http show sslcert "hostnameport=${script:SeatTarget}:$Port"
if ($LASTEXITCODE -ne 0 -or -not ($binding -match ':\s*MY\s*$') -or -not ($binding -match (':\s*'+$CertificateThumbprint+'\s*$'))) { throw 'The existing HTTP.sys hostname binding does not match the expected certificate.' }

$taskName='TempDesk Virtual Commons Seat Broker'
$exe=Join-Path $systemDirectory 'WindowsPowerShell/v1.0/powershell.exe'
$entry=Join-Path $PSScriptRoot 'Start-CommonsSeatBroker.ps1'
$arguments='-NoProfile -NonInteractive -File "{0}" -DomainDns "{1}" -PortalAddress "{2}" -Port {3}' -f $entry,$DomainDns,$PortalAddress,$Port
function Get-ExistingTask {
    @(Get-ScheduledTask -TaskPath '\' -ErrorAction Stop | Where-Object TaskName -eq $taskName) | Select-Object -First 1
}
function Assert-TaskMatches($Task) {
    # The task must not be rewritable by a standard user, even if its
    # current command line happens to be the expected one.
    $scheduler=New-Object -ComObject 'Schedule.Service'
    $scheduler.Connect()
    $sddl=$scheduler.GetFolder('\').GetTask($taskName).GetSecurityDescriptor(7)
    $descriptor=[Security.AccessControl.RawSecurityDescriptor]::new($sddl)
    $trusted=@('S-1-5-18','S-1-5-32-544')
    if ($descriptor.Owner.Value -notin $trusted -or -not $descriptor.DiscretionaryAcl) { throw 'The existing task has an untrusted owner or missing DACL.' }
    foreach ($ace in $descriptor.DiscretionaryAcl) {
        if ($ace.AceFlags -band [Security.AccessControl.AceFlags]::InheritOnly) { continue }
        if ($ace -isnot [Security.AccessControl.QualifiedAce]) { throw 'Unrecognized task permission.' }
        if ($ace.AceQualifier -eq 'AccessAllowed' -and $ace.SecurityIdentifier.Value -notin $trusted -and ($ace.AccessMask -band 0x500D0116)) {
            throw 'Another principal can change the startup task.'
        }
    }
    $actions=@($Task.Actions)
    $triggers=@($Task.Triggers)
    if ($actions.Count -ne 1 -or $actions[0].Execute -ine $exe -or $actions[0].Arguments -cne $arguments -or $actions[0].WorkingDirectory -or
        $triggers.Count -ne 1 -or $triggers[0].CimClass.CimClassName -ne 'MSFT_TaskBootTrigger' -or -not $triggers[0].Enabled -or
        $Task.Principal.UserId -notin @('SYSTEM','NT AUTHORITY\SYSTEM','S-1-5-18') -or $Task.Principal.LogonType -ne 'ServiceAccount' -or
        -not $Task.Settings.Enabled -or $Task.Settings.ExecutionTimeLimit -ne 'PT0S' -or $Task.Settings.MultipleInstances -ne 'IgnoreNew') {
        throw 'The existing startup task differs from this configuration. It was preserved.'
    }
}
$statePath=Join-Path $script:SeatDirectory 'state.json'
$existing=Get-ExistingTask
$hasState=Test-Path -LiteralPath $statePath -PathType Leaf
if ($hasState) { $null=Get-SeatState }
if ($existing) {
    Assert-TaskMatches $existing
    if (-not $hasState) { throw 'An existing startup task has lost its state. Investigate before recovery.' }
    [pscustomobject]@{ Task=$taskName; State='AlreadyRegistered'; PortalCheckRequired=$true }
    return
}
if (-not $hasState -and -not $InitializeEmptySeat) { throw 'No state exists. Explicitly choose -InitializeEmptySeat for the first enrollment.' }
if (-not $hasState) { Initialize-SeatSessionReader; Assert-SeatEmptySessions; if (@(Get-SeatMembers).Count) { throw 'An existing RDP grant prevents first enrollment.' } }
if (-not $PSCmdlet.ShouldProcess($script:SeatTarget,'Register the verified startup task and initialize the first empty seat only if explicitly requested')) {
    [pscustomobject]@{ Task=$taskName; State='PreviewOnly'; WouldInitialize=(-not $hasState); Target=$script:SeatTarget; PortalAddress=$PortalAddress.ToString(); Port=$Port; PortalCheckRequired=$true }
    return
}
$lock=[IO.File]::Open((Join-Path $script:SeatDirectory 'broker.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
    if (Get-ExistingTask) { throw 'A task appeared during setup. Retry to inspect it.' }
    if (Test-Path -LiteralPath $statePath -PathType Leaf) { $null=Get-SeatState }
    elseif ($hasState -or -not $InitializeEmptySeat) { throw 'Seat state changed during setup.' }
    else {
        Assert-SeatHost
        Assert-SeatEmptySessions
        if (@(Get-SeatMembers).Count) { throw 'A grant appeared during setup.' }
        Save-SeatState (New-SeatState) -Initialize
        $null=Get-SeatState
    }
    # Create only, with the protected owner and DACL in the same native
    # registration operation. Never temporarily expose an editable SYSTEM task.
    $scheduler=New-Object -ComObject 'Schedule.Service'
    $scheduler.Connect()
    $definition=$scheduler.NewTask(0)
    $definition.RegistrationInfo.Description='Start the installed TempDesk Virtual Commons seat broker on this workstation.'
    $definition.Principal.UserId='S-1-5-18'
    $definition.Principal.LogonType=5 # TASK_LOGON_SERVICE_ACCOUNT
    $definition.Settings.MultipleInstances=2 # TASK_INSTANCES_IGNORE_NEW
    $definition.Settings.ExecutionTimeLimit='PT0S'
    $definition.Settings.RestartCount=3
    $definition.Settings.RestartInterval='PT1M'
    $definition.Settings.DisallowStartIfOnBatteries=$false
    $definition.Settings.StopIfGoingOnBatteries=$false
    $null=$definition.Triggers.Create(8) # TASK_TRIGGER_BOOT
    $action=$definition.Actions.Create(0) # TASK_ACTION_EXEC
    $action.Path=$exe
    $action.Arguments=$arguments
    $sddl='O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)'
    $null=$scheduler.GetFolder('\').RegisterTaskDefinition($taskName,$definition,2,'S-1-5-18',$null,5,$sddl)
    $registered=Get-ExistingTask
    if (-not $registered) { throw 'Could not read back the startup registration.' }
    Assert-TaskMatches $registered
    [pscustomobject]@{ Task=$taskName; State='RegisteredForStartup'; PortalCheckRequired=$true }
} finally { $lock.Dispose() }
