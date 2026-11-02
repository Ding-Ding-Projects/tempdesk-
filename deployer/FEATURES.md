# TempDesk Deployer feature status

Status values: **implemented** (built and exercised), **partial** (works with the stated gap),
**not done** (with the reason). "Verified" says how it was checked. The app was built and run on
Linux (Electron under Xvfb); nothing here was run on Windows, so every Windows-only path
(PowerShell 5.1, WinRM, UAC, IMAPI2FS, Squirrel, OpenSSH on Windows, Windows sounds) is
**unverified on Windows** until the CI and release workflows run.

## Deployment

| Feature | Status | Notes and verification |
| --- | --- | --- |
| Answer file generation (server, guest PC, custom) | implemented | Pure functions in `engine/AnswerFile.psm1`. Pester tests check well-formed XML, the disk layouts, image index, specialize and oobeSystem nodes, and byte-for-byte equality with the shared JavaScript generator (`site/assets/answer.js`) for four fixtures. |
| Windows password encoding | implemented | base64(UTF-16LE(password + "AdministratorPassword")) and (password + "Password"); round-trip and known-value tests. |
| Media folder and zip kit | implemented | `TempDesk/` with FirstLogon.ps1, Continue-Setup.ps1, SetupStatus.ps1, firstboot.json, server/, agent/, client/ and portal/ (native portals only). Local `.env` files, caches and tests are excluded. Tested headless (`-Phase Media -NoIso`). |
| ISO with IMAPI2FS (ISO9660 + Joliet + UDF, label TEMPDESK) | partial | Implemented; Windows-only, not run here. |
| Disk 0 wipe warning with super confirmation | implemented | Red notice, type WIPE and hold 1.5 s, before media is built, before Build ISO and before Write to USB. |
| Unattended server monitor over WinRM | partial | Polls `setup-status.json` and maps stages (unit tested); the remoting itself is not run here. |
| TrustedHosts through the Windows consent prompt | partial | Separate elevated helper started with `Start-Process -Verb RunAs`; a cancelled prompt is reported as incomplete. Not run here. |
| Advanced deploy to an existing server | partial | Resumable steps (copy, forest, ADWS wait, Initialize-TempDesk, agent install, keys, env files). Not run here. |
| TempDesk Lite over SSH | partial | ssh/scp with BatchMode, key generation, console for the first connection, samba/.env and the password as a chmod 600 secret over stdin. Env generation and quoting are unit tested; SSH is not run here. |
| Portal env files | implemented | `portal/.env.guest`, `.env.admin`, `streaming/.env` from agent.json; unit tested. |
| Protected deployment folder | partial | ACL limited to the current user on Windows (mode 700 elsewhere); the ACL code is not run here. |
| Portals with Docker, links and QR | implemented | QR encoder matches a reference implementation bit for bit (14 vectors in tests); Docker start not run here. |
| Saved deployments, health check, open admin console, re-run, update payload, uninstall agent | implemented | Health check is plain-HTTP only (HTTPS agents are checked from the admin console, which pins the certificate). |
| Progress UI: steps, live log, cancel, resume, recovery hint | implemented | JSON-lines protocol parsed in the main process; seen running in the smoke test. |
| Secrets never on disk, command lines or logs | implemented | Passed as child environment variables; a test runs a stand-in PowerShell and checks argv, the config file and the log. Exception by design: the unattended media must contain the DSRM password (plain) and the Administrator password (unattend encoding); the UI warns to erase the media. |

## Standard desktop features

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| 1 | First-run onboarding | implemented | Path choice, real prerequisite checks (PowerShell, OpenSSH, Docker, Git, network), Back/Next, skip, saved step, opens the workspace. |
| 2 | Language modes (English, Cantonese, bilingual) | implemented | `deployer/i18n/en.json` and `zh-HK.json` generated from one table (`build_catalogs.py`) so keys are identical; tests check key parity and that every key used exists. The hosted studio uses the website's catalogs. |
| 3 | Funny level 0 to 3 | implemented | Only tone-variant keys change; `err.`, `warn.`, `sec.`, `confirm.`, `danger.`, `update.` keys always use level 0 (tested). |
| 4 | Personal wording (upload and drop anywhere) | implemented | Validated in full by the shared strict validator (duplicate keys, depth, sizes, reserved keys, control characters); applied to interface templates only, never to arguments such as host names, paths or logs (tested). Celebration (headline from "private vocabulary"), tada and invalid sounds, never logged or exported (excluded from backups). PowerShell twin validator `engine/Vocabulary.psm1` with Pester tests. |
| 5 | School mode | implemented | Renamable, forces English, hides funny level and personal wording; salted PBKDF2-SHA256 PIN in `%LOCALAPPDATA%\TempDesk\shared\school.json` (tested). Documented as a convenience lock. |
| 6 | Action sounds with switch and volume | partial | Plays Windows Media sounds read through the main process; no sounds on other systems. |
| 7 | Rename the app | implemented | Title bar, window title (taskbar) and About. |
| 8 | Appearance editor | implemented | Hue/saturation wheel (pointer and keyboard), hex, contrast check, radius, density, text scale 90 to 160 percent, light/dark/system, title bar logo. |
| 9 | Command palette (Ctrl+Shift+F) | implemented | Pages, tabs, actions, live setting toggles, every labelled control on the page and every studio setting; teleport focuses and pulses the control. |
| 10 | Regex builder beside search boxes | implemented | Plain by default, regex toggle, token helper, live counts, invalid-pattern message. Present in the palette, deployments, history, notifications, settings, docs, changelog, recent files and Base64 history; the studio has its own search bars from the website. |
| 11 | Context menus with shortcuts | implemented | Rail, tabs, list items, steps, history entries, Base64 history; Shift+F10 and the Menu key open them. |
| 12 | Browser-style deployment tabs | implemented | Open, close, middle-click close, drag and keyboard reorder, restore on restart. |
| 13 | Info buttons and one-line explanations | implemented | Every setting row and the non-obvious deploy fields; settings search covers labels, help and keywords. |
| 14 | Two-key super confirmation | implemented | Type the exact word and hold 1.5 s (pointer or Space). |
| 15 | Local version history | implemented | Git workspace (or JSON lines fallback): list, search, per-file coloured diff, compare two versions, restore as a new commit. |
| 16 | Exports (JSON, CSV, HTML) | implemented | Deployment configs without secrets, logs, inventory; CSV formula-injection guard and HTML escaping are tested. |
| 17 | Notifications and centre | implemented | Toasts plus a searchable history drawer. |
| 18 | Changelog viewer and offline docs | implemented | Bundled `CHANGELOG.md` and docs rendered with textContent only (no HTML injection), with search and highlighting. |
| 19 | Version and build provenance | implemented | Version, commit SHA and build UTC time baked by `prepare-bundle.js`, shown on the Deploy page, the title bar tooltip and About. |
| 20 | Accessibility | partial | Keyboard navigation, labels on controls (smoke test lists unlabelled controls on every page: none), focus rings, forced-colors support, text scale to 160 percent in the app. Not audited with a screen reader; 200 percent Windows text scaling was not tested. |
| 21 | Truthful empty states | implemented | Empty deployments, portals, history, notifications, docs and changelog say what is missing; no sample data. |

## Owner additions

| Feature | Status | Notes |
| --- | --- | --- |
| Download answer file kit (.zip) | implemented | Media phase writes `TempDesk-answer-kit.zip`; the studio's own Build kit button also works in the app. |
| Answer File Studio in the desktop app | implemented | The website's studio page and modules are bundled unchanged (generated `studio.html`) with a desktop shim; smoke test confirms it loads, builds XML and answers palette searches. |
| Studio desktop extras | partial | File menu (New blank answer file, Open, Recent, Save, Save as; .xml files and New blank load the studio with `?mode=direct`, so they use Direct mode once the website ships it; Direct mode was not yet in `site/assets/` when this was written), recent files, file watching, Git branch per variant (switch and create), Build ISO, write to USB (copies the kit, no formatting; replacing an existing answer file needs a second confirmation), drop a driver folder. ISO, USB and drive listing are Windows-only and not run here. Driver drop needs the Custom template. Real disk sizes from USB/VHD are listed by `disks:list` but not yet shown in the disk canvas. |
| Import and export everywhere | implemented | Deployments (all-or-nothing import), settings, backup bundle (.zip) with full validation before restore; answer files and presets through the studio. |
| Git history with remote push | implemented | Workspace repo at `%LOCALAPPDATA%\TempDesk\workspace`, TempDesk author unless git config has one, remote URL without credentials (Git Credential Manager signs in). |
| Unlimited undo and redo, every action a commit | implemented | Undo/redo/restore are new commits derived from trailers in the log; typing coalesces per field (1 s idle or blur). Tests cover coalescing, undo/redo after restart, jump-to and no secrets in commits, on both backends. Studio edits are mirrored into the workspace; inside the studio, Ctrl+Z uses the studio's own history. |
| Tools > Base64 (`base64-tools`) | implemented | Shared codec; files streamed in constant memory with progress, pause, resume, cancel, SHA-256 verification and atomic output; strict/lenient, variants, encodings, data URLs, magic-byte detection with a safe preview, history with opt-in payloads, bulk zip export. Tested with a 3 MiB file, strict offsets, overwrite rules and cancel. |

## Packaging

| Feature | Status | Notes |
| --- | --- | --- |
| build.bat and build-installer.bat | partial | Real exit codes and /s; not run here (Windows only). Electron packaging was verified with a Linux `dir` build. |
| Squirrel.Windows installer, unsigned | partial | Squirrel 2.0.1 tools pinned by SHA-256; signtool removed from the vendor folder; Setup.exe checked for NotSigned with Get-AuthenticodeSignature. Not run here. |
| Auto-update banner | partial | Update.exe check/download/update with an "unsigned" banner and no forced restart; parsing is unit tested, the update itself is not. |
| App icon | partial | `scripts/make-icon.ps1` (System.Drawing, Windows) writes the multi-size .ico at build time; the SVG is `deployer/assets/tempdesk.svg`. The .ico was not generated here. |
| Release and CI workflows | partial | YAML validated; not run. |
