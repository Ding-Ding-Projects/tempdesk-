$ErrorActionPreference = 'Stop'
$destination = New-Item -ItemType Directory -Path $env:RELEASE_EVIDENCE -Force
[ordered]@{
    source = $env:GITHUB_SHA
    workflowRun = $env:GITHUB_RUN_ID
    attempt = $env:GITHUB_RUN_ATTEMPT
    jobStatus = $env:RELEASE_JOB_STATUS
    runnerOS = $env:RUNNER_OS
    runnerArchitecture = $env:RUNNER_ARCH
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destination.FullName 'job-context.json') -Encoding utf8

$version = $env:RELEASE_VERSION
if ($version -notmatch '^\d+\.\d+\.\d+$') { return }
$squirrel = 'deployer/output/squirrel-windows'
$paths = @(
    "$squirrel/Setup.exe"
    "$squirrel/RELEASES"
    "deployer/bin/TempDeskDeployer-$version-portable.exe"
    "deployer/bin/docs/TempDeskDocs-$version-portable.exe"
    "deployer/bin/build-companion/TempDeskBuild-$version-portable.exe"
    "deployer/bin/portal-host/TempDeskPortalHost-$version-portable.exe"
)
if (Test-Path -LiteralPath $squirrel -PathType Container) {
    $paths += @(Get-ChildItem -LiteralPath $squirrel -File -Filter "*-$version-*.nupkg" | ForEach-Object FullName)
}
foreach ($path in $paths) {
    if (Test-Path -LiteralPath $path -PathType Leaf) { Copy-Item -LiteralPath $path -Destination $destination.FullName }
}
