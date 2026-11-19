"""CSRF tokens, rate limits, client IP handling, one-time stores and sessions."""

from __future__ import annotations

import hmac
import ipaddress
import json
import secrets

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


# ---------------------------------------------------------------- persistent stores
# Sessions, rate limits and the one-time store live in SQLite (app/store.py).
from .store import OneTimeStore, RateLimiter, Session, SessionStore, StateDB  # noqa: E402,F401


# ---------------------------------------------------------------- flash messages

class Flash:
    """Short status messages carried across a redirect in a signed cookie.
    Never used for credentials."""

    def __init__(self, secret: str):
        self._s = URLSafeTimedSerializer(secret, salt="tempdesk-flash")

    def dumps(self, kind: str, text: str, notice: dict | None = None) -> str:
        value = {"k": kind, "t": text[:400]}
        if notice and len(json.dumps(notice, ensure_ascii=False).encode("utf-8")) <= 1000:
            value["n"] = notice
        return self._s.dumps(value)

    def loads(self, raw: str | None) -> dict | None:
        if not raw:
            return None
        try:
            v = self._s.loads(raw, max_age=300)
        except (BadSignature, SignatureExpired):
            return None
        if not isinstance(v, dict):
            return None
        value = {"kind": v.get("k", "info"), "text": v.get("t", "")}
        if isinstance(v.get("n"), dict):
            value["notice"] = v["n"]
        return value


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


def _portal_csp(*, images: tuple[str, ...] = (), connections: tuple[str, ...] = ()) -> str:
    # Inline style attributes allow layout hints without permitting inline stylesheets or scripts.
    image_sources = " ".join(("'self'", "data:", "blob:", *images))
    connect_sources = " ".join(("'self'", *connections))
    return (
        "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; "
        f"img-src {image_sources}; font-src 'self'; connect-src {connect_sources}; "
        "form-action 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"
    )


CSP_DEFAULT = _portal_csp()
CSP_COMMONS_DIM_SUM = _portal_csp(
    images=("https://github.com/Ding-Ding-Projects/dim-sum-photos/releases/download/",
            "https://release-assets.githubusercontent.com/github-production-release-asset-2e65be/"),
    connections=("https://raw.githubusercontent.com/Ding-Ding-Projects/dim-sum-photos/main/catalog/index.json",
                 "https://api.github.com/repos/Ding-Ding-Projects/dim-sum-photos/releases"),
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
