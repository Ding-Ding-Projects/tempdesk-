# Windows 11 RDP workstation setup

The Virtual Commons workstation card belongs on the normal Deploy page beside the other machine setup actions. Its purpose is to prepare one isolated workstation for one booking. The main actions are preview and explicit creation.

## Layout

Use the existing Deployer card, field, row, button, and log styles. Place the title and one explanatory sentence above a two-column form. Machine identity and hypervisor appear first. Installation ISO and storage parent each carry a native picker. Show the VirtualBox internal network for Automatic and VirtualBox. Show the VMware private network selector for Automatic and VMware. Host-only is the default. Place its directory-reachability guidance with the selector. At narrow widths, stack fields in reading order. The preview and create buttons remain adjacent or wrap together. Place live status immediately below them, followed by the actual configuration path and bounded engine output.

## Interaction

| Stage | User action or engine result | Visible state |
| --- | --- | --- |
| Draft | Supply a unique machine name, platform, licensed Windows ISO and storage parent | Preview is available once the inputs meet the engine constraints. |
| Preview | Run the read-only preview phase | Inputs lock while the engine is running. A successful preview names the resolved platform and network and enables creation for precisely that configuration. |
| Confirmation | Choose creation and type the exact displayed machine name | Cancel returns to the preview. A changed draft requires a new preview. The confirmation never persists. |
| Creation | The engine writes the selected powered-off machine | Show the actual configuration path, hypervisor-specific hardware-security step, OS installation, domain join and outstanding seat enrollment. |
| Failure | The engine or IPC returns an error or inconsistent receipt | Display the returned diagnostic and ask the operator to inspect the destination before retrying. Preserve partial output. |

Field labels, button names, status, prompts and errors use the English and Hong Kong Cantonese catalogs. The status is announced to assistive technology; the output is keyboard-focusable. This reference describes the interaction. It contains no live VM, credentials, captured screen, or acceptance evidence.

The ISO picker has an adjacent optional publisher-digest field. Preview reports the selected media byte count and measured SHA-256. Any edit invalidates the preview. Creation consumes the approved digest and mounts a read-only copy in the VM directory. The successful receipt includes the separate guest-media verification record; its folder button is available only when the engine supplied a real receipt path.