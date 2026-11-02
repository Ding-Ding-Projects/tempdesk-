# TempDesk Agent

The TempDesk Agent is a Windows service that runs on the Active Directory domain
controller. It is the only TempDesk component that touches Active Directory and
Group Policy. The guest portal and the admin console never talk to LDAP
directly: they call this agent's HTTP API, which is defined in `docs/API.md`.

The agent targets C# 5 on .NET Framework 4.8 and builds with the in-box compiler
that ships with Windows Server 2025. There are no NuGet packages and no external
build tools.

## What it does

- Creates and deletes temporary guest accounts in the guest organizational unit,
  with random usernames, strong random passwords, expiry dates and a provenance
  tag.
- Exposes the full directory for the admin console: read and write any object
  and any attribute, move and delete objects, reset passwords, manage group
  membership.
- Manages Group Policy: create and edit GPOs, links, registry and preference
  settings, permissions, inheritance, backups, WMI filters, the Administrative
  Templates catalog (ADMX/ADML) as structured forms, and the security settings
  in `GptTmpl.inf`.
- Runs any cmdlet from the `ActiveDirectory` and `GroupPolicy` modules through a
  safe allowlisted runner that never builds script text from input.
- Writes guest application allowlists, Wi-Fi profiles and startup/logon scripts.
- Writes every administrative action and every guest create or delete to the
  Windows event log, which the `/audit` route reads back.

Server management routes (the Windows Admin Center style pages described in
`docs/API.md`) are implemented in separate files and register themselves through
the module hook described below.

## Transport

By default the agent serves plain HTTP on port 8080, so no certificate is
needed. On plain HTTP the API keys, admin sign-ins, guest passwords and Wi-Fi
keys cross the LAN unencrypted, so keep the agent and the portals on a trusted
network segment. Install with `-Tls` to serve HTTPS on port 8443 with a
self-signed certificate that the portals pin.

## Build

On the domain controller, from the `agent` folder:

```
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

`build.ps1` finds the in-box compiler at
`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, finds
`System.Management.Automation.dll` in the GAC, compiles every file under
`src` to `bin\TempDeskAgent.exe`, and fails loudly if anything is missing.

## Install

Run elevated on the domain controller:

```
powershell -ExecutionPolicy Bypass -File .\install.ps1          # HTTP on 8080
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Tls     # HTTPS on 8443
```

The installer builds the agent, copies it to
`C:\Program Files\TempDesk\Agent`, creates `C:\ProgramData\TempDesk` with an ACL
limited to SYSTEM and Administrators, generates `agent.json` with fresh random
keys and an HMAC secret on first run, copies the settings template to
`settings.json`, opens the firewall, registers the event log source, creates the
`TempDeskAgent` service (automatic start, restart on failure) and starts it. It
prints a summary with the URL, the key file location, and (HTTPS) the
certificate SHA-256 fingerprint.

Re-running the installer updates the binaries and the transport setting while
preserving the existing keys and settings.

To remove it:

```
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall          # keep data
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall -Purge   # remove data too
```

## Configuration

`C:\ProgramData\TempDesk\agent.json`:

| Field | Meaning |
| --- | --- |
| `port` | Listener port (8080 for HTTP, 8443 for HTTPS). |
| `tls` | `false` for HTTP, `true` for HTTPS. |
| `guestKey` | API key held by the guest portal. |
| `adminKey` | API key held by the admin console. |
| `hmacSecret` | Base64 secret used to sign admin session tokens. |
| `domainDn` | The domain distinguished name, for example `DC=corp,DC=example`. |
| `settingsPath` | Path to the TempDesk settings document. |
| `wifiPath` | SYSVOL folder for Wi-Fi profiles. |
| `scriptsPath` | SYSVOL folder for startup and logon scripts. |
| `backupPath` | Local folder for GPO backups. |

The settings document (`settings.json`) has the shape of
`server/config/settings.default.json`. The agent reads it on each request, so
admin edits take effect without a restart.

## Console mode

For debugging, run the executable in the foreground:

```
"C:\Program Files\TempDesk\Agent\TempDeskAgent.exe" --console
```

It logs to the console and stops on Ctrl+C. Pass `--config <path>` to use a
configuration file somewhere other than the default location.

## Module hook for additional routes

The agent discovers route modules by reflection at startup. Any non-abstract
class that implements `IAgentModule` and has a constructor the host can satisfy
is instantiated and registered automatically, so new feature files can be added
without editing the host.

```csharp
public interface IAgentModule
{
    void Register(Router router);
    string[] Capabilities { get; }
}
```

Inside `Register`, call:

```csharp
router.Map(string method, string pathPattern, bool adminOnly,
           bool requiresElevation, Func<RequestContext, object> handler);
```

Path patterns use `{name}` segments, captured into `RequestContext.RouteValues`.
A handler returns any object (serialized to JSON), a `StatusResult` to set a
specific status code, or a `RawResult` for file downloads, and throws
`AgentException(status, code, message)` for errors. `RequestContext` exposes the
raw request, route values, query string, parsed body, acting user, the
PowerShell host, and an `Audit` method. Set `requiresElevation` to require a
fresh password confirmation (`POST /auth/confirm`) carried in the
`X-TempDesk-Elevation` header. The strings returned by `Capabilities` are merged
into the `/health` capabilities list.

## Troubleshooting

- **The service will not start.** Check the Application event log for a
  "Failed to start TempDesk Agent" entry. The most common causes are a missing
  or malformed `agent.json`, or the `ActiveDirectory` / `GroupPolicy` modules
  not being installed (install the RSAT role features).
- **Group Policy or cmdlet routes return `internal`.** The PowerShell host could
  not import the modules. Confirm `Get-Module -ListAvailable ActiveDirectory,
  GroupPolicy` lists both.
- **HTTPS clients cannot connect.** Confirm the binding with
  `netsh http show sslcert ipport=0.0.0.0:8443` and that the firewall rule
  exists. Re-run `install.ps1 -Tls` to rebind.
- **ADMX categories are empty.** The central store
  `\\<domain>\SYSVOL\<domain>\Policies\PolicyDefinitions` is missing; the agent
  then falls back to `C:\Windows\PolicyDefinitions`. Populate the central store
  for the full catalog.
- **Guest creation fails with a group error.** The guest group named in
  settings does not exist yet. Create it, or run the server presetup.
