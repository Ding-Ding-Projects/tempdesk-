<#
.SYNOPSIS
    One-click download of the build tools for TempDesk Deployer into .tools\ (gitignored).

.DESCRIPTION
    Downloads, verifies by SHA-256 and unpacks:
      * Node.js LTS (portable zip) when node.exe is not on PATH or is older than 22.12
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

$Pins = Import-PowerShellDataFile -LiteralPath (Join-Path $PSScriptRoot 'build-tools.psd1')

function Get-Verified([string] $Url, [string] $Out, [string] $Sha) {
    if (Test-Path -LiteralPath $Out) {
        $file = Get-Item -LiteralPath $Out -Force
        if ($file.PSIsContainer -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Unexpected build-cache path.' }
        if ((Get-FileHash -LiteralPath $Out -Algorithm SHA256).Hash -ieq $Sha) { Say "  cached $($file.Name)"; return }
    }
    Say "  downloading $Url"
    $tmp = "$Out.$([guid]::NewGuid().ToString('N')).part"
    try {
        Invoke-WebRequest -Uri $Url -OutFile $tmp -UseBasicParsing
        if ((Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash -ine $Sha) { throw "SHA-256 mismatch for $Url" }
        if ([IO.File]::Exists($Out)) { [IO.File]::Replace($tmp,$Out,[NullString]::Value) }
        else { [IO.File]::Move($tmp,$Out) }
    } finally { if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) } }
}

# All staging and activation happen under this root. An interrupted directory
# switch is recovered before the next activation; existing files are never
# removed in order to make a checksum failure look successful.
if ((Get-Item -LiteralPath $tools -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The build tool root cannot be a redirected directory.'
}
$lock = [IO.File]::Open((Join-Path $tools 'build-tools.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    . (Join-Path $PSScriptRoot 'portable-build-tools.ps1')
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $haveNode = $false
    if ($node -and (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        $version = (& $node.Source --version) -replace '^v',''
        $haveNode = $LASTEXITCODE -eq 0 -and [version]($version.Split('-')[0]) -ge [version]'22.12.0'
    }
    if (-not $haveNode -or (Test-Path -LiteralPath (Join-Path $tools 'node'))) {
        $version = $Pins.NodeVersion
        $zip = Join-Path $tools "node-$version-win-x64.zip"
        Get-Verified "https://nodejs.org/dist/$version/node-$version-win-x64.zip" $zip $Pins.NodeZipSha
        Sync-PortableTool -Name node -Archive $zip -Prefix "node-$version-win-x64/"
        $actualNode = & (Join-Path $tools 'node/node.exe') --version
        if ($LASTEXITCODE -ne 0 -or $actualNode -ne $version) { throw 'Portable Node version verification failed.' }
    }
    if (-not (Get-Command git.exe -ErrorAction SilentlyContinue) -or (Test-Path -LiteralPath (Join-Path $tools 'git'))) {
        $pin = Get-Content -LiteralPath (Join-Path $root 'deployer/build-companion/git-tool.json') -Raw | ConvertFrom-Json
        $zip = Join-Path $tools $pin.file
        Get-Verified $pin.url $zip $pin.sha256
        Sync-PortableTool -Name git -Archive $zip
        $actualGit = & (Join-Path $tools 'git/cmd/git.exe') --version
        if ($LASTEXITCODE -ne 0 -or $actualGit -notmatch '^git version 2\.56\.1\.windows\.1$') { throw 'Portable Git version verification failed.' }
    }
    $nuget = Join-Path $tools 'nuget.exe'
    Get-Verified $Pins.NuGetUrl $nuget $Pins.NuGetSha
    $package = Join-Path $tools 'squirrel.windows.2.0.1.nupkg'
    Get-Verified $Pins.SquirrelUrl $package $Pins.SquirrelSha
    Sync-PortableTool -Name squirrel -Archive $package -Prefix 'tools/' -NuGet $nuget
    Say "Build tools ready in $tools"
} finally { $lock.Dispose() }