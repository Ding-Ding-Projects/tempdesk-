# TempDesk app streaming

Guests can run individual Windows programs (RemoteApp) from any device, like AppsAnywhere:

- **In the browser** through [Apache Guacamole](https://guacamole.apache.org/). Nothing to install on the device.
- **In the Windows Remote Desktop client** by downloading a `.rdp` RemoteApp file. The app window then behaves like a local window.

## Architecture

```
browser ──HTTPS──> TempDesk portal ──(POST /api/tokens, encrypted JSON)──> Guacamole web app :8090
   │                                                                          │
   └──── opens Guacamole client page with token ─────────────────────────────┘
                                                                              │ (compose network)
                                                                            guacd ──RDP 3389──> app host (RD Session Host)

Windows PC ──.rdp file from portal──> mstsc ──RDP 3389──> app host
```

- `compose.yaml` runs `guacamole/guacd` and `guacamole/guacamole` at tag 1.6.0 (the newest stable tag on Docker Hub when this was written; 1.5.5 also works with the same settings).
- Guacamole uses only the **Encrypted JSON** authentication extension (`JSON_ENABLED=true`, `JSON_SECRET_KEY`). There is no database and no LDAP. Guacamole stores no users, no connections and no passwords.
- The portal builds a short-lived payload that names the user and one RDP connection (host, RemoteApp alias, the guest's own credentials), signs it with HMAC-SHA256 and encrypts it with AES-128-CBC using the shared key, and exchanges it for a Guacamole session token.
- App hosts are prepared with `server/apphost/Install-AppHost.ps1`.

### About the Guacamole login page

The normal Guacamole login form is still served at `http://<host>:8090/`, but it cannot sign anyone in: the JSON extension only accepts a signed and encrypted `data` parameter, and no other authentication extension is installed, so any username and password typed there is rejected. Someone who does not know `JSON_SECRET_KEY` cannot create a valid payload.

## Setup

1. Prepare an app host (see `server/apphost/README.md`).
2. On a Linux host with Docker that can reach the app host on TCP 3389:
   ```sh
   cd streaming
   cp .env.example .env
   openssl rand -hex 16        # paste into JSON_SECRET_KEY in .env
   docker compose up -d
   ```
   Guacamole is then at `http://<host>:8090/`.
3. Give the portal the same key and the URL users' browsers will use, for example `GUAC_URL=https://apps.example.org` and `GUAC_JSON_SECRET_KEY=<32 hex digits>`.
4. Add apps in the admin portal (stored in the settings under `"apps"`), then run `Install-AppHost.ps1` on each app host again.
5. For anything beyond a trusted LAN, put a TLS reverse proxy (with WebSocket support) in front of port 8090 and set `REMOTE_IP_VALVE_ENABLED=true`. Guacamole carries credentials and the whole screen, so plain HTTP should never cross an untrusted network.

## App catalog entries

```json
{
  "id": "notepad",
  "name": "Notepad",
  "description": "Plain text editor",
  "icon": "📝",
  "host": "apphost01.corp.example",
  "port": 3389,
  "program": "||notepad",
  "hostPath": "C:\\Windows\\System32\\notepad.exe",
  "arguments": "",
  "workingDir": "",
  "groups": [],
  "enabled": true,
  "rdpSecurity": "nla",
  "ignoreCert": false,
  "resizeMethod": "display-update",
  "disableCopy": false,
  "disablePaste": false,
  "enablePrinting": false
}
```

- `id` matches `^[a-z0-9-]{1,40}$` and is used in URLs and `.rdp` file names.
- `program` is the RemoteApp alias (`||alias`, as published by `Install-AppHost.ps1`) or a full path. Use aliases: the app host allow list blocks unlisted full paths.
- `hostPath` is only used by `Install-AppHost.ps1` (where the program lives on the app host). It is an addition to the original field list.
- `groups` lists AD group names allowed to see the app; empty means every signed-in user.
- `disableCopy`, `disablePaste` and `enablePrinting` are per-app flags (off by default, so copy and paste work and printing is off).

## How the portal uses the package

`tempdesk_streaming` is pure Python with one dependency, `cryptography` (pinned in `requirements.txt`). It never does network I/O; the portal makes the HTTP calls.

```python
from tempdesk_streaming import (apps_for_user, get_app, build_app_payload, tokens_request,
                                client_url, rdp_bytes, content_disposition, RDP_MEDIA_TYPE,
                                upsert_app, remove_app)

settings = agent.get("/settings")             # full settings document
apps = apps_for_user(settings, user_groups)   # what to show this user

# Open in browser
app = get_app(settings, app_id)
if not app or not app.allowed_for(user_groups):
    raise Forbidden
payload, name = build_app_payload(app, username=sam, password=password, domain=netbios,
                                  hex_key=GUAC_JSON_SECRET_KEY)      # expires in 2 minutes
url, form = tokens_request(GUAC_INTERNAL_URL, payload)
token = httpx.post(url, data=form).json()["authToken"]
return RedirectResponse(client_url(GUAC_URL, name, token))
# -> {GUAC_URL}/#/client/<base64("Notepad\0c\0json")>?token=<authToken>

# Download .rdp (contains DOMAIN\user, never the password)
body = rdp_bytes(app, username=sam, domain=netbios, gateway_host="")
headers = {"Content-Disposition": content_disposition(app)}
return Response(body, media_type=RDP_MEDIA_TYPE, headers=headers)

# Admin: edit the catalog
settings = upsert_app(settings, request_json)   # validates, raises AppValidationError
agent.put("/settings", settings)
```

The portal must hold the guest's password to build the browser payload. It should ask for it at launch time (or keep it only in the encrypted session cookie for the life of the guest session) and never log it.

`.rdp` files are written as UTF-16 LE with a byte order mark and CRLF line endings, the same format `mstsc` uses when it saves a connection. `mstsc` also reads UTF-8, but UTF-16 keeps non-ASCII app names intact on every Windows locale.

## Tests

```sh
pip install -r requirements.txt pytest
python -m pytest streaming/tests
```

The tests include an independent reference decryptor (what the Guacamole extension does on receipt), checked against the sample payload published in the Guacamole manual.

## Limits

- Each launch opens its own RDP session on the app host. Two apps from the same user on the same host may share a session (Windows reconnects RemoteApps from one user), but in the browser each app is a separate tab.
- The browser client cannot show several RemoteApp windows as separate local windows; dialogs and extra windows appear inside the tab.
- No file transfer: drive redirection is off. Guests save files on the app host (their profile there) or to network locations the guest policy allows.
- No audio input, USB or smart card redirection in the browser.
- Sessions count against RDS CALs (see `server/apphost/README.md`).
- Guacamole has no record of who used which app beyond its own logs; keep the portal's launch log if you need auditing.
- Tested only offline: the payload format is verified against the Guacamole manual's sample, but this repository has not been run against a live Guacamole container and app host.
