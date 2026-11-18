"""Guest portal: self-service temporary sign-ins. Holds only the guest key."""

from __future__ import annotations

import base64
import re
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request

from .agent_client import AgentError
from .security import ONCE_COOKIE, client_ip
from .web import agent_message, csrf_protect, redirect, render, set_cookie, translator_for

router = APIRouter()
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,20}$")
RDP_TARGET = re.compile(r"[A-Za-z0-9][A-Za-z0-9.-]{0,252}(?::[0-9]{1,5})?")
RDP_USER = re.compile(r"[A-Za-z0-9._@\\-]{1,320}")
NO_STORE = {"Cache-Control": "no-store, max-age=0", "Pragma": "no-cache", "Expires": "0"}


def _commons_targets(request: Request) -> dict[str, str]:
    settings = request.app.state.settings
    targets = {"gui": settings.commons_rdp_gui, "core": settings.commons_rdp_core}
    if not any(targets.values()):
        targets = {"legacy": settings.commons_rdp_target}
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
    data["commonsEditions"] = list(_commons_targets(request))
    data["commonsEnabled"] = bool(data["commonsEditions"]) and any(
        int(choice.get("minutes") or 0) > 0 for choice in choices
    )
    return data


def _ip(request: Request) -> str:
    return client_ip(request, request.app.state.settings.trusted_proxies)


def _limit(request: Request, limiter) -> None:
    ok, retry = limiter.check(_ip(request))
    if not ok:
        raise HTTPException(status_code=429, detail=retry)


@router.get("/")
async def home(request: Request):
    pub = await public_settings(request)
    return await render(request, "guest/home.html", {"pub": pub, "error": None, "values": {}})


@router.post("/create", dependencies=[Depends(csrf_protect)])
async def create(request: Request):
    pub = await public_settings(request)
    form = await request.form()
    display = (form.get("displayName") or "").strip()
    expiry = (form.get("expiryId") or "").strip()
    commons = form.get("checkout") == "commons"
    if commons and not pub["commonsEnabled"]:
        raise HTTPException(status_code=404)
    targets = _commons_targets(request) if commons else {}
    edition = form.get("edition") or ("legacy" if "legacy" in targets else "")
    target = targets.get(edition) if isinstance(edition, str) else None
    values = {"displayName": display, "expiryId": expiry, "edition": edition}
    ids = {c.get("id") for c in pub["expiryChoices"]}
    error = None
    if commons:
        ids = {c.get("id") for c in pub["expiryChoices"] if int(c.get("minutes") or 0) > 0}
    if commons and not target:
        error = "Choose an available server edition."
    elif expiry not in ids:
        error = "Choose how long you need the sign-in for."
    elif len(display) > 64 or any(ord(c) < 32 or c in '"/\\[]:;|=,+*?<>@' for c in display):
        error = "The display name can be up to 64 characters and cannot contain special symbols."
    if error:
        return await render(request, "guest/home.html", {"pub": pub, "error_key": error, "values": values}, status=400)
    _limit(request, request.app.state.create_limiter)
    if commons and secrets.randbelow(100) == 0:
        dish = secrets.choice(("Har gow", "Siu mai", "Char siu bao"))
        return await render(request, "guest/dim-sum.html", {"pub": pub, "dish": dish}, headers=NO_STORE)
    body = {"expiryId": expiry}
    if display:
        body["displayName"] = display
    try:
        created = await request.app.state.agent.post("/guest/users", json=body, client_ip=_ip(request))
    except AgentError as exc:
        if exc.code in ("rate_limited", "conflict", "bad_request", "forbidden"):
            return await render(request, "guest/home.html",
                                {"pub": pub, "error_text": agent_message(request, exc), "values": values},
                                status=exc.status if exc.status < 500 else 502)
        raise
    # Keep the credentials server side; the browser only gets a random id.
    once_id = request.app.state.once.put({"credentials": created, "rdpTarget": target})
    resp = redirect(request, "/created")
    set_cookie(request, resp, ONCE_COOKIE, once_id, max_age=600)
    return resp


@router.get("/created")
async def created(request: Request):
    pub = await public_settings(request)
    result = request.app.state.once.pop(request.cookies.get(ONCE_COOKIE))
    if not result:
        resp = await render(request, "guest/gone.html", {"pub": pub}, status=410, headers=NO_STORE)
        resp.delete_cookie(ONCE_COOKIE, path="/")
        return resp
    creds = result.get("credentials", result)
    domain = creds.get("domain") or ""
    netbios = domain.split(".")[0].upper() if domain else ""
    rdp = None
    targets = _commons_targets(request)
    target = result.get("rdpTarget")
    # Older pending checkouts recorded a flag and could only use the legacy destination.
    if "rdpTarget" not in result and result.get("commons") is True:
        target = targets.get("legacy")
    if target in targets.values():
        username = creds.get("upn") or (f"{netbios}\\{creds['username']}" if netbios else creds["username"])
        if RDP_USER.fullmatch(username):
            profile = (f"full address:s:{target}\r\nusername:s:{username}\r\n"
                       "prompt for credentials:i:1\r\nauthentication level:i:2\r\nenablecredsspsupport:i:1\r\n")
            rdp = base64.b64encode(profile.encode("utf-16")).decode("ascii")
    resp = await render(request, "guest/created.html",
                        {"pub": pub, "c": creds, "netbios": netbios, "rdp": rdp}, headers=NO_STORE)
    resp.delete_cookie(ONCE_COOKIE, path="/")
    return resp


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
    return await render(request, "guest/check.html", {"pub": pub, "result": result}, headers=NO_STORE)


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
