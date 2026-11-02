<#
.SYNOPSIS
    Removes local profiles of TempDesk guests whose account is gone, disabled or expired.
    Runs at startup and hourly as SYSTEM.

.DESCRIPTION
    A profile is removed only when ALL of these hold:
      * it is not loaded (nobody is signed in with it) and is not a special/system profile
      * its folder name starts with the TempDesk guest prefix
      * the account no longer resolves, or it lives in the guest OU and is disabled or expired
    Uses Win32_UserProfile deletion, which removes both the folder and the registry entries.
#>
$ErrorActionPreference = 'Stop'
$local = Join-Path $env:ProgramData 'TempDesk\client'
$cfg = Get-Content -LiteralPath (Join-Path $local 'client.json') -Raw | ConvertFrom-Json
$logFile = Join-Path $local 'cleanup.log'
function Log([string] $m) { Add-Content -LiteralPath $logFile -Value ("{0:u} {1}" -f (Get-Date), $m) }

function Get-GuestState([string] $sid) {
    try {
        $entry = New-Object DirectoryServices.DirectoryEntry("LDAP://$($cfg.domainDns)/<SID=$sid>")
        $null = $entry.NativeObject
        $dn = [string]$entry.Properties['distinguishedName'].Value
        if (-not $dn.EndsWith(",$($cfg.guestOuDn)", [StringComparison]::OrdinalIgnoreCase)) { return 'not-guest' }
        $uac = [int]$entry.Properties['userAccountControl'].Value
        if ($uac -band 2) { return 'disabled' }
        $ae = $entry.ConvertLargeIntegerToInt64($entry.Properties['accountExpires'].Value)
        if ($ae -gt 0 -and $ae -lt [int64]::MaxValue -and [DateTime]::FromFileTimeUtc($ae) -lt (Get-Date).ToUniversalTime()) { return 'expired' }
        return 'active'
    }
    catch [System.Runtime.InteropServices.COMException] {
        # 0x80072030 = no such object: the account was deleted.
        if ($_.Exception.ErrorCode -eq -2147016656) { return 'deleted' }
        return 'unknown'
    }
}

foreach ($p in Get-CimInstance -ClassName Win32_UserProfile -Filter 'Special = FALSE AND Loaded = FALSE') {
    $leaf = Split-Path -Leaf $p.LocalPath
    if (-not $leaf.StartsWith($cfg.usernamePrefix, [StringComparison]::OrdinalIgnoreCase)) { continue }
    $state = Get-GuestState $p.SID
    if ($state -in 'deleted', 'disabled', 'expired') {
        try {
            Remove-CimInstance -InputObject $p
            Log "Removed profile $($p.LocalPath) ($state)"
        }
        catch { Log "Could not remove $($p.LocalPath): $($_.Exception.Message)" }
    }
}
