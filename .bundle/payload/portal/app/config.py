"""Portal configuration, read from environment variables."""

from __future__ import annotations

import ipaddress
import os
import secrets
from dataclasses import dataclass, field


class ConfigError(RuntimeError):
    """Raised when the environment does not describe a usable portal."""


def _int(env: dict, name: str, default: int) -> int:
    raw = env.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be a whole number") from exc


def _parse_proxies(raw: str) -> list:
    nets = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            nets.append(ipaddress.ip_network(part, strict=False))
        except ValueError as exc:
            raise ConfigError(f"TRUSTED_PROXY entry {part!r} is not an IP address or network") from exc
    return nets


@dataclass
class Settings:
    mode: str = "guest"
    agent_url: str = "http://localhost:8080/api/v1"
    agent_key: str = ""
    agent_ca_file: str | None = None
    agent_cert_sha256: str | None = None
    agent_timeout: float = 20.0
    session_secret: str = ""
    port: int = 8080
    trusted_proxies: list = field(default_factory=list)
    cookie_secure: str = "auto"  # auto | true | false
    create_limit: int = 10
    create_window_seconds: int = 600
    lookup_limit: int = 20
    lookup_window_seconds: int = 600
    login_limit: int = 10
    login_window_seconds: int = 600
    health_cache_seconds: int = 30
    tls_cert_file: str | None = None
    tls_key_file: str | None = None
    data_dir: str = "/data"
    state_dir: str = ""

    @property
    def agent_plain_http(self) -> bool:
        return self.agent_url.startswith("http://")

    @property
    def is_admin(self) -> bool:
        return self.mode == "admin"

    @classmethod
    def from_env(cls, env: dict | None = None) -> "Settings":
        env = dict(os.environ if env is None else env)
        mode = (env.get("PORTAL_MODE") or "guest").strip().lower()
        if mode not in ("guest", "admin"):
            raise ConfigError("PORTAL_MODE must be 'guest' or 'admin'")
        agent_url = (env.get("AGENT_URL") or "").strip().rstrip("/")
        if not agent_url:
            raise ConfigError("AGENT_URL is required, for example http://dc01.corp.example:8080")
        if not agent_url.startswith(("http://", "https://")):
            raise ConfigError("AGENT_URL must start with http:// or https://")
        if not agent_url.endswith("/api/v1"):
            agent_url += "/api/v1"
        key = (env.get("AGENT_KEY") or "").strip()
        if not key:
            raise ConfigError("AGENT_KEY is required")
        ca_file = (env.get("AGENT_CA_FILE") or "").strip() or None
        pin = (env.get("AGENT_CERT_SHA256") or "").strip().replace(":", "").lower() or None
        if pin is not None and (len(pin) != 64 or any(c not in "0123456789abcdef" for c in pin)):
            raise ConfigError("AGENT_CERT_SHA256 must be 64 hex characters (colons allowed)")
        if agent_url.startswith("https://") and not ca_file and not pin:
            raise ConfigError("AGENT_URL uses https: set AGENT_CA_FILE or AGENT_CERT_SHA256 so the portal can trust the agent certificate")
        if agent_url.startswith("http://"):
            ca_file = pin = None  # only used for https
        secret = env.get("SESSION_SECRET") or ""
        if mode == "admin":
            if len(secret) < 32:
                raise ConfigError("SESSION_SECRET is required in admin mode (at least 32 characters)")
        elif not secret:
            # Guest mode only signs short-lived CSRF tokens; a per-process secret is fine.
            secret = secrets.token_urlsafe(48)
        cookie_secure = (env.get("COOKIE_SECURE") or "auto").lower()
        if cookie_secure not in ("auto", "true", "false"):
            raise ConfigError("COOKIE_SECURE must be auto, true or false")
        return cls(
            mode=mode,
            agent_url=agent_url,
            agent_key=key,
            agent_ca_file=ca_file,
            agent_cert_sha256=pin,
            agent_timeout=float(env.get("AGENT_TIMEOUT") or 20),
            session_secret=secret,
            port=_int(env, "PORT", 8081 if mode == "admin" else 8080),
            trusted_proxies=_parse_proxies(env.get("TRUSTED_PROXY") or ""),
            cookie_secure=cookie_secure,
            create_limit=_int(env, "GUEST_CREATE_LIMIT", 10),
            create_window_seconds=_int(env, "GUEST_CREATE_WINDOW_SECONDS", 600),
            lookup_limit=_int(env, "GUEST_LOOKUP_LIMIT", 20),
            lookup_window_seconds=_int(env, "GUEST_LOOKUP_WINDOW_SECONDS", 600),
            login_limit=_int(env, "ADMIN_LOGIN_LIMIT", 10),
            login_window_seconds=_int(env, "ADMIN_LOGIN_WINDOW_SECONDS", 600),
            health_cache_seconds=_int(env, "HEALTH_CACHE_SECONDS", 30),
            tls_cert_file=(env.get("TLS_CERT_FILE") or "").strip() or None,
            tls_key_file=(env.get("TLS_KEY_FILE") or "").strip() or None,
            data_dir=(env.get("PORTAL_DATA_DIR") or "/data").strip(),
            state_dir=(env.get("PORTAL_STATE_DIR") or env.get("PORTAL_DATA_DIR") or "/data").strip(),
        )
