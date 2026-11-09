# Changelog

All notable changes to TempDesk. Release builds of TempDesk Deployer are numbered
`major.minor.<workflow run>`; the release notes on GitHub list each build.

## [Unreleased]

### Added

- Deployer: **VMware virtual machine** step on the Deploy page. Choose or drop the Windows Server ISO
  and the app creates a VMware Workstation virtual machine with an empty disk, attaches the Windows
  ISO and the answer ISO, starts it and presses the key for the "Press any key to boot from CD or DVD"
  prompt, so the unattended install starts with no clicks. Engine phase `Vm`.
- Deployer: **Your TempDesk virtual machines** list on the Deploy page: state, start, power off, open in
  VMware, show the screen and delete (with confirmation). Only machines TempDesk created are listed.

### Fixed

- Deployer: edits on the Deploy page are all kept. After the first saved change every later change was
  written to a stale copy and lost, so the media and the deployment used the old values.
- Deployer: passwords typed after renaming the deployment are accepted, and the NetBIOS box follows the
  domain name on screen.
- Deployer: the finished steps and the log stay on screen after the media is built.
- Deployer: information lines in the live log are readable (they were drawn as tiny round buttons).
- Windows agent: guest sign-ins can be created. The random number helper looped forever whenever
  the range divided 2^32 exactly, which the 8-character digit alphabet always did, so password
  generation never finished. The PowerShell host also starts now (it was created with a null host).
- Server setup: the unattended install no longer stops at the Group Policy stage with "The network
  path was not found"; policy files are written through the local SYSVOL folder on the domain controller.
- Server setup: files copied from the install CD lose their read-only flag, so setup can remove the
  passwords from `firstboot.json` and report ready.
- Server setup: continuing after a failure works; the agent installer stops the running service
  before replacing its executable.
- Native portals: the guest portal and admin console start (the runner used an entry point that does
  not exist), and installing again restarts them.
- Firewall: the agent and native portal ports are also allowed on the Public profile for the local
  subnet. A new Windows Server 2025 domain controller can stay on that profile, where the Domain and
  Private rules did not apply and nothing on the network could reach TempDesk.
- Deployer: running any phase a second time for the same deployment no longer stops with
  `SeSecurityPrivilege` before the first step.
- Deployer: after a TempDesk Lite deployment the portal settings now use the agent's HTTPS address
  with its certificate fingerprint, and the health check reaches the Lite agent with the saved key.
- Guest portal: the header controls fit phone screens (checked at 390 and 320 px).
- `build.bat` and `build-installer.bat` work when started from PowerShell 7.
- Website tests pass on Windows.

### Added

- Answer File Studio: rich controls for every setting. Each of the 1,029 catalog settings now has a
  matching control (switches, segmented buttons, option cards, searchable time zone and locale lists
  with the live UTC offset, IP and CIDR fields, size and duration fields with live previews, product
  key boxes with generic edition keys, command line editor, colour picker and more), a written
  description, the meaning of the current value, risk badges, related settings and an Unset button.
  Search also matches descriptions and value meanings.
- Search with a regex builder everywhere on the website and in TempDesk Deployer. A shared,
  dependency-free module (`site/assets/regex-builder.js`, also an ES module, a classic script and
  its own evaluation worker) gives every search field plain text by default, a `.*` toggle and an
  anchored Builder popover: guided tokens inserted at the cursor, a highlighted pattern editor
  with the error underlined, flags and whole word options with plain explanations, a live sample
  with matches, count and capture groups, a token by token explanation, copy, copy as JavaScript,
  export as JSON and a gallery of common patterns (IPv4, email, GUID, date, Windows path, guest
  user names, SID, MAC). Patterns are JavaScript RegExp, limited to 2,000 characters, evaluated in
  a worker with a 250 ms timeout, refused when they nest repeats unless overridden, and never
  saved. Lists that had no search now have their own: the studio Explorer, Tools, inspector,
  Problems, Output and XML panels, the XML editor search (Ctrl+F), menus, galleries, Compare, Simulate, Secrets, list editors,
  the deployment map, docs navigation and tables, the settings panel, Base64 file jobs, and in the
  Deployer the run steps and log, deployment details, help, settings and pickers. Open tabs in
  the studio and the Deployer get "Close tabs containing text" and "Close tabs not containing
  text" with a preview count, an empty search guard and protection for tabs with work in progress.
  Catalogues (`site/search-surfaces.json`, `deployer/app/search-surfaces.json`) and tests check
  that every list, tree, table, listbox, menu and tab strip has a registered search.

## [1.0.0] - 2026-11-02

First version of TempDesk Deployer, the desktop app that deploys and manages TempDesk.

### Added

- Windows Server 2025 Core path: unattended install media (autounattend.xml plus the TempDesk
  folder) as a folder, a zip kit and an ISO built with the in-box IMAPI2FS API. The server
  installs, becomes the first domain controller and finishes TempDesk by itself; the desktop app
  watches the setup stages over WinRM and collects the agent keys.
- Advanced path for an existing Windows Server: copy the payload, create the forest, wait across
  the restart, configure TempDesk and install the agent, with resume from the failed step.
- TempDesk Lite over SSH with the in-box OpenSSH client: key generation, a visible console for
  the first connection, Docker checks, upload, domain settings and the password as a Docker
  secret, health wait and agent keys.
- Portals: start them with Docker on this PC or on the Lite host, guest and admin links and a QR
  code generated on the PC.
- Answer File Studio from the website, with desktop extras: open and save real files, recent
  files, reload on external changes, Git branch per variant, Build ISO, write to a USB stick and
  drag a driver folder to add a driver path.
- Unlimited undo and redo for every action, stored as Git commits in a local workspace (or a
  built-in history file when Git is not installed), with a History timeline, diffs, compare and
  restore.
- Tools: a Base64 toolkit for text, data URLs and files of any size with SHA-256 verification.
- English, Cantonese (Traditional Chinese, Hong Kong) and bilingual modes, a funny level for
  friendly copy, personal wording, school mode, sounds, appearance editor, command palette,
  context menus, tabs, notifications, exports, backup and restore, offline docs and changelog.
- Squirrel.Windows installer (not code-signed by owner decision) with background updates from
  GitHub releases and a portable build.
