<#
.SYNOPSIS
    Default TempDesk logon script: installs the per-user desktop apps for the signed-in user.

.DESCRIPTION
    Runs as the signed-in user (standard rights) at sign-in, in the background so sign-in is not
    delayed. Each app installs into the user's own profile and is removed with the profile when the
    guest account expires. Installs, if missing:
      * Claude (desktop)          winget Anthropic.Claude
      * Codex (desktop)           winget msstore 9PLM9XGG6VKS (Microsoft Store must be allowed)
      * Desktop Material          latest GitHubDesktopSetup-x64.exe from Ding-Ding-Projects/desktop-material,
                                  checked against the SHA-256 digest GitHub publishes for the asset
    Logs to %LOCALAPPDATA%\TempDesk\apps.log.
#>
param([switch] $Worker)

if (-not $Worker) {
    # Re-launch hidden and return immediately so the sign-in is not held up.
    Start-Process -FilePath powershell.exe -WindowStyle Hidden -ArgumentList @(
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Worker')
    return
}

$ErrorActionPreference = 'Continue'
$dir = Join-Path $env:LOCALAPPDATA 'TempDesk'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$log = Join-Path $dir 'apps.log'
function Log([string] $m) { Add-Content -LiteralPath $log -Value ("{0:u} {1}" -f (Get-Date), $m) }

$winget = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps\winget.exe'
function Install-Winget([string] $Id, [string] $Source, [string] $CheckPath) {
    if ($CheckPath -and (Test-Path $CheckPath)) { return }
    if (-not (Test-Path $winget)) { Log "winget unavailable, skipping $Id"; return }
    $a = @('install', '--id', $Id, '--exact', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
    if ($Source) { $a += @('--source', $Source) }
    $o = & $winget @a 2>&1
    Log "$Id exit $LASTEXITCODE $(($o | Select-Object -Last 1))"
}

Install-Winget 'Anthropic.Claude' '' (Join-Path $env:LOCALAPPDATA 'AnthropicClaude\claude.exe')
$codexInstalled = [bool](Get-AppxPackage -Name '*Codex*' -ErrorAction SilentlyContinue)
if (-not $codexInstalled) { Install-Winget '9PLM9XGG6VKS' 'msstore' '' }

# Desktop Material (Squirrel, per-user).
$dmExe = Join-Path $env:LOCALAPPDATA 'GitHubDesktop\GitHubDesktop.exe'
if (-not (Test-Path $dmExe)) {
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $rel = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.github.com/repos/Ding-Ding-Projects/desktop-material/releases/latest' -Headers @{ 'User-Agent' = 'TempDesk' }
        $asset = $rel.assets | Where-Object name -eq 'GitHubDesktopSetup-x64.exe' | Select-Object -First 1
        if (-not $asset) { throw 'GitHubDesktopSetup-x64.exe not found in the latest release.' }
        $tmp = Join-Path $env:TEMP 'DesktopMaterialSetup.exe'
        Invoke-WebRequest -UseBasicParsing -Uri $asset.browser_download_url -OutFile $tmp
        if ($asset.PSObject.Properties.Name -contains 'digest' -and $asset.digest) {
            $want = ($asset.digest -replace '^sha256:', '').ToLowerInvariant()
            $got = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($want -ne $got) { throw "SHA-256 mismatch (expected $want, got $got)" }
        }
        else { throw 'The release does not publish a digest for the installer; not installing an unverified file.' }
        $p = Start-Process -FilePath $tmp -ArgumentList '--silent' -Wait -PassThru
        Log "Desktop Material $($rel.tag_name) exit $($p.ExitCode)"
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
    catch { Log "Desktop Material failed: $($_.Exception.Message)" }
}
