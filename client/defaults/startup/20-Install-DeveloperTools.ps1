<#
.SYNOPSIS
    Default TempDesk startup script: installs machine-wide developer tools on every guest PC.

.DESCRIPTION
    Runs as SYSTEM at computer startup, using winget in machine scope. Already-installed packages are
    skipped, so later boots are quick. Installs:
      Git, Visual Studio Code, GitHub CLI, Node.js LTS, Python 3.13, PowerShell 7, .NET 8 and .NET 10
      Desktop Runtimes, Visual C++ Redistributable, 7-Zip, Notepad++, Claude Code (CLI) and
      the Codex CLI (npm package @openai/codex).
    Per-user desktop apps (Claude, Codex, Desktop Material) are installed at sign-in by
    logon\20-Install-UserApps.ps1 because their installers are per-user.
    Edit the $packages list in the admin console under Presetup > Startup scripts.
#>
$ErrorActionPreference = 'Continue'
$log = Join-Path $env:ProgramData 'TempDesk\client\startup.log'
function Log([string] $m) { Add-Content -LiteralPath $log -Value ("{0:u} [devtools] {1}" -f (Get-Date), $m) }

# winget id => extra arguments
$packages = [ordered]@{
    'Git.Git'                          = ''
    'Microsoft.VisualStudioCode'       = '--override "/VERYSILENT /NORESTART /MERGETASKS=!runcode,addcontextmenufiles,addcontextmenufolders,addtopath"'
    'GitHub.cli'                       = ''
    'OpenJS.NodeJS.LTS'                = ''
    'Python.Python.3.13'               = ''
    'Microsoft.PowerShell'             = ''
    'Microsoft.DotNet.DesktopRuntime.8' = ''
    'Microsoft.DotNet.DesktopRuntime.10' = ''
    'Microsoft.VCRedist.2015+.x64'     = ''
    '7zip.7zip'                        = ''
    'Notepad++.Notepad++'              = ''
    'Anthropic.ClaudeCode'             = ''
}

# winget is an app package; as SYSTEM it must be called by full path.
$winget = Get-ChildItem -Path "$env:ProgramFiles\WindowsApps\Microsoft.DesktopAppInstaller_*_x64__8wekyb3d8bbwe\winget.exe" -ErrorAction SilentlyContinue |
    Sort-Object { [version](($_.Directory.Name -split '_')[1]) } -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $winget) { Log 'winget not found (App Installer missing). Skipping developer tools.'; return }

$installed = (& $winget list --accept-source-agreements --disable-interactivity 2>$null) -join "`n"
foreach ($id in $packages.Keys) {
    if ($installed -match [regex]::Escape($id)) { continue }
    $args = "install --id $id --exact --scope machine --silent --accept-package-agreements --accept-source-agreements --disable-interactivity $($packages[$id])"
    $p = Start-Process -FilePath $winget -ArgumentList $args -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -ne 0) {
        # Some packages only publish a user-scope installer; retry without the scope pin.
        $p = Start-Process -FilePath $winget -ArgumentList ($args -replace '--scope machine ', '') -Wait -PassThru -WindowStyle Hidden
    }
    Log ("{0}: exit {1}" -f $id, $p.ExitCode)
}

# Codex CLI from npm into a machine-wide prefix on the system PATH.
$npm = "$env:ProgramFiles\nodejs\npm.cmd"
$prefix = Join-Path $env:ProgramData 'npm-global'
if (Test-Path $npm) {
    New-Item -ItemType Directory -Force -Path $prefix | Out-Null
    if (-not (Test-Path (Join-Path $prefix 'codex.cmd'))) {
        $o = & $npm install --global --prefix "$prefix" '@openai/codex' 2>&1
        Log "npm @openai/codex: exit $LASTEXITCODE $(($o | Select-Object -Last 2) -join ' ')"
    }
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    if (($machinePath -split ';') -notcontains $prefix) {
        [Environment]::SetEnvironmentVariable('Path', "$machinePath;$prefix", 'Machine')
        Log "Added $prefix to the machine PATH"
    }
}
else { Log 'Node.js not installed yet; Codex CLI will be installed on the next boot.' }
