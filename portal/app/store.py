"""Persistent portal state in SQLite: admin sessions, rate-limit windows and
the one-time credentials store.

File: <PORTAL_STATE_DIR or PORTAL_DATA_DIR>/portal-state.sqlite3 (mode 600).

Secrets at rest (one-time credentials, the agent bearer token, the elevation
token) are encrypted with AES-256-GCM. The key is derived with HKDF-SHA256
from SESSION_SECRET in admin mode; in guest mode (which has no required
secret) it is a random 32-byte key kept in portal-state.key (mode 600) next
to the database. One-time entries are deleted on first read and expire after
their TTL (10 minutes) whether or not they were read.
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

DB_NAME = "portal-state.sqlite3"
KEY_NAME = "portal-state.key"

SCHEMA = """
CREATE TABLE IF NOT EXISTS once (id TEXT PRIMARY KEY, created REAL NOT NULL, blob BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS hits (bucket TEXT NOT NULL, key TEXT NOT NULL, t REAL NOT NULL);
CREATE INDEX IF NOT EXISTS hits_idx ON hits (bucket, key, t);
CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, token BLOB NOT NULL, user TEXT NOT NULL,
  expires REAL NOT NULL, created REAL NOT NULL, elevation BLOB, elevation_expires REAL NOT NULL DEFAULT 0);
"""


class StateDB:
    def __init__(self, directory: str | os.PathLike, secret: str | None, mode: str):
        self.dir = Path(directory)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / DB_NAME
        new = not self.path.exists()
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(self.path), check_same_thread=False, isolation_level=None, timeout=10)
        if new:
            os.chmod(self.path, 0o600)
        self._db.execute("PRAGMA journal_mode=WAL")
        self._db.execute("PRAGMA secure_delete=ON")
        self._db.executescript(SCHEMA)
        self._aead = AESGCM(self._key(secret, mode))

    def _key(self, secret: str | None, mode: str) -> bytes:
        if mode == "admin" and secret:
            return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"tempdesk-portal-state-v1",
                        info=b"state-encryption").derive(secret.encode("utf-8"))
        kp = self.dir / KEY_NAME
        try:
            key = kp.read_bytes()
            if len(key) == 32:
                return key
        except FileNotFoundError:
            pass
        key = secrets.token_bytes(32)
        fd = os.open(kp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(key)
        return key

    def seal(self, data: bytes, aad: bytes) -> bytes:
        nonce = secrets.token_bytes(12)
        return nonce + self._aead.encrypt(nonce, data, aad)

    def open(self, blob: bytes, aad: bytes) -> bytes | None:
        try:
            return self._aead.decrypt(blob[:12], blob[12:], aad)
        except Exception:  # noqa: BLE001 - wrong key or tampered row
            return None

    def execute(self, sql: str, args: tuple = ()) -> list:
        with self._lock:
            return self._db.execute(sql, args).fetchall()

    def close(self) -> None:
        with self._lock:
            self._db.close()


class OneTimeStore:
    """Credentials waiting to be shown once. Encrypted at rest."""

    def __init__(self, db: StateDB, ttl_seconds: int = 600, max_items: int = 2000, kind: str = "once"):
        self.db, self.ttl, self.max_items, self.kind = db, ttl_seconds, max_items, kind

    def _purge(self) -> None:
        self.db.execute("DELETE FROM once WHERE created < ?", (time.time() - self.ttl,))

    def put(self, value: Any) -> str:
        key = secrets.token_urlsafe(32)
        self._purge()
        blob = self.db.seal(json.dumps(value).encode("utf-8"), (self.kind + key).encode())
        self.db.execute("INSERT INTO once (id, created, blob) VALUES (?, ?, ?)", (self.kind + ":" + key, time.time(), blob))
        n = self.db.execute("SELECT COUNT(*) FROM once")[0][0]
        if n > self.max_items:
            self.db.execute("DELETE FROM once WHERE id IN (SELECT id FROM once ORDER BY created LIMIT ?)", (n - self.max_items,))
        return key

    def pop(self, key: str | None) -> Any:
        if not key or len(key) > 100:
            return None
        self._purge()
        rid = self.kind + ":" + key
        with self.db._lock:
            row = self.db._db.execute("SELECT blob, created FROM once WHERE id = ?", (rid,)).fetchone()
            self.db._db.execute("DELETE FROM once WHERE id = ?", (rid,))
        if not row or row[1] < time.time() - self.ttl:
            return None
        raw = self.db.open(row[0], (self.kind + key).encode())
        return json.loads(raw) if raw else None

    def __len__(self) -> int:
        self._purge()
        return self.db.execute("SELECT COUNT(*) FROM once WHERE id LIKE ?", (self.kind + ":%",))[0][0]


class RateLimiter:
    """Sliding window limiter persisted in SQLite, so restarts keep the window."""

    def __init__(self, db: StateDB, bucket: str, limit: int, window_seconds: int):
        self.db, self.bucket, self.limit, self.window = db, bucket, limit, window_seconds

    def check(self, key: str) -> tuple[bool, int]:
        now = time.time()
        with self.db._lock:
            c = self.db._db
            c.execute("DELETE FROM hits WHERE bucket = ? AND t <= ?", (self.bucket, now - self.window))
            rows = c.execute("SELECT t FROM hits WHERE bucket = ? AND key = ? ORDER BY t", (self.bucket, key)).fetchall()
            if len(rows) >= self.limit:
                return False, max(1, int(self.window - (now - rows[0][0])))
            c.execute("INSERT INTO hits (bucket, key, t) VALUES (?, ?, ?)", (self.bucket, key, now))
        return True, 0

    def reset(self) -> None:
        self.db.execute("DELETE FROM hits WHERE bucket = ?", (self.bucket,))


class Session:
    def __init__(self, store: "SessionStore", sid: str, token: str, user: dict, expires_at: float, created: float,
                 elevation: str | None = None, elevation_expires: float = 0.0):
        self._store = store
        self.sid, self.token, self.user = sid, token, user
        self.expires_at, self.created = expires_at, created
        self.elevation, self.elevation_expires = elevation, elevation_expires

    @property
    def elevated(self) -> bool:
        return bool(self.elevation) and self.elevation_expires > time.time()

    def elevation_token(self) -> str | None:
        return self.elevation if self.elevated else None

    def set_elevation(self, token: str, seconds: int = 600) -> None:
        self.elevation = token
        self.elevation_expires = time.time() + seconds
        self._store.save_elevation(self)

    def __repr__(self) -> str:  # never print tokens
        return f"Session(sid=..., user={self.user.get('sam')!r})"


class SessionStore:
    """Admin sessions. The cookie holds only a signed random id; the agent
    bearer token is stored encrypted in SQLite and never leaves the container."""

    def __init__(self, db: StateDB, secret: str, max_age: int = 8 * 3600):
        self.db = db
        self._s = URLSafeTimedSerializer(secret, salt="tempdesk-session")
        self.max_age = max_age

    def create(self, token: str, user: dict, expires_at: float | None) -> tuple[Session, str]:
        sid = secrets.token_urlsafe(32)
        now = time.time()
        exp = min(expires_at or now + self.max_age, now + self.max_age)
        self.db.execute("DELETE FROM sessions WHERE expires < ?", (now,))
        self.db.execute("INSERT INTO sessions (sid, token, user, expires, created) VALUES (?, ?, ?, ?, ?)",
                        (sid, self.db.seal(token.encode(), sid.encode()), json.dumps(user), exp, now))
        return Session(self, sid, token, user, exp, now), self._s.dumps(sid)

    def get(self, cookie: str | None) -> Session | None:
        if not cookie:
            return None
        try:
            sid = self._s.loads(cookie, max_age=self.max_age)
        except (BadSignature, SignatureExpired):
            return None
        rows = self.db.execute("SELECT token, user, expires, created, elevation, elevation_expires FROM sessions WHERE sid = ?", (sid,))
        if not rows:
            return None
        tok, user, exp, created, elev, elev_exp = rows[0]
        if exp < time.time():
            self.drop(sid)
            return None
        token = self.db.open(tok, sid.encode())
        if token is None:
            return None
        e = self.db.open(elev, (sid + ":elev").encode()) if elev else None
        return Session(self, sid, token.decode(), json.loads(user), exp, created,
                       e.decode() if e else None, elev_exp)

    def save_elevation(self, sess: Session) -> None:
        blob = self.db.seal(sess.elevation.encode(), (sess.sid + ":elev").encode()) if sess.elevation else None
        self.db.execute("UPDATE sessions SET elevation = ?, elevation_expires = ? WHERE sid = ?", (blob, sess.elevation_expires, sess.sid))

    def drop(self, sid: str) -> None:
        self.db.execute("DELETE FROM sessions WHERE sid = ?", (sid,))
