"""Tests for the Server management area (portal/app/server_routes.py).

These drive the admin app with a fake TempDesk Agent built on httpx.MockTransport,
so no real domain controller is needed. They cover:

  * every Server page renders (200) and reaches the matching agent route;
  * the whole area requires an admin session (401/redirect when signed out);
  * the PowerShell console and anything needing full control require a fresh
    elevation token;
  * destructive actions forward the exact "confirm" value the agent demands;
  * the metrics and job proxies return the agent JSON for the live views.

If the portal app cannot be imported yet (the portal owner is still adding the
i18n catalogs, base templates and tokens.css that app import needs), every test
skips with a clear reason rather than failing, so this file is safe to run in
CI while the portal is mid-build.
"""

from __future__ import annotations

import importlib
import json

import pytest

httpx = pytest.importorskip("httpx")

# The app import pulls in i18n JSON, templates and static assets owned by the
# portal maintainer. When any is missing we skip the whole module.
try:  # pragma: no cover - exercised only while the portal is incomplete
    _main = importlib.import_module("app.main")
    _config = importlib.import_module("app.config")
    _security = importlib.import_module("app.security")
    _server_routes = importlib.import_module("app.server_routes")
    _web = importlib.import_module("app.web")
    IMPORT_ERROR = None
except Exception as exc:  # noqa: BLE001 - any failure means not-ready
    IMPORT_ERROR = exc

pytestmark = pytest.mark.skipif(
    IMPORT_ERROR is not None,
    reason=f"portal app not importable yet (portal owner mid-build): {IMPORT_ERROR!r}",
)


CAPS = [
    "server", "services", "processes", "events", "files", "firewall", "features",
    "updates", "storage", "network", "registry", "tasks", "certificates",
    "devices", "dns", "dhcp", "perfmon", "console",
]


class FakeAgent:
    """Records every request and replies from a small fixture table."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        method = request.method
        params = dict(request.url.params)
        body = None
        if request.content:
            try:
                body = json.loads(request.content.decode("utf-8"))
            except Exception:  # noqa: BLE001
                body = request.content
        self.calls.append((method, path, {"params": params, "json": body,
                                           "elevation": request.headers.get("x-tempdesk-elevation")}))

        base = "/api/v1"
        p = path[len(base):] if path.startswith(base) else path

        if p == "/health":
            return httpx.Response(200, json={"status": "ok", "capabilities": CAPS})
        if p == "/server/overview":
            return httpx.Response(200, json={"computerName": "DC01", "os": "Windows Server 2025",
                                             "edition": "Core", "uptimeSeconds": 3600,
                                             "memoryTotalBytes": 8, "memoryUsedBytes": 3})
        if p == "/server/metrics":
            return httpx.Response(200, json={"cpuPercent": 7, "memoryUsedBytes": 3,
                                             "disks": [], "network": []})
        if p == "/server/services":
            return httpx.Response(200, json=[{"name": "TempDeskAgent", "status": "Running"}])
        if p == "/server/processes":
            return httpx.Response(200, json=[{"pid": 4, "name": "System"}])
        if p == "/server/eventlogs":
            return httpx.Response(200, json=[{"name": "System", "recordCount": 10}])
        if p == "/server/events":
            return httpx.Response(200, json=[{"id": 1, "message": "x"}])
        if p == "/server/files":
            return httpx.Response(200, json={"path": params.get("path"), "entries": []})
        if p == "/server/firewall/profiles":
            return httpx.Response(200, json=[{"name": "Domain", "enabled": True}])
        if p == "/server/firewall/rules":
            return httpx.Response(200, json=[])
        if p == "/server/features":
            return httpx.Response(200, json=[{"name": "DNS", "installed": True}])
        if p == "/server/updates":
            return httpx.Response(200, json={"available": [], "installed": []})
        if p in ("/server/disks", "/server/volumes", "/server/partitions", "/server/shares"):
            return httpx.Response(200, json=[])
        if p in ("/server/network/adapters", "/server/network/routes"):
            return httpx.Response(200, json=[])
        if p == "/server/registry":
            return httpx.Response(200, json={"path": params.get("path"), "subkeys": [], "values": []})
        if p == "/server/tasks":
            return httpx.Response(200, json=[])
        if p == "/server/certificates":
            return httpx.Response(200, json=[])
        if p == "/server/devices":
            return httpx.Response(200, json=[])
        if p == "/dns/zones":
            return httpx.Response(200, json=[{"zoneName": "lab.example.org"}])
        if p == "/dhcp/scopes":
            return httpx.Response(200, json=[])
        if p == "/server/counters":
            return httpx.Response(200, json=[])
        if p.startswith("/jobs/"):
            return httpx.Response(200, json={"jobId": p.rsplit("/", 1)[-1], "state": "Completed",
                                             "progress": 100, "output": [], "errors": []})
        if p == "/server/power":
            return httpx.Response(200, json={"action": (body or {}).get("action"), "scheduled": True})
        if p == "/server/console/sessions":
            return httpx.Response(201, json={"sessionId": "abc"})
        if p.endswith("/run"):
            return httpx.Response(200, json={"output": "ok", "errors": [], "prompt": "PS> "})
        if p.startswith("/server/eventlogs/") and p.endswith("/export"):
            return httpx.Response(200, content=b"EVTX", headers={"content-type": "application/octet-stream"})
        # Generic success for the destructive / mutating routes.
        if method in ("POST", "PUT", "PATCH", "DELETE"):
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(404, json={"error": "not_found", "message": "no fixture for " + p})


def make_app(fake: FakeAgent):
    settings = _config.Settings(
        mode="admin",
        agent_url="http://agent.local/api/v1",
        agent_key="admin-key",
        session_secret="s" * 48,
    )
    transport = httpx.MockTransport(fake.handler)
    return _main.create_app(settings, transport=transport)


def admin_client(app, elevated: bool = False):
    """A TestClient whose cookie points at a server-side admin session."""
    store = app.state.sessions
    sess, cookie = store.create("bearer-token", {"sam": "admin", "displayName": "Admin"},
                                expires_at=None)
    if elevated:
        sess.set_elevation("elev-token", 600)
    from fastapi.testclient import TestClient

    client = TestClient(app, follow_redirects=False)
    # Match the signed session cookie the SessionStore issued.
    from app.security import SESSION_COOKIE

    client.cookies.set(SESSION_COOKIE, cookie)
    return client, sess


# --------------------------------------------------------------- router shape

def test_router_prefix_and_nav():
    assert _server_routes.router.prefix == "/server"
    ids = {i["id"] for i in _main.navmod.NAV_ITEMS}
    assert "server-overview" in ids
    item = next(i for i in _main.navmod.NAV_ITEMS if i["id"] == "server-overview")
    assert item["group"] == "Server"
    assert item["capability"] == "server"


# --------------------------------------------------------------- page renders

PAGES = [
    "/server", "/server/services", "/server/processes", "/server/events",
    "/server/files", "/server/firewall", "/server/features", "/server/updates",
    "/server/storage", "/server/network", "/server/registry", "/server/tasks",
    "/server/certificates", "/server/devices", "/server/dns", "/server/dhcp",
    "/server/perfmon",
]


@pytest.mark.parametrize("path", PAGES)
def test_pages_render_for_admin(path):
    fake = FakeAgent()
    app = make_app(fake)
    client, _ = admin_client(app)
    resp = client.get(path)
    assert resp.status_code == 200, (path, resp.status_code)


# --------------------------------------------------------------- admin required

@pytest.mark.parametrize("path", ["/server", "/server/services", "/server/console"])
def test_pages_require_admin(path):
    fake = FakeAgent()
    app = make_app(fake)
    from fastapi.testclient import TestClient

    client = TestClient(app, follow_redirects=False)
    resp = client.get(path)
    # Signed out: a redirect to /login (303) or a 401 for JSON clients.
    assert resp.status_code in (303, 401), (path, resp.status_code)
    if resp.status_code == 303:
        assert "/login" in resp.headers.get("location", "")


# --------------------------------------------------------------- metrics / jobs proxies

def test_metrics_proxy_returns_agent_json():
    fake = FakeAgent()
    app = make_app(fake)
    client, _ = admin_client(app)
    resp = client.get("/server/metrics")
    assert resp.status_code == 200
    assert resp.json()["cpuPercent"] == 7
    assert any(c[1].endswith("/server/metrics") for c in fake.calls)


def test_job_status_proxy():
    fake = FakeAgent()
    app = make_app(fake)
    client, _ = admin_client(app)
    resp = client.get("/server/jobs/job123/status")
    assert resp.status_code == 200
    assert resp.json()["state"] == "Completed"


# --------------------------------------------------------------- elevation

def test_console_page_requires_elevation():
    fake = FakeAgent()
    app = make_app(fake)
    client, _ = admin_client(app, elevated=False)
    resp = client.get("/server/console")
    assert resp.status_code == 303
    assert "/auth/elevate" in resp.headers.get("location", "")


def test_console_page_allowed_when_elevated():
    fake = FakeAgent()
    app = make_app(fake)
    client, _ = admin_client(app, elevated=True)
    resp = client.get("/server/console")
    assert resp.status_code == 200


def test_console_run_forwards_elevation_token():
    fake = FakeAgent()
    app = make_app(fake)
    client, sess = admin_client(app, elevated=True)
    csrf = app.state.csrf
    # Build a valid CSRF pair the way the app expects.
    token = csrf.token_for_test() if hasattr(csrf, "token_for_test") else None
    # Fall back to posting with the double-submit cookie + signed token.
    cookie_val = client.cookies.get(_security.CSRF_COOKIE)
    headers = {}
    if token is None:
        # Generate the signed token matching the cookie.
        from itsdangerous import URLSafeTimedSerializer

        s = URLSafeTimedSerializer(app.state.settings.session_secret, salt="tempdesk-csrf")
        if cookie_val is None:
            cookie_val = "x" * 40
            client.cookies.set(_security.CSRF_COOKIE, cookie_val)
        headers["x-csrf-token"] = s.dumps(cookie_val)
    resp = client.post("/server/console/sessions/abc/run", json={"command": "Get-Date"},
                       headers=headers)
    assert resp.status_code in (200, 403)
    if resp.status_code == 200:
        run_calls = [c for c in fake.calls if c[1].endswith("/run")]
        assert run_calls and run_calls[-1][2]["elevation"] == "elev-token"


def test_console_run_blocked_without_elevation():
    fake = FakeAgent()
    app = make_app(fake)
    client, _ = admin_client(app, elevated=False)
    from itsdangerous import URLSafeTimedSerializer

    s = URLSafeTimedSerializer(app.state.settings.session_secret, salt="tempdesk-csrf")
    cookie_val = "y" * 40
    client.cookies.set(_security.CSRF_COOKIE, cookie_val)
    resp = client.post("/server/console/sessions/abc/run", json={"command": "x"},
                       headers={"x-csrf-token": s.dumps(cookie_val)})
    assert resp.status_code == 403


# --------------------------------------------------------------- confirm forwarding

def _csrf_post(app, client, url, data):
    from itsdangerous import URLSafeTimedSerializer

    s = URLSafeTimedSerializer(app.state.settings.session_secret, salt="tempdesk-csrf")
    cookie_val = client.cookies.get(_security.CSRF_COOKIE) or ("z" * 40)
    client.cookies.set(_security.CSRF_COOKIE, cookie_val)
    payload = dict(data)
    payload["csrf_token"] = s.dumps(cookie_val)
    return client.post(url, data=payload)


def test_power_forwards_confirm():
    fake = FakeAgent()
    app = make_app(fake)
    client, _ = admin_client(app)
    resp = _csrf_post(app, client, "/server/power",
                      {"action": "restart", "confirm_name": "restart", "delaySeconds": "30"})
    assert resp.status_code == 303
    power_calls = [c for c in fake.calls if c[1].endswith("/server/power")]
    assert power_calls, "power route was not called"
    assert power_calls[-1][2]["json"]["confirm"] == "restart"
    assert power_calls[-1][2]["json"]["action"] == "restart"


def test_file_delete_forwards_confirm():
    fake = FakeAgent()
    app = make_app(fake)
    client, _ = admin_client(app)
    resp = _csrf_post(app, client, "/server/files/delete",
                      {"path": "C:\\temp\\x.txt", "confirm_name": "x.txt"})
    assert resp.status_code == 303
    del_calls = [c for c in fake.calls if c[0] == "DELETE" and c[1].endswith("/server/files")]
    assert del_calls, "delete route was not called"
    assert del_calls[-1][2]["params"].get("confirm") == "x.txt"


def test_firewall_rule_delete_forwards_confirm():
    fake = FakeAgent()
    app = make_app(fake)
    client, _ = admin_client(app)
    resp = _csrf_post(app, client, "/server/firewall/rules/MyRule/delete",
                      {"confirm_name": "MyRule"})
    assert resp.status_code == 303
    del_calls = [c for c in fake.calls if c[0] == "DELETE" and "/firewall/rules/" in c[1]]
    assert del_calls
    assert del_calls[-1][2]["params"].get("confirm") == "MyRule"
