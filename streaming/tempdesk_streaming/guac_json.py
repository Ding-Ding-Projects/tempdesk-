"""Signed and encrypted payloads for the Guacamole "Encrypted JSON" auth extension.

Format, per the guacamole-auth-json documentation (1.5.x and 1.6.x):

1. JSON: {"username": str, "expires": epoch millis, "connections": {name: {"protocol", "parameters"}}}
2. sig = HMAC-SHA256(key, json_bytes); plaintext = sig (32 bytes) + json_bytes
3. AES-128-CBC, IV of 16 zero bytes, PKCS7 padding
4. base64 (standard alphabet, with padding)

The key is the 128-bit JSON_SECRET_KEY given as 32 hex digits.

Login flow for the portal:

    url, form = tokens_request(GUAC_URL, payload)
    r = httpx.post(url, data=form)          # application/x-www-form-urlencoded
    token = r.json()["authToken"]
    browser_url = client_url(GUAC_URL, connection_name, token)

The payload is short lived (2 minutes by default) because it is only used for
that one POST. The Guacamole session that follows has its own lifetime.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import time
from typing import Any, Mapping
from urllib.parse import quote

from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from .catalog import App

DEFAULT_LIFETIME_SECONDS = 120
DATA_SOURCE = "json"
_KEY_RE = re.compile(r"^[0-9A-Fa-f]{32}$")
_ZERO_IV = b"\x00" * 16


def parse_key(hex_key: str) -> bytes:
    """Turn the 32 hex digit JSON_SECRET_KEY into 16 raw bytes."""
    if not isinstance(hex_key, str) or not _KEY_RE.match(hex_key.strip()):
        raise ValueError("JSON secret key must be exactly 32 hexadecimal digits (128 bits)")
    return bytes.fromhex(hex_key.strip())


def _bool(v: bool) -> str:
    return "true" if v else "false"


def rdp_parameters(
    app: App,
    *,
    username: str,
    password: str,
    domain: str = "",
    extra: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Guacamole RDP connection parameters for one RemoteApp launch.

    All values are strings, as Guacamole expects. `extra` can override or add
    parameters (for example "server-layout" or "timezone").
    """
    params: dict[str, str] = {
        "hostname": app.host,
        "port": str(app.port),
        "username": username,
        "password": password,
        "security": app.rdpSecurity,
        "ignore-cert": _bool(app.ignoreCert),
        "remote-app": app.remote_app,
        "resize-method": app.resizeMethod,
        "enable-wallpaper": "false",
        "disable-audio": "false",
        "enable-printing": _bool(app.enablePrinting),
        "enable-drive": "false",
        "disable-copy": _bool(app.disableCopy),
        "disable-paste": _bool(app.disablePaste),
    }
    if domain:
        params["domain"] = domain
    if app.workingDir:
        params["remote-app-dir"] = app.workingDir
    if app.arguments:
        params["remote-app-args"] = app.arguments
    if not app.resizeMethod:
        del params["resize-method"]
    if extra:
        params.update({str(k): str(v) for k, v in extra.items()})
    return params


def build_auth_json(
    username: str,
    connections: Mapping[str, Mapping[str, Any]],
    *,
    lifetime_seconds: int = DEFAULT_LIFETIME_SECONDS,
    now: float | None = None,
) -> dict[str, Any]:
    """Build the plain (not yet encrypted) JSON auth document.

    `connections` maps a connection name to {"protocol": ..., "parameters": {...}}.
    """
    if lifetime_seconds <= 0:
        raise ValueError("lifetime_seconds must be positive")
    if not connections:
        raise ValueError("at least one connection is required")
    for name, conn in connections.items():
        if not name or "\x00" in name:
            raise ValueError("connection names must be non-empty and contain no NUL")
        if "protocol" not in conn or "parameters" not in conn:
            raise ValueError(f"connection {name!r} needs protocol and parameters")
    t = time.time() if now is None else now
    return {
        "username": username,
        "expires": int((t + lifetime_seconds) * 1000),
        "connections": {
            name: {"protocol": conn["protocol"], "parameters": dict(conn["parameters"])}
            for name, conn in connections.items()
        },
    }


def encrypt_auth_json(document: Mapping[str, Any], hex_key: str) -> str:
    """Sign, encrypt and base64 encode a JSON auth document."""
    key = parse_key(hex_key)
    body = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    signature = hmac.new(key, body, hashlib.sha256).digest()
    padder = padding.PKCS7(128).padder()
    plain = padder.update(signature + body) + padder.finalize()
    enc = Cipher(algorithms.AES(key), modes.CBC(_ZERO_IV)).encryptor()
    return base64.b64encode(enc.update(plain) + enc.finalize()).decode("ascii")


def connection_name(app: App) -> str:
    """The connection name shown in the Guacamole tab title."""
    return app.name


def build_app_payload(
    app: App,
    *,
    username: str,
    password: str,
    domain: str,
    hex_key: str,
    lifetime_seconds: int = DEFAULT_LIFETIME_SECONDS,
    now: float | None = None,
    extra_parameters: Mapping[str, str] | None = None,
) -> tuple[str, str]:
    """Encrypted payload for launching one app. Returns (payload, connection name).

    The caller must check `app.allowed_for(user_groups)` before calling this.
    """
    if not app.enabled:
        raise ValueError(f"app {app.id!r} is disabled")
    name = connection_name(app)
    doc = build_auth_json(
        username,
        {name: {"protocol": "rdp", "parameters": rdp_parameters(
            app, username=username, password=password, domain=domain, extra=extra_parameters)}},
        lifetime_seconds=lifetime_seconds,
        now=now,
    )
    return encrypt_auth_json(doc, hex_key), name


# ------------------------------------------------------------------ URLs
def _base(guac_url: str) -> str:
    return guac_url.rstrip("/")


def tokens_request(guac_url: str, payload: str) -> tuple[str, dict[str, str]]:
    """(URL, form fields) for POST {GUAC_URL}/api/tokens.

    Send the form as application/x-www-form-urlencoded; the HTTP client
    URL-encodes the "+", "/" and "=" in the base64 payload. The JSON reply
    contains "authToken" and "dataSource" ("json").
    """
    return f"{_base(guac_url)}/api/tokens", {"data": payload}


def client_identifier(name: str, type_: str = "c", data_source: str = DATA_SOURCE) -> str:
    """Guacamole client identifier: base64(name + NUL + type + NUL + dataSource).

    type "c" is a connection, "g" a balancing group. This is the same encoding
    the Guacamole web app uses (window.btoa of the NUL-joined parts, on UTF-8).
    """
    raw = "\x00".join((name, type_, data_source)).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def client_url(guac_url: str, name: str, auth_token: str, data_source: str = DATA_SOURCE) -> str:
    """Browser URL that opens the connection with an existing auth token.

    The identifier is percent-encoded so "/" or "+" from base64 cannot break
    the route; Angular decodes route parameters before Guacamole reads them.
    """
    ident = quote(client_identifier(name, "c", data_source), safe="")
    return f"{_base(guac_url)}/#/client/{ident}?token={quote(auth_token, safe='')}"
