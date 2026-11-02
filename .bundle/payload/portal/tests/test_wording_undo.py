"""Personal wording and the undo journal. Fixtures use neutral words only."""

import json
import logging
import os
import stat
import subprocess

import pytest

from app.undo import redact
from app.vocab import WordingError, build_translator, validate
from tests.conftest import Portal, csrf_of
from tests.fake_agent import BASE

GOOD = {"schemaVersion": 1, "entries": {"guest": "visitor", "Settings": "Preferences", "private vocabulary": "Fresh words loaded"}}


def upload(p: Portal, payload: bytes):
    tok = p.token("/settings")
    return p.client.post("/settings/wording", data={"csrf_token": tok}, files={"file": ("w.json", payload, "application/json")}, follow_redirects=False)


def wording_file(p: Portal):
    return os.path.join(p.settings.data_dir, "personal-wording.json")


def test_translator_rules():
    tr = build_translator({"computer": "machine", "sign-in": "login", "sign": "mark"})
    assert tr("Need a computer?") == "Need a machine?"
    assert tr("Computer ready") == "Machine ready"
    assert tr("computers") == "computers"  # whole words only
    assert tr("Create my sign-in") == "Create my login"  # longest key first
    single = build_translator({"a": "b", "b": "c"})
    assert single("a b") == "b c"  # single pass, no re-replacement


def test_valid_apply_and_headline(admin):
    r = admin.client.post("/api/wording", content=json.dumps(GOOD).encode(),
                          headers={"X-CSRF-Token": admin.token("/settings"), "Content-Type": "application/json"})
    assert r.json() == {"ok": True, "count": 3, "headline": "Fresh words loaded"}
    page = admin.client.get("/guests").text
    assert "Create a visitor account" in page
    assert stat.S_IMODE(os.stat(wording_file(admin)).st_mode) == 0o600


def test_default_headline(admin):
    r = admin.client.post("/api/wording", content=json.dumps({"schemaVersion": 1, "entries": {"computer": "machine"}}).encode(),
                          headers={"X-CSRF-Token": admin.token("/settings")})
    assert r.json()["headline"] == "Personal wording applied"


def test_data_values_never_replaced(admin):
    upload(admin, json.dumps({"schemaVersion": 1, "entries": {"Administrator": "Boss", "guest": "visitor"}}).encode())
    page = admin.client.get(f"/directory/object?dn=CN%3DAdministrator%2CCN%3DUsers%2C{BASE}").text
    assert "CN=Administrator" in page  # DN untouched
    admin.post("/guests", {"expiryId": "1h"}, page="/guests")
    name = list(admin.state.guests)[0]
    assert name.startswith("guest-") and name in admin.client.get("/guests").text


INVALID = [
    (b"x" * (256 * 1024 + 1), "larger than 256 KiB"),
    (json.dumps({"schemaVersion": 1, "entries": {"a": "b"}, "x": [[[[[[[[[1]]]]]]]]]}).encode(), "nested more than 8"),
    (b'{"schemaVersion":1,"entries":{"a":"b","a":"c"}}', "duplicate key"),
    (json.dumps({"schemaVersion": 1, "entries": {"__proto__": "b"}}).encode(), "reserved name"),
    (json.dumps({"schemaVersion": 1, "entries": {"": "b"}}).encode(), "1 to 160"),
    (json.dumps({"schemaVersion": 1, "entries": {"k" * 161: "b"}}).encode(), "1 to 160"),
    (json.dumps({"schemaVersion": 1, "entries": {"a": "b\u0007"}}).encode(), "control characters"),
    (json.dumps({"schemaVersion": 1, "entries": {"a": "b" * 1001}}).encode(), "longer than 1000"),
    (json.dumps({"schemaVersion": 2, "entries": {"a": "b"}}).encode(), "schemaVersion must be"),
    (json.dumps({"schemaVersion": 1, "entries": {"a": "b"}, "extra": 1}).encode(), "Only the properties"),
    (b"not json", "not valid JSON"),
    (b"\xff\xfe\x00", "not valid UTF-8"),
]


@pytest.mark.parametrize("payload,reason", INVALID)
def test_invalid_changes_nothing(admin, payload, reason):
    upload(admin, json.dumps({"schemaVersion": 1, "entries": {"computer": "machine"}}).encode())
    before = open(wording_file(admin), "rb").read()
    with pytest.raises(WordingError) as exc:
        validate(payload)
    assert reason in str(exc.value)
    r = admin.client.post("/api/wording", content=payload, headers={"X-CSRF-Token": admin.token("/settings")})
    assert r.status_code == 400 and r.json()["ok"] is False
    assert open(wording_file(admin), "rb").read() == before
    assert admin.app.state.vocab.count == 1


def test_error_messages_never_echo_content():
    secret = "zebra-quokka"
    with pytest.raises(WordingError) as exc:
        validate(json.dumps({"schemaVersion": 1, "entries": {secret: "x" * 2000}}).encode())
    assert secret not in str(exc.value)


def test_unauthenticated_pages_never_show_replacements(tmp_path):
    p = Portal("admin", tmp_path)
    p.login()
    upload(p, json.dumps({"schemaVersion": 1, "entries": {"Sign in": "Enter", "Admin console": "Control room", "Username": "Handle"}}).encode())
    assert "Control room" in p.client.get("/").text
    p.post("/logout")
    login = p.client.get("/login").text
    assert "Control room" not in login and "Handle" not in login and "Admin console" in login
    err = p.client.get("/does-not-exist").text
    assert "Control room" not in err
    g = Portal("guest", tmp_path)  # same data dir, guest mode
    assert "Handle" not in g.client.get("/check").text


def test_school_mode_hides_vocabulary(admin):
    upload(admin, json.dumps({"schemaVersion": 1, "entries": {"Guests": "Visitors"}}).encode())
    assert "Visitors" in admin.client.get("/guests").text
    admin.client.cookies.set("td_school", "1")
    page = admin.client.get("/guests").text
    assert "Visitors" not in page
    assert "Personal wording" not in admin.client.get("/").text.split('id="td-palette">')[1].split("</script>")[0]


def test_clear_restores(admin):
    upload(admin, json.dumps({"schemaVersion": 1, "entries": {"Guests": "Visitors"}}).encode())
    assert "Visitors" in admin.client.get("/guests").text
    r = admin.post("/settings/wording/clear", page="/settings")
    assert r.status_code == 303
    assert not os.path.exists(wording_file(admin))
    assert "Visitors" not in admin.client.get("/guests").text


def test_palette_and_settings_index_wording_controls(admin):
    page = admin.client.get("/settings").text
    palette = page.split('id="td-palette">')[1].split("</script>")[0]
    for label in ("Upload personal wording file", "Personal wording status", "Replace personal wording file", "Clear personal wording"):
        assert label in palette
    assert 'id="wording"' in page and "No file loaded" in page


def test_wording_never_logged(admin, caplog):
    caplog.set_level(logging.DEBUG)
    upload(admin, json.dumps({"schemaVersion": 1, "entries": {"computer": "machine-xyzzy"}}).encode())
    upload(admin, b'{"schemaVersion":1,"entries":{"computer":"plover","computer":"x"}}')
    admin.client.get("/settings")
    assert "machine-xyzzy" not in caplog.text and "plover" not in caplog.text


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
