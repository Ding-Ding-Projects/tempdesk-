"""Key routing, auth and guest semantics through App.handle with FakeBackend,
plus one real HTTP round trip through server.make_handler."""

import datetime as dt
import http.client
import json
import os
import re
import threading

import pytest

from conftest import ADMIN_KEY, GUEST_KEY

ADMIN_ROUTES = [
    ("GET", "/settings"), ("PUT", "/settings"), ("GET", "/guests"), ("GET", "/gpo"), ("POST", "/gpo"),
    ("GET", "/ad/tree"), ("GET", "/audit"), ("GET", "/sambatool"), ("POST", "/sambatool/invoke"),
    ("GET", "/wifi"), ("GET", "/allowlist"), ("POST", "/auth/logout"), ("GET", "/security/catalog"),
]


def test_no_key_or_wrong_key(client):
    assert client.call("GET", "/health")[0] == 401
    assert client.call("GET", "/health", key="nope")[0] == 401
    assert client.call("GET", "/does/not/exist")[0] == 401  # no route disclosure without a key


def test_health(client):
    st, b = client.call("GET", "/health", key=GUEST_KEY)
    assert st == 200 and b["backend"] == "samba" and b["status"] == "ok"
    for c in ("guest", "samba-tool", "gpo-registry", "admx", "audit"):
        assert c in b["capabilities"]
    for c in ("cmdlets", "gpo-preferences", "wmifilters"):
        assert c not in b["capabilities"]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", b["time"])


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
def test_guest_key_never_reaches_admin_routes(client, method, path):
    client.login()  # valid bearer token in hand
    st, b = client.call(method, path, {}, key=GUEST_KEY)
    assert st == 403 and b["error"] == "forbidden"
    assert client.call("POST", "/auth/login", {"username": "Administrator", "password": "Passw0rd!"},
                       key=GUEST_KEY)[0] == 403


@pytest.mark.parametrize("method,path", ADMIN_ROUTES)
def test_admin_key_needs_bearer(client, method, path):
    st, b = client.call(method, path, {}, key=ADMIN_KEY)
    assert st == 401 and b["error"] == "unauthorized"
    st, _ = client.call(method, path, {}, key=ADMIN_KEY, token="garbage.token")
    assert st == 401


def test_login_logout_and_expiry(client, clock):
    b = client.login()
    assert b["user"]["sam"] == "Administrator" and b["expiresAt"].endswith("Z")
    assert client.call("GET", "/settings", key=ADMIN_KEY)[0] == 200
    clock.t += 8 * 3600
    assert client.call("GET", "/settings", key=ADMIN_KEY)[0] == 401
    client.login()
    assert client.call("POST", "/auth/logout", key=ADMIN_KEY)[0] == 204
    assert client.call("GET", "/settings", key=ADMIN_KEY)[0] == 401


def test_login_requires_admin_group(client, app):
    app.backend.users["carol"] = {"sam": "carol", "password": "Secret123!", "groups": set()}
    st, b = client.call("POST", "/auth/login", {"username": "carol", "password": "Secret123!"}, key=ADMIN_KEY)
    assert st == 401


def test_login_lockout(client, clock):
    for _ in range(5):
        assert client.call("POST", "/auth/login", {"username": "Administrator", "password": "x"},
                           key=ADMIN_KEY)[0] == 401
    st, b = client.call("POST", "/auth/login", {"username": "Administrator", "password": "Passw0rd!"},
                        key=ADMIN_KEY)
    assert st == 429 and b["error"] == "rate_limited"
    clock.t += 15 * 60 + 1
    client.login()


def test_public_settings(client):
    st, b = client.call("GET", "/public/settings", key=GUEST_KEY)
    assert st == 200 and b["usernamePrefix"] == "guest-" and any(c["minutes"] == 0 for c in b["expiryChoices"])
    assert set(b) == {"orgName", "welcomeText", "expiryChoices", "allowPermanent", "allowSelfDelete",
                      "usernamePrefix"}


def test_guest_create_status_delete(client, app):
    st, g = client.call("POST", "/guest/users", {"displayName": "Visitor", "expiryId": "4h"}, key=GUEST_KEY,
                        headers={"x-forwarded-for": "192.0.2.1"})
    assert st == 201
    assert re.fullmatch(r"guest-[abcdefghjkmnpqrstuvwxyz23456789]{6}", g["username"])
    assert g["upn"] == g["username"] + "@lab.example.org" and g["domain"] == "LAB"
    exp = dt.datetime.strptime(g["expiresAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc)
    assert abs((exp - dt.datetime.now(dt.timezone.utc)).total_seconds() - 4 * 3600) < 60
    rec = app.backend.guests[g["username"]]
    info = json.loads(rec["info"])
    assert info["createdBy"] == "guest-portal" and info["expiresAt"] == g["expiresAt"]
    assert rec["group"] == "TempDesk Guests"

    assert client.call("POST", f"/guest/users/{g['username']}/status", {"password": "wrong"},
                       key=GUEST_KEY)[0] == 401
    st, s = client.call("POST", f"/guest/users/{g['username']}/status", {"password": g["password"]}, key=GUEST_KEY)
    assert st == 200 and s["enabled"] and s["expiresAt"] == g["expiresAt"]
    # Non guests are never eligible, even with the right password
    assert client.call("POST", "/guest/users/Administrator/delete", {"password": "Passw0rd!"},
                       key=GUEST_KEY)[0] == 401
    assert client.call("POST", f"/guest/users/{g['username']}/delete", {"password": g["password"]},
                       key=GUEST_KEY)[0] == 204
    assert g["username"] not in app.backend.guests


def test_guest_permanent_and_unknown_expiry(client):
    st, g = client.call("POST", "/guest/users", {"expiryId": "perm"}, key=GUEST_KEY)
    assert st == 201 and g["expiresAt"] is None
    assert client.call("POST", "/guest/users", {"expiryId": "nope"}, key=GUEST_KEY)[0] == 400


def test_guest_rate_limit_per_ip_and_global_cap(client, app):
    s = app.settings.get()
    s["guestCreatePerHour"] = 2
    s["guestMaxActive"] = 3
    app.settings.put(s)
    h = {"x-forwarded-for": "198.51.100.7"}
    assert client.call("POST", "/guest/users", {"expiryId": "1h"}, key=GUEST_KEY, headers=h)[0] == 201
    assert client.call("POST", "/guest/users", {"expiryId": "1h"}, key=GUEST_KEY, headers=h)[0] == 201
    assert client.call("POST", "/guest/users", {"expiryId": "1h"}, key=GUEST_KEY, headers=h)[0] == 429
    h2 = {"x-forwarded-for": "198.51.100.8"}
    assert client.call("POST", "/guest/users", {"expiryId": "1h"}, key=GUEST_KEY, headers=h2)[0] == 201
    st, b = client.call("POST", "/guest/users", {"expiryId": "1h"}, key=GUEST_KEY, headers=h2)
    assert st == 429 and "maximum" in b["message"]


def test_admin_guest_routes_and_reaper(client, app):
    client.login()
    st, g = client.call("POST", "/guests", {"minutes": 5}, key=ADMIN_KEY)
    assert st == 201
    assert json.loads(app.backend.guests[g["username"]]["info"])["createdBy"] == "admin:Administrator"
    st, lst = client.call("GET", "/guests", key=ADMIN_KEY)
    assert [x["username"] for x in lst] == [g["username"]]
    st, e = client.call("POST", f"/guests/{g['username']}/extend", {"minutes": 0}, key=ADMIN_KEY)
    assert st == 200 and e["expiresAt"] is None
    app.backend.guests[g["username"]]["expires"] = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=1)
    assert app.reap_once() == [g["username"]]
    assert client.call("DELETE", f"/guests/{g['username']}", key=ADMIN_KEY)[0] == 404
    st, log = client.call("GET", "/audit?limit=50", key=ADMIN_KEY)
    events = [x["event"] for x in log]
    assert "guest_expired_deleted" in events and "login" in events and "admin_call" in events


def test_settings_validation(client):
    client.login()
    st, s = client.call("GET", "/settings", key=ADMIN_KEY)
    s["passwordLength"] = 4
    assert client.call("PUT", "/settings", s, key=ADMIN_KEY)[0] == 400
    s["passwordLength"] = 16
    st, s2 = client.call("PUT", "/settings", s, key=ADMIN_KEY)
    assert st == 200 and s2["passwordLength"] == 16


def test_sambatool_routes(client, app):
    client.login()
    st, cat = client.call("GET", "/sambatool", key=ADMIN_KEY)
    assert st == 200 and any(c["command"] == "user list" for c in cat)
    st, b = client.call("POST", "/sambatool/invoke", {"command": "user delete", "args": ["bob"]}, key=ADMIN_KEY)
    assert st == 400 and "confirm" in b["message"]
    st, b = client.call("POST", "/sambatool/invoke", {"command": "user delete", "args": ["bob"],
                                                       "confirm": "user delete"}, key=ADMIN_KEY)
    assert st == 200 and app.backend.invocations[-1] == ["samba-tool", "user", "delete", "bob"]
    assert client.call("POST", "/sambatool/invoke", {"command": "domain provision"}, key=ADMIN_KEY)[0] == 400


def test_unsupported_routes_are_not_found(client):
    client.login()
    for m, p in [("GET", "/cmdlets"), ("GET", "/gpo/wmifilters"),
                 ("GET", "/gpo/31b2f340-016d-11d2-945f-00c04fb984f9/preferences/registry")]:
        assert client.call(m, p, key=ADMIN_KEY)[0] == 404


def test_method_not_allowed(client):
    client.login()
    assert client.call("DELETE", "/settings", key=ADMIN_KEY)[0] == 405


def test_bad_json(client, app):
    from tempdesk_agent.app import Request
    r = app.handle(Request("POST", "/api/v1/guest/users", {}, {"x-tempdesk-key": GUEST_KEY}, b"{nope", "x"))
    assert r.status == 400


def test_real_http_roundtrip(app):
    from tempdesk_agent.server import serve
    httpd = serve(app, "127.0.0.1", 0, None, None)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    try:
        c = http.client.HTTPConnection("127.0.0.1", httpd.server_address[1], timeout=5)
        c.request("GET", "/api/v1/health", headers={"X-TempDesk-Key": GUEST_KEY})
        r = c.getresponse()
        assert r.status == 200 and json.loads(r.read())["backend"] == "samba"
        c.request("POST", "/api/v1/guest/users", body=json.dumps({"expiryId": "1h"}),
                  headers={"X-TempDesk-Key": GUEST_KEY, "Content-Type": "application/json"})
        r = c.getresponse()
        assert r.status == 201 and "password" in json.loads(r.read())
        c.request("GET", "/api/v1/settings", headers={"X-TempDesk-Key": GUEST_KEY})
        r = c.getresponse()
        assert r.status == 403
        r.read()
    finally:
        httpd.shutdown()
        httpd.server_close()
