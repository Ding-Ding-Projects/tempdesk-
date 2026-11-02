"""CSRF tokens, rate limits, client IP handling, one-time stores and sessions."""

from __future__ import annotations

import hmac
import ipaddress
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from fastapi import Request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

CSRF_COOKIE = "td_csrf"
CSRF_FIELD = "csrf_token"
CSRF_MAX_AGE = 4 * 3600
SESSION_COOKIE = "td_session"
ONCE_COOKIE = "td_once"
FLASH_COOKIE = "td_flash"


class CsrfError(Exception):
    pass


# ---------------------------------------------------------------- client IP

def client_ip(request: Request, trusted: list) -> str:
    """Return the client address. X-Forwarded-For is honoured only when the
    direct peer is inside one of the TRUSTED_PROXY networks."""
    peer = request.client.host if request.client else "0.0.0.0"
    if not trusted:
        return peer
    try:
        peer_ip = ipaddress.ip_address(peer)
    except ValueError:
        return peer
    if not any(peer_ip in net for net in trusted):
        return peer
    xff = request.headers.get("x-forwarded-for", "")
    hops = [h.strip() for h in xff.split(",") if h.strip()]
    # Walk from the right, skipping our own trusted proxies.
    for hop in reversed(hops):
        try:
            ip = ipaddress.ip_address(hop)
        except ValueError:
            return peer
        if not any(ip in net for net in trusted):
            return str(ip)
    return peer


def is_https(request: Request, trusted: list, mode: str) -> bool:
    if mode == "true":
        return True
    if mode == "false":
        return False
    if request.url.scheme == "https":
        return True
    if trusted and request.client:
        try:
            peer = ipaddress.ip_address(request.client.host)
            if any(peer in net for net in trusted):
                return request.headers.get("x-forwarded-proto", "").lower() == "https"
        except ValueError:
            pass
    return False


# ---------------------------------------------------------------- CSRF

class Csrf:
    """Signed double-submit token.

    A random value lives in an HttpOnly cookie. Forms carry the same value
    signed with the server secret (with a timestamp). A submission is valid
    only when the signature checks out and the signed value equals the
    cookie, so an attacker can neither forge a token nor plant a cookie that
    matches one."""

    def __init__(self, secret: str):
        self._s = URLSafeTimedSerializer(secret, salt="tempdesk-csrf")

    @staticmethod
    def cookie_value(request: Request) -> str | None:
        v = request.cookies.get(CSRF_COOKIE)
        return v if v and 20 <= len(v) <= 100 else None

    def ensure(self, request: Request) -> str:
        """Return the cookie value for this request, creating one if needed."""
        v = getattr(request.state, "csrf_cookie", None) or self.cookie_value(request)
        if not v:
            v = secrets.token_urlsafe(32)
            request.state.csrf_new = True
        request.state.csrf_cookie = v
        return v

    def token(self, request: Request) -> str:
        return self._s.dumps(self.ensure(request))

    def verify(self, request: Request, submitted: str | None) -> None:
        cookie = self.cookie_value(request)
        if not cookie or not submitted:
            raise CsrfError("missing token")
        try:
            value = self._s.loads(submitted, max_age=CSRF_MAX_AGE)
        except (BadSignature, SignatureExpired) as exc:
            raise CsrfError("bad token") from exc
        if not isinstance(value, str) or not hmac.compare_digest(value, cookie):
            raise CsrfError("token does not match cookie")


# ---------------------------------------------------------------- rate limit

class RateLimiter:
    """Sliding window limiter kept in memory (one process per container)."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> tuple[bool, int]:
        """Record a hit. Returns (allowed, retry_after_seconds)."""
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and now - q[0] >= self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False, max(1, int(self.window - (now - q[0])))
            q.append(now)
            if len(self._hits) > 10000:  # keep memory bounded
                for k in [k for k, v in self._hits.items() if not v][:5000]:
                    self._hits.pop(k, None)
            return True, 0

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


# ---------------------------------------------------------------- one-time store

class OneTimeStore:
    """Holds freshly created credentials until they are shown once."""

    def __init__(self, ttl_seconds: int = 600, max_items: int = 2000):
        self.ttl = ttl_seconds
        self.max_items = max_items
        self._items: dict[str, tuple[float, Any]] = {}
        self._lock = threading.Lock()

    def put(self, value: Any) -> str:
        key = secrets.token_urlsafe(32)
        with self._lock:
            self._purge()
            if len(self._items) >= self.max_items:
                oldest = min(self._items, key=lambda k: self._items[k][0])
                self._items.pop(oldest, None)
            self._items[key] = (time.monotonic(), value)
        return key

    def pop(self, key: str | None) -> Any:
        if not key:
            return None
        with self._lock:
            self._purge()
            item = self._items.pop(key, None)
        return item[1] if item else None

    def _purge(self) -> None:
        now = time.monotonic()
        for k in [k for k, (t, _) in self._items.items() if now - t > self.ttl]:
            self._items.pop(k, None)

    def __len__(self) -> int:
        return len(self._items)


# ---------------------------------------------------------------- admin sessions

@dataclass
class Session:
    sid: str
    token: str
    user: dict
    expires_at: float
    created: float = field(default_factory=time.time)
    elevation: str | None = None
    elevation_expires: float = 0.0

    @property
    def elevated(self) -> bool:
        return bool(self.elevation) and self.elevation_expires > time.time()

    def elevation_token(self) -> str | None:
        """The X-TempDesk-Elevation token if still fresh, else None."""
        return self.elevation if self.elevated else None

    def set_elevation(self, token: str, seconds: int = 600) -> None:
        self.elevation = token
        self.elevation_expires = time.time() + seconds


class SessionStore:
    """Server-side admin sessions. The cookie holds only a signed random id;
    the agent bearer token never leaves the container."""

    def __init__(self, secret: str, max_age: int = 8 * 3600):
        self._s = URLSafeTimedSerializer(secret, salt="tempdesk-session")
        self.max_age = max_age
        self._items: dict[str, Session] = {}
        self._lock = threading.Lock()

    def create(self, token: str, user: dict, expires_at: float | None) -> tuple[Session, str]:
        sid = secrets.token_urlsafe(32)
        exp = min(expires_at or time.time() + self.max_age, time.time() + self.max_age)
        sess = Session(sid=sid, token=token, user=user, expires_at=exp)
        with self._lock:
            self._items[sid] = sess
        return sess, self._s.dumps(sid)

    def get(self, cookie: str | None) -> Session | None:
        if not cookie:
            return None
        try:
            sid = self._s.loads(cookie, max_age=self.max_age)
        except (BadSignature, SignatureExpired):
            return None
        with self._lock:
            sess = self._items.get(sid)
            if sess and sess.expires_at < time.time():
                self._items.pop(sid, None)
                return None
        return sess

    def drop(self, sid: str) -> None:
        with self._lock:
            self._items.pop(sid, None)


# ---------------------------------------------------------------- flash messages

class Flash:
    """Short status messages carried across a redirect in a signed cookie.
    Never used for credentials."""

    def __init__(self, secret: str):
        self._s = URLSafeTimedSerializer(secret, salt="tempdesk-flash")

    def dumps(self, kind: str, text: str) -> str:
        return self._s.dumps({"k": kind, "t": text[:400]})

    def loads(self, raw: str | None) -> dict | None:
        if not raw:
            return None
        try:
            v = self._s.loads(raw, max_age=300)
        except (BadSignature, SignatureExpired):
            return None
        return {"kind": v.get("k", "info"), "text": v.get("t", "")} if isinstance(v, dict) else None


class SuperConfirm:
    """Two-key confirmation for destructive actions.

    The page carries a signed token for (action, target). The browser only
    copies it into the form after the hold-to-confirm button was held for
    1.5 seconds, and the person must also type the target name. The server
    checks both, so a destructive POST without them is refused."""

    def __init__(self, secret: str):
        self._s = URLSafeTimedSerializer(secret, salt="tempdesk-super-confirm")

    def issue(self, action: str, target: str) -> str:
        return self._s.dumps({"a": action, "t": target})

    def check(self, action: str, target: str, typed: str | None, token: str | None) -> bool:
        if typed is None or typed.strip() != target:
            return False
        if not token:
            return False
        try:
            v = self._s.loads(token, max_age=1800)
        except (BadSignature, SignatureExpired):
            return False
        return isinstance(v, dict) and v.get("a") == action and v.get("t") == target


def safe_next(value: str | None, default: str = "/") -> str:
    """Only allow local absolute paths as redirect targets."""
    if not value or not value.startswith("/") or value.startswith("//") or "\\" in value:
        return default
    return value


CSP_DEFAULT = (
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    "font-src 'self'; connect-src 'self'; form-action 'self'; frame-src 'self'; "
    "frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
)

SECURITY_HEADERS = {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": (
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), "
        "bluetooth=(), hid=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()"
    ),
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}
