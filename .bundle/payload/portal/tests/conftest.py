import os
import re
import sys

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from tests.fake_agent import ADMIN_PASSWORD, create_app as create_fake  # noqa: E402

CSRF_RE = re.compile(r'name="csrf_token" value="([^"]+)"')


def csrf_of(html: str) -> str:
    m = CSRF_RE.search(html)
    assert m, "no CSRF token in page"
    return m.group(1)


class Portal:
    def __init__(self, mode: str, tmp_path, backend: str = "windows", extra_env: dict | None = None, agent_key: str | None = None):
        self.fake = create_fake(backend)
        self.state = self.fake.state.fake
        env = {
            "PORTAL_MODE": mode,
            "AGENT_URL": "http://agent.test",
            "AGENT_KEY": agent_key or ("admin-key" if mode == "admin" else "guest-key"),
            "SESSION_SECRET": "s" * 48,
            "PORTAL_DATA_DIR": str(tmp_path / "data"),
            **(extra_env or {}),
        }
        self.settings = Settings.from_env(env)
        self.app = create_app(self.settings, transport=httpx.ASGITransport(app=self.fake))
        self.client = TestClient(self.app, base_url="http://portal.test", client=("192.0.2.10", 5000))

    def token(self, path: str = "/") -> str:
        return csrf_of(self.client.get(path).text)

    def post(self, path: str, data: dict | None = None, page: str | None = None, **kw):
        data = dict(data or {})
        data.setdefault("csrf_token", self.token(page or ("/login" if path == "/login" else "/")))
        return self.client.post(path, data=data, follow_redirects=False, **kw)

    def login(self):
        r = self.post("/login", {"username": "sam", "password": ADMIN_PASSWORD, "next": "/"}, page="/login")
        assert r.status_code == 303, r.text
        return r


@pytest.fixture
def guest(tmp_path):
    return Portal("guest", tmp_path)


@pytest.fixture
def admin(tmp_path):
    p = Portal("admin", tmp_path)
    p.login()
    return p


@pytest.fixture
def admin_anon(tmp_path):
    return Portal("admin", tmp_path)
