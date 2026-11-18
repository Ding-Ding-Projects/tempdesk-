"""Personal wording and the undo journal. Fixtures use neutral words only."""

import json
import os
import re
import subprocess
from pathlib import Path

import pytest
from starlette.requests import Request

from app.i18n import Translator
from app.security import SESSION_COOKIE
from app.undo import redact
from app.vocab import WordingError, build_translator, validate
from tests.conftest import Portal, csrf_of
from tests.fake_agent import BASE

def test_translator_rules():
    tr = build_translator({"computer": "machine", "sign-in": "login", "sign": "mark"})
    assert tr("Need a computer?") == "Need a machine?"
    assert tr("Computer ready") == "Machine ready"
    assert tr("computers") == "computers"
    assert tr("Create my sign-in") == "Create my login"
    assert build_translator({"a": "b", "b": "c"})("a b") == "b c"


INVALID = [
    pytest.param(b"x" * (256 * 1024 + 1), "larger than 256 KiB", id="oversize"),
    pytest.param(json.dumps({"schemaVersion": 1, "entries": {"a": "b"}, "x": [[[[[[[[[1]]]]]]]]]}).encode(), "nested more than 8", id="depth"),
    pytest.param(b'{"schemaVersion":1,"entries":{"a":"b","a":"c"}}', "duplicate key", id="duplicate"),
    pytest.param(json.dumps({"schemaVersion": 1, "entries": {"__proto__": "b"}}).encode(), "reserved name", id="reserved"),
    pytest.param(json.dumps({"schemaVersion": 1, "entries": {"": "b"}}).encode(), "1 to 160", id="blank-key"),
    pytest.param(json.dumps({"schemaVersion": 1, "entries": {"k" * 161: "b"}}).encode(), "1 to 160", id="long-key"),
    pytest.param(json.dumps({"schemaVersion": 1, "entries": {"a": "b\u0007"}}).encode(), "control characters", id="control"),
    pytest.param(json.dumps({"schemaVersion": 1, "entries": {"a": "b" * 1001}}).encode(), "longer than 1000", id="long-value"),
    pytest.param(json.dumps({"schemaVersion": 2, "entries": {"a": "b"}}).encode(), "schemaVersion must be", id="version"),
    pytest.param(json.dumps({"schemaVersion": 1, "entries": {"a": "b"}, "extra": 1}).encode(), "Only the properties", id="extra-key"),
    pytest.param(b"not json", "not valid JSON", id="json"),
    pytest.param(b"\xff\xfe\x00", "not valid UTF-8", id="utf8"),
]


@pytest.mark.parametrize("payload,reason", INVALID)
def test_wording_schema_rejects_invalid_files(payload, reason):
    with pytest.raises(WordingError, match=re.escape(reason)):
        validate(payload)


def test_error_messages_never_echo_content():
    sample = "neutral-wording-sentinel"
    with pytest.raises(WordingError) as exc:
        validate(json.dumps({"schemaVersion": 1, "entries": {sample: "x" * 2000}}).encode())
    assert sample not in str(exc.value)


def test_product_copy_markers_exclude_interpolated_values():
    mark = str(Translator("en").html("Loaded: {count} entries.", mark_wording=True, count="literal <Settings>"))
    pieces = re.findall(r"<!--td-wording-->(.*?)<!--/td-wording-->", mark)
    assert pieces == ["Loaded: ", " entries."]
    assert "literal &lt;Settings&gt;" in mark
    assert all("Settings" not in piece for piece in pieces)


def test_wording_controls_require_an_authenticated_session(tmp_path):
    p = Portal("admin", tmp_path)
    login = p.client.get("/login").text
    assert "data-wording-scope" not in login
    assert 'src="/static/js/wording.js"' not in login
    assert "data-wording-file" not in login
    p.login()
    page = p.client.get("/settings").text
    match = re.search(r'data-wording-scope="([0-9a-f]{64})"', page)
    assert match
    cookie = p.client.cookies.get(SESSION_COOKIE)
    assert cookie and cookie not in page
    assert p.app.state.sessions.get(cookie).sid not in page
    assert 'data-wording-file' in page and '<!--td-wording-->Personal wording' in page
    assert 'No file loaded' in page
    assert 'action="/settings/wording"' not in page
    p.post("/logout")
    assert "data-wording-scope" not in p.client.get("/login").text
    p.login()
    other = p.client.get("/settings").text
    assert match[1] not in other


def test_school_mode_suppresses_wording_bootstrap(admin):
    admin.client.cookies.set("td_school", "1")
    page = admin.client.get("/settings").text
    palette = page.split('id="td-palette">')[1].split("</script>")[0]
    assert "Personal wording" not in palette
    assert "data-wording-scope" not in page and "data-wording-file" not in page


LEGACY_WORDING_ROUTES = {"/settings/wording", "/api/wording", "/settings/wording/clear"}


def test_retired_uploads_do_not_open_a_legacy_file_or_read_submitted_content(tmp_path, monkeypatch):
    old_file = tmp_path / "data" / "personal-wording.json"
    old_file.parent.mkdir()
    sentinel = b'{"schemaVersion":1,"entries":{"guest":"neutral-wording-sentinel"}}'
    old_file.write_bytes(sentinel)
    original_read = Path.read_bytes
    original_stream = Request.stream

    def read_bytes(path):
        assert path.name != "personal-wording.json"
        return original_read(path)

    async def stream(request):
        # Starlette can create a middleware receive iterator before dispatching the route.
        # Guard actual reads by the route request rather than construction of that iterator.
        assert type(request) is not Request or request.url.path not in LEGACY_WORDING_ROUTES
        async for chunk in original_stream(request):
            yield chunk

    monkeypatch.setattr(Path, "read_bytes", read_bytes)
    monkeypatch.setattr(Request, "stream", stream)
    p = Portal("admin", tmp_path)
    p.login()
    assert "neutral-wording-sentinel" not in p.client.get("/settings").text
    for route in LEGACY_WORDING_ROUTES:
        r = p.client.post(route, content=sentinel, headers={"Content-Type": "application/json"})
        assert r.status_code == 410 and r.content == b""
    assert original_read(old_file) == sentinel


def test_palette_and_settings_index_wording_controls(admin):
    page = admin.client.get("/settings").text
    palette = page.split('id="td-palette">')[1].split("</script>")[0]
    for label in ("Upload personal wording file", "Personal wording status", "Replace personal wording file", "Clear personal wording"):
        assert label in palette
    assert 'id="wording"' in page and "No file loaded" in page


# ---------------------------------------------------------------- undo journal

def git_log(p: Portal) -> str:
    root = os.path.join(p.settings.data_dir, "history.git-work")
    return subprocess.run(["git", "log", "--format=%an|%cn|%s"], cwd=root, capture_output=True, text=True).stdout


def test_attribute_undo_and_redo(admin):
    dn = f"CN=Administrator,CN=Users,{BASE}"
    tok = admin.token("/directory/create")
    admin.client.post("/directory/object/attr", data={"csrf_token": tok, "dn": dn, "attr": "description", "op": "set", "values": "first"})
    admin.client.post("/directory/object/attr", data={"csrf_token": tok, "dn": dn, "attr": "description", "op": "set", "values": "second"})
    attrs = admin.state.objects[dn]["attributes"]
    assert attrs["description"] == ["second"]
    admin.post("/undo", {"back": "/"})
    assert attrs["description"] == ["first"]
    admin.post("/undo", {"back": "/"})
    assert "description" not in attrs
    admin.post("/redo", {"back": "/"})
    assert attrs["description"] == ["first"]
    log = git_log(admin)
    assert "sam|TempDesk|attribute.set" in log and "undo" in log


def test_undo_conflict_refused(admin):
    dn = f"CN=Administrator,CN=Users,{BASE}"
    tok = admin.token("/directory/create")
    admin.client.post("/directory/object/attr", data={"csrf_token": tok, "dn": dn, "attr": "info", "op": "set", "values": "mine"})
    admin.state.objects[dn]["attributes"]["info"] = ["changed elsewhere"]
    r = admin.post("/undo", {"back": "/history"})
    assert r.status_code == 303
    assert admin.state.objects[dn]["attributes"]["info"] == ["changed elsewhere"]
    page = admin.client.get("/history").text
    assert "changed after this action" in page or "Undo this" in page


def test_create_then_undo_deletes(admin):
    tok = admin.token("/directory/create")
    admin.client.post("/directory/create", data={"csrf_token": tok, "parentDn": f"OU=TempDesk,{BASE}", "objectClass": "group", "rdn": "CN=Lab", "attributes": ""})
    dn = f"CN=Lab,OU=TempDesk,{BASE}"
    assert dn in admin.state.objects
    admin.post("/undo", {"back": "/"})
    assert dn not in admin.state.objects


def test_delete_object_restores_through_recycle_bin(admin):
    dn = f"CN=Administrator,CN=Users,{BASE}"
    admin.state.objects[dn]["attributes"]["objectGUID"] = ["0a1b2c3d-0000-4000-8000-000000000001"]
    page = admin.client.get("/directory/object", params={"dn": dn}).text
    assert "AD Recycle Bin" in page
    token = page.split('data-token="')[-1].split('"')[0]
    admin.client.post("/directory/delete", data={"csrf_token": csrf_of(page), "dn": dn, "confirm_name": dn, "confirm_token": token})
    assert dn not in admin.state.objects
    admin.post("/undo", {"back": "/"})
    inv = [c for c in admin.state.calls if c[1] == "/api/v1/cmdlets/invoke"]
    assert inv, "Restore-ADObject was not called"


def test_delete_on_samba_marked_not_undoable(tmp_path):
    p = Portal("admin", tmp_path, backend="samba")
    p.login()
    dn = f"CN=Administrator,CN=Users,{BASE}"
    page = p.client.get("/directory/object", params={"dn": dn}).text
    assert "cannot be restored on this backend" in page
    token = page.split('data-token="')[-1].split('"')[0]
    p.client.post("/directory/delete", data={"csrf_token": csrf_of(page), "dn": dn, "confirm_name": dn, "confirm_token": token})
    rec = p.app.state.journal.all()[-1]
    assert rec["undoable"] is False and "not available" in rec["reason"]


def test_gpo_change_backs_up_and_undo_restores(admin):
    gid = "{31B2F340-016D-11D2-945F-00C04FB984F9}"
    url = "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D/registry"
    tok = admin.token("/gpo")
    admin.client.post(url, data={"csrf_token": tok, "key": "HKLM\\Software\\Policies\\X", "valueName": "A", "type": "DWord", "value": "0x10"})
    assert admin.state.backups and admin.state.registry[gid][0]["value"] == 16
    admin.post("/undo", {"back": "/"})
    assert any(c[1] == f"/api/v1/gpo/{gid}/restore" for c in admin.state.calls)


def test_password_reset_not_undoable_and_redacted(admin):
    dn = f"CN=Administrator,CN=Users,{BASE}"
    tok = admin.token("/")
    admin.client.post("/directory/user/password", data={"csrf_token": tok, "dn": dn, "password": "SuperSecret-123"})
    rec = admin.app.state.journal.all()[-1]
    assert rec["undoable"] is False and "cannot be undone" in rec["reason"]
    raw = open(os.path.join(admin.settings.data_dir, "history.git-work", "actions", rec["id"] + ".json")).read()
    assert "SuperSecret-123" not in raw and "[redacted]" in raw


def test_redaction_helper():
    v = redact({"password": "p", "key": "k1", "nested": [{"Token": "t"}], "valueName": "v", "path": "x"})
    assert v == {"password": "[redacted]", "key": "[redacted]", "nested": [{"Token": "[redacted]"}], "valueName": "v", "path": "x"}
    assert redact({"key": "HKLM\\Software\\X"})["key"] == "HKLM\\Software\\X"


def test_wifi_key_change_redacted(admin):
    admin.post("/wifi", {"id": "lib-wifi", "ssid": "Library", "auth": "WPA2PSK", "key": "a-new-secret-key"}, page="/wifi")
    rec = admin.app.state.journal.all()[-1]
    assert "a-new-secret-key" not in json.dumps(rec) and rec["undoable"] is False


def test_history_page_and_repo_size(admin):
    admin.post("/guests", {"expiryId": "1h"}, page="/guests")
    page = admin.client.get("/history").text
    assert "Create guest" in page and "KB" in page
