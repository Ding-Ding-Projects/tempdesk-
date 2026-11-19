[CmdletBinding()]
param(
    [string] $Receipt = $env:TEMPDESK_APPLIANCE_RECEIPT,
    [ValidateSet('amd64', 'arm64')][string] $Architecture = $(if ($env:TEMPDESK_APPLIANCE_ARCH) {
        $env:TEMPDESK_APPLIANCE_ARCH
    } else { 'amd64' }),
    [string] $Builder = $env:TEMPDESK_APPLIANCE_BUILDER
)

$ErrorActionPreference = 'Stop'
$repository = Split-Path -Parent $PSScriptRoot
$imageName = 'ghcr.io/ding-ding-projects/tempdesk-portal'
$baseImage = 'docker.io/library/alpine@sha256:469c9ea410b9215eaee7976ba6c0639039b444be8e5d638f7abbada189971eb2'
$digestPattern = '^sha256:[0-9a-f]{64}$'

function Invoke-Required([string] $Program, [string[]] $Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited $LASTEXITCODE." }
}

if (!$Receipt) { throw 'Provide the portal publication receipt in TEMPDESK_APPLIANCE_RECEIPT.' }
if ($Builder -and $Builder -cnotmatch '^[a-zA-Z0-9_.-]{1,80}$') { throw 'Supply a valid Buildx builder name.' }
$publication = Get-Item -LiteralPath $Receipt
if ($publication.PSIsContainer -or $publication.Length -gt 65536) {
    throw 'The portal receipt must be a JSON file of at most 64 KiB.'
}
$manifest = Get-Content -LiteralPath $publication.FullName -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.image -cne $imageName -or
    $manifest.revision -cnotmatch '^[0-9a-f]{40}$' -or $manifest.version -cnotmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
    $manifest.releaseTag -cne ('v' + $manifest.version) -or $manifest.tag -cne ('sha-' + $manifest.revision) -or
    $manifest.state -notin 'published', 'already-published' -or
    $manifest.digest -cnotmatch $digestPattern -or
    $manifest.immutableReference -cne ($imageName + '@' + $manifest.digest)) {
    throw 'The receipt does not describe an immutable published TempDesk portal image.'
}
$docker = (Get-Command docker -CommandType Application | Select-Object -First 1).Source
$git = (Get-Command git -CommandType Application | Select-Object -First 1).Source
$tar = (Get-Command tar.exe -CommandType Application | Select-Object -First 1).Source
$index = (Invoke-Required $docker @('buildx','imagetools','inspect','--raw',$manifest.immutableReference)) |
    ConvertFrom-Json
if ($index.mediaType -ne 'application/vnd.oci.image.index.v1+json') {
    throw 'The published digest does not identify a multi-platform OCI index.'
}
foreach ($arch in 'amd64', 'arm64') {
    $child = @($index.manifests | Where-Object {$_.platform.os -eq 'linux' -and $_.platform.architecture -eq $arch})
    $reported = @($manifest.platforms | Where-Object {$_.os -eq 'linux' -and $_.architecture -eq $arch})
    if ($child.Count -ne 1 -or $reported.Count -ne 1 -or
        $child[0].digest -cnotmatch $digestPattern -or $child[0].digest -cne $reported[0].digest) {
        throw "The registry index and receipt disagree for linux/$arch."
    }
}
$revision = (Invoke-Required $git @('-C', $repository, 'rev-parse', '--verify', 'HEAD')).Trim()
$version = $manifest.version
$platform = if ($Architecture -eq 'arm64') { 'rpi4-arm64' } else { 'x86_64' }
$working = Join-Path $repository ('.tools/appliance/' + $version + '-' + $platform + '-' + [guid]::NewGuid().ToString('N'))
$source = Join-Path $working 'inputs'
$output = Join-Path $working 'output'
if ($working -match '[,\r\n]') { throw 'The appliance build path must not contain a comma or line break.' }
New-Item -ItemType Directory -Path $source, $output | Out-Null
$archive = Join-Path $working 'source.tar'
Invoke-Required $git @('-C',$repository,'archive','--format=tar',"--output=$archive",$revision,'appliance','portal/compose.yaml','portal/compose.published.yaml')
Invoke-Required $tar @('-xf',$archive,'-C',$source)
$binding = [ordered]@{
    schemaVersion = 1
    applianceSource = $revision
    portalSource = $manifest.revision
    portalVersion = $version
    portalIndex = $manifest.immutableReference
    portalChild = @($manifest.platforms | Where-Object architecture -eq $Architecture)[0].digest
    architecture = $Architecture
    platform = $platform
    builderImage = $baseImage
}
[IO.File]::WriteAllText((Join-Path $source 'publication.json'), ($binding | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
Write-Host "Building $platform appliance from $revision for portal $version."
if ($Builder) {
    Invoke-Required $docker @('buildx','build','--builder',$Builder,'--platform',"linux/$Architecture",
        '--progress','plain','--output',"type=local,dest=$output",'-f',(Join-Path $source 'appliance/Dockerfile'),
        '--build-arg',"ALPINE_IMAGE=$baseImage",'--build-arg',"APPLIANCE_PLATFORM=$platform",
        '--build-arg',"PORTAL_VERSION=$version",$source)
} else {
    Invoke-Required $docker @('run','--rm','--platform',"linux/$Architecture",
        '--mount',"type=bind,source=$source,target=/inputs,readonly",
        '--mount',"type=bind,source=$output,target=/output",
        '--entrypoint','sh',$baseImage,'/inputs/appliance/build-disk.sh',$platform,$version)
}
$artifact = Get-Item -LiteralPath (Join-Path $output "TempDesk-Appliance-$version-$platform.img.gz")
$receiptOut = Join-Path $output 'appliance-build.json'
$binding['filename'] = $artifact.Name
$binding['bytes'] = $artifact.Length
$binding['sha256'] = (Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$binding['builtAtUtc'] = [DateTime]::UtcNow.ToString('o')
$binding['packages'] = @(Get-Content -LiteralPath (Join-Path $output 'packages.txt'))
[IO.File]::WriteAllText($receiptOut, ($binding | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
Write-Output $artifact.FullName
Write-Output "SHA-256 $($binding.sha256)"
Write-Output $receiptOut
