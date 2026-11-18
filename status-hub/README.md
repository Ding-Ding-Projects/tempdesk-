# Desktop status reporting

Open **Status Hub** in the Deployer title bar to see the most recent service acknowledgment, its timestamp and the session identifier. Refresh reads the local client receipt. It never creates another session. A missing timestamp means the service has not acknowledged a request in this process.

An operator enables reporting by configuring the trusted desktop process before launch:

| Setting | Value |
| --- | --- |
| `TEMPDESK_STATUS_CLIENT` | Absolute path to the operator-installed supported JavaScript client entrypoint, `status-hub-client.cjs`. Keep it and its sibling modules in a directory writable only by the operator. |
| `STATUS_HUB_URL` | Operator-selected HTTPS service address. |
| `AGENT_INGEST_TOKEN` | Enrollment credential supplied privately to the process. Never include it in command arguments, frontend assets or an exported settings file. |

Install the client with its supported private-emission module using the client's installation instructions. The client owns enrollment, validation, retry and heartbeat behavior. The deployed application reports the product version, project identity and desktop session lifetime. It does not upload deployment output, commands, directory objects or account information. Without the three settings the desktop starts normally and makes no service request.

The Discord bridge and verified panic destinations belong to the central service owner. The desktop does not configure webhooks or claim delivery to Discord. Device display updates are suspended centrally. The offline documentation and public website have no enrollment credential.
The signed-in administration portal has a Status Hub navigation entry. Set TEMPDESK_STATUS_PROJECT_URL on the portal host to the HTTPS project record. Opening it uses the normal service authentication. When a desktop deployment finishes the reporting client sends its observed outcome and exit code.
