# Security model

TempDesk hands out real Active Directory accounts to anyone on your network. Read this before deploying.

## Trust boundaries

| Component | Runs as | Can do |
| --- | --- | --- |
| TempDesk Agent (Windows) | LocalSystem on the domain controller | Everything in the domain. Treat its admin key like a Domain Admin password. |
| TempDesk Lite agent (Samba) | root in the domain controller container | Everything in the domain. |
| Guest portal | Its container user, or NETWORK SERVICE when hosted natively | Only the guest routes: create a guest in the guest OU, delete or check a guest with that guest's own password. |
| Admin console | Its container user, or NETWORK SERVICE when hosted natively | Everything the agent can do, but only after an admin signs in with an account in `TempDesk Admins`. |
| Guests | Standard domain users in `OU=Guests,OU=TempDesk` | What a standard user can do on a joined PC, limited further by the guest policy and app allowlist. |

The guest key is rejected on every admin route, even with a valid session token. The PowerShell console and the all-modules cmdlet runner also need a fresh password confirmation and are written to the audit log.

## Plain HTTP by default

By the owner's choice the agent and portals speak plain HTTP so no certificate is needed. On plain HTTP, agent keys, admin sign-ins, guest passwords and Wi-Fi keys cross the network unencrypted. Mitigations, from strongest:

1. Host the portals natively on the server (`portals.mode = native`): the agent keys then never leave the machine.
2. Put the domain controller and portals on their own network segment or VLAN.
3. Turn TLS on for the agent (`agent\install.ps1 -Tls`) and put the portals behind an HTTPS reverse proxy.

Windows Firewall: the agent and native portal ports are open on the Domain and Private profiles, and on the Public profile for the local subnet only. The Public rule exists because a new Windows Server 2025 domain controller can stay on the Public profile; remove the rules whose names end in "Public profile, local subnet" if your server always lands on the Domain profile and you do not want them.

PowerShell remoting used by the Deployer stays on HTTP port 5985; Windows encrypts that traffic at the message level with the Negotiate session keys.

## Secrets at rest

- `autounattend.xml` holds the Administrator password in Windows' base64 encoding, which is not encryption. `TempDesk\firstboot.json` on the install media holds the DSRM password in plain text. Erase or destroy the media after installing. The server scrubs both passwords from its local copy when setup finishes.
- Guest-PC answer files that join the domain hold the join account's password in plain text. Use a dedicated account that can only join computers to `OU=Computers,OU=TempDesk`.
- `C:\ProgramData\TempDesk\agent.json` (keys) is readable by SYSTEM and Administrators only.
- Wi-Fi profiles and computer startup scripts on SYSVOL are readable by Domain Computers and Domain Admins only, never by guests.
- Guest passwords are shown once and never stored by TempDesk.

## Guests

- Never administrators. A local administrator could read other profiles, install malware, collect cached credentials and undo the expiry.
- Accounts expire through AD's own `accountExpires`; the session watcher signs out expired, disabled or deleted guests; the profile cleanup removes their files; the reaper deletes the accounts.
- The guest portal is open to anyone on the LAN by the owner's choice. It is rate limited per address and capped by `guestMaxActive`.

## Reporting

Open a private security advisory on the GitHub repository rather than a public issue.
