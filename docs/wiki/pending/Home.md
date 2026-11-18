# TempDesk operator wiki

Start here to deploy shared computers, set up temporary sign-ins, and verify remote checkout.

## Deploy and operate

- [TempDesk overview and setup](../../../README.md) explains the main components and deployment choices.
- [Server management](../../SERVER.md) explains the server console, supported routes, and operational limits.
- [Security](../../SECURITY.md) describes the permissions and credential boundaries.
- [Operator guide index](../../features/README.md) organizes common tasks.
- [API diagnostics with Postman](../../features/http-api/README.md) shows how to check service health and authorized reads.
- [Agent API](../../API.md) documents the service endpoints and authentication model.
- [Read the documentation offline](../../OFFLINE-GUIDE.md) explains the standalone reader and its local settings.

## Verify Virtual Commons

Read [Use Virtual Commons](../../VIRTUAL-COMMONS.md) to choose a server edition, configure reachable destinations, and check expiry. Before sharing the portal URL, verify that both expected editions are available from the client network. Open a downloaded file for each edition and confirm that the temporary sign-in reaches the correct session host.

The project README includes a guest sign-in walkthrough for verifying account creation and deletion at a kiosk. A Remote Desktop checkout additionally requires a reachable session host and a desktop sign-in test.

- [Configure the destinations](../../VIRTUAL-COMMONS.md#configure-the-destinations) to make each edition available.
- [Apply the settings](../../VIRTUAL-COMMONS.md#apply-the-settings) using the instructions for the portal host.
- [Verify a checkout](../../VIRTUAL-COMMONS.md#verify-a-checkout) from the client network.
