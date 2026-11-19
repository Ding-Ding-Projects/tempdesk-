# TempDesk

Temporary, self-service sign-ins for shared Windows computers, on an Active Directory domain that deploys itself.

Guests use the portal to request a time-limited standard account. Operators configure the directory and session destinations, then verify sign-in and expiry on each supported host.

[Open TempDesk online](https://ding-ding-projects.github.io/tempdesk-/) · [Install the Windows Deployer](https://github.com/Ding-Ding-Projects/tempdesk-/releases/latest/download/Setup.exe) · [Read the offline documentation guide](docs/OFFLINE-GUIDE.md)

**Contents** [Quick start](#quick-start) · [Deployment flow](#deployment-flow) · [Walkthroughs](#see-it-work-click-by-click) · [Operator guides](docs/features/README.md) · [API collections](docs/features/http-api/README.md) · [Evidence and delivery](#evidence-and-delivery)

## What is in the box

<details>
<summary>Components and where they run</summary>

| Part | What it does |
| --- | --- |
| **Answer File Studio** | Builds `autounattend.xml` kits that install Windows Server 2025 Core, create the domain, and set up TempDesk with no further clicks. Covers every one of the 1,288 settings in Microsoft's unattend reference, with canvases for setup passes, disks and commands, two-way XML editing, 56 validation rules (28 with quick fixes), templates, compare, simulate and unlimited undo. Runs in the browser (website) and in the desktop app. |
| **TempDesk Deployer** (`deployer/`) | Desktop app for Windows: answer files, ISO and USB kits, creating, starting and managing VMware Workstation virtual machines for the install, monitoring the unattended install, deploying TempDesk Lite over SSH, starting the portals. Git-backed history with unlimited undo. |
| **Server setup** (`server/`) | Unattended first boot, forest creation, OUs, groups, Group Policy, AD Recycle Bin, guest reaper, optional native portals, app host for streaming. |
| **TempDesk Agent** (`agent/`) | Windows service on the domain controller exposing `docs/API.md`: guests, every directory object and attribute, Group Policy including every Administrative Template and security setting, a cmdlet runner, and Windows Admin Center style server management. |
| **TempDesk Lite** (`samba/`) | The same API on a Samba 4 domain controller in Docker, for when you do not want a Windows Server license. |
| **Guest portal and admin console** (`portal/`) | One Docker image, two modes. The admin console manages everything the agent can do, with imports and exports, undo backed by Git, Base64 tools, English and Cantonese. |
| **App streaming** (`streaming/`) | Stream RemoteApps to the browser through Apache Guacamole, or download `.rdp` files. |
| **Client scripts** (`client/`) | Run on shared PCs: Wi-Fi profiles, Chrome, developer tools and AI apps, sign-out at expiry, profile cleanup. |
| **Website** (`site/`) | Landing page, Answer File Studio, Base64 toolkit, feature articles and docs. |
| **TempDesk Docs** | Read the guides and operator wiki in the standalone reader or in the phone-sized PDF attached to the release. [Open the offline documentation guide](docs/OFFLINE-GUIDE.md). |

</details>

## Quick start

Use the [guided documentation](https://ding-ding-projects.github.io/tempdesk-/docs/#guided-workflows) to choose a directory, verify a guest sign-in, or check a Virtual Commons destination. The checklists save your marks locally as you work. See the [live kiosk walkthrough](#guest-sign-in-walkthrough) and [guided checkout walkthrough](#guided-checkout-walkthrough) for illustrated steps, and the [capability reader](https://ding-ding-projects.github.io/tempdesk-/docs/capabilities.html) to search recorded evidence by surface and delivery state. Operators can follow the [Virtual Commons host setup](docs/VIRTUAL-COMMONS.md#prepare-the-desktop-experience-host) before publishing a session destination.

1. Open the Answer File Studio (website or Deployer), pick the **TempDesk server** template, fill in names, network and passwords, and build the kit.
2. VMware Workstation on this PC: in the Deployer, drop the Windows Server 2025 ISO on **Step 1b** and click **Create the virtual machine and start the install**; the app makes the machine, attaches both ISOs, starts it and presses the boot key. Any other hypervisor: attach the kit ISO as a second CD next to the Windows Server 2025 ISO. Bare metal: copy the kit to the root of the USB stick that holds the Windows installer. **Disk 0 is erased.**
3. Boot. Setup installs Windows Server Core, creates the domain and installs TempDesk. The server's sign-in screen says **TempDesk is ready** with the addresses when it finishes.
4. Erase the kit media: it contains the passwords.
5. Start the portals (`portal/compose.yaml`) or choose native portals in the template, then join the shared PCs to the domain.

Prefer Linux? Use **TempDesk Lite**: see `samba/README.md`.

For a separate Windows 11 Remote Desktop checkout, open the [guided workstation checklist](https://ding-ding-projects.github.io/tempdesk-/docs/?task=commons&variant=workstation#guided-workflows) and follow [Kiosk Windows 11 workstation setup](docs/VIRTUAL-COMMONS.md#add-a-kiosk-windows-11-workstation). The dedicated workstation can hold one guest reservation at a time. A trusted broker confirms the guest's exact Windows account grant before the portal serves its connection file.

To assemble the published portals into a dedicated machine image, use the [bootable appliance guide](portal/README.md#build-a-bootable-appliance). The guide covers the x86_64 and Raspberry Pi 4 build targets, protected first-boot configuration and LAN verification.

## Deployment flow

```mermaid
flowchart TD
    A[Choose where the directory will run] --> B{Directory backend}
    B -->|Windows Server| C[Generate the unattended kit and deploy the agent]
    B -->|Samba| D[Deploy the TempDesk Lite directory and agent]
    C --> E[Connect the portals to the agent]
    D --> E
    E --> F[Confirm directory health and guest policy]
    F --> G[Create a temporary standard account]
    G --> H[Verify sign-in and expiry at the intended destination]
```

Follow the [guided deployment and checkout tasks](https://ding-ding-projects.github.io/tempdesk-/docs/#guided-workflows).

## See it work, click by click

These walkthroughs preserve captures from the builds identified in their receipts. Some older captures mark the interaction in red. The receipts and source revisions identify which behavior each walkthrough proves.

<details>
<summary><strong>Deploy a server from the desktop app, VMware included</strong> (27 steps)</summary>

TempDesk Deployer, built from commit `b5753fa`, driven through its real controls. It builds the answer media, takes the Windows Server ISO by drag and drop, creates a VMware Workstation virtual machine, starts it and presses the boot key. Windows then installs with no clicks.

1. First-run wizard, step 1 of 5: "Welcome to TempDesk Deployer". Click Next.

   ![First-run wizard, step 1 of 5: 'Welcome to TempDesk Deployer'. Click Next.](docs/walkthrough/deployer-01.jpg)

2. First-run wizard, step 2 of 5: "How will you run TempDesk?". Click Next.

   ![First-run wizard, step 2 of 5: 'How will you run TempDesk?'. Click Next.](docs/walkthrough/deployer-02.jpg)

3. First-run wizard, step 3 of 5: "Check this PC". Click Next.

   ![First-run wizard, step 3 of 5: 'Check this PC'. Click Next.](docs/walkthrough/deployer-03.jpg)

4. First-run wizard, step 4 of 5: "Language and look". Click Next.

   ![First-run wizard, step 4 of 5: 'Language and look'. Click Next.](docs/walkthrough/deployer-04.jpg)

5. First-run wizard, step 5 of 5: "All set". Click Open the workspace.

   ![First-run wizard, step 5 of 5: 'All set'. Click Open the workspace.](docs/walkthrough/deployer-05.jpg)

6. The wizard is finished and the Deploy page opens.

   ![The wizard is finished and the Deploy page opens.](docs/walkthrough/deployer-06.jpg)

7. Type the deployment name.

   ![Type the deployment name.](docs/walkthrough/deployer-07.jpg)

8. Type the domain name. The NetBIOS name follows it.

   ![Type the domain name. The NetBIOS name follows it.](docs/walkthrough/deployer-08.jpg)

9. Type the server address (inside the VMware NAT network used for this test).

   ![Type the server address (inside the VMware NAT network used for this test).](docs/walkthrough/deployer-09.jpg)

10. Type the gateway.

   ![Type the gateway.](docs/walkthrough/deployer-10.jpg)

11. Choose native portals, so the server hosts the guest portal and admin console itself.

   ![Choose native portals, so the server hosts the guest portal and admin console itself.](docs/walkthrough/deployer-11.jpg)

12. Click Generate for the Administrator password (shown as dots, never captured).

   ![Click Generate for the Administrator password (shown as dots, never captured).](docs/walkthrough/deployer-12.jpg)

13. Click Generate for the recovery (DSRM) password.

   ![Click Generate for the recovery (DSRM) password.](docs/walkthrough/deployer-13.jpg)

14. Click Build media.

   ![Click Build media.](docs/walkthrough/deployer-14.jpg)

15. The safety dialog: type WIPE to confirm that disk 0 of the new server will be erased.

   ![The safety dialog: type WIPE to confirm that disk 0 of the new server will be erased.](docs/walkthrough/deployer-15.jpg)

16. Press and hold "Hold to build wiping media" for 1.5 seconds.

   ![Press and hold 'Hold to build wiping media' for 1.5 seconds.](docs/walkthrough/deployer-16.jpg)

17. The media is built: answer file folder, zip kit and ISO, every step done.

   ![The media is built: answer file folder, zip kit and ISO, every step done.](docs/walkthrough/deployer-17.jpg)

18. Drop the Windows Server ISO on the drop area (the "upload"). Its location appears in the field below.

   ![Drop the Windows Server ISO on the drop area (the 'upload'). Its location appears in the field below.](docs/walkthrough/deployer-18.jpg)

19. Type a name for the virtual machine.

   ![Type a name for the virtual machine.](docs/walkthrough/deployer-19.jpg)

20. Type the folder for the virtual machine.

   ![Type the folder for the virtual machine.](docs/walkthrough/deployer-20.jpg)

21. Give it 4 processors.

   ![Give it 4 processors.](docs/walkthrough/deployer-21.jpg)

22. Give it 8192 MB of memory.

   ![Give it 8192 MB of memory.](docs/walkthrough/deployer-22.jpg)

23. Choose the NAT network (a private VMware network, used for this test).

   ![Choose the NAT network (a private VMware network, used for this test).](docs/walkthrough/deployer-23.jpg)

24. Switch off "Show the VMware window" so the machine runs in the background for this test.

   ![Switch off 'Show the VMware window' so the machine runs in the background for this test.](docs/walkthrough/deployer-24.jpg)

25. Click "Create the virtual machine and start the install".

   ![Click 'Create the virtual machine and start the install'.](docs/walkthrough/deployer-25.jpg)

26. The app is creating the machine and starting it.

   ![The app is creating the machine and starting it.](docs/walkthrough/deployer-26.jpg)

27. Done: VMware found, both ISOs checked, machine created and started, boot prompt key pressed.

   ![Done: VMware found, both ISOs checked, machine created and started, boot prompt key pressed.](docs/walkthrough/deployer-27.jpg)

</details>

<details>
<summary><strong>Manage the virtual machines the app created</strong> (15 steps)</summary>

The list on the Deploy page shows only machines TempDesk made. From it the app shows the machine's screen while Windows installs, and the finished server afterwards.

1. In "Your TempDesk virtual machines", click Refresh.

   ![In 'Your TempDesk virtual machines', click Refresh.](docs/walkthrough/machines-01.jpg)

2. Click "Show the screen" on the machine.

   ![Click 'Show the screen' on the machine.](docs/walkthrough/machines-02.jpg)

3. The dialog shows the machine's screen: Windows Server is installing by itself.

   ![The dialog shows the machine's screen: Windows Server is installing by itself.](docs/walkthrough/machines-03.jpg)

4. Close the screen dialog.

   ![Close the screen dialog.](docs/walkthrough/machines-04.jpg)

5. In "Your TempDesk virtual machines", click Refresh.

   ![In 'Your TempDesk virtual machines', click Refresh.](docs/walkthrough/machines-05.jpg)

6. Click "Show the screen" on the machine.

   ![Click 'Show the screen' on the machine.](docs/walkthrough/machines-06.jpg)

7. About 20 minutes later: Windows Server is installed, is a domain controller and waits at its lock screen.

   ![About 20 minutes later: Windows Server is installed, is a domain controller and waits at its lock screen.](docs/walkthrough/machines-07.jpg)

8. Close the screen dialog.

   ![Close the screen dialog.](docs/walkthrough/machines-08.jpg)

9. When the test is over: click Power off on the machine.

   ![When the test is over: click Power off on the machine.](docs/walkthrough/machines-09.jpg)

10. Confirm Power off in the dialog.

   ![Confirm Power off in the dialog.](docs/walkthrough/machines-10.jpg)

11. The machine now shows Stopped, with Start and Delete.

   ![The machine now shows Stopped, with Start and Delete.](docs/walkthrough/machines-11.jpg)

12. Click Delete.

   ![Click Delete.](docs/walkthrough/machines-12.jpg)

13. The safety dialog: type DELETE.

   ![The safety dialog: type DELETE.](docs/walkthrough/machines-13.jpg)

14. Press and hold "Hold to delete the virtual machine".

   ![Press and hold 'Hold to delete the virtual machine'.](docs/walkthrough/machines-14.jpg)

15. The machine and its disk are gone; the list is empty again.

   ![The machine and its disk are gone; the list is empty again.](docs/walkthrough/machines-15.jpg)

</details>

<details>
<summary><strong>The finished Windows server doing its job</strong> (13 steps)</summary>

The server installed above hosts the guest portal itself. A sign-in is created on it and deleted again.

1. The guest portal served by the new Windows server: type a name.

   ![The guest portal served by the new Windows server: type a name.](docs/walkthrough/server-01.jpg)

2. Click "Create my sign-in".

   ![Click 'Create my sign-in'.](docs/walkthrough/server-02.jpg)

3. Active Directory on the new server created the account (password covered).

   ![Active Directory on the new server created the account (password covered).](docs/walkthrough/server-03.jpg)

4. The admin console on the same server: type the administrator name.

   ![The admin console on the same server: type the administrator name.](docs/walkthrough/server-04.jpg)

5. Type the password generated in the desktop app (dots).

   ![Type the password generated in the desktop app (dots).](docs/walkthrough/server-05.jpg)

6. Click Sign in.

   ![Click Sign in.](docs/walkthrough/server-06.jpg)

7. Signed in: the Windows-hosted console opens its first-run setup and confirms that the agent on TD-DC01 answers.

   ![Signed in: the Windows-hosted console opens its first-run setup and confirms that the agent on TD-DC01 answers.](docs/walkthrough/server-07.jpg)

8. Back in the guest portal: open "Delete my sign-in".

   ![Back in the guest portal: open 'Delete my sign-in'.](docs/walkthrough/server-08.jpg)

9. Type the username.

   ![Type the username.](docs/walkthrough/server-09.jpg)

10. Type the password (dots).

   ![Type the password (dots).](docs/walkthrough/server-10.jpg)

11. Tick the confirmation.

   ![Tick the confirmation.](docs/walkthrough/server-11.jpg)

12. Click the delete button.

   ![Click the delete button.](docs/walkthrough/server-12.jpg)

13. The account is removed from Active Directory.

   ![The account is removed from Active Directory.](docs/walkthrough/server-13.jpg)

</details>

<details>
<summary><strong>The Docker-hosted portals doing real work</strong> (25 steps)</summary>

The guest portal and admin console run as containers in front of a TempDesk Lite domain controller (also a container). A visitor creates a sign-in, the admin console shows it and the audit log records it, then the visitor deletes it.

1. Guest portal (Docker): a visitor types a name.

   ![Guest portal (Docker): a visitor types a name.](docs/walkthrough/docker-01.jpg)

2. Choose how long the sign-in is needed: 1 hour.

   ![Choose how long the sign-in is needed: 1 hour.](docs/walkthrough/docker-02.jpg)

3. Click "Create my sign-in".

   ![Click 'Create my sign-in'.](docs/walkthrough/docker-03.jpg)

4. The portal created a real account in the directory and shows the sign-in once (password covered here).

   ![The portal created a real account in the directory and shows the sign-in once (password covered here).](docs/walkthrough/docker-04.jpg)

5. Admin console (Docker): type the administrator name.

   ![Admin console (Docker): type the administrator name.](docs/walkthrough/docker-05.jpg)

6. Type the password (shown as dots).

   ![Type the password (shown as dots).](docs/walkthrough/docker-06.jpg)

7. Click Sign in.

   ![Click Sign in.](docs/walkthrough/docker-07.jpg)

8. The dashboard is live: one active guest, straight from the domain controller.

   ![The dashboard is live: one active guest, straight from the domain controller.](docs/walkthrough/docker-08.jpg)

9. Open Guests.

   ![Open Guests.](docs/walkthrough/docker-09.jpg)

10. The new guest account is in the list with its expiry.

   ![The new guest account is in the list with its expiry.](docs/walkthrough/docker-10.jpg)

11. Go back to the dashboard.

   ![Go back to the dashboard.](docs/walkthrough/docker-11.jpg)

12. Click "Open the audit log".

   ![Click 'Open the audit log'.](docs/walkthrough/docker-12.jpg)

13. The audit log recorded the account creation.

   ![The audit log recorded the account creation.](docs/walkthrough/docker-13.jpg)

14. Back in the guest portal: open "Check my sign-in".

   ![Back in the guest portal: open 'Check my sign-in'.](docs/walkthrough/docker-14.jpg)

15. Type the username.

   ![Type the username.](docs/walkthrough/docker-15.jpg)

16. Type the password (dots).

   ![Type the password (dots).](docs/walkthrough/docker-16.jpg)

17. Click Check.

   ![Click Check.](docs/walkthrough/docker-17.jpg)

18. The portal reports the remaining time of the account.

   ![The portal reports the remaining time of the account.](docs/walkthrough/docker-18.jpg)

19. Open "Delete my sign-in".

   ![Open 'Delete my sign-in'.](docs/walkthrough/docker-19.jpg)

20. Type the username.

   ![Type the username.](docs/walkthrough/docker-20.jpg)

21. Type the password (dots).

   ![Type the password (dots).](docs/walkthrough/docker-21.jpg)

22. Tick "I understand this cannot be undone".

   ![Tick 'I understand this cannot be undone'.](docs/walkthrough/docker-22.jpg)

23. Click the delete button.

   ![Click the delete button.](docs/walkthrough/docker-23.jpg)

24. The account is deleted from the directory.

   ![The account is deleted from the directory.](docs/walkthrough/docker-24.jpg)

25. Admin console, Guests: the account is gone.

   ![Admin console, Guests: the account is gone.](docs/walkthrough/docker-25.jpg)

</details>
Captures: TempDesk Deployer built from commit `b5753fa` and the portal containers built from the same commit, 2026-11-09, Windows Server 2025 evaluation in VMware Workstation. The label `pw.veryStrong` beside **Generate** in a few pictures was a missing string that has since been fixed. The server in the walkthrough needed one automatic continue after a DNS timing fault that is also fixed (see the changelog).

## Security

Read `docs/SECURITY.md` first. In short: guests are always standard users; the agent and portals use plain HTTP by default, so keep them on a trusted network or turn TLS on; the guest portal is open to anyone on the LAN.

## Development

| Area | Test command |
| --- | --- |
| Portals | `cd portal && python -m pytest` |
| TempDesk Lite | `cd samba && python -m pytest` |
| Streaming | `cd streaming && python -m pytest` |
| Website | `node --test site/tests/` |
| Answer file catalog | `cd answerfile && node --test tests/*.test.mjs` |
| Deployer | `cd deployer/app && npm test`, and Pester in `deployer/engine` |
| Windows builds | `build.bat` and `build-installer.bat` on Windows |

See `AGENTS.md` for repository rules. License: MIT.

## Guest sign-in walkthrough

<details>
<summary>Steps and evidence for guest sign-in walkthrough</summary>

1. Open the guest kiosk. Select **1 hour** and choose **Create my sign-in**.

   ![Guest form with the one-hour duration selected](docs/evidence/guest-sign-in-v111/01-create-one-hour-sign-in.png)

2. Read the one-time confirmation and note the expiry. The countdown shows the time remaining.

   ![The one-hour countdown on the guest confirmation](docs/evidence/guest-sign-in-v111/02-confirmed-one-hour-deadline.png)

3. Open **Check my sign-in** and enter the credentials from the confirmation. The example account returned **Active** with its expiry time.

   ![Status panel showing an active guest sign-in and its deadline](docs/evidence/guest-sign-in-v111/03-active-sign-in-status.png)

4. To end the sign-in early, open **Delete my sign-in**, enter the credentials and confirm. The kiosk showed the deletion confirmation and the lab directory lookup confirmed that the test account was gone.

   ![Guest portal banner confirming sign-in deletion](docs/evidence/guest-sign-in-v111/04-deletion-confirmed.png)

The [v1.0.111 verification receipt](docs/evidence/guest-sign-in-v111/receipt.json) records the running container image, directory readback, viewports and file hashes. The four images show selected interface elements with credentials out of view. The [prior portal captures](docs/evidence/portal-history.md) retain their original provenance.

### Lab verification

Server Core responded as a synchronized Active Directory domain controller with a ready global catalog. Its native TempDesk agent returned a healthy response for the Windows backend. Both v1.0.133 lab portals answered from a separate LAN client with the published source revision. The guest kiosk created a finite sign-in in the running Samba directory, confirmed it was active, and removed it through self-service. A subsequent check rejected the removed sign-in and the directory returned to zero guest accounts. [Live rollout receipt](docs/evidence/portal-rollout-v133.json)

A separate one-hour kiosk account had a configured expiry of 11:47:52 UTC on November 18, 2026. The lab directory confirmed the record was absent at 11:50:37 UTC.

Windows 11 domain membership and desktop sign-in, temporary account creation through the native Windows backend, and Remote Desktop checkout to a session host remain unverified. See [Verify a checkout](docs/VIRTUAL-COMMONS.md#verify-a-checkout).

The checklist also covers two ways to verify that an open session ends. Leave the session connected through its known expiry with the test directory briefly unavailable, or remove the account while its session is open. In either case, confirm that the original session disappears.

</details>

## Virtual Commons dim sum walkthrough

<details>
<summary>See the dish result and its retry</summary>

1. In **Virtual Commons**, pick **Kiosk Windows 11** and a checkout duration.
2. When the one-in-a-hundred result shows a dim sum dish, use **Try again** to return to your selected workstation and duration. The result leaves the seat free and creates no guest account.

   ![Virtual Commons dim sum result with the published har gow photo and keyboard focus on Try again](docs/evidence/virtual-commons-dim-sum-6f6cb7f/published-dish.png)

3. If the photo catalogue is unavailable, the dish name and **Try again** stay available. Press Tab to reach **Try again** and Enter to select it.

   ![Narrow Virtual Commons result with the dish photo unavailable message and keyboard focus on Try again](docs/evidence/virtual-commons-dim-sum-6f6cb7f/catalogue-unavailable.png)

4. With School mode enabled, the same checkout proceeds to the ordinary temporary account and Remote Desktop download.

The [browser and directory receipt](docs/evidence/virtual-commons-dim-sum-6f6cb7f/receipt.json) records the published v1.0.110 build, both screenshots, and the controlled draw used to exercise the result. The isolated Samba directory stayed at zero guest accounts through both dim sum checkouts, and the readiness fixture recorded zero reservation requests. The School mode checkout created one guest and downloaded `Virtual-Commons.rdp`.

</details>

## Guided checkout walkthrough

<details>
<summary>Steps and evidence for guided checkout walkthrough</summary>

Open [the documentation guide](https://ding-ding-projects.github.io/tempdesk-/docs/#guided-workflows) or choose **Docs** in TempDesk Docs. These images were taken in the offline reader built from `9b4329b14b328b6b88301fd296bd0b3100994940`, in bilingual mode. The checklists record your own progress. See [Lab verification](#lab-verification) for the current status of the actual kiosk, directory and session hosts.

1. Choose **Get a guest sign-in** to open the kiosk checklist. Its link opens the illustrated kiosk walkthrough.

   ![Guest sign-in checklist selected with three steps](docs/evidence/guided-docs-9b4329b/01-choose-guest-sign-in.png)

2. After selecting a duration at the kiosk, mark the first step. The guide shows **1 of 3 steps marked** and keeps that mark when you switch tasks and return.

   ![Guest sign-in checklist showing one of three steps marked](docs/evidence/guided-docs-9b4329b/02-mark-guest-progress.png)

3. Choose **Verify Virtual Commons**, then **Desktop Experience session host**. Follow the checks for the session host, connection file, sign-in and expiry.

   ![Virtual Commons guide with Desktop Experience selected and three checkout checks](docs/evidence/guided-docs-9b4329b/03-select-desktop-experience.png)

4. Switch to **Check Server Core readiness** to see the separate requirements for that destination. Use **Configure Virtual Commons destinations** to open the relevant instructions.

   ![Virtual Commons guide showing the Server Core readiness checklist](docs/evidence/guided-docs-9b4329b/04-read-server-core-guidance.png)

The [capture inventory](docs/evidence/guided-docs-inventory.json) lists the exact source and executable hashes, image hashes, timestamps and viewport.

### Workstation checklist on the hosted guide

These three screenshots show the [published workstation guide](https://ding-ding-projects.github.io/tempdesk-/docs/?task=commons&variant=workstation#guided-workflows) built from `17f80f7668d84d8c12f6f8696155a3d7e2d9a51d`. The guide records each reader's progress on that device.

1. Open **Verify Virtual Commons** and choose **Prepare a single-seat Windows 11 workstation**. Its eight steps cover the network, installation media, guest setup, broker and checkout.

   ![Hosted Virtual Commons guide with the Windows 11 workstation selected and zero of eight steps marked](docs/evidence/workstation-guide-17f80f7/01-open-workstation-guide.png)

2. After reviewing the network instructions, mark that step. The guide shows **1 of 8 steps marked**.

   ![Hosted workstation checklist showing one of eight steps marked and keyboard focus on the network checkbox](docs/evidence/workstation-guide-17f80f7/02-mark-network-review.png)

3. Reopen the guide. The mark persists, including at a 360-pixel viewport.

   ![Narrow workstation guide at 360 pixels with the selected workstation and one of eight steps marked after reload](docs/evidence/workstation-guide-17f80f7/03-workstation-guide-360.png)

The [hosted capture inventory](docs/evidence/workstation-guide-17f80f7.json) records the actual build archive, screenshot hashes, viewport and browser actions. See [Lab verification](#lab-verification) for the native workstation and real checkout status.

### Reopen the live workstation guide

1. In the [published workstation guide](https://ding-ding-projects.github.io/tempdesk-/docs/?task=commons&variant=workstation#guided-workflows), focus a checklist item and press Space. This example marks the broker step to demonstrate how the guide records reader progress.

   ![Published workstation guide showing the keyboard-marked broker step and one of eight steps marked](docs/evidence/workstation-guide-fbb81ce/01-published-workstation-guide.png)

2. Open the linked workstation article and return to the guide. Reloading retains the mark. The narrow example shows the same selected workstation in bilingual mode.

   ![Bilingual workstation checklist at 320 CSS pixels with the single-seat workstation selected](docs/evidence/workstation-guide-fbb81ce/02-published-workstation-guide-narrow.png)

The [hosted interaction receipt](docs/evidence/workstation-guide-fbb81ce/receipt.json) also records a personal wording upload, an invalid replacement, and restoration of the shipped text. These actions ran locally in the browser.

</details>

## Browser attachment walkthrough

<details>
<summary>Steps and evidence for browser attachment walkthrough</summary>

The picker captures came from the kiosk build at `caddfb9c4e672ad59e3a8af8e7b7fd9386d5d2f0`. The confirmation and retry came from build `32128b6a4731ace51ae9e26e031ce8d96bbb99b9`. The browser used an isolated Samba directory and test destinations for both editions. See [Lab verification](#lab-verification) for native session sign-in and expiry.

For a dedicated single-seat desktop, choose **Kiosk Windows 11** when the operator has enrolled one. Its temporary sign-in and connection file use the same checkout flow. See [the workstation setup and checkout](docs/VIRTUAL-COMMONS.md#add-a-kiosk-windows-11-workstation).

1. In **Virtual Commons**, choose a finite duration and an available edition. The wide capture selects Desktop Experience. The 360 px capture selects Server Core and shows the wrapped checkout label.

   ![Virtual Commons on a wide screen with Desktop Experience and one hour selected](docs/evidence/virtual-commons-picker-caddfb9/choose-desktop-experience.png)

   ![Virtual Commons at 360 pixels with Server Core selected and the complete checkout button label](docs/evidence/virtual-commons-picker-caddfb9/choose-server-core.png)

2. Activate `Virtual Commons: Check out a computer`. When **Your sign-in is ready** appears, look for `Virtual-Commons.rdp` in the browser downloads.

   ![The guest kiosk confirms that the sign-in is ready after checkout](docs/evidence/virtual-commons-browser-32128b6/02-checkout-confirmation.png)

3. To save another copy, focus **Download Remote Desktop file** and press Enter. Both tested editions returned exactly the same file on retry.

   ![The Download Remote Desktop file button has keyboard focus](docs/evidence/virtual-commons-browser-32128b6/03-download-again.png)

The [attachment and layout receipt](docs/evidence/virtual-commons-attachments.json) records both automatic downloads, keyboard retries, removed test accounts, image hashes, and measured viewports.

</details>

## Virtual Commons wording walkthrough

<details>
<summary>Apply, replace, and clear personal wording in Virtual Commons</summary>

The built guest portal was exercised in English at desktop and emulated 360 px viewports. The example file contains synthetic wording. [Browser and image receipt](docs/evidence/virtual-commons-picker-outcomes-c2aec2e/receipt.json)

1. Verify an active guest sign-in under **Check my sign-in**, then return to **Virtual Commons** and choose your local wording file. The edition labels, unavailable marker, and checkout action reflect the active file.

   ![Virtual Commons applies sample wording to both editions and the checkout action](docs/evidence/virtual-commons-picker-outcomes-c2aec2e/01-applied-picker.png)

2. Choose a replacement file. If the file is invalid, the last valid wording stays active. The status describes the outcome, and the full clear action remains visible.

   ![The narrow picker keeps the previous wording and shows the complete clear button after a rejected file](docs/evidence/virtual-commons-picker-outcomes-c2aec2e/02-rejected-replacement.png)

3. Focus **Clear personal wording** and press Space to restore the shipped wording.

   ![Clearing the file restores the original picker labels and empty status](docs/evidence/virtual-commons-picker-outcomes-c2aec2e/03-cleared.png)

4. If checkout returns an application validation message, the upload control remains available while your wording access is active. Applying the file on that page also updates the message.

   ![The Virtual Commons validation message uses the active sample wording](docs/evidence/virtual-commons-picker-outcomes-c2aec2e/04-validation-wording.png)

</details>

## Guest Settings and action sounds

1. In the guest portal, select **Tools**, then **Settings**. Display and accessibility includes language, theme, motion, density, text size, contrast, focus and corner roundness.

   ![Guest Settings at desktop width showing the Settings search and the display controls](docs/evidence/guest-settings-3407f84/01-guest-settings.png)

2. Search for **Action sounds** or **Feedback**. The adjacent regex builder belongs to this search. Escape closes it and returns focus to its opener.
3. Focus the **Action sounds** checkbox and press Space to mute the cues. The browser saves the choice across reloads. School mode pauses cues and keeps the saved switch position.
4. Return to **Virtual Commons** after verifying a temporary sign-in. Choosing a valid personal wording file shows the applied result. Choosing an invalid replacement preserves the active wording and shows the rejection message. The visible result works with sound muted.

The [browser receipt](docs/evidence/guest-settings-3407f84/receipt.json) covers an isolated portal build in English. The cues were observed in the browser with its audio output muted. The [v1.0.126 deployment receipt](docs/evidence/portal-rollout-v126.json) records the live guest Settings response, keyboard and wording preferences, and its management export boundary. Live cue playback and the remaining Settings surfaces need separate acceptance.

### Use Settings on a narrow screen

1. At narrow widths, look for the full localized label above the Settings search field. Tab from the field through the regex toggle to the adjacent builder. The rebuilt controls each have a 48 CSS px touch area in the measured narrow layout.

   ![Bilingual guest Settings at 360 CSS pixels with the full search label and focus on the regex builder](docs/evidence/guest-settings-touch-6e7e000/01-narrow-bilingual-search.png)

2. At desktop width, the display controls fit in two columns. Escape closes the opened regex builder and restores focus to its opener.

   ![Guest Settings at desktop width with two display columns and visible keyboard focus on the regex builder](docs/evidence/guest-settings-touch-6e7e000/02-desktop-display-controls.png)

The [layout and interaction receipt](docs/evidence/guest-settings-touch-6e7e000/receipt.json) records 48 combinations of language, theme, viewport width, and emulated display scale from the isolated build at `6e7e0001a1eb0db3d04bb0d5a035362bd653bd11`. The [live rollout receipt](docs/evidence/portal-rollout-v126.json) records the same layout checks on v1.0.126. Physical touch input remains open.

## Personal wording walkthrough

<details>
<summary>Steps and evidence for personal wording walkthrough</summary>

These steps were captured in the signed-in management portal from the v1.0.80 source build, using an isolated browser and a sample JSON file. The [capture receipt](docs/evidence/management-wording-walkthrough.json) records the source revision, portal image, browser checks, and image hashes.

Use **Action sounds** under **Display and accessibility** to mute the local wording cues. The status and live announcement remain available when sound is off. School mode pauses cues without changing the saved choice.

1. In the management portal, open **Settings** and find **Personal wording**. Select **Choose File** and pick your JSON file.

   ![Personal wording in Settings with a sample JSON file selected](docs/evidence/management-wording-c70b63d/01-select-a-wording-file.png)

2. Choose **Apply wording**. The example heading changes to **Local labels** and Settings shows that personal wording is active in this browser tab.

   ![The sample wording applied and the browser-tab status shown](docs/evidence/management-wording-c70b63d/02-apply-wording.png)

3. Reload the same browser tab while signed in. Open **Settings** again if needed. The custom heading and active status are still there.

   ![The custom heading and active status after reloading the same tab](docs/evidence/management-wording-c70b63d/03-reload-the-same-tab.png)

4. Choose the **Clear** button with **restore original wording** in its label. Settings restores its original heading and confirms that the wording was cleared.

   ![The original Settings wording restored and the clear status shown](docs/evidence/management-wording-c70b63d/04-clear-and-restore.png)

In TempDesk Deployer and Answer File Studio, personal wording changes interface copy. New workspace history, exported logs, copied progress steps and suggested version names use original labels. Deployment names, field values and paths stay literal. In an export dialog, choose a format to open the save dialog, or dismiss the dialog to cancel.

Deployer keeps notification message keys and literal values in memory. The open notification drawer updates its text and search results when personal wording is applied or cleared. A successful import plays the Windows tada cue after the wording is saved. A rejected wording drop plays the invalid-input cue and leaves the current wording in place. Both use the existing sound switch and volume.

</details>

## Management action sounds walkthrough

<details>
<summary>Steps and evidence for management action sounds walkthrough</summary>

These images come from the running management portal at `c4cf03ed5ae7b0cd42e2f24cb33095d2972c4f71`, using a separate test directory. The [capture and interaction inventory](docs/evidence/management-sounds.json) records the source, image hashes, geometry and browser results.

1. Open **Settings** and search for **Action sounds**. The result is under **Display and accessibility**.

   ![Settings search finds Action sounds with the checkbox checked](docs/evidence/management-sounds-c4cf03e/01-find-action-sounds.png)

2. Focus the checkbox and press **Space** to mute the cues. **Saved in this browser** confirms the choice. The wording result is still displayed and announced.

   ![The unchecked Action sounds box has keyboard focus and a saved confirmation](docs/evidence/management-sounds-c4cf03e/02-turn-sounds-off.png)

3. When school mode is active, the notice explains that sounds are paused. A checked box still shows the saved choice for when school mode ends.

   ![School mode silences sounds and keeps the Action sounds box checked](docs/evidence/management-sounds-c4cf03e/03-school-pauses-cues.png)

</details>

## Management notification walkthrough

<details>
<summary>Steps and evidence for management notification walkthrough</summary>

The signed-in management portal at `d986ca134da5c7833f165e7e16fdfba0a0505a8c` was tested with a separate sample directory. The [capture and interaction receipt](docs/evidence/management-notifications.json) records the image hashes, source revision and 48 measured language, theme, width and scale combinations.

1. Open the **Notifications** bell and search for **Saved in this browser**. The matching entry remains in history after the toast is dismissed.

   ![Notification search finds the dismissed settings message](docs/evidence/management-notifications-d986ca1/01-search-history.png)

2. Open **Actions**, focus a matching row and press **Space** to select it. At 360 px, the panel keeps the selection count and the matching row in view. Use **Export matches** when you want a JSON copy of the current filter.

   ![The selected notification and bulk actions at 360 pixels](docs/evidence/management-notifications-d986ca1/02-select-a-match.png)

3. Choose **Delete selected** and review the affected row. Check both acknowledgements, move confirmation to 100 percent, then choose **Delete** to finish. With only the first box checked, the slider and Delete stay disabled. Press **Escape** to cancel and return focus to **Delete selected**.

   ![One checked review control leaves the slider and Delete button disabled](docs/evidence/management-notifications-d986ca1/03-review-confirmation.png)

</details>

## Configure HTTPS in Portal Host

1. Check Docker and Compose, then select an accepted publication receipt and your configuration directory. In **Configuration**, choose **HTTPS** and enter the certificate name.

   ![Portal Host HTTPS setup with separate guest and management certificate controls](docs/evidence/portal-host-https-a8fce85/01-https-configuration.png)

2. Select the certificate and matching private key for each portal. Choose an issuer bundle when using a private issuer. At a narrow width, scroll to reach the same controls and the verification button.

   ![Bilingual Portal Host HTTPS setup at 360 pixels with all certificate selectors in the scrolling form](docs/evidence/portal-host-https-a8fce85/02-https-bilingual-narrow.png)

3. Choose **Verify certificates and continue**, select the LAN address and review both endpoint candidates. Start the deployment. The guest link and management link appear as their respective endpoint checks pass.

The screenshots show the locally built v1.0.133 wizard with an example name and no files selected. A separate isolated deployment verified both HTTPS endpoints, saved-project recheck, and a temporary guest sign-in. [HTTPS setup and recovery](docs/features/http-api/portal-https.md#use-the-portal-host-wizard) · [Runtime receipt](docs/evidence/portal-host-https-a8fce85/receipt.json)

## Recheck a hosted deployment

1. Reopen Portal Host with the local profile that started the deployment. Choose **Check Docker and Compose**.
2. Confirm the saved project and release on the opening step. Choose **Recheck endpoint health**.
3. Open the guest or management portal when its fresh health check succeeds. The wizard checks the existing containers without pulling an image or starting services.

<details>
<summary>See the saved project on desktop and at 360 px</summary>

![Portal Host showing the saved project and enabled Recheck endpoint health action](docs/evidence/portal-host-reopen-ff5b6b4/portal-host-reopen-desktop.png)

![Narrow bilingual Portal Host view with the saved project and visible health recheck action](docs/evidence/portal-host-reopen-ff5b6b4/portal-host-reopen-narrow.png)

</details>

The screenshots show the locally built wizard with a synthetic project. A separate live replay verified both portal roles after reopening, with the same container IDs and start times. [Build and verification receipt](docs/evidence/portal-host-reopen-ff5b6b4/receipt.json)

## Standalone offline documentation

<details>
<summary>Steps and evidence for standalone offline documentation</summary>

Open **TempDesk Docs** to browse the guides, search the documentation and read the operator wiki offline. The [portable executable in v1.0.73](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.73) ran from an otherwise empty folder. Searching for **Configure the destinations** opened the Virtual Commons guide, and the sidebar opened the prepared wiki.

![TempDesk Docs showing Virtual Commons and operator wiki search results offline](docs/evidence/standalone-docs-v1.0.73/documentation-search.png)

The [evidence inventory](docs/evidence/standalone-docs-inventory.json) records the released executable, capture hash and viewport. See [Read the documentation offline](docs/OFFLINE-GUIDE.md) for navigation and build instructions.

</details>

### Open School mode in the offline reader

Open **TempDesk Docs**, open the offline guide, then choose **Settings**. Scroll to **School mode**. The local v1.0.135 reader read the shared setting and displayed **Off** and **Enable** at 1440 and 360 pixels.

![Offline reader Settings showing School mode off and the Enable button](docs/evidence/offline-school-e13efa0/school-settings-wide.png)

![School mode and Enable in offline reader Settings at 360 pixels](docs/evidence/offline-school-e13efa0/school-settings-narrow.png)

The run used an isolated profile and left the mode off. PIN changes and cross-application transitions remain pending. [Visual evidence inventory](docs/evidence/offline-school-e13efa0/inventory.json)

### Use personal wording in the offline reader

1. Choose **Bilingual** in Settings, then drop a valid wording JSON file into TempDesk Docs. The reader saves the new wording locally and shows English and Cantonese while the previous control keeps focus.

   ![Offline reader showing the applied confirmation in English and Cantonese](docs/evidence/offline-wording-locales-117d962/01-bilingual-wording-applied.png)

2. Drop an invalid file. The previous wording stays active. Focus **Dismiss** and press Enter to close the notice and return to the prior control.

   ![Narrow offline reader showing the bilingual invalid-file notice and Dismiss button](docs/evidence/offline-wording-locales-117d962/02-bilingual-rejection-narrow.png)

3. Open **Settings** to choose a replacement, turn off **Action sounds**, or select **Clear** to restore the original wording. After a rejected selection, close Settings to return to the dismissible notice.

The [language and layout receipt](docs/evidence/offline-wording-locales-117d962/receipt.json) binds the views to the local portable build and records all 48 combinations. The [earlier reader receipt](docs/evidence/offline-wording-328bb97/receipt.json) records the English workflow, reload, clear, and audio checks from its own build.

## Offline checkout guide

<details>
<summary>Steps and evidence for offline checkout guide</summary>

TempDesk Deployer [v1.0.65](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.65) opened the bundled operator wiki and moved focus to **Verify a checkout** in the bundled Virtual Commons guide. The image was captured on November 18, 2026 at 10:06:09 UTC on an isolated desktop, using a 1440 × 1000 viewport at emulated device scale 1 in dark mode. The [evidence inventory](docs/evidence/offline-reader-inventory.json) records the released executable and capture hashes. The image shows the guide and heading focus. Guest session acceptance is tracked separately.

![Offline TempDesk Deployer reader focused on Verify a checkout](docs/evidence/deployer-v1.0.65/checkout-guide.png)

</details>

## Fresh VMware lab provisioning

<details>
<summary>Steps and evidence for fresh vmware lab provisioning</summary>

These earlier captures show Server 2025 Core and the Windows 11 client during unattended setup for source revision `5fb4e0235d1d0a8fe2d428e0af1cdd4ad34677f5`. Both were captured from their VMware consoles at 1024 × 768. The subsequent controller and kiosk checks are recorded in [Lab verification](#lab-verification).

| Server setup | Guest setup |
| --- | --- |
| ![Windows Server setup at 20 percent](docs/evidence/fresh-lab/server-setup.png) | ![Windows 11 setup at 30 percent](docs/evidence/fresh-lab/guest-setup.png) |

</details>


## Evidence and delivery

The walkthroughs above preserve earlier source-bound captures. A current end-to-end recording and refreshed captures for the current candidate are pending. See the [verification inventory](docs/FEATURE-INVENTORY.md), [roadmap](ROADMAP.md) and [verification handoff](HANDOFF.md).

<details>
<summary>Published line count and implementation estimate</summary>

The [v1.0.89 release](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.89) reports 91,175 nonblank lines from `scripts/line-counts.ps1`. Its count excludes the generated unattended settings catalogue and package lockfiles. The published total still includes tests, documentation and other generated or machine-maintained files.

A human implementation estimate remains pending. The release provides neither a hand-written source subtotal nor author attribution. The estimate will use that subtotal divided by a stated sustainable daily rate, then apply any stated review or integration multiplier. The aggregate above cannot supply the hand-written subtotal.

</details>

<details>
<summary>Sanitized shared workflow summary</summary>

Review the product and verification scope before editing. Make a focused change, preserve unrelated work and document the exact verification performed. Keep credentials and deployment details out of source, logs and captures. See the [contribution guide](CONTRIBUTING.md) and [repository instructions](AGENTS.md).

</details>
