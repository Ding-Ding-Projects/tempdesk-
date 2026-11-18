# TempDesk roadmap

## Lab verification

- [x] Verify Server Core promotion through domain-controller DNS records and synchronized directory status, and verify the native TempDesk agent health endpoint.
- [x] Verify Samba-backed kiosk account creation, credential validation, one-time confirmation and self-deletion. See the [guest sign-in walkthrough](README.md#guest-sign-in-walkthrough).
- [x] Observe automatic removal of a separate one-hour account after its configured expiry.
- [x] Verify that the kiosk language search label and its regex controls fit at 360 px and 1440 px.
- [ ] Connect a kiosk to the native Windows agent through an authenticated configuration and prove temporary account creation there.
- [ ] Join the Windows 11 test client to the intended domain and prove desktop sign-in with a temporary account.
- [ ] Complete setup on the Desktop Experience session host and verify Remote Desktop checkout, sign-in and session termination at expiry.
- [ ] Validate a supported guest-session route for Server Core. Its administrative Remote Desktop capability is insufficient for guest sessions.

## Documentation and delivery

- [ ] Complete the required-feature inventory and runtime verification for each interface.
- [ ] Publish the operator wiki when its repository is available. [Prepared wiki entry point](docs/wiki/pending/Home.md)
- [x] Build and launch the standalone documentation reader locally. Verify offline search, the Virtual Commons guide, and the prepared operator wiki.
- [x] Verify the standalone documentation executable from a normal release. [Offline documentation walkthrough](README.md#standalone-offline-documentation)
- [ ] Confirm source archive isolation and pinned source links in the next published bundle.
- [ ] Verify the remaining delivery forms.
