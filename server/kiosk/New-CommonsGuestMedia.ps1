<#
.SYNOPSIS
    Builds the second, credential-free setup DVD for one new Windows 11 workstation.
.DESCRIPTION
    The only unattended settings are the validated computer name, TLS and NLA.
    Normal Windows Setup owns licensing, disk selection and account setup.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^(?![0-9]+$)[A-Za-z0-9][A-Za-z0-9-]{0,13}[A-Za-z0-9]$')][string]$ComputerName,
    [Parameter(Mandatory)][string]$VmDirectory,
    [Parameter(Mandatory)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$InstallerSha256,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')][string]$MediaDirectoryName
)
$ErrorActionPreference='Stop'
$vmRoot=Get-Item -LiteralPath $VmDirectory
if (-not $vmRoot.PSIsContainer -or $vmRoot.PSProvider.Name -ne 'FileSystem' -or ($vmRoot.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Select the existing, non-redirected workstation directory.'
}
$installerIso=Join-Path $vmRoot.FullName 'windows11-installer.iso'
$mediaRoot=$vmRoot.FullName
if ($PSBoundParameters.ContainsKey('MediaDirectoryName')) {
    $installerFile=Get-Item -LiteralPath $installerIso
    if ($installerFile.PSIsContainer -or ($installerFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
        (Get-FileHash -LiteralPath $installerIso -Algorithm SHA256).Hash -ine $InstallerSha256) {
        throw 'The existing installer must match the pinned workstation media.'
    }
    $mediaRoot=Join-Path $vmRoot.FullName $MediaDirectoryName
    if (Test-Path -LiteralPath $mediaRoot) { throw 'Select a fresh media directory name.' }
    New-Item -ItemType Directory -Path $mediaRoot | Out-Null
}
$stage=Join-Path $mediaRoot 'guest-media-source'
$iso=Join-Path $mediaRoot 'commons-guest.iso'
$receipt=Join-Path $mediaRoot 'guest-media-receipt.json'
foreach ($destination in $stage,$iso,$receipt) {
    if (Test-Path -LiteralPath $destination) { throw 'Guest media already exists. Select an unused workstation directory.' }
}
New-Item -ItemType Directory -Path $stage | Out-Null
$answer=@"
<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <ComputerName>$ComputerName</ComputerName>
    </component>
    <component name="Microsoft-Windows-TerminalServices-RDP-WinStationExtensions" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <SecurityLayer>2</SecurityLayer>
      <UserAuthentication>1</UserAuthentication>
    </component>
  </settings>
</unattend>
"@
$utf8=[Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $stage 'Autounattend.xml'),$answer,$utf8)
$server=Split-Path -Parent $PSScriptRoot
$files=@('kiosk/Get-CommonsKioskReadiness.ps1','kiosk/Get-CommonsEnrollmentSteps.ps1','kiosk/Set-CommonsKioskRestrictions.ps1',
    'kiosk/Start-CommonsSeatBroker.ps1','kiosk/Register-CommonsSeatStartup.ps1','kiosk/SeatAuthorization.ps1','kiosk/SeatTransitions.ps1',
    'kiosk/SeatSessions.ps1','apphost/VirtualCommonsHost.ps1','apphost/i18n/en.json','apphost/i18n/zh-HK.json')
$inventory=[ordered]@{}
foreach ($relative in $files) {
    $source=Join-Path $server $relative
    $dest=Join-Path $stage $relative
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest)) | Out-Null
    [IO.File]::Copy($source,$dest)
    $inventory[$relative]=(Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
}
$installer=Join-Path $stage 'Install-CommonsGuestFiles.ps1'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install-CommonsGuestFiles.ps1') -Destination $installer
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'README.md') -Destination (Join-Path $stage 'Operator-Guide.md')
$manifest=Join-Path $stage 'GuestFiles.json'
$bundle=[ordered]@{ schema=1; computerName=$ComputerName; files=$inventory }
[IO.File]::WriteAllText($manifest,($bundle | ConvertTo-Json -Depth 3),$utf8)
$built=New-TdIso -Folder $stage -IsoPath $iso -Label 'TDKIOSK'
if ($built.Length -le 0) { throw 'The setup DVD was empty.' }
$data=[ordered]@{
    computerName=$ComputerName; windowsIsoPath=$installerIso; windowsIsoSha256=$InstallerSha256; isoPath=$iso; isoSha256=(Get-FileHash -LiteralPath $iso -Algorithm SHA256).Hash
    installerSha256=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash
    manifestSha256=(Get-FileHash -LiteralPath $manifest -Algorithm SHA256).Hash
}
[IO.File]::WriteAllText($receipt,($data | ConvertTo-Json),$utf8)
[pscustomobject]@{ IsoPath=$iso; ReceiptPath=$receipt }
