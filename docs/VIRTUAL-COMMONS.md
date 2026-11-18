# Use Virtual Commons

Choose an available server edition and a finite checkout duration on the guest portal. The portal downloads a connection file for the destination configured by the operator. An edition is unavailable until its destination is configured.

Open the downloaded Virtual-Commons.rdp file and enter the password shown on the one-time confirmation page. Use the download button on that page if your browser suppresses the automatic download. Save your work outside the temporary account before it expires.

The download is an attachment from the guest portal. The browser that opened the confirmation can download it again for up to ten minutes, capped by the account's expiry. Each confirmation has its own download, so switching tabs keeps the selected destination with its checkout. The connection file carries the destination and username. Use the one-time confirmation to read the password.

One in a hundred valid checkout attempts shows a dim sum dish and offers a retry. That outcome creates no account.

To use personal wording for the edition labels, verify an active guest sign-in under **Check my sign-in**, then return to **Virtual Commons**. Upload a wording JSON file or use **Clear personal wording** to restore the shipped labels. The file is processed in the current page and is never uploaded to the server. Wording clears when you leave the page or when the temporary wording access expires, whichever comes first.

In the edition picker, a file entry for `Microsoft Windows` also supplies wording for the `Windows` product name in the shipped labels. Explicit entries for `Windows` or a complete edition label take precedence. You can reopen the upload control after a checkout validation message while your original wording access is still active.

## Configure the destinations

Set `COMMONS_RDP_GUI` to a verified Desktop Experience session host. Use a name reachable from the Remote Desktop client, optionally followed by its port. Keep session hosts separate from the domain controller. Follow [the dedicated App Host setup](../server/apphost/README.md#prepare-a-virtual-commons-session-host), then verify a short checkout before publishing the destination.

Windows Server Core supports Remote Desktop for administration. Microsoft does not include the RD Session Host role in Server Core, and the TempDesk App Host installer requires Desktop Experience. Leave `COMMONS_RDP_CORE` unset unless you have validated a supported configuration that provides the intended temporary guest sessions. An open RDP port or an administrator sign-in does not verify guest checkout. See [Microsoft's Server Core role list](https://learn.microsoft.com/en-us/windows-server/administration/server-core/server-core-roles-and-services).

Existing single-target installations can continue using COMMONS_RDP_TARGET. When either edition setting is supplied, the edition settings determine availability.

## Prepare the Desktop Experience host

Use a dedicated domain member with the Remote Desktop Session Host role and a certificate the clients trust. Arrange for the TempDesk Session Watcher to be installed from the joined domain's computer policy. The existing TempDesk Guest Computers policy also manages startup scripts and profiles. Apply it only to computers intended to receive those settings.

Open elevated PowerShell on the dedicated host and preview the setup with `Install-AppHost.ps1 -VirtualCommons -WhatIf`. The preview reads the secure channel, the registered task, and the protected watcher files on the host. It checks the files against the joined domain's published policy. When the preview succeeds, run the installer again with `-VirtualCommons` and the appropriate `-LicenseServer` value. If the role installation needs a restart, rerun the installer afterward to grant the confirmed domain guest group access.

The installer checks the configuration that will enforce expiry. Complete the live checkout check below before adding the host to the guest portal.

## Apply the settings

- **Docker Compose:** edit `portal/.env.guest` in the deployment directory, then recreate only the guest service with `docker compose up -d --force-recreate tempdesk-guest` from the `portal` directory. Recreating it is necessary because a container restart keeps its existing environment.
- **Native Windows portal:** edit `%ProgramData%/TempDesk/portal-data/guest.env` on the portal host and restart the **TempDesk Guest Portal** scheduled task so it reads the file again. The native installer retains these destination settings when it regenerates the file.

Open the guest portal after applying the settings. Confirm that the expected editions are available before checking out a computer.

## Verify a checkout

1. On each session host, confirm that the TempDesk Session Watcher scheduled task is installed and can look up guest accounts in the domain. The watcher ends existing sessions. Account expiry alone blocks new sign-ins.
2. Open the file for each configured edition on a test client. Confirm that it points to the intended host and that the temporary user can sign in. The file carries the address and username. The password is shown separately on the one-time confirmation page.
3. Keep the test session connected through the expiry time. Verify that the watcher signs it out, then verify that the same account cannot sign in again. Record the two results separately for each edition.
