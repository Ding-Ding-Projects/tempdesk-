<#
.SYNOPSIS
    Signs out expired, disabled or removed TempDesk guests. Computer policy runs this every two minutes as SYSTEM.

.DESCRIPTION
    An interrupted directory lookup retains the last verified deadline for the same Windows sign-in.
    The deadline is stored in a protected, volatile registry key and is refreshed by successful directory reads.
#>

function Initialize-TdSessionApi {
    if ('TempDesk.Wts' -as [type]) { return }

    Add-Type -Namespace TempDesk -Name Wts -MemberDefinition @'
[DllImport("wtsapi32.dll", SetLastError = true)]
private static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version, out IntPtr buffer, out int count);
[DllImport("wtsapi32.dll")]
private static extern void WTSFreeMemory(IntPtr buffer);
[DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
private static extern bool WTSQuerySessionInformation(IntPtr server, int id, int infoClass, out IntPtr buffer, out int bytes);
[DllImport("wtsapi32.dll", SetLastError = true)]
private static extern bool WTSQueryUserToken(int id, out Microsoft.Win32.SafeHandles.SafeAccessTokenHandle handle);
[DllImport("wtsapi32.dll", SetLastError = true)]
public static extern bool WTSLogoffSession(IntPtr server, int id, bool wait);
[DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
public static extern bool WTSSendMessage(IntPtr server, int id, string title, int titleLength, string message, int messageLength,
    int style, int timeout, out int response, bool wait);

[StructLayout(LayoutKind.Sequential)]
private struct SessionEntry {
    public int Id;
    public IntPtr Name;
    public int State;
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
public struct SessionInfo {
    public int State;
    public int Id;
    public uint IncomingBytes, OutgoingBytes, IncomingFrames, OutgoingFrames, IncomingCompressedBytes, OutgoingCompressedBytes;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Station;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 17)] public string Domain;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 21)] public string User;
    public long ConnectTime, DisconnectTime, LastInputTime, LogonTime, CurrentTime;
}

public sealed class SessionIdentity {
    public int Id;
    public long LogonTime;
    public string Domain, User, Sid;
}

public static SessionInfo? ReadSession(int id) {
    const int WTSSessionInfo = 24;
    IntPtr buffer;
    int bytes;
    if (!WTSQuerySessionInformation(IntPtr.Zero, id, WTSSessionInfo, out buffer, out bytes)) return null;
    try {
        if (buffer == IntPtr.Zero || bytes < Marshal.SizeOf(typeof(SessionInfo))) return null;
        var session = (SessionInfo)Marshal.PtrToStructure(buffer, typeof(SessionInfo));
        return session.Id == id ? (SessionInfo?)session : null;
    } finally { WTSFreeMemory(buffer); }
}

public static SessionIdentity ReadIdentity(int id) {
    var before = ReadSession(id);
    if (!before.HasValue) return null;

    var session = before.Value;
    var result = new SessionIdentity { Id = id, LogonTime = session.LogonTime, Domain = session.Domain, User = session.User };
    if (session.LogonTime <= 0 || String.IsNullOrEmpty(session.User)) return result;

    Microsoft.Win32.SafeHandles.SafeAccessTokenHandle handle;
    bool opened = WTSQueryUserToken(id, out handle);
    using (handle) {
        if (!opened || handle == null || handle.IsInvalid) return result;
        using (var identity = new System.Security.Principal.WindowsIdentity(handle.DangerousGetHandle())) {
            var sid = identity.User;
            if (sid != null) result.Sid = sid.Value;
        }
    }

    // The trusted watcher reads only the SID and closes the handle before returning.
    var current = ReadSession(id);
    if (!current.HasValue || current.Value.LogonTime != session.LogonTime ||
        !String.Equals(current.Value.Domain, session.Domain, StringComparison.OrdinalIgnoreCase) ||
        !String.Equals(current.Value.User, session.User, StringComparison.OrdinalIgnoreCase)) return null;
    return result;
}

public static int[] SessionIds() {
    IntPtr buffer;
    int count;
    if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out buffer, out count))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
        int size = Marshal.SizeOf(typeof(SessionEntry));
        int[] ids = new int[count];
        for (int index = 0; index < count; index++) {
            var entry = (SessionEntry)Marshal.PtrToStructure(IntPtr.Add(buffer, index * size), typeof(SessionEntry));
            ids[index] = entry.Id;
        }
        return ids;
    } finally { WTSFreeMemory(buffer); }
}
'@
}

function Write-TdSessionLog([string] $Message) {
    Add-Content -LiteralPath $script:TdSessionLog -Value ("{0:u} {1}" -f (Get-Date), $Message)
}

function ConvertTo-TdLdapFilterValue([string] $Value) {
    [regex]::Replace($Value, '[\x00\\()*]', { param($match) '\{0:x2}' -f [int][char]$match.Value })
}

function Get-TdDirectoryName($Config) {
    if ($Config.domainNetbios) { return [string]$Config.domainNetbios }

    # Older policies supplied only the DNS name.
    $root = [ADSI]"LDAP://$($Config.domainDns)/RootDSE"
    try {
        $name = ConvertTo-TdLdapFilterValue ([string]$root.defaultNamingContext.Value)
        $partitions = [ADSI]"LDAP://$($Config.domainDns)/CN=Partitions,$($root.configurationNamingContext.Value)"
        $query = [DirectoryServices.DirectorySearcher]::new($partitions)
        try {
            $query.ClientTimeout = [TimeSpan]::FromSeconds(5)
            $query.Filter = "(&(objectClass=crossRef)(nCName=$name))"
            [void]$query.PropertiesToLoad.Add('nETBIOSName')
            $match = $query.FindOne()
            if ($match) { [string]$match.Properties['netbiosname'][0] }
        } finally { $query.Dispose(); $partitions.Dispose() }
    } finally { $root.Dispose() }
}

function Find-TdWatchedAccount($Config, [string] $Sid) {
    $accountSid = [Security.Principal.SecurityIdentifier]::new($Sid)
    $bytes = [byte[]]::new($accountSid.BinaryLength)
    $accountSid.GetBinaryForm($bytes, 0)
    $filterSid = ($bytes | ForEach-Object { '\{0:x2}' -f $_ }) -join ''
    $root = [ADSI]"LDAP://$($Config.domainDns)"
    $query = [DirectoryServices.DirectorySearcher]::new($root)
    try {
        $query.ClientTimeout = [TimeSpan]::FromSeconds(5)
        $query.Filter = "(&(objectCategory=person)(objectClass=user)(objectSid=$filterSid))"
        foreach ($property in 'distinguishedName', 'accountExpires', 'userAccountControl') {
            [void]$query.PropertiesToLoad.Add($property)
        }
        $match = $query.FindOne()
        if (-not $match) { return }

        $properties = $match.Properties
        $dn = [string]$properties['distinguishedname'][0]
        $guest = $dn.EndsWith(",$($Config.guestOuDn)", [StringComparison]::OrdinalIgnoreCase)
        $expiry = [long]$properties['accountexpires'][0]
        if ($expiry -eq [long]::MaxValue) { $expiry = 0 }
        if ($expiry -ne 0) { [void][DateTime]::FromFileTimeUtc($expiry) }
        [pscustomobject]@{
            Guest = $guest
            Expiry = $expiry
            Disabled = [bool]([int]$properties['useraccountcontrol'][0] -band 2)
        }
    } finally { $query.Dispose(); $root.Dispose() }
}

function Open-TdSessionLedger {
    $security = [Security.AccessControl.RegistrySecurity]::new()
    $security.SetAccessRuleProtection($true, $false)
    foreach ($value in 'S-1-5-18', 'S-1-5-32-544') {
        $sid = [Security.Principal.SecurityIdentifier]::new($value)
        $rule = [Security.AccessControl.RegistryAccessRule]::new($sid, 'FullControl', 'None', 'None', 'Allow')
        $security.AddAccessRule($rule)
    }
    [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey(
        'SOFTWARE\TempDesk\GuestSessionDeadlines',
        [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,
        [Microsoft.Win32.RegistryOptions]::Volatile,
        $security)
}

function ConvertFrom-TdSessionLedger($Config, [string] $Json) {
    $records = @{}
    if ($Json) {
        $state = $Json | ConvertFrom-Json -ErrorAction Stop
        if ($state.Version -eq 1 -and $state.Domain -ieq $Config.domainDns -and $state.GuestOu -ieq $Config.guestOuDn) {
            foreach ($record in $state.Records) { $records[$record.Identity] = $record }
        }
    }
    $records
}

function Get-TdSessionIdentity($Session) {
    if ($Session -and $Session.Sid -and $Session.LogonTime -gt 0) {
        '{0}:{1}:{2}' -f $Session.Id, $Session.LogonTime, $Session.Sid
    }
}

function Read-TdNativeSession([int] $Id) {
    try { [TempDesk.Wts]::ReadIdentity($Id) }
    catch { Write-TdSessionLog "Could not verify the account identity for session $Id." }
}

function Request-TdSessionLogoff([int] $Id) {
    [TempDesk.Wts]::WTSLogoffSession([IntPtr]::Zero, $Id, $false)
}

function Send-TdSessionWarning([int] $Id, [datetime] $Expiry) {
    $title = 'TempDesk'
    $message = "Your temporary sign-in ends at {0:t}. Save your work now: you will be signed out automatically and this account and its files will be removed." -f $Expiry.ToLocalTime()
    $response = 0
    [TempDesk.Wts]::WTSSendMessage([IntPtr]::Zero, $Id, $title, $title.Length * 2, $message, $message.Length * 2, 0x40, 60, [ref]$response, $false)
}

function Invoke-TdSessionPoll {
    param($Config, [string]$DomainName, [int[]]$SessionIds, [hashtable]$Previous, [datetime]$NowUtc)

    $current = @{}
    $directoryAvailable = [bool]$DomainName
    foreach ($id in $SessionIds) {
        if ($id -eq 0) { continue }
        $session = Read-TdNativeSession $id
        if (-not $session -or ($session.User -and -not $session.Sid)) {
            # A failed identity read does not establish that the account signed out.
            foreach ($entry in $Previous.Values) {
                if ($entry.SessionId -eq $id) { $current[$entry.Identity] = $entry }
            }
            continue
        }
        $identity = Get-TdSessionIdentity $session
        if (-not $identity -or -not $session.Domain -or $session.Domain -ieq $env:COMPUTERNAME) { continue }
        $known = $Previous[$identity]
        if ($DomainName) {
            if ($session.Domain -ine $DomainName) { continue }
        } elseif (-not $known) { continue }

        $account = $null
        if ($directoryAvailable) {
            try { $account = Find-TdWatchedAccount $Config $session.Sid }
            catch {
                $directoryAvailable = $false
                Write-TdSessionLog 'Directory lookup failed. Previously verified deadlines remain in effect.'
            }
        }

        $record = $known
        $reason = $null
        if ($directoryAvailable) {
            if (-not $account) {
                if ($known) { $reason = 'deleted' }
            } elseif (-not $account.Guest) {
                continue
            } else {
                $record = [pscustomobject]@{
                    Identity = $identity
                    SessionId = $id
                    Expiry = $account.Expiry
                    Revoked = $(if ($account.Disabled) { 'disabled' } else { '' })
                    Warned = [bool]($known -and $known.Warned -and $known.Expiry -eq $account.Expiry)
                }
            }
        }
        if ($reason -and $record) { $record.Revoked = $reason }
        if ($record) { $current[$identity] = $record }

        $expiry = $null
        if ($record -and $record.Expiry -gt 0) { $expiry = [datetime]::FromFileTimeUtc([long]$record.Expiry) }
        if (-not $reason -and $record -and $record.Revoked) { $reason = [string]$record.Revoked }
        if (-not $reason -and $expiry -and $expiry -le $NowUtc) { $reason = 'expired' }
        $warn = $expiry -and -not $record.Warned -and ($expiry - $NowUtc).TotalMinutes -le [int]$Config.logoffWarningMinutes
        if (-not ($reason -or $warn)) { continue }

        # A session slot can be reused while the LDAP call is in flight.
        $liveIdentity = Get-TdSessionIdentity (Read-TdNativeSession $id)
        if ($identity -ine $liveIdentity) { continue }
        if ($reason) {
            if (Request-TdSessionLogoff $id) {
                Write-TdSessionLog "Requested sign-out for $($session.User) (session $id): account $reason"
            } else {
                Write-TdSessionLog "Could not request sign-out for $($session.User) (session $id): account $reason"
            }
        } elseif (Send-TdSessionWarning $id $expiry) {
            $record.Warned = $true
            Write-TdSessionLog "Submitted expiry warning for $($session.User) (session $id), expires $expiry UTC"
        }
    }
    $current
}

function Invoke-TdSessionWatcher {
    $ErrorActionPreference = 'Stop'
    $local = Join-Path $env:ProgramData 'TempDesk\client'
    $cfg = Get-Content -LiteralPath (Join-Path $local 'client.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $script:TdSessionLog = Join-Path $local 'watcher.log'
    if ((Test-Path -LiteralPath $script:TdSessionLog) -and (Get-Item -LiteralPath $script:TdSessionLog).Length -gt 1MB) {
        Remove-Item -LiteralPath $script:TdSessionLog -Force
    }
    $domainName = $null
    try { $domainName = Get-TdDirectoryName $cfg }
    catch { Write-TdSessionLog 'Could not resolve the configured guest domain. Previously verified deadlines remain in effect.' }

    Initialize-TdSessionApi
    $ledger = $null
    try {
        $previous = @{}
        try {
            $ledger = Open-TdSessionLedger
            if (-not $ledger) { throw 'The session ledger is unavailable.' }
            $previous = ConvertFrom-TdSessionLedger $cfg ($ledger.GetValue('State'))
        } catch { Write-TdSessionLog 'Could not read the protected guest session ledger.' }

        $current = Invoke-TdSessionPoll -Config $cfg -DomainName $domainName -SessionIds ([TempDesk.Wts]::SessionIds()) -Previous $previous -NowUtc ([datetime]::UtcNow)
        if ($ledger) {
            $json = @{ Version = 1; Domain = $cfg.domainDns; GuestOu = $cfg.guestOuDn; Records = @($current.Values) } |
                ConvertTo-Json -Depth 4 -Compress
            $ledger.SetValue('State', $json, [Microsoft.Win32.RegistryValueKind]::String)
        }
    } finally {
        if ($ledger) { $ledger.Dispose() }
    }
}

if ($MyInvocation.InvocationName -ne '.') { Invoke-TdSessionWatcher }
