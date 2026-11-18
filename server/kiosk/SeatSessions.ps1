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
public static bool Occupied() {
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
                if (!String.IsNullOrEmpty(Marshal.PtrToStringUni(name))) return true;
            } finally { WTSFreeMemory(name); }
        }
        return false;
    } finally { WTSFreeMemory(buffer); }
}
"@
}
