"""HTTPS client for the TempDesk Agent API.

Plain HTTP is the default (owner decision). For https URLs:
  * AGENT_CA_FILE: the agent's exported certificate (PEM or DER). DER is
    converted to PEM in memory at startup. The certificate is the only trust
    anchor; hostname checking stays on.
  * AGENT_CERT_SHA256: a SHA-256 fingerprint pin. A custom network backend
    checks the peer certificate right after the TLS handshake, before any
    request bytes (and therefore before the API key) are sent.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import ssl
import time
from typing import Any

import httpcore
import httpx

from .config import Settings

log = logging.getLogger("tempdesk.agent")


class AgentError(Exception):
    """The agent answered with a non-2xx status. Typed by .code (the API error
    code), .status (HTTP status) and .message (human text from the agent)."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(f"{status} {code}: {message}")
        self.status = status
        self.code = code
        self.message = message


class AgentUnavailable(Exception):
    """The agent could not be reached or its certificate was not trusted."""


class PinMismatch(ssl.SSLError):  # noqa: N818
    pass


def load_ca_pem(path: str) -> str:
    """Return PEM text for the certificate at *path*, converting DER if needed."""
    with open(path, "rb") as fh:
        raw = fh.read()
    if b"-----BEGIN CERTIFICATE-----" in raw:
        return raw.decode("ascii", errors="ignore")
    text = raw.strip()
    # A base64 body without the PEM armour (some exports look like this).
    try:
        import base64

        der = base64.b64decode(text, validate=True)
        if der[:1] == b"\x30":
            return ssl.DER_cert_to_PEM_cert(der)
    except Exception:  # noqa: BLE001 - fall through to DER
        pass
    return ssl.DER_cert_to_PEM_cert(raw)


def _ca_context(pem: str) -> ssl.SSLContext:
    ctx = ssl.create_default_context(cadata=pem)
    # The agent certificate is a self-signed leaf. Allow it as a trust anchor
    # and do not demand CA-only extensions that a leaf certificate lacks.
    ctx.verify_flags &= ~getattr(ssl, "VERIFY_X509_STRICT", 0)
    ctx.verify_flags |= getattr(ssl, "VERIFY_X509_PARTIAL_CHAIN", 0)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    return ctx


def _pin_context() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # replaced by the fingerprint check below
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    return ctx


class _PinnedStream(httpcore.AsyncNetworkStream):
    def __init__(self, inner: httpcore.AsyncNetworkStream, pin: str):
        self._inner = inner
        self._pin = pin

    async def read(self, max_bytes, timeout=None):
        return await self._inner.read(max_bytes, timeout)

    async def write(self, buffer, timeout=None):
        await self._inner.write(buffer, timeout)

    async def aclose(self):
        await self._inner.aclose()

    def get_extra_info(self, info):
        return self._inner.get_extra_info(info)

    async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        tls = await self._inner.start_tls(ssl_context, server_hostname, timeout)
        ssl_obj = tls.get_extra_info("ssl_object")
        der = ssl_obj.getpeercert(binary_form=True) if ssl_obj else None
        got = hashlib.sha256(der).hexdigest() if der else ""
        if not hmac.compare_digest(got, self._pin):
            await tls.aclose()
            raise PinMismatch("agent certificate fingerprint does not match AGENT_CERT_SHA256")
        return _PinnedStream(tls, self._pin)


class PinningBackend(httpcore.AsyncNetworkBackend):
    def __init__(self, pin: str):
        self._pin = pin
        self._backend = httpcore.AnyIOBackend()

    async def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        stream = await self._backend.connect_tcp(host, port, timeout, local_address, socket_options)
        return _PinnedStream(stream, self._pin)

    async def connect_unix_socket(self, path, timeout=None, socket_options=None):  # pragma: no cover
        raise OSError("unix sockets are not used")

    async def sleep(self, seconds):
        await self._backend.sleep(seconds)


def build_transport(settings: Settings) -> httpx.AsyncBaseTransport:
    if settings.agent_url.startswith("http://"):
        return httpx.AsyncHTTPTransport(retries=0)
    if settings.agent_cert_sha256:
        ctx = _pin_context()
        transport = httpx.AsyncHTTPTransport(verify=ctx, retries=0)
        # Swap in a pool that uses the pinning backend. httpx is pinned in
        # requirements.txt, so this internal attribute is stable for us.
        transport._pool = httpcore.AsyncConnectionPool(
            ssl_context=ctx,
            max_connections=20,
            max_keepalive_connections=10,
            keepalive_expiry=30,
            network_backend=PinningBackend(settings.agent_cert_sha256),
        )
        return transport
    pem = load_ca_pem(settings.agent_ca_file or "")
    return httpx.AsyncHTTPTransport(verify=_ca_context(pem), retries=0)


class AgentClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.agent_url,
            transport=transport or build_transport(settings),
            timeout=settings.agent_timeout,
            trust_env=False,  # never route agent traffic through an env proxy
            headers={"X-TempDesk-Key": settings.agent_key, "Accept": "application/json"},
            follow_redirects=False,
        )
        self._health: dict | None = None
        self._health_at = 0.0

    async def aclose(self) -> None:
        await self._client.aclose()

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict | None = None,
        json: Any = None,
        data: Any = None,
        files: Any = None,
        elevation: str | None = None,
        token: str | None = None,
        client_ip: str | None = None,
        headers: dict | None = None,
        timeout: float | None = None,
    ) -> httpx.Response:
        """Send one request and return the httpx.Response.

        Raises AgentUnavailable when the agent cannot be reached and
        AgentError for any non-2xx answer."""
        hdrs = dict(headers or {})
        if token:
            hdrs["Authorization"] = f"Bearer {token}"
        if elevation:
            hdrs["X-TempDesk-Elevation"] = elevation
        if client_ip:
            hdrs["X-Forwarded-For"] = client_ip
        if params:
            params = {k: v for k, v in params.items() if v is not None and v != ""}
        kw: dict = {"params": params, "headers": hdrs}
        if json is not None:
            kw["json"] = json
        if data is not None:
            kw["data"] = data
        if files is not None:
            kw["files"] = files
        if timeout is not None:
            kw["timeout"] = timeout
        try:
            resp = await self._client.request(method, path, **kw)
        except (httpx.TransportError, ssl.SSLError, OSError) as exc:
            # Never log request bodies: they may hold passwords.
            log.warning("agent unreachable: %s %s (%s)", method, path, type(exc).__name__)
            raise AgentUnavailable(type(exc).__name__) from exc
        if resp.status_code >= 400:
            code, message = "internal", resp.reason_phrase or "Agent error"
            try:
                body = resp.json()
                if isinstance(body, dict):
                    code = str(body.get("error") or code)
                    message = str(body.get("message") or message)
            except Exception:  # noqa: BLE001
                pass
            raise AgentError(resp.status_code, code, message)
        return resp

    async def call(self, method: str, path: str, **kw) -> Any:
        """Like request() but returns parsed JSON (or text, or None for 204)."""
        resp = await self.request(method, path, **kw)
        if resp.status_code == 204 or not resp.content:
            return None
        if "json" in resp.headers.get("content-type", ""):
            return resp.json()
        return resp.text

    async def get(self, path, **kw):
        return await self.call("GET", path, **kw)

    async def post(self, path, **kw):
        return await self.call("POST", path, **kw)

    async def put(self, path, **kw):
        return await self.call("PUT", path, **kw)

    async def patch(self, path, **kw):
        return await self.call("PATCH", path, **kw)

    async def delete(self, path, **kw):
        return await self.call("DELETE", path, **kw)

    async def health(self, force: bool = False) -> dict | None:
        """Cached /health. Returns None when the agent cannot be reached."""
        now = time.monotonic()
        if not force and self._health is not None and now - self._health_at < self.settings.health_cache_seconds:
            return self._health
        try:
            data = await self.get("/health")
            self._health = data if isinstance(data, dict) else None
        except (AgentUnavailable, AgentError):
            self._health = None
        self._health_at = now
        return self._health
