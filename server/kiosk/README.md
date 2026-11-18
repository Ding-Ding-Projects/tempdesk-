# Windows 11 remote workstation

Create one Windows 11 desktop for one Virtual Commons booking on a dedicated VMware Workstation host, with VirtualBox 7 or later as fallback. The host needs firmware and virtual TPM support, capacity for two virtual CPUs and 4 GB of memory per running workstation, and approved Windows installation media and licensing. Put the domain controller and the authorized remote desktop gateway on the same isolated lab network, or provide a separately managed private route. VMware uses its host-only network. VirtualBox uses the specified internal network. Attach the gateway to that isolated network.

1. On the hypervisor, run the command below with the operator's chosen name and paths. Review with `-WhatIf`, then remove it to confirm creation. On partial provisioning failure, inspect the exact VM and storage path. A retry never replaces existing resources.
2. The VM is created powered off. In Workstation, open its VMX, enable encryption with an operator-controlled password and add a TPM 2.0 device. In VirtualBox, enable Secure Boot and enroll the standard Microsoft signing keys using its UEFI settings. Verify Secure Boot and TPM 2.0, boot the VM and complete the installation on its console. Choose Windows 11 Pro, Enterprise or Education, assign a unique machine name, join the lab domain and apply the existing TempDesk watcher policy. Keep emergency administrative credentials separate from guest credentials. Do not use automatic sign-in.
3. Apply the organization's workstation policy to enable NLA-protected RDP only through the authorized lab gateway or source addresses. Check the effective firewall and routing at the destination before registering it. The scripts do not open inbound access.
4. Inside the guest, inspect the watcher and machine identity and preview the redirection restrictions. Apply them using the workstation administrator's credentials. A domain policy may override local settings. Check effective redirection through a new guest session.
5. The booking broker must grant one particular standard account access, recover or revoke that grant on checkout or expiry, and verify authorization before publishing the connection. The readiness command reports enrollment pending broker verification. A successful watcher check does not allocate a seat. Never grant the shared domain guest group access to a single-seat destination.

```powershell
.\server\kiosk\New-CommonsKioskVm.ps1 -Name LAB-KIOSK01 -Hypervisor Auto -StorageParent D:\VMs -WindowsIso D:\Media\Windows11.iso -WhatIf
.\server\kiosk\Get-CommonsKioskReadiness.ps1 -ComputerName LAB-KIOSK01 -DomainDns lab.example
.\server\kiosk\Set-CommonsKioskRestrictions.ps1 -ComputerName LAB-KIOSK01 -DomainDns lab.example -WhatIf
```

This profile provides a restricted remote workstation. Windows single-app Assigned Access requires a console sign-in. Application allowlisting and kiosk shell restrictions require a separately managed workstation policy. The VM installer, effective policy, broker grant and guest connection each need their own operational verification.

The deployment engine accepts the same settings in a dedicated section. Run
`Invoke-TempDeskDeploy.ps1 -Config lab.json -Phase KioskVmPreview` on the virtualization host.
For an actual creation, add `"confirmCreate": "LAB-KIOSK01"` inside the section
and invoke the separate `KioskVmCreate` phase. Server deployment media and
answer files are never attached to this VM.

```json
{
  "kioskVm": {
    "name": "LAB-KIOSK01",
    "windowsIso": "D:\\Media\\Windows11.iso",
    "hypervisor": "Auto",
    "storageParent": "D:\\VMs"
  }
}
```

## Enroll the seat broker

Deploy the complete `server/kiosk/` and `server/apphost/` trees under a local directory writable only by SYSTEM and local administrators. Install the Active Directory PowerShell RSAT feature in the workstation. The machine account must be able to read the domain guest OU and the protected watcher configuration. Use the ordinary workstation restriction setup first.

On this dedicated VM only, configure the effective **Allow log on through Remote Desktop Services** assignment to contain exactly the built-in Remote Desktop Users group. The broker requires that the deny assignment is absent, empty, or contains only the built-in Guests group. Keep emergency administrator access at the VM console. Confirm there are no third-party login providers or alternate access paths installed. Start with no members of Remote Desktop Users and no signed-in or disconnected users. The domain-created account must be enabled, directly in the configured guest OU, have the configured guest group and a matching finite directory expiry. Custom nested or privileged account topologies are intentionally unsupported.

1. Create the private directory `%ProgramData%\TempDesk\seat`. Disable inherited grants and grant only SYSTEM and local Administrators access. Set an owner of SYSTEM or local Administrators. The existing protected TempDesk parent must also pass the watcher path check. Place the operator-provisioned bearer credential in `broker.key` through protected file distribution. Use an independent, randomly generated URL-safe value. Never pass a credential on the command line.
2. Bind an organization-trusted server certificate for the workstation FQDN to the desired HTTPS port using the organization's HTTP.sys deployment tooling. Permit inbound management traffic only from the portal's explicit IP on the private network. Keep the RDP gateway firewall rule independent. The default management port is 9443. The broker does not create certificates, open the firewall, or modify trust.
3. Use an operator-managed LocalSystem startup task or service wrapper to invoke 64-bit Windows PowerShell 5.1 on `Start-CommonsSeatBroker.ps1 -DomainDns lab.example -Initialize` once. This creates protected empty state only after verifying the local domain watcher, effective rights, NLA, firmware, group and session state. Initialization refuses to overwrite existing state.
4. Run the same entrypoint under the same account with `-DomainDns lab.example -PortalAddress <portal-ip>`, omitting `-Initialize`. Configure a bounded restart policy. Supply the portal the corresponding HTTPS broker endpoint, matching DNS name, trust chain and protected credential through its own secret provisioner. Never register a VM by a mutable DHCP address as the RDP target.
5. Readiness is the authenticated response from `GET /seat`. The two POSTs to `/seat/reserve` and `/seat/assign` attach one lease and one directory UPN. A durable grant intent precedes local group membership changes. A crash leaves the workstation reserved and a repeated identical request may finish the transition. `POST /seat/cancel` revokes only the stored SID. Remaining session or unknown membership keeps the workstation unavailable. The background sweep also withdraws expired grants; the existing watcher independently enforces the domain expiry. An unavailable directory, unreadable policy, or mismatched SID never creates a fresh grant. Investigate any stuck reservation from the VM console without deleting its state.

Microsoft documents the console sign-in requirement for single-app Assigned Access and the built-in identity groups returned by the directory authorization query. See [Assigned Access requirements](https://learn.microsoft.com/en-us/windows/configuration/assigned-access/overview) and [Get-ADAccountAuthorizationGroup](https://learn.microsoft.com/en-us/powershell/module/activedirectory/get-adaccountauthorizationgroup).