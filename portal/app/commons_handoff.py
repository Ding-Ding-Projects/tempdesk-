"""Per-checkout browser handoffs for a Virtual Commons connection file."""

from __future__ import annotations

import base64
import binascii
from datetime import datetime
import json
import re
import secrets
import time

from fastapi import Request, Response

from .web import set_cookie

CONFIRM_COOKIE = "td_commons_once"
DOWNLOAD_COOKIE = "td_commons_download"
HANDOFF_SECONDS = 600
RDP_FILENAME = "Virtual-Commons.rdp"
REFERENCE = re.compile(r"[A-Za-z0-9_-]{24}")


def new_reference() -> str:
    return secrets.token_urlsafe(18)


def confirmation_path(reference: str) -> str:
    return f"/created/{reference}"


def download_path(reference: str) -> str:
    return f"{confirmation_path(reference)}/virtual-commons.rdp"


def download_deadline(expires_at) -> int:
    ceiling = int(time.time()) + HANDOFF_SECONDS
    if expires_at is None:
        return ceiling
    try:
        expires = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        return min(ceiling, int(expires.timestamp())) if expires.tzinfo else 0
    except (AttributeError, ValueError, OverflowError, OSError):
        return 0


def _binding(name: str, path: str) -> bytes:
    return f"tempdesk-commons:{name}:{path}".encode("ascii")


def set_handoff(request: Request, response: Response, name: str, path: str, payload: dict, deadline: int) -> None:
    encoded = json.dumps({"expires": deadline, "payload": payload}).encode("utf-8")
    sealed = request.app.state.db.seal(encoded, _binding(name, path))
    cookie = base64.urlsafe_b64encode(sealed).decode("ascii")
    set_cookie(request, response, name, cookie, max_age=max(0, deadline - int(time.time())), path=path)


def read_handoff(request: Request, name: str, path: str) -> dict:
    cookie = request.cookies.get(name, "")
    if not cookie or len(cookie) > 2048:
        return {}
    try:
        sealed = base64.b64decode(cookie, altchars=b"-_", validate=True)
    except (binascii.Error, ValueError):
        return {}
    raw = request.app.state.db.open(sealed, _binding(name, path))
    if raw is None:
        return {}
    try:
        grant = json.loads(raw)
    except (UnicodeError, ValueError):
        return {}
    if not isinstance(grant, dict) or type(grant.get("expires")) is not int or grant["expires"] <= time.time():
        return {}
    payload = grant.get("payload")
    return payload if isinstance(payload, dict) else {}


def rdp_file(target: str, username: str, *, restricted: bool = False) -> bytes:
    authentication = 1 if restricted else 2
    profile = (f"full address:s:{target}\r\nusername:s:{username}\r\n"
               f"prompt for credentials:i:1\r\nauthentication level:i:{authentication}\r\n"
               "enablecredsspsupport:i:1\r\n")
    if restricted:
        profile += "redirectclipboard:i:0\r\nredirectprinters:i:0\r\ndrivestoredirect:s:\r\n"
    return profile.encode("utf-16")
