# Identify the running version

The Deployer reads packaged build metadata and shows the build's version, source revision and UTC timestamp on its Deploy workspace. The portable documentation build also embeds version, source revision and build time in its offline payload. The release display has a separate path for a hosted release offer.

For each candidate, observe the initial screen before navigation or sign-in. Record the displayed version, the date and time including seconds, the labelled timezone and the exact product artifact that supplied those values. Preserve an explicit unavailable state when build metadata is missing. The existing offline-reader download observation establishes the version and source revision. Front-screen timestamp and timezone interaction proof still needs to be recorded for each surface.

## Guest, management and kiosk portals

Both portal modes read the same build record from the deployed application directory, before sign-in. A source build stages approved files from a known clean revision and writes the record before Compose calls the builder. The image preserves a validated record when one is present. The isolated build context contains the staged source and receipt. Git metadata is excluded. The Deployer bundle and the public installer payload generate the same record before delivery. The public payload includes the record in its existing file integrity manifest. The native install copies it with the application and clears the previous package's record on an upgrade.

The portal checks the supplied version, full source revision, UTC date and time with seconds, and digest of the application files. This is an integrity check on packaged application bytes. Image identity and installer delivery still have their own artifact digests and verification. Portal preferences, process environment and install or service start time cannot supply the displayed version or timestamp.

The provenance is unavailable for a manual container build from loose source, a legacy payload without a receipt, or an installation whose application bytes disagree with its record. Build from a clean checkout using the documented staging command or deploy a current packaged payload. The portals keep working when the provenance is unavailable.

This records the producer and consumer wiring. Live guest, management and kiosk front-screen behavior remains unverified for this change.
