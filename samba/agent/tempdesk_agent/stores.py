"""File backed stores: agent.json (keys), settings.json and the JSON lines
audit log."""

from __future__ import annotations

import base64
import copy
import json
import os
import secrets
import threading

from .auth import new_key
from .errors import bad
from .util import iso, utcnow

DATA_DIR = os.environ.get("TEMPDESK_DATA", "/var/lib/tempdesk")
DEFAULT_SETTINGS = os.environ.get("TEMPDESK_SETTINGS_TEMPLATE",
                                  os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                                               "settings.default.json"))


def write_private(path: str, data: bytes, mode: int = 0o600) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
    try:
        os.write(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def load_or_create_agent_config(data_dir: str = DATA_DIR) -> dict:
    path = os.path.join(data_dir, "agent.json")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            cfg = json.load(f)
    else:
        cfg = {}
    changed = False
    for k in ("guestKey", "adminKey"):
        if not cfg.get(k):
            cfg[k] = new_key()
            changed = True
    if not cfg.get("hmacSecret"):
        cfg["hmacSecret"] = base64.b64encode(secrets.token_bytes(32)).decode()
        changed = True
    cfg.setdefault("port", 8443)
    cfg.setdefault("certFile", os.path.join(data_dir, "agent-cert.pem"))
    cfg.setdefault("keyFile", os.path.join(data_dir, "private", "agent-key.pem"))
    if changed or not os.path.exists(path):
        write_private(path, (json.dumps(cfg, indent=2) + "\n").encode())
    return cfg


SETTINGS_SCHEMA = {
    "orgName": str, "welcomeText": str, "usernamePrefix": str, "guestOu": str, "guestGroup": str,
    "adminGroup": str, "guestGpoName": str, "computerGpoName": str, "computersOu": str,
    "expiryChoices": list, "allowPermanent": bool, "allowSelfDelete": bool, "passwordLength": int,
    "guestCreatePerHour": int, "guestMaxActive": int, "deleteProfileAfterMinutes": int,
    "logoffWarningMinutes": int, "reaperIntervalMinutes": int,
}


def validate_settings(doc) -> dict:
    if not isinstance(doc, dict):
        raise bad("settings must be an object")
    for k, t in SETTINGS_SCHEMA.items():
        if k in doc:
            v = doc[k]
            if t is int and (isinstance(v, bool) or not isinstance(v, int)):
                raise bad(f"{k} must be an integer")
            if t is not int and not isinstance(v, t):
                raise bad(f"{k} must be of type {t.__name__}")
    import re
    if "usernamePrefix" in doc and not re.match(r"^[A-Za-z0-9._-]{0,13}$", doc["usernamePrefix"]):
        raise bad("usernamePrefix must be at most 13 characters of letters, digits, dot, dash or underscore")
    if "passwordLength" in doc and not 12 <= doc["passwordLength"] <= 128:
        raise bad("passwordLength must be 12 to 128")
    if "reaperIntervalMinutes" in doc and doc["reaperIntervalMinutes"] < 1:
        raise bad("reaperIntervalMinutes must be at least 1")
    ids = set()
    for c in doc.get("expiryChoices", []):
        if not isinstance(c, dict) or not isinstance(c.get("id"), str) or not isinstance(c.get("label"), str) \
                or isinstance(c.get("minutes"), bool) or not isinstance(c.get("minutes"), int) or c["minutes"] < 0:
            raise bad("each expiryChoice needs id, label and minutes >= 0")
        if c["id"] in ids:
            raise bad("duplicate expiryChoice id")
        ids.add(c["id"])
    return doc


class SettingsStore:
    def __init__(self, path: str | None = None, template: str = DEFAULT_SETTINGS, initial: dict | None = None):
        self.path = path
        self._lock = threading.Lock()
        self._defaults = {}
        try:
            with open(template, "r", encoding="utf-8") as f:
                self._defaults = json.load(f)
        except OSError:
            pass
        if initial is not None:
            self._doc = copy.deepcopy(initial)
        elif path and os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                self._doc = json.load(f)
        else:
            self._doc = copy.deepcopy(self._defaults)
            if path:
                self._save()

    def _save(self):
        if self.path:
            write_private(self.path, (json.dumps(self._doc, indent=2) + "\n").encode(), 0o640)

    def get(self) -> dict:
        with self._lock:
            merged = copy.deepcopy(self._defaults)
            merged.update(copy.deepcopy(self._doc))
            return merged

    def put(self, doc: dict) -> dict:
        validate_settings(doc)
        with self._lock:
            self._doc = copy.deepcopy(doc)
            self._save()
        return self.get()


class AuditLog:
    MAX_BYTES = 20 * 1024 * 1024

    def __init__(self, path: str | None):
        self.path = path
        self._lock = threading.Lock()
        self._mem: list[dict] = []

    def write(self, **entry) -> None:
        entry = {"time": iso(utcnow()), **entry}
        line = json.dumps(entry, separators=(",", ":"), default=str)
        with self._lock:
            if not self.path:
                self._mem.append(entry)
                self._mem = self._mem[-5000:]
                return
            try:
                if os.path.exists(self.path) and os.path.getsize(self.path) > self.MAX_BYTES:
                    os.replace(self.path, self.path + ".1")
                fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o640)
                with os.fdopen(fd, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
            except OSError:
                pass

    def recent(self, limit: int = 200) -> list[dict]:
        limit = max(1, min(int(limit), 5000))
        with self._lock:
            if not self.path:
                return list(reversed(self._mem[-limit:]))
            try:
                with open(self.path, "rb") as f:
                    f.seek(0, os.SEEK_END)
                    size = f.tell()
                    f.seek(max(0, size - 4 * 1024 * 1024))
                    data = f.read()
            except OSError:
                return []
        out = []
        for raw in reversed(data.splitlines()):
            try:
                out.append(json.loads(raw))
            except ValueError:
                continue
            if len(out) >= limit:
                break
        return out
