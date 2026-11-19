#requires -Version 5.1
[CmdletBinding()]
param([string]$CredentialFile, [string]$CaFile)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (!$CredentialFile) {
    if ($CaFile) { throw 'A CA bundle requires a broker credential file.' }
    Write-Output 'Broker setup skipped. Supply -CredentialFile to opt in.'
    return
}
if ($env:OS -ne 'Windows_NT') { throw 'Use the Windows entrypoint on the Docker Desktop host.' }

$trusted = @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value, 'S-1-5-18', 'S-1-5-32-544')
$installer = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
$repo = (Get-Item -LiteralPath (Join-Path $PSScriptRoot '..')).FullName
function Get-ProtectedFile([string]$Candidate, [bool]$Confidential) {
    if ($Candidate -notmatch '^[A-Za-z]:\\' -or $Candidate.Substring(2).Contains(':')) {
        throw 'Supply an absolute local drive path to a regular file.'
    }
    $full = [IO.Path]::GetFullPath($Candidate)
    if ($Candidate -ine $full -or $full.StartsWith($repo + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Supply a canonical file path outside the repository and build context.'
    }
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($full))
    if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'A fixed local NTFS volume is required.' }
    # Drive-letter substitutions and volume aliases are not mount authority.
    $partitions = @(Get-Partition -DriveLetter $full[0] -ErrorAction Stop)
    if ($partitions.Count -ne 1) { throw 'The drive letter must identify a local disk partition.' }
    $file = Get-Item -LiteralPath $full -Force
    if ($file -isnot [IO.FileInfo] -or !$file.Length) { throw 'An existing nonempty regular file is required.' }
    # Reject aliases into the build context or another user-controlled directory.
    $links = @(& fsutil.exe hardlink list $full 2>$null)
    if ($LASTEXITCODE -ne 0 -or $links.Count -ne 1) { throw 'Cannot establish a single NTFS file link.' }
    $node = $file
    $immediate = $file.Directory.FullName
    while ($null -ne $node) {
        if ($node.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse points are not supported.' }
        $acl = Get-Acl -LiteralPath $node.FullName
        $owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value
        if ($owner -notin ($trusted + $installer)) { throw 'A file or path component has an untrusted owner.' }
        $raw = [Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
        if ($null -eq $raw.DiscretionaryAcl) { throw 'A file or path component has no discretionary ACL.' }
        foreach ($rule in $acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier])) {
            if ($rule.AccessControlType -ne 'Allow' -or $rule.IdentityReference.Value -in ($trusted + $installer) -or
                ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly)) { continue }
            $rights = [Security.AccessControl.FileSystemRights]
            $mask = $rights::Delete -bor $rights::ChangePermissions -bor $rights::TakeOwnership -bor $rights::DeleteSubdirectoriesAndFiles -bor $rights::WriteAttributes -bor $rights::WriteExtendedAttributes
            if ($node.FullName -eq $immediate -or $node -is [IO.FileInfo]) {
                $mask = $mask -bor $rights::WriteData -bor $rights::AppendData
            }
            if ($Confidential -and $node -is [IO.FileInfo]) { $mask = $mask -bor $rights::ReadData }
            if ($rule.FileSystemRights -band $mask) { throw 'A file or path component grants access incompatible with a protected mount.' }
        }
        if ($node -is [IO.FileInfo]) { $node = $node.Directory } else { $node = $node.Parent }
    }
    return $full
}

$key = Get-ProtectedFile $CredentialFile $true
$brokerFiles = @('-f','compose.kiosk.yaml')
$ca = $null
if ($CaFile) {
    $ca = Get-ProtectedFile $CaFile $false
    if ($ca -ieq $key) { throw 'Select a separate CA bundle.' }
    $brokerFiles += @('-f','compose.kiosk-ca.yaml')
}

# Pin all engine calls to the same local endpoint, independent of the selected context.
$endpoint = 'npipe:////./pipe/dockerDesktopLinuxEngine'
$engine = & docker.exe --host $endpoint info --format '{{.OSType}}|{{.OperatingSystem}}'
if ($LASTEXITCODE -ne 0 -or $engine -ne 'linux|Docker Desktop') {
    throw 'The local Docker Desktop Linux engine is unavailable.'
}
$priorKey = $env:TEMPDESK_KIOSK_KEY_SOURCE
$priorCa = $env:TEMPDESK_KIOSK_CA_SOURCE
$priorDigest = $env:TEMPDESK_PORTAL_DIGEST
Push-Location -LiteralPath $PSScriptRoot
try {
    $env:TEMPDESK_KIOSK_KEY_SOURCE = $key
    $env:TEMPDESK_KIOSK_CA_SOURCE = $ca
    $files = @('-f','compose.yaml')
    $pullArgs = @()
    $digest = $priorDigest
    $prefix = 'ghcr.io/ding-ding-projects/tempdesk-portal@'
    if (!$digest) {
        $current = @(& docker.exe --host $endpoint compose @files ps -q tempdesk-guest)
        if ($LASTEXITCODE -ne 0 -or $current.Count -gt 1) { throw 'Cannot determine the current guest image.' }
        if ($current.Count -eq 1) {
            $image = & docker.exe --host $endpoint inspect --format '{{.Config.Image}}' $current[0]
            if ($LASTEXITCODE -ne 0) { throw 'Cannot determine the current guest image.' }
            if ($image.StartsWith($prefix, [StringComparison]::Ordinal)) { $digest = $image.Substring($prefix.Length) }
        }
    }
    if ($digest) {
        if ($digest -cnotmatch '^sha256:[0-9a-f]{64}$' -or $digest -cne $digest.Trim()) {
            throw 'Use the exact digest from a portal publication receipt.'
        }
        $env:TEMPDESK_PORTAL_DIGEST = $digest
        $files += @('-f','compose.published.yaml')
        $pullArgs = @('--pull','never')
    }
    $files += $brokerFiles
    & docker.exe --host $endpoint compose @files config --quiet *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Guest Compose configuration is invalid.' }
    & docker.exe --host $endpoint compose @files up --no-build --no-deps --force-recreate @pullArgs -d tempdesk-guest
    if ($LASTEXITCODE -ne 0) { throw 'Guest service recreation did not complete.' }
} finally {
    $env:TEMPDESK_KIOSK_KEY_SOURCE = $priorKey
    $env:TEMPDESK_KIOSK_CA_SOURCE = $priorCa
    $env:TEMPDESK_PORTAL_DIGEST = $priorDigest
    Pop-Location
}
