# Check TempDesk over HTTP

Import the [master Postman collection](https://github.com/Ding-Ding-Projects/tempdesk-/blob/main/docs/features/http-api/tempdesk.postman_collection.json) to use both categories, or use the [Agent collection](https://github.com/Ding-Ding-Projects/tempdesk-/blob/main/docs/features/http-api/agent.postman_collection.json) or [Portal collection](https://github.com/Ding-Ding-Projects/tempdesk-/blob/main/docs/features/http-api/portals.postman_collection.json) alone. Use the linked file's Download raw file control and import that file. In an offline source checkout, import the adjacent JSON files directly.

## Windows or Samba agent

Set `AGENT_BASE_URL` to the URL through `/api/v1` without the trailing slash. Set `AGENT_GUEST_KEY` to the guest key for this agent. Samba requires that key for public reads. Start with **Read agent health** and **Read public guest settings**. Inspect the reported backend and capability list before using a directory or policy request. Server-management and some Group Policy capabilities differ between the backends. Use an authorized admin key and a valid operator bearer token for authenticated folder requests. The [Agent API](../../API.md) specifies authentication, request bodies, success and failure responses and capability-dependent operations.

## Guest and management portals

Set `GUEST_PORTAL_URL` and `MANAGEMENT_PORTAL_URL` to the matching installation origins without trailing slashes. Health requests return a minimal service status. Management reads also need a valid management session cookie in the Postman cookie jar. A sign-in redirect, 401 or 403 indicates that the request lacks a suitable session or permissions. The browser portal uses session state and CSRF protection on forms. Perform management writes and guest account issuance through the official interfaces.

## Credential handling and verification

Keep keys, session credentials and target details in local protected Postman values. Use HTTPS with normal certificate verification where deployed, and import your approved certificate for a private CA. Avoid running the requests against an unintended host, exporting populated environments or sharing raw responses, which can contain directory information.

The collections cover read-only service and operator diagnostics. The API reference documents the remaining endpoints, including writes. Remote Desktop and Guacamole connections use their normal clients and do not belong to this HTTP diagnostics collection. Collection requests were mapped from the route source. Live Postman execution remains pending.
