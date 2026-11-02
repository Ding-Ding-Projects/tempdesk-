"""Personal wording: an optional admin-supplied vocabulary for UI copy.

The file replaces ordinary phrases in interface text only (labels, headings,
buttons, help, notifications, titles). It is never applied to data values and
never on pages shown before an administrator signs in.

Privacy rules: the file content is never logged, exported, or echoed in error
messages. Validation errors name positions (entry numbers), never the text.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
import unicodedata
from pathlib import Path

log = logging.getLogger("tempdesk.wording")

MAX_BYTES = 256 * 1024
MAX_DEPTH = 8
MAX_KEY = 160
MAX_VALUE = 1000
FORBIDDEN_KEYS = {"__proto__", "prototype", "constructor"}
FILE_NAME = "personal-wording.json"
HEADLINE_KEY = "private vocabulary"
DEFAULT_HEADLINE = "Personal wording applied"


class WordingError(ValueError):
    """Validation failure. The message never contains file content."""


class _DuplicateKey(Exception):
    pass


def _pairs_hook(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise _DuplicateKey()
        out[k] = v
    return out


def _max_depth(text: str) -> int:
    """Nesting depth of JSON text, counted without parsing (strings skipped)."""
    depth = best = 0
    in_str = esc = False
    for ch in text:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch in "[{":
            depth += 1
            if depth > best:
                best = depth
                if best > MAX_DEPTH:
                    return best
        elif ch in "]}":
            depth -= 1
    return best


def _bad_chars(s: str, allow_ws: bool) -> bool:
    for ch in s:
        if unicodedata.category(ch) == "Cc":
            if allow_ws and ch in "\t\n\r":
                continue
            return True
    return False


def validate(raw: bytes) -> dict[str, str]:
    """Validate the whole file. Returns the entries or raises WordingError."""
    if not isinstance(raw, (bytes, bytearray)):
        raise WordingError("The file could not be read.")
    if len(raw) == 0:
        raise WordingError("The file is empty.")
    if len(raw) > MAX_BYTES:
        raise WordingError("The file is larger than 256 KiB.")
    try:
        text = bytes(raw).decode("utf-8")
    except UnicodeDecodeError:
        raise WordingError("The file is not valid UTF-8 text.") from None
    if text.startswith("﻿"):
        text = text[1:]
    if _max_depth(text) > MAX_DEPTH:
        raise WordingError("The JSON is nested more than 8 levels deep.")
    try:
        doc = json.loads(text, object_pairs_hook=_pairs_hook)
    except _DuplicateKey:
        raise WordingError("The file contains a duplicate key.") from None
    except (ValueError, RecursionError):
        raise WordingError("The file is not valid JSON.") from None
    if not isinstance(doc, dict):
        raise WordingError("The top level must be a JSON object.")
    extra = set(doc) - {"schemaVersion", "entries"}
    if extra:
        raise WordingError("Only the properties schemaVersion and entries are allowed at the top level.")
    ver = doc.get("schemaVersion")
    if isinstance(ver, bool) or not isinstance(ver, int) or ver != 1:
        raise WordingError("schemaVersion must be the number 1.")
    entries = doc.get("entries")
    if not isinstance(entries, dict):
        raise WordingError("entries must be a JSON object of phrase to replacement.")
    clean: dict[str, str] = {}
    for n, (key, value) in enumerate(entries.items(), start=1):
        if not isinstance(key, str) or not (1 <= len(key) <= MAX_KEY):
            raise WordingError(f"Entry {n}: the phrase must be 1 to {MAX_KEY} characters.")
        if not key.strip():
            raise WordingError(f"Entry {n}: the phrase is blank.")
        if key in FORBIDDEN_KEYS:
            raise WordingError(f"Entry {n}: this phrase is a reserved name and is not allowed.")
        if _bad_chars(key, allow_ws=False):
            raise WordingError(f"Entry {n}: the phrase contains control characters.")
        if not isinstance(value, str):
            raise WordingError(f"Entry {n}: the replacement must be text.")
        if len(value) > MAX_VALUE:
            raise WordingError(f"Entry {n}: the replacement is longer than {MAX_VALUE} characters.")
        if _bad_chars(value, allow_ws=True):
            raise WordingError(f"Entry {n}: the replacement contains control characters.")
        clean[key] = value
    return clean


def headline_for(entries: dict[str, str]) -> str:
    v = entries.get(HEADLINE_KEY)
    return v if isinstance(v, str) and v.strip() else DEFAULT_HEADLINE


def _match_case(src: str, repl: str) -> str:
    if not repl:
        return repl
    if len(src) > 1 and src.isupper() and any(c.isalpha() for c in src):
        return repl.upper()
    if src[:1].isupper() and repl[:1].islower():
        return repl[:1].upper() + repl[1:]
    return repl


def build_translator(entries: dict[str, str]):
    """Return a function that applies *entries* to UI text in one pass."""
    if not entries:
        return _identity
    exact = dict(entries)
    folded: dict[str, str] = {}
    for k in sorted(entries, key=len, reverse=True):
        folded.setdefault(k.casefold(), entries[k])
    alts = "|".join(re.escape(k) for k in sorted(entries, key=len, reverse=True))
    pattern = re.compile(r"(?<!\w)(?:" + alts + r")(?!\w)", re.IGNORECASE)

    def repl(m: re.Match) -> str:
        src = m.group(0)
        if src in exact:
            return exact[src]
        rep = folded.get(src.casefold())
        return src if rep is None else _match_case(src, rep)

    def translate(text) -> str:
        if text is None:
            return ""
        return pattern.sub(repl, str(text))

    return translate


def _identity(text) -> str:
    return "" if text is None else str(text)


identity = _identity


class Vocabulary:
    def __init__(self, data_dir: str | os.PathLike):
        self.dir = Path(data_dir)
        self.path = self.dir / FILE_NAME
        self._lock = threading.Lock()
        self._entries: dict[str, str] = {}
        self._translator = _identity
        self.updated: float | None = None
        self.load_error = False
        self.load()

    def load(self) -> None:
        with self._lock:
            self._entries, self._translator, self.updated, self.load_error = {}, _identity, None, False
            try:
                raw = self.path.read_bytes()
            except FileNotFoundError:
                return
            except OSError:
                log.warning("personal wording file could not be read; using ordinary wording")
                self.load_error = True
                return
            try:
                entries = validate(raw)
            except WordingError:
                log.warning("personal wording file failed validation; using ordinary wording")
                self.load_error = True
                return
            self._entries = entries
            self._translator = build_translator(entries)
            try:
                self.updated = self.path.stat().st_mtime
            except OSError:
                self.updated = time.time()

    def apply(self, raw: bytes) -> dict[str, str]:
        """Validate then store. Nothing changes unless validation passes."""
        entries = validate(raw)
        translator = build_translator(entries)
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.dir / f".{FILE_NAME}.{os.getpid()}.tmp"
        try:
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(bytes(raw))
                fh.flush()
                os.fsync(fh.fileno())
            os.chmod(tmp, 0o600)
            os.replace(tmp, self.path)
        except OSError:
            try:
                tmp.unlink()
            except OSError:
                pass
            raise WordingError("The file could not be saved on the server (check the data volume).") from None
        with self._lock:
            self._entries = entries
            self._translator = translator
            self.updated = time.time()
            self.load_error = False
        return entries

    def clear(self) -> None:
        with self._lock:
            try:
                self.path.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                raise WordingError("The file could not be removed from the server.") from None
            self._entries, self._translator, self.updated, self.load_error = {}, _identity, None, False

    @property
    def count(self) -> int:
        return len(self._entries)

    def translator(self):
        return self._translator
