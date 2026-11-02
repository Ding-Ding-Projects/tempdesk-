# TempDesk website

The public website: landing page, feature articles, docs, Answer File Studio (`answer-file.html`) and the Base64 toolkit (`tools/base64.html`). Everything runs in the browser. Nothing a visitor types or opens is uploaded.

## Build and test

```sh
node site/build.mjs          # writes site/_site/ (gitignored)
node --test site/tests/      # unit tests (no dependencies)
python3 -m http.server -d site/_site 8000
```

`build.mjs` has no dependencies. It:

- copies the static pages, `assets/` and `i18n/`
- renders `features/<id>.html` from `features.json`
- renders `docs/*.html` from `docs/*.md` and every component `README.md` with its own small Markdown renderer
- copies the TempDesk payload (`server/`, `agent/`, `client/`, `portal/`, without tests, caches, `.env` files or `node_modules`) to `payload/` with `payload/manifest.json` (path, size and SHA-256 of each file); the studio checks every hash before it puts a file in the kit
- copies `answerfile/unattend-catalog.json`, `generate.mjs` and `rules.mjs` when they exist (the studio falls back to a built-in core catalog and says so when they do not)
- writes `search-index.json`, `sitemap.xml`, `robots.txt` and `404.html`

`.github/workflows/pages.yml` runs the tests, the build, and deploys `site/_site` to GitHub Pages.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | Landing page (approved design `design/project/Main.dc.html`) |
| `answer-file.html` | Answer File Studio app shell |
| `templates/` | Shared page layout and the Base64 page body |
| `assets/answer.js` | Pure answer file functions (`window.TempDeskAnswer`, also `require`-able): XML generation for the three templates, import, two-way sync, compare, simulate, quick fixes, snippets, validation, `firstboot.json` |
| `assets/zip.js` | Small ZIP writer (stored entries, UTF-8 names) |
| `assets/history.js` | Append-only history with unlimited undo and redo (IndexedDB, then localStorage, then memory) |
| `assets/base64.js` | Base64 codec (variants, streaming, strict offsets, data: URLs, type detection, SHA-256) |
| `assets/wording.js` | Personal wording validator and translator |
| `assets/canvas/` | Framework-free ES modules shared with the desktop app: catalog forms, search, setup flow, disk layout, command timeline, deployment map |
| `assets/site.js` | Settings (language, motion, theme, text size, personal wording) and the Ctrl+Shift+F command palette |
| `i18n/en.json`, `i18n/zh-HK.json` | Every interface string, with identical keys (checked by the tests) |

## Fonts

No fonts are vendored. Pages use the system stack (Segoe UI Variable, Segoe UI, Roboto, system-ui, and Noto Sans TC, Microsoft JhengHei or PingFang HK for Traditional Chinese), so there is nothing to download and no third-party font request.

## Privacy

Settings, presets, personal wording and history are stored in the visitor's browser only (localStorage or IndexedDB). Passwords are left out of history and presets unless the visitor ticks the option to keep them. The only network request to a third party is the GitHub API call on the landing page that shows the latest release.
