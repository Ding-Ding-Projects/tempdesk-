# Build into an empty directory so old same-version files can never satisfy
# this invocation. Promote the complete verified directory in one move.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root 'deployer/app'
$output = Join-Path $root 'deployer/output'
$version = $env:TEMPDESK_VERSION
if (-not $version) { $version=(Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw | ConvertFrom-Json).version }
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Expected a numeric three-part installer version.' }
[IO.Directory]::CreateDirectory($output) | Out-Null
if ((Get-Item -LiteralPath $output).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected redirected packaging directory.' }
$lock = [IO.File]::Open((Join-Path $output '.installer.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
    $live=Join-Path $output 'squirrel-windows'
    $last=Join-Path $output '.previous-squirrel-windows'
    if (-not [IO.Directory]::Exists($live) -and [IO.Directory]::Exists($last)) { [IO.Directory]::Move($last,$live) }
    $stage=Join-Path $output ('.installer-'+[guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    $cli=Join-Path $app 'node_modules/electron-builder/cli.js'
    $arguments=@($cli,'--win','squirrel','--x64','--publish','never',"-c.directories.output=$stage","-c.extraMetadata.version=$version",
        "-c.squirrelWindows.customSquirrelVendorDir=$(Join-Path $root '.tools/squirrel')")
    if ($env:TEMPDESK_REMOTE_RELEASES) {
        $uri=[uri]$env:TEMPDESK_REMOTE_RELEASES
        if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) { throw 'Unsafe previous-release URL.' }
        $arguments += "-c.squirrelWindows.remoteReleases=$($uri.AbsoluteUri)"
    }
    Push-Location -LiteralPath $app
    try {
        & (Get-Command node.exe -CommandType Application -ErrorAction Stop).Source @arguments
        $code=$LASTEXITCODE
    } finally { Pop-Location }
    if ($code -ne 0) { exit $code }
    $new=Join-Path $stage 'squirrel-windows'
    $setup=Get-Item -LiteralPath (Join-Path $new "TempDeskDeployer-Setup-$version.exe")
    if ($setup.Length -le 0 -or (Get-AuthenticodeSignature -LiteralPath $setup.FullName).Status -ne 'NotSigned') { throw 'Expected a non-empty unsigned installer.' }
    $full=Get-Item -LiteralPath (Join-Path $new "TempDeskDeployer-$version-full.nupkg")
    if ($full.Length -le 0) { throw 'Empty full installer package.' }
    $feed=@{}
    foreach ($line in Get-Content -LiteralPath (Join-Path $new 'RELEASES')) {
        if (-not $line.Trim()) { continue }
        if ($line -notmatch '^([a-fA-F0-9]{40})\s+([^\s/\\]+\.nupkg)\s+(\d+)$') { throw 'Invalid Squirrel feed record.' }
        $name=$Matches[2]
        if ($feed.ContainsKey($name)) { throw 'Duplicate Squirrel feed record.' }
        $feed[$name]=@{ Digest=$Matches[1]; Size=[long]$Matches[3] }
    }
    foreach ($package in Get-ChildItem -LiteralPath $new -Filter '*.nupkg' -File) {
        $record=$feed[$package.Name]
        if (-not $record -or $package.Length -ne $record.Size -or (Get-FileHash -LiteralPath $package.FullName -Algorithm SHA1).Hash -ine $record.Digest) {
            throw "Package does not match Squirrel feed: $($package.Name)"
        }
    }
    $alias=Join-Path $new 'Setup.exe'
    Copy-Item -LiteralPath $setup.FullName -Destination $alias -Force
    $digest=(Get-FileHash -LiteralPath $alias -Algorithm SHA256).Hash
    if ([IO.Directory]::Exists($last)) { [IO.Directory]::Move($last,(Join-Path $output ('.retained-installer-'+[guid]::NewGuid().ToString('N')))) }
    if ([IO.Directory]::Exists($live)) { [IO.Directory]::Move($live,$last) }
    try { [IO.Directory]::Move($new,$live) } catch {
        if (-not [IO.Directory]::Exists($live) -and [IO.Directory]::Exists($last)) { [IO.Directory]::Move($last,$live) }
        throw
    }
    Write-Host ("Unsigned installer: {0}. SHA-256 {1}" -f (Join-Path $live 'Setup.exe'),$digest)
    Write-Host "Matching feed and packages: $live"
} finally { $lock.Dispose() }
