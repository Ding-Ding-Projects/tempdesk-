function Initialize-SeatSessionReader {
    if ('TempDesk.SeatSessions' -as [type]) { return }
    Add-Type -Namespace TempDesk -Name SeatSessions -MemberDefinition @"
[StructLayout(LayoutKind.Sequential)]
struct Session { public int Id; public IntPtr Name; public int State; }
[DllImport("wtsapi32.dll", SetLastError = true)]
static extern bool WTSEnumerateSessions(IntPtr server, int reserved, int version, out IntPtr buffer, out int count);
[DllImport("wtsapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
static extern bool WTSQuerySessionInformation(IntPtr server, int id, int field, out IntPtr value, out int length);
[DllImport("wtsapi32.dll")]
static extern void WTSFreeMemory(IntPtr buffer);
[DllImport("kernel32.dll")]
static extern uint WTSGetActiveConsoleSessionId();
static bool CurrentConsoleMatches(Session session, string user) {
    if (session.State != 0 || session.Id != System.Diagnostics.Process.GetCurrentProcess().SessionId ||
        (uint)session.Id != WTSGetActiveConsoleSessionId()) return false;
    IntPtr value;
    int bytes;
    // WTSClientProtocolType 0 means the physical VM console, not an RDP session.
    if (!WTSQuerySessionInformation(IntPtr.Zero, session.Id, 16, out value, out bytes))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
        if (value == IntPtr.Zero || bytes < 2 || Marshal.ReadInt16(value) != 0) return false;
    } finally { WTSFreeMemory(value); }
    if (!WTSQuerySessionInformation(IntPtr.Zero, session.Id, 7, out value, out bytes))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
        string domain = Marshal.PtrToStringUni(value);
        if (String.IsNullOrEmpty(domain)) return false;
        var name = new System.Security.Principal.NTAccount(domain, user);
        var sid = name.Translate(typeof(System.Security.Principal.SecurityIdentifier));
        using (var identity = System.Security.Principal.WindowsIdentity.GetCurrent()) {
            var principal = new System.Security.Principal.WindowsPrincipal(identity);
            return sid.Equals(identity.User) && principal.IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator)
                && (uint)session.Id == WTSGetActiveConsoleSessionId();
        }
    } finally { WTSFreeMemory(value); }
}
public static bool Occupied() { return Occupied(false); }
public static bool OccupiedDuringInitialConsoleSetup() { return Occupied(true); }
static bool Occupied(bool initialConsoleSetup) {
    IntPtr buffer;
    int count;
    if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out buffer, out count))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    try {
        int size = Marshal.SizeOf(typeof(Session));
        for (int i = 0; i < count; i++) {
            var s = (Session)Marshal.PtrToStructure(IntPtr.Add(buffer, size * i), typeof(Session));
            if (s.Id == 0 || s.State == 6) continue; // service session and listening endpoint
            IntPtr name;
            int length;
            if (!WTSQuerySessionInformation(IntPtr.Zero, s.Id, 5, out name, out length))
                throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            try {
                string user = Marshal.PtrToStringUni(name);
                if (!String.IsNullOrEmpty(user) && !(initialConsoleSetup && CurrentConsoleMatches(s, user))) return true;
            } finally { WTSFreeMemory(name); }
        }
        return false;
    } finally { WTSFreeMemory(buffer); }
}
"@
}
