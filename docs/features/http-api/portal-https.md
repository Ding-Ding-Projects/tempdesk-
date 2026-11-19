# Serve the portals on your LAN over HTTPS

The optional Docker Compose overlays give the guest kiosk and management console direct HTTPS listeners. Each role mounts its own certificate chain and private key read-only. Both roles bind only the selected host address and each uses one published port. The authenticated forms and role-specific storage remain part of the existing Compose deployment.

## Choose the name and files

Use Docker Compose 2.24.4 or later for named port replacement. Choose a LAN address assigned to the host and a client-facing DNS name that resolves to it. Obtain a server certificate for that name for each role. Keep the PEM files in a protected directory outside the checkout and image build context. The role process runs as UID/GID 10001 and needs read access to the files it mounts. If you use a private issuer, arrange trust on the clients through your normal certificate distribution process.

## Use the Portal Host wizard

1. Check Docker and Compose, then select the accepted publication receipt and your existing configuration directory.
2. In **Configuration**, set **Portal transport** to **HTTPS**. Enter the DNS name from the certificates, or the LAN IPv4 address if both certificates include it as an IP subject alternative name. Choose one PEM certificate chain and its matching PEM private key for each portal. Choose an issuer bundle if this deployment uses a private issuer.
3. Choose **Verify certificates and continue**. The wizard checks both names and validity periods, matches each private key, and verifies the chains against the selected issuer bundle or the operating system roots. If a file changes or becomes unavailable, choose the correct file again before starting.
4. Select the LAN address and two distinct ports. Review shows the proposed guest address at `/` and the management address at `/login`. Each link becomes available after its own running service, version, and HTTPS check succeed. A saved project can recheck both endpoints without starting containers.

The wizard keeps the selected file paths in its local profile. It displays selection status in place of certificate and key paths. **Clear issuer bundle** switches verification back to system trust. Browsers on the LAN need their own trust in the issuer before they can open the links. HTTP is the default for a new configuration. HTTPS will fail if its selected transport or credentials cannot be used. The Windows endpoint check also verifies revocation. If the wizard reports that revocation status is unknown, make the issuer's revocation information reachable and recheck the existing endpoints.

## Set the Compose variables

| Variable | Value |
| --- | --- |
| `TEMPDESK_LAN_ADDRESS` | The intended host address. |
| `TEMPDESK_PORTAL_TLS_NAME` | The client-facing name on both server certificates. |
| `TEMPDESK_GUEST_TLS_CERT_FILE`, `TEMPDESK_GUEST_TLS_KEY_FILE` | The guest certificate chain and private key paths. |
| `TEMPDESK_MANAGEMENT_TLS_CERT_FILE`, `TEMPDESK_MANAGEMENT_TLS_KEY_FILE` | The management certificate chain and private key paths. |
| `TEMPDESK_GUEST_TLS_PORT`, `TEMPDESK_MANAGEMENT_TLS_PORT` | Optional host ports. The defaults are 8080 and 8081. |
| `TEMPDESK_PORTAL_TLS_CA_FILE` | The issuer CA bundle path when listener health checks need private CA trust. |

## Start the published image

Use your existing project directory, role environment files, volumes, and the digest from its accepted publication receipt. Add `compose.tls.yaml` to the normal published-image invocation. Add `compose.tls-ca.yaml` after it when the loopback health check needs a private issuer. `TEMPDESK_PORTAL_DIGEST` comes from the accepted publication receipt using the [published-image procedure](../../../portal/README.md#run-a-published-image).

```sh
docker compose -f compose.yaml -f compose.published.yaml -f compose.tls.yaml pull
docker compose -f compose.yaml -f compose.published.yaml -f compose.tls.yaml up -d --wait
```

On Windows, set `TEMPDESK_PORTAL_COMPOSE_OVERRIDES` to the absolute TLS overlay paths, separated by semicolons, and use `host.bat --detached` or `host.bat --logs`. Retain any existing project overlays. The launcher uses Windows curl to verify each resolved HTTPS endpoint against the selected address and its configured issuer bundle or system trust. Keep the certificate and keys outside the role environment files. Only paths and the selected address belong in build or deployment settings.

For a local source image, run `build.bat --portal-image` using the project’s existing build configuration. Set `TEMPDESK_PORTAL_BUILD_IMAGE` to an isolated local tag when preparing a verification build.

## Verify the endpoints

From a separate client with normal certificate verification, open `https://` followed by the certificate name and guest port at `/`, and the management port at `/login`. Check the running build identity shown on each page. Confirm the containers are healthy and both routes return 200. A local `/healthz` response proves the listener is alive. Validate directory operations separately with a temporary guest sign-in before declaring a deployment ready.

HTTPS startup requires both server files. A missing counterpart prevents startup. A bad issuer or nonmatching name prevents the HTTPS health check from succeeding. The client-facing HTTPS route and the portal-to-agent HTTPS route use separate trust settings. See [protect the agent role key](portal-agent-key-file.md) for the latter.

The [isolated verification receipt](../../evidence/portal-tls-7ceecb3daf.json) records both roles using their expected certificate and the loopback health check. It includes untrusted issuer, wrong name and missing key cases, the default HTTP mode, and a guest account lifecycle against an isolated directory. Confirm your own LAN addresses and certificates from a separate client before using the portals.
