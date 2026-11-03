# Changelog

All notable changes to TempDesk. Release builds of TempDesk Deployer are numbered
`major.minor.<workflow run>`; the release notes on GitHub list each build.

## [Unreleased]

### Added

- Answer File Studio: rich controls for every setting. Each of the 1,029 catalog settings now has a
  matching control (switches, segmented buttons, option cards, searchable time zone and locale lists
  with the live UTC offset, IP and CIDR fields, size and duration fields with live previews, product
  key boxes with generic edition keys, command line editor, colour picker and more), a written
  description, the meaning of the current value, risk badges, related settings and an Unset button.
  Search also matches descriptions and value meanings.

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
