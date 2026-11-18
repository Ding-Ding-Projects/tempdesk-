# TempDesk roadmap

## Lab verification

- [x] Verify Server Core promotion through domain-controller DNS records and synchronized directory status, and verify the native TempDesk agent health endpoint.
- [x] Verify Samba-backed kiosk account creation, credential validation, one-time confirmation and self-deletion. See the [guest sign-in walkthrough](README.md#guest-sign-in-walkthrough).
- [x] Observe automatic removal of a separate one-hour account after its configured expiry.
- [x] Verify that the kiosk language search label and its regex controls fit at 360 px and 1440 px.
- [x] Verify both connection files and guest account checks against an isolated Samba directory. [Checkout receipt](docs/evidence/virtual-commons-checkout.json)
- [x] Verify scoped confirmations, both attachment destinations, retry and temporary account removal against a real isolated directory. [Attachment receipt](docs/evidence/virtual-commons-attachments.json)
- [x] Verify local edition wording, invalid file handling, clear and validation recovery in a built guest portal. [Picker receipt](docs/evidence/virtual-commons-picker-wording.json)
- [ ] Exercise edition wording on the configured live kiosk alongside a verified checkout session.
- [ ] Connect a kiosk to the native Windows agent through an authenticated configuration and prove temporary account creation there.
- [ ] Join the Windows 11 test client to the intended domain and prove desktop sign-in with a temporary account.
- [ ] Complete setup on the Desktop Experience session host and verify Remote Desktop checkout, sign-in and session termination at expiry.
- [ ] Validate a supported guest-session route for Server Core. Its administrative Remote Desktop capability is insufficient for guest sessions.

## Documentation and delivery

- [x] Inventory the required features across the Deployer, management portal, guest portal, kiosk, public documentation, offline reader, and project delivery. [Verification inventory](docs/FEATURE-INVENTORY.md)
- [ ] Complete the remaining feature implementation and runtime verification on every applicable surface.
- [ ] Publish the operator wiki when its repository is available. [Prepared wiki entry point](docs/wiki/pending/Home.md)
- [x] Build and launch the standalone documentation reader locally. Verify offline search, the Virtual Commons guide, and the prepared operator wiki.
- [x] Verify the standalone documentation executable from a normal release. [Offline documentation walkthrough](README.md#standalone-offline-documentation)
- [x] Verify the source-bound documentation executable downloaded from the v1.0.74 release.
- [x] Record the guest checklist and both Virtual Commons guide paths from a source-bound local offline build. [Illustrated steps](README.md#guided-checkout-walkthrough)
- [x] Verify the guided documentation on GitHub Pages and in the downloadable v1.0.75 offline reader.
- [ ] Verify the remaining delivery forms.
