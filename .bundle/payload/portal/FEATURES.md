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
| Imports and exports | implemented | Every table to CSV, JSON and XLSX. Settings JSON (preview, never partial), netsh WLAN XML, script upload, allowlist text and app catalog JSON, directory JSON, CSV and LDIF, CSV bulk import of guests or users with dry run |
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
| 3 | Funny level 0 to 3 | implemented | Level 1 warm, 2 friendly, 3 playful with emoji. 36 non-critical strings (headings, empty states, success notes, guest pages) have variants in both catalogs; a test fails if a variant exists for error, password, confirmation, deletion or security text, and callers pass `serious=True` for error pages. |
| 4 | School mode | implemented | PIN hash in localStorage, documented as a convenience lock |
| 5 | Regex search beside every search box | implemented | Toggle, token builder dialog, live match count, invalid pattern message, server-side validation |
| 6 | Context menu (right click, Shift+F10, Menu key) | implemented | Every table row and card in both modes (including the Server area). Rows with `data-ctx='[...]'` list their actions with shortcuts; others get a menu built from the item's own links and buttons plus Copy. A test walks all templates and fails if any data row lacks `data-ctx`. |
| 7 | Browser-style tabs | implemented | Open objects, policies, scripts and cmdlets; middle click closes; drag or Alt+arrow to reorder; restored from localStorage |
| 8 | Version history for settings and scripts | implemented | Server side (see core) instead of local only |
| 9 | Exports everywhere | implemented | Every table exports CSV, JSON and a real XLSX workbook (`app/xlsx.py`, written with zipfile; strings are inline strings so formulas never run; verified with openpyxl in the tests). GPO report exports HTML and XML. |
| 10 | Bulk actions | implemented | Guests, directory lists and search results, GPOs, Wi-Fi, scripts, allowlist. Select all applies to rows visible after filtering. |
| 11 | Changelog viewer and offline docs browser | implemented | Reads files bundled into the image |
| 12 | Notification centre | implemented | Bell with history in localStorage, mark read, clear |
| 13 | Two-key super confirmation | implemented | Typed name plus 1.5 s hold; the server checks a signed action and target token |
| 14 | Text size, density, high contrast, focus ring | implemented | Layout reflows at 200 percent zoom; tested at 360 px width by layout rules, not by a browser test |
| 15 | Appearance editor | implemented | Canvas hue ring plus saturation and brightness square (`static/js/colorpicker.js`), hex and RGB inputs, keyboard control (arrows, Shift for big steps, Home and End), live preview and a contrast check against the page background; roundness, theme and logo upload. |
| 16 | Info buttons and settings search | implemented | 50 non-obvious controls are marked `data-advanced` and each has an info button (a test fails otherwise, and checks every info text is translated). Every setting has a one-line explanation; settings search works. Which controls count as non-obvious is a judgement call made by a person. |
| 17 | Truthful empty states | implemented | No fake data; every empty list says why and what to do |
| base64-tools | Base64 toolkit (admin Tools and guest Tools link) | implemented | Runs in the browser only and uses the website's codec `site/assets/base64.js` (`window.TempDeskBase64`). The Dockerfile copies it from the repository root build context, and `app/static/js/base64.js` is kept identical for local runs (a test checks this). Streaming encode and decode with progress, pause, cancel and SHA-256 round-trip check; history with undo and redo, payloads kept only when opted in. |

## Known limitations

- Sessions, rate-limit windows, one-time credentials and pending imports are stored in SQLite (`PORTAL_STATE_DIR`, default `PORTAL_DATA_DIR`, file `portal-state.sqlite3`, mode 600), so a restart keeps administrators signed in. Secrets in it (credentials, bearer and elevation tokens) are encrypted with AES-256-GCM: the admin key is derived from SESSION_SECRET with HKDF (changing the secret signs everyone out); the guest key is a random file `portal-state.key`. One-time entries are deleted on first view and expire after 10 minutes. The guest container needs its own writable state directory (see compose.yaml).
- The undo journal only covers actions made through the Admin console.
- The Docker image was not built in the development environment (Docker Hub returned 429 for the base image).
