# TempDesk portals

One Docker image, two modes:

| Mode | Who uses it | Port | Agent key |
| --- | --- | --- | --- |
| `PORTAL_MODE=guest` | Anyone on the LAN: create, check or delete a temporary sign-in | 8080 | guest key |
| `PORTAL_MODE=admin` | Members of the TempDesk admin group: the Admin console | 8081 | admin key |

Both are Python 3.12, FastAPI and server-rendered Jinja2 pages. The only contact with the domain is the TempDesk Agent API in `docs/API.md`. There is no JavaScript build step and nothing is loaded from the internet at runtime: fonts are system fonts and every script and style sheet is served from the image.

## Run

```sh
cd portal
cp .env.guest.example .env.guest   # fill in AGENT_URL and the guest key
cp .env.admin.example .env.admin   # fill in AGENT_URL, the admin key and SESSION_SECRET
docker compose up -d --build
```

The build context is the repository root, so the image also bundles `docs/*.md` (offline docs page) and `CHANGELOG.md` when present.

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
| `PORTAL_DATA_DIR` | Default `/data`. Admin console state: personal wording, logo, onboarding, version history, undo repository. |
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
