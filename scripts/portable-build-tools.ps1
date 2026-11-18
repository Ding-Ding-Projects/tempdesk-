# Hash the archive contents directly, so a marker file never vouches for an
# executable. This inventory also includes npm scripts and runtime DLLs.
function Get-PortableInventory($Zip,[string]$Prefix,[string]$Name,[string]$NuGet) {
    $files = @{}
    $sha = [Security.Cryptography.SHA256]::Create()
    try {
        foreach ($entry in $Zip.Entries) {
            if (-not $entry.Name -or -not $entry.FullName.StartsWith($Prefix,[StringComparison]::Ordinal)) { continue }
            $nameInZip = $entry.FullName.Substring($Prefix.Length).Replace('\','/')
            if ($nameInZip -match '(^/|:|(^|/)\.{1,2}(/|$))' -or $files.ContainsKey($nameInZip)) { throw 'Invalid archive member.' }
            if ($Name -eq 'squirrel' -and $nameInZip -ieq 'signtool.exe') { continue }
            $stream=$entry.Open()
            try { $hash=[BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-','') } finally { $stream.Dispose() }
            $files[$nameInZip]=@{ Hash=$hash; Entry=$entry; Source=$null }
        }
    } finally { $sha.Dispose() }
    if ($Name -eq 'squirrel') {
        foreach ($file in $Pins.SquirrelTools.Keys) {
            if (-not $files.ContainsKey($file) -or $files[$file].Hash -ine $Pins.SquirrelTools[$file]) { throw "Unexpected Squirrel tool: $file" }
        }
        $files['7z-x64.exe']=$files['7z.exe']
        $files['7z-x64.dll']=$files['7z.dll']
        $files['nuget.exe']=@{ Hash=$Pins.NuGetSha; Entry=$null; Source=$NuGet }
    }
    if (-not $files.Count) { throw 'The pinned archive contains no build tools.' }
    $files
}

function Test-PortableTree([string]$Path,$Files) {
    if (-not [IO.Directory]::Exists($Path)) { return $false }
    if ((Get-Item -LiteralPath $Path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected build tool directory.' }
    $queue=[Collections.Generic.Stack[string]]::new()
    $queue.Push($Path)
    $count=0
    while ($queue.Count) {
        foreach ($item in Get-ChildItem -LiteralPath $queue.Pop() -Force) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Redirected build tool member.' }
            if ($item.PSIsContainer) { $queue.Push($item.FullName); continue }
            $key=$item.FullName.Substring($Path.Length+1).Replace('\','/')
            if (-not $Files.ContainsKey($key) -or (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash -ine $Files[$key].Hash) { return $false }
            $count++
        }
    }
    $count -eq $Files.Count
}

function Sync-PortableTool {
    param([ValidateSet('node','git','squirrel')][string]$Name,[string]$Archive,[string]$Prefix='',[string]$NuGet)
    $dest=Join-Path $tools $Name
    $backup=Join-Path $tools ('.previous-'+$Name)
    if (-not (Test-Path -LiteralPath $dest) -and (Test-Path -LiteralPath $backup)) {
        Move-Item -LiteralPath $backup -Destination $dest -ErrorAction Stop
    }
    $zip=[IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $files=Get-PortableInventory $zip $Prefix $Name $NuGet
        if (Test-PortableTree $dest $files) { Say "Verified installed $Name files."; return }
        $stage=Join-Path $tools ('.stage-'+$Name+'-'+[guid]::NewGuid().ToString('N'))
        [IO.Directory]::CreateDirectory($stage) | Out-Null
        foreach ($file in $files.Keys) {
            $out=Join-Path $stage $file
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($out)) | Out-Null
            if ($files[$file].Source) { [IO.File]::Copy($files[$file].Source,$out) }
            else { [IO.Compression.ZipFileExtensions]::ExtractToFile($files[$file].Entry,$out) }
        }
        if (-not (Test-PortableTree $stage $files)) { throw "Staged $Name verification failed." }
        # Retain prior tool trees; a future build version can be rolled back
        # without deleting a directory another process may still have open.
        if (Test-Path -LiteralPath $backup) {
            Move-Item -LiteralPath $backup -Destination (Join-Path $tools ('.retained-'+$Name+'-'+[guid]::NewGuid().ToString('N')))
        }
        if (Test-Path -LiteralPath $dest) { Move-Item -LiteralPath $dest -Destination $backup }
        try { Move-Item -LiteralPath $stage -Destination $dest }
        catch {
            if (-not (Test-Path -LiteralPath $dest) -and (Test-Path -LiteralPath $backup)) { Move-Item -LiteralPath $backup -Destination $dest }
            throw
        }
    } finally { $zip.Dispose() }
}
