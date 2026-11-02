# TempDesk answer file catalog

This folder holds the shared data and code that the TempDesk answer file builders use to create and edit
Windows answer files (`autounattend.xml` and `unattend.xml`):

| File | What it is |
| --- | --- |
| `unattend-catalog.json` | Machine-readable catalog of every component and setting in the Microsoft *Unattended Windows Setup Reference*, with paraphrased help text. |
| `catalog.schema.json` | JSON Schema (draft 2020-12) for the catalog. |
| `generate.mjs` | Dependency-free ES module: `buildXml`, `parseXml`, `validateModel`, password encoding and a tiny XML parser. Runs in browsers and in Node 18+. |
| `tests/` | `node --test` suites for the catalog and the generator. |
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
| By type | 577 string, 202 boolean, 133 enum, 99 integer, 18 password, 205 container, 54 list |
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

```js
import { buildXml, parseXml, validateModel } from './generate.mjs';
const catalog = await (await fetch('unattend-catalog.json')).json();
const issues = validateModel(model, catalog);   // [{level, where, message}] for inline UI errors
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
- Types for the less used components come from automatic reading of the pages. Some values documented as
  "string" that only accept numbers stay `string`; check `suggestions` and `rangeNote`.
- Cross-setting rules (JoinDomain versus JoinWorkgroup, partition sizes, the 0 to 3 partition ID rules) are in
  the help text but not enforced by `validateModel`.
- Package and driver sections of an answer file (`<package>`, `servicing`) are not modeled; `parseXml` reports them in `unknown`.

## Source and attribution

Setting names, types, passes and allowed values are derived from Microsoft's Unattended Windows Setup Reference on Microsoft Learn. Help text is a short paraphrase written for this project, not a copy of the reference; read the reference for the authoritative description of each setting. Windows and Windows Server are trademarks of Microsoft.
