# Use Virtual Commons

Choose a server edition and a finite checkout duration on the guest portal. Desktop Experience opens a graphical desktop. Server Core opens a command-line session. An edition is unavailable until its destination is configured.

Open the downloaded Virtual-Commons.rdp file and enter the password shown on the one-time confirmation page. Use the download button on that page if your browser suppresses the automatic download. Save your work outside the temporary account before it expires.

One in a hundred valid checkout attempts shows a dim sum dish and offers a retry. That outcome creates no account.

## Configure the destinations

Set COMMONS_RDP_GUI and COMMONS_RDP_CORE in the guest portal environment. Use a host reachable from the Remote Desktop client, optionally followed by its port. Configure the session hosts to accept the temporary domain users over Remote Desktop. Keep session hosts separate from the domain controller.

Existing single-target installations can continue using COMMONS_RDP_TARGET. When either edition setting is supplied, the edition settings determine availability.

## Verify a checkout

Open the file for each edition on a test client. Confirm that it points to the intended host and that the temporary user can sign in. The file carries the address and username. The password is shown separately on the one-time confirmation page. After the account expires, verify that another sign-in fails.
