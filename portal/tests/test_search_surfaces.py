"""Search surfaces: every list, table, tree, panel, picker, menu and tab strip has its own search
field wired to the shared regex builder (site/assets/regex-builder.js, copied into the image).

portal/search_surfaces.json is the hand-written catalogue. The guard below walks every template
and script for containers and fails, with file and line, when one has neither a registered search
(data-searchable / "search: <id>") nor a written reason (data-search-exempt / "search-exempt:").
A rule that only checks the fields that exist could never find a missing one.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from urllib.parse import quote

import pytest

from tests.conftest import Portal
from tests.fake_agent import BASE

PORTAL = Path(__file__).resolve().parent.parent
APP = PORTAL / "app"
TEMPLATES = APP / "templates"
JS = APP / "static" / "js"
CATALOGUE = json.loads((PORTAL / "search_surfaces.json").read_text(encoding="utf-8"))
SURFACES = CATALOGUE["surfaces"]
IDS = {s["id"] for s in SURFACES}
GID = "{31B2F340-016D-11D2-945F-00C04FB984F9}"
ADMIN_DN = f"CN=Administrator,CN=Users,{BASE}"
# The shared module and this module draw their own builder UI (gallery listbox, preview tables).
SHARED_UI = {"regex-builder.js", "base64.js", "zip.js"}

CONTAINER_TAG = re.compile(r"<(table|ul|ol|select|datalist)\b|<\w+\b[^>]*?\brole=\"(tree|treegrid|listbox|grid|tablist|list|menu|menubar|log)\"", re.S)
JS_CONTAINER = re.compile(
    r"(?:\bel\(\s*'(?:ul|ol|table|select|datalist)'|createElement\(\s*'(?:ul|ol|table|select|datalist)'\)"
    r"|setAttribute\(\s*'role',\s*'(?:tree|treegrid|listbox|grid|tablist|list|menu|menubar)'\)"
    r"|role:\s*'(?:tree|treegrid|listbox|grid|tablist|list|menu)')")


def _open_tag(text: str, start: int) -> str:
    """The opening tag that starts at start, skipping '>' inside quotes and Jinja blocks."""
    i, quote_ch, depth = start, None, 0
    while i < len(text):
        two = text[i:i + 2]
        if quote_ch is None and two in ("{{", "{%"):
            depth += 1; i += 2; continue
        if quote_ch is None and depth and two in ("}}", "%}"):
            depth -= 1; i += 2; continue
        c = text[i]
        if depth == 0:
            if quote_ch:
                if c == quote_ch:
                    quote_ch = None
            elif c in "\"'":
                quote_ch = c
            elif c == ">":
                return text[start:i + 1]
        i += 1
    return text[start:]


def _template_containers():
    for p in sorted(TEMPLATES.rglob("*.html")):
        text = p.read_text(encoding="utf-8")
        for m in CONTAINER_TAG.finditer(text):
            start = m.start()
            tag = _open_tag(text, start)
            line = text.count("\n", 0, start) + 1
            yield p, line, tag


def _registered(tag_or_line: str):
    m = re.search(r'data-searchable="([^"]+)"', tag_or_line)
    if m:
        return re.findall(r"\S*\{\{.*?\}\}\S*|\S+", m.group(1))
    m = re.search(r"search: ([\w, -]+?) \*/", tag_or_line)
    if m:
        return [x.strip() for x in m.group(1).split(",") if x.strip()]
    return None


def _exempt(tag_or_line: str) -> bool:
    return bool(re.search(r'data-search-exempt="[^"]{6,}"', tag_or_line) or re.search(r"search-exempt: \S.{4,}", tag_or_line)
                or re.search(r"data-search-exempt', '[^']{6,}'", tag_or_line))


def _known(ids, file_rel: str):
    bad = []
    for i in ids:
        if "{{" in i:  # a Jinja value such as table-{{ tv.id }}: some entry must come from this template
            prefix = i.split("{{")[0]
            if not any(s["template"] == file_rel and s["id"].startswith(prefix) for s in SURFACES):
                bad.append(i)
        elif i not in IDS:
            bad.append(i)
    return bad


# ---------------------------------------------------------------- the guard

def test_every_container_in_templates_has_a_registered_search():
    missing = []
    for p, line, tag in _template_containers():
        rel = str(p.relative_to(PORTAL))
        ids = _registered(tag)
        if ids is None and not _exempt(tag):
            missing.append(f"{rel}:{line}: {tag[:140]}")
        elif ids:
            for b in _known(ids, rel):
                missing.append(f"{rel}:{line}: data-searchable id {b!r} is not in search_surfaces.json")
    assert not missing, "Containers without a search field (add one, or data-search-exempt with a reason):\n" + "\n".join(missing)


def test_every_container_in_scripts_has_a_registered_search():
    missing = []
    for p in sorted(JS.glob("*.js")):
        if p.name in SHARED_UI:
            continue
        rel = str(p.relative_to(PORTAL))
        for n, line in enumerate(p.read_text(encoding="utf-8").splitlines(), 1):
            if not JS_CONTAINER.search(line):
                continue
            ids = _registered(line)
            if ids is None and not _exempt(line):
                missing.append(f"{rel}:{n}: {line.strip()[:140]}")
            elif ids:
                missing += [f"{rel}:{n}: search id {b!r} is not in search_surfaces.json" for b in _known(ids, rel)]
    assert not missing, "Script-built containers without a search field (/* search: id */ or /* search-exempt: reason */):\n" + "\n".join(missing)


def test_guard_detects_a_missing_search(tmp_path):
    # The guard must fail on a bare list; a regression here would make the whole check pointless.
    tag = _open_tag('<ul class="x" data-foo="{{ a > b }}"><li>1</li></ul>', 0)
    assert tag == '<ul class="x" data-foo="{{ a > b }}">'
    assert _registered(tag) is None and not _exempt(tag)
    assert _registered('<ul data-searchable="docs-list">') == ["docs-list"]
    assert _exempt('<ol data-search-exempt="fixed setup step indicator">')
    assert not _exempt('<ol data-search-exempt="">')
    assert _registered("var t = el('table'); /* search: dir-attributes */") == ["dir-attributes"]


# ---------------------------------------------------------------- the catalogue

def test_catalogue_is_well_formed():
    assert len(SURFACES) == len(IDS), "duplicate ids"
    for s in SURFACES:
        assert set(s) >= {"id", "template", "selector", "consumer"}, s
        assert re.fullmatch(r"[a-z0-9][a-z0-9-]*", s["id"]), s["id"]
        assert (PORTAL / s["template"]).is_file(), s["template"]
        assert s["selector"] == f'[data-search-surface="{s["id"]}"]' or s["selector"].startswith("[data-search-surface="), s
        src = (PORTAL / s["template"]).read_text(encoding="utf-8")
        assert s["id"] in src or s["id"].startswith("table-"), f'{s["id"]} not found in {s["template"]}'
        if "page" not in s:
            assert s.get("rendered") == "script" or s.get("condition"), f'{s["id"]}: give a page, rendered=script or a condition'


def test_every_registered_container_is_in_the_catalogue():
    used = set()
    for p, _line, tag in _template_containers():
        used.update(i for i in (_registered(tag) or []) if "{{" not in i)
    for p in JS.glob("*.js"):
        for line in p.read_text(encoding="utf-8").splitlines():
            if JS_CONTAINER.search(line):
                used.update(_registered(line) or [])
    assert used <= IDS


def test_shared_builder_is_the_site_copy_and_in_the_image():
    site = PORTAL.parent / "site" / "assets" / "regex-builder.js"
    ours = JS / "regex-builder.js"
    assert ours.is_file()
    if site.exists():
        assert ours.read_bytes() == site.read_bytes(), "portal/app/static/js/regex-builder.js drifted from site/assets"
    dockerfile = (PORTAL / "Dockerfile").read_text()
    assert "site/assets/regex-builder.js" in dockerfile
    base = (TEMPLATES / "layouts" / "base.html").read_text()
    a, b, c = base.index("/static/js/app.js"), base.index("/static/js/regex-builder.js"), base.index("/static/js/search-surfaces.js")
    assert a < b < c < base.index("/static/js/palette.js") < base.index("/static/js/console.js")
    surf = (JS / "search-surfaces.js").read_text()
    assert "attachRegexBuilder(" in surf and "persistKey" not in surf and "localStorage" not in surf


def test_no_hand_rolled_regex_toggles_remain():
    for p in list(TEMPLATES.rglob("*.html")) + list(JS.glob("*.js")):
        if p.name in SHARED_UI or p.name == "server-table.js":
            continue
        text = p.read_text(encoding="utf-8")
        assert "data-regex-toggle" not in text and "data-ged-re" not in text and "data-srv-regex" not in text, p.name
        assert "new RegExp(q" not in text and "new RegExp(q.value" not in text, p.name


def test_labels_are_translated_with_identical_keys():
    from app.i18n import CATALOGS
    en, zh = CATALOGS["en"]["strings"], CATALOGS["zh-HK"]["strings"]
    assert set(en) == set(zh)
    keys = set()
    for p in TEMPLATES.rglob("*.html"):
        keys.update(re.findall(r"data-search-label=\"\{\{ ta\('((?:\\'|[^'])*)'", p.read_text(encoding="utf-8")))
    for k in keys:
        assert k in en and k in zh, k
    rx = [k for k in en if k.startswith("rx.")]
    assert len(rx) > 100 and all(zh[k] for k in rx)
    shipped = json.loads((JS / "console-strings.json").read_text(encoding="utf-8"))
    assert {"rx.toggle", "rx.builder", "rx.title", "Close tabs containing text", "Close tabs not containing text"} <= set(shipped)


# ---------------------------------------------------------------- every entry renders with a builder-wired field

def _setup_admin(p: Portal):
    p.post("/guests", {"expiryId": "1h", "displayName": "Zed"}, page="/guests")
    p.app.state.history.record("settings", "settings", "{}", "test")  # one saved version for /history/settings


@pytest.fixture(scope="module")
def pages(tmp_path_factory):
    admin = Portal("admin", tmp_path_factory.mktemp("admin"))
    admin.login()
    _setup_admin(admin)
    guest = Portal("guest", tmp_path_factory.mktemp("guest"))
    cache = {}

    def get(mode: str, path: str) -> str:
        key = (mode, path)
        if key not in cache:
            client = (admin if mode == "admin" else guest).client
            r = client.get(path.replace("{GID}", quote(GID, safe="")).replace("{DN}", quote(ADMIN_DN, safe="")).replace("{BASEDN}", quote(BASE, safe="")))
            cache[key] = r.text if r.status_code == 200 else f"HTTP {r.status_code}"
        return cache[key]
    return get


@pytest.mark.parametrize("entry", [s for s in SURFACES if "page" in s], ids=lambda s: s["id"])
def test_catalogue_entry_renders_with_a_builder_wired_field(pages, entry):
    html = pages(entry.get("mode", "admin"), entry["page"])
    assert not html.startswith("HTTP "), f'{entry["page"]}: {html}'
    marker = entry["selector"][1:-1]  # data-search-surface="id"
    assert marker in html, f'{entry["id"]}: {marker} missing on {entry["page"]}'
    assert "/static/js/regex-builder.js" in html and "/static/js/search-surfaces.js" in html
    if entry.get("container"):
        assert entry["container"] in html, f'{entry["id"]}: container {entry["container"]} missing on {entry["page"]}'


@pytest.mark.parametrize("entry", [s for s in SURFACES if s.get("rendered") == "script"], ids=lambda s: s["id"])
def test_script_rendered_entry_is_mounted_by_its_script(entry):
    src = (PORTAL / entry["template"]).read_text(encoding="utf-8")
    assert re.search(r"(TDSearch|S)\.mount\(|data-search-surface", src)
    assert entry["id"] in src
    if entry.get("page"):
        return
    assert entry.get("host_page"), f'{entry["id"]}: say which page loads the script (host_page)'
