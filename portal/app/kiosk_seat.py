"""Authorization and reservation for a dedicated single-user RDP workstation."""

from __future__ import annotations

import asyncio
import json
import ssl
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from urllib.parse import urlsplit

import httpx


class KioskSeatUnavailable(RuntimeError):
    """The configured workstation cannot prove the requested seat operation."""


def parse_expiry(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        expiry = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, OverflowError):
        return None
    return expiry if expiry.tzinfo is not None else None


@dataclass(frozen=True)
class KioskSeatBroker:
    url: str
    key_file: str
    ca_file: str | None

    @classmethod
    def configured(cls, settings) -> KioskSeatBroker | None:
        if not (settings.commons_rdp_kiosk and settings.commons_kiosk_broker_url
                and settings.commons_kiosk_broker_key_file):
            return None
        raw = settings.commons_kiosk_broker_url.rstrip("/")
        try:
            address = urlsplit(raw)
            port = address.port
        except ValueError:
            return None
        if (address.scheme != "https" or not address.hostname or address.username is not None
                or address.password is not None or address.query or address.fragment
                or address.path or port == 0 or any(ch.isspace() for ch in raw)):
            return None
        return cls(raw, settings.commons_kiosk_broker_key_file, settings.commons_kiosk_broker_ca_file)

    async def _call(self, method: str, route: str, payload: dict | None = None) -> dict:
        try:
            with Path(self.key_file).open(encoding="utf-8") as key_stream:
                key = key_stream.read(4097).strip()
            if not key or len(key) > 4096 or "\r" in key or "\n" in key or not key.isascii():
                raise KioskSeatUnavailable
            trust = ssl.create_default_context(cafile=self.ca_file)
            budget = 35 if route == "/seat/assign" else 15
            timeout = httpx.Timeout(budget, connect=3, write=3, pool=3)
            async with asyncio.timeout(budget), httpx.AsyncClient(
                    verify=trust, timeout=timeout, follow_redirects=False, trust_env=False) as client:
                async with client.stream(method, self.url + route, json=payload,
                                         headers={"Authorization": "Bearer " + key, "Accept": "application/json"}) as response:
                    if not response.is_success:
                        raise KioskSeatUnavailable
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 8192:
                            raise KioskSeatUnavailable
                    result = json.loads(body)
        except (httpx.HTTPError, OSError, ValueError, UnicodeError) as exc:
            raise KioskSeatUnavailable from exc
        if not isinstance(result, dict):
            raise KioskSeatUnavailable
        return result

    @staticmethod
    def _matches_target(result: dict, target: str) -> bool:
        actual = result.get("target")
        return isinstance(actual, str) and actual.casefold() == target.casefold()

    async def ready(self, target: str) -> bool:
        try:
            result = await self._call("GET", "/seat")
            return self._matches_target(result, target) and result.get("ready") is True
        except KioskSeatUnavailable:
            return False

    async def reserve(self, target: str, lease: str) -> None:
        result = await self._call("POST", "/seat/reserve", {"target": target, "lease": lease})
        if not (self._matches_target(result, target) and result.get("lease") == lease
                and result.get("state") == "reserved"):
            raise KioskSeatUnavailable

    async def assign(self, target: str, lease: str, username: str, expires_at: str) -> None:
        expected = parse_expiry(expires_at)
        if expected is None:
            raise KioskSeatUnavailable
        result = await self._call("POST", "/seat/assign", {
            "target": target, "lease": lease, "username": username, "expiresAt": expires_at,
        })
        actual_user = result.get("username")
        if not (self._matches_target(result, target) and result.get("lease") == lease
                and result.get("state") == "assigned" and isinstance(actual_user, str)
                and actual_user.casefold() == username.casefold() and parse_expiry(result.get("expiresAt")) == expected):
            raise KioskSeatUnavailable

    async def cancel(self, target: str, lease: str) -> None:
        try:
            await self._call("POST", "/seat/cancel", {"target": target, "lease": lease})
        except KioskSeatUnavailable:
            # The seat authority retains a reservation until it verifies safe release.
            pass
