# TempDesk operator wiki

Start here to deploy shared computers, set up temporary sign-ins, and verify remote checkout.

## Deploy and operate

- [TempDesk overview and setup](../../../README.md) explains the main components and deployment choices.
- [Server management](../../SERVER.md) explains the server console, supported routes, and operational limits.
- [Run a published portal image](../../../portal/README.md#run-a-published-image) covers the release receipt, configuration, startup and verification.
- [Host on Windows](../../../portal/README.md#host-on-windows) covers background startup and the keyboard controls for portal logs.
- [Serve the portals over HTTPS](../../features/http-api/portal-https.md) covers the Portal Host wizard, certificate selection, LAN bindings, and verification from a client.
- [Published lab update evidence](../../evidence/portal-rollout-v133.json) records both healthy v1.0.133 portals and a temporary guest sign-in lifecycle. The [v1.0.126 receipt](../../evidence/portal-rollout-v126.json) records the guest Settings matrix.
- [Build and configure a bootable appliance](../../../portal/README.md#build-a-bootable-appliance) covers the pinned release receipt, guest configuration volume and LAN checks.
- [Security](../../SECURITY.md) describes the permissions and credential boundaries.
- [Operator guide index](../../features/README.md) organizes common tasks.
- [API diagnostics with Postman](../../features/http-api/README.md) shows how to check service health and authorized reads.
- [Agent API](../../API.md) documents the service endpoints and authentication model.
- [Read the documentation offline](../../OFFLINE-GUIDE.md) explains the standalone reader and its local settings.

## Verify Virtual Commons

Read [Use Virtual Commons](../../VIRTUAL-COMMONS.md) to choose a computer, configure reachable destinations, and check expiry. Before sharing the portal URL, verify each destination expected to be available from the client network. Open a downloaded file for each destination and confirm that the temporary sign-in reaches the correct session host.

The project README includes a guest sign-in walkthrough for verifying account creation and deletion at a kiosk. A Remote Desktop checkout additionally requires a reachable session host and a desktop sign-in test.

- [Configure the destinations](../../VIRTUAL-COMMONS.md#configure-the-destinations) to make each edition available.
- [Add a Kiosk Windows 11 workstation](../../VIRTUAL-COMMONS.md#add-a-kiosk-windows-11-workstation) for a single-seat Remote Desktop checkout.
- [Change display and wording feedback](../../VIRTUAL-COMMONS.md#change-display-and-wording-feedback) in guest Settings.
- [Apply the settings](../../VIRTUAL-COMMONS.md#apply-the-settings) using the instructions for the portal host.
- [Verify a checkout](../../VIRTUAL-COMMONS.md#verify-a-checkout) from the client network.
