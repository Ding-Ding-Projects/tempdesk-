$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$v = $env:RELEASE_VERSION
$sha = $env:GITHUB_SHA
if ($v -notmatch '^\d+\.\d+\.\d+$' -or $sha -notmatch '^[0-9a-f]{40}$' -or (git rev-parse HEAD) -cne $sha) {
    throw 'Release version or source is invalid.'
}

$tag = "v$v"
$squirrel = 'deployer/output/squirrel-windows'
$feed = "$squirrel/RELEASES"
$packages = @(Get-ChildItem -LiteralPath $squirrel -Filter "*-$v-*.nupkg" -File)
if (@($packages | Where-Object Name -like '*-full.nupkg').Count -ne 1) { throw 'Expected exactly one current full package.' }
$packageNames = @($packages.Name)
$rows = @(Get-Content -LiteralPath $feed | Where-Object { ($_ -split '\s+')[1] -cin $packageNames })
if ($rows.Count -ne $packages.Count) { throw 'Current packages do not match the Squirrel feed.' }
foreach ($package in $packages) {
    $entries = @($rows | Where-Object { ($_ -split '\s+')[1] -ceq $package.Name })
    if ($entries.Count -ne 1) { throw "Missing unique feed entry for $($package.Name)." }
    $hash, $name, $length = $entries[0] -split '\s+'
    if ($package.Length -ne [long]$length -or (Get-FileHash $package.FullName -Algorithm SHA1).Hash -ne $hash) {
        throw "Squirrel feed fingerprint mismatch for $name."
    }
}
[IO.File]::WriteAllLines((Resolve-Path -LiteralPath $feed).Path, [string[]]$rows)

$paths = @("$squirrel/Setup.exe", $feed, "deployer/bin/TempDeskDeployer-$v-portable.exe",
    "deployer/bin/docs/TempDeskDocs-$v-portable.exe", "deployer/bin/build-companion/TempDeskBuild-$v-portable.exe") + @($packages.FullName)
if ((Get-AuthenticodeSignature -LiteralPath $paths[0]).Status -ne 'NotSigned') { throw 'Setup.exe must be unsigned.' }
$records = foreach ($path in $paths) {
    $item = Get-Item -LiteralPath $path
    if ($item.PSIsContainer -or $item.Length -le 0) { throw "Invalid release file: $path" }
    [ordered]@{ name = $item.Name; bytes = $item.Length; sha256 = (Get-FileHash $path).Hash.ToLowerInvariant() }
}
$dir = New-Item -ItemType Directory -Path $env:RELEASE_EVIDENCE -Force
$manifest = Join-Path $dir.FullName 'release-manifest.json'
[ordered]@{ schemaVersion = 1; version = $v; sourceCommit = $sha; files = @($records) } |
    ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest -Encoding utf8

$notesFile = Join-Path $dir.FullName 'release-notes.md'
$pending = 'Workflow timing is pending publication readback.'
$codeName = $null
$codeJob = $null
try {
    $codeJob = Start-Job -FilePath "$PSScriptRoot/get-release-code-name.ps1"
    if (Wait-Job $codeJob -Timeout 20) { $codeName = Receive-Job $codeJob }
} catch {
    Write-Warning 'Could not resolve an unused published dish.'
} finally {
    if ($codeJob) { Remove-Job $codeJob -Force -ErrorAction SilentlyContinue }
}
$identity = if ($codeName) {
    @(
        ('<!-- dim-sum-code-name: {0} -->' -f $codeName.id)
        ('Code name: {0} / {1}' -f $codeName.english, $codeName.traditionalChinese)
        ('[Published original photo]({0}) · [Public catalogue]({1})' -f $codeName.photo, $codeName.catalog)
    )
} else {
    @('This release uses the version alone because an unused published dish could not be verified.')
}

$notes = @(
    "TempDesk Deployer $v built from $sha."
    ''
    'Install with **Setup.exe**. Installed copies stage updates and ask before restarting.'
    "Open **TempDeskDocs-$v-portable.exe** for offline documentation."
    "Open **TempDeskBuild-$v-portable.exe** to build this release's bundled source."
    'The Squirrel installer and packages are unsigned. Windows SmartScreen may warn on first run.'
    'This workflow builds, packages and publishes. Local test results were not supplied.'
    ''
    $pending
    ''
    '### Lines of code'
    ''
    'Command: pwsh -File scripts/line-counts.ps1'
    ''
) + @(& "$PSScriptRoot/line-counts.ps1") + @('') + $identity
$notes | Set-Content -LiteralPath $notesFile -Encoding utf8

$assets = $paths + $manifest
gh release create $tag @assets --title "TempDesk Deployer $tag" --notes-file $notesFile --target $sha
$route = "repos/$env:GITHUB_REPOSITORY"
$release = gh api "$route/releases/tags/$tag" | ConvertFrom-Json
if ($release.draft -or $release.prerelease -or $release.tag_name -cne $tag) { throw 'Readback did not return the requested normal release.' }
$ref = (gh api "$route/git/ref/tags/$tag" | ConvertFrom-Json).object
if ($ref.type -ne 'commit' -or $ref.sha -cne $sha) { throw 'Published tag does not reference the intended commit.' }
if (@($release.assets).Count -ne $assets.Count) { throw 'Published asset inventory differs from the build.' }
foreach ($path in $assets) {
    $item = Get-Item -LiteralPath $path
    $asset = @($release.assets | Where-Object name -CEQ $item.Name)
    $digest = 'sha256:' + (Get-FileHash $path).Hash.ToLowerInvariant()
    if ($asset.Count -ne 1 -or $asset[0].size -ne $item.Length -or $asset[0].digest -cne $digest -or
        $asset[0].state -ne 'uploaded' -or !$asset[0].browser_download_url) {
        throw "Published asset metadata differs for $($item.Name)."
    }
}

try {
    $jobs = (gh api "$route/actions/runs/$env:GITHUB_RUN_ID/attempts/$env:GITHUB_RUN_ATTEMPT/jobs" | ConvertFrom-Json).jobs
    $first = $jobs | Where-Object started_at | Sort-Object started_at | Select-Object -First 1
    if (!$first.started_at -or !$release.published_at) { throw 'A required timestamp is unavailable.' }
    $started = [DateTimeOffset]$first.started_at
    $completed = [DateTimeOffset]$release.published_at
    if ($completed -lt $started) { throw 'Publication precedes the workflow start.' }
    $elapsed = $completed - $started
    $duration = '{0:D2}:{1:D2}:{2:D2}' -f [int][Math]::Floor($elapsed.TotalHours), $elapsed.Minutes, $elapsed.Seconds
    $timing = @(
        "Workflow started: $($started.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ'))"
        "Workflow completed: $($completed.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ'))"
        "Workflow duration: $duration"
    )
} catch {
    $timing = @('Workflow timing unavailable. GitHub did not supply consistent first-job and publication timestamps.')
    Write-Warning $timing[0]
}
$notes | ForEach-Object { if ($_ -ceq $pending) { $timing } else { $_ } } | Set-Content -LiteralPath $notesFile -Encoding utf8
gh release edit $tag --notes-file $notesFile
$storedNotes = (gh release view $tag --json body | ConvertFrom-Json).body
foreach ($line in $timing) {
    if (!$storedNotes.Contains($line)) { throw 'Published notes did not contain the recorded timing status.' }
}
Write-Host "Published $($release.html_url) from $sha."
