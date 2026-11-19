# Read the agent key from a protected file

Use a role-specific file when the portal should read its agent key from protected storage. The guest portal uses the agent's guest key. A management portal configured for file access uses its own admin key file.

## Mount the guest key in an existing Compose deployment

1. Have the agent operator provide a protected file containing just the approved guest key. Keep the file outside the checkout and build context. Give read access to the portal identity, UID/GID 10001 in the Linux image. On a Linux host with normal UID mapping, a root-owned file with group 10001 and mode `0440` is one option. On Docker Desktop, use a protected local file and confirm that the Linux container can read the mounted file.
2. In the existing `.env.guest`, clear `AGENT_KEY`. For a remote agent, use its approved HTTPS URL and its normal `AGENT_CA_FILE` or `AGENT_CERT_SHA256` trust setting.
3. Set `TEMPDESK_GUEST_AGENT_KEY_SOURCE` to the file's full path on the Docker host. Add `portal/compose.guest-agent-key-file.yaml` to the deployment's existing Compose file list, alongside the published-image overlay when used. For `host.bat`, add its path to `TEMPDESK_PORTAL_COMPOSE_OVERRIDES`. The overlay sets `AGENT_KEY_FILE` and grants the secret only to the guest service.
4. Check that the guest portal renders its sign-in form and can create a finite guest account. Retain the original project name, image and bind settings. When rotating the file, recreate the guest service through the same Compose setup so it opens the current file.

A management deployment can set `AGENT_KEY_FILE` with its own protected read-only mount and clear `AGENT_KEY`. For a native portal, set the absolute file path in the applicable portal environment file and restart that portal. The native installer retains an explicit file setting for each role when it regenerates the local portal configuration.

The portal reads a regular file at startup. It accepts one nonempty ASCII key, with surrounding whitespace allowed, from a file of at most 4096 bytes. An unreadable or invalid file keeps startup incomplete. Supplying both key settings also stops startup. A deployment with only `AGENT_KEY` continues to work.
