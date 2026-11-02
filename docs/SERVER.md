# TempDesk Server management

The Server area is a Windows Admin Center style console for the domain
controller the TempDesk Agent runs on. It lives beside Directory and Group
Policy in the admin console. Every tool here acts on the local server through
the agent's `/server/*`, `/jobs/*`, `/dns/*` and `/dhcp/*` routes, which are
defined in `docs/API.md` under "Admin routes: server management".

Two pieces implement it:

- Agent side (`agent/src/ServerModule*.cs`, `agent/src/Jobs.cs`): C# modules that
  register the routes and carry out the work with PowerShell cmdlets and a few
  console tools. C# 5 on .NET Framework 4.8, built by the in-box compiler.
- Portal side (`portal/app/server_routes.py`, `templates/server/*.html`,
  `static/js/server-*.js`, `static/css/server.css`): a FastAPI router the admin
  portal includes, its pages, and the browser scripts that drive live charts,
  tables and the console.

## What each tool does

| Tool | Capability | What it does |
| --- | --- | --- |
| Overview | `server` | OS, edition, uptime, domain role, and live CPU / memory / disk / network charts (polled every 2 s). Restart and shut down with a confirm value. Rename the computer. |
| Services | `services` | List services; start, stop, restart, pause, resume; change startup type (including Automatic Delayed). |
| Processes | `processes` | List processes with PID, CPU, memory, path; end a process (confirm = its name). |
| Event logs | `events` | List logs and records with level, source, time and message filters; clear a log (confirm = its name); export to `.evtx` through `wevtutil`. |
| Files | `files` | Browse drives and folders; download; upload (multipart, streamed to disk, 500 MB cap); make folder, rename, copy, move; delete (confirm = leaf name); read and set ACLs; file hash. |
| Firewall | `firewall` | Profiles (enable, default actions) and rules (search, create, edit, delete with confirm). |
| Roles and features | `features` | List, install and uninstall Windows features. Long operations run as background jobs; the page polls `/jobs/{id}`. |
| Updates | `updates` | List installed and available updates via the Windows Update Agent COM API; scan; install selected (background job); update settings. |
| Storage | `storage` | Disks, volumes, partitions; initialize / online / offline a disk; new volume; format (confirm = volume id); SMB shares. |
| Networks | `network` | Adapters with IPv4 (DHCP or static), gateway and DNS servers; routes; `Test-NetConnection`. |
| Registry | `registry` | Browse subkeys and values; set and delete values; create and delete keys (confirm = leaf); export to `.reg` through `reg export`. |
| Scheduled tasks | `tasks` | List and detail; structured create (actions; triggers daily / weekly / at startup / at logon / once; principal SYSTEM or a user); run, end, enable, disable, delete (confirm = name). |
| Certificates | `certificates` | List a store; import pfx / cer; export cer; delete (confirm = thumbprint); create self-signed. |
| Devices | `devices` | PnP devices with status and driver; enable and disable. |
| Local users | `localusers` | On a domain controller this reports `notApplicable` (accounts are domain accounts under Directory). On member servers it manages local users and groups. |
| DNS server | `dns` | Zones; records A / AAAA / CNAME / MX / TXT / PTR / SRV; forwarders; clear cache. |
| DHCP server | `dhcp` | Scopes, options, leases and reservations (only when the DHCP role is installed). |
| Performance | `perfmon` | List counter sets and sample counter paths. |
| PowerShell | `console` | A terminal-style console. A dedicated runspace per session id, 20 minute idle expiry, output rendered with `Out-String -Width 200`. Every command is audited. |

The portal hides any tool whose capability the agent's `/health` does not
report, so the Samba backend and member servers show only what they support.

## Security model

- **Runs as SYSTEM on the domain controller.** The agent service account is
  LocalSystem, so every action here has full control of the server. Treat this
  area as equivalent to signing in to the DC.
- **Admin group plus bearer token.** Every route is admin-only: it needs the
  admin API key and a valid admin session token, and the acting admin must be a
  member of the configured admin group. This is enforced by the router, not by
  individual handlers.
- **Elevation for full control.** The PowerShell console requires a fresh
  password confirmation (`POST /auth/confirm` -> a 10 minute
  `X-TempDesk-Elevation` token) on top of the session, because the command text
  is the operator's own input run verbatim. The portal sends the person to the
  elevation page before the console page loads and before each session call.
  The generic module runner (capability `cmdlets-all`) has the same
  requirement: `GET /cmdlets?scope=all` lists every installed module's cmdlets
  and functions (loaded once on first request, then cached), and
  `POST /cmdlets/invoke` with `"scope":"all"` runs any of them. Both check the
  `X-TempDesk-Elevation` token against the acting user exactly as
  requiresElevation routes do, keep the destructive-verb `confirm` rule, and
  still bind only through AddCommand/AddParameter.
- **Audit.** Every admin call is written to the Windows event log with the
  acting user. Handlers add a specific entry naming the action and target
  (service name, path, task name, and for the console the full command text).
- **Destructive actions need a confirm value on the server.** Power, process
  kill, log clear, file delete, volume format, disk initialize, registry key
  delete, firewall rule delete, share delete, certificate delete, DNS/DHCP
  deletes and scheduled-task delete all require a `confirm` field (in the body
  or the query string) equal to the exact value the API documents. The portal
  forwards it; the agent, not the UI, is the authority. The portal also layers
  its own hold-to-confirm and type-the-name dialog on top.
- **No user input becomes script.** Every PowerShell call uses
  `Ps.Invoke(command, parameters)` with an `AddParameter`-style dictionary, so a
  value can never be interpreted as code. The one deliberate exception is the
  PowerShell console, where the command text *is* the input by design, gated by
  elevation and audit. External tools (`wevtutil`, `reg`, `icacls`,
  `shutdown`, `sc`) are run with an argv list that is quoted with the Windows
  command-line rules, never through a shell, and every argument is validated
  first (paths absolute and free of `..`, names matched against a regex, log and
  registry hive names checked).
- **Transport.** On plain HTTP the keys and admin sign-ins cross the LAN
  unencrypted, so keep the agent and portals on a trusted segment or turn TLS on
  (see `docs/API.md`). The console page shows a warning when the portal itself
  is served over plain HTTP.

## Limits and notes

- **Upload cap 500 MB**, streamed straight to disk by a small forward-only
  multipart reader so a large file never sits in memory. Larger uploads return
  413. The upload route reads the request stream directly rather than through
  the router's 1 MB body cache; all other routes stay within the 1 MB JSON cap.
- **Certificate import** is posted as base64 JSON (well within 1 MB), not as a
  raw multipart stream, so it goes through the normal body path.
- **Jobs are in memory.** The job registry lives for the life of the agent
  process; finished jobs are kept so the portal can read the final state, and
  the oldest are trimmed once the registry grows past its cap. A restart loses
  job history.
- **Live charts pause** when the browser tab is hidden and resume when it is
  shown again, and never animate under `prefers-reduced-motion`.
- **Console sessions** expire after 20 minutes idle on the agent; the page shows
  a countdown and disables input when it lapses. A session belongs to the admin
  who opened it and cannot be used by another.
- **Windows Update** uses the Windows Update Agent COM API (`Microsoft.Update.Session`) through `agent/src/WuaHelper.cs`, on a dedicated STA thread. Searches use fixed criteria (`IsInstalled=0 and IsHidden=0`, `IsInstalled=1`). Install jobs accept the license terms of the selected updates, download, install, and report each update's result code and whether a restart is required; a failed or aborted download or install fails the job. Not yet run against a live server.
- **ACL writes** apply a full SDDL descriptor with `icacls /restore`; the SDDL
  is parsed in process first so a malformed descriptor is rejected before any
  change.
- All pages work down to 360 px wide and keep a 16 px side gutter; browser
  scripts live only in `static/js/server-*.js` because the portal CSP forbids
  inline scripts.
