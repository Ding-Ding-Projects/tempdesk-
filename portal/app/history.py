"""Server-side version history for settings and scripts.

Stored under PORTAL_DATA_DIR/history/<kind>/<safe name>/<timestamp>-<id>.json,
each file mode 600, with {"time","user","content"}. The diff is computed when
viewed. At most MAX_VERSIONS are kept per item.
"""

from __future__ import annotations

import difflib
import json
import os
import re
import secrets
import time
from pathlib import Path

MAX_VERSIONS = 50
SAFE = re.compile(r"[^A-Za-z0-9._-]")


class History:
    def __init__(self, data_dir: str | os.PathLike):
        self.root = Path(data_dir) / "history"

    def _dir(self, kind: str, name: str) -> Path:
        return self.root / SAFE.sub("_", kind)[:32] / (SAFE.sub("_", name)[:96] or "_")

    def record(self, kind: str, name: str, content: str, user: str) -> str | None:
        d = self._dir(kind, name)
        try:
            d.mkdir(parents=True, exist_ok=True)
            latest = self.list(kind, name)[:1]
            if latest and self.get(kind, name, latest[0]["id"]).get("content") == content:
                return latest[0]["id"]
            vid = f"{int(time.time() * 1000):015d}-{secrets.token_hex(3)}"
            fd = os.open(d / f"{vid}.json", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump({"time": time.time(), "user": user, "content": content}, fh)
            files = sorted(d.glob("*.json"), reverse=True)
            for old in files[MAX_VERSIONS:]:
                old.unlink(missing_ok=True)
            return vid
        except OSError:
            return None

    def list(self, kind: str, name: str) -> list[dict]:
        d = self._dir(kind, name)
        out = []
        for f in sorted(d.glob("*.json"), reverse=True) if d.exists() else []:
            try:
                meta = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            out.append({"id": f.stem, "time": meta.get("time"), "user": meta.get("user", ""),
                        "size": len(meta.get("content") or "")})
        return out

    def get(self, kind: str, name: str, vid: str) -> dict:
        if not re.fullmatch(r"\d{15}-[0-9a-f]{6}", vid or ""):
            return {}
        try:
            return json.loads((self._dir(kind, name) / f"{vid}.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}


def diff(old: str, new: str, old_label: str = "selected version", new_label: str = "current") -> list[tuple[str, str]]:
    """Unified diff as (kind, line) pairs, kind in add|del|hunk|ctx."""
    out = []
    for ln in difflib.unified_diff(old.splitlines(), new.splitlines(), old_label, new_label, lineterm="", n=3):
        if ln.startswith(("---", "+++")):
            continue
        kind = "hunk" if ln.startswith("@@") else "add" if ln.startswith("+") else "del" if ln.startswith("-") else "ctx"
        out.append((kind, ln))
    return out


def settings_text(doc: dict) -> str:
    return json.dumps(doc, indent=2, ensure_ascii=False, sort_keys=True)
