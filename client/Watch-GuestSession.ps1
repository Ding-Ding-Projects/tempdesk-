<#
.SYNOPSIS
    Signs out TempDesk guests whose account has expired or been deleted. Runs every 2 minutes as SYSTEM.

.DESCRIPTION
    Active Directory blocks new sign-ins after an account expires, but it does not end sessions that
    are already open. This watcher does that:
      * warns the guest (message box) when expiry is within logoffWarningMinutes
      * signs the session out once the account has expired, was disabled, or was deleted
    Only sessions of accounts in the TempDesk guest OU (or whose name has the guest prefix and no longer
    exists in AD) are touched.
#>
$ErrorActionPreference = 'Stop'
$local = Join-Path $env:ProgramData 'TempDesk\client'
$cfg = Get-Content -LiteralPath (Join-Path $local 'client.json') -Raw | ConvertFrom-Json
$logFile = Join-Path $local 'watcher.log'
if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) { Remove-Item $logFile -Force }
function Log([string] $m) { Add-Content -LiteralPath $logFile -Value ("{0:u} {1}" -f (Get-Date), $m) }

if (-not ('TempDesk.Wts' -as [type])) {
    Add-Type -Namespace TempDesk -Name Wts -MemberDefinition @'
[DllImport("wtsapi32.dll", SetLastError = true)]
public static extern bool WTSEnumerateSessions(IntPtr hServer, int Reserved, int Version, out IntPtr ppSessionInfo, out int pCount);
[DllImport("wtsapi32.dll")]
public static extern void WTSFreeMemory(IntPtr pMemory);
[DllImport("wtsapi32.dll", SetLastError = true)]
public static extern bool WTSQuerySessionInformation(IntPtr hServer, int sessionId, int wtsInfoClass, out IntPtr ppBuffer, out int pBytesReturned);
[DllImport("wtsapi32.dll", SetLastError = true)]
public static extern bool WTSLogoffSession(IntPtr hServer, int sessionId, bool bWait);
[DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool WTSSendMessage(IntPtr hServer, int sessionId, string pTitle, int titleLength, string pMessage, int messageLength, int style, int timeout, out int pResponse, bool bWait);
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct WTS_SESSION_INFO { public int SessionId; public IntPtr pWinStationName; public int State; }
public static string Query(int id, int cls) {
    IntPtr buf; int len;
    if (!WTSQuerySessionInformation(IntPtr.Zero, id, cls, out buf, out len)) return null;
    try { return Marshal.PtrToStringUni(buf); } finally { WTSFreeMemory(buf); }
}
public static int[] Sessions() {
    IntPtr p; int n;
    if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out p, out n)) return new int[0];
    try {
        int size = Marshal.SizeOf(typeof(WTS_SESSION_INFO));
        int[] ids = new int[n];
        for (int i = 0; i < n; i++) {
            WTS_SESSION_INFO s = (WTS_SESSION_INFO)Marshal.PtrToStructure(new IntPtr(p.ToInt64() + i * size), typeof(WTS_SESSION_INFO));
            ids[i] = s.SessionId;
        }
        return ids;
    } finally { WTSFreeMemory(p); }
}
'@
}

$WTSUserName = 5; $WTSDomainName = 7
$warnedKey = 'HKLM:\SOFTWARE\TempDesk\Warned'
New-Item -Path $warnedKey -Force | Out-Null

function Find-Guest([string] $sam) {
    $searcher = New-Object DirectoryServices.DirectorySearcher
    $searcher.SearchRoot = New-Object DirectoryServices.DirectoryEntry("LDAP://$($cfg.domainDns)")
    $searcher.Filter = "(&(objectClass=user)(sAMAccountName=$([Security.SecurityElement]::Escape($sam))))"
    foreach ($p in 'distinguishedName', 'accountExpires', 'userAccountControl') { [void]$searcher.PropertiesToLoad.Add($p) }
    $searcher.FindOne()
}

foreach ($id in [TempDesk.Wts]::Sessions()) {
    if ($id -eq 0) { continue }
    $user = [TempDesk.Wts]::Query($id, $WTSUserName)
    if (-not $user) { continue }
    try { $r = Find-Guest $user } catch { Log "AD lookup failed for $user (domain unreachable?): $($_.Exception.Message)"; continue }

    $reason = $null; $expires = $null
    if (-not $r) {
        # Account gone. Only act on names that look like TempDesk guests.
        if ($user.StartsWith($cfg.usernamePrefix, [StringComparison]::OrdinalIgnoreCase)) { $reason = 'deleted' }
    }
    else {
        $dn = [string]$r.Properties['distinguishedname'][0]
        if (-not $dn.EndsWith(",$($cfg.guestOuDn)", [StringComparison]::OrdinalIgnoreCase)) { continue }
        $ae = [int64]$r.Properties['accountexpires'][0]
        $uac = [int]$r.Properties['useraccountcontrol'][0]
        if ($uac -band 2) { $reason = 'disabled' }
        elseif ($ae -gt 0 -and $ae -lt [int64]::MaxValue) {
            $expires = [DateTime]::FromFileTimeUtc($ae)
            $left = $expires - (Get-Date).ToUniversalTime()
            if ($left.TotalSeconds -le 0) { $reason = 'expired' }
            elseif ($left.TotalMinutes -le [int]$cfg.logoffWarningMinutes) {
                $tag = "$user-$ae"
                if (-not (Get-ItemProperty -Path $warnedKey -Name $tag -ErrorAction SilentlyContinue)) {
                    $msg = "Your temporary sign-in ends at {0:t}. Save your work now: you will be signed out automatically and this account and its files will be removed." -f $expires.ToLocalTime()
                    $title = 'TempDesk'
                    $resp = 0
                    [void][TempDesk.Wts]::WTSSendMessage([IntPtr]::Zero, $id, $title, $title.Length * 2, $msg, $msg.Length * 2, 0x40, 60, [ref]$resp, $false)
                    New-ItemProperty -Path $warnedKey -Name $tag -Value 1 -Force | Out-Null
                    Log "Warned $user (session $id), expires $expires UTC"
                }
            }
        }
    }
    if ($reason) {
        Log "Signing out $user (session $id): account $reason"
        [void][TempDesk.Wts]::WTSLogoffSession([IntPtr]::Zero, $id, $false)
    }
}
