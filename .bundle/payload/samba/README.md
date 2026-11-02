# TempDesk Lite (Samba)

TempDesk Lite is a single Docker container that *is* your Active Directory
domain controller. It runs a Samba 4 AD DC and, next to it, a Python
version of the TempDesk agent that speaks the same API as the Windows
agent (`docs/API.md`). The guest and admin portals work against it
without changes; sections Samba cannot support are hidden automatically
through the `/health` capabilities list.

Use it when you want TempDesk for a small site, a classroom or a lab and
do not want to license, install and patch Windows Server.

## Lite or Windows Server Core?

| | TempDesk Lite (Samba) | Windows Server Core |
| --- | --- | --- |
| Cost | Free | Windows Server license plus CALs |
| Host | Any Linux host with Docker | A Windows Server VM or machine |
| Functional level | 2008 R2 maximum | Up to Windows Server 2025 |
| PowerShell AD module, Active Directory Web Services | No | Yes |
| ADUC, GPMC, DNS Manager from a domain joined PC (RSAT) | Yes | Yes |
| TempDesk guest accounts, directory editor, GPO links, registry policy, Administrative Templates, security templates, Wi-Fi, scripts, allowlist | Yes | Yes |
| TempDesk Group Policy Preferences and WMI filter editing | No | Yes |
| TempDesk cmdlet runner | No (a `samba-tool` runner instead) | Yes |

Choose Windows Server if you need a functional level above 2008 R2,
the PowerShell AD module or AD Web Services (some third party tools need
them), Group Policy Preferences or WMI filters managed from TempDesk, or
if your organisation's policy says domain controllers must be Windows.

## Limits to know about

- **Functional level 2008 R2.** Samba AD tops out at the Windows Server
  2008 R2 domain and forest functional level. Windows 10 and 11 clients
  join and work normally.
- **No AD Web Services.** That means no `Get-ADUser` and the other
  PowerShell ActiveDirectory cmdlets against this DC, and no Active
  Directory Administrative Center. The classic RSAT GUI tools (Active
  Directory Users and Computers, Group Policy Management, DNS) do work
  from a domain joined Windows PC.
- **No GPP or WMI filters in TempDesk.** You can still edit Group Policy
  Preferences and WMI filters with GPMC from a Windows PC; TempDesk just
  does not offer those editors on Samba.
- **Linux host required.** Docker Desktop on Windows or macOS cannot give
  the container its own LAN address, so the clients could not reach it.
- **Back up the volumes.** The domain lives in the `samba-data`,
  `samba-etc` and `tempdesk-data` volumes. Losing them means losing the
  domain. Stop the container (or use `samba-tool domain backup offline`)
  and copy all three regularly.
- **One DC.** This image is built for a single domain controller. Adding
  a second Samba DC is possible with `samba-tool domain join`, but it is
  not automated here.
- **"User cannot change password"** for guests is set the same way ADUC
  does it: two deny ACEs for the Change Password right (SELF and Everyone)
  on the user object.

## Why the container needs its own IP address (macvlan)

Windows clients talk to a domain controller on a lot of ports, all on the
DC's own address: DNS 53, Kerberos 88 and 464, LDAP 389 and 636, SMB
445, RPC endpoint mapper 135 plus the dynamic RPC range 49152 to 65535,
Global Catalog 3268 and 3269, and NTP 123. Publishing all of that through
the Docker host would clash with services the host already runs (for
example its own DNS resolver on 53) and the dynamic RPC range cannot be
published sensibly.

So `compose.yaml` attaches the container to a **macvlan** network: it
appears on your LAN as a separate machine with its own MAC and IP
address (`DC_IP`), and clients reach it directly.

### The macvlan caveat: the host cannot reach the container

With macvlan, the Docker host itself cannot talk to the container's IP
(other machines on the LAN can). If the TempDesk portals run on the same
host, or you want to run `smbclient` from the host, add a small macvlan
"shim" interface on the host and route the DC's address through it:

```sh
# Replace eth0, 192.168.1.21 (a free address for the host shim) and
# 192.168.1.20 (DC_IP) with your values.
sudo ip link add tempdesk-shim link eth0 type macvlan mode bridge
sudo ip addr add 192.168.1.21/32 dev tempdesk-shim
sudo ip link set tempdesk-shim up
sudo ip route add 192.168.1.20/32 dev tempdesk-shim
```

These commands do not survive a reboot. Make them permanent with your
distribution's network configuration (a systemd-networkd `.netdev` and
`.network` pair, NetworkManager, or `/etc/network/interfaces`).

Some Wi-Fi adapters and most cloud networks do not allow the extra MAC
addresses macvlan needs. Use a wired interface on a network you control.

## Setup

1. On a Linux host with Docker and Docker Compose, from this folder:

   ```sh
   cp .env.example .env
   nano .env                      # names, DC_IP, LAN interface, subnet, gateway
   mkdir -p secrets
   install -m 600 /dev/null secrets/admin_password
   nano secrets/admin_password    # the domain Administrator password, one line
   docker compose up -d --build
   docker compose logs -f dc
   ```

   Pick a `DC_IP` outside your router's DHCP pool. The password needs at
   least 8 characters and three of: upper case, lower case, digit,
   symbol. It is read from the Docker secret file on first start only and
   is never stored in the image or in environment variables.

2. The first start takes a minute or two. It provisions the domain
   (`samba-tool domain provision --use-rfc2307 ...` with the internal DNS
   server and your forwarder), then creates:

   - `OU=TempDesk`, `OU=Guests,OU=TempDesk`, `OU=Computers,OU=TempDesk`
   - groups `TempDesk Guests` and `TempDesk Admins` (with `INITIAL_ADMIN`,
     by default Administrator, as a member)
   - the GPOs `TempDesk - Guest User Policy` (linked to the guest OU) and
     `TempDesk - Guest Computers` (linked to the computers OU)
   - SYSVOL folders `TempDesk\wifi` (readable only by Domain Computers,
     Domain Admins, Administrators and SYSTEM), `TempDesk\scripts\startup`,
     `TempDesk\scripts\logon` and `TempDesk\client` (filled from the
     repository's `client/` folder, mounted read only)
   - `/var/lib/tempdesk/agent.json` with the guest key, the admin key and
     the token signing secret, `settings.json` from the default template,
     and a self signed agent certificate
   - a `tempdesk-svc` account the agent uses for `samba-tool` commands
     that go over the network; its random password rotates on every start

   Every later start checks these again and only fills in what is missing,
   so restarting or upgrading the image is safe. LDAP over TLS (port 636)
   is enabled with Samba's own self signed certificate.

3. Wait until `docker compose ps` shows the container as `healthy`.

## Join a Windows PC to the domain

1. On the PC, set the DNS server of its network adapter to the DC's IP
   (`DC_IP`). Better: hand out `DC_IP` as the DNS server from your
   router's DHCP settings so every PC gets it automatically.
2. Check it works: `nslookup lab.example.org` should answer with `DC_IP`.
3. Open **Settings > System > About > Domain or workgroup** (or run
   `sysdm.cpl`), choose **Change**, select **Domain**, enter the domain
   name and sign in with the Administrator account.
4. Restart the PC. Move it into `OU=Computers,OU=TempDesk` (with ADUC or
   the TempDesk admin portal) so the guest computer policy applies.

## Point the TempDesk portals at it

Inside the container (or from the `tempdesk-data` volume):

```sh
docker compose exec dc cat /var/lib/tempdesk/agent.json
docker compose cp dc:/var/lib/tempdesk/agent-cert.pem ./agent-cert.pem
```

Then configure the portals:

- `AGENT_URL=https://<DC_IP>:8443`
- `AGENT_CA_FILE=` the path where you mounted `agent-cert.pem`
- guest portal: `guestKey` from `agent.json`
- admin portal: `adminKey` from `agent.json`

Admins sign in to the admin portal with their domain user name and
password; they must be members (directly or through nested groups) of
`TempDesk Admins`.

Keep `agent.json` private: anyone with the admin key and a domain admin
password can manage the domain through the agent.

## Administrative Templates (ADMX)

Samba does not ship the Windows ADMX files. To use the Administrative
Templates editor in the admin portal, copy a central store into SYSVOL
from a Windows 10 or 11 PC (or download the current "Administrative
Templates (.admx) for Windows" package from Microsoft):

```
\\<domain>\SYSVOL\<domain>\Policies\PolicyDefinitions\*.admx
\\<domain>\SYSVOL\<domain>\Policies\PolicyDefinitions\en-US\*.adml
```

Copy over SMB as a domain admin so the files get the right ACLs. Until the
folder exists, the ADMX lists are empty.

## What the agent does differently on Samba

- **Audit log.** Instead of the Windows event log, every admin call,
  sign-in and guest lifecycle event is appended as one JSON object per
  line to `/var/lib/tempdesk/audit.log` and shown by `GET /audit`.
- **GPO reports** (`/gpo/{id}/report`) are a simple HTML or XML summary
  built by the agent from `Registry.pol`, `GptTmpl.inf` and the links,
  because `Get-GPOReport` does not exist on Linux.
- **GPO backups** are stored in `/var/lib/tempdesk/gpo-backups`, each
  with the agent's own copy and a native `samba-tool gpo backup` copy.
- **samba-tool runner.** `GET /sambatool` lists the allowed subcommands;
  `POST /sambatool/invoke` runs them as an argument list (never through a
  shell) with a 60 second timeout and 1 MB output cap. Options that would
  change the config file, database URL or credentials are refused.
  Commands that delete, remove, demote or reset need `"confirm"` set to
  the command name.
- **Expired guests** are deleted by a reaper inside the agent every
  `reaperIntervalMinutes`.

## Development

The agent code lives in `agent/tempdesk_agent/`. The HTTP layer
(`server.py`), the request logic (`app.py`) and the backends are
separate: `SambaBackend` needs the Samba Python bindings, while
`FakeBackend` runs anywhere and backs the tests.

```sh
cd samba
python3 -m pytest tests
```

The tests cover the Registry.pol reader and writer, version and client
side extension handling, gPLink parsing, guest name and password rules,
tokens, lockout and rate limits, key routing, the samba-tool allowlist,
ADMX mapping, SYSVOL file editing and an HTTP round trip.
