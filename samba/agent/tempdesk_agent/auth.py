"""Authentication helpers: API keys, HMAC session tokens, login lockout and
rate limiting. No Samba dependency, so it is unit tested directly."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import threading
import time

TOKEN_LIFETIME = 8 * 3600
LOCKOUT_THRESHOLD = 5
LOCKOUT_WINDOW = 15 * 60


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64u_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def keys_equal(a: str | None, b: str | None) -> bool:
    """Constant time comparison that tolerates None."""
    if not a or not b:
        return False
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def new_key() -> str:
    return secrets.token_urlsafe(32)


class TokenSigner:
    def __init__(self, secret: bytes, lifetime: int = TOKEN_LIFETIME, clock=time.time):
        if len(secret) < 16:
            raise ValueError("hmac secret too short")
        self._secret = secret
        self.lifetime = lifetime
        self._clock = clock
        self._revoked: dict[str, float] = {}
        self._lock = threading.Lock()

    def issue(self, sam: str, display_name: str = "") -> tuple[str, int]:
        now = int(self._clock())
        exp = now + self.lifetime
        payload = {"sub": sam, "name": display_name, "iat": now, "exp": exp,
                   "jti": secrets.token_hex(8)}
        body = b64u(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode())
        sig = b64u(hmac.new(self._secret, body.encode("ascii"), hashlib.sha256).digest())
        return f"{body}.{sig}", exp

    def verify(self, token: str | None) -> dict | None:
        if not token or token.count(".") != 1:
            return None
        body, sig = token.split(".", 1)
        expected = b64u(hmac.new(self._secret, body.encode("ascii", "replace"), hashlib.sha256).digest())
        if not hmac.compare_digest(expected.encode(), sig.encode("ascii", "replace")):
            return None
        try:
            payload = json.loads(b64u_decode(body))
        except (ValueError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict) or int(payload.get("exp", 0)) <= self._clock():
            return None
        with self._lock:
            if payload.get("jti") in self._revoked:
                return None
        return payload

    def revoke(self, token: str) -> bool:
        p = self.verify(token)
        if not p:
            return False
        with self._lock:
            now = self._clock()
            self._revoked = {j: e for j, e in self._revoked.items() if e > now}
            self._revoked[p["jti"]] = p["exp"]
        return True


class Lockout:
    """Lock a username (and source) after `threshold` failures inside `window`
    seconds; the lock lasts `window` seconds from the last failure."""

    def __init__(self, threshold=LOCKOUT_THRESHOLD, window=LOCKOUT_WINDOW, clock=time.time):
        self.threshold, self.window, self._clock = threshold, window, clock
        self._fails: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def _prune(self, key: str) -> list[float]:
        now = self._clock()
        lst = [t for t in self._fails.get(key, []) if now - t < self.window]
        if lst:
            self._fails[key] = lst
        else:
            self._fails.pop(key, None)
        return lst

    def locked(self, key: str) -> bool:
        with self._lock:
            return len(self._prune(key.lower())) >= self.threshold

    def fail(self, key: str) -> None:
        with self._lock:
            k = key.lower()
            self._prune(k)
            self._fails.setdefault(k, []).append(self._clock())

    def success(self, key: str) -> None:
        with self._lock:
            self._fails.pop(key.lower(), None)


class RateLimiter:
    """Sliding window counter keyed by an arbitrary string."""

    def __init__(self, clock=time.time):
        self._clock = clock
        self._hits: dict[str, list[float]] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, limit: int, window: float) -> bool:
        if limit <= 0:
            return True
        with self._lock:
            now = self._clock()
            lst = [t for t in self._hits.get(key, []) if now - t < window]
            if len(lst) >= limit:
                self._hits[key] = lst
                return False
            lst.append(now)
            self._hits[key] = lst
            # opportunistic cleanup
            if len(self._hits) > 10000:
                self._hits = {k: v for k, v in self._hits.items() if v and now - v[-1] < window}
            return True
