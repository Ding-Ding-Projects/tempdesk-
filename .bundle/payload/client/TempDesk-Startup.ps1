<#
.SYNOPSIS
    TempDesk computer startup script. Runs as SYSTEM on every guest PC through the
    "TempDesk - Guest Computers" GPO.

.DESCRIPTION
    1. Installs the Wi-Fi profiles published by the admin console (and removes ones that were deleted).
    2. Copies the session watcher and profile cleanup scripts locally and registers their scheduled tasks.
    3. Runs every admin-provided startup script from SYSVOL\TempDesk\scripts\startup.
    Everything is logged to C:\ProgramData\TempDesk\client\startup.log.
#>
$ErrorActionPreference = 'Continue'
$share = Split-Path -Parent $PSScriptRoot        # \\domain\SYSVOL\domain\TempDesk
$local = Join-Path $env:ProgramData 'TempDesk\client'
New-Item -ItemType Directory -Force -Path $local | Out-Null
$logFile = Join-Path $local 'startup.log'
if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 2MB) { Remove-Item $logFile -Force }
function Log([string] $m) { Add-Content -LiteralPath $logFile -Value ("{0:u} {1}" -f (Get-Date), $m) }
Log "Startup script began. Share: $share"

# --- 1. Wi-Fi profiles ------------------------------------------------------------------------
$stateKey = 'HKLM:\SOFTWARE\TempDesk\WifiProfiles'
New-Item -Path $stateKey -Force | Out-Null
$wifiDir = Join-Path $share 'wifi'
$hasWlan = [bool](Get-Service -Name WlanSvc -ErrorAction SilentlyContinue)
if ($hasWlan -and (Test-Path $wifiDir)) {
    $published = @{}
    foreach ($xml in Get-ChildItem -LiteralPath $wifiDir -Filter '*.xml' -File) {
        try {
            $ssidName = ([xml](Get-Content -LiteralPath $xml.FullName -Raw)).WLANProfile.name
            $tmp = Join-Path $env:TEMP ("td-wifi-{0}.xml" -f [guid]::NewGuid())
            Copy-Item -LiteralPath $xml.FullName -Destination $tmp
            $out = & netsh.exe wlan add profile filename="$tmp" user=all 2>&1
            Remove-Item -LiteralPath $tmp -Force
            $published[$ssidName] = $true
            Set-ItemProperty -Path $stateKey -Name $ssidName -Value $xml.BaseName
            Log "Wi-Fi profile '$ssidName': $out"
        }
        catch { Log "Wi-Fi profile $($xml.Name) failed: $($_.Exception.Message)" }
    }
    # Remove profiles TempDesk installed earlier that the admin has since deleted.
    foreach ($name in (Get-Item -Path $stateKey).Property) {
        if (-not $published.ContainsKey($name)) {
            & netsh.exe wlan delete profile name="$name" | Out-Null
            Remove-ItemProperty -Path $stateKey -Name $name
            Log "Removed Wi-Fi profile '$name'"
        }
    }
}

# --- 2. Local copies of helper scripts and their scheduled tasks ------------------------------
foreach ($f in 'Watch-GuestSession.ps1', 'Remove-GuestProfiles.ps1', 'client.json') {
    $src = Join-Path $PSScriptRoot $f
    if (Test-Path $src) { Copy-Item -LiteralPath $src -Destination $local -Force }
}
# Only SYSTEM and Administrators may change the local copies.
& icacls.exe $local /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null

function Register-TdTask([string] $Name, [string] $Script, $Trigger) {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ("-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"{0}`"" -f (Join-Path $local $Script))
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $set = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $Name -TaskPath '\TempDesk\' -Action $action -Trigger $Trigger -Principal $principal -Settings $set -Force | Out-Null
}
try {
    $every2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
    Register-TdTask 'TempDesk Session Watcher' 'Watch-GuestSession.ps1' $every2
    $hourly = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(3) -RepetitionInterval (New-TimeSpan -Hours 1)
    Register-TdTask 'TempDesk Profile Cleanup' 'Remove-GuestProfiles.ps1' $hourly
    Log 'Scheduled tasks registered.'
}
catch { Log "Task registration failed: $($_.Exception.Message)" }
# Clean up stale guest profiles right away at boot, before anyone signs in.
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $local 'Remove-GuestProfiles.ps1')

# --- 3. Admin-provided startup scripts ---------------------------------------------------------
$scriptDir = Join-Path $share 'scripts\startup'
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
Log 'Startup script finished.'
