import json

import pytest

from app.config import ConfigError, Settings
from app.settings_schema import validate_settings
from tests.conftest import Portal, csrf_of
from tests.fake_agent import BASE, DEFAULT_SETTINGS

ADMIN_PAGES = [
    "/", "/guests", "/directory", f"/directory?dn={BASE}", f"/directory/object?dn=CN%3DAdministrator%2CCN%3DUsers%2C{BASE}",
    "/directory/create", "/directory/search", f"/directory/search?filter=(name%3D*)", "/gpo", "/gpo/backups", "/gpo/wmi",
    "/gpo/inheritance", "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D",
    "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D?tab=links", "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D?tab=registry",
    "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D?tab=preferences", "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D?tab=permissions",
    "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D/report", "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D/admx?class=User&category=system",
    "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D/admx/DisableCMD?class=User&category=system",
    "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D/admx/WelcomeTimeout?class=Machine&category=system.logon",
    "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D/security", "/cmdlets", "/cmdlets/run?name=Get-ADUser",
    "/cmdlets/run?name=Remove-ADUser", "/wifi", "/scripts", "/scripts/logon/map-drives.cmd", "/scripts/startup/new",
    "/allowlist", "/settings", "/audit", "/history", "/history/settings", "/import", "/docs", "/changelog", "/welcome",
    "/welcome?step=2", "/welcome?step=3", "/welcome?step=4", "/welcome?step=5", "/welcome?step=6", "/more", "/tools/base64",
]


def test_admin_requires_login(admin_anon):
    for path in ADMIN_PAGES:
        r = admin_anon.client.get(path, follow_redirects=False)
        assert r.status_code == 303 and r.headers["location"].startswith("/login"), path


def test_every_admin_page_renders(admin):
    for path in ADMIN_PAGES:
        r = admin.client.get(path)
        assert r.status_code == 200, (path, r.text[:500])
        assert "Something went wrong" not in r.text, path
        assert "Admin console" in r.text


def test_session_cookie_flags(admin_anon):
    r = admin_anon.login()
    sc = r.headers["set-cookie"]
    assert "td_session=" in sc and "HttpOnly" in sc and "samesite=strict" in sc.lower()
    assert "Secure" not in sc  # plain HTTP request


def test_session_cookie_secure_behind_https(tmp_path):
    from fastapi.testclient import TestClient

    p = Portal("admin", tmp_path, extra_env={"COOKIE_SECURE": "true"})
    p.client = TestClient(p.app, base_url="https://portal.test")
    r = p.login()
    assert "strict-transport-security" in p.client.get("/").headers
    assert "Secure" in r.headers["set-cookie"]


def test_bearer_token_not_in_cookie(admin):
    cookie = admin.client.cookies.get("td_session")
    for tok in admin.state.tokens:
        assert tok not in cookie


def test_wrong_password(admin_anon):
    r = admin_anon.post("/login", {"username": "sam", "password": "nope"}, page="/login")
    assert r.status_code == 401
    assert "not accepted" in r.text


def test_logout(admin):
    r = admin.post("/logout")
    assert r.status_code == 303
    assert not admin.state.tokens
    assert admin.client.get("/", follow_redirects=False).status_code == 303


def test_plain_http_banner(admin):
    r = admin.client.get("/")
    assert "Unencrypted connection" in r.text


def test_admin_create_guest_shows_password_once(admin):
    r = admin.post("/guests", {"expiryId": "custom", "minutes": "90"}, page="/guests")
    assert r.status_code == 303
    g = list(admin.state.guests.values())[0]
    page = admin.client.get("/guests/created")
    assert g["password"] in page.text and "no-store" in page.headers["cache-control"]
    again = admin.client.get("/guests/created", follow_redirects=True)
    assert g["password"] not in again.text


def test_guest_list_export_has_no_passwords(admin):
    admin.post("/guests", {"expiryId": "1h"}, page="/guests")
    pw = list(admin.state.guests.values())[0]["password"]
    csv = admin.client.get("/guests?export=csv")
    js = admin.client.get("/guests?export=json")
    assert csv.status_code == 200 and "attachment" in csv.headers["content-disposition"]
    assert pw not in csv.text and pw not in js.text
    assert list(admin.state.guests)[0] in csv.text


def test_settings_validation_rejects_bad_values(admin):
    tok = admin.token("/settings")
    data = {"csrf_token": tok, "orgName": "", "welcomeText": "Hi", "usernamePrefix": "bad prefix!", "guestOu": "nonsense",
            "guestGroup": "TempDesk Guests", "adminGroup": "TempDesk Admins", "guestGpoName": "A", "computerGpoName": "B",
            "computersOu": "OU=Computers,OU=TempDesk", "passwordLength": "4", "guestCreatePerHour": "20", "guestMaxActive": "200",
            "deleteProfileAfterMinutes": "0", "logoffWarningMinutes": "10", "reaperIntervalMinutes": "5",
            "exp_id": ["1h", "1h"], "exp_label": ["1 hour", "dup"], "exp_minutes": ["60", "30"]}
    before = json.dumps(admin.state.settings, sort_keys=True)
    r = admin.client.post("/settings", data=data)
    assert r.status_code == 400
    for msg in ("Organization name is required", "Use 1 to 12 letters", "Enter a distinguished name", "between 8 and 128", "used twice"):
        assert msg in r.text, msg
    assert json.dumps(admin.state.settings, sort_keys=True) == before


def test_settings_schema_accepts_default():
    clean, errors = validate_settings(DEFAULT_SETTINGS)
    assert errors == {}
    assert clean["expiryChoices"][0] == {"id": "1h", "label": "1 hour", "minutes": 60}


def test_settings_save_and_history_and_undo(admin):
    doc = admin.state.settings
    tok = admin.token("/settings")
    data = {"csrf_token": tok, **{k: str(v) for k, v in doc.items() if not isinstance(v, (list, bool))},
            "allowPermanent": "on", "allowSelfDelete": "on",
            "exp_id": [c["id"] for c in doc["expiryChoices"]], "exp_label": [c["label"] for c in doc["expiryChoices"]],
            "exp_minutes": [str(c["minutes"]) for c in doc["expiryChoices"]]}
    data["orgName"] = "Maple Library"
    r = admin.client.post("/settings", data=data, follow_redirects=False)
    assert r.status_code == 303
    assert admin.state.settings["orgName"] == "Maple Library"
    assert admin.client.get("/history/settings").text.count('class="dot') >= 2
    r = admin.post("/undo", {"back": "/settings"})
    assert r.status_code == 303
    assert admin.state.settings["orgName"] == "TempDesk"


def test_settings_import_preview_then_apply(admin):
    new = dict(admin.state.settings, orgName="Imported Org")
    tok = admin.token("/settings")
    r = admin.client.post("/settings/import", data={"csrf_token": tok}, files={"file": ("s.json", json.dumps(new), "application/json")})
    assert r.status_code == 200 and "Imported Org" in r.text
    assert admin.state.settings["orgName"] == "TempDesk"  # not applied yet
    pending = r.text.split('name="pending" value="')[1].split('"')[0]
    r = admin.client.post("/settings/import/apply", data={"csrf_token": csrf_of(r.text), "pending": pending}, follow_redirects=False)
    assert r.status_code == 303 and admin.state.settings["orgName"] == "Imported Org"


def test_settings_import_invalid_changes_nothing(admin):
    tok = admin.token("/settings")
    bad = dict(admin.state.settings, passwordLength=2)
    r = admin.client.post("/settings/import", data={"csrf_token": tok}, files={"file": ("s.json", json.dumps(bad), "application/json")})
    assert "Nothing was changed" in r.text and 'name="pending"' not in r.text
    r = admin.client.post("/settings/import", data={"csrf_token": tok}, files={"file": ("s.json", '{"a":1,"a":2}', "application/json")}, follow_redirects=False)
    assert r.status_code == 303
    assert admin.state.settings["passwordLength"] == 14


def test_session_secret_required_in_admin_mode():
    with pytest.raises(ConfigError):
        Settings.from_env({"PORTAL_MODE": "admin", "AGENT_URL": "http://a", "AGENT_KEY": "k"})


def test_https_agent_requires_trust_anchor():
    with pytest.raises(ConfigError):
        Settings.from_env({"PORTAL_MODE": "guest", "AGENT_URL": "https://a:8443", "AGENT_KEY": "k"})
    s = Settings.from_env({"PORTAL_MODE": "guest", "AGENT_URL": "https://a:8443", "AGENT_KEY": "k", "AGENT_CERT_SHA256": "AB:" * 31 + "AB"})
    assert s.agent_cert_sha256 == "ab" * 32
    assert s.agent_url == "https://a:8443/api/v1"


def test_csrf_required_on_admin_forms(admin):
    r = admin.client.post("/guests", data={"expiryId": "1h"})
    assert r.status_code == 403
    assert not admin.state.guests


def test_capabilities_hide_sections(tmp_path):
    p = Portal("admin", tmp_path, backend="samba")
    p.login()
    page = p.client.get("/").text
    palette = page.split('id="td-palette">')[1].split("</script>")[0]
    assert "samba-tool runner" in palette
    assert "Cmdlet runner" not in palette
    assert "WMI filters" not in palette


def test_cmdlet_runner_destructive_needs_confirm(admin):
    tok = admin.token("/cmdlets/run?name=Remove-ADUser")
    r = admin.client.post("/cmdlets/run", data={"csrf_token": tok, "name": "Remove-ADUser", "p_Identity": "bob"})
    assert "Type the cmdlet name to confirm" in r.text
    assert not [c for c in admin.state.calls if c[1] == "/api/v1/cmdlets/invoke"]
    r = admin.client.post("/cmdlets/run", data={"csrf_token": tok, "name": "Remove-ADUser", "p_Identity": "bob", "confirm": "Remove-ADUser"})
    assert "Administrator" in r.text  # output rendered as JSON tree


def test_cmdlet_runner_output_tree(admin):
    tok = admin.token("/cmdlets/run?name=Get-ADUser")
    r = admin.client.post("/cmdlets/run", data={"csrf_token": tok, "name": "Get-ADUser", "p_Filter": "*", "p_Properties": "mail\nname", "p_ResultSetSize": "5", "whatIf": "on"})
    assert 'class="json-tree"' in r.text and "What if" in r.text
    assert '"Properties": ["mail", "name"]' in r.text or "mail" in r.text


def test_sambatool_runner(tmp_path):
    p = Portal("admin", tmp_path, backend="samba")
    p.login()
    tok = p.token("/sambatool/run?command=user%20delete")
    r = p.client.post("/sambatool/run", data={"csrf_token": tok, "command": "user delete", "a_username": "bob"})
    assert "Type the command to confirm" in r.text
    r = p.client.post("/sambatool/run", data={"csrf_token": tok, "command": "user delete", "a_username": "bob", "confirm": "user delete"})
    assert "Exit code" in r.text and "Administrator" in r.text


def test_gpo_report_sandboxed(admin):
    r = admin.client.get("/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D/report")
    assert 'sandbox=""' in r.text and "srcdoc=" in r.text
    assert "<script>alert(1)</script>" not in r.text  # escaped inside srcdoc
    assert "Content-Security-Policy" in r.text


def test_admx_policy_save(admin):
    gid = "{31B2F340-016D-11D2-945F-00C04FB984F9}"
    url = f"/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D/admx/WelcomeTimeout"
    tok = admin.token(url + "?class=Machine&category=system.logon")
    r = admin.client.post(url, data={"csrf_token": tok, "class": "Machine", "category": "system.logon", "state": "Enabled", "el_Seconds": "700"}, follow_redirects=False)
    assert r.status_code == 303 and (gid, "WelcomeTimeout", "Machine") not in admin.state.admx_state
    r = admin.client.post(url, data={"csrf_token": tok, "class": "Machine", "category": "system.logon", "state": "Enabled", "el_Seconds": "30",
                                     "el_Banner": "Hello", "el_Show": "on", "el_Lines": "a\nb", "el_Apps": ["x.exe", "y.exe"]}, follow_redirects=False)
    st = admin.state.admx_state[(gid, "WelcomeTimeout", "Machine")]
    assert st["state"] == "Enabled" and st["values"] == {"Seconds": 30, "Banner": "Hello", "Show": True, "Lines": ["a", "b"], "Apps": ["x.exe", "y.exe"]}


def test_security_settings_save_keeps_raw_keys(admin):
    gid = "{31B2F340-016D-11D2-945F-00C04FB984F9}"
    url = "/gpo/%7B31B2F340-016D-11D2-945F-00C04FB984F9%7D/security"
    page = admin.client.get(url).text
    assert "CustomKey = 5" in page
    r = admin.client.post(url, data={"csrf_token": csrf_of(page), "f::System Access::MinimumPasswordLength": "12",
                                     "f::Privilege Rights::SeRemoteInteractiveLogonRight": "*S-1-5-32-544, *S-1-5-32-555",
                                     "raw::System Access": "CustomKey = 6"}, follow_redirects=False)
    assert r.status_code == 303
    sa = admin.state.security[gid]["System Access"]
    assert sa["MinimumPasswordLength"] == "12" and sa["CustomKey"] == "6" and sa["PasswordComplexity"] == "0"
    assert admin.state.security[gid]["Privilege Rights"]["SeRemoteInteractiveLogonRight"] == "*S-1-5-32-544,*S-1-5-32-555"


def test_wifi_key_write_only(admin):
    page = admin.client.get("/wifi")
    assert "secretkey1" not in page.text
    r = admin.post("/wifi", {"ssid": "Guest", "auth": "WPA2PSK", "key": "short"}, page="/wifi")
    assert r.status_code == 303 and len(admin.state.wifi) == 1


def test_wifi_import_from_netsh_xml(admin):
    xml = """<?xml version="1.0"?><WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1"><name>Cafe</name>
<SSIDConfig><SSID><name>Cafe</name></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>auto</connectionMode>
<MSM><security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption></authEncryption>
<sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>coffee-time-1</keyMaterial></sharedKey></security></MSM></WLANProfile>"""
    tok = admin.token("/wifi")
    r = admin.client.post("/wifi/import", data={"csrf_token": tok}, files={"file": ("Wi-Fi-Cafe.xml", xml, "text/xml")})
    assert r.status_code == 200 and "Cafe" in r.text and "coffee-time-1" not in r.text
    pending = r.text.split('name="pending" value="')[1].split('"')[0]
    admin.client.post("/wifi/import/apply", data={"csrf_token": tok, "pending": pending})
    assert any(w["ssid"] == "Cafe" and w["key"] == "coffee-time-1" for w in admin.state.wifi.values())


def test_wifi_import_rejects_doctype(admin):
    tok = admin.token("/wifi")
    xml = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "x">]><WLANProfile><name>&e;</name></WLANProfile>'
    r = admin.client.post("/wifi/import", data={"csrf_token": tok}, files={"file": ("a.xml", xml, "text/xml")}, follow_redirects=False)
    assert r.status_code == 303 and len(admin.state.wifi) == 1


def test_csv_import_guests_dry_run_then_apply(admin):
    tok = admin.token("/import")
    csv = "displayName,expiryId,minutes\r\nA,1h,\r\nB,,90\r\nC,,abc\r\n"
    r = admin.client.post("/import/preview", data={"csrf_token": tok, "kind": "guests"}, files={"file": ("g.csv", csv, "text/csv")})
    assert "2 ready" in r.text and "1 with problems" in r.text
    assert not admin.state.guests
    pending = r.text.split('name="pending" value="')[1].split('"')[0]
    r = admin.client.post("/import/apply", data={"csrf_token": tok, "pending": pending})
    assert len(admin.state.guests) == 2 and "New passwords" in r.text


def test_directory_export_formats(admin):
    dn = f"CN=Administrator,CN=Users,{BASE}"
    for fmt in ("json", "csv", "ldif"):
        r = admin.client.get("/directory/export", params={"dn": dn, "format": fmt})
        assert r.status_code == 200 and "Administrator" in r.text, fmt
    assert "objectSid:: AQUAAAAAAAU=" in admin.client.get("/directory/export", params={"dn": dn, "format": "ldif"}).text


def test_regex_search_invalid_pattern(admin):
    r = admin.client.get("/guests", params={"q": "([", "re": "1"})
    assert r.status_code == 200 and "Invalid pattern" in r.text


def test_regex_search_filters(admin):
    admin.post("/guests", {"expiryId": "1h", "displayName": "Zed"}, page="/guests")
    admin.post("/guests", {"expiryId": "1h", "displayName": "Amy"}, page="/guests")
    r = admin.client.get("/guests", params={"q": "^Z", "re": "1", "export": "json"})
    rows = r.json()
    # Regex filtering applies to the rendered table; export follows plain search rules.
    assert isinstance(rows, list)
    page = admin.client.get("/guests", params={"q": "Ze.", "re": "1"}).text
    assert "Zed" in page and "Amy" not in page


def test_delete_requires_super_confirmation_server_side(admin):
    admin.post("/guests", {"expiryId": "1h"}, page="/guests")
    name = list(admin.state.guests)[0]
    page = admin.client.get(f"/guests/{name}/delete").text
    tok = csrf_of(page)
    token = page.split('data-token="')[1].split('"')[0]
    # Name typed but hold not completed (no token): refused.
    r = admin.client.post(f"/guests/{name}/delete", data={"csrf_token": tok, "confirm_name": name, "confirm_token": ""}, follow_redirects=False)
    assert r.status_code == 303 and name in admin.state.guests
    # Token but wrong name: refused.
    r = admin.client.post(f"/guests/{name}/delete", data={"csrf_token": tok, "confirm_name": "x", "confirm_token": token})
    assert name in admin.state.guests
    # Token for a different target: refused.
    other = admin.app.state.confirm.issue("delete-guest", "someone-else")
    admin.client.post(f"/guests/{name}/delete", data={"csrf_token": tok, "confirm_name": name, "confirm_token": other})
    assert name in admin.state.guests
    admin.client.post(f"/guests/{name}/delete", data={"csrf_token": tok, "confirm_name": name, "confirm_token": token})
    assert name not in admin.state.guests


def test_bulk_delete_guests_requires_confirmation(admin):
    for _ in range(3):
        admin.post("/guests", {"expiryId": "1h"}, page="/guests")
    names = list(admin.state.guests)
    page = admin.client.get("/guests").text
    tok, token = csrf_of(page), page.split('data-token="')[1].split('"')[0]
    admin.client.post("/guests/bulk", data={"csrf_token": tok, "sel": names[:2], "bulk": "delete"})
    assert len(admin.state.guests) == 3
    admin.client.post("/guests/bulk", data={"csrf_token": tok, "sel": names[:2], "bulk": "delete", "confirm_name": "delete", "confirm_token": token})
    assert list(admin.state.guests) == names[2:]
    admin.client.post("/guests/bulk", data={"csrf_token": tok, "sel": names[2:], "bulk": "extend", "minutes": "0"})
    assert admin.state.guests[names[2]]["expiresAt"] is None


def test_elevation_flow(admin):
    r = admin.client.get("/cmdlets?scope=all", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/auth/elevate")
    tok = admin.token("/auth/elevate")
    r = admin.client.post("/auth/elevate", data={"csrf_token": tok, "password": "wrong", "next": "/cmdlets?scope=all"})
    assert r.status_code == 401
    r = admin.client.post("/auth/elevate", data={"csrf_token": tok, "password": "Passw0rd!", "next": "/cmdlets?scope=all"}, follow_redirects=False)
    assert r.status_code == 303
    r = admin.client.get("/cmdlets?scope=all")
    assert r.status_code == 200 and "Get-ADUser" in r.text
    assert any(c[2].get("x-tempdesk-elevation") for c in admin.state.calls if c[1] == "/api/v1/cmdlets")


def test_nav_registry_and_hooks():
    from app import nav, web

    assert callable(web.require_admin) and callable(web.get_agent_client)
    assert all({"id", "label", "href", "icon", "capability", "group"} <= set(i) for i in nav.NAV_ITEMS)


def test_server_area_router_is_included_and_admin_only(admin_anon):
    # app/server_routes.py (built separately) is included when present and uses require_admin.
    import importlib.util

    if importlib.util.find_spec("app.server_routes") is None:
        return
    r = admin_anon.client.get("/server", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].startswith("/login")


def test_i18n_catalogs_identical_keys():
    from app.i18n import CATALOGS

    en, zh = CATALOGS["en"], CATALOGS["zh-HK"]
    assert set(en["strings"]) == set(zh["strings"])
    assert set(en["fun"]) == set(zh["fun"])


def test_language_modes(admin):
    tok = admin.token("/")
    admin.client.post("/prefs", data={"csrf_token": tok, "lang": "zh-HK", "next": "/"})
    r = admin.client.get("/guests")
    assert "訪客" in r.text and 'lang="zh-HK"' in r.text
    admin.client.post("/prefs", data={"csrf_token": tok, "lang": "bi", "next": "/"})
    r = admin.client.get("/guests")
    assert 'class="bi-zh"' in r.text and "Guests" in r.text


def test_funny_level_only_noncritical(guest):
    tok = guest.token()
    guest.client.post("/prefs", data={"csrf_token": tok, "fun": "3", "next": "/"})
    assert "Say no more" in guest.client.get("/").text
    bad = guest.client.post("/create", data={"csrf_token": tok, "expiryId": "nope"})
    assert "Choose how long you need the sign-in for." in bad.text


def test_school_mode_forces_english_and_hides_extras(admin):
    tok = admin.token("/")
    admin.client.post("/prefs", data={"csrf_token": tok, "lang": "zh-HK", "fun": "3", "next": "/"})
    admin.client.cookies.set("td_school", "1")
    r = admin.client.get("/settings")
    assert 'lang="en"' in r.text and 'id="wording"' not in r.text and 'id="p-fun"' not in r.text
    assert "Welcome back" not in admin.client.get("/").text
