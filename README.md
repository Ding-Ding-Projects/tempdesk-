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

## Quick start

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
