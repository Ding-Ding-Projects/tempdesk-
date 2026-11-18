# Windows 11 remote workstation

Create one Windows 11 desktop for one Virtual Commons booking on a dedicated Hyper-V host. The host needs Hyper-V, local-key-protector and virtual TPM support, capacity for two virtual CPUs and 4 GB of memory per running workstation, and approved Windows installation media and licensing. Put the domain controller and the authorized remote desktop gateway on the same isolated lab network, or provide a separately managed private route. An unconnected Hyper-V private switch cannot serve clients outside its VM network.

1. On the hypervisor, run the command below with the operator's chosen name and paths. Review with `-WhatIf`, then remove it to confirm creation. On partial provisioning failure, inspect the exact VM and storage path. A retry never replaces existing resources.
2. Complete the installation on the VM console. Choose Windows 11 Pro, Enterprise or Education, assign a unique machine name, join the lab domain and apply the existing TempDesk watcher policy. Keep emergency administrative credentials separate from guest credentials. Do not use automatic sign-in.
3. Apply the organization's workstation policy to enable NLA-protected RDP only through the authorized lab gateway or source addresses. Check the effective firewall and routing at the destination before registering it. The scripts do not open inbound access.
4. Inside the guest, inspect the watcher and machine identity and preview the redirection restrictions. Apply them using the workstation administrator's credentials. A domain policy may override local settings. Check effective redirection through a new guest session.
5. The booking broker must grant one particular standard account access, recover or revoke that grant on checkout or expiry, and verify authorization before publishing the connection. The readiness command reports enrollment pending broker verification. A successful watcher check does not allocate a seat. Never grant the shared domain guest group access to a single-seat destination.

```powershell
.\server\kiosk\New-CommonsKioskVm.ps1 -Name LAB-KIOSK01 -PrivateSwitch CommonsLab -StorageParent D:\VMs -WindowsIso D:\Media\Windows11.iso -WhatIf
.\server\kiosk\Get-CommonsKioskReadiness.ps1 -ComputerName LAB-KIOSK01 -DomainDns lab.example
.\server\kiosk\Set-CommonsKioskRestrictions.ps1 -ComputerName LAB-KIOSK01 -DomainDns lab.example -WhatIf
```

This profile provides a restricted remote workstation. Windows single-app Assigned Access requires a console sign-in. Application allowlisting and kiosk shell restrictions require a separately managed workstation policy. The VM installer, effective policy, broker grant and guest connection each need their own operational verification.

The deployment engine accepts the same settings in a dedicated section. Run
`Invoke-TempDeskDeploy.ps1 -Config lab.json -Phase KioskVmPreview` on the Hyper-V host.
For an actual creation, add `"confirmCreate": "LAB-KIOSK01"` inside the section
and invoke the separate `KioskVmCreate` phase. Server deployment media and
answer files are never attached to this VM.

```json
{
  "kioskVm": {
    "name": "LAB-KIOSK01",
    "windowsIso": "D:\\Media\\Windows11.iso",
    "privateSwitch": "CommonsLab",
    "storageParent": "D:\\VMs"
  }
}
```
