"""Control room console: pages, JSON endpoints behind the command bar, the
directory studio and the Group Policy editor."""

from urllib.parse import quote

from tests.conftest import csrf_of
from tests.fake_agent import BASE

GID = "{31B2F340-016D-11D2-945F-00C04FB984F9}"
ADMIN_DN = f"CN=Administrator,CN=Users,{BASE}"


def test_console_pages_render(admin):
    for path in ("/", "/guests", "/directory", "/directory?view=list", f"/gpo/{quote(GID, safe='')}/edit", "/find?q=admin", "/server"):
        r = admin.client.get(path)
        assert r.status_code == 200, path
        assert "Something went wrong" not in r.text, path
        assert 'data-cmd-input' in r.text and 'aria-keyshortcuts="Control+Shift+F"' in r.text, path


def test_plain_http_is_a_status_pill(admin):
    page = admin.client.get("/").text
    assert "data-http-pill" in page and "Unencrypted connection" in page
    assert 'class="banner alert warn"' not in page


def test_pulse_and_find(admin):
    admin.post("/guests", {"expiryId": "1h", "displayName": "Zed"}, page="/guests")
    p = admin.client.get("/api/console/pulse").json()
    assert p["health"]["status"] == "ok" and len(p["guests"]) == 1
    assert p["undo"] and p["undo"][0]["undoable"]
    f = admin.client.get("/api/console/find", params={"q": "Zed"}).json()
    assert f["guests"] and f["guests"][0]["displayName"] == "Zed"
    f = admin.client.get("/api/console/find", params={"q": "Default Domain"}).json()
    assert f["gpos"] and f["gpos"][0]["id"] == GID


def test_command_extend_returns_json(admin):
    admin.post("/guests", {"expiryId": "1h"}, page="/guests")
    name = list(admin.state.guests)[0]
    tok = admin.token("/guests")
    r = admin.client.post(f"/guests/{name}/extend", data={"csrf_token": tok, "minutes": "120"}, headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_resolve_requires_csrf(admin):
    r = admin.client.post("/api/console/resolve", json={"name": "Administrator"})
    assert r.status_code == 403
    tok = admin.token("/")
    r = admin.client.post("/api/console/resolve", json={"name": "Administrator"}, headers={"X-CSRF-Token": tok})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_directory_studio_object_and_patch_with_undo(admin):
    o = admin.client.get("/api/dir/object", params={"dn": ADMIN_DN}).json()
    assert o["decoded"]["objectSid"]["decoded"] .startswith("S-1-5")
    assert o["decoded"]["userAccountControl"]["kind"] == "uac"
    assert any(p["id"] == GID for p in o["policies"])
    tok = admin.token("/directory")
    r = admin.client.post("/api/dir/patch", json={"dn": ADMIN_DN, "set": {"description": ["hello"]}}, headers={"X-CSRF-Token": tok})
    assert r.status_code == 200 and r.json()["undoId"]
    assert admin.state.objects[ADMIN_DN]["attributes"]["description"] == ["hello"]
    r = admin.client.post("/undo", data={"csrf_token": tok, "id": r.json()["undoId"]}, headers={"X-Requested-With": "fetch"})
    assert r.json()["ok"] is True
    assert "description" not in admin.state.objects[ADMIN_DN]["attributes"]
    # without the CSRF header the write is refused
    assert admin.client.post("/api/dir/patch", json={"dn": ADMIN_DN, "set": {"description": ["x"]}}).status_code == 403


def test_directory_problems_and_history(admin):
    r = admin.client.get("/api/dir/problems").json()
    assert r["ok"] and "disabled-admins" in r["checked"]
    assert isinstance(admin.client.get("/api/dir/history").json(), list)


def test_gpo_editor_tree_policies_and_node(admin):
    g = quote(GID, safe="")
    tree = admin.client.get(f"/api/gpo/{g}/tree", params={"scope": "User"}).json()
    names = [n["name"] for n in tree["tree"]]
    assert "Policies" in names
    pol = admin.client.get(f"/api/gpo/{g}/policies", params={"scope": "User", "category": "system"}).json()
    assert [p["id"] for p in pol["policies"]] == ["DisableCMD"] and pol["policies"][0]["state"] == "NotConfigured"
    tok = admin.token("/gpo")
    r = admin.client.post(f"/api/gpo/{g}/node", headers={"X-CSRF-Token": tok}, json={
        "node": "registry", "method": "PUT", "json": {"key": "HKLM\\Software\\Policies\\X", "valueName": "A", "type": "DWord", "value": 1}})
    assert r.status_code == 200 and r.json()["ok"]
    items = admin.client.get(f"/api/gpo/{g}/node", params={"node": "registry", "key": "HKLM\\Software\\Policies"}).json()["items"]
    assert any(i["valueName"] == "A" for i in items)
    bad = admin.client.post(f"/api/gpo/{g}/node", headers={"X-CSRF-Token": tok}, json={"node": "../../ad/object", "method": "DELETE"})
    assert bad.status_code == 400


def test_admx_save_via_fetch(admin):
    url = f"/gpo/{quote(GID, safe='')}/admx/DisableCMD"
    tok = admin.token("/gpo")
    r = admin.client.post(url, data={"csrf_token": tok, "class": "User", "category": "system", "state": "Enabled", "el_DisableCMDScripts": "2"},
                          headers={"X-Requested-With": "fetch"})
    assert r.status_code == 200 and r.json()["ok"]
    st = admin.client.get(f"/api/gpo/{quote(GID, safe='')}/policy/DisableCMD", params={"scope": "User"}).json()
    assert st["state"] == "Enabled"


def test_console_strings_are_in_both_catalogs():
    import json
    from pathlib import Path

    from app.i18n import CATALOGS

    keys = json.loads((Path(__file__).parent.parent / "app" / "static" / "js" / "console-strings.json").read_text(encoding="utf-8"))
    assert keys and all(k in CATALOGS["en"]["strings"] and k in CATALOGS["zh-HK"]["strings"] for k in keys)
    _ = csrf_of
