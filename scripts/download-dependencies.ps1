<#
.SYNOPSIS
    One-click download of the build tools for TempDesk Deployer into .tools\ (gitignored).

.DESCRIPTION
    Downloads, verifies by SHA-256 and unpacks:
      * Node.js LTS (portable zip) when node.exe is not on PATH or is older than 20
      * nuget.exe 6.11.1 from dist.nuget.org
      * Squirrel.Windows 2.0.1 release tools (Squirrel.exe, Setup.exe, StubExecutable.exe,
        WriteZipToSetup.exe, SyncReleases.exe, 7-Zip, WiX helpers) from the official
        squirrel.windows 2.0.1 package, prepared as the vendor folder the packager uses.
    Every download is checked against a SHA-256 pinned below. A mismatch stops the script.

    About the Squirrel source: the GitHub release page for 2.0.1 could not be reached from the
    environment where these hashes were recorded, so the files come from the squirrel.windows
    2.0.1 package published by the Squirrel project on nuget.org, which ships the same release
    tools. The package hash and each tool's hash are pinned.

.PARAMETER Silent
    No progress output except errors.
#>
[CmdletBinding()]
param([switch] $Silent)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$root = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $root '.tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null

function Say([string] $m) { if (-not $Silent) { Write-Host $m } }

$Pins = @{
    NodeVersion  = 'v24.22.1'
    NodeZipSha   = 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5'
    NuGetUrl     = 'https://dist.nuget.org/win-x86-commandline/v6.11.1/nuget.exe'
    NuGetSha     = 'c0ddc9cb0633c4607da7e8028eb4f91248c8b74e45a68b0c79fcfa7d78c2a481'
    SquirrelUrl  = 'https://api.nuget.org/v3-flatcontainer/squirrel.windows/2.0.1/squirrel.windows.2.0.1.nupkg'
    SquirrelSha  = '923e18abb4fd50b5a4878a39dbcd042ed3f7eb68fc0f82c0955cd5380c921ac7'
    SquirrelTools = @{
        'Setup.exe'          = '1e47eb606dad4c5c1568cfb8f4e970e1051ba5806aedb1ff3256284a8280d83b'
        'Squirrel.exe'       = '76359cd4b0349a83337b941332ad042c90351c2bb0a4628307740324c97984cc'
        'StubExecutable.exe' = 'd823e6d954f7e445fbbb5c04e40a39cf248a3621f9eccbafdf3f0f1e7acb11dd'
        'WriteZipToSetup.exe' = '9278fe28ac434fde0be3a10788dc13ad92a28940ed70a52f86d9d69435599349'
        'SyncReleases.exe'   = 'c2a2c78e0912a6576517fc69ffd32793134f1a5b2b066279de3757c76c501548'
        '7z.exe'             = 'c7245e21a7553d9e52d434002a401c77a7ca7d0f245f2311b0ddf16f8f946c6f'
        '7z.dll'             = '9ed007aa82e440ceb39a6e105bb1d602a9bc59a4946267ba8de2f220aa15bc06'
        'rcedit.exe'         = 'e2df7b664db830f159d0dc6b3da8a95442cca175b9577f2d19952646d37ac32f'
    }
}

function Get-Verified([string] $Url, [string] $Out, [string] $Sha) {
    if ((Test-Path -LiteralPath $Out) -and ((Get-FileHash -LiteralPath $Out -Algorithm SHA256).Hash -eq $Sha.ToUpperInvariant())) { Say "  cached $(Split-Path -Leaf $Out)"; return }
    Say "  downloading $Url"
    $tmp = "$Out.part"
    Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
    $got = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash
    if ($got -ne $Sha.ToUpperInvariant()) { Remove-Item -LiteralPath $tmp -Force; throw "SHA-256 mismatch for $Url`n expected $Sha`n got      $got" }
    Move-Item -LiteralPath $tmp -Destination $Out -Force
}

# ---- Node.js ---------------------------------------------------------------------------------
$needNode = $true
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $v = (& $node.Source --version) -replace '^v', ''
    if ([version]($v.Split('-')[0]) -ge [version]'20.0.0') { $needNode = $false; Say "Node.js $v found on PATH." }
}
if ($needNode) {
    Say "Node.js $($Pins.NodeVersion) (portable)"
    $zip = Join-Path $tools "node-$($Pins.NodeVersion)-win-x64.zip"
    Get-Verified "https://nodejs.org/dist/$($Pins.NodeVersion)/node-$($Pins.NodeVersion)-win-x64.zip" $zip $Pins.NodeZipSha
    $dest = Join-Path $tools 'node'
    if (-not (Test-Path (Join-Path $dest 'node.exe'))) {
        Expand-Archive -LiteralPath $zip -DestinationPath $tools -Force
        if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
        Rename-Item (Join-Path $tools "node-$($Pins.NodeVersion)-win-x64") 'node'
    }
}

# ---- nuget.exe ------------------------------------------------------------------------------
Say 'nuget.exe 6.11.1'
Get-Verified $Pins.NuGetUrl (Join-Path $tools 'nuget.exe') $Pins.NuGetSha

# ---- Squirrel.Windows 2.0.1 tools -> .tools\squirrel (vendor folder for the packager) -------
Say 'Squirrel.Windows 2.0.1'
$pkg = Join-Path $tools 'squirrel.windows.2.0.1.nupkg'
Get-Verified $Pins.SquirrelUrl $pkg $Pins.SquirrelSha
$sq = Join-Path $tools 'squirrel'
if (Test-Path $sq) { Remove-Item $sq -Recurse -Force }
$x = Join-Path $tools 'squirrel-pkg'
if (Test-Path $x) { Remove-Item $x -Recurse -Force }
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::ExtractToDirectory($pkg, $x)
Copy-Item -Path (Join-Path $x 'tools') -Destination $sq -Recurse
Remove-Item $x -Recurse -Force
foreach ($k in $Pins.SquirrelTools.Keys) {
    $h = (Get-FileHash -LiteralPath (Join-Path $sq $k) -Algorithm SHA256).Hash
    if ($h -ne $Pins.SquirrelTools[$k].ToUpperInvariant()) { throw "SHA-256 mismatch for Squirrel tool $k" }
}
# Code signing is prohibited by the owner: the signing tool is removed from the vendor folder.
Remove-Item -LiteralPath (Join-Path $sq 'signtool.exe') -Force -ErrorAction SilentlyContinue
# The packager picks 7-Zip by host architecture and runs nuget.exe from the vendor folder.
Copy-Item (Join-Path $sq '7z.exe') (Join-Path $sq '7z-x64.exe') -Force
Copy-Item (Join-Path $sq '7z.dll') (Join-Path $sq '7z-x64.dll') -Force
Copy-Item (Join-Path $tools 'nuget.exe') (Join-Path $sq 'nuget.exe') -Force
Say "Build tools ready in $tools"
