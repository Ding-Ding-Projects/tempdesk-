"""Trusted operator navigation to the shared project status record."""
import os
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, Request

from .web import render, require_admin

router = APIRouter()


def project_url():
    value = os.environ.get("TEMPDESK_STATUS_PROJECT_URL", "").strip()
    if not value or any(ord(char) < 32 or char == chr(92) for char in value):
        return None
    try:
        parts = urlsplit(value)
        if (parts.scheme != "https" or not parts.hostname or parts.username is not None
                or parts.password is not None or parts.query or parts.fragment):
            return None
        if parts.port == 0:
            return None
    except ValueError:
        return None
    return value


@router.get("/status-hub", dependencies=[Depends(require_admin)])
async def status_hub(request: Request):
    return await render(request, "status-hub.html", {"project_url": project_url()},
                        headers={"Cache-Control": "no-store"})
