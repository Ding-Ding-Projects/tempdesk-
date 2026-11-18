using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// Only image-file operations are exposed. Handles are never opened on physical disks.
[assembly: DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
public static class TempDeskImage {
    [StructLayout(LayoutKind.Sequential)]
    struct StorageType { public uint Device; public Guid Vendor; }
    [StructLayout(LayoutKind.Sequential)]
    struct OpenParameters { public uint Version; public uint ReadWriteDepth; }
    [StructLayout(LayoutKind.Sequential)]
    struct AttachParameters { public uint Version; public uint Reserved; }
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct CreateParameters {
        public uint Version, UnionAlignment;
        public Guid UniqueId;
        public ulong MaximumSize;
        public uint BlockSize, LogicalSector, PhysicalSector;
        public IntPtr ParentPath, SourcePath;
        public uint OpenFlags;
        public StorageType ParentType, SourceType;
        public Guid Resiliency;
    }
    [DllImport("virtdisk.dll", CharSet=CharSet.Unicode)]
    static extern uint OpenVirtualDisk(ref StorageType type, string file, uint access, uint flags,
        ref OpenParameters options, out SafeFileHandle handle);
    [DllImport("virtdisk.dll")]
    static extern uint AttachVirtualDisk(SafeFileHandle handle, IntPtr security, uint flags,
        uint providerFlags, ref AttachParameters options, IntPtr overlapped);
    [DllImport("virtdisk.dll", CharSet=CharSet.Unicode)]
    static extern uint CreateVirtualDisk(ref StorageType type, string file, uint access,
        IntPtr security, uint flags, uint providerFlags, ref CreateParameters options,
        IntPtr overlapped, out SafeFileHandle handle);
    static StorageType Type(uint device) {
        return new StorageType { Device=device, Vendor=new Guid("EC984AEC-A0F9-47e9-901F-71415A66345B") };
    }
    static void Check(uint result) {
        if (result != 0) throw new Win32Exception(unchecked((int)result));
    }
    [StructLayout(LayoutKind.Sequential)]
    struct SizeInfo {
        public uint Version, UnionAlignment;
        public ulong VirtualBytes, PhysicalBytes;
        public uint BlockBytes, SectorBytes;
    }
    [DllImport("virtdisk.dll")]
    static extern uint GetVirtualDiskInformation(SafeFileHandle handle, ref uint bufferSize,
        ref SizeInfo info, out uint sizeUsed);
    public static ulong Capacity(string file, uint device) {
        var type=Type(device);
        var options=new OpenParameters { Version=1, ReadWriteDepth=1 };
        SafeFileHandle handle;
        Check(OpenVirtualDisk(ref type,file,0x80000,0,ref options,out handle));
        using(handle) {
            var info=new SizeInfo { Version=1 };
            uint length=(uint)Marshal.SizeOf(typeof(SizeInfo)), used;
            Check(GetVirtualDiskInformation(handle,ref length,ref info,out used));
            return info.VirtualBytes;
        }
    }
    public static void Create(string file, uint device, ulong size, bool fixedSize) {
        var type=Type(device);
        var options=new CreateParameters { Version=2, MaximumSize=size };
        SafeFileHandle handle;
        uint flags=(fixedSize ? 1u : 0u) | (device == 4 ? 8u : 0u);
        uint result=CreateVirtualDisk(ref type,file,0,IntPtr.Zero,flags,0,ref options,IntPtr.Zero,out handle);
        using(handle) { Check(result); }
    }
    public static SafeFileHandle Attach(string file, uint device) {
        var type=Type(device);
        var options=new OpenParameters { Version=1, ReadWriteDepth=1 };
        SafeFileHandle handle;
        Check(OpenVirtualDisk(ref type,file,0x10000,0,ref options,out handle));
        try {
            var attach=new AttachParameters { Version=1 };
            // Read-only, no drive letter, no permanent lifetime. Closing this handle releases its lease.
            Check(AttachVirtualDisk(handle,IntPtr.Zero,3,0,ref attach,IntPtr.Zero));
            return handle;
        } catch { handle.Dispose(); throw; }
    }
}
