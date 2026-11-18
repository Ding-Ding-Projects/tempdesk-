$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Assert-LocalPath([string]$p) {
    if ($p -notmatch '^[A-Za-z]:\\' -or $p.Substring(2) -match '[:*?]' -or [IO.Path]::GetFullPath($p) -ne $p) {
        throw 'Choose an absolute local image file.'
    }
    if ((New-Object IO.DriveInfo([IO.Path]::GetPathRoot($p))).DriveType -notin 'Fixed','Removable') {
        throw 'The image must be on a local fixed or removable volume.'
    }
    $cursor = $p
    while ($cursor) {
        if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw 'A link or junction occurs in the selected image path.'
        }
        $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
}
if ($q.action -eq 'discover') {
    $items = @(Get-CimInstance -Namespace 'root/Microsoft/Windows/Storage' -ClassName MSFT_DiskImage -ErrorAction Stop |
        Where-Object { $_.Attached -and $_.ImagePath } | ForEach-Object { $_.ImagePath })
    [Console]::WriteLine((@{files=$items} | ConvertTo-Json -Compress))
    return
}
Assert-LocalPath $q.path
if ($q.path.Substring(3).Split('\') | Where-Object { $_ -match '^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)' -or $_ -match '[ .]$' }) {
    throw 'A reserved device name or ambiguous path component is not a disk image file.'
}
$format = [IO.Path]::GetExtension($q.path).ToLowerInvariant()
$devices = @{'.iso'=1;'.vhd'=2;'.vhdx'=3;'.vhds'=4;'.avhd'=2;'.avhdx'=3}
if (!$devices.ContainsKey($format)) { throw 'This file extension is not a supported disk image.' }
if ($q.action -eq 'create') {
    if ($format -notin '.vhd','.vhdx','.vhds' -or (Test-Path -LiteralPath $q.path)) { throw 'Choose a new virtual disk filename.' }
    $limit = if ($format -eq '.vhd') { 2040GB } else { 64TB }
    $bytes = [int64]$q.mib * 1MB
    if ($bytes -lt 3MB -or $bytes -gt $limit) { throw 'The size is outside the supported range for this format.' }
    if ($q.fixed -and (New-Object IO.DriveInfo([IO.Path]::GetPathRoot($q.path))).AvailableFreeSpace -le $bytes) { throw 'Insufficient free space for fixed allocation.' }
    [TempDeskImage]::Create($q.path,$devices[$format],$bytes,$q.fixed)
    if ([TempDeskImage]::Capacity($q.path,$devices[$format]) -ne $bytes) {
        throw 'The disk was created, but its reopened capacity did not match the requested size. The file was retained.'
    }
} elseif ($q.action -eq 'attach') {
    $ownerProcess = Get-Process -Id $q.owner
    if ($ownerProcess.StartTime.ToUniversalTime().Ticks.ToString() -ne $q.ownerStart) { throw 'The requesting session ended.' }
    $storageModule = Join-Path $PSHOME 'Modules\Storage\Storage.psd1'
    Import-Module $storageModule
    if ((Storage\Get-DiskImage -ImagePath $q.path).Attached) { throw 'The image already has an attachment.' }
    $ready = [Threading.EventWaitHandle]::OpenExisting($q.ready)
    $handle = [TempDeskImage]::Attach($q.path,$devices[$format])
    try {
        if (!(Storage\Get-DiskImage -ImagePath $q.path).Attached) { throw 'The attachment could not be verified.' }
        [void]$ready.Set()
        $ownerProcess.WaitForExit()
    } finally {
        $handle.Dispose()
        $ready.Dispose()
    }
} elseif ($q.action -ne 'inspect') { throw 'Unsupported operation.' }
if ($q.action -ne 'attach') {
    $item = Get-Item -LiteralPath $q.path
    $result = [ordered]@{ path=$item.FullName; bytes=$item.Length; format=$format; attached=$null; storageReason=$null; details=$null; detailReason=$null }
    try {
        Import-Module (Join-Path $PSHOME 'Modules\Storage\Storage.psd1')
        $image = Storage\Get-DiskImage -ImagePath $q.path
        $result.attached = $image.Attached
        $result.device = $image.DevicePath
        $result.virtualBytes = $image.Size
        $result.logicalSector = $image.LogicalSectorSize
        if ($image.Attached -and $format -ne '.iso') {
            try {
                $result.partitions = @($image | Storage\Get-Disk | Storage\Get-Partition |
                    Select-Object PartitionNumber,Type,Size,Offset,DriveLetter,AccessPaths)
            } catch { $result.partitionReason = $_.Exception.Message }
        }
    } catch { $result.storageReason = $_.Exception.Message }
    if ($format -ne '.iso') {
        try {
            Import-Module (Join-Path $PSHOME 'Modules\Hyper-V\Hyper-V.psd1')
            if ($format -eq '.vhds') {
                $result.details = Hyper-V\Get-VHDSet -Path $q.path | Select-Object Path,AllPaths
                $result.snapshots = @(Hyper-V\Get-VHDSnapshot -Path $q.path | Select-Object SnapshotId)
            } else {
                $result.details = Hyper-V\Get-VHD -Path $q.path | Select-Object VhdType,Size,MinimumSize,BlockSize,LogicalSectorSize,PhysicalSectorSize,FragmentationPercentage,DiskIdentifier,ParentPath
                $result.chainValid = Hyper-V\Test-VHD -Path $q.path
            }
        } catch { $result.detailReason = $_.Exception.Message }
    }
    [Console]::WriteLine(($result | ConvertTo-Json -Compress -Depth 4))
}
