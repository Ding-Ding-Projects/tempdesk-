# AGENTS.md

Guidance for coding agents working in this repository.

## Layout

| Folder | What lives there | Language |
| --- | --- | --- |
| `server/` | Windows Server 2025 Core setup: unattended first boot, forest creation, domain setup, guest reaper, native portal hosting, app host | PowerShell |
| `agent/` | TempDesk Agent Windows service: the HTTP API in `docs/API.md` | C# 5 on .NET Framework 4.8 (built with the in-box compiler) |
| `samba/` | TempDesk Lite: Samba 4 domain controller container implementing the same API | Python, shell |
| `portal/` | Guest portal and admin console (one image, `PORTAL_MODE=guest` or `admin`) | Python (FastAPI, Jinja2) |
| `streaming/` | App streaming through Apache Guacamole and RemoteApp files | Python |
| `client/` | Scripts that run on shared PCs through Group Policy | PowerShell |
| `deployer/` | TempDesk Deployer desktop app and its PowerShell engine | JavaScript, PowerShell |
| `answerfile/` | Unattend settings catalog and the shared XML generator | JSON, JavaScript |
| `site/` | Public website, including the answer file builder | HTML, CSS, JavaScript |
| `design/` | Approved design canvas and tokens | HTML |

## Rules

- `docs/API.md` is the contract between the agents (Windows and Samba) and the portals. Change it first, then both sides.
- Never put secrets in the repository, in logs or in URLs. Passwords travel in request bodies or environment variables only.
- Destructive operations require an explicit confirmation value on the server side, not just in the UI.
- Guests are always standard users. Nothing in this repository may grant them administrator rights.
- Every user-facing string goes through the i18n catalogs (`en.json`, `zh-HK.json`) with identical keys.
- Respect `prefers-reduced-motion` and the in-app Motion setting for every animation.
- Run the tests before committing: `python -m pytest portal samba streaming`, `node --test site/tests answerfile/tests`, and parse-check every `.ps1`.

## Agent conversation vocabulary

Agents working in this repository use the shared private conversation vocabulary defined in
the maintainer's canonical agent instructions for every reply, including chat prose, visible
reasoning, status lines, and task or session titles. Read those instructions and apply them
in full. They are deliberately not restated here, because this file is part of this
repository's public record.

That vocabulary never appears in anything published. Keep it out of commit messages, branch
names, code, code comments, test names, documentation, this file, issues, pull requests,
discussions, release notes, published sites, logs, and every other file in this repository.
Published writing uses ordinary professional English, and exact technical identifiers always
keep their literal spelling. The single documented public-safe exception is named in those
canonical instructions; do not infer any other.
