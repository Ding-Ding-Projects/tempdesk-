import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "agent"))

from tempdesk_agent.app import App, Request  # noqa: E402
from tempdesk_agent.auth import TokenSigner  # noqa: E402
from tempdesk_agent.fake import FakeBackend  # noqa: E402
from tempdesk_agent.stores import AuditLog, SettingsStore  # noqa: E402

GUEST_KEY = "guest-key-0123456789abcdef"
ADMIN_KEY = "admin-key-0123456789abcdef"


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def app(tmp_path, clock):
    be = FakeBackend(str(tmp_path / "sysvol"))
    settings = SettingsStore(str(tmp_path / "settings.json"))
    audit = AuditLog(str(tmp_path / "audit.log"))
    signer = TokenSigner(b"x" * 32, clock=clock)
    return App(be, settings, audit, GUEST_KEY, ADMIN_KEY, signer, clock=clock)


class Client:
    def __init__(self, app):
        self.app = app
        self.token = None

    def call(self, method, path, body=None, key=None, token=None, headers=None, query=None):
        h = {}
        if key:
            h["x-tempdesk-key"] = key
        tok = token if token is not None else self.token
        if tok:
            h["authorization"] = f"Bearer {tok}"
        h.update(headers or {})
        if "?" in path:
            from tempdesk_agent.app import parse_query
            path, qs = path.split("?", 1)
            query = {**parse_query(qs), **(query or {})}
        req = Request(method, "/api/v1" + path, query or {}, h,
                      json.dumps(body).encode() if body is not None else b"", "10.0.0.5")
        resp = self.app.handle(req)
        data = resp.encode()
        if resp.content_type.startswith("application/json") and data:
            return resp.status, json.loads(data)
        return resp.status, data.decode() if data else None

    def login(self):
        st, body = self.call("POST", "/auth/login", {"username": "Administrator", "password": "Passw0rd!"},
                             key=ADMIN_KEY, token="")
        assert st == 200, body
        self.token = body["token"]
        return body


@pytest.fixture
def client(app):
    return Client(app)
