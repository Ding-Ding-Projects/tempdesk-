# TempDesk portals

One Docker image, two modes:

| Mode | Who uses it | Port | Agent key |
| --- | --- | --- | --- |
| `PORTAL_MODE=guest` | Anyone on the LAN: create, check or delete a temporary sign-in | 8080 | guest key |
| `PORTAL_MODE=admin` | Members of the TempDesk admin group: the Admin console | 8081 | admin key |

Both services use Python 3.12, FastAPI and server-rendered Jinja2. Directory requests go through the TempDesk Agent API described in `docs/API.md`. The image supplies the scripts, styles and interface assets. The optional Virtual Commons dim sum result looks up a photo in the public dish catalogue and keeps the retry available if the image cannot load.

## Run a published image

Download the `tempdesk-portal-publication.json` artifact from the portal publication job in the **Release TempDesk Deployer** run for the version you intend to deploy. Choose a receipt with state `published` or `already-published`, and read its `releaseTag`, `revision`, and `digest` together. The publisher verifies the normal release and its tag before building the image. Obtain registry read access through your normal protected sign-in when the package requires authentication.

The multi-platform publisher records both Linux architecture digests in `platforms`. Use the top-level `immutableReference` on either amd64 or arm64 so Docker selects the correct image for the host. Existing single-platform receipts can continue to be used on their original architecture.

In this folder, prepare `.env.guest` and `.env.admin` from their examples. Supply the bound portal digest as the Compose interpolation variable `TEMPDESK_PORTAL_DIGEST`. In PowerShell, use `$env:TEMPDESK_PORTAL_DIGEST`. On a shell with `export`, use `export TEMPDESK_PORTAL_DIGEST`. The value is the receipt's complete `sha256:` digest.

```sh
docker compose -f compose.yaml -f compose.published.yaml pull
docker compose -f compose.yaml -f compose.published.yaml up -d --no-build --pull never --wait --wait-timeout 90
docker compose -f compose.yaml -f compose.published.yaml ps
```

Include your existing broker and CA overlays on both Compose commands when those protected mounts are already in use. The published mode uses the same named data volumes and LAN ports as the source mode. From an intended LAN client, open the host's guest page on port 8080 and the management sign-in page on port 8081 at `/login`. Confirm both pages report the revision from the receipt. Keep the earlier digest available for a rollback.

### Host on Windows

Start Docker Desktop in Linux containers mode. Save the accepted publication receipt as `tempdesk-portal-publication.json` beside the configured `.env.guest` and `.env.admin` files. The default configuration directory is `portal/`. To keep operator configuration outside the checkout, set `TEMPDESK_PORTAL_CONFIG_DIR` to that directory. `TEMPDESK_PORTAL_RECEIPT` points to a receipt stored separately.

Run `host.bat --detached` from the repository root to pull, start and verify both services. The launcher reports each LAN URL, running version, start time, and health readback time. Double-click `host.bat` and press **D** for the same background startup or **L** for live logs. `host.bat --logs` also opens the log view after healthy startup. Press **G** for the guest service, **M** for management, **P** to pause or resume following, and **Q** or **Escape** to leave. The services keep running when the log view closes.

Use the original configuration directory, Compose project name and overlays when updating an existing deployment. Set `TEMPDESK_PORTAL_COMPOSE_OVERRIDES` to the existing override file paths separated by semicolons and supply the protected mount configuration those overlays require. When several network adapters are available, set `TEMPDESK_LAN_ADDRESS` to the intended local IPv4 address. The launcher checks the published port, pulled image identity, container health and visible source revision before reporting success.

The launcher reads the native Compose exit code for each operation. A failed pull or startup yields a nonzero exit status so it can be handled by a calling script.

### Portable Portal Host wizard

Open `TempDeskPortalHost-<version>-portable.exe` from the normal release. The wizard checks the local Docker Desktop Linux engine and reads the accepted publication receipt. Select the protected configuration directory and, if the deployment needs one, a separate reviewed Compose overlay. Choose the local LAN address, the two host ports, and the Compose project name. The project name selects that project's named storage volumes.

Review the digest and the proposed bindings before starting. The launcher verifies project ownership before reusing resources. The wizard reports the guest and management results independently and enables each link after its corresponding health check. You can request cancellation before startup. If startup is already underway, the wizard lets that operation settle and reports its actual outcome. **Recheck health** reads the endpoints for the selected deployment without repeating the pull or startup.

## Run from source

```sh
cd portal
cp .env.guest.example .env.guest   # fill in AGENT_URL and the guest key
cp .env.admin.example .env.admin   # fill in AGENT_URL, the admin key and SESSION_SECRET
node ../scripts/build-portal-image.cjs
docker compose up -d --no-build
```

The source command requires Node.js, Git, tar and Docker Compose. It stages the approved portal, docs, changelog and shared browser assets from the checked-out revision. It stamps the application bytes before building the Compose image and removes its temporary staging directory afterward. The staging command builds the image without starting a service and excludes all Git metadata and credentials from the context. Installed Deployer and published portal payloads already carry their own build receipts. A direct `docker compose up -d --build` from a loose checkout still works and reports unavailable build provenance.

## Optional Virtual Commons workstation broker

### Enable a dedicated workstation broker on an existing Linux deployment

Configure the guest service with its workstation DNS name in `COMMONS_RDP_KIOSK` and its private HTTPS broker origin in `COMMONS_KIOSK_BROKER_URL` in `.env.guest`. Keep the broker credential outside the repository, build context and environment files. The broker must already be configured with the matching credential. Prepare a restricted regular file readable by the portal identity (UID/GID 10001), for example a root-owned file with group 10001 and mode 0440 in a root-owned directory. If needed, prepare a separate PEM trust bundle readable by the same identity. Use this procedure on the Docker daemon host with normal Linux UID mapping.

From the existing portal Compose project, using its usual project name and previously built image, run one of the following commands. Each argument is an absolute host file path. The second form supplies a private CA.

```sh
bash compose-kiosk.sh /etc/tempdesk/kiosk/broker.key
bash compose-kiosk.sh /etc/tempdesk/kiosk/broker.key /etc/tempdesk/kiosk/ca.pem
```

The helper checks file types, paths and access modes, validates the combined Compose model silently, and recreates only the guest service, briefly interrupting it. Compose mounts the files read-only. With no CA argument the guest uses its normal TLS trust store. The helper retains a running published digest or accepts an explicit `TEMPDESK_PORTAL_DIGEST` that was already pulled. Re-run with the same paths after rotation so the guest receives the replacement files. To remove the mounts, reconcile only the guest service with the base Compose file and the same published overlay when applicable. Check the guest seat availability and the end-to-end assignment and expiry procedure in [Virtual Commons](../docs/VIRTUAL-COMMONS.md).

### Enable the broker on Windows with Docker Desktop

Use the same guest settings and prebuilt portal image as above. Run PowerShell on the machine running Docker Desktop in Linux containers mode, in the existing portal Compose project. Supply an existing credential file and, if needed, a separate PEM CA bundle. Both must be regular files on a fixed NTFS volume, outside the source tree, with trusted ownership and protected parent directories. Keep credential read access restricted to the operator and trusted system principals. The script inspects ACLs, link counts and the local Docker Desktop Linux engine without modifying permissions. Invoking it without a credential argument does nothing.

```powershell
.\compose-kiosk.ps1 -CredentialFile 'C:\ProtectedFiles\TempDesk\broker.key'
.\compose-kiosk.ps1 -CredentialFile 'C:\ProtectedFiles\TempDesk\broker.key' -CaFile 'C:\ProtectedFiles\TempDesk\ca.pem'
```

Use your own protected paths. Run with the existing Compose project name. Each enabled run recreates the guest service and briefly interrupts it. Confirm Docker Desktop can share those files and the guest can contact the broker using its configured TLS name. Host ACL checks alone cannot establish either fact.

## Configuration

| Variable | Meaning |
| --- | --- |
| `PORTAL_MODE` | `guest` or `admin` |
| `AGENT_URL` | For example `http://dc01.corp.example:8080`. `/api/v1` is added when missing. |
| `AGENT_KEY` | The guest key or the admin key from `C:\ProgramData\TempDesk\agent.json` |
| `AGENT_CA_FILE` | Only for `https` agent URLs: the agent certificate, PEM or DER (DER is converted at startup) |
| `AGENT_CERT_SHA256` | Only for `https` agent URLs: SHA-256 fingerprint pin, checked right after the TLS handshake, before the key is sent |
| `SESSION_SECRET` | Required in admin mode, at least 32 characters |
| `PORT` | Default 8080 (guest) or 8081 (admin) |
| `TRUSTED_PROXY` | Comma separated IPs or networks whose `X-Forwarded-For` is trusted. Unset: the direct peer address is used. |
| `COOKIE_SECURE` | `auto` (default: Secure only when the request is HTTPS), `true` or `false` |
| `PORTAL_DATA_DIR` | Default `/data`. Admin console state including the logo, onboarding, version history and undo repository. |
| `PORTAL_STATE_DIR` | Default: `PORTAL_DATA_DIR`. SQLite file with sessions, rate-limit windows and the encrypted one-time store. |
| `GUEST_CREATE_LIMIT`, `GUEST_CREATE_WINDOW_SECONDS` | Portal side create limit per client address (default 10 per 10 minutes) |

### Plain HTTP

The agent speaks plain HTTP by default. In that case keys, admin sign-ins, guest passwords and Wi-Fi keys cross the network unencrypted. The Admin console shows a coral "HTTP, not encrypted" status pill (with an explanation popover that can be hidden for the session) whenever the agent URL or the console itself is plain HTTP. Keep the server and portals on a trusted network segment, or turn on TLS on the agent and put the portals behind an HTTPS reverse proxy.

## Security design

- Guest credentials are never put in a URL or a log. After a create, the browser is redirected (POST, redirect, GET) and the credentials wait in a server-side one-time store keyed by a random id in an HttpOnly cookie. The first view consumes them; the page is sent with `Cache-Control: no-store`.
- Every form carries a signed double-submit CSRF token (itsdangerous signature bound to an HttpOnly cookie value).
- Per address rate limits in the portal (creates, sign-in checks, admin sign-ins), on top of the agent's own limits.
- Admin sessions are kept server side in SQLite and survive restarts. The cookie holds only a signed random id (HttpOnly, SameSite=Strict, Secure on HTTPS); the agent bearer token never reaches the browser and is encrypted at rest (AES-256-GCM, key derived from SESSION_SECRET).
- One-time credentials are encrypted at rest too, deleted on first view and expire after 10 minutes.
- Headers: a Content Security Policy with no inline script, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a restrictive `Permissions-Policy`.
- Destructive actions need a server-checked two-key confirmation: type the name, and hold the button for 1.5 seconds (which releases a signed token for that exact action and target).
- Group Policy reports are shown in a sandboxed `iframe` with its own CSP, so scripts in a report never run.
- Actions with full control of the server (all-module cmdlet runner, Server area console) need a fresh password confirmation (`/auth/confirm`), kept server side for 10 minutes.

## Admin console features

Dashboard, guests, directory browser and editor, LDAP search, Group Policy (properties, links, Administrative Templates, security settings, registry values and preferences, permissions, reports, backups, WMI filters, block inheritance), cmdlet runner, samba-tool runner, Wi-Fi profiles, scripts, app allowlist, settings, audit log, version history, unlimited undo and redo committed to Git, CSV import, imports and exports, docs and changelog, first-run wizard, Base64 tools. See `FEATURES.md` for the status of each feature.

### Browser-local personal wording

Open Settings and find **Personal wording**, then choose and apply a JSON file. Dropping the file on the signed-in console uses the same validation and cache. The file has schema version 1 and an `entries` object of wording pairs. The limits are 256 KiB of UTF-8, nesting depth 8, 160 Unicode code points per key and 1,000 per value. Invalid input leaves the prior valid wording in place.

The validated file stays in the current browser tab and survives reloads within the same management sign-in. Clear it in Settings to restore original copy immediately. School mode suspends the wording and hides the controls. A fresh sign-in starts with the original labels. Personal wording applies to marked interface copy and supported accessible names. Record values and document metadata keep their shipped forms.

Under **Display and accessibility**, use **Action sounds** to silence the console's wording cues. The choice is saved in this browser and takes effect immediately. School mode pauses sounds and keeps the saved choice. Saving a valid file plays an ascending three-note cue. A rejected file or save plays a descending two-note cue. The browser synthesizes both cues locally after a user action. The wording status is available as text and is announced in the same way when audio is muted or unavailable.

### Notification history

Open the bell in the management console to review and search notifications. **Select all matches** and **Invert matches** operate on the current filter. Space toggles a row checkbox. Shift+Space extends selection from the last selected row. Selection stays within the current matches. **Dismiss selected toasts** closes the visible messages and keeps their records. Warnings and errors stay visible on the current page until dismissed.

**Delete selected** and **Clear all history** list the affected items before deletion. The review has a separate search and regex builder that highlight matches within the complete affected list. Check both review controls, move confirmation to 100 percent, and use the separate Delete button. A changed filter or changed history resets the confirmation. Cancel or Escape returns to the originating action.

**Export matches** downloads ordinary notification copy in JSON. Personal wording applies to the shipped message text in the console. Record arguments and unclassified details retain their literal values. New unclassified or literal diagnostics stay in the current page only, and the export reports their omission. Known messages are stored individually under the signed-in account in this browser. Older unassigned history remains in local storage outside the account's list.

Older management clients receive HTTP 410 from the retired server upload and clear routes. The console ignores files left on the server by older versions. Choose the original file in the current browser to apply it again.

## Extension hooks (for the Server area and other modules)

- `app/server_routes.py`: if this module exists, its `router` is included in admin mode.
- `app.web.require_admin`: FastAPI dependency returning the admin `Session` (`.token` is the agent bearer token, `.elevation_token()` the fresh elevation token or `None`).
- `app.web.get_agent_client(request)`: the shared `AgentClient`. `request(method, path, *, params, json, data, files, elevation, token)` returns an `httpx.Response` and raises `AgentError` (with `.status`, `.code`, `.message`) or `AgentUnavailable`. `call(...)` returns parsed JSON.
- `app.web.csrf_protect`, `app.web.render(request, template, ctx)`.
- `templates/layouts/admin.html` with blocks `title`, `content`, `scripts` (and `head`).
- `app.nav.NAV_ITEMS` and `app.nav.PALETTE_ACTIONS`: append dicts `{id, label, href, icon, capability, group}` at import time; the rail, the More page and the Ctrl+Shift+F palette read them.
- `/auth/elevate` (GET page, POST form or fetch with `X-Requested-With: fetch`): the reusable "Confirm your password" flow. Any link to `/auth/elevate?next=...` opens the dialog.
- `app.undo_routes.track(request, session, action=..., target=..., summary=..., request={...}, before=..., after=..., inverse={...}, check={...}, undoable=..., reason=...)`: record an action in the undo journal (secrets are redacted).

## Develop and test

```sh
pip install -r requirements-dev.txt
python -m pytest
```

The tests run both modes against `tests/fake_agent.py`, an in-memory fake of the agent API. You can also run it by hand:

```sh
uvicorn tests.fake_agent:app --port 9100
PORTAL_MODE=guest AGENT_URL=http://127.0.0.1:9100 AGENT_KEY=guest-key PORTAL_DATA_DIR=./.data-guest python -m app.main
PORTAL_MODE=admin AGENT_URL=http://127.0.0.1:9100 AGENT_KEY=admin-key SESSION_SECRET=change-me-change-me-change-me-12345 PORTAL_DATA_DIR=./.data-admin PORT=8081 python -m app.main
```

The fake agent accepts any admin username with the password `Passw0rd!`.

## Design

Colors, shapes, type and motion live in `app/static/css/tokens.css` (from `design/README.md`). Dark is the default on every OS; the light theme applies only when the user picks it. Shared components are in `app/static/css/app.css`; the admin control room (dock, command bar, tiles, guest cards, directory studio, Group Policy editor) is in `app/static/css/console.css` with its scripts in `app/static/js/console.js`, `guests.js`, `directory-studio.js` and `gpo-editor.js`. The command bar (also Ctrl+Shift+F) understands `new guest 4h [name]`, `extend <guest> 1h`, `reset password <user>`, `unlock <user>`, `enable|disable <user>`, `open gpo <name>` and `find <text>`, and falls back to a global search. Motion respects `prefers-reduced-motion` and the in-app Motion setting (Full, Reduced, Off).

### Search fields and the regex builder

Every list, table, tree, panel, picker, menu and tab strip has its own search field (`app/static/js/search-surfaces.js`), wired to the shared regex builder from the website (`site/assets/regex-builder.js`, copied into the image by the Dockerfile; `tests/test_search_surfaces.py` fails when the copy in `app/static/js` drifts). Plain text is the default and matches when every word occurs; `.*` switches the field to a JavaScript regular expression and **Builder** opens the guided builder for that field only. Each field keeps its own state in memory and nothing is saved. Trees keep matching nodes and their ancestors, open the branches that hold a match and highlight the text. Tab strips also offer **Close tabs containing text** and **Close tabs not containing text** with a preview; the current page counts as unsaved while one of its forms was edited, and such tabs stay open. Server-side table searches still send `q` and `re=1`; the portal evaluates those patterns with Python `re`, while the live filter of the rows on the page uses the JavaScript dialect.

`search_surfaces.json` is the hand-written catalogue of these fields. The test renders every entry with a page against the fake agent and walks all templates and scripts: a new `<table>`, `<ul>`, `<ol>`, `<select>`, `<datalist>` or tree, listbox, grid, tablist, list or menu role needs `data-searchable="<id>"` (or `/* search: <id> */` in a script) with a catalogue entry, or `data-search-exempt="<reason>"`.


## Virtual Commons

Set `COMMONS_RDP_TARGET` in the guest portal configuration to a client-reachable Remote Desktop hostname or IPv4 address, with an optional port. Configure that computer to accept temporary domain users over Remote Desktop with Network Level Authentication. The portal shows a separate Virtual Commons checkout button when the target is configured. Choose a finite duration. After checkout, open the downloaded `Virtual-Commons.rdp` and enter the password shown on the one-time result page. If the browser blocks the automatic download, use the download button on that page.

One percent of valid Virtual Commons checkout attempts show a dim sum dish instead. That result creates no account and offers a retry. The RDP file contains the configured address and temporary username. The password remains on the one-time result page.

For edition selection, set `COMMONS_RDP_GUI` to a configured Desktop Experience session host. Set `COMMONS_RDP_CORE` only if you have verified that your chosen Server Core configuration can provide temporary guest sessions. Windows Server Core lacks the Remote Desktop Session Host role required by the TempDesk App Host installer. Either edition setting enables edition mode. Unconfigured or invalid choices cannot be checked out. Deployments using only `COMMONS_RDP_TARGET` retain their existing single-target flow. See the [Virtual Commons guide](../docs/VIRTUAL-COMMONS.md) for deployment and expiry checks.
