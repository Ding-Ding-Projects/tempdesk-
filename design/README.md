# TempDesk design

The approved visual design for TempDesk, as a design canvas export. Each `.dc.html` file in `project/` is one artboard; `project/canvas.json` lists their positions.

| Artboard | Surface |
| --- | --- |
| `Main.dc.html` | Website landing page |
| `Guest-Create.dc.html` | Guest portal: create a sign-in |
| `Guest-Credentials.dc.html` | Guest portal: the sign-in shown once |
| `Admin-Dashboard.dc.html` | Admin console: dashboard |
| `Admin-Gpo.dc.html` | Admin console: Administrative Templates editor |
| `Admin-Server.dc.html` | Admin console: server overview |
| `Deployer.dc.html` | Deployer desktop app: unattended setup progress |
| `Answer-Builder.dc.html` | Answer File Studio: explorer, tabbed canvases and code, inspector, problems with quick fixes, status bar |
| `Answer-AllSettings.dc.html` | Answer file builder: every catalog setting by component |
| `Answer-Builder-Phone.dc.html` | Answer File Studio on a phone: one pane with a bottom tab bar |
| `Answer-Canvas.dc.html` | Setup flow canvas: passes as lanes, drag components between passes |
| `Answer-Disk.dc.html` | Disk layout canvas and command timeline |
| `Base64.dc.html` / `Base64-Phone.dc.html` | Base64 toolkit on desktop and phone |
| `History.dc.html` / `History-Phone.dc.html` | History with unlimited undo and redo |

## Tokens

| Token | Value |
| --- | --- |
| Ground | `#0B1110` |
| Surfaces | `#0F1716`, `#121A19`, `#16211F`, `#1A2725` |
| Outline | `#22322F`, `#2E4642` |
| Text / muted | `#E8F1EF` / `#A9BBB8` |
| Primary / on primary | `#7CF3E6` / `#04201D` |
| Coral / on coral | `#FFB8A3` / `#2B0C03` |
| Type | Segoe UI Variable, system fallbacks; Cascadia Mono for credentials |
| Shape | 14 to 28 px radii, pill buttons, 44 px minimum touch targets |

Motion: entrance rise and pop with `cubic-bezier(.2,.9,.25,1)`, everything off under `prefers-reduced-motion`.

## Admin console (control room redesign, 2026-11-03)

| Artboard | Surface |
| --- | --- |
| `Console-Home.dc.html` | Control room home: command bar, live tiles, today's session timeline, activity with undo |
| `Console-Guests.dc.html` | Guest cards with countdown rings, quick extend, detail drawer |
| `Console-Directory.dc.html` | Directory studio: explorer tree, tabbed object editors, map, query builder, bulk edit, inspector, problems panel |
| `Console-Policy.dc.html` | Group Policy editor: full editor tree, policy list, rich state editor |
| `Console-Server.dc.html` | Server: live performance and tool tiles |
| `Console-Phone.dc.html` | The console on a phone: command bar on top, bottom bar navigation |

Ground `#070B0B` with a 28 px dot grid, tiles `#0E1615` with `#1C2927` borders, 22 to 28 px radii, floating dock navigation. The plain HTTP warning is a status pill, not a banner. The older `Admin-*.dc.html` artboards are superseded.

### Personal wording in management Settings

Use the desktop and phone console shells from `Console-Home.dc.html` and `Console-Phone.dc.html`. Keep the wording card after the logo settings. Place the state, file picker and Apply or Replace action in that order, with Clear alongside the action where space allows. Use the existing card, filled action and alert styles. On narrow screens the controls wrap in reading order.

An empty card shows the original wording state. An invalid file leaves the last valid wording visible and announces the result. Clear restores original copy and returns focus to the file control. The decorative drop overlay keeps focus in the current workflow.

The adjacent first-run setup action uses the same label wrapping when bilingual text grows. Keep the action within its card and retain the existing button style.

The [action-sound detail](management-sounds/Settings-Sounds.dc.html) uses the same form grid, checkbox and helper text as the display preferences. Keep the sound control in the basic view, after the focus preference in the expanded view. The label is at least 48 px high and the help wraps within its field. In school mode, show the suppression message alongside the saved choice and keep the control editable. The checked-in canvas records both states and its accent and motion controls.

### Deployer notification wording

Use the existing Deployer drawer, search controls and corner notifications. Applying or clearing personal wording updates the open drawer and search count in place. A matching row keeps keyboard focus when its text changes. Errors and warnings keep their dismiss control until the user closes them. The current wording applies to notice text and accessible names. Technical arguments stay literal.


## Virtual Commons design reference

Use the guest creation artboard's radio choice tiles for server edition selection. The edition group shares the existing choice grid, spacing, typography, colors and focus treatment. Unavailable editions remain visible and are marked unavailable. Use the guest credentials artboard for the checkout result and the existing filled action for the RDP download. The dim sum result uses the same guest card and action styles. Live visual parity remains to be verified.

The checkout button keeps the guest creation artboard's filled pill and 56 px minimum height. Its label stays centered and wraps inside the pill as the available width decreases or the text grows. At 360 px, the full action label must fit. At 1440 px, a label that fits uses one line. The same layout supports both language catalogues.
