# Read the documentation offline

Open `TempDeskDocs-<version>-portable.exe` to use the documentation without a web connection. Get the executable from the [release assets](https://github.com/Ding-Ding-Projects/tempdesk-/releases) when that version includes it. The reader opens the TempDesk home page and displays its bundled version and build date in the download section.

## Find a guide

1. Choose **Docs** from the top navigation. Use documentation search to look up a task such as setting up a session host.
2. Open an article and use its contents or related guides to find the next step. Choose **TempDesk operator wiki** from the documentation index to open the bundled wiki entry.
3. Use **Ctrl+Shift+F** to find a page from any guide. **Alt+Left** and **Alt+Right** move through the pages you visited.

The reader bundles the documentation, feature articles, Answer File Studio and Base64 toolkit. The Studio can prepare a local kit. Account creation, deployment and server management use their corresponding TempDesk components.

## Local settings and reference links

The reader keeps language, theme and other browsing preferences in its own local profile. Settings and files you open in the bundled tools are processed locally. A selected HTTPS reference or release link opens in your browser, where that destination's network requirements apply.

## Build and verify

Run `build.bat /docs` from the repository root. The executable appears under `deployer/bin/docs/`. The default `build.bat` and `build-installer.bat` also produce the documentation executable.

To verify a build, launch the single executable from an otherwise empty directory and open the documentation index, the Virtual Commons guide, and the operator wiki. Search for a phrase from the guide and check that the matches and navigation work offline. The date and version on the home page identify the bundled copy.

Next, read [Use Virtual Commons](VIRTUAL-COMMONS.md) or return to the [TempDesk overview](../README.md).
