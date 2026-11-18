# Virtual disks in the desktop deployer

Open **Virtual disks** in the navigation rail or command palette. **Add image files** opens the native file picker. **Discover attached images** queries the Windows Storage CIM provider. The session library includes only paths returned by those sources. A provider that cannot enumerate its images reports the Windows diagnostic; browsing remains available.

| Task | Supported route and result |
| --- | --- |
| Inspect | Read the backing file size and extension, ask the Storage module for attachment and geometry, and list partitions for an attached non-ISO image. Additional metadata and chain validation use the Hyper-V module when installed. VHD Set inspection asks Hyper-V for set files and snapshot IDs. A missing provider leaves its fields unknown. |
| Create an empty image | Select VHD, VHDX or VHD Set, a capacity in MiB, and fixed or dynamic allocation. The Windows VirtDisk API creates a new local file. Fixed allocation checks free space first. The operation reopens the result and checks its virtual capacity. A failed verification retains the created file for inspection. |
| Attach read-only | Select and confirm the exact file. The attach worker uses a read-only, nonpermanent VirtDisk handle without a drive letter. ISO attachments use ordinary rights. VHD-family attachments request native Windows elevation. Cancellation leaves the action incomplete. |
| Release | Close files using the attachment and confirm the name. Releasing the session handle lets Windows dismount the image. The deployer reads the reported attachment state back and reports an unverifiable result when another handle or missing provider prevents proof. Attachments created outside this session have no release control. |

Image creation accepts 3 MiB through 2,040 GiB for VHD, or 3 MiB through 64 TiB for VHDX and VHD Set. The Windows API can impose additional constraints. ISO and existing AVHD/AVHDX images can be inspected or opened read-only. This tool accepts local image files, rejects device paths and links, and does not target physical disks.

This implementation does not offer partition or filesystem mutation, differencing-disk creation, grow/shrink, compaction, format conversion, parent reconnection, chain merge, snapshot mutation, writable or permanent mounts, native boot, Dev Drive management, or quick pack. The file picker and navigation routes are implemented; drag and drop, persistent recent files and a bounded folder scan are outstanding. Native runtime, elevation, cancellation, format compatibility and release packaging have not been tested for this change.
