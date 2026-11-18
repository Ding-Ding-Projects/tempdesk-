# TempDesk verification handoff

The guest and management containers were rebuilt from `3a18b69c04ceace56d70d694b5d8181de63ec9b3`. Both returned HTTP 200 from the test network. The guest walkthrough exercised a one-hour account with the real Samba backend, checked its active status, and deleted it using the kiosk. The PNG hashes and capture settings are in the [capture inventory](docs/evidence/guest-sign-in-inventory.json).

Server Core answered for its intended Active Directory domain and reported a synchronized directory with a ready global catalog. Its TempDesk agent returned a healthy Windows backend response. The lab kiosk currently uses Samba. A Windows-backed account-creation run requires a kiosk configured with the Windows agent's approved certificate and guest access.

The Windows 11 test client was powered off during the latest verification. Its domain membership and desktop sign-in remain open. The separate Desktop Experience host still needs its Remote Desktop session-host setup confirmed. Track both in the [roadmap](ROADMAP.md).
