# TempDesk answer file catalog

This folder holds the shared data and code that the TempDesk answer file builders use to create and edit
Windows answer files (`autounattend.xml` and `unattend.xml`):

| File | What it is |
| --- | --- |
| `unattend-catalog.json` | Machine-readable catalog of every component and setting in the Microsoft *Unattended Windows Setup Reference*, with paraphrased help text. |
| `catalog.schema.json` | JSON Schema (draft 2020-12) for the catalog. |
| `generate.mjs` | Dependency-free ES module: `buildXml`, `parseXml`, password encoding, `<servicing>` packages and a tiny XML parser. Runs in browsers and in Node 18+. Re-exports `validateModel`. |
| `rules.mjs` | Validation rules table (56 rules with ids, severity and messages) and `validateModel`. |
| `widgets.json` | Widget hints: a control kind, a written description and the meaning of every value for each of the 1,029 leaf settings. |
| `widgets.mjs` | Dependency-free loader and checker for `widgets.json` (`compileWidgets`, `resolveHint`, `allHints`, `validateWidgets`). |
| `tests/` | `node --test` suites for the catalog, the generator and the widget hints. |
| `tools/` | Python scripts that download the reference and rebuild the catalog. |

The help text is a short paraphrase of the official documentation, written for tooltips. It is not a copy of
the reference; each setting carries a `doc` slug so a builder can link to the full page.

## Coverage

Generated 2026-11-02 from the current reference
(<https://learn.microsoft.com/en-us/windows-hardware/customize/desktop/unattend/>, about 1,260 pages) and the archived
Windows 8.1 reference (<https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-8.1-and-8/>, 130 pages).

| Measure | Count |
| --- | --- |
| Components | 99 (88 from the current reference, 11 found only in the archive) |
| Settings (every element, including containers and lists) | 1,288 |
| Leaf settings (values a user types or picks) | 1,029 |
| By type | 562 string, 202 boolean, 133 enum, 114 integer, 18 password, 205 container, 54 list |
| Components with full detail | 98 (every leaf has type, passes, help, and values for enum and boolean) |
| The 40 most used components (`popular: true`) | all 40 fully detailed |
| Deprecated components | 17 (`deprecated: true`) |
| Settings documented only in the archive (`archivedOnly: true`) | 59, under IE-InternetExplorer, Shell-Setup, MobilePC-Sensors-API, SecureStartup-FilterDriver, STObject, TabletPC-Platform-Input-Core |
| Sensitive settings (`sensitive: true`) | 28 (passwords, product keys, offline join blobs) |

The one component with `detail: "basic"` is Microsoft-Windows-WPD-BusEnumService, because its `RegCacheUpdated`
page documents no configuration pass (it is marked internal use only). Its passes are copied from the component.

### Unverified components

`unverifiedComponents` lists names that were requested or are often seen in old answer files but that the
reference does not document, so the catalog does not guess their settings:

- Microsoft-Windows-Web-Services-for-Management-Core: not in the current, Windows 8.1 or Windows 7 component lists; the page URL returns HTTP 404.
- Microsoft-Windows-Firewall-Core: not in any component list; HTTP 404. Firewall settings live in Networking-MPSSVC-Svc.
- Microsoft-Windows-Edge-* other than Microsoft-Windows-MicrosoftEdgeBrowser: no pages exist.
- Microsoft-Windows-Printing-* other than Microsoft-Windows-Printing-Spooler-Core: Printing-Spooler-Networkclient returns HTTP 404.

`parseXml` reports elements of such components in `unknown`, so a builder can keep them as raw XML.

## Catalog schema

Top level:

```json
{
  "schemaVersion": 1,
  "source": "Microsoft Unattended Windows Setup Reference (paraphrased)",
  "sourceUrls": { "current": "https://...", "archive-windows-8.1": "https://..." },
  "generated": "2026-11-02",
  "passes": ["windowsPE", "offlineServicing", "generalize", "specialize", "auditSystem", "auditUser", "oobeSystem"],
  "namespaces": { "unattend": "urn:schemas-microsoft-com:unattend", "wcm": "http://schemas.microsoft.com/WMIConfig/2002/State", "xsi": "..." },
  "componentAttributes": { "publicKeyToken": "31bf3856ad364e35", "language": "neutral", "versionScope": "nonSxS" },
  "architectures": ["amd64", "x86", "arm64"],
  "components": [ COMPONENT ],
  "unverifiedComponents": [ { "name": "...", "reason": "..." } ]
}
```

COMPONENT:

| Field | Meaning |
| --- | --- |
| `name` | Component name as written in `<component name="...">`. |
| `summary` | One sentence paraphrase. |
| `passes` | Passes in which at least one of its settings is valid (pass order). |
| `appliesTo` | `["client","server"]` when the page lists editions (archive pages only; current pages defer to Windows SIM). |
| `deprecated` | True when the reference says the component is deprecated or removed, and for archive-only components. |
| `reference` | `current` or `archive-windows-8.1`. |
| `detail` | `full` or `basic` (see Coverage). |
| `popular` | True for the 40 most used components. Builders show these first. |
| `doc` | Page slug. Full URL is `sourceUrls[reference] + doc`. |
| `settings` | Top-level SETTING list in documentation order. |

SETTING:

| Field | Meaning |
| --- | --- |
| `path` | Slash path from the component element, for example `OOBE/HideEULAPage` or `UserAccounts/LocalAccounts/LocalAccount/Password/Value`. Unique within a component. |
| `itemPath` | Only inside a list item: the path relative to the nearest list item element (`Password/Value`). Model keys inside list items use this. |
| `name` | Element name (last path segment). |
| `type` | `boolean`, `string`, `integer`, `enum`, `password`, `list` or `container`. |
| `passes` | Valid configuration passes. |
| `values` | For `enum` and `boolean`: `[{value, label}]`. Values are strings exactly as written in XML. |
| `suggestions` | Documented special or example values for a free-form setting (offer as a combo box). |
| `flags` | Integer built by adding the values in `suggestions` (for example Embedded-EmbeddedLogon BrandingNeutral). |
| `min`, `max`, `maxLength` | Documented limits. |
| `rangeNote` | A documented numeric range for a value that is still text (for example a percentage list). |
| `default` | Documented default value, as a string. |
| `help` | Short paraphrase for a tooltip. |
| `sensitive` | Passwords, product keys and join blobs. Mask in the UI and never log. |
| `encodedPassword`, `passwordSuffix` | On a container with `Value` and `PlainText` children: the value can be stored encoded, with the suffix `Password` or `AdministratorPassword`. |
| `deprecated`, `archivedOnly` | Deprecated by the reference; documented only in the archived reference. |
| `nameInferred` | Element name recovered from the page file name because the page title is a display label (Sensors-Core). |
| `reviewed` | Type or limits checked by hand against the page text (a small override table in `tools/build_catalog.py`). |
| `children` | For `container`: child SETTINGs. |
| `listItem` | For `list` (elements written with `wcm:action="add"`, such as RunSynchronousCommand, LocalAccount, CreatePartition, Interface, IpAddress). |

`listItem`:

| Field | Meaning |
| --- | --- |
| `action` | Always `add`; the generator writes `wcm:action="add"`. |
| `keyed`, `key` | The child that identifies an item (`Order`, `Name`, `Key`, `DiskID` and so on). Must be unique within a list. |
| `keyStyle` | `keyValue`: the `Key` child is written as the `wcm:keyValue` attribute (IpAddress, DomainName, PathAndCredentials, FirewallGroup, ValidCommunity and others). `element`: the key is an ordinary child element. |
| `valueStyle` | `text`: the item's `Value` child is the element text (`<IpAddress wcm:action="add" wcm:keyValue="1">10.0.0.5/24</IpAddress>`). `children`: normal child elements. |
| `settings` | SETTINGs of one item. Nested lists are allowed (Disk contains CreatePartition). |

## The model and generate.mjs

A model is plain JSON, easy to bind to form controls:

```js
const model = {
  architecture: 'amd64',
  passes: {
    specialize: {
      'Microsoft-Windows-Shell-Setup': { ComputerName: 'TD-01', TimeZone: 'UTC' },
      'Microsoft-Windows-UnattendedJoin': { 'Identification/JoinDomain': 'corp.example.com' },
    },
    oobeSystem: {
      'Microsoft-Windows-Shell-Setup': {
        'OOBE/HideEULAPage': true,
        'UserAccounts/AdministratorPassword/Value': 'secret',        // plain text in the model
        'UserAccounts/LocalAccounts/LocalAccount': [                 // list: array of items
          { Name: 'kiosk', Group: 'Users', 'Password/Value': 'pw' }, // keys are itemPath values
        ],
      },
    },
  },
};
```

Values: booleans may be `true`/`false`; integers may be numbers; enum values are strings as listed in `values`.
For `keyValue` lists put the attribute value in `Key`. An item may set `_action` to write a different `wcm:action`.

Packages go in `model.servicing` and map to `<servicing>`, written before the `<settings>` passes as the
unattend schema requires:

```js
model.servicing = [{
  action: 'configure',                       // install | configure | remove | stage
  permanence: 'removable',                   // optional: removable | permanent | temporary
  identity: { name: 'Microsoft-Windows-Foundation-Package', version: '10.0.26100.1',
              processorArchitecture: 'amd64', publicKeyToken: '31bf3856ad364e35', language: '' },
  sources: [{ location: 'D:\\Updates\\kb.cab', permanence: 'permanent' }],   // optional
  selections: [{ name: 'IIS-WebServerRole', state: true }, { name: 'SMB1Protocol', state: false }],
}];
```

`identity` fields that are left out default to the model architecture, the catalog public key token and
`language="neutral"`. `parseXml` reads `<servicing>` back into the same shape, so packages and optional feature
selections no longer appear in `unknown`.

```js
import { buildXml, parseXml, validateModel } from './generate.mjs';
const catalog = await (await fetch('unattend-catalog.json')).json();
const issues = validateModel(model, catalog, { diskSizesMB: { 0: 61440 } }); // [{id, level, where, message}]
const xml = buildXml(model, catalog);            // throws on unknown components or settings
const { model: loaded, unknown, warnings } = parseXml(xml, catalog);
```

`buildXml(model, catalog, options)`:

- Writes `<unattend xmlns="urn:schemas-microsoft-com:unattend">`, passes in standard order, and each component
  with `processorArchitecture`, `publicKeyToken="31bf3856ad364e35"`, `language="neutral"`, `versionScope="nonSxS"`
  and the `wcm` and `xsi` namespace declarations.
- Writes settings in catalog (documentation) order, which is the order Windows SIM uses.
- Password containers (`encodedPassword`): when `PlainText` is false (the default; set `options.hidePasswords:false`
  to change it) the value is written as base64 of the UTF-16LE bytes of the password followed by the suffix:
  `AdministratorPassword` for `UserAccounts/AdministratorPassword` and `OfflineUserAccounts/OfflineAdministratorPassword`,
  `Password` for local account and AutoLogon passwords. Example: `pw` as an administrator password becomes
  `cAB3AEEAZABtAGkAbgBpAHMAdAByAGEAdABvAHIAUABhAHMAcwB3AG8AcgBkAA==`, the value shown in the reference.
  `Credentials/Password` elements (domain join, RunSynchronous, driver shares) have no PlainText option and are
  always written as entered.
- Options: `strict` (default true: throw on unknown components or paths), `hidePasswords` (default true),
  `indent` (default four spaces), `offlineImage` (`{source}` for `cpi:offlineImage`).

`parseXml(xmlText, catalog)` returns `{model, unknown, warnings}`. `unknown` holds an XPath for every element the
catalog does not describe (unknown components, made-up settings, unknown passes) so nothing is silently lost.
Encoded passwords are decoded; a value that cannot be decoded is kept as written and reported in `warnings`.
Round trips are stable: `buildXml(parseXml(buildXml(m)).model)` gives identical text.

`parseXmlTree(text)` is the internal parser (elements, attributes, text, CDATA, comments, processing
instructions, entities). It rejects input that is not well-formed and refuses DOCTYPE declarations.

Other exports: `encodePassword`, `decodePassword`, `findComponent`, `findSetting`, `componentsForPass`, `XmlError`.

## Validation rules

`validateModel(model, catalog, options)` runs every rule in `RULES` (in `rules.mjs`) and returns
`[{id, level, where, message}]` with errors first. `where` is `pass/Component/path[index]/...`, so a builder can
place the message next to the control. Options: `diskSizesMB` (`{DiskID: MB}`, enables `disk.fit`), `disable`
(rule ids to skip) and `severity` (`{ruleId: 'error'|'warning'|'info'}`). `describeRules()` returns the table
without the check functions. Each rule has a test in `tests/rules.test.mjs` with one model that triggers it and
one that does not.

Partition numbers for the disk rules follow CreatePartition `Order`, skipping an Extended container, which is how
Windows Setup numbers new partitions. When a disk has no CreatePartition items (the existing layout is kept), the
partition reference rules are skipped.

| Rule id | Severity | Checks |
| --- | --- | --- |
| `pass.unknown` | error | Unknown configuration pass |
| `component.unknown` | error | Component not in the catalog |
| `component.passNotAllowed` | warning | Component has no settings for this pass |
| `setting.unknown` | error | Setting not in the catalog |
| `setting.passNotAllowed` | error | Setting placed in a pass the reference does not allow |
| `setting.deprecated` | warning | Deprecated setting |
| `value.list` | error | List setting needs an array of items |
| `value.boolean` | error | Boolean value must be true or false |
| `value.enum` | warning | Value is not one of the documented choices |
| `value.integer` | error | Value must be an integer |
| `value.range` | error | Integer outside the documented range |
| `value.maxLength` | error | Text longer than the documented maximum |
| `list.keyMissing` | error | List item has no key |
| `list.keyDuplicate` | error | Two list items share a key |
| `list.orderUnique` | error | Ordered list items need unique Order values |
| `join.exclusive` | error | JoinDomain and JoinWorkgroup are mutually exclusive |
| `join.credentials` | error | Domain join needs credentials or a provisioned account |
| `join.credentialsIncomplete` | warning | Join credentials are incomplete |
| `join.ouWithoutDomain` | warning | MachineObjectOU without JoinDomain |
| `computerName.length` | error | ComputerName longer than 15 bytes |
| `computerName.digits` | error | ComputerName cannot be only digits |
| `computerName.chars` | error | ComputerName contains a character Windows rejects |
| `autologon.password` | error | AutoLogon enabled without a password |
| `autologon.logonCount` | error | AutoLogon enabled without LogonCount |
| `autologon.username` | error | AutoLogon enabled without Username |
| `password.blankAdministrator` | warning | Blank built-in Administrator password |
| `command.willReboot` | error | RunSynchronous WillReboot must be Always, OnRequest or Never |
| `command.missing` | error | Command item without a command line |
| `productKey.format` | error | Product key must be five groups of five characters |
| `productKey.alphabet` | warning | Product key uses characters Windows keys never contain |
| `disk.extendCount` | error | Only one partition per disk can extend |
| `disk.extendLast` | error | The extending partition must be created last |
| `disk.extendWithSize` | error | Extend and Size cannot both be set |
| `disk.sizeRequired` | error | Partition needs Size or Extend |
| `disk.efiSize` | error | EFI system partition must be at least 100 MB |
| `disk.efiFormat` | error | EFI system partition must be FAT32 |
| `disk.msrCount` | error | GPT disks need exactly one MSR partition |
| `disk.gptNoExtended` | error | Extended and Logical partitions are MBR only |
| `disk.mbrActive` | error | MBR layouts need an Active partition |
| `disk.activeOnGpt` | warning | Active has no effect on GPT disks |
| `disk.mbrPrimaryLimit` | error | MBR disks hold at most four primary or extended partitions |
| `disk.modifyTarget` | error | ModifyPartition refers to a partition that is not created |
| `disk.letterDuplicate` | error | Drive letter used twice |
| `disk.fit` | error | Partitions do not fit the declared disk size |
| `install.target` | error | InstallTo must reference an existing disk and partition |
| `install.toAndAvailable` | error | InstallTo and InstallToAvailablePartition are exclusive |
| `servicing.action` | error | Package action must be install, configure, remove or stage |
| `servicing.identity` | error | Package identity is incomplete |
| `servicing.version` | error | Package version must have four numeric parts |
| `servicing.publicKeyToken` | error | Package publicKeyToken must be 16 hex digits |
| `servicing.permanence` | error | Permanence must be removable, permanent or temporary |
| `servicing.sourceLocation` | error | Package source needs a location |
| `servicing.installNeedsSource` | warning | Installing a package usually needs a source |
| `servicing.selection` | error | Feature selection needs a name and a true or false state |
| `servicing.selectionDuplicate` | error | Feature selected twice in one package |
| `servicing.selectionWithoutConfigure` | warning | Feature selections apply to install or configure actions |

## Widget hints

`widgets.json` tells the builders how to edit each setting. `widgets.mjs` resolves one hint per leaf
setting from four layers, in this order (later layers win field by field):

1. **rules**: first match by type, name, path, help text or documented values assigns the widget kind
   (for example every `boolean` is a `toggle`, an `enum` with two short values is `segmented`, a name
   ending in `Port` is a `port`).
2. **shapes**: wildcard entries keyed by component and path pattern for shared shapes
   (`**/Credentials/Password`, `*Profile_EnableFirewall`, `StartTiles/**/AppId`). `*` matches one path
   segment, `**` any number. `{profile}` and `{words}` placeholders are filled from the setting name.
3. **settings**: explicit entries keyed by component and exact path for the most used settings.
4. **generated**: when no layer gives a description, one is built from the cleaned catalog help, a
   sentence about when to change the component (`components`) and what happens when it is unset
   (`unsetSentences`, which names the default and what it means).

Entry fields: `widget`, `description` (2 to 4 plain sentences written for TempDesk, not copied from the
reference), `example`, `default`, `unit`, `min`/`max`/`step`, `valueHelp` (`{ value: one sentence }`),
`values` (for free-form strings that take fixed words, such as Keyboard Filter `Allowed`/`Blocked`),
`risk` (`{ level: none|caution|danger, when, reason }`), `related` (other `Component|path` keys), `docUrl`
and widget parameters (`source`, `presets`, `format`, `sep`, `storage`, `allowIpv6`, `imageSize`...).

Widget kinds: toggle, segmented, cards, combobox-search, number, size, duration, time, port, ipv4, ipv6,
cidr, mac, guid, product-key, password, path, command-line, url, email, registry-path, account-picker,
color, file, multiline, string-list, key-value, enum-flags and text. The renderers live in
`site/assets/canvas/widgets/` and are shared with the desktop app.

`tests/widgets.test.mjs` fails when any leaf setting has no widget or no 2 to 4 sentence description,
when an enum or boolean value has no meaning, or when an explicit entry points at a setting or value
that is not in the catalog. Descriptions are English only, like the rest of the catalog text; the
widget controls themselves are translated through `site/i18n`.

Generic product keys offered by the product key widget come from Microsoft's published KMS client
setup keys and Automatic Virtual Machine Activation keys. They only select an edition; they never
activate Windows.

## How the builders use it

**Website (JavaScript).** Import `generate.mjs` as a module and fetch the catalog. Build the navigation as pass,
then component (popular ones first, deprecated ones behind a toggle), then the setting tree. Pick the control from
`type`: checkbox or tri-state for `boolean`, select for `enum` (labels from `values`), number input with `min` and
`max` for `integer`, text box with `maxLength` for `string` (combo box when `suggestions` exist), masked input for
`password` and anything `sensitive`, a collapsible group for `container`, and an add/remove table for `list`
(columns from `listItem.settings`, key column from `listItem.key`). Only offer passes listed in `passes`. Run
`validateModel` on every change and show `help` as the tooltip. Import uses `parseXml` and shows `unknown` entries.

**Desktop app (PowerShell and WPF).** Load the catalog with
`Get-Content unattend-catalog.json -Raw | ConvertFrom-Json` and generate controls from the same fields
(CheckBox, ComboBox, TextBox with MaxLength, PasswordBox, Expander, DataGrid). To produce XML with byte-identical
output to the website, either call `generate.mjs` through Node when it is installed, or port the rules above;
the password rule in PowerShell is
`[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Password + 'AdministratorPassword'))`.
The test models in `tests/generate.test.mjs` are good fixtures for a parity test.

## Rebuilding the catalog

```sh
python3 -I tools/fetch_pages.py /tmp/unattend-work            # downloads about 1,400 pages
python3 -I tools/extract_pages.py /tmp/unattend-work
python3 -I tools/build_catalog.py /tmp/unattend-work unattend-catalog.json
node --test tests/*.test.mjs
```

Types, limits and defaults are read from each page's Values table and text; help lines are condensed from the
first descriptive sentence. Where the page states a rule only in prose, a short reviewed override table in
`build_catalog.py` fixes the type (for example ComputerName is limited to 15 bytes, drive letters are C to Z).

## Known gaps

- The current reference does not list editions per component, so `appliesTo` is set only for archive components.
- Types for the less used components come from automatic reading of the pages. Settings the reference itself calls
  strings (TAPI dialing codes, the SMTP port, lookup tables, CIDR values) stay `string`; see `rangeNote`.
- `disk.fit` needs the target disk sizes from the builder, because an answer file does not record them.
- Package names and feature names are not checked against a list; the reference does not publish one per edition.

## Re-typed settings

These settings were read as text but the reference documents them as numbers with a range or a numeric unit, so
they are now `integer` (`reviewed: true`). Defaults written with units such as `450mm` are stored as plain numbers.

| Component | Setting | Range now in the catalog | Documented as |
| --- | --- | --- | --- |
| Devices-Lights-WinRT | WinDLDefaultBrightness | 0 to 100 | percentage |
| Devices-Lights-WinRT | WinDLDefaultEffectSpeed | 1 to 10 | speed scale |
| Sensors-Core | DefaultOnlookerDetectionDimOverride | 0 to 100, default 50 | percentage |
| Sensors-Core | DefaultOnlookerDetectionDistance | at least 1200, default 3000 | millimeters |
| Sensors-Core | DefaultWakeDetectionDistance | default 450 | millimeters |
| Sensors-Core | DefaultLockDetectionDistance | default 1200 | millimeters |
| Sensors-Core | DefaultOnlookerNotPresentTimeout | default 5000 | milliseconds |
| Sensors-Core | DefaultOnlookerPresentTimeout | default 2000 | milliseconds |
| Sensors-Core | DefaultSensorExtensionReadingTimeout | default 5000 | milliseconds |
| Sensors-Core | DefaultSensorExtensionProcessReadingTimeout | default 500 | milliseconds |
| Security-Malware-Windows-Defender | Scan/ScheduleTime | 0 to 1440, default 120 | minutes past midnight |
| Security-Malware-Windows-Defender | SignatureUpdateInterval | 1 to 24, default 24 | hours |
| NetworkLoadBalancing-Core | Clusters/Cluster/IdentityHeartbeatPeriod | at least 10000 | milliseconds |
| NetworkLoadBalancing-Core | Clusters/Cluster/MembershipHeartbeatPeriod | default 1000 | milliseconds |
| NetworkLoadBalancing-Core | Clusters/Cluster/MembershipHeartbeatLossTolerance | default 5 | count |
| NetworkLoadBalancing-Core | Clusters/Cluster/Portrules/Portrule/LoadWeight | at least 0 | number |
| Embedded-UnifiedWriteFilter | OverlayCriticalThreshold | default 1024 | MB |
| Embedded-UnifiedWriteFilter | OverlayWarningThreshold | default 512 | MB |

Also corrected: PnpCustomizationsWinPE `DriverPaths/PathAndCredentials/Key` is valid in `windowsPE` like its
siblings (its page lists the NonWinPE passes by mistake).

## Source and attribution

Setting names, types, passes and allowed values are derived from Microsoft's Unattended Windows Setup Reference on Microsoft Learn. Help text is a short paraphrase written for this project, not a copy of the reference; read the reference for the authoritative description of each setting. Windows and Windows Server are trademarks of Microsoft.

## Automatic fixes

`rules.mjs` gives a rule an optional `fix(model, catalog)` with a short `fixLabel` when a safe automatic fix exists. A fix is pure: it returns a new model and changes only what makes its rule pass (each fix has a test that checks exactly that). Builders call `fixesFor(issues)` to show buttons and `applyFix(model, catalog, ruleId)` to apply one.

Rules with a fix: `component.unknown`, `component.passNotAllowed`, `setting.unknown`, `setting.passNotAllowed`, `setting.deprecated`, `value.list`, `value.boolean`, `value.range`, `value.maxLength`, `list.orderUnique`, `join.exclusive`, `join.ouWithoutDomain`, `computerName.length`, `computerName.digits`, `computerName.chars`, `autologon.logonCount`, `command.willReboot`, `productKey.format`, `disk.extendWithSize`, `disk.extendLast`, `disk.efiSize`, `disk.efiFormat`, `disk.activeOnGpt`, `install.toAndAvailable`, `servicing.publicKeyToken`, `servicing.selection`, `servicing.selectionDuplicate`, `servicing.selectionWithoutConfigure`.

Rules without an automatic fix, and why (the same list is exported as `NO_FIX`):

| Rule id | Why there is no automatic fix |
| --- | --- |
| `pass.unknown` | The intended pass cannot be guessed; moving or deleting the settings could lose work. |
| `value.enum` | The check already ignores case, so a value it reports is not a spelling variant; the intended choice is unknown. |
| `disk.mbrActive` | The reference marks ModifyPartition/Active itself as deprecated, so adding it trades this error for a warning; the user should decide. |
| `value.integer` | There is no safe number to turn arbitrary text into. |
| `list.keyMissing` | A key is an identity (an address, a name) the user must choose. |
| `list.keyDuplicate` | Which of the two items is right is a judgement; renaming either could break references. |
| `join.credentials` | Credentials are secrets only the user has. |
| `join.credentialsIncomplete` | The missing domain, user name or password is unknown. |
| `autologon.password` | A password is a secret; writing an empty one would weaken security silently. |
| `autologon.username` | The account to sign in is the user's choice. |
| `password.blankAdministrator` | Choosing a password for the user would hide a secret they do not know. |
| `command.missing` | The command to run is unknown; deleting the item could drop intended work. |
| `productKey.alphabet` | A key with impossible characters is a typo; the right characters are unknown. |
| `disk.extendCount` | Which partition should take the rest of the disk is a layout decision. |
| `disk.sizeRequired` | The partition size is a layout decision. |
| `disk.msrCount` | Adding or removing an MSR changes partition numbers that other settings refer to. |
| `disk.gptNoExtended` | Converting between GPT and MBR layouts is a design decision. |
| `disk.mbrPrimaryLimit` | Merging or converting partitions changes the layout the user designed. |
| `disk.modifyTarget` | The intended partition is unknown. |
| `disk.letterDuplicate` | Which partition keeps the letter is the user's choice. |
| `disk.fit` | Shrinking partitions to fit could cut space the user needs. |
| `install.target` | The intended install partition is unknown. |
| `servicing.action` | The intended package action cannot be guessed. |
| `servicing.identity` | Package identity values come from the package itself. |
| `servicing.version` | The package version comes from the package itself. |
| `servicing.permanence` | Permanence changes how a package can be removed later; the intent is unknown. |
| `servicing.sourceLocation` | The package path is unknown. |
| `servicing.installNeedsSource` | The package path is unknown, and the package may already be staged. |
