import re

from tests.conftest import Portal, csrf_of


def test_home_renders_choices_and_hides_permanent_when_not_allowed(guest):
    r = guest.client.get("/")
    assert r.status_code == 200
    assert "Create my sign-in" in r.text
    assert "Until I delete it" in r.text
    guest.state.settings["allowPermanent"] = False
    r = guest.client.get("/")
    assert "Until I delete it" not in r.text


def test_create_show_once_and_no_store(guest):
    r = guest.post("/create", {"displayName": "Alex", "expiryId": "4h"})
    assert r.status_code == 303 and r.headers["location"] == "/created"
    # The redirect target never carries credentials.
    assert "password" not in r.headers["location"].lower()
    created = list(guest.state.guests.values())[0]
    page = guest.client.get("/created")
    assert page.status_code == 200
    assert "no-store" in page.headers["cache-control"]
    assert created["password"] in page.text
    assert created["username"] in page.text
    assert "CORP\\" + created["username"] in page.text
    # Second view: gone.
    again = guest.client.get("/created")
    assert again.status_code == 410
    assert created["password"] not in again.text


def test_client_ip_forwarded_to_agent(guest):
    guest.post("/create", {"expiryId": "1h"})
    calls = [c for c in guest.state.calls if c[1] == "/api/v1/guest/users"]
    assert calls[-1][2]["x-forwarded-for"] == "192.0.2.10"


def test_untrusted_forwarded_for_is_ignored(guest):
    tok = guest.token()
    guest.client.post("/create", data={"csrf_token": tok, "expiryId": "1h"}, headers={"X-Forwarded-For": "203.0.113.9"})
    calls = [c for c in guest.state.calls if c[1] == "/api/v1/guest/users"]
    assert calls[-1][2]["x-forwarded-for"] == "192.0.2.10"


def test_trusted_proxy_forwarded_for_is_used(tmp_path):
    p = Portal("guest", tmp_path, extra_env={"TRUSTED_PROXY": "192.0.2.0/24"})
    tok = p.token()
    p.client.post("/create", data={"csrf_token": tok, "expiryId": "1h"}, headers={"X-Forwarded-For": "203.0.113.9"})
    calls = [c for c in p.state.calls if c[1] == "/api/v1/guest/users"]
    assert calls[-1][2]["x-forwarded-for"] == "203.0.113.9"


def test_csrf_rejected_without_or_with_bad_token(guest):
    guest.client.get("/")
    r = guest.client.post("/create", data={"expiryId": "1h"})
    assert r.status_code == 403
    r = guest.client.post("/create", data={"expiryId": "1h", "csrf_token": "forged"})
    assert r.status_code == 403
    assert not guest.state.guests


def test_csrf_token_from_other_browser_rejected(tmp_path):
    a = Portal("guest", tmp_path)
    tok = a.token()
    b = Portal("guest", tmp_path)
    b.client.get("/")  # b has its own cookie
    r = b.client.post("/create", data={"expiryId": "1h", "csrf_token": tok})
    assert r.status_code == 403


def test_rate_limit(tmp_path):
    p = Portal("guest", tmp_path, extra_env={"GUEST_CREATE_LIMIT": "3"})
    codes = [p.post("/create", {"expiryId": "1h"}).status_code for _ in range(4)]
    assert codes[:3] == [303, 303, 303]
    assert codes[3] == 429
    assert len(p.state.guests) == 3


def test_check_and_delete(guest):
    guest.post("/create", {"expiryId": "1h"})
    g = list(guest.state.guests.values())[0]
    r = guest.post("/check", {"username": "CORP\\" + g["username"], "password": g["password"]}, page="/check")
    assert r.status_code == 200 and "Active" in r.text
    assert "no-store" in r.headers["cache-control"]
    r = guest.post("/delete", {"username": g["username"], "password": "wrong", "confirm": "on"}, page="/delete")
    assert r.status_code == 400
    r = guest.post("/delete", {"username": g["username"], "password": g["password"], "confirm": "on"}, page="/delete")
    assert r.status_code == 303
    assert not guest.state.guests


def test_guest_mode_has_no_admin_pages(guest):
    for path in ("/login", "/guests", "/directory", "/gpo", "/settings", "/cmdlets", "/history", "/api/wording"):
        assert guest.client.get(path).status_code in (404, 405), path


def test_guest_key_cannot_reach_admin_routes_in_agent(tmp_path):
    # Even a misconfigured admin portal holding the guest key gets nothing from admin routes.
    p = Portal("admin", tmp_path, agent_key="guest-key")
    r = p.post("/login", {"username": "sam", "password": "Passw0rd!"}, page="/login")
    assert r.status_code in (401, 403, 502)
    assert "Admin console" in r.text


def test_security_headers(guest):
    r = guest.client.get("/")
    csp = r.headers["content-security-policy"]
    assert "script-src 'self'" in csp and "unsafe-inline" not in csp.split("script-src")[1].split(";")[0]
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["referrer-policy"] == "no-referrer"
    assert "camera=()" in r.headers["permissions-policy"]
    assert "<script>" not in r.text  # no inline script blocks
    assert not re.search(r"<script(?![^>]*\bsrc=)(?![^>]*type=\"application/json\")", r.text)


def test_cookies_not_secure_over_plain_http(guest):
    r = guest.client.get("/")
    sc = r.headers.get("set-cookie", "")
    assert "td_csrf" in sc and "HttpOnly" in sc and "Secure" not in sc and "SameSite=strict" in sc.replace("Strict", "strict")


def test_friendly_page_when_agent_unreachable(tmp_path):
    import httpx

    from app.config import Settings
    from app.main import create_app
    from fastapi.testclient import TestClient

    def boom(request):
        raise httpx.ConnectError("refused")

    s = Settings.from_env({"PORTAL_MODE": "guest", "AGENT_URL": "http://agent.test", "AGENT_KEY": "k", "PORTAL_DATA_DIR": str(tmp_path)})
    c = TestClient(create_app(s, transport=httpx.MockTransport(boom)))
    r = c.get("/")
    assert r.status_code == 503
    assert "The agent cannot be reached" in r.text


def test_credentials_never_logged(guest, caplog):
    caplog.set_level("DEBUG")
    guest.post("/create", {"expiryId": "1h"})
    pw = list(guest.state.guests.values())[0]["password"]
    guest.client.get("/created")
    assert pw not in caplog.text


def test_command_palette_assets(guest):
    r = guest.client.get("/")
    assert '/static/js/palette.js' in r.text and 'id="td-palette"' in r.text
    js = guest.client.get("/static/js/palette.js")
    assert js.status_code == 200 and "Ctrl+Shift+F" in js.text or "shiftKey" in js.text
    assert guest.client.get("/static/css/tokens.css").status_code == 200
    assert "Create sign-in" in r.text.split('id="td-palette">')[1].split("</script>")[0]


def test_csrf_token_signed_and_bound(guest):
    html = guest.client.get("/").text
    tok = csrf_of(html)
    assert tok.count(".") == 2  # itsdangerous timed signature
