# Feature verification inventory

[廣東話版](FEATURE-INVENTORY.zh-HK.md)

Use this inventory to check which parts of a TempDesk workflow have been exercised. The [full inventory](feature-inventory.json) includes the scope, observation, evidence reference and remaining work for each recorded result. Results belong to the named surface and the source revision recorded beside them.

## Find the workflow you need

- To deploy or update the desktop tool, start with [the Deployer](../deployer/README.md) and check its distribution and first-run coverage.
- To issue and expire a temporary account, read [the kiosk walkthrough](../README.md#guest-sign-in-walkthrough) and [portal feature status](../portal/FEATURES.md). The management portal and deployed kiosk each need their own verification even where they share code with the guest portal.
- To check out a remote session, use [Virtual Commons](VIRTUAL-COMMONS.md). Follow the separate session-host, download, sign-in and expiry checks for each edition.
- To browse guidance without a connection, use [the offline reader](OFFLINE-GUIDE.md). The portable reader and the hosted documentation each have their own runtime checks.

## Compare progress by surface

The built documentation displays the live counts from the inventory below. Use the table's filter to find a surface.

<!-- feature-inventory-summary -->

- **Verified** has a runtime, published delivery or release observation for the requirement.
- **Partial** has a scoped result and lists the work that remains.
- **Pending** still needs review, implementation or verification.
- **Inapplicable** has a reason in the scope profile. The same feature can apply to other surfaces.

Add new evidence to the feature and surface it actually covers. Keep the exact source revision with that evidence and retain earlier runs with their original scope.
