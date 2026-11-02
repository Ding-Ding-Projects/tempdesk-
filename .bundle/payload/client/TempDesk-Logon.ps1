<#
.SYNOPSIS
    TempDesk user logon script. Runs as the signed-in guest through the
    "TempDesk - Guest User Policy" GPO.

.DESCRIPTION
    Runs every admin-provided logon script from SYSVOL\TempDesk\scripts\logon in name order
    (for example: map a printer, set a home page, open a welcome page). Logon scripts run with the
    guest's own standard rights, so they cannot read the Wi-Fi or startup folders.
#>
$ErrorActionPreference = 'Continue'
$share = Split-Path -Parent $PSScriptRoot
$scriptDir = Join-Path $share 'scripts\logon'
$logDir = Join-Path $env:LOCALAPPDATA 'TempDesk'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'logon.log'
function Log([string] $m) { Add-Content -LiteralPath $logFile -Value ("{0:u} {1}" -f (Get-Date), $m) }

if (Test-Path $scriptDir) {
    foreach ($s in Get-ChildItem -LiteralPath $scriptDir -File | Sort-Object Name) {
        try {
            switch ($s.Extension.ToLowerInvariant()) {
                '.ps1' { $o = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $s.FullName 2>&1 }
                '.cmd' { $o = & cmd.exe /c "`"$($s.FullName)`"" 2>&1 }
                default { continue }
            }
            Log "Ran $($s.Name) (exit $LASTEXITCODE): $(($o | Out-String).Trim())"
        }
        catch { Log "Script $($s.Name) failed: $($_.Exception.Message)" }
    }
}
