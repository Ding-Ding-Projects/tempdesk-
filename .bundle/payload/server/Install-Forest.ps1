#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Promotes a fresh Windows Server 2025 machine to the first domain controller of a new forest.

.DESCRIPTION
    Installs the AD DS, DNS and Group Policy Management features, then creates the forest.
    The server reboots automatically when promotion finishes. Run Initialize-TempDesk.ps1 after
    the reboot, signed in as a domain administrator.

    Safe to re-run: if the machine is already a domain controller it exits without changes.

.EXAMPLE
    $dsrm = Read-Host -AsSecureString 'Directory Services Restore Mode password'
    .\Install-Forest.ps1 -DomainName lab.example.org -NetbiosName LAB -SafeModePassword $dsrm
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [ValidatePattern('^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$')] [string] $DomainName,
    [Parameter(Mandatory)] [ValidatePattern('^[A-Za-z0-9-]{1,15}$')] [string] $NetbiosName,
    [Parameter(Mandatory)] [securestring] $SafeModePassword,
    # Leave empty to use the server's default functional level. Windows Server 2025 accepts 'Win2025'.
    [string] $FunctionalLevel = '',
    [switch] $NoReboot
)

$ErrorActionPreference = 'Stop'
$log = Join-Path $env:ProgramData 'TempDesk\logs'
New-Item -ItemType Directory -Force -Path $log | Out-Null
Start-Transcript -Path (Join-Path $log ("install-forest-{0:yyyyMMdd-HHmmss}.log" -f (Get-Date))) -Append | Out-Null

try {
    $role = (Get-CimInstance Win32_ComputerSystem).DomainRole
    if ($role -ge 4) {
        Write-Host "This server is already a domain controller (DomainRole=$role). Nothing to do." -ForegroundColor Yellow
        return
    }

    Write-Host 'Installing AD DS, DNS and Group Policy Management features...' -ForegroundColor Cyan
    $features = Install-WindowsFeature -Name AD-Domain-Services, DNS, GPMC, RSAT-AD-PowerShell -IncludeManagementTools
    if (-not $features.Success) { throw 'Windows feature installation failed. See the log for details.' }

    Import-Module ADDSDeployment

    $params = @{
        DomainName                    = $DomainName
        DomainNetbiosName             = $NetbiosName.ToUpperInvariant()
        SafeModeAdministratorPassword = $SafeModePassword
        InstallDns                    = $true
        CreateDnsDelegation           = $false
        DatabasePath                  = 'C:\Windows\NTDS'
        LogPath                       = 'C:\Windows\NTDS'
        SysvolPath                    = 'C:\Windows\SYSVOL'
        NoRebootOnCompletion          = [bool]$NoReboot
        Force                         = $true
    }
    if ($FunctionalLevel) {
        $params.DomainMode = $FunctionalLevel
        $params.ForestMode = $FunctionalLevel
    }

    Write-Host "Running prerequisite checks for forest $DomainName..." -ForegroundColor Cyan
    $test = Test-ADDSForestInstallation @params -WarningAction SilentlyContinue
    if ($test.Status -ne 'Success') { throw "Forest prerequisite check failed: $($test.Message)" }

    Write-Host 'Creating the forest. The server reboots when this finishes.' -ForegroundColor Cyan
    Install-ADDSForest @params -WarningAction SilentlyContinue | Out-Null
}
finally {
    Stop-Transcript | Out-Null
}
