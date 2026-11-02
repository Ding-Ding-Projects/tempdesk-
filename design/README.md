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
