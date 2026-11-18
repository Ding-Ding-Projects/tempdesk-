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
    [ValidatePattern('^(?:[a-fA-F0-9]{64})?$')][string]$ExpectedWindowsIsoSha256='',
    [ValidateSet('Auto','VMware','VirtualBox')][string]$Hypervisor = 'Auto',
    [ValidatePattern('^[A-Za-z0-9_-]{1,48}$')][string]$PrivateNetwork = 'CommonsLab'
)
$ErrorActionPreference = 'Stop'
# Resolve the engine beside this source or packaged payload. A function left
# over from another checkout does not prove its sibling modules are available.
$sourceEngine = Join-Path $PSScriptRoot '../../deployer/engine'
$packagedEngine = Join-Path $PSScriptRoot '../../../engine'
$engine = if (Test-Path -LiteralPath $sourceEngine -PathType Container) { $sourceEngine } else { $packagedEngine }
$required = [ordered]@{
    'TempDesk.Common' = @('Write-TdUtf8File')
    'AnswerFile' = @('New-TdIso')
    'VmDeploy' = @('Get-TdVmwareTools','New-TdVmwareVmx','Invoke-TdVmTool')
}
foreach ($nameOfModule in $required.Keys) {
    $pathOfModule = (Get-Item -LiteralPath (Join-Path $engine "$nameOfModule.psm1") -ErrorAction Stop).FullName
    $moduleInfo = Import-Module -Name $pathOfModule -Scope Local -DisableNameChecking -PassThru -ErrorAction Stop
    foreach ($functionName in $required[$nameOfModule]) {
        $command = Get-Command -Name $functionName -CommandType Function -ListImported -ErrorAction Stop
        if ($command.Module.Path -ine $pathOfModule) { throw "Unexpected engine implementation for $functionName." }
    }
}
# Invoke-TdVmTool resolves its argument encoder in the VmDeploy module's
# session state. Make that dependency explicit there as well as at this entrypoint.
$encoderPath = (Get-Item -LiteralPath (Join-Path $engine 'LiteDeploy.psm1')).FullName
& $moduleInfo {
    param($expectedPath)
    $encoder = Get-Command ConvertTo-TdWindowsArg -CommandType Function -ListImported -ErrorAction Stop
    if ($encoder.Module.Path -ine $expectedPath) { throw 'The VM argument encoder is unavailable in the VM engine.' }
} $encoderPath
if ($Name -ieq $env:COMPUTERNAME) { throw 'Choose a name different from the host.' }
$iso = Get-Item -LiteralPath $WindowsIso
if ($iso.PSIsContainer -or $iso.Length -le 0 -or $iso.Extension -ine '.iso') { throw 'Select Windows 11 ISO media.' }
$parent = Get-Item -LiteralPath $StorageParent
if (-not $parent.PSIsContainer -or $parent.PSProvider.Name -ne 'FileSystem') { throw 'Select an existing filesystem directory.' }
$folder = Join-Path $parent.FullName $Name
$frozenIso=Join-Path $folder 'windows11-installer.iso'
if (Test-Path -LiteralPath $folder) { throw 'The selected storage directory already exists.' }
$vmware = $null
if ($Hypervisor -ne 'VirtualBox') {
    try { $vmware = Get-TdVmwareTools } catch { if ($Hypervisor -eq 'VMware') { throw } }
}
if ($vmware) {
    $provider = 'VMware'
    $config = Join-Path $folder "$Name.vmx"
    $disk = Join-Path $folder "$Name.vmdk"
    $vmx = New-TdVmwareVmx -Name $Name -DiskFile "$Name.vmdk" -WindowsIso 'windows11-installer.iso' -Network hostonly -KioskWorkstation
} else {
    $provider = 'VirtualBox'
    $box = Join-Path $env:ProgramFiles 'Oracle/VirtualBox/VBoxManage.exe'
    if (-not (Test-Path -LiteralPath $box -PathType Leaf)) { throw 'Install VMware Workstation or VirtualBox 7 or later.' }
    function Invoke-Box([string[]]$Options) {
        $r = Invoke-TdVmTool -Exe $box -Arguments $Options -TimeoutSec 300
        if ($r.ExitCode -ne 0) { throw $r.Output }
        $r.Output
    }
    $version = Invoke-Box @('--version')
    if ($version -notmatch '^(\d+)\.' -or [int]$Matches[1] -lt 7) { throw 'VirtualBox 7 or later is required.' }
    $machines = Invoke-Box @('list','vms')
    if ($machines -match ('(?im)^"' + [regex]::Escape($Name) + '" ')) { throw 'The selected VM name is already registered.' }
    $config = Join-Path $folder "$Name.vbox"
    $disk = Join-Path $folder "$Name.vdi"
}
if ($WhatIfPreference) {
    $measured = (Get-FileHash -LiteralPath $iso.FullName -Algorithm SHA256).Hash
    if ($ExpectedWindowsIsoSha256 -and $measured -ine $ExpectedWindowsIsoSha256) { throw 'The installer ISO does not match the supplied SHA-256.' }
    [pscustomobject]@{ Name=$Name; Hypervisor=$provider; WindowsIsoSha256=$measured; WindowsIsoBytes=$iso.Length; Enrolled=$false; State='PreviewOnly' }
    return
}
if (-not $ExpectedWindowsIsoSha256) { throw 'Preview first and supply the approved installer SHA-256 before creation.' }
if (-not $PSCmdlet.ShouldProcess("$provider/$Name", 'Copy the pinned installation media and create a powered-off Windows 11 workstation')) { return }

function Copy-PinnedInstaller {
    # Copies only into the fresh VM directory. A changed source or interrupted
    # copy leaves the VM powered off and produces no successful creation receipt.
    $sourceStream=[IO.File]::Open($iso.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        $destinationStream=[IO.File]::Open($frozenIso,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $sourceStream.CopyTo($destinationStream); $destinationStream.Flush($true) } finally { $destinationStream.Dispose() }
    } finally { $sourceStream.Dispose() }
    if ((Get-FileHash -LiteralPath $frozenIso -Algorithm SHA256).Hash -ine $ExpectedWindowsIsoSha256) {
        throw 'The workstation copy differs from the approved installer SHA-256. Inspect the partial directory.'
    }
    (Get-Item -LiteralPath $frozenIso).IsReadOnly=$true
}
if ($vmware) {
    New-Item -ItemType Directory -Path $folder | Out-Null
    Copy-PinnedInstaller
    $r = Invoke-TdVmTool -Exe $vmware.DiskManager -Arguments @('-c','-s','80GB','-a','nvme','-t','0',$disk) -TimeoutSec 300
    if ($r.ExitCode -ne 0) { throw $r.Output }
    $media = & (Join-Path $PSScriptRoot 'New-CommonsGuestMedia.ps1') -ComputerName $Name -VmDirectory $folder -InstallerSha256 $ExpectedWindowsIsoSha256
    $vmx += @('sata0:1.present = "TRUE"','sata0:1.deviceType = "cdrom-image"','sata0:1.fileName = "commons-guest.iso"') -join [Environment]::NewLine
    Write-TdUtf8File -Path $config -Text ($vmx + [Environment]::NewLine)
    $state = 'RequiresWorkstationEncryptionAndTpm'
} else {
    $id = [guid]::NewGuid().ToString()
    Invoke-Box @('createvm','--name',$Name,'--uuid',$id,'--ostype','Windows11_64','--basefolder',$parent.FullName,'--register') | Out-Null
    Copy-PinnedInstaller
    Invoke-Box @('modifyvm',$id,'--memory','4096','--cpus','2','--firmware','efi','--tpm-type','2.0','--nic1','intnet','--intnet1',$PrivateNetwork) | Out-Null
    Invoke-Box @('createmedium','disk','--filename',$disk,'--size','81920','--format','VDI') | Out-Null
    Invoke-Box @('storagectl',$id,'--name','SATA','--add','sata','--controller','IntelAhci') | Out-Null
    Invoke-Box @('storageattach',$id,'--storagectl','SATA','--port','0','--device','0','--type','hdd','--medium',$disk) | Out-Null
    Invoke-Box @('storageattach',$id,'--storagectl','SATA','--port','1','--device','0','--type','dvddrive','--medium',$frozenIso) | Out-Null
    $media = & (Join-Path $PSScriptRoot 'New-CommonsGuestMedia.ps1') -ComputerName $Name -VmDirectory $folder -InstallerSha256 $ExpectedWindowsIsoSha256
    Invoke-Box @('storageattach',$id,'--storagectl','SATA','--port','2','--device','0','--type','dvddrive','--medium',$media.IsoPath) | Out-Null
    # These operations apply only to the fresh UUID registered in this invocation.
    foreach ($operation in 'inituefivarstore','enrollmssignatures','enrollorclpk') {
        Invoke-Box @('modifynvram',$id,$operation) | Out-Null
    }
    Invoke-Box @('modifynvram',$id,'secureboot','--enable') | Out-Null
    $state = 'RequiresSecureBootVerification'
}
Write-Host ("Guest setup DVD and independent verification values: {0}" -f $media.ReceiptPath)
[pscustomobject]@{ GuestMediaReceipt = $media.ReceiptPath; Configuration = $config; Hypervisor = $provider; Name = $Name; State = $state; Enrolled = $false }
