<#
.SYNOPSIS
    Installs the broker code from the read-only guest setup DVD into a new protected directory.
.DESCRIPTION
    Compare this helper's SHA-256 to the hypervisor-side receipt before running.
    Supply the manifest digest from that same receipt, not from the DVD.
#>
[CmdletBinding(SupportsShouldProcess,ConfirmImpact='High')]
param([Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedManifestSha256)
$ErrorActionPreference='Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or -not [Environment]::Is64BitProcess) { throw 'Use 64-bit Windows PowerShell 5.1 inside the guest.' }
$drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($PSScriptRoot))
if ($drive.DriveType -ne 'CDRom' -or $drive.VolumeLabel -ne 'TDKIOSK') { throw 'Run this helper from the workstation setup DVD.' }
$manifestPath=Join-Path $PSScriptRoot 'GuestFiles.json'
if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ine $ExpectedManifestSha256) { throw 'The guest manifest does not match the hypervisor receipt.' }
$manifest=Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$machine=Get-CimInstance Win32_ComputerSystem
$os=Get-CimInstance Win32_OperatingSystem
$edition=(Get-ItemProperty 'HKLM:/SOFTWARE/Microsoft/Windows NT/CurrentVersion').EditionID
if ($manifest.schema -ne 1 -or $manifest.computerName -ine $machine.Name -or $os.ProductType -ne 1 -or
    [int]$os.BuildNumber -lt 22000 -or $edition -notin @('Professional','Education','Enterprise')) { throw 'The selected media does not match this Windows 11 workstation.' }
if (-not (($machine.Manufacturer -match '^VMware' -and $machine.Model -match '^VMware') -or
    ($machine.Manufacturer -in @('innotek GmbH','Oracle Corporation') -and $machine.Model -eq 'VirtualBox'))) { throw 'This entrypoint is for the dedicated lab VM.' }
$tpm=Get-Tpm
$tpmDetails=Get-CimInstance -Namespace root/cimv2/security/microsofttpm -ClassName Win32_Tpm
if (-not (Confirm-SecureBootUEFI) -or -not $tpm.TpmReady -or $tpmDetails.SpecVersion -notmatch '^2\.0(?:,|$)') { throw 'Enable and verify Secure Boot and TPM 2.0 in the guest first.' }
$names=@($manifest.files.PSObject.Properties)
if (-not $names.Count) { throw 'The enrollment package contains no files.' }
foreach ($file in $names) {
    if ($file.Name -notmatch '^(?:kiosk/[A-Za-z0-9-]+\.ps1|apphost/VirtualCommonsHost\.ps1|apphost/i18n/(?:en|zh-HK)\.json)$' -or
        $file.Value -notmatch '^[a-fA-F0-9]{64}$' -or
        (Get-FileHash -LiteralPath (Join-Path $PSScriptRoot $file.Name) -Algorithm SHA256).Hash -ine $file.Value) { throw 'Invalid enrollment package member.' }
}
# Each revision gets a new directory. Never write through an existing target or
# change the binaries used by an active broker.
$programs=[Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles)
$destination=Join-Path $programs ('TempDesk-Seat-'+$ExpectedManifestSha256.ToUpperInvariant())
if (Test-Path -LiteralPath $destination) { throw "That broker revision already exists. Inspect the installation at $destination." }
if (-not $PSCmdlet.ShouldProcess($destination,'Stage verified workstation broker code')) { return }
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run from an administrator console approved by the operator.'
}
$acl=[Security.AccessControl.DirectorySecurity]::new()
$admins=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$acl.SetOwner($admins)
$acl.SetAccessRuleProtection($true,$false)
foreach ($sid in $admins,([Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit, ObjectInherit','None','Allow'))
}
$temp=Join-Path $programs ('TempDesk-Seat-staging-'+[guid]::NewGuid().ToString('N'))
[IO.DirectoryInfo]::new($temp).Create($acl)
foreach ($file in $names) {
    $dest=Join-Path $temp $file.Name
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest)) | Out-Null
    [IO.File]::Copy((Join-Path $PSScriptRoot $file.Name),$dest)
    if ((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ine $file.Value) { throw 'Installed broker payload did not match its manifest.' }
}
[IO.Directory]::Move($temp,$destination)
[pscustomobject]@{ ComputerName=$machine.Name; InstalledPath=$destination; BrokerEntry=Join-Path $destination 'kiosk/Start-CommonsSeatBroker.ps1'; State='FilesInstalledEnrollmentPending'; Enrolled=$false }
