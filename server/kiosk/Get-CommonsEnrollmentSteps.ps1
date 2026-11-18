<#
.SYNOPSIS
    Reports the next enrollment actions without opening a listener or reading a credential.
.DESCRIPTION
    Run locally from the trusted staged installation, inside the intended workstation.
    Final availability must be checked from the configured portal over authenticated HTTPS.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ComputerName,
    [Parameter(Mandatory)][string]$DomainDns,
    [ValidateRange(1024,65535)][int]$BrokerPort=9443
)
$ErrorActionPreference='Stop'
$machine=Get-CimInstance Win32_ComputerSystem
if ($ComputerName -ine $machine.Name -or [uri]::CheckHostName($DomainDns) -ne [UriHostNameType]::Dns) {
    throw 'Select the intended local workstation and lab domain.'
}
if (-not (($machine.Manufacturer -match '^VMware' -and $machine.Model -match '^VMware') -or
    ($machine.Manufacturer -in @('innotek GmbH','Oracle Corporation') -and $machine.Model -eq 'VirtualBox'))) {
    throw 'Inspect enrollment only inside the dedicated lab VM.'
}
$rows=[Collections.Generic.List[object]]::new()
function Add-Checkpoint([string]$Name,[string]$State,[string]$Action) {
    $rows.Add([pscustomobject]@{ Step=$Name; State=$State; Action=$Action })
}
function Inspect-Step([string]$Name,[scriptblock]$Check,[string]$Action) {
    try {
        if (& $Check) { Add-Checkpoint $Name 'Verified' '' }
        else { Add-Checkpoint $Name 'ActionRequired' $Action }
    } catch { Add-Checkpoint $Name 'Unverified' $Action }
}
Inspect-Step 'Domain membership' { $machine.PartOfDomain -and $machine.Domain -ieq $DomainDns -and (Test-ComputerSecureChannel) } 'Join the intended lab domain with your approved credentials and verify the secure channel.'
Inspect-Step 'Directory tools' { (Get-Command Get-ADUser) -and (Get-Command Get-ADAccountAuthorizationGroup) } 'Install the Active Directory RSAT feature in this guest.'
Inspect-Step 'Watcher and RDP transport' {
    $readiness=& (Join-Path $PSScriptRoot 'Get-CommonsKioskReadiness.ps1') -ComputerName $ComputerName -DomainDns $DomainDns
    $readiness.WatcherVerified -and $readiness.RdpEnabled -and $readiness.NetworkLevelAuthentication
} 'Apply the watcher policy and the private gateway-only RDP policy. Run Get-CommonsKioskReadiness.ps1 for the detailed check.'
$privateRoot=Join-Path $env:ProgramData 'TempDesk/seat'
Inspect-Step 'Protected storage permissions' {
    . (Join-Path $PSScriptRoot '../apphost/VirtualCommonsHost.ps1')
    . (Join-Path $PSScriptRoot 'SeatAuthorization.ps1')
    $script:SeatDirectory=$privateRoot
    Assert-SeatStorage
    $true
} 'Use the documented owner and permissions on the broker state directory and its files. Run this check with authorized local access.'
Inspect-Step 'Credential file present' { Test-Path -LiteralPath (Join-Path $privateRoot 'broker.key') -PathType Leaf } 'Supply the portal bearer credential using protected file distribution.'
Inspect-Step 'Initialized state file present' { Test-Path -LiteralPath (Join-Path $privateRoot 'state.json') -PathType Leaf } 'Initialize once under the approved broker service identity. Never overwrite an existing seat record.'
Inspect-Step 'Local listener present' {
    @(Get-NetTCPConnection -LocalPort $BrokerPort -State Listen -ErrorAction Stop).Count -gt 0
} 'Configure the trusted HTTP.sys certificate and private network restrictions, then start the managed broker.'
Add-Checkpoint 'Authenticated portal readiness' 'RequiresPortalCheck' 'Check the exact workstation target through the configured portal. A local listener and present files cannot establish seat availability.'
$rows
