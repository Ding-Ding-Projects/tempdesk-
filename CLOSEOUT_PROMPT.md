# Continue TempDesk verification

```text
Virtual Commons supports the Kiosk Windows 11 choice as a dedicated workstation for one temporary RDP guest at a time. The lab workstation is powered off with UEFI, Secure Boot, and both media files verified against their recorded hashes. The setup disc contains the broker registration helper. Complete owner-controlled VMware encryption and virtual TPM 2.0 before installing Windows. Then join the private lab directory, apply the watcher and RDP policies, enroll the trusted seat broker, and verify checkout, connection file, actual sign-in, expiry, rejected reconnect, and seat release.

The existing guest and management portals still run published v1.0.133 from cb8e00a64e45f3674a090bbc134a1d08bfb9eb6c. After an engine interruption, a separate lab client again received HTTP 200 from both roles on 2026-11-19 at 20:26 UTC. Container start times and image identity matched the existing deployment. See docs/evidence/portal-rollout-v133.json for rollout proof. Trusted live HTTPS still needs the approved issuer and a separate client check.

The normal v1.0.134 release from 23d5222dad11ef7a1232191aa2df113d8851c6a8 contains the phone PDF and portable reader. The PDF matched its published digest and contains 335 phone-size pages, 46 articles including the prepared wiki, and 203 resolved links. The digest-matched reader opened its home offline and served both repaired Portal Host JSON attachments and the v1.0.133 rollout receipt, each byte-for-byte against source. Its isolated process, listening port, and profile were released.

The local reader and Deployer share the School mode setting. Its preference scope pauses language, personal wording, and action sounds while retaining neutral appearance controls and saved preferences. The local v1.0.135 reader showed the shared mode off and the Enable control at desktop and narrow widths. See docs/evidence/offline-school-e13efa0/inventory.json. Verify mode transitions across both applications and complete article, wiki, search, and direct-route filtering before closing that requirement.

Hosted jobs at 0b32e06ef7f4781c569983305968794828db0817 found a legacy School mode return-value regression. The repair restores both original result shapes and keeps detailed native mode feedback. Verify the new source build and hosted jobs before accepting the next normal release.

The Core directory is promoted and still needs approved agent trust. The separate Desktop Experience host needs initial setup and a private directory route. Complete native Windows Server and workstation checkout and expiry verification, the remaining capability inventory, and separate wiki publication. Local product suites remain deferred.
```
