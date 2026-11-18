<#
.SYNOPSIS
    Inspects the Windows 11 RDP destination locally before the enrollment broker grants a seat.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ComputerName,
    [Parameter(Mandatory)][string]$DomainDns,
    [ValidateSet('en','zh-HK','bi')][string]$Language = 'en'
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../apphost/VirtualCommonsHost.ps1')
Set-TdVirtualCommonsLocale -Language $Language
$hostInfo = Get-CimInstance Win32_ComputerSystem
$os = Get-CimInstance Win32_OperatingSystem
if ($hostInfo.Name -ine $ComputerName -or -not $hostInfo.PartOfDomain -or $hostInfo.Domain -ine $DomainDns) {
    throw 'Destination identity or domain membership did not match.'
}
$edition = (Get-ItemProperty 'HKLM:/SOFTWARE/Microsoft/Windows NT/CurrentVersion').EditionID
if ($os.ProductType -ne 1 -or [int]$os.BuildNumber -lt 22000 -or $edition -notin @('Professional','Enterprise','Education')) {
    throw 'A Windows 11 Pro, Enterprise or Education workstation is required.'
}
$config = Get-TdVirtualCommonsWatcherConfig -DomainDns $DomainDns
$guestGroupSid = Resolve-TdVirtualCommonsGuestSid -DomainDns $DomainDns -GroupName $config.guestGroup
$rdpMembers = @(Get-LocalGroupMember -SID 'S-1-5-32-555')
if ($rdpMembers | Where-Object { $_.SID.Value -eq $guestGroupSid -or $_.ObjectClass -ne 'User' }) {
    throw 'A shared group or unresolved principal has Remote Desktop Users membership.'
}
$terminal = Get-CimInstance -Namespace root/cimv2/terminalservices -ClassName Win32_TerminalServiceSetting
$listener = Get-CimInstance -Namespace root/cimv2/terminalservices -ClassName Win32_TSGeneralSetting -Filter "TerminalName='RDP-tcp'"
[pscustomobject]@{
    ComputerName = $hostInfo.Name
    DomainDns = $hostInfo.Domain
    Edition = $edition
    WatcherVerified = $true
    RdpEnabled = ($terminal.AllowTSConnections -eq 1)
    NetworkLevelAuthentication = ($listener.UserAuthenticationRequired -eq 1)
    DirectRdpUserCount = $rdpMembers.Count
    Enrollment = 'RequiresBrokerVerification'
}
