# TempDesk app host

An app host is a Windows Server that runs the apps TempDesk streams. Guests start an app from the portal, and it opens either in the browser (through Guacamole, see `streaming/README.md`) or in the Windows Remote Desktop client from a downloaded `.rdp` file. Only the app window appears, not a full desktop. This is RemoteApp, the same technology AppsAnywhere and Azure Virtual Desktop use.

## When you need one

You need an app host only if you want app streaming. Guests who sign in at a TempDesk PC do not need it. Add one when you want guests to use a program from their own laptop, a Chromebook or a phone, or from a PC that does not have the program installed.

## Requirements

- Windows Server 2025 **with Desktop Experience**. Server Core cannot be a Remote Desktop Session Host, so the role install fails there.
- Joined to the TempDesk domain, so guest accounts can sign in.
- **Never the domain controller.** Running guest sessions on a DC gives guests an interactive session on the machine that holds every password in the domain, and Microsoft does not support the RD Session Host role on a DC. The script refuses to run on one.
- Network: the Guacamole server must reach the app host on TCP 3389. Users who download `.rdp` files must reach it too (or go through an RD Gateway).

## Licensing (RDS CALs)

Windows Server allows two simultaneous administrative remote sessions without extra licensing. Anything else, including every guest session, needs a Remote Desktop Services client access license (RDS CAL) per user, served by an RD license server.

- After the RD Session Host role is installed there is a 120-day grace period. When it ends, sessions are refused until a license server with CALs is configured.
- Use **Per User** CALs. The script sets Per User mode. Temporary guests come and go, and Per User licenses are not strictly tracked per account, which suits that pattern; check your agreement with Microsoft.
- Pass `-LicenseServer <name>`. If the name is this server, the script installs the RD Licensing role here too. You then activate the license server and install CALs with the Remote Desktop Licensing Manager (`licmgr.exe`).

## Single-user alternative: Windows 11 Pro

For a small setup, a domain-joined Windows 11 Pro or Enterprise PC can serve RemoteApps to **one session at a time** without RDS CALs. Enable Remote Desktop, add the guest group to Remote Desktop Users and write the same `TSAppAllowList` entries (the script's RemoteApp section works; the role steps do not apply, so the script refuses client Windows and you would do these parts by hand). A second user signing in disconnects the first, so this only fits a single kiosk-style use.

## Running the script

Run as a domain admin in an elevated PowerShell on the app host:

```powershell
.\Install-AppHost.ps1 -SettingsPath .\settings.json -LicenseServer lic01.corp.example -Reboot
```

or with an explicit list:

```powershell
.\Install-AppHost.ps1 -AppsJson '[{"id":"notepad","name":"Notepad","program":"||notepad","hostPath":"C:\\Windows\\System32\\notepad.exe"}]'
```

What it does, each step skipped when already done:

1. Checks the server: not a DC, not Server Core, domain joined.
2. Installs `RDS-RD-Server` (and `RDS-Licensing` when asked).
3. Sets licensing mode Per User and the license servers (WMI `Win32_TerminalServiceSetting` when available, and always the policy values `LicensingMode = 4` and `LicenseServers` under `HKLM\SOFTWARE\Policies\Microsoft\Windows NT\Terminal Services`).
4. Turns on Remote Desktop, Network Level Authentication and TLS, and enables the "Remote Desktop" firewall rule group.
5. Adds the guest group (default `TempDesk Guests`, or `guestGroup` from the settings) to the local Remote Desktop Users group.
6. Publishes each app as `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Terminal Server\TSAppAllowList\Applications\<alias>` with `Name`, `Path`, `VPath`, `ShowInTSWA`, `CommandLineSetting` and `RequiredCommandLine`, and sets `fDisabledAllowList = 0` so only listed programs can be started as RemoteApps. This does not need a full RDS deployment (no Connection Broker, no RD Web Access).
7. Restarts when `-Reboot` is given and the role install needs it.

Only apps whose `host` matches this machine (its short name, full DNS name or one of its IP addresses) are published, so one settings file can describe several app hosts. Each app needs:

- `program`: the alias as `||alias`. Full paths are skipped because the allow list blocks them.
- `hostPath`: the full path of the program on the app host, for example `C:\Program Files\LibreOffice\program\soffice.exe`. The program must already be installed.
- `arguments` (optional): fixed arguments. When set, `CommandLineSetting = 2` forces exactly these arguments; otherwise `CommandLineSetting = 0` refuses arguments from the client.

`-RemoveUnlisted` deletes entries this script created earlier (it marks them with `TempDeskManaged = 1`) that are no longer in the list. Entries you created yourself are never touched.

## How apps appear in the portal

The app list lives in the TempDesk settings under `"apps"` (edited in the admin portal). Each signed-in guest sees the enabled apps whose `groups` list contains one of their groups, or every enabled app when `groups` is empty. Each app has two buttons: **Open in browser** (Guacamole) and **Download .rdp**. Run this script again after you add or change apps so the app host allow list matches.

## Security notes

- **NLA stays on.** Users authenticate before a session is created, which blocks unauthenticated resource use and many pre-auth attacks. The portal's default `rdpSecurity` is `nla`.
- **Use a certificate clients trust.** By default the RDP listener uses a self-signed certificate. Issue one from your CA (or a public CA for the app host's DNS name) and bind it to RDP, for example through the Group Policy setting "Server authentication certificate template" or by setting `SSLCertificateSHA1Hash` on the `Win32_TSGeneralSetting` WMI class. Then `ignoreCert` can stay `false` in the app catalog and Guacamole verifies the server. Only set `ignoreCert` to `true` on a trusted test network.
- **Guests stay standard users.** Do not add the guest group to Administrators or any privileged group. Remote Desktop Users only grants the right to sign in over RDP.
- **Guest user policy follows the user.** The TempDesk guest GPO is linked to the guest OU and applies at sign-in on any computer, so the `RestrictRun` allow list, logoff timers and other user settings apply on the app host as well. Add the RemoteApp programs (and `rdpinit.exe`, `rdpshell.exe`, `rdpclip.exe`) to the allow list in the admin portal, or guests cannot start them.
- **Clipboard, printers and drives.** Drive redirection is always off. Printing is off unless the app enables it. Clipboard follows each app's `disableCopy` and `disablePaste` flags.
- **Keep the app host patched** and treat it like any server guests can reach: no admin tools on the allow list, no shared drives with sensitive data.
