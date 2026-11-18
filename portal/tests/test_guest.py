import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

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

def rdp_link(page):
    match = re.search(r'href="(/created/[A-Za-z0-9_-]{24}/virtual-commons\.rdp)"[^>]*id="commons-rdp"', page.text)
    assert match
    return match[1]


def test_virtual_commons_download_has_no_password(tmp_path, monkeypatch):
    from app import guest_routes

    portal = Portal("guest", tmp_path, extra_env={"COMMONS_RDP_TARGET": "sessions.example.test:3390"})
    monkeypatch.setattr(guest_routes.secrets, "randbelow", lambda upper: upper - 1)
    checkout = portal.post("/create", {"expiryId": "1h", "checkout": "commons"})
    assert checkout.status_code == 303
    confirmation = checkout.headers["location"]
    assert confirmation.startswith("/created/") and "?" not in confirmation
    assert "HttpOnly" in checkout.headers["set-cookie"] and f"Path={confirmation}" in checkout.headers["set-cookie"]
    result = portal.client.get(confirmation)
    link = rdp_link(result)
    cookie = next(value for value in result.headers.get_list("set-cookie") if value.startswith("td_commons_download="))
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie and f"Path={link}" in cookie
    download = portal.client.get(link)
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/x-rdp"
    assert download.headers["content-disposition"] == 'attachment; filename="Virtual-Commons.rdp"'
    assert "no-store" in download.headers["cache-control"]
    assert download.headers["x-content-type-options"] == "nosniff"
    profile = download.content.decode("utf-16")
    assert "full address:s:sessions.example.test:3390\r\n" in profile
    account = next(iter(portal.state.guests.values()))
    assert account["username"] in profile and account["password"] not in profile
    assert account["password"] not in confirmation + link + cookie
    assert portal.client.get(confirmation).status_code == 410
    assert portal.client.get(link).content == download.content
    anonymous = TestClient(portal.app, base_url="http://portal.test")
    rejected = anonymous.get(link)
    assert rejected.status_code == 404 and "no-store" in rejected.headers["cache-control"]


def test_download_grant_survives_portal_restart_and_expires(tmp_path, monkeypatch):
    from app import commons_handoff, guest_routes

    env = {"COMMONS_RDP_GUI": "desktop.example.test"}
    portal = Portal("guest", tmp_path, extra_env=env)
    monkeypatch.setattr(guest_routes.secrets, "randbelow", lambda upper: upper - 1)
    checkout = portal.post("/create", {"expiryId": "1h", "checkout": "commons", "edition": "gui"})
    link = rdp_link(portal.client.get(checkout.headers["location"]))
    issued = portal.client.get(link)
    assert issued.status_code == 200
    cookies = list(portal.client.cookies.jar)
    portal.app.state.db.close()

    restarted = Portal("guest", tmp_path, extra_env=env)
    for cookie in cookies:
        restarted.client.cookies.jar.set_cookie(cookie)
    assert restarted.client.get(link).content == issued.content
    now = time.time()
    monkeypatch.setattr(commons_handoff.time, "time", lambda: now + commons_handoff.HANDOFF_SECONDS + 1)
    assert restarted.client.get(link).status_code == 404


def test_download_deadline_is_capped_by_the_account_expiry(monkeypatch):
    from app import commons_handoff

    now = datetime(2030, 1, 1, tzinfo=timezone.utc)
    end = now + timedelta(seconds=40)
    monkeypatch.setattr(commons_handoff.time, "time", lambda: now.timestamp())
    assert commons_handoff.download_deadline(end.isoformat()) == int(end.timestamp())
    assert commons_handoff.download_deadline((now + timedelta(hours=1)).isoformat()) == int(now.timestamp()) + 600
    assert commons_handoff.download_deadline("bad timestamp") == 0


def test_confirmation_can_be_claimed_by_only_one_database_connection(tmp_path):
    from app.store import OneTimeStore, StateDB

    first = StateDB(tmp_path, None, "guest")
    second = StateDB(tmp_path, None, "guest")
    stores = [OneTimeStore(first), OneTimeStore(second)]
    record = {"account": "test record"}
    key = stores[0].put(record)
    start = Barrier(2)

    def claim(store):
        start.wait(timeout=5)
        return store.pop(key)

    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(claim, stores))
        assert outcomes.count(record) == 1 and outcomes.count(None) == 1
    finally:
        first.close()
        second.close()


def test_virtual_commons_wording_requires_a_verified_active_guest(tmp_path):
    from app.guest_routes import WORDING_COOKIE

    portal = Portal("guest", tmp_path, extra_env={"COMMONS_RDP_GUI": "desktop.example.test"})
    anonymous = portal.client.get("/").text
    assert 'id="picker-wording"' not in anonymous
    assert '"/#picker-wording"' not in anonymous
    assert portal.post("/create", {"expiryId": "1h"}).status_code == 303
    account = next(iter(portal.state.guests.values()))
    credentials = {"username": account["username"], "password": account["password"]}
    invalid = portal.post("/check", dict(credentials, password="wrong"), page="/check")
    assert invalid.status_code == 400 and WORDING_COOKIE not in invalid.cookies

    original_expiry = account["expiresAt"]
    account["expiresAt"] = "2000-01-01T00:00:00Z"
    expired = portal.post("/check", credentials, page="/check")
    assert WORDING_COOKIE not in expired.cookies
    account["expiresAt"] = original_expiry
    verified = portal.post("/check", credentials, page="/check")
    assert verified.status_code == 200 and WORDING_COOKIE in verified.cookies
    assert "HttpOnly" in verified.headers["set-cookie"]
    home = portal.client.get("/")
    assert 'id="picker-wording"' in home.text
    assert '"/#picker-wording"' in home.text
    assert "no-store" in home.headers["cache-control"]
    invalid_checkout = {"expiryId": "1h", "checkout": "commons", "edition": "gui", "displayName": "[invalid]"}
    recovery = portal.post("/create", invalid_checkout)
    assert recovery.status_code == 400 and 'id="picker-wording"' in recovery.text
    assert "no-store" in recovery.headers["cache-control"]
    portal.client.cookies.set(WORDING_COOKIE, "invalid")
    assert 'id="picker-wording"' not in portal.client.get("/").text
    assert 'id="picker-wording"' not in portal.post("/create", invalid_checkout).text


def test_virtual_commons_dim_sum_does_not_allocate_an_account(tmp_path, monkeypatch):
    from html import unescape

    from app import guest_routes

    portal = Portal("guest", tmp_path, extra_env={"COMMONS_RDP_GUI": "sessions.example.test"})
    def dim_sum_roll(upper):
        assert upper == 100
        return 0
    monkeypatch.setattr(guest_routes.secrets, "randbelow", dim_sum_roll)
    result = portal.post("/create", {
        "expiryId": "1h", "checkout": "commons", "edition": "gui", "displayName": "Retry Guest",
    })
    assert result.status_code == 200
    assert "No session was checked out" in result.text
    assert not portal.state.guests
    assert "no-store" in result.headers["cache-control"]
    retry_link = re.search(r'href="([^"]+)"[^>]*>Try again', result.text)
    assert retry_link
    retry_url = unescape(retry_link[1])
    assert retry_url == "/?edition=gui&duration=1h#virtual-commons"
    retry_page = portal.client.get(retry_url)
    checkout = retry_page.text.split('id="virtual-commons"', 1)[1]
    assert re.search(r'name="edition" value="gui"[^>]*checked', checkout)
    assert re.search(r'name="expiryId" value="1h"[^>]*checked', checkout)
    assert "Retry Guest" not in retry_page.text
    assert not portal.state.guests


def test_commons_editions_route_only_to_the_selected_destination(tmp_path, monkeypatch):
    from app import guest_routes

    portal = Portal("guest", tmp_path, extra_env={
        "COMMONS_RDP_GUI": "desktop.example.test",
        "COMMONS_RDP_CORE": "core.example.test:3390",
    })
    monkeypatch.setattr(guest_routes.secrets, "randbelow", lambda upper: upper - 1)
    expected = [
        ("gui", "desktop.example.test", "Windows Server with GUI"),
        ("core", "core.example.test:3390", "Windows Server without GUI"),
    ]
    confirmations = []
    for edition, _, _ in expected:
        checkout = portal.post("/create", {"expiryId": "1h", "checkout": "commons", "edition": edition})
        assert checkout.status_code == 303
        confirmations.append(checkout.headers["location"])
    assert len(set(confirmations)) == len(expected)

    links = []
    for (_, address, label), confirmation in reversed(list(zip(expected, confirmations))):
        page = portal.client.get(confirmation)
        assert f"<strong>{label}</strong>" in page.text
        links.append((address, rdp_link(page)))
    for address, link in reversed(links):
        download = portal.client.get(link)
        assert download.status_code == 200
        assert download.content.decode("utf-16").splitlines()[0] == f"full address:s:{address}"


def test_unavailable_commons_edition_stops_before_the_draw(tmp_path, monkeypatch):
    from app import guest_routes

    portal = Portal("guest", tmp_path, extra_env={
        "COMMONS_RDP_GUI": "desktop.example.test",
        "COMMONS_RDP_TARGET": "legacy.example.test",
    })
    def unexpected_draw(upper):
        raise AssertionError("Unavailable edition reached the draw")
    monkeypatch.setattr(guest_routes.secrets, "randbelow", unexpected_draw)
    result = portal.post("/create", {"expiryId": "1h", "checkout": "commons", "edition": "core"})
    assert result.status_code == 400
    assert not portal.state.guests


@pytest.mark.parametrize("pending_format", ["flat", "wrapped"])
def test_pending_legacy_commons_checkout_survives_upgrade(tmp_path, pending_format):
    from app.security import ONCE_COOKIE

    portal = Portal("guest", tmp_path, extra_env={"COMMONS_RDP_TARGET": "legacy.example.test"})
    credentials = {"username": "guest1", "password": "example-password", "domain": "corp.test"}
    if pending_format == "flat":
        pending = {**credentials, "commons": True}
    else:
        pending = {"credentials": credentials, "commons": True}
    checkout = portal.app.state.once.put(pending)
    portal.client.cookies.set(ONCE_COOKIE, checkout, domain="portal.test", path="/")
    result = portal.client.get("/created")
    assert result.status_code == 200
    download = portal.client.get(rdp_link(result))
    assert "full address:s:legacy.example.test" in download.content.decode("utf-16")
    assert portal.client.get("/created").status_code == 410


def test_commons_download_cannot_follow_a_target_to_another_edition(tmp_path, monkeypatch):
    from app import guest_routes

    portal = Portal("guest", tmp_path, extra_env={
        "COMMONS_RDP_GUI": "desktop.example.test",
        "COMMONS_RDP_CORE": "core.example.test",
    })
    monkeypatch.setattr(guest_routes.secrets, "randbelow", lambda upper: upper - 1)
    checkout = portal.post("/create", {"expiryId": "1h", "checkout": "commons", "edition": "gui"})
    assert checkout.status_code == 303
    portal.settings.commons_rdp_gui = "core.example.test"
    portal.settings.commons_rdp_core = "desktop.example.test"
    confirmation = checkout.headers["location"]
    result = portal.client.get(confirmation)
    assert result.status_code == 200
    assert "The Remote Desktop file is unavailable." in result.text
    assert 'download="Virtual-Commons.rdp"' not in result.text
    assert portal.client.get(confirmation).status_code == 410


def test_attachment_still_requires_the_confirmed_destination(tmp_path, monkeypatch):
    from app import guest_routes

    portal = Portal("guest", tmp_path, extra_env={"COMMONS_RDP_GUI": "desktop.example.test"})
    monkeypatch.setattr(guest_routes.secrets, "randbelow", lambda upper: upper - 1)
    checkout = portal.post("/create", {"expiryId": "1h", "checkout": "commons", "edition": "gui"})
    link = rdp_link(portal.client.get(checkout.headers["location"]))
    assert portal.client.get(link).status_code == 200
    portal.settings.commons_rdp_gui = "different.example.test"
    assert portal.client.get(link).status_code == 404
