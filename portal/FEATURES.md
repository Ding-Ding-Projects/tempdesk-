# Portal feature status

Status values: implemented, partial (with what is missing), not done (with the reason).

## Core

| Feature | Status | Notes |
| --- | --- | --- |
| Guest create, show once, no-store, check, delete | implemented | One-time server store, HttpOnly cookie id, 410 on second view |
| CSRF on every form | implemented | Signed double-submit token |
| Portal rate limits | implemented | In memory, per process |
| Admin login, server-side sessions, logout | implemented | |
| Capability driven navigation | implemented | `/health` cached 30 s |
| Directory: tree, object editor, create, move, delete, user actions, members, LDAP search | implemented | |
| Group Policy: list, create, properties, status, delete, report, links, registry, preferences, permissions, inheritance, backups, WMI filters | implemented | |
| Administrative Templates editor | implemented | Category tree, policy list with regex filter, editor sheet for every element type |
| Security settings editor | implemented | Catalog driven forms plus raw section editor |
| Cmdlet runner | implemented | Generated forms, WhatIf, confirm for destructive verbs, JSON tree |
| samba-tool runner | implemented | Shown only with the `samba-tool` capability |
| Wi-Fi, scripts, allowlist, settings, audit | implemented | |
| Personal wording | implemented | Upload, drag and drop with celebration, clear, validation, never on unauthenticated pages |
| Imports and exports | implemented | Settings JSON (preview, never partial), netsh WLAN XML, script upload, allowlist text and app catalog JSON, directory JSON, CSV and LDIF, CSV bulk import of guests or users with dry run |
| Server-side version history for settings and scripts | implemented | `PORTAL_DATA_DIR/history`, diff and restore |
| Unlimited undo and redo in Git | implemented | `PORTAL_DATA_DIR/history.git-work`, conflict check, dependents check, redaction. Not undoable (marked before confirming): password reset, unlock, guest delete, Wi-Fi delete and key changes, cmdlet and samba-tool runs, directory delete on Samba. GPO edits undo by restoring the backup taken before the change; GPO delete undo imports that backup but does not restore links. Server area actions record through `track()` only where that module calls it. |
| Elevation (Confirm your password) | implemented | Dialog and page, token kept server side for 10 minutes |
| Server area hooks | implemented | `server_routes.router`, `require_admin`, `get_agent_client`, `NAV_ITEMS`, `layouts/admin.html` |

## Phase 2 catalogue

| # | Feature | Status | Notes |
| --- | --- | --- | --- |
| Motion | View Transitions, staggered entrance, spring buttons, ripple, nav indicator, skeletons, roll-up numbers, dialog scale-in, toast slide-in, Full / Reduced / Off | implemented | Skeletons are used for lazy tree loading only |
| 1 | First-run onboarding wizard | implemented | Resumes from server-side state |
| 2 | Languages: English, Cantonese, Bilingual | implemented | `app/i18n/en.json` and `zh-HK.json` with identical keys. Agent error messages and catalog data from the agent stay in the agent's language. Some short validation messages built in Python with values (for example ADMX element ranges) are English only. |
| 3 | Funny level 0 to 3 | partial | Applies to a small set of non-critical headings; errors and security text are always serious |
| 4 | School mode | implemented | PIN hash in localStorage, documented as a convenience lock |
| 5 | Regex search beside every search box | implemented | Toggle, token builder dialog, live match count, invalid pattern message, server-side validation |
| 6 | Context menu (right click, Shift+F10, Menu key) | partial | On table rows and dashboard cards that list actions; not every card has one |
| 7 | Browser-style tabs | implemented | Open objects, policies, scripts and cmdlets; middle click closes; drag or Alt+arrow to reorder; restored from localStorage |
| 8 | Version history for settings and scripts | implemented | Server side (see core) instead of local only |
| 9 | Exports everywhere | partial | Every table exports CSV (UTF-8 with BOM so Excel opens it correctly) and JSON; GPO report exports HTML and XML. A separate XLSX file is not produced. |
| 10 | Bulk actions | implemented | Guests, directory lists and search results, GPOs, Wi-Fi, scripts, allowlist. Select all applies to rows visible after filtering. |
| 11 | Changelog viewer and offline docs browser | implemented | Reads files bundled into the image |
| 12 | Notification centre | implemented | Bell with history in localStorage, mark read, clear |
| 13 | Two-key super confirmation | implemented | Typed name plus 1.5 s hold; the server checks a signed action and target token |
| 14 | Text size, density, high contrast, focus ring | implemented | Layout reflows at 200 percent zoom; tested at 360 px width by layout rules, not by a browser test |
| 15 | Appearance editor | partial | Accent picker (native color input plus hex) with live preview and contrast check, roundness, theme, logo upload. No custom hue wheel: the native picker is used instead. |
| 16 | Info buttons and settings search | partial | Every setting has a one-line explanation and settings search works; info buttons are on the non-obvious controls found so far, not audited exhaustively |
| 17 | Truthful empty states | implemented | No fake data; every empty list says why and what to do |
| base64-tools | Base64 toolkit (admin Tools and guest Tools link) | implemented | Runs in the browser only. `static/js/base64.js` is a vendored copy because `site/assets/base64.js` did not exist yet when this was built; the Dockerfile copies `site/assets/zip.js`. Streaming encode and decode with progress, pause, cancel and SHA-256 round-trip check; history with undo and redo, payloads kept only when opted in. |

## Known limitations

- Rate limits, sessions, one-time credentials and pending imports are kept in memory: run one portal process per mode, and a restart signs administrators out.
- The undo journal only covers actions made through the Admin console.
- The Docker image was not built in the development environment (Docker Hub returned 429 for the base image).
