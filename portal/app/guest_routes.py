"""Guest portal: self-service temporary sign-ins. Holds only the guest key."""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import re
import secrets
import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from itsdangerous import BadSignature, URLSafeTimedSerializer

from .agent_client import AgentError, AgentUnavailable
from . import commons_handoff
from .kiosk_seat import KioskSeatBroker, KioskSeatUnavailable, parse_expiry
from .security import ONCE_COOKIE, client_ip
from .web import agent_message, csrf_protect, redirect, render, set_cookie, translator_for

router = APIRouter()
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,20}$")
RDP_TARGET = re.compile(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}(?::[0-9]{1,5})?")
RDP_USER = re.compile(r"[A-Za-z0-9._@\\-]{1,320}")
COMMONS_EDITION_LABELS = {"gui": "Windows Server with GUI", "core": "Windows Server without GUI"}
KIOSK_LABEL = "Kiosk Windows 11"
KIOSK_UNAVAILABLE = "The kiosk seat is busy or unavailable."
NO_STORE = {"Cache-Control": "no-store, max-age=0", "Pragma": "no-cache", "Expires": "0"}
WORDING_COOKIE = "td_guest_wording"
WORDING_MAX_AGE = 15 * 60


def _wording_signer(request: Request) -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(request.app.state.settings.session_secret, salt="tempdesk-guest-wording")


def _wording_seconds(request: Request) -> int:
    cookie = request.cookies.get(WORDING_COOKIE)
    if cookie:
        try:
            deadline = _wording_signer(request).loads(cookie, max_age=WORDING_MAX_AGE)
        except BadSignature:
            return 0
        if type(deadline) is int:
            return max(0, min(WORDING_MAX_AGE, int(deadline - time.time())))
    return 0


def _commons_targets(request: Request) -> dict[str, str]:
    settings = request.app.state.settings
    targets = {"gui": settings.commons_rdp_gui, "core": settings.commons_rdp_core}
    if not any(targets.values()):
        targets = {"legacy": settings.commons_rdp_target}
    if (KioskSeatBroker.configured(settings) and ":" not in settings.commons_rdp_kiosk
            and "." in settings.commons_rdp_kiosk):
        targets["kiosk"] = settings.commons_rdp_kiosk
    return {edition: target for edition, target in targets.items()
            if RDP_TARGET.fullmatch(target)
            and (":" not in target or 1 <= int(target.rsplit(":", 1)[1]) <= 65535)}


async def public_settings(request: Request) -> dict:
    data = await request.app.state.agent.get("/public/settings")
    data = data if isinstance(data, dict) else {}
    choices = [c for c in data.get("expiryChoices") or [] if isinstance(c, dict)]
    if not data.get("allowPermanent", False):
        choices = [c for c in choices if int(c.get("minutes") or 0) != 0]
    data["expiryChoices"] = choices
    request.state.public = data
    request.state.org_name = data.get("orgName") or "TempDesk"
    targets = _commons_targets(request)
    available = list(targets)
    kiosk_target = targets.get("kiosk")
    if kiosk_target:
        broker = KioskSeatBroker.configured(request.app.state.settings)
        if broker is None or not await broker.ready(kiosk_target):
            available.remove("kiosk")
    edition_labels = dict(COMMONS_EDITION_LABELS)
    if "legacy" in targets:
        edition_labels = {"legacy": "Default session host"}
    if kiosk_target:
        edition_labels["kiosk"] = KIOSK_LABEL
    data["commonsEditions"] = available
    data["commonsEditionLabels"] = edition_labels
    data["commonsPickEdition"] = any(edition != "legacy" for edition in targets)
    data["commonsHasKiosk"] = bool(kiosk_target)
    data["commonsExpiryChoices"] = [choice for choice in choices if int(choice.get("minutes") or 0) > 0]
    data["commonsEnabled"] = bool(data["commonsEditions"] and data["commonsExpiryChoices"])
    return data


def _ip(request: Request) -> str:
    return client_ip(request, request.app.state.settings.trusted_proxies)


def _limit(request: Request, limiter) -> None:
    ok, retry = limiter.check(_ip(request))
    if not ok:
        raise HTTPException(status_code=429, detail=retry)


async def _render_home(request: Request, pub: dict, values: dict, *, status: int = 200, **context):
    seconds = _wording_seconds(request) if pub["commonsEnabled"] and pub["commonsPickEdition"] else 0
    request.state.picker_wording = bool(seconds)
    return await render(request, "guest/home.html",
                        {"pub": pub, "values": values, "wording_seconds": seconds, **context},
                        status=status, headers=NO_STORE if seconds else None)


@router.get("/")
async def home(request: Request):
    pub = await public_settings(request)
    edition = request.query_params.get("edition")
    expiry = request.query_params.get("duration")
    values = {}
    if edition and expiry and edition in pub["commonsEditions"] and expiry in {choice.get("id") for choice in pub["commonsExpiryChoices"]}:
        values = {"commons": True, "edition": edition, "expiryId": expiry}
    return await _render_home(request, pub, values)


async def _cancel_unclaimed_kiosk(request: Request, broker: KioskSeatBroker, target: str, lease: str,
                                  created: dict | None) -> None:
    await broker.cancel(target, lease)
    if isinstance(created, dict):
        name, password = created.get("username"), created.get("password")
        if isinstance(name, str) and USERNAME_RE.fullmatch(name) and isinstance(password, str) and password:
            try:
                await request.app.state.agent.post(f"/guest/users/{name}/delete", json={"password": password},
                                                   client_ip=_ip(request))
            except (AgentError, AgentUnavailable):
                # Expiry still bounds the unusable directory record.
                pass


async def _create_kiosk(request: Request, body: dict, target: str) -> str:
    broker = KioskSeatBroker.configured(request.app.state.settings)
    if broker is None:
        raise KioskSeatUnavailable
    lease = commons_handoff.new_reference()
    created = None
    try:
        await broker.reserve(target, lease)
        created = await request.app.state.agent.post("/guest/users", json=body, client_ip=_ip(request))
        if not isinstance(created, dict):
            raise KioskSeatUnavailable
        username, expires_at = created.get("upn"), created.get("expiresAt")
        expiry = parse_expiry(expires_at)
        if (not isinstance(username, str) or not RDP_USER.fullmatch(username) or "@" not in username
                or expiry is None or expiry <= datetime.now(timezone.utc)):
            raise KioskSeatUnavailable
        await broker.assign(target, lease, username, expires_at)
        return request.app.state.once.put({"credentials": created, "rdpTarget": target, "rdpEdition": "kiosk"})
    except (Exception, asyncio.CancelledError):
        await _cancel_unclaimed_kiosk(request, broker, target, lease, created)
        raise


@router.post("/create", dependencies=[Depends(csrf_protect)])
async def create(request: Request):
    pub = await public_settings(request)
    form = await request.form()
    raw_display = form.get("displayName", "")
    raw_expiry = form.get("expiryId", "")
    display = raw_display.strip() if isinstance(raw_display, str) else ""
    expiry = raw_expiry.strip() if isinstance(raw_expiry, str) else ""
    commons = form.get("checkout") == "commons"
    targets = _commons_targets(request) if commons else {}
    edition = form.get("edition") or ("legacy" if "legacy" in targets else "")
    target = targets.get(edition) if isinstance(edition, str) else None
    values = {"displayName": display, "expiryId": expiry, "edition": edition, "commons": commons}
    if commons and not pub["commonsEnabled"]:
        if edition == "kiosk" and target:
            return await _render_home(request, pub, values, status=409, error_key=KIOSK_UNAVAILABLE)
        raise HTTPException(status_code=404)
    ids = {c.get("id") for c in pub["expiryChoices"]}
    error = None
    if commons:
        ids = {c.get("id") for c in pub["commonsExpiryChoices"]}
    if commons and (not target or edition not in pub["commonsEditions"]):
        if edition == "kiosk" and target:
            return await _render_home(request, pub, values, status=409, error_key=KIOSK_UNAVAILABLE)
        error = "Choose an available server edition."
    elif expiry not in ids:
        error = "Choose how long you need the sign-in for."
    elif not isinstance(raw_display, str) or len(display) > 64 or any(ord(c) < 32 or c in '"/\\[]:;|=,+*?<>@' for c in display):
        error = "The display name can be up to 64 characters and cannot contain special symbols."
    if error:
        return await _render_home(request, pub, values, status=400, error_key=error)
    _limit(request, request.app.state.create_limiter)
    if commons and secrets.randbelow(100) == 0:
        dish = secrets.choice(("Har gow", "Siu mai", "Char siu bao"))
        return await render(request, "guest/dim-sum.html",
                            {"pub": pub, "dish": dish, "edition": edition, "duration": expiry}, headers=NO_STORE)
    body = {"expiryId": expiry}
    if display:
        body["displayName"] = display
    try:
        if commons and edition == "kiosk":
            once_id = await _create_kiosk(request, body, target)
        else:
            created = await request.app.state.agent.post("/guest/users", json=body, client_ip=_ip(request))
            once_id = request.app.state.once.put({"credentials": created, "rdpTarget": target,
                                                 "rdpEdition": edition if target else None})
    except KioskSeatUnavailable:
        return await _render_home(request, pub, values, status=503, error_key=KIOSK_UNAVAILABLE)
    except AgentError as exc:
        if exc.code in ("rate_limited", "conflict", "bad_request", "forbidden"):
            return await _render_home(request, pub, values, status=exc.status if exc.status < 500 else 502,
                                      error_text=agent_message(request, exc))
        raise
    if commons:
        path = commons_handoff.confirmation_path(commons_handoff.new_reference())
        resp = redirect(request, path)
        commons_handoff.set_handoff(request, resp, commons_handoff.CONFIRM_COOKIE, path, {"key": once_id},
                                    int(time.time()) + commons_handoff.HANDOFF_SECONDS)
        return resp
    resp = redirect(request, "/created")
    set_cookie(request, resp, ONCE_COOKIE, once_id, max_age=600)
    return resp


async def _render_created(request: Request, key: str | None, cookie_name: str, path: str,
                          reference: str | None = None):
    pub = await public_settings(request)
    result = request.app.state.once.pop(key)
    if not result:
        resp = await render(request, "guest/gone.html", {"pub": pub}, status=410, headers=NO_STORE)
        resp.delete_cookie(cookie_name, path=path)
        return resp
    creds = result.get("credentials", result)
    domain = creds.get("domain") or ""
    netbios = domain.split(".")[0].upper() if domain else ""
    download = None
    rdp_url = None
    targets = _commons_targets(request)
    target = result.get("rdpTarget")
    commons_checkout = bool(target) or result.get("commons") is True
    # Older pending checkouts recorded a flag and could only use the legacy destination.
    edition = result.get("rdpEdition")
    if "rdpEdition" not in result:
        edition = "legacy"
        if "rdpTarget" not in result and result.get("commons") is True:
            target = targets.get(edition)
    if target and targets.get(edition) == target:
        username = creds.get("upn") or (f"{netbios}\\{creds['username']}" if netbios else creds["username"])
        expires_at = creds.get("expiresAt")
        deadline = commons_handoff.download_deadline(expires_at) if expires_at is not None or reference is None else 0
        if RDP_USER.fullmatch(username) and deadline > time.time():
            rdp_url = commons_handoff.download_path(reference or commons_handoff.new_reference())
            download = {"target": target, "edition": edition, "username": username}
    resp = await render(request, "guest/created.html",
                        {"pub": pub, "c": creds, "netbios": netbios, "rdp_url": rdp_url,
                         "rdp_edition_label": (KIOSK_LABEL if edition == "kiosk" else COMMONS_EDITION_LABELS.get(edition))
                         if rdp_url else None,
                         "rdp_unavailable": commons_checkout and not rdp_url}, headers=NO_STORE)
    resp.delete_cookie(cookie_name, path=path)
    if download:
        commons_handoff.set_handoff(request, resp, commons_handoff.DOWNLOAD_COOKIE, rdp_url, download, deadline)
    return resp


@router.get("/created")
async def created(request: Request):
    return await _render_created(request, request.cookies.get(ONCE_COOKIE), ONCE_COOKIE, "/")


@router.get("/created/{reference}")
async def commons_created(request: Request, reference: str):
    if not commons_handoff.REFERENCE.fullmatch(reference):
        return Response(status_code=404, headers=NO_STORE)
    path = commons_handoff.confirmation_path(reference)
    grant = commons_handoff.read_handoff(request, commons_handoff.CONFIRM_COOKIE, path)
    key = grant.get("key")
    return await _render_created(request, key if isinstance(key, str) else None,
                                 commons_handoff.CONFIRM_COOKIE, path, reference)


@router.get("/created/{reference}/virtual-commons.rdp")
async def commons_download(request: Request, reference: str):
    if not commons_handoff.REFERENCE.fullmatch(reference):
        return Response(status_code=404, headers=NO_STORE)
    path = commons_handoff.download_path(reference)
    grant = commons_handoff.read_handoff(request, commons_handoff.DOWNLOAD_COOKIE, path)
    edition, target, username = grant.get("edition"), grant.get("target"), grant.get("username")
    if (not isinstance(edition, str) or not isinstance(target, str) or _commons_targets(request).get(edition) != target
            or not isinstance(username, str) or not RDP_USER.fullmatch(username)):
        return Response(status_code=404, headers=NO_STORE)
    headers = {**NO_STORE, "Content-Disposition": f'attachment; filename="{commons_handoff.RDP_FILENAME}"'}
    profile = commons_handoff.rdp_file(target, username, restricted=edition == "kiosk")
    return Response(content=profile, media_type="application/x-rdp", headers=headers)


def _username(form) -> str:
    u = (form.get("username") or "").strip()
    if "\\" in u:
        u = u.split("\\", 1)[1]
    if "@" in u:
        u = u.split("@", 1)[0]
    return u


@router.get("/check")
async def check_page(request: Request):
    pub = await public_settings(request)
    return await render(request, "guest/check.html", {"pub": pub, "result": None})


@router.post("/check", dependencies=[Depends(csrf_protect)])
async def check(request: Request):
    pub = await public_settings(request)
    form = await request.form()
    user, pw = _username(form), form.get("password") or ""
    if not USERNAME_RE.fullmatch(user) or not pw:
        return await render(request, "guest/check.html", {"pub": pub, "result": None, "error_key": "Enter your username and password."}, status=400, headers=NO_STORE)
    _limit(request, request.app.state.lookup_limiter)
    try:
        result = await request.app.state.agent.post(f"/guest/users/{user}/status", json={"password": pw}, client_ip=_ip(request))
    except AgentError as exc:
        if exc.code in ("unauthorized", "not_found", "forbidden"):
            return await render(request, "guest/check.html", {"pub": pub, "result": None, "error_key": "That username and password did not match a guest sign-in."}, status=400, headers=NO_STORE)
        raise
    response = await render(request, "guest/check.html", {"pub": pub, "result": result}, headers=NO_STORE)
    if pub["commonsEnabled"] and result.get("enabled"):
        now = int(time.time())
        deadline = now + WORDING_MAX_AGE
        if expiry := result.get("expiresAt"):
            try:
                expires = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
                deadline = min(deadline, int(expires.timestamp())) if expires.tzinfo else now
            except (AttributeError, ValueError, OverflowError, OSError):
                deadline = now
        if deadline > now:
            grant = _wording_signer(request).dumps(deadline)
            set_cookie(request, response, WORDING_COOKIE, grant, max_age=deadline - now)
    return response


@router.get("/delete")
async def delete_page(request: Request):
    pub = await public_settings(request)
    if not pub.get("allowSelfDelete", True):
        raise HTTPException(status_code=404)
    return await render(request, "guest/delete.html", {"pub": pub})


@router.post("/delete", dependencies=[Depends(csrf_protect)])
async def delete(request: Request):
    pub = await public_settings(request)
    if not pub.get("allowSelfDelete", True):
        raise HTTPException(status_code=404)
    form = await request.form()
    user, pw = _username(form), form.get("password") or ""
    if not USERNAME_RE.fullmatch(user) or not pw:
        return await render(request, "guest/delete.html", {"pub": pub, "error_key": "Enter your username and password."}, status=400, headers=NO_STORE)
    if form.get("confirm") != "on":
        return await render(request, "guest/delete.html", {"pub": pub, "error_key": "Tick the box to confirm you want to delete your sign-in."}, status=400, headers=NO_STORE)
    _limit(request, request.app.state.lookup_limiter)
    try:
        await request.app.state.agent.post(f"/guest/users/{user}/delete", json={"password": pw}, client_ip=_ip(request))
    except AgentError as exc:
        if exc.code in ("unauthorized", "not_found", "forbidden"):
            return await render(request, "guest/delete.html", {"pub": pub, "error_key": "That username and password did not match a guest sign-in."}, status=400, headers=NO_STORE)
        raise
    return redirect(request, "/", flash=("success", translator_for(request).plain("Your sign-in was deleted.")))
