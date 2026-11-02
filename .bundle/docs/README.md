# TempDesk

Temporary, self-service sign-ins for shared Windows computers, on an Active Directory domain that deploys itself.

Anyone on your network opens the guest portal, gets a username and password for 1 hour, 4 hours, a day, a week or until they delete it, and uses the computer as a normal user. When time is up TempDesk warns them, signs them out, and deletes the account and its files.

## What is in the box

| Part | What it does |
| --- | --- |
| **Answer File Studio** | Builds `autounattend.xml` kits that install Windows Server 2025 Core, create the domain, and set up TempDesk with no further clicks. Covers every one of the 1,288 settings in Microsoft's unattend reference, with canvases for setup passes, disks and commands, two-way XML editing, 56 validation rules (28 with quick fixes), templates, compare, simulate and unlimited undo. Runs in the browser (website) and in the desktop app. |
| **TempDesk Deployer** (`deployer/`) | Desktop app for Windows: answer files, ISO and USB kits, monitoring the unattended install, deploying TempDesk Lite over SSH, starting the portals. Git-backed history with unlimited undo. |
| **Server setup** (`server/`) | Unattended first boot, forest creation, OUs, groups, Group Policy, AD Recycle Bin, guest reaper, optional native portals, app host for streaming. |
| **TempDesk Agent** (`agent/`) | Windows service on the domain controller exposing `docs/API.md`: guests, every directory object and attribute, Group Policy including every Administrative Template and security setting, a cmdlet runner, and Windows Admin Center style server management. |
| **TempDesk Lite** (`samba/`) | The same API on a Samba 4 domain controller in Docker, for when you do not want a Windows Server license. |
| **Guest portal and admin console** (`portal/`) | One Docker image, two modes. The admin console manages everything the agent can do, with imports and exports, undo backed by Git, Base64 tools, English and Cantonese. |
| **App streaming** (`streaming/`) | Stream RemoteApps to the browser through Apache Guacamole, or download `.rdp` files. |
| **Client scripts** (`client/`) | Run on shared PCs: Wi-Fi profiles, Chrome, developer tools and AI apps, sign-out at expiry, profile cleanup. |
| **Website** (`site/`) | Landing page, Answer File Studio, Base64 toolkit, feature articles and docs. |

## Quick start

1. Open the Answer File Studio (website or Deployer), pick the **TempDesk server** template, fill in names, network and passwords, and build the kit.
2. VMware: attach the kit ISO as a second CD next to the Windows Server 2025 ISO. Bare metal: copy the kit to the root of the USB stick that holds the Windows installer. **Disk 0 is erased.**
3. Boot. Setup installs Windows Server Core, creates the domain and installs TempDesk. The server's sign-in screen says **TempDesk is ready** with the addresses when it finishes.
4. Erase the kit media: it contains the passwords.
5. Start the portals (`portal/compose.yaml`) or choose native portals in the template, then join the shared PCs to the domain.

Prefer Linux? Use **TempDesk Lite**: see `samba/README.md`.

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
