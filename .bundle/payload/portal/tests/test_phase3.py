import io
import json
import re
import sqlite3
import time
import zipfile
from pathlib import Path

import pytest

from app.i18n import CATALOGS, Translator
from app.xlsx import workbook
from tests.conftest import Portal

APP = Path(__file__).resolve().parent.parent / "app"
TEMPLATES = APP / "templates"

# ---------------------------------------------------------------- XLSX


def test_xlsx_structure_and_openpyxl():
    data = workbook(["Name", "Count", "Formula-like"], [["Alex", 3, "=1+1"], ["Bo <&>", 2.5, True]], "Guests")
    z = zipfile.ZipFile(io.BytesIO(data))
    names = set(z.namelist())
    assert {"[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml", "xl/styles.xml"} <= names
    openpyxl = pytest.importorskip("openpyxl")
    ws = openpyxl.load_workbook(io.BytesIO(data)).active
    assert ws.title == "Guests"
    assert [c.value for c in ws[1]] == ["Name", "Count", "Formula-like"]
    assert [c.value for c in ws[2]] == ["Alex", 3, "=1+1"]
    assert ws["A2"].data_type == "s" and ws["C2"].data_type == "s"  # text, never a formula
    assert ws["A3"].value == "Bo <&>" and ws["B3"].value == 2.5 and ws["C3"].value is True
    assert ws["A1"].font.b


def test_every_table_exports_xlsx(admin):
    admin.post("/guests", {"expiryId": "1h", "displayName": "Alex"}, page="/guests")
    r = admin.client.get("/guests?export=xlsx")
    assert r.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    pw = list(admin.state.guests.values())[0]["password"]
    sheet = zipfile.ZipFile(io.BytesIO(r.content)).read("xl/worksheets/sheet1.xml").decode()
    assert "Alex" in sheet and pw not in sheet
    assert "export=xlsx" in admin.client.get("/gpo").text


# ---------------------------------------------------------------- funny level

SERIOUS_HINTS = ("password", "error", "not accepted", "cannot", "security", "encrypt", "unencrypted", "too many",
                 "not valid", "refused", "confirm", "delete", "expired", "shown only once", "only once", "never")


def test_fun_variants_complete_and_never_on_serious_text():
    for lang in ("en", "zh-HK"):
        fun = CATALOGS[lang]["fun"]
        assert len(fun) >= 30
        for key, levels in fun.items():
            assert set(levels) == {"1", "2", "3"}, key
            assert key in CATALOGS[lang]["strings"]
            low = key.lower()
            assert not any(h in low for h in SERIOUS_HINTS), f"serious text has a fun variant: {key}"
    assert set(CATALOGS["en"]["fun"]) == set(CATALOGS["zh-HK"]["fun"])


@pytest.mark.parametrize("level,expected", [(0, "Need a computer?"), (1, "Need a computer? Easy."), (2, "Need a computer? We have you covered."), (3, "Need a computer? Say no more")])
def test_fun_levels_apply_in_both_languages(level, expected):
    assert Translator("en", level).plain("Need a computer?").startswith(expected)
    zh = Translator("zh-HK", level).plain("Need a computer?")
    assert zh == (CATALOGS["zh-HK"]["strings"]["Need a computer?"] if level == 0 else CATALOGS["zh-HK"]["fun"]["Need a computer?"][str(level)])
    assert Translator("en", level).plain("Need a computer?", serious=True) == "Need a computer?"


def test_fun_level_on_pages(guest):
    tok = guest.token()
    for level, text in (("1", "Need a computer? Easy."), ("2", "We have you covered"), ("3", "Say no more")):
        guest.client.post("/prefs", data={"csrf_token": tok, "fun": level, "next": "/"})
        assert text in guest.client.get("/").text
    # Security notice on the credentials page stays serious at level 3.
    guest.post("/create", {"expiryId": "1h"})
    page = guest.client.get("/created").text
    assert "Write it down or keep this page open. The password is shown only once." in page


# ---------------------------------------------------------------- context menus and info buttons

def _templates():
    return [p for p in TEMPLATES.rglob("*.html") if p.name != "macros.html"]


def test_every_data_row_has_a_context_menu():
    missing = []
    for p in _templates():
        text = p.read_text()
        body = re.sub(r"<thead>.*?</thead>", "", text, flags=re.S)
        for m in re.finditer(r"<tr\b[^>]*>", body):
            if "data-ctx" not in m.group(0):
                missing.append(f"{p.relative_to(TEMPLATES)}: {m.group(0)}")
    assert not missing, "\n".join(missing)


def test_context_menu_script_covers_cards_and_rows():
    js = (APP / "static/js/app.js").read_text()
    assert "CTX_SEL = '[data-ctx], tbody tr, .card, .srv-card'" in js
    assert "Shift+F10" in js or "F10" in js


def _blocks(text: str, start_idx: int) -> str:
    """Return the element that starts at start_idx (balanced on div/label/span/fieldset)."""
    tag = re.match(r"<(\w+)", text[start_idx:]).group(1)
    depth, i = 0, start_idx
    pat = re.compile(rf"<(/?){tag}\b[^>]*>")
    for m in pat.finditer(text, start_idx):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return text[start_idx:m.end()]
        i = m.end()
    return text[start_idx:]


def test_every_advanced_control_has_an_info_button():
    missing, count = [], 0
    for p in _templates():
        text = p.read_text()
        for m in re.finditer(r"<\w+[^>]*\bdata-advanced\b[^>]*>", text):
            count += 1
            el = _blocks(text, m.start())
            tail = text[m.start() + len(el): m.start() + len(el) + 400]
            if "info(" not in el and not re.match(r"\s*\{\{ info\(", tail):
                missing.append(f"{p.relative_to(TEMPLATES)}: {m.group(0)}")
    assert count >= 40
    assert not missing, "\n".join(missing)


def test_info_texts_translated():
    keys = set()
    for p in _templates():
        for m in re.finditer(r"info\('((?:\\'|[^'])*)'\)", p.read_text()):
            keys.add(m.group(1).replace("\\'", "'").replace("\\\\", "\\"))
    zh = CATALOGS["zh-HK"]["strings"]
    untranslated = [k for k in keys if "{{" not in k and k not in zh]
    assert not untranslated, untranslated


def test_color_picker_present(admin):
    page = admin.client.get("/settings").text
    assert "data-colorpicker" in page and "/static/js/colorpicker.js" in page
    js = admin.client.get("/static/js/colorpicker.js").text
    for needle in ("role', 'slider'", "ArrowRight", "rgbToHsv", "contrast(", "Hex"):
        assert needle in js


# ---------------------------------------------------------------- persistence

def test_admin_session_survives_restart(tmp_path):
    p = Portal("admin", tmp_path)
    p.login()
    cookies = dict(p.client.cookies)
    p2 = Portal("admin", tmp_path)  # new process, same data dir and secret
    p2.state.tokens.update(p.state.tokens)  # the agent still knows the token
    for k, v in cookies.items():
        p2.client.cookies.set(k, v)
    r = p2.client.get("/guests", follow_redirects=False)
    assert r.status_code == 200


def test_rate_limit_survives_restart(tmp_path):
    env = {"GUEST_CREATE_LIMIT": "2"}
    p = Portal("guest", tmp_path, extra_env=env)
    assert [p.post("/create", {"expiryId": "1h"}).status_code for _ in range(2)] == [303, 303]
    p2 = Portal("guest", tmp_path, extra_env=env)
    assert p2.post("/create", {"expiryId": "1h"}).status_code == 429


def test_one_time_store_survives_restart_and_is_encrypted(tmp_path):
    p = Portal("guest", tmp_path)
    p.post("/create", {"expiryId": "1h"})
    pw = list(p.state.guests.values())[0]["password"]
    db_file = Path(p.settings.state_dir) / "portal-state.sqlite3"
    raw = db_file.read_bytes()
    for side in db_file.parent.glob("portal-state.sqlite3*"):
        raw += side.read_bytes()
    assert pw.encode() not in raw  # encrypted at rest
    assert (db_file.parent / "portal-state.key").stat().st_mode & 0o777 == 0o600
    cookies = dict(p.client.cookies)
    p2 = Portal("guest", tmp_path)
    for k, v in cookies.items():
        p2.client.cookies.set(k, v)
    page = p2.client.get("/created")
    assert page.status_code == 200 and pw in page.text
    assert p2.client.get("/created").status_code == 410  # consumed on first view
    assert len(p2.app.state.once) == 0


def test_one_time_store_expires(tmp_path):
    p = Portal("guest", tmp_path)
    store = p.app.state.once
    key = store.put({"a": 1})
    p.app.state.db.execute("UPDATE once SET created = ?", (time.time() - 601,))
    assert store.pop(key) is None


def test_admin_secrets_encrypted_with_session_secret(tmp_path):
    p = Portal("admin", tmp_path)
    p.login()
    token = next(iter(p.state.tokens))
    db_file = Path(p.settings.state_dir) / "portal-state.sqlite3"
    raw = b"".join(f.read_bytes() for f in db_file.parent.glob("portal-state.sqlite3*"))
    assert token.encode() not in raw
    assert not (db_file.parent / "portal-state.key").exists()  # admin key is derived, not stored
    # A different secret cannot read the stored session.
    p3 = Portal("admin", tmp_path, extra_env={"SESSION_SECRET": "z" * 48})
    with sqlite3.connect(db_file) as c:
        sid_count = c.execute("SELECT COUNT(*) FROM sessions").fetchone()[0]
    assert sid_count == 1
    assert p3.app.state.sessions.get(dict(p.client.cookies)["td_session"]) is None


# ---------------------------------------------------------------- Base64 codec shared with the site

def test_base64_codec_is_the_site_copy():
    site = APP.parent.parent / "site" / "assets" / "base64.js"
    ours = APP / "static" / "js" / "base64.js"
    if site.exists():
        assert ours.read_bytes() == site.read_bytes()
    tool = (APP / "static/js/base64-tool.js").read_text()
    assert "window.TempDeskBase64" in tool and "TDBase64" not in tool
    dockerfile = (APP.parent / "Dockerfile").read_text()
    assert "site/assets/base64.js" in dockerfile
