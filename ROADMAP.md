# TempDesk roadmap

## Lab verification

- [x] Verify Server Core promotion through domain-controller DNS records and synchronized directory status, and verify the native TempDesk agent health endpoint.
- [x] Verify Samba-backed kiosk account creation, credential validation, one-time confirmation and self-deletion. See the [guest sign-in walkthrough](README.md#guest-sign-in-walkthrough).
- [x] Observe automatic removal of a separate one-hour account after its configured expiry.
- [x] Verify that the kiosk language search label and its regex controls fit at 360 px and 1440 px.
- [x] Verify both connection files and guest account checks against an isolated Samba directory. [Checkout receipt](docs/evidence/virtual-commons-checkout.json)
- [x] Verify scoped confirmations, both attachment destinations, retry and temporary account removal against a real isolated directory. [Attachment receipt](docs/evidence/virtual-commons-attachments.json)
- [x] Verify automatic downloads and keyboard retries for both editions. Check the checkout label across 48 layout combinations. Capture edition selection, confirmation, and retry from the built kiosk. [Browser walkthrough](README.md#browser-attachment-walkthrough)
- [x] Verify local edition wording, invalid file handling, clear and validation recovery in a built guest portal. [Picker receipt](docs/evidence/virtual-commons-picker-wording.json)
- [ ] Exercise edition wording on the configured live kiosk alongside a verified checkout session.
- [ ] Install and enroll the dedicated Kiosk Windows 11 workstation. Verify its reservation, exact guest grant, connection file, sign-in, expiry, and release before another guest can reserve it.
- [ ] Connect a kiosk to the native Windows agent through an authenticated configuration and prove temporary account creation there.
- [ ] Join the Windows 11 test client to the intended domain and prove desktop sign-in with a temporary account.
- [x] Verify the Session Watcher's outage, deadline, and account-identity decisions in isolated fixtures. Compile the bundled watcher and read current-session metadata on Windows PowerShell.
- [ ] Complete setup on the Desktop Experience session host. Verify the App Host watcher's connection to the joined domain, checkout and sign-in, then observe session termination at expiry and a rejected reconnect.
- [ ] On the dedicated session host, verify that an observed expiry still ends the open session when the test directory is unreachable. In a separate session, verify sign-out after account removal.
- [ ] Validate a supported guest-session route for Server Core. Its administrative Remote Desktop capability is insufficient for guest sessions.

## Documentation and delivery

- [x] Inventory the required features across the Deployer, management portal, guest portal, kiosk, public documentation, offline reader, and project delivery. [Verification inventory](docs/FEATURE-INVENTORY.md)
- [x] Record how to select, apply, reload and clear personal wording in the built management portal. [Illustrated steps](README.md#personal-wording-walkthrough)
- [ ] Verify local wording and outcome cues across the Deployer notification drawer, its search, and the remaining dynamic surfaces.
- [x] Verify the management action-sound switch and wording outcomes in the built portal, including a rejected file, a blocked save, browser restart and school mode. [Illustrated steps and receipt](README.md#management-action-sounds-walkthrough)
- [ ] Complete management personal-wording verification across the remaining dynamic copy surfaces.
- [x] Verify the rebuilt management notification centre with filtered bulk actions, guarded deletion, account-scoped history and reversible local wording. [Illustrated steps and receipt](README.md#management-notification-walkthrough)
- [ ] Complete the remaining feature implementation and runtime verification on every applicable surface.
- [ ] Publish the operator wiki when its repository is available. [Prepared wiki entry point](docs/wiki/pending/Home.md)
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
