# TempDesk

Temporary, self-service sign-ins for shared Windows computers, on an Active Directory domain that deploys itself.

Anyone on your network opens the guest portal, gets a username and password for 1 hour, 4 hours, a day, a week or until they delete it, and uses the computer as a normal user. When time is up TempDesk warns them, signs them out, and deletes the account and its files.

## What is in the box

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
| **TempDesk Docs** | The website's guides, operator wiki, search and browser tools in a standalone executable for offline reference. [Open the offline documentation guide](docs/OFFLINE-GUIDE.md). |

## Quick start

Use the [guided documentation](https://ding-ding-projects.github.io/tempdesk-/docs/#guided-workflows) to choose a directory, verify a guest sign-in, or check a Virtual Commons destination. The checklists save your marks locally as you work. See the [live kiosk walkthrough](#guest-sign-in-walkthrough) and [guided checkout walkthrough](#guided-checkout-walkthrough) for illustrated steps, and the [verification inventory](docs/FEATURE-INVENTORY.md) for coverage by surface. Operators can follow the [Virtual Commons host setup](docs/VIRTUAL-COMMONS.md#prepare-the-desktop-experience-host) before publishing a session destination.

1. Open the Answer File Studio (website or Deployer), pick the **TempDesk server** template, fill in names, network and passwords, and build the kit.
2. VMware Workstation on this PC: in the Deployer, drop the Windows Server 2025 ISO on **Step 1b** and click **Create the virtual machine and start the install**; the app makes the machine, attaches both ISOs, starts it and presses the boot key. Any other hypervisor: attach the kit ISO as a second CD next to the Windows Server 2025 ISO. Bare metal: copy the kit to the root of the USB stick that holds the Windows installer. **Disk 0 is erased.**
3. Boot. Setup installs Windows Server Core, creates the domain and installs TempDesk. The server's sign-in screen says **TempDesk is ready** with the addresses when it finishes.
4. Erase the kit media: it contains the passwords.
5. Start the portals (`portal/compose.yaml`) or choose native portals in the template, then join the shared PCs to the domain.

Prefer Linux? Use **TempDesk Lite**: see `samba/README.md`.

## See it work, click by click

Every picture below is a capture of the real built software, taken while it was driven for this test. The control that was clicked or typed into is outlined in red. Passwords, this PC's name and its network address are covered.

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

1. Open the guest kiosk. Select **1 hour** and choose **Create my sign-in**.

   ![Guest kiosk with the one-hour duration selected](docs/evidence/guest-sign-in-3a18b69/01-choose-duration.png)

   ![Guest kiosk with the one-hour duration selected at 360 pixels wide](docs/evidence/guest-sign-in-3a18b69/01-choose-duration-narrow.png)

2. Read the one-time confirmation and note the expiry. The images show the confirmation heading and timer outside the credential panel.

   ![Your sign-in is ready confirmation](docs/evidence/guest-sign-in-3a18b69/02-sign-in-ready.png)

   ![One-hour test account expiry countdown](docs/evidence/guest-sign-in-3a18b69/03-expiry-countdown.png)

3. Open **Check my sign-in** and enter the credentials from the confirmation. The example account returned **Active** with its expiry time.

   ![Check my sign-in shows the test account is active](docs/evidence/guest-sign-in-3a18b69/04-active-sign-in.png)

4. To end the sign-in early, open **Delete my sign-in**, enter the credentials and confirm. The kiosk showed the deletion confirmation and the lab directory lookup confirmed that the test account was gone.

   ![Guest kiosk confirms deletion of the test account](docs/evidence/guest-sign-in-3a18b69/05-test-sign-in-deleted.png)

The [capture inventory](docs/evidence/guest-sign-in-inventory.json) records the running container image, source revision, viewports, timestamps and file hashes. The [prior portal captures](docs/evidence/portal-history.md) retain their original provenance.

### Lab verification

Server Core responded as a synchronized Active Directory domain controller with a ready global catalog. Its native TempDesk agent returned a healthy response for the Windows backend. The kiosk walkthrough used the lab's Samba directory and verified temporary account creation, credential validation, one-time confirmation and self-deletion. The management sign-in page also answered from the test network.

A separate one-hour kiosk account had a configured expiry of 11:47:52 UTC on November 18, 2026. The lab directory confirmed the record was absent at 11:50:37 UTC.

Windows 11 domain membership and desktop sign-in, temporary account creation through the native Windows backend, and Remote Desktop checkout to a session host remain unverified. See [Verify a checkout](docs/VIRTUAL-COMMONS.md#verify-a-checkout).

## Guided checkout walkthrough

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

## Browser attachment walkthrough

The picker captures came from the kiosk build at `caddfb9c4e672ad59e3a8af8e7b7fd9386d5d2f0`. The confirmation and retry came from build `32128b6a4731ace51ae9e26e031ce8d96bbb99b9`. The browser used an isolated Samba directory and test destinations for both editions. See [Lab verification](#lab-verification) for native session sign-in and expiry.

1. In **Virtual Commons**, choose a finite duration and an available edition. The wide capture selects Desktop Experience. The 360 px capture selects Server Core and shows the wrapped checkout label.

   ![Virtual Commons on a wide screen with Desktop Experience and one hour selected](docs/evidence/virtual-commons-picker-caddfb9/choose-desktop-experience.png)

   ![Virtual Commons at 360 pixels with Server Core selected and the complete checkout button label](docs/evidence/virtual-commons-picker-caddfb9/choose-server-core.png)

2. Activate `Virtual Commons: Check out a computer`. When **Your sign-in is ready** appears, look for `Virtual-Commons.rdp` in the browser downloads.

   ![The guest kiosk confirms that the sign-in is ready after checkout](docs/evidence/virtual-commons-browser-32128b6/02-checkout-confirmation.png)

3. To save another copy, focus **Download Remote Desktop file** and press Enter. Both tested editions returned exactly the same file on retry.

   ![The Download Remote Desktop file button has keyboard focus](docs/evidence/virtual-commons-browser-32128b6/03-download-again.png)

The [attachment and layout receipt](docs/evidence/virtual-commons-attachments.json) records both automatic downloads, keyboard retries, removed test accounts, image hashes, and measured viewports.

## Personal wording walkthrough

These steps were captured in the signed-in management portal from the v1.0.80 source build, using an isolated browser and a sample JSON file. The [capture receipt](docs/evidence/management-wording-walkthrough.json) records the source revision, portal image, browser checks, and image hashes.

1. In the management portal, open **Settings** and find **Personal wording**. Select **Choose File** and pick your JSON file.

   ![Personal wording in Settings with a sample JSON file selected](docs/evidence/management-wording-c70b63d/01-select-a-wording-file.png)

2. Choose **Apply wording**. The example heading changes to **Local labels** and Settings shows that personal wording is active in this browser tab.

   ![The sample wording applied and the browser-tab status shown](docs/evidence/management-wording-c70b63d/02-apply-wording.png)

3. Reload the same browser tab while signed in. Open **Settings** again if needed. The custom heading and active status are still there.

   ![The custom heading and active status after reloading the same tab](docs/evidence/management-wording-c70b63d/03-reload-the-same-tab.png)

4. Choose the **Clear** button with **restore original wording** in its label. Settings restores its original heading and confirms that the wording was cleared.

   ![The original Settings wording restored and the clear status shown](docs/evidence/management-wording-c70b63d/04-clear-and-restore.png)

## Standalone offline documentation

Open **TempDesk Docs** to browse the guides, search the documentation and read the operator wiki offline. The [portable executable in v1.0.73](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.73) ran from an otherwise empty folder. Searching for **Configure the destinations** opened the Virtual Commons guide, and the sidebar opened the prepared wiki.

![TempDesk Docs showing Virtual Commons and operator wiki search results offline](docs/evidence/standalone-docs-v1.0.73/documentation-search.png)

The [evidence inventory](docs/evidence/standalone-docs-inventory.json) records the released executable, capture hash and viewport. See [Read the documentation offline](docs/OFFLINE-GUIDE.md) for navigation and build instructions.

## Offline checkout guide

TempDesk Deployer [v1.0.65](https://github.com/Ding-Ding-Projects/tempdesk-/releases/tag/v1.0.65) opened the bundled operator wiki and moved focus to **Verify a checkout** in the bundled Virtual Commons guide. The image was captured on November 18, 2026 at 10:06:09 UTC on an isolated desktop, using a 1440 × 1000 viewport at emulated device scale 1 in dark mode. The [evidence inventory](docs/evidence/offline-reader-inventory.json) records the released executable and capture hashes. The image shows the guide and heading focus. Guest session acceptance is tracked separately.

![Offline TempDesk Deployer reader focused on Verify a checkout](docs/evidence/deployer-v1.0.65/checkout-guide.png)

## Fresh VMware lab provisioning

These earlier captures show Server 2025 Core and the Windows 11 client during unattended setup for source revision `5fb4e0235d1d0a8fe2d428e0af1cdd4ad34677f5`. Both were captured from their VMware consoles at 1024 × 768. The subsequent controller and kiosk checks are recorded in [Lab verification](#lab-verification).

| Server setup | Guest setup |
| --- | --- |
| ![Windows Server setup at 20 percent](docs/evidence/fresh-lab/server-setup.png) | ![Windows 11 setup at 30 percent](docs/evidence/fresh-lab/guest-setup.png) |
