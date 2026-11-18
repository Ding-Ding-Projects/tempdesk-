<#
.SYNOPSIS
    Applies transport and device-redirection restrictions inside an enrolled lab workstation.
.DESCRIPTION
    Use -WhatIf for a preview. Network isolation, RDP enablement and firewall scope
    belong to the operator's existing domain policy. This command never opens a port,
    changes logon rights, creates accounts or adds a user to Remote Desktop Users.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param(
    [Parameter(Mandatory)][string]$ComputerName,
    [Parameter(Mandatory)][string]$DomainDns,
    [ValidateSet('en','zh-HK','bi')][string]$Language = 'en'
)
$ErrorActionPreference = 'Stop'
$preflight = & (Join-Path $PSScriptRoot 'Get-CommonsKioskReadiness.ps1') -ComputerName $ComputerName -DomainDns $DomainDns -Language $Language
$path = 'HKLM:/SOFTWARE/Policies/Microsoft/Windows NT/Terminal Services'
$settings = [ordered]@{
    UserAuthentication = 1
    fSingleSessionPerUser = 1
    fDisableCdm = 1
    fDisableClip = 1
    fDisableCpm = 1
}
if (-not $PSCmdlet.ShouldProcess($preflight.ComputerName, 'Require NLA and block drive, clipboard and printer redirection')) { return }
if (-not (Test-Path -LiteralPath $path)) { New-Item -Path $path -Force | Out-Null }
foreach ($name in $settings.Keys) {
    New-ItemProperty -LiteralPath $path -Name $name -Value $settings[$name] -PropertyType DWord -Force | Out-Null
    if ((Get-ItemPropertyValue -LiteralPath $path -Name $name) -ne $settings[$name]) { throw "Policy readback failed: $name" }
}
& (Join-Path $PSScriptRoot 'Get-CommonsKioskReadiness.ps1') -ComputerName $ComputerName -DomainDns $DomainDns -Language $Language
