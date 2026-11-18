# TempDesk release pipeline

Push a release-ready change to main or dispatch **Release TempDesk Deployer** on main. The workflow builds the checked-out commit through the root installer entrypoint. It derives the three-part Squirrel version from the app version family and workflow run number.

Each release attaches Setup.exe, a matching RELEASES feed, the current full package and any current delta packages, the versioned desktop and offline documentation portables, and a file inventory with SHA-256 and byte counts tied to the source commit. Readback compares the published tag and asset metadata with the built files. The installer is unsigned and Windows SmartScreen may warn. The digest records describe the uploaded bytes.

Notes measure elapsed time from the first job start to release publication using GitHub timestamps. If either value is unavailable, the notes say so. The source counter separates tests, authored code, markup and generated metadata and attributes surviving authored lines from Git history.

## Release job dependencies

The release job uses a hosted Windows 2025 runner with PowerShell, Git, GitHub CLI, the Windows command shell and Windows trust inspection. The workflow provides Python 3.12 for the local delta seed, and the root installer acquires build and packaging dependencies. The build process receives no release credential.

The seven-day job artifact records run context and allowlisted outputs available at job end. Fresh-worker bootstrap, actual download and native installation remain distinct verification steps.
