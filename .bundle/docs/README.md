# TempDesk

Temporary, self-service sign-ins for shared Windows computers, on an Active Directory domain you deploy in one go.

> Work in progress. The full README, setup guide and website land as the components are finished.

- `server/`: Windows Server 2025 Core first-boot, forest creation, domain setup, guest reaper
- `agent/`: the TempDesk Agent Windows service (HTTP API for every directory, Group Policy and server operation)
- `samba/`: TempDesk Lite, a Samba 4 domain controller container with the same API
- `portal/`: guest portal and admin console (one Docker image, two modes)
- `streaming/`: app streaming to the browser (Apache Guacamole) and RemoteApp files
- `client/`: scripts that run on the shared PCs (Wi-Fi, apps, sign-out at expiry, profile cleanup)
- `deployer/`: the Windows deployment app
- `docs/`: API contract and guides

License: MIT.
