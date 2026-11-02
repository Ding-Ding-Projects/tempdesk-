# TempDesk Agent API (v1)

The TempDesk Agent is a Windows service that runs on the domain controller. It is the only component that touches Active Directory and Group Policy. The web portals never talk LDAP directly; they call this API.

- Base URL: `http://<dc-host>:8080/api/v1` by default, or `https://<dc-host>:8443/api/v1` when TLS is turned on.
- Transport: plain HTTP by default so no certificate is needed (owner decision). `agent.json` `"tls": true` switches to HTTPS with a self-signed certificate that the portal pins with `AGENT_CA_FILE` or `AGENT_CERT_SHA256`. Security note, shown in the docs and the admin console: on plain HTTP the keys, admin sign-ins, guest passwords and Wi-Fi keys cross the LAN unencrypted, so keep the agent and portals on a trusted network segment, or turn TLS on.
- Body: JSON (`Content-Type: application/json; charset=utf-8`). Dates are ISO 8601 UTC (`2026-11-02T20:30:00Z`).
- Errors: non-2xx with `{"error": "<code>", "message": "<human text>"}`. Codes: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `internal`.

## Authentication

Every request carries `X-TempDesk-Key: <key>`. There are two keys, generated at install and stored in `C:\ProgramData\TempDesk\agent.json` (ACL: SYSTEM and Administrators only).

| Key | Who holds it | Allowed routes |
| --- | --- | --- |
| guest key | guest portal container | `/health`, `/guest/*`, `/public/settings` |
| admin key | admin portal container | everything; all routes except `/health`, `/public/settings`, `/auth/login` also need `Authorization: Bearer <session token>` |

Admin session: `POST /auth/login {"username","password"}` validates the credentials against AD and requires membership (recursive) in the group configured as `adminGroup` (default `TempDesk Admins`). It returns `{"token","expiresAt","user":{"sam","displayName"}}`. The token is an HMAC-SHA256 signed blob (`base64url(payload).base64url(sig)`) valid for 8 hours. `POST /auth/logout` revokes it. Every admin call is written to the Windows event log (source `TempDesk Agent`) with the acting user.

The guest key never reaches admin routes, even with a bearer token.

## Health and public settings

- `GET /health` → `{"status":"ok","version","domain","dc","time","backend":"windows|samba","capabilities":["guest","directory","gpo","gpo-registry","gpo-preferences","gpo-permissions","gpo-backup","wmifilters","admx","security","cmdlets","samba-tool","wifi","scripts","allowlist","audit"]}`. The portal hides any section whose capability is missing. The Windows agent reports every capability except `samba-tool`; the Samba agent reports what it supports (no `cmdlets`, `gpo-preferences` or `wmifilters`, adds `samba-tool`).

There are two interchangeable agent backends implementing this same API: the Windows service on a Windows Server domain controller, and the Samba container (`samba/`) that is itself the domain controller.
- `GET /public/settings` → guest-facing settings: `{"orgName","welcomeText","expiryChoices":[{"id","label","minutes"}],"allowPermanent":bool,"allowSelfDelete":bool,"usernamePrefix"}`. `minutes: 0` means permanent.

## Guest routes (guest key)

- `POST /guest/users {"displayName":"optional","expiryId":"4h"}` → `201 {"username","upn","password","expiresAt": null|date,"domain"}`. The password is returned only here, once. Creates the user in the guest OU, adds it to the guest group, sets `accountExpires`, `PasswordNeverExpires`, `CannotChangePassword`, tags `description` with `TempDesk guest` and `info` with JSON `{"createdBy":"guest-portal","createdAt","expiresAt"}`. Rate limit: `guestCreatePerHour` per source IP header `X-Forwarded-For` value supplied by the portal (default 20) and a global cap `guestMaxActive` (default 200).
- `POST /guest/users/{username}/delete {"password"}` → `204`. Validates the guest's own password, then deletes the account (profile removal on PCs follows via the client cleanup task). Only accounts inside the guest OU are eligible.
- `POST /guest/users/{username}/status {"password"}` → `{"username","expiresAt","enabled"}`.

## Admin routes: directory (any object, any attribute)

- `GET /ad/tree?dn=<dn>` → children of a container: `[{"dn","name","objectClass","hasChildren"}]`. No `dn` = domain root.
- `GET /ad/search?base=<dn>&filter=<ldap>&scope=sub|one|base&attrs=a,b&limit=500` → `[{"dn","attributes":{...}}]`
- `GET /ad/object?dn=<dn>` → `{"dn","objectClass":[],"attributes":{name:[values]}, "schemaAllowed":[attr names]}`. Binary values are base64 with `b64:` prefix.
- `POST /ad/object {"parentDn","objectClass","rdn":"CN=x","attributes":{}}` → `201 {"dn"}`
- `PATCH /ad/object {"dn","set":{attr:[values]},"add":{},"remove":{},"clear":[attr]}` → `200 object`
- `POST /ad/object/move {"dn","newParentDn","newRdn":optional}` → `{"dn"}`
- `DELETE /ad/object?dn=<dn>&recursive=false` → `204` (protected-from-accidental-deletion objects return `forbidden` unless `force=true`)
- `POST /ad/user/password {"dn","password","mustChange":false}` → `204`
- `POST /ad/user/enable {"dn","enabled":true}` → `204`
- `POST /ad/user/unlock {"dn"}` → `204`
- `POST /ad/group/members {"groupDn","add":[dn],"remove":[dn]}` → `204`

## Admin routes: Group Policy

- `GET /gpo` → `[{"id","displayName","status","created","modified","wmiFilter","links":[{"target","enabled","enforced","order"}]}]`
- `POST /gpo {"name","comment"}` → `201 gpo`
- `GET /gpo/{id}` → gpo plus `{"permissions":[{"trustee","permission","denied"}]}`
- `PATCH /gpo/{id} {"displayName","status":"AllSettingsEnabled|UserSettingsDisabled|ComputerSettingsDisabled|AllSettingsDisabled","comment"}`
- `DELETE /gpo/{id}` → `204`
- `GET /gpo/{id}/report?format=html|xml` → report body (`text/html` or `application/xml`)
- `POST /gpo/{id}/links {"target":"<dn>","enabled":true,"enforced":false,"order":optional}`; `PATCH` same shape; `DELETE /gpo/{id}/links?target=<dn>`
- `GET /gpo/{id}/registry?key=HKLM\...` → values (recursive) `[{"key","valueName","type","value","policyState"}]`
- `PUT /gpo/{id}/registry {"key","valueName","type":"String|ExpandString|DWord|QWord|MultiString|Binary","value"}`; `DELETE /gpo/{id}/registry?key=..&valueName=..`
- `GET|PUT|DELETE /gpo/{id}/preferences/registry` same shape, plus `context":"Computer|User","action":"Create|Replace|Update|Delete"`
- `PUT /gpo/{id}/permissions {"trustee","trusteeType":"User|Group|Computer","permission":"GpoRead|GpoApply|GpoEdit|GpoEditDeleteModifySecurity|None","replace":true}`
- `PUT /gpo/inheritance {"target","blocked":true}`
- `POST /gpo/{id}/backup` → `{"backupId","path"}`; `GET /gpo/backups`; `POST /gpo/{id}/restore {"backupId"}`; `POST /gpo/import {"backupId","targetName","createIfNeeded":true}`
- `GET /gpo/wmifilters`, `POST /gpo/wmifilters {"name","description","query"}`, `PUT /gpo/{id}/wmifilter {"name"|null}`

## Admin routes: every Administrative Template setting as GUI

- `GET /admx/categories` → category tree `[{"id","name","parentId","explain"}]` parsed from the central store `\\<domain>\SYSVOL\<domain>\Policies\PolicyDefinitions` (falls back to `C:\Windows\PolicyDefinitions`), using en-US ADML strings.
- `GET /admx/policies?category=<id>&q=<text>&class=Machine|User|Both` → `[{"id","name","class","categoryId","explain","supportedOn","key","valueName","elements":[{"id","type":"boolean|decimal|text|multiText|enum|list","label","required","min","max","maxLength","items":[{"id","label"}],"key","valueName"}]}]`
- `GET /gpo/{id}/admx/{policyId}?class=Machine|User` → `{"state":"NotConfigured|Enabled|Disabled","values":{elementId: value}}` derived from the GPO's registry values.
- `PUT /gpo/{id}/admx/{policyId} {"class","state","values"}` → writes the registry values exactly as the ADMX definition describes (enabledValue/disabledValue, element values, list deletion of stale values, `**del.` markers for disabled where the ADMX requires) through Set-GPRegistryValue/Remove-GPRegistryValue.

## Admin routes: security settings (GptTmpl.inf)

- `GET /gpo/{id}/security` → `{"sections":{"System Access":{"MinimumPasswordLength":"12",...},"Privilege Rights":{...},"Group Membership":{...},"Registry Values":{...},"Event Audit":{...},"Service General Setting":{...},"File Security":{...}}}` read from `Machine\Microsoft\Windows NT\SecEdit\GptTmpl.inf` (UTF-16 LE).
- `PUT /gpo/{id}/security {"sections":{...}}` → rewrites the file, keeps `[Unicode]` and `[Version]`, adds the security CSE pair to `gPCMachineExtensionNames`, and bumps the GPO version in both AD and `GPT.INI`.
- `GET /security/catalog` → a built-in list of known keys per section with label, type and help text (password, lockout, Kerberos policy, user rights, audit, common security options), so the portal can render forms instead of raw text.

## Admin routes: cmdlet runner (full coverage)

Anything the routes above do not cover can be done through the cmdlet runner. It only executes cmdlets from the `ActiveDirectory` and `GroupPolicy` modules, never script text.

- `GET /cmdlets` → `[{"name","module","verb","noun","parameters":[{"name","type","mandatory","sets":[]}]}]`
- `POST /cmdlets/invoke {"name":"Set-ADDefaultDomainPasswordPolicy","parameters":{"Identity":"corp.example","MinPasswordLength":12},"whatIf":false}` → `{"output":[...],"errors":[...],"warnings":[...]}` Output objects are serialized to depth 3. Switch parameters take `true`. `Remove-*`, `Clear-*`, `Reset-*`, `Restore-*`, `Disable-*` cmdlets require `"confirm":"<cmdlet name>"` in the body.

## Admin routes: samba-tool runner (Samba backend only)

- `GET /sambatool` → `[{"command":"user list","args":[{"name","flag","type","help"}]}]` an allowlist of `samba-tool` subcommands (user, group, computer, ou, contact, dns, gpo, domain passwordsettings, domain level, fsmo, dbcheck, drs showrepl, sites, spn, delegation, schema attribute show).
- `POST /sambatool/invoke {"command":"user setexpiry","args":["guest-ab12cd","--days=1"],"confirm":optional}` → `{"exitCode","stdout","stderr"}`. Arguments are passed as an argv list, never through a shell. `delete`, `remove`, `demote` and `reset` subcommands need `"confirm"` equal to the command.

## Admin routes: server management (Windows Admin Center style)

All of these act on the server the agent runs on. On the Samba backend they act on the container host where possible and report missing capabilities. Capability ids in brackets.

- Overview [`server`]: `GET /server/overview` → OS, edition (Core or Desktop), uptime, domain role, CPU/memory/disk/network totals; `GET /server/metrics` → current CPU %, memory used, per-disk read/write bytes/s, per-NIC send/receive bytes/s (portal polls every 2s for live charts); `POST /server/power {"action":"restart|shutdown","confirm":"restart|shutdown","delaySeconds":30}`; `PUT /server/identity {"computerName"}` (rename needs restart).
- Services [`services`]: `GET /server/services`; `POST /server/services/{name}/{start|stop|restart|pause|resume}`; `PATCH /server/services/{name} {"startupType":"Automatic|AutomaticDelayed|Manual|Disabled"}`.
- Processes [`processes`]: `GET /server/processes` (pid, name, cpu, memory, user, path, start time); `DELETE /server/processes/{pid}?confirm=<name>`.
- Events [`events`]: `GET /server/eventlogs` (log names with record counts); `GET /server/events?log=System&level=1,2,3&since=&q=&limit=200`; `POST /server/eventlogs/{name}/clear {"confirm":"<name>"}`; `GET /server/eventlogs/{name}/export` (evtx download).
- Files [`files`]: `GET /server/files?path=C:\`; `GET /server/files/download?path=`; `POST /server/files/upload?path=` (multipart, 500 MB cap); `POST /server/files/mkdir|rename|copy|move`; `DELETE /server/files?path=&confirm=<leaf name>`; `GET|PUT /server/files/acl?path=`; `GET /server/files/hash?path=`.
- Firewall [`firewall`]: `GET /server/firewall/profiles`, `PATCH /server/firewall/profiles/{Domain|Private|Public}`; `GET /server/firewall/rules?q=`; `POST /server/firewall/rules`; `PATCH|DELETE /server/firewall/rules/{name}`.
- Roles and features [`features`]: `GET /server/features`; `POST /server/features/install {"names":[],"includeManagementTools":true,"restart":false}`; `POST /server/features/uninstall`. Long operations return `202 {"jobId"}`; `GET /jobs/{jobId}` → `{"state":"Running|Completed|Failed","progress","output","errors"}`.
- Updates [`updates`]: `GET /server/updates` (installed + available via the Windows Update Agent COM API); `POST /server/updates/scan`; `POST /server/updates/install {"ids":[]}` (job); `GET|PUT /server/updates/settings`.
- Storage [`storage`]: `GET /server/disks`, `GET /server/volumes`, `GET /server/partitions`; `POST /server/disks/{number}/initialize`, `/online`, `/offline`; `POST /server/volumes` (new partition and format), `PATCH /server/volumes/{id}` (label, resize), `POST /server/volumes/{id}/format {"confirm"}`; `GET|POST|DELETE /server/shares` (SMB shares and share permissions).
- Networks [`network`]: `GET /server/network/adapters`; `PATCH /server/network/adapters/{ifIndex}` (enable/disable, DHCP or static IPv4/IPv6, gateway, DNS servers); `GET /server/network/routes`; `POST /server/network/test {"target","port"}` (Test-NetConnection).
- Registry [`registry`]: `GET /server/registry?path=HKLM:\SOFTWARE` (subkeys and values); `PUT /server/registry/value {"path","name","type","value"}`; `DELETE /server/registry/value`; `POST /server/registry/key`; `DELETE /server/registry/key?path=&confirm=<leaf>`; `GET /server/registry/export?path=` (.reg).
- Scheduled tasks [`tasks`]: `GET /server/tasks?path=\`; `GET /server/tasks/{path}/{name}` (actions, triggers, settings, history); `POST /server/tasks` (create from structured definition); `POST /server/tasks/{path}/{name}/{run|end|enable|disable}`; `DELETE`.
- Certificates [`certificates`]: `GET /server/certificates?store=LocalMachine\My`; `POST /server/certificates/import` (pfx/cer upload + password); `GET /server/certificates/{thumbprint}/export`; `DELETE`; `POST /server/certificates/selfsigned {"dnsNames":[],"years":5}`.
- Devices [`devices`]: `GET /server/devices` (PnP devices, status, driver); `POST /server/devices/{instanceId}/{enable|disable}`.
- Local users and groups [`localusers`]: on a domain controller these are domain accounts, so this route reports `notApplicable`; on member servers: `GET|POST|PATCH|DELETE /server/localusers`, `/server/localgroups`, members.
- DNS server [`dns`]: `GET /dns/zones`; `POST|DELETE /dns/zones`; `GET /dns/zones/{zone}/records?type=`; `POST|PATCH|DELETE /dns/zones/{zone}/records`; `GET|PUT /dns/forwarders`; `POST /dns/cache/clear`.
- DHCP server [`dhcp`] (only when the DHCP role is installed): scopes, options, leases, reservations CRUD under `/dhcp/...` mirroring the DhcpServer cmdlets.
- Performance monitor [`perfmon`]: `GET /server/counters?set=` (counter sets and paths); `POST /server/counters/sample {"paths":[],"samples":1}`.
- PowerShell console [`console`]: `POST /server/console/sessions` → `{"sessionId"}`; `POST /server/console/sessions/{id}/run {"command"}` → `{"output","errors","prompt"}`; `DELETE /server/console/sessions/{id}`. Admin-only, runs as LocalSystem on the server, every command written to the audit log with the acting user, sessions expire after 20 minutes idle. Requires a fresh password confirmation (`POST /auth/confirm {"password"}` → short-lived `X-TempDesk-Elevation` token, 10 minutes) because it is full control of the domain controller.
- Generic module runner [`cmdlets-all`]: `GET /cmdlets?scope=all` lists every installed module's cmdlets; `POST /cmdlets/invoke` accepts any of them when `scope=all` and an elevation token is present. This is the escape hatch for anything without its own page.

## Admin routes: TempDesk settings and presetup

- `GET|PUT /settings` → the full settings document (see `server/config/settings.default.json`).
- `GET /guests` → all guest accounts with `{"username","displayName","created","expiresAt","enabled","lastLogon"}`; `POST /guests` (same as guest create but admin may pass any `minutes`); `DELETE /guests/{username}`; `POST /guests/{username}/extend {"minutes":0|n}`.
- `GET /wifi` → `[{"id","ssid","auth":"WPA2PSK|WPA3SAE|open","hidden":false,"autoConnect":true}]` (keys never returned); `PUT /wifi/{id} {"ssid","auth","key","hidden","autoConnect"}`; `DELETE /wifi/{id}`. Profiles are written as WLAN XML to `\\<domain>\SYSVOL\<domain>\TempDesk\wifi\` with an ACL readable only by Domain Computers and Domain Admins.
- `GET /scripts?kind=startup|logon` → `[{"name","kind","size","modified"}]`; `GET /scripts/{kind}/{name}` → `{"content"}`; `PUT /scripts/{kind}/{name} {"content"}`; `DELETE /scripts/{kind}/{name}`. Only `.ps1` and `.cmd` names matching `^[A-Za-z0-9._-]{1,64}$`.
- `GET|PUT /allowlist` → `{"enabled":true,"apps":["msedge.exe","WINWORD.EXE",...]}`. Writes the guest GPO `RestrictRun` list.
- `GET /audit?limit=200` → recent agent event-log entries.
