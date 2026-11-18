<#
.SYNOPSIS
    Creates a powered-off Windows 11 kiosk VM, preferring VMware Workstation.
.DESCRIPTION
    Use the deployment engine or run from a source checkout. No password or guest
    answer file is accepted. The operator verifies the hardware security settings
    before first boot. A partial creation is preserved for inspection.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param(
    [Parameter(Mandatory)][ValidatePattern('^(?![0-9]+$)[A-Za-z0-9][A-Za-z0-9-]{0,13}[A-Za-z0-9]$')][string]$Name,
    [Parameter(Mandatory)][string]$WindowsIso,
    [Parameter(Mandatory)][string]$StorageParent,
    [ValidateSet('Auto','VMware','VirtualBox')][string]$Hypervisor = 'Auto',
    [ValidatePattern('^[A-Za-z0-9_-]{1,48}$')][string]$PrivateNetwork = 'CommonsLab'
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command Get-TdVmwareTools -ErrorAction SilentlyContinue)) {
    $engine = Join-Path $PSScriptRoot '../../deployer/engine'
    foreach ($module in 'TempDesk.Common','VmDeploy') { Import-Module (Join-Path $engine "$module.psm1") -DisableNameChecking }
}
if ($Name -ieq $env:COMPUTERNAME) { throw 'Choose a name different from the host.' }
$iso = Get-Item -LiteralPath $WindowsIso
if ($iso.PSIsContainer -or $iso.Extension -ine '.iso') { throw 'Select Windows 11 ISO media.' }
$parent = Get-Item -LiteralPath $StorageParent
if (-not $parent.PSIsContainer -or $parent.PSProvider.Name -ne 'FileSystem') { throw 'Select an existing filesystem directory.' }
$folder = Join-Path $parent.FullName $Name
if (Test-Path -LiteralPath $folder) { throw 'The selected storage directory already exists.' }
$vmware = $null
if ($Hypervisor -ne 'VirtualBox') {
    try { $vmware = Get-TdVmwareTools } catch { if ($Hypervisor -eq 'VMware') { throw } }
}
if ($vmware) {
    $provider = 'VMware'
    $config = Join-Path $folder "$Name.vmx"
    $disk = Join-Path $folder "$Name.vmdk"
    $vmx = New-TdVmwareVmx -Name $Name -DiskFile "$Name.vmdk" -WindowsIso $iso.FullName -Network hostonly -KioskWorkstation
} else {
    $provider = 'VirtualBox'
    $box = Join-Path $env:ProgramFiles 'Oracle/VirtualBox/VBoxManage.exe'
    if (-not (Test-Path -LiteralPath $box -PathType Leaf)) { throw 'Install VMware Workstation or VirtualBox 7 or later.' }
    function Invoke-Box([string[]]$Options) {
        $r = Invoke-TdVmTool -Exe $box -Arguments $Options -TimeoutSec 300
        if ($r.ExitCode -ne 0) { throw $r.Output }
        $r.Output
    }
    $machines = Invoke-Box @('list','vms')
    if ($machines -match ('(?im)^"' + [regex]::Escape($Name) + '" ')) { throw 'The selected VM name is already registered.' }
    $config = Join-Path $folder "$Name.vbox"
    $disk = Join-Path $folder "$Name.vdi"
}
if (-not $PSCmdlet.ShouldProcess("$provider/$Name", 'Create a powered-off Windows 11 workstation')) { return }
if ($vmware) {
    New-Item -ItemType Directory -Path $folder | Out-Null
    $r = Invoke-TdVmTool -Exe $vmware.DiskManager -Arguments @('-c','-s','80GB','-a','nvme','-t','0',$disk) -TimeoutSec 300
    if ($r.ExitCode -ne 0) { throw $r.Output }
    Write-TdUtf8File -Path $config -Text $vmx
    $state = 'RequiresWorkstationEncryptionAndTpm'
} else {
    $id = [guid]::NewGuid().ToString()
    Invoke-Box @('createvm','--name',$Name,'--uuid',$id,'--ostype','Windows11_64','--basefolder',$parent.FullName,'--register') | Out-Null
    Invoke-Box @('modifyvm',$id,'--memory','4096','--cpus','2','--firmware','efi','--tpm-type','2.0','--nic1','intnet','--intnet1',$PrivateNetwork) | Out-Null
    Invoke-Box @('createmedium','disk','--filename',$disk,'--size','81920','--format','VDI') | Out-Null
    Invoke-Box @('storagectl',$id,'--name','SATA','--add','sata','--controller','IntelAhci') | Out-Null
    Invoke-Box @('storageattach',$id,'--storagectl','SATA','--port','0','--device','0','--type','hdd','--medium',$disk) | Out-Null
    Invoke-Box @('storageattach',$id,'--storagectl','SATA','--port','1','--device','0','--type','dvddrive','--medium',$iso.FullName) | Out-Null
    $state = 'RequiresSecureBootVerification'
}
[pscustomobject]@{ Configuration = $config; Hypervisor = $provider; Name = $Name; State = $state; Enrolled = $false }
