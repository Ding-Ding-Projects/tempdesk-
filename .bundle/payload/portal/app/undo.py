"""Unlimited undo and redo, with every action committed to a Git repository.

Repository: PORTAL_DATA_DIR/history.git-work (created on first use). Each
state-changing admin action writes actions/<timestamp>-<id>.json and commits
it with the signed-in admin as author and "TempDesk" as committer. Undo and
redo write their own records and commits.

A record::

    {"id", "time", "user", "action", "target", "summary",
     "request": {"method","path","params","json"},      # redacted
     "before": ..., "after": ...,                         # redacted
     "inverse": {"method","path","params","json"} | {"kind": "...", ...} | null,
     "undoable": bool, "reason": "why not, when not undoable",
     "check": {"method","path","params","pick"} | null,  # read current state
     "status": "done" | "undone",
     "undoOf": id | null, "redoOf": id | null}

Conflict check: before an undo, the portal reads the current state with
``check`` and compares it with the recorded ``after``. If they differ the
undo is refused with an explanation.

Hooks for other modules (for example the Server area): call
``journal.record(...)`` after a successful change. Use ``Inverse`` helpers or
pass ``undoable=False, reason="..."``. Show ``describe_undo(...)`` text in the
confirmation dialog so the person knows before confirming.
"""

from __future__ import annotations

import copy
import json
import logging
import os
import re
import secrets
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

log = logging.getLogger("tempdesk.undo")

SECRET_KEYS = re.compile(r"(pass(word)?|pwd|secret|key|token|keymaterial|credential|unicodepwd|elevation)$", re.IGNORECASE)
REDACTED = "[redacted]"
NAME_RE = re.compile(r"^\d{17}-[0-9a-f]{8}$")


def redact(value: Any) -> Any:
    """Remove passwords, keys and tokens from any JSON-like value."""
    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            if isinstance(k, str) and SECRET_KEYS.search(k) and k not in ("valueName", "key_path"):
                # A registry "key" is a path, not a secret: keep it when it looks like one.
                if k == "key" and isinstance(v, str) and re.match(r"^(HK|Software\\|SOFTWARE\\)", v):
                    out[k] = v
                    continue
                out[k] = REDACTED if v not in (None, "") else v
            else:
                out[k] = redact(v)
        return out
    if isinstance(value, list):
        return [redact(v) for v in value]
    return value


class Journal:
    def __init__(self, data_dir: str | os.PathLike):
        self.root = Path(data_dir) / "history.git-work"
        self.actions = self.root / "actions"
        self._lock = threading.Lock()
        self._git_ok: bool | None = None
        self._cache: list[dict] | None = None

    # ------------------------------------------------------------ git
    def _git(self, *args: str, author: str | None = None) -> subprocess.CompletedProcess | None:
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": str(self.root),
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_COMMITTER_NAME": "TempDesk",
            "GIT_COMMITTER_EMAIL": "tempdesk@localhost",
            "GIT_AUTHOR_NAME": (author or "TempDesk")[:100],
            "GIT_AUTHOR_EMAIL": re.sub(r"[^A-Za-z0-9._-]", "_", (author or "tempdesk"))[:60] + "@tempdesk.local",
        }
        try:
            return subprocess.run(["git", *args], cwd=self.root, env=env, capture_output=True, text=True, timeout=30, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return None

    def ensure(self) -> bool:
        if self._git_ok is not None:
            return self._git_ok
        try:
            self.actions.mkdir(parents=True, exist_ok=True)
            os.chmod(self.root, 0o700)
        except OSError:
            self._git_ok = False
            return False
        if not (self.root / ".git").exists():
            r = self._git("init", "-q")
            if r is None or r.returncode != 0:
                log.warning("git is not available; undo history is kept as files only")
                self._git_ok = False
                return False
            self._git("config", "user.name", "TempDesk")
            self._git("config", "user.email", "tempdesk@localhost")
            self._git("config", "commit.gpgsign", "false")
        self._git_ok = True
        return True

    def repo_size(self) -> int:
        total = 0
        for dirpath, _dirs, files in os.walk(self.root):
            for f in files:
                try:
                    total += os.path.getsize(os.path.join(dirpath, f))
                except OSError:
                    pass
        return total

    def git_available(self) -> bool:
        self.ensure()
        return bool(self._git_ok)

    # ------------------------------------------------------------ records
    def _write(self, rec: dict, message: str) -> None:
        path = self.actions / f"{rec['id']}.json"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(rec, fh, indent=2, ensure_ascii=False, sort_keys=True, default=str)
        if self._git_ok:
            self._git("add", "--", f"actions/{rec['id']}.json")
            self._git("commit", "-q", "-m", message[:200], author=rec.get("user"))
        self._cache = None

    def record(self, *, user: str, action: str, target: str, summary: str, request: dict | None = None,
               before: Any = None, after: Any = None, inverse: dict | None = None, check: dict | None = None,
               undoable: bool = True, reason: str = "", undo_of: str | None = None, redo_of: str | None = None,
               redo: dict | None = None) -> dict:
        """Write and commit one action record. Secrets are removed first.
        Records are only bookkeeping: failures are logged, never raised."""
        with self._lock:
            self.ensure()
            rid = time.strftime("%Y%m%d%H%M%S", time.gmtime()) + f"{int(time.time() * 1000) % 1000:03d}-" + secrets.token_hex(4)
            rec = {
                "id": rid, "time": time.time(), "user": user, "action": action, "target": target, "summary": summary,
                "request": redact(request), "before": redact(copy.deepcopy(before)), "after": redact(copy.deepcopy(after)),
                "inverse": redact(inverse) if inverse else None, "check": check, "redo": redact(redo) if redo else redact(request),
                "undoable": bool(undoable and inverse), "reason": reason if not (undoable and inverse) else "",
                "status": "done", "undoOf": undo_of, "redoOf": redo_of,
            }
            if not rec["undoable"] and not rec["reason"]:
                rec["reason"] = "This action has no safe inverse."
            try:
                self._write(rec, f"{action}: {target}"[:200])
            except OSError:
                log.warning("could not write the undo record")
            return rec

    def mark(self, rid: str, status: str, user: str) -> None:
        with self._lock:
            rec = self.get(rid)
            if not rec:
                return
            rec["status"] = status
            try:
                self._write(rec, f"mark {status}: {rec.get('action')} {rec.get('target')}"[:200])
            except OSError:
                pass

    def get(self, rid: str) -> dict | None:
        if not NAME_RE.fullmatch(rid or ""):
            return None
        try:
            return json.loads((self.actions / f"{rid}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def all(self) -> list[dict]:
        if self._cache is not None:
            return self._cache
        out = []
        if self.actions.exists():
            for f in sorted(self.actions.glob("*.json")):
                try:
                    out.append(json.loads(f.read_text(encoding="utf-8")))
                except (OSError, ValueError):
                    continue
        self._cache = out
        return out

    def stack(self, user: str | None = None) -> tuple[dict | None, dict | None]:
        """Return (next to undo, next to redo) for the Undo / Redo buttons."""
        recs = [r for r in self.all() if not user or r.get("user") == user]
        undo = next((r for r in reversed(recs) if r.get("status") == "done" and r.get("undoable") and not r.get("undoOf")), None)
        redo = None
        for r in reversed(recs):
            if r.get("undoOf") and r.get("status") == "done":
                orig = self.get(r["undoOf"])
                if orig and orig.get("status") == "undone":
                    redo = orig
                break
            if r.get("status") == "done" and not r.get("undoOf"):
                break
        return undo, redo

    def dependents(self, rec: dict) -> list[dict]:
        """Later, still-active records on the same target."""
        return [r for r in self.all() if r["id"] > rec["id"] and r.get("target") == rec.get("target")
                and r.get("status") == "done" and not r.get("undoOf") and r["id"] != rec["id"]]


def pick(value: Any, path: str | None) -> Any:
    if not path:
        return value
    cur = value
    for part in path.split("."):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit():
            cur = cur[int(part)] if int(part) < len(cur) else None
        else:
            return None
    return cur


def normalize(v: Any) -> Any:
    """Compare states ignoring ordering of lists and redaction markers."""
    if isinstance(v, dict):
        return {k: normalize(x) for k, x in sorted(v.items()) if x != REDACTED}
    if isinstance(v, list):
        try:
            return sorted((normalize(x) for x in v), key=lambda x: json.dumps(x, sort_keys=True, default=str))
        except TypeError:
            return [normalize(x) for x in v]
    return v


def describe_undo(undoable: bool, reason: str = "") -> str:
    return "You can undo this afterwards." if undoable else ("This cannot be undone. " + reason).strip()
