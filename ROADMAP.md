# TempDesk roadmap

## Lab verification

- [x] Verify Server Core promotion through domain-controller DNS records and synchronized directory status, and verify the native TempDesk agent health endpoint.
- [x] Verify Samba-backed kiosk account creation, credential validation, one-time confirmation and self-deletion. See the [guest sign-in walkthrough](README.md#guest-sign-in-walkthrough).
- [x] Observe automatic removal of a separate one-hour account after its configured expiry.
- [x] Roll out v1.0.102 to both lab portals. Verify their live source revision, health, volume identities and published port mappings.
- [x] Verify that the kiosk language search label and its regex controls fit at 360 px and 1440 px.
- [x] Verify both connection files and guest account checks against an isolated Samba directory. [Checkout receipt](docs/evidence/virtual-commons-checkout.json)
- [x] Verify scoped confirmations, both attachment destinations, retry and temporary account removal against a real isolated directory. [Attachment receipt](docs/evidence/virtual-commons-attachments.json)
- [x] Verify automatic downloads and keyboard retries for both editions. Check the checkout label across 48 layout combinations. Capture edition selection, confirmation, and retry from the built kiosk. [Browser walkthrough](README.md#browser-attachment-walkthrough)
- [x] Verify local edition wording, invalid file handling, clear and validation recovery in a built guest portal. [Picker receipt](docs/evidence/virtual-commons-picker-wording.json)
- [ ] Exercise edition wording on the configured live kiosk alongside a verified checkout session.
- [x] Prepare a separate powered-off VMware workstation and verify the installer and credential-free setup DVD hashes.
- [x] Verify the dedicated powered-off workstation is configured on the private lab directory segment.
- [ ] Install and enroll the dedicated Kiosk Windows 11 workstation. Verify its reservation, exact guest grant, connection file, sign-in, expiry, and release before another guest can reserve it.
- [x] Verify the Virtual Commons dim sum result with a published photo and with the catalogue unavailable, including retry without a seat or account and suppression in School mode. [Browser and directory receipt](docs/evidence/virtual-commons-dim-sum-6f6cb7f/receipt.json)
- [ ] Connect a kiosk to the native Windows agent through an authenticated configuration and prove temporary account creation there.
- [x] Verify the packaged portal with a protected guest key file, trusted TLS, directory-backed guest creation and removal, legacy compatibility and startup refusal for unusable settings. [Build and runtime receipt](docs/evidence/protected-agent-key-file-c65b407.json)
- [x] Verify the released guest portal with a mounted role key over trusted TLS and confirm normal account creation and legacy key configuration. [Verification receipt](docs/evidence/protected-agent-key-file-c65b407.json)
- [ ] Join the Windows 11 test client to the intended domain and prove desktop sign-in with a temporary account.
- [x] Verify the Session Watcher's outage, deadline, and account-identity decisions in isolated fixtures. Compile the bundled watcher and read current-session metadata on Windows PowerShell.
- [ ] Complete setup on the Desktop Experience session host. Verify the App Host watcher's connection to the joined domain, checkout and sign-in, then observe session termination at expiry and a rejected reconnect.
- [ ] On the dedicated session host, verify that an observed expiry still ends the open session when the test directory is unreachable. In a separate session, verify sign-out after account removal.
- [ ] Validate a supported guest-session route for Server Core. Its administrative Remote Desktop capability is insufficient for guest sessions.

## Documentation and delivery

- [x] Verify the compiled guest sign-in disclosure at desktop and 360 px widths. Open the walkthrough in the built portable reader and confirm the full printed content. [Verification receipt](docs/evidence/documentation-disclosures-edcf827.json)
- [x] Verify the deployed disclosure and the matching released offline package. [Release readback](docs/evidence/documentation-disclosures-v114.json)

- [x] Publish and read back the source-bound container digest at `99d580a`. Verify an isolated Compose pull, startup and health against the lab directory.
- [x] Verify a registry-backed LAN deployment whose image version matches v1.0.104. Exercise the corrected Windows launcher with detached startup, the keyboard menu and live log controls.
- [x] Verify the published amd64 and arm64 portal image entries by immutable digest.
- [x] Boot the x86_64 image through UEFI and check that it waits for credentials with both portal endpoints closed. [Boot receipt](docs/evidence/appliance-x86-6d7718d.json)
- [ ] Verify the x86_64 UEFI appliance image and Raspberry Pi 4 arm64 image, including configured startup, separate LAN checks, and restart persistence. [Appliance build and configuration](portal/README.md#build-a-bootable-appliance)
- [ ] Release both verified appliance images and connect them to the virtual machine and physical-media deployment workflows.
- [x] Use the published Portal Host wizard on the supported Windows host to cancel before startup, start both portals, and recheck health with the same container identities and start times. [Verification receipt](docs/evidence/guest-sign-in-v111/receipt.json)
- [ ] Reopen the rebuilt wizard and recheck a saved deployment from the opening step. Verify both endpoint results and unchanged container identities and start times.
- [ ] Verify the Portal Host native file chooser, cancellation during startup, and visual parity at the supported display settings.
- [x] Inventory the required features across the Deployer, management portal, guest portal, kiosk, public documentation, offline reader, and project delivery. [Verification inventory](docs/FEATURE-INVENTORY.md)
- [x] Record how to select, apply, reload and clear personal wording in the built management portal. [Illustrated steps](README.md#personal-wording-walkthrough)
- [ ] Verify local wording and outcome cues across the Deployer notification drawer, its search, and the remaining dynamic surfaces.
- [x] Verify the management action-sound switch and wording outcomes in the built portal, including a rejected file, a blocked save, browser restart and school mode. [Illustrated steps and receipt](README.md#management-action-sounds-walkthrough)
- [ ] Complete management personal-wording verification across the remaining dynamic copy surfaces.
- [x] Verify the rebuilt management notification centre with filtered bulk actions, guarded deletion, account-scoped history and reversible local wording. [Illustrated steps and receipt](README.md#management-notification-walkthrough)
- [ ] Complete the remaining feature implementation and runtime verification on every applicable surface.
- [ ] Publish the operator wiki when its repository is available. [Prepared wiki entry point](docs/wiki/pending/Home.md)
- [x] Generate a phone-sized PDF from the documentation and prepared wiki, verify its contents and internal links, and attach it to the normal release. [Release readback](docs/evidence/documentation-disclosures-v114.json)
- [x] Build and launch the standalone documentation reader locally. Verify offline search, the Virtual Commons guide, and the prepared operator wiki.
- [x] Verify the standalone documentation executable from a normal release. [Offline documentation walkthrough](README.md#standalone-offline-documentation)
- [x] Verify the source-bound documentation executable downloaded from the v1.0.74 release.
- [x] Record the guest checklist and both Virtual Commons guide paths from a source-bound local offline build. [Illustrated steps](README.md#guided-checkout-walkthrough)
- [x] Verify the guided documentation on GitHub Pages and in the downloadable v1.0.75 offline reader.
- [ ] Verify the remaining delivery forms.

- [x] Add the operator-guide source index, contribution and security policies, and release-pinned README count as tracked documentation.
- [ ] Exercise the Agent and Portal Postman collections against an isolated installation and verify each auth and capability-dependent response. [HTTP diagnostics guide](docs/features/http-api/README.md)
- [ ] Produce a current source-bound product walkthrough recording and refresh visual evidence for changed surfaces.
- [ ] Publish a classified line count with author attribution and derive a hand-written implementation estimate from the same release count.
