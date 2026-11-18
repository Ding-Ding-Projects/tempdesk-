<#
.SYNOPSIS
    Creates a dedicated Windows 11 RDP workstation on an existing private Hyper-V network.
.DESCRIPTION
    Start the new VM from licensed Windows 11 installation media. The operator chooses
    Pro, Enterprise or Education, completes setup and joins the existing lab domain.
    This does not clone an identity or install the server/domain-controller answer file.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact='High')]
param(
    [Parameter(Mandatory)][ValidatePattern('^(?![0-9]+$)[A-Za-z0-9][A-Za-z0-9-]{0,13}[A-Za-z0-9]$')][string]$Name,
    [Parameter(Mandatory)][string]$WindowsIso,
    [Parameter(Mandatory)][string]$PrivateSwitch,
    [Parameter(Mandatory)][string]$StorageParent
)
$ErrorActionPreference = 'Stop'
if ($Name -ieq $env:COMPUTERNAME) { throw 'Choose a name different from the host.' }
$iso = Get-Item -LiteralPath $WindowsIso
if ($iso.PSIsContainer -or $iso.Extension -ine '.iso') { throw 'Select Windows 11 ISO media.' }
$switch = @(Get-VMSwitch | Where-Object Name -eq $PrivateSwitch)
if ($switch.Count -ne 1 -or $switch[0].SwitchType -ne 'Private') { throw 'Select an existing private VM switch for the lab.' }
$parent = Get-Item -LiteralPath $StorageParent
if (-not $parent.PSIsContainer -or $parent.PSProvider.Name -ne 'FileSystem') { throw 'Select an existing filesystem directory.' }
$folder = Join-Path $parent.FullName $Name
if ((Get-VM | Where-Object Name -eq $Name) -or (Test-Path -LiteralPath $folder)) { throw 'This VM name or storage directory already exists.' }
if (-not $PSCmdlet.ShouldProcess("$Name on $PrivateSwitch", 'Create and boot a new Generation 2 Windows 11 workstation')) { return }
# Directory.CreateDirectory can reuse a concurrent creation. New-Item without -Force rejects it.
New-Item -ItemType Directory -Path $folder -ErrorAction Stop | Out-Null
$vm = New-VM -Name $Name -Generation 2 -MemoryStartupBytes 4GB -Path $folder -NewVHDPath (Join-Path $folder 'system.vhdx') -NewVHDSizeBytes 80GB -SwitchName $switch[0].Name
Set-VMProcessor -VM $vm -Count 2
Set-VMKeyProtector -VM $vm -NewLocalKeyProtector
Enable-VMTPM -VM $vm
$dvd = Add-VMDvdDrive -VM $vm -Path $iso.FullName -Passthru
Set-VMFirmware -VM $vm -EnableSecureBoot On -SecureBootTemplate MicrosoftWindows -FirstBootDevice $dvd
Start-VM -VM $vm
[pscustomobject]@{ VmId = $vm.Id; Name = $vm.Name; Network = $PrivateSwitch; State = 'InstallerBootStarted'; Enrolled = $false }
