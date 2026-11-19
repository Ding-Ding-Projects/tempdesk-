# TempDesk verification handoff

## Direct portal HTTPS

The locally built image from `7ceecb3daf043865a07a59fee7f21fa989242f5e` started both portal roles through the TLS Compose overlays. On the isolated loopback ports the client verified the two expected certificate chains and names, secure cookies, rejected issuer and name mismatches, and no plaintext response. A missing key stopped startup and the same image kept the default HTTP mode healthy. The isolated directory issued, checked, and removed a temporary guest account, then returned to zero. All owned fixtures were removed. [HTTPS verification receipt](docs/evidence/portal-tls-7ceecb3daf.json)

The local v1.0.133 Portal Host from `a8fce8554a4a17955c6de843fd1207442f6bdfc2` deployed the published v1.0.132 image against a disposable Samba directory and an issuer that supplied a signed revocation list. It rejected a wrong certificate name, verified the guest and management links separately, and reopened both without replacing containers. The guest portal created, checked, and removed a finite sign-in over HTTPS. A recheck with missing revocation information showed the targeted diagnostic and withheld the links. The isolated containers and key directories were removed after verification. The live deployment still requires approved front-end certificates and a separate LAN client check. [Wizard, directory and capture receipt](docs/evidence/portal-host-https-a8fce85/receipt.json)

## Published phone PDF

The normal v1.0.129 release supplied a 327-page phone PDF bound to `19f4d61cf5b633754bab40db278eb4d9ff4241af`. Its downloaded bytes matched the release manifest and published digest. The PDF contains 45 articles, including the prepared operator wiki. All 193 internal links have usable tap rectangles and resolved destinations. Inspection covered the contents, the overview, and the wiki opening page. [Phone PDF receipt](docs/evidence/phone-edition-v129.json)

The normal v1.0.130 PDF from `fedc5b4a3f7b4015b2de3fdc65c0a53b74294691` matched its own digest, the same 45-article inventory and all 193 tap rectangles. Its prepared wiki opening page rendered identically to the inspected v1.0.129 page. [v1.0.130 release](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.130)

The downloaded v1.0.132 phone PDF matched the release digest and embedded revision `e86d1c8ac25534e9fd17bfbc98da101b03b7973b`. Its 331 phone-sized pages contain 46 articles including the prepared wiki. All 202 internal link rectangles resolved. The inspected HTTPS chapter begins on page 169. [v1.0.132 release](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.132) · [PDF structure receipt](docs/evidence/portal-host-https-a8fce85/receipt.json)

## Bilingual offline reader feedback

The local v1.0.130 reader built from `117d962e0ca0962d08039b338f7aac0f3ec66cf5` exercised accepted and rejected files in English, Cantonese, and bilingual modes across two themes, 360 px and 1440 px widths, and four emulated scales. Both outcomes fit in all 48 combinations. The rejection retained its Cantonese language tag, and Dismiss remained reachable at 48 px or larger and returned keyboard focus. An invalid Settings selection remained dismissible after the sheet closed. The skip link stayed entirely above the viewport while unfocused and appeared on Tab. The run used muted audio output and an isolated profile. [Visual and measured receipt](docs/evidence/offline-wording-locales-117d962/receipt.json)

The normal v1.0.128 release matches source `ea64e0598663869d772c1624789be7e9d99100ec`. Both downloaded documentation files matched the release manifest and stored digests. The executable opened the site, workstation guide, search, prepared wiki, and feature inventory offline. Nineteen bundled files matched their source bytes. The isolated profile was removed. Verify the later release separately for the bilingual and skip-link changes. [v1.0.128 release](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.128)

## Current native lab readiness

On 2026-11-19 at 16:49 UTC, the Core guest reported a synchronized directory and ready global catalog, and its directory-controller DNS record matched the reported host. The agent socket accepted TCP, while the client rejected the certificate before it could read the HTTPS health response. The separate Desktop Experience guest on its host-only segment answered its management listener. Its Remote Desktop port did not answer. The two guests occupied different virtual networks. The Desktop Experience guest still needs its initial credential setup and a private route to the directory. The dedicated Windows 11 workstation still needs its approved virtual TPM, setup, and enrollment. No native checkout or expiry was verified.

## Offline reader personal wording

The portable reader built from `328bb972125714368dcb055a0f3f9ff936c5902b` saved and applied a trusted file drop, preserved the previous wording after a rejected file, and replaced it through Settings. Keyboard dismissal restored focus. Wording and mute survived a reload, and keyboard Clear removed the saved wording. Reduced motion showed a static confirmation. The two local audio files returned 200 and each started playback with output muted. The reader made no external requests during the run and its isolated profile was removed. The wide and narrow screenshots and exact build hashes are in the [reader receipt](docs/evidence/offline-wording-328bb97/receipt.json). Product test suites, physical audio output, full language and theme coverage, and publication of this reader build remain unverified.

## Narrow guest Settings controls

The isolated image from `6e7e0001a1eb0db3d04bb0d5a035362bd653bd11` increased the seven measured undersized controls to at least 48 CSS px and added a visible localized label associated with the Settings search input. All 48 viewport, language, theme, and emulated scale combinations retained the expected column count, named controls, visible keyboard focus, and zero horizontal page overflow. The measured narrow controls owned their outer pointer areas in the bilingual check. The synthetic School mode cookie hid the language control and preserved the previous choice and mute state. Both inspected views are linked from the [walkthrough](README.md#use-settings-on-a-narrow-screen).

The live v1.0.126 rollout repeated the 48 Settings combinations. All 24 narrow combinations measured at least 48 CSS px for the inspected controls. The browser reported eleven instances of the cross-origin opener header diagnostic on the HTTP origin. Trusted HTTPS delivery remains open. [Live rollout receipt](docs/evidence/portal-rollout-v126.json)

The downloaded v1.0.125 reader from `ebfd7af1b3d95594cc4d6789a510de8111f3d03a` opened the workstation checklist, guest Settings guidance, and prepared wiki. Twelve bundled files matched their source bytes, including the v1.0.123 rollout receipt. The reader closed and its isolated profile was removed. [Release](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.125)

## Guest Settings and wording feedback

The hosted portal check at `6985c92531079abb28fab1424528261cea417289` recorded 252 passes and one failure. Its guest-route assertion still expected `GET /settings` to return 404. The updated assertion requires the guest Settings page and checks that management Settings mutations and export remain unavailable on the guest listener. [Original run](https://github.com/Ding-Ding-Projects/tempdesk-/actions/runs/44542289026)

The isolated portal image from `3407f84bd7538bc16a370bfe6087300e9fc02c62` opened guest Settings through Tools. The Settings search matched its localized group and control labels, and Escape returned focus to the opened regex builder's trigger. The browser started a cue for each applied and rejected wording file. A saved mute survived reload, and a valid file still showed its result without starting another cue. The browser's audio output was muted during verification. The synthetic sign-in was removed. The [walkthrough](README.md#guest-settings-and-action-sounds) links the inspected desktop image and records the scope. Live deployment and additional layout and language acceptance remain open.

The downloaded normal v1.0.122 documentation executable matches the manifest and release digest from `7cf2ec7954dc7482c2e0aa163b5ea5f405c0a35f`. The isolated run opened the home, search, Virtual Commons guide, prepared wiki and feature inventory. Nine bundled files matched the source bytes. The reader closed and its disposable profile was removed. [Release](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.122)

## Documentation walkthrough disclosures

The overview renderer recognizes balanced details blocks and their summary labels. Walkthrough content goes through the existing Markdown renderer. Other HTML stays escaped. Enter and Space opened and closed the disclosure at desktop and 360 px widths. The nested Lab verification link opened the containing disclosure. The built portable reader opened the walkthrough and the phone PDF included all four images. [Verification receipt](docs/evidence/documentation-disclosures-edcf827.json)

The normal v1.0.114 release matches the deployed documentation source. The downloaded portable reader opened the guest walkthrough offline and verified its four bundled images. The matching phone PDF contains 308 pages, 45 articles, and 189 internal links. The live overview served the disclosure, and the project's About address matched the deployed home. [Release readback](docs/evidence/documentation-disclosures-v114.json)

## Portal Host recovery

The wizard records the project, binding, and accepted publication receipt locally when startup begins. A reopened wizard can use the saved project for a fresh endpoint check after verifying the local engine. The source-bound portable build reopened against an isolated v1.0.114 project with a different setup draft. The downloaded normal v1.0.115 wizard also restored a saved project with a different draft. Native background Tab moved focus to the recheck action and Enter triggered it. Both v1.0.115 endpoints verified with the same container IDs and start times. The released offline reader opened the walkthrough and matched both images. The phone PDF contains the workflow on pages 77 through 79. Native Remote Desktop acceptance remains open. [Illustrated walkthrough](README.md#recheck-a-hosted-deployment) · [Verification receipt](docs/evidence/portal-host-reopen-ff5b6b4/receipt.json)

The documentation build includes the reviewed Portal Host receipt beside the walkthrough images. The downloaded normal v1.0.117 reader opened the evidence link from the bundled file and matched its SHA-256. The hosted article serves the same receipt. [v1.0.117 release](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.117)

## Protected portal agent key files

The portal accepts one agent key from an explicit `AGENT_KEY_FILE` path or its legacy setting. The guest Compose overlay mounts the operator's protected role file for the guest service. The packaged portal and the published v1.0.113 image used a mounted guest key and trusted TLS with an isolated Samba directory. Each created and removed a one-hour account. The guest key was rejected by the protected directory route. The packaged native configuration helper retained a selected role file path. Native directory and Remote Desktop acceptance remain open. [Configuration guide](docs/features/http-api/portal-agent-key-file.md) · [Build and runtime receipt](docs/evidence/protected-agent-key-file-c65b407.json)

## Live portal delivery

Both lab portals run the immutable v1.0.126 image from `fbb81cea5b769603bddb76cde13182f922c862f1`. A separate LAN client verified both running endpoints. Guest Settings returned 200 and management export returned 404 on the guest listener. The kiosk issued, checked, and removed a one-hour sign-in in the Samba directory. The count returned to zero. The downloaded reader matched fifteen source attachments, including the Settings images and measurement receipt. [Current rollout and reader evidence](docs/evidence/portal-rollout-v126.json) · [Earlier v1.0.123 rollout](docs/evidence/portal-rollout-v123.json) · [Earlier v1.0.120 rollout](docs/evidence/portal-rollout-v120.json)

The powered-off workstation's two attached discs matched their recorded digests. Eleven setup DVD payload files matched the tracked workstation source. The answer file contained the intended machine name, TLS, and network-level authentication settings. Secure Boot is enabled. The supported virtual TPM setup, guest installation, and broker enrollment remain open.

The updated guest route assertion passed in the hosted run at `640295e857a257003d324bf97a301020ee23d2e1`, which recorded 253 passing portal checks. The live image uses the earlier source revision shown above. [Hosted run](https://github.com/Ding-Ding-Projects/tempdesk-/actions/runs/44544851672)

The earlier v1.0.111 delivery from `76ccdfa` recorded the same guest lifecycle and supplied the original walkthrough images. [Illustrated walkthrough](README.md#guest-sign-in-walkthrough)

The downloaded Portal Host wizard cancelled once before creating any portal containers. It then started both portals in a separate synthetic configuration and reported each healthy endpoint. Its health recheck returned both endpoints with the same container IDs and start times. The standalone executable closed and its isolated profile was removed. The wizard fixture teardown, native chooser verification and cancellation during startup remain open. [Deployment and wizard receipt](docs/evidence/guest-sign-in-v111/receipt.json)

## Phone documentation edition

The Windows documentation build composes one source snapshot for both the
portable reader and the phone-sized PDF. The PDF uses all published guide,
feature and prepared wiki articles, with internal chapter and section links.
The normal release publisher requires the PDF in its manifest. Verify the
rendered pages, internal destinations and published asset for the exact
release before closing the roadmap item. [Offline documentation](docs/OFFLINE-GUIDE.md#read-the-phone-pdf)

## Bootable appliance producer

The Windows build entrypoint can assemble an x86_64 UEFI disk layout or a
Raspberry Pi 4 arm64 layout from a verified multi-platform portal publication
receipt. Both layouts use the existing Compose definition, bind to a selected
private LAN and wait for credentials provisioned through a separate protected
volume. The producer writes regular image files and never writes a host drive.
The release workflow assembles candidates on native x86_64 and arm64 runners.
Local arm64 emulation ran command-line binaries but could not execute Alpine
package scripts inside the image filesystem.
The local x86_64 image built from `6d7718d` booted in QEMU, mounted its
persistent partition and started Docker. With no configuration volume
attached, both portal health endpoints stayed closed. [Boot receipt](docs/evidence/appliance-x86-6d7718d.json)
The native x86_64 worker assembled a candidate for v1.0.108. The first native
Raspberry Pi 4 build ran out of space while copying duplicate boot files.
The revised Pi build selects its firmware pair and board device tree while
retaining one kernel and one generated initramfs. Verify the next native
arm64 output before using it.
The embedded x86_64 candidate at `1583b8718eaeda093ede791c6774c6922ed3524b`
booted through UEFI with KVM enabled. On an isolated network, a separate
client verified both v1.0.109 portals and a finite guest sign-in. The same
disk booted again with its configuration disk detached and passed the same
checks. The integrated x86_64 build for v1.0.117 repeated both checks with
the current published image and a separate disposable directory. Both
runs used the verified local image during both boots. The Pi 4
receipt covers its earlier direct kernel and OpenRC boot in board emulation.
The x86_64 build enables Alpine's ACPI service with a power-button event rule
for normal guest shutdown. Verify that shutdown stops the portal pair and
that the persisted configuration works on the next boot.
The rebuilt v1.0.117 x86_64 appliance at `a3b6dc2` completed both ACPI
power-offs through the guest, including the portal stop hooks. A separate
client verified both portals and finite sign-in creation on each boot. The
second boot used the same disk with the configuration medium detached.

Both v1.0.118 appliance jobs assembled their disks and stopped while removing
the intermediate checksum file. Assembly at `ebb985d` consumed the checksum
and unlinked the exact intermediate file. The unprivileged Linux PowerShell
build generated an x86_64 image whose hash was read back with its source-bound
receipt and 94 plain package entries. [v1.0.118 workflow](https://github.com/Ding-Ding-Projects/tempdesk-/actions/runs/44512940742)

The v1.0.119 workflow completed both native assembly jobs. Both downloaded
disk candidates matched their source, embedded image and compressed-file
receipts. The Pi 4 candidate also started its two portals in board emulation.
A separate client created a finite sign-in on each boot. The second boot
used the same disk and the saved configuration with the setup volume detached.
The emulator used a separate device-tree copy for its serial console and USB2
host. Physical firmware boot, LAN operation, and appliance release acceptance
remain open. [Candidate and boot receipt](docs/evidence/appliance-candidates-v119.json)

Track each boot, configured portal start, LAN check and release separately in
the [delivery checklist](ROADMAP.md). [Appliance guide](portal/README.md#build-a-bootable-appliance)

## Virtual Commons dim sum verification

The published v1.0.110 portal rendered the actual har gow photo in a 1440 px browser and the catalogue-unavailable result at 360 px. A controlled draw exercised both paths. Tab and Enter retried the same kiosk edition and duration. The isolated Samba directory stayed at zero guest accounts and the readiness fixture recorded no reservation requests. School mode took the ordinary checkout path, created one guest and downloaded the connection file. The fixture and its account data were removed. [Illustrated walkthrough](README.md#virtual-commons-dim-sum-walkthrough)

## Virtual Commons wording outcomes

The guest image from `c2aec2e` kept the picker, its built-in validation, and
the upload status on the active wording file. A rejected replacement preserved
the previous wording. Keyboard clear restored the original text and the
complete clear label fit at 360 px. The isolated directory issued a temporary
sign-in, and the upload, rejection, and replacement generated no browser
requests. [Illustrated walkthrough](README.md#virtual-commons-wording-walkthrough) ·
[Browser and image receipt](docs/evidence/virtual-commons-picker-outcomes-c2aec2e/receipt.json)

Native Remote Desktop session acceptance remains open. The Server Core directory is synchronized. The separate Desktop Experience guest answers its management endpoint on the host-only network. Its RDP port did not answer from the verification host. The dedicated Windows 11 workstation still requires encryption, a virtual TPM, installation and broker enrollment.

## Documentation source handoff

The README now has a quick entry point, a deployment workflow diagram and collapsible walkthroughs. The [operator guides](docs/features/README.md) index the existing articles, and the prepared wiki links to [Postman diagnostics](docs/features/http-api/README.md). The README count comes from the published v1.0.89 release. A classified count, human estimate and current product recording remain open. Postman execution, site rebuild and updated offline-reader verification were deferred.

## Earlier verification receipts

The guest and management containers were rebuilt from `3a18b69c04ceace56d70d694b5d8181de63ec9b3`. Both returned HTTP 200 from the test network. The guest walkthrough exercised a one-hour account with the real Samba backend, checked its active status, and deleted it using the kiosk. The PNG hashes and capture settings are in the [capture inventory](docs/evidence/guest-sign-in-inventory.json).

Server Core answered for its intended Active Directory domain and reported a synchronized directory with a ready global catalog. Its TempDesk agent returned a healthy Windows backend response. The lab kiosk currently uses Samba. A Windows-backed account-creation run requires a kiosk configured with the Windows agent's approved certificate and guest access.

The Windows 11 test client was powered off during the latest verification. Its domain membership and desktop sign-in remain open. The separate Desktop Experience host still needs its Remote Desktop session-host setup confirmed. Track both in the [roadmap](ROADMAP.md).

The [offline documentation reader](docs/OFFLINE-GUIDE.md) reuses the website build and has a dedicated portable package. The downloaded v1.0.74 executable matched the published digest and opened the home, documentation search, Virtual Commons guide, and prepared operator wiki from an otherwise empty folder. Its embedded revision was `7007e1f68321a6439c94382b32b12e9478a6ee0f`, and the 192 payload paths matched tracked source. The [standalone evidence](docs/evidence/standalone-docs-inventory.json) records the preceding v1.0.73 walkthrough.

The documentation index offers five guided paths with independent local marks. The built site passed keyboard task selection, checkmarks across reload, bilingual layout at 360 px, localized filter names, and fallbacks with scripts or storage blocked. The public guides and the downloaded v1.0.75 reader passed guide selection, search, and article and wiki navigation. The reader also opened the four bundled walkthrough images. The guide uses the checked-in [design frames](design/guided-documentation/REHEARSAL.md). Hosted design publication remains open.

The [illustrated checkout guide](README.md#guided-checkout-walkthrough) records four steps from the offline reader built on `9b4329b14b328b6b88301fd296bd0b3100994940`. The [inventory](docs/evidence/guided-docs-inventory.json) records the bytes and verification settings. The default guide fit across 48 measured layout configurations. All 212 documentation and answer-file tests passed, and all 51 PowerShell files parsed. The portal, Samba and streaming suite returned 390 passes, three failures and two errors on both the candidate and the prior revision `7007e1f68321a6439c94382b32b12e9478a6ee0f`.

The [feature verification inventory](docs/FEATURE-INVENTORY.md) lists scope and evidence for 119 features across seven surfaces. An isolated guest portal and Samba directory produced [both edition connection files](docs/evidence/virtual-commons-checkout.json) from `3f6133e972f5c892f520fc4558d0079278a4c9c7` and verified one-time confirmation, active accounts and self-deletion. Both destinations were fixture values. The live Windows session hosts still need sign-in and expiry verification.

The repaired guest portal built from `101eada160c0efc2757f957f93853301be4ca611` applied the imported file to both edition labels after a real guest sign-in, restored the original labels on clear and reload, and kept eligible upload access on the validation response. The browser made zero write requests during wording actions. All 220 website and answer-file tests passed and 51 PowerShell files parsed. The broader local Python verdict matched the earlier baseline. [Wording receipt](docs/evidence/virtual-commons-picker-wording.json)

The portal built from `ba64c82bbad0b90d461a386e9bb07eae6620f553` served both direct RDP attachments from real Samba checkouts with distinct confirmations. The test used one cookie store, opened the confirmations out of order, and verified repeated downloads and account removal. All 220 website and answer-file tests passed and 51 PowerShell files parsed. The local Python suite reported 395 passed with the same three failures and two errors as the baseline. [Attachment receipt](docs/evidence/virtual-commons-attachments.json)

Chromium headless shell automatically saved the expected file in both edition workflows. Pressing Enter on the manual link saved an identical copy at 1440 CSS pixels for Desktop Experience and 360 CSS pixels for Server Core. The browser created and removed real test accounts in the isolated directory. Edge replays hit the single-target privacy check. Native RDP sign-in and session expiry remain open.

The kiosk image built from `caddfb9c4e672ad59e3a8af8e7b7fd9386d5d2f0` passed all 48 checkout-label measurements at 360 and 1440 CSS pixels, through all three languages, light and dark themes, and emulated device scales 1 through 2. The previous image reproduced label overflow at 360 px. The new build also repeated both automatic downloads and manual retries. [Browser walkthrough](README.md#browser-attachment-walkthrough)

The kiosk at `32128b6a4731ace51ae9e26e031ce8d96bbb99b9` started on the lab network at 14:43 UTC on November 18, 2026. Its one-hour guest sign-in showed a one-time confirmation, validated the account, and deleted it. The kiosk uses the lab Samba directory. Production session destinations remain to be configured.

An isolated Chromium for Testing browser drove the same kiosk build through both edition choices. Both automatic downloads and both identical keyboard retries passed. Both accounts were removed. The [browser attachment walkthrough](README.md#browser-attachment-walkthrough) has source-bound captures for selection, confirmation, and retry. The confirmation and retry viewports exclude the credential fields.

The Virtual Commons App Host setup checks that the domain's session watcher is present, scheduled and protected before granting guest Remote Desktop access. It matches the exact guest group SID and defers guest access when the role installation requires a restart. Follow the [host setup](docs/VIRTUAL-COMMONS.md#prepare-the-desktop-experience-host). Native verification still requires a configured session host and a live guest sign-in, sign-out at expiry and rejected reconnect.

Management personal wording now validates the Settings file and window drop with one browser-local loader. Its cache is scoped to the current signed-in tab. Server renders supply ordinary localized text, and the browser personalizes marked copy. The old upload and clear routes return HTTP 410 without reading a submitted file. Older server files remain untouched.

The bilingual management Settings fixture previously measured a 385 px document at a 360 px viewport. The first-run setup action now wraps inside its card. The rebuilt fixture measured a 360 px document before, during and after applying wording. At session expiry, both headings restored and the browser cleared the saved wording without a request. The [personal wording walkthrough](README.md#personal-wording-walkthrough) shows select, apply, reload and clear in the signed-in v1.0.80 build.

Deployer and Studio now use original wording for new workspace action labels, saved history parameters, and exported or copied labels. The export chooser passes its selected format to the save workflow. Existing workspace records may predate these changes. Check active wording, literal record values, all export formats and dismissal against a dedicated test workspace.

Deployer records new notices as message keys and literal arguments. Studio keeps its catalogue identity when forwarding a notice. Applying or clearing wording refreshes the open drawer and its search. Wording import failures use one conditional cue and preserve the previous mapping. Verify the packaged renderer with repeated drops, a failed save, muted audio, and a notice matched by a live search.

Management Settings provides a browser-local sound choice for personal wording. The built portal exercised trusted file drops, a blocked save, a slow valid file, Clear with audio pending, school mode, and persistence after a new browser process. The setting fit all 48 language, theme, viewport and scale combinations. The sample wording caused zero non-read requests. The [illustrated workflow](README.md#management-action-sounds-walkthrough) records the exact source and image hashes. Physical audio output was muted during browser verification. The checked-in design reference is under `design/management-sounds/`. Hosted design publication is pending.

The [management notification walkthrough](README.md#management-notification-walkthrough) records three steps in the portal built from `d986ca134da5c7833f165e7e16fdfba0a0505a8c`. The isolated browser verified 48 layouts, account-scoped history, persistent warnings and errors, live wording changes, keyboard selection, filtered export, and deletion after two acknowledgements and a separate confirmation. It also verified that newly added history invalidates a stale review or survives a deletion scoped to earlier rows. The Python run recorded 395 passes and the same two baseline Windows file-mode assertions in the one-time state and Wi-Fi profiles tests. The notification design frames are under `design/management-notifications/`. Native guest sign-in and session-host verification remain open.

The Session Watcher retains the last verified guest deadline for the original Windows sign-in through a directory outage. It rechecks the session identity before requesting sign-out and drops inactive identities after a successful enumeration. The [acceptance steps](docs/VIRTUAL-COMMONS.md#verify-a-checkout) call for observing the original session's disappearance after expiry and during a separate account removal. Actual Remote Desktop sign-in and sign-out on the dedicated host remain open.

The rebuilt Deployer included the matching watcher script. Windows PowerShell 5.1 compiled the packaged code and read current-session metadata. The 25 watcher and App Host tests passed. Two deliberate mutations in a temporary fixture failed the exact outage and account-identity tests. The 223 documentation and Answer File tests passed, and all 55 PowerShell files parsed. The broader Python suite recorded 395 passes and the same two baseline Windows file-mode failures. On the lab network, the Core directory again reported synchronization and a ready global catalog. The Desktop Experience host's RDP port did not answer.

The next source wave integrated contributions in all twelve applicable feature categories. The Windows 11 checkout source includes powered-off VM preparation, an exact-account seat broker, and a portal route that returns a restricted connection file after an authenticated grant. The workstation has no live enrollment or Remote Desktop evidence yet. Tests for this source wave are deferred. Use the [workspace preparation guide](server/kiosk/README.md) and the [feature inventory](docs/FEATURE-INVENTORY.md) for the remaining implementation and acceptance work.

## Workstation preparation and feature browsing

The normal release v1.0.98 matches source revision 1ea8d8c6ee4c52acb212420746e3712573220cb9. The release manifest and Squirrel feed were downloaded, and all seven listed assets matched the published size and hash records. [Release inventory](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.98)

The local build at 89ea855f4ba746c430efb0140c5897eac2b1d8fb produced an unsigned Squirrel installer and a matching full package feed. Hosted checks passed at that revision. The hosted release still needed a verified previous-package input for delta generation. Local unit tests and native installation acceptance remain deferred.

The VMware Workstation provisioner created a separate powered-off Windows 11 checkout workstation using source revision 1372e533de832346eb9abc74a4dce950ade5b49b. The verified initial configuration included a host-only adapter, a pinned Microsoft evaluation installer and its credential-free setup DVD. The lab subsequently moved the powered-off workstation to the private VMware NAT segment shared with the directory controller. The Deployer preview now names the selected network and retains the resolved hypervisor through creation. Guest configuration regeneration retains the workstation and broker file settings. The workstation still needs encryption, a virtual TPM, installation, domain join, trusted broker enrollment and an actual checkout. [Workstation preparation](server/kiosk/README.md)

The documentation and offline reader share the new capability browser source. Deployer includes a searchable tab catalog, retained Base64 compatibility and a virtual disk workspace. The portal now includes specific search and regular-expression controls in its recovery and appearance panels. Operational verification stays pending. [Feature inventory](docs/FEATURE-INVENTORY.md) · [Virtual disk workspace](docs/features/built-in-tools/virtual-disks.md)

The dedicated Windows 11 workstation is a Virtual Commons Remote Desktop destination for one guest at a time. Its confirmation now identifies it as a computer edition. The 1% checkout branch keeps the retry and the published-photo fallback separate from account creation and seat allocation. The workstation remains powered off awaiting a virtual TPM and guest setup. An actual workstation checkout and browser verification of the photo outcomes remain pending. [Checkout and enrollment guide](docs/VIRTUAL-COMMONS.md#add-a-kiosk-windows-11-workstation)

Both lab portals were updated to v1.0.102, source `e90c483ea9863057bf133e49dfadc2a9e7ac365b`. The LAN pages and health endpoints responded with the running source, and the rollout retained both services' existing storage and port mappings. The deployment uses the locally built image. The new published-image workflow and Compose route carry a digest and source receipt. Pull and start the exact published digest before counting registry-backed hosting as verified. [Published image guide](portal/README.md#run-a-published-image)

The image published for `99d580a56e6df7aa1ac04fa58f9cb51ef2b02b85` passed a tracked Compose pull and isolated startup using the lab directory. Both portals returned their recorded source and HTTP 200. The temporary project was removed. Subsequent image publication reads back the normal release and builds using the tag-derived version. The Windows launcher consumes the resulting receipt for a digest-pinned pull and checks each live LAN endpoint. Verify this route with the accepted image and record both detached and interactive results. [Windows hosting](portal/README.md#host-on-windows)

Both existing lab portals now run the release-matched v1.0.104 registry image from `e500540d118c42d3ea655f1f9adc9a9b5f58ca57`. Its exact digest is `sha256:c4a31277ea388f0fe28437d4d58ebe57276550786872fca9acb3209260a93d6a`. Their data, certificate mounts and port mappings matched the preceding deployments. The first Windows launcher attempt treated native Compose progress as a PowerShell failure. The correction checks the native exit status. Detached startup and live log service switching, pause, resume and exit then passed against the accepted digest in an isolated project using the original role configuration files. An independent lab client read back all four LAN pages. The temporary service identities survived exiting the log view and were removed by a separate teardown. Local product suites remain deferred.

The lab subsequently verified v1.0.105 from `a83dd862be1c75478f82de197da2a61df263bc9d` on its existing storage and ports. The newer delivery work adds a two-architecture registry publisher and the source for a separate portable Portal Host wizard. The wizard uses the same hosting engine and an accepted receipt, with per-project bindings, safe cancellation before startup, and a health-only recheck. Its [design handoff](design/portal-host/HANDOFF.md) contains desktop and narrow rehearsal frames. Verify the published architecture entries, the packaged wizard and the appliance forms independently.
