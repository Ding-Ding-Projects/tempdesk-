"""Admin console routes. Holds the admin key; every agent call carries the
signed-in administrator's bearer token."""

from __future__ import annotations

import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from markupsafe import Markup

from . import settings_schema
from .agent_client import AgentError, AgentUnavailable
from .docs import changelog_html, docs_index, render_doc
from .security import ONCE_COOKIE, SESSION_COOKIE, Session, client_ip, safe_next
from .tables import table
from .undo_routes import check_spec, gpo_snapshot, http_inv, track
from .vocab import WordingError, headline_for
from .web import (
    agent_message,
    csrf_protect,
    current_session,
    flash_text,
    redirect,
    render,
    require_admin,
    set_cookie,
    translator_for,
)

router = APIRouter()
CSRF = [Depends(csrf_protect)]
NO_STORE = {"Cache-Control": "no-store, max-age=0", "Pragma": "no-cache"}
DESTRUCTIVE_CMDLET = ("Remove-", "Clear-", "Reset-", "Restore-", "Disable-")
DESTRUCTIVE_SAMBA = re.compile(r"\b(delete|remove|demote|reset)\b")
SCRIPT_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
EXE_RE = re.compile(r"^[A-Za-z0-9 ._()+-]{1,120}\.exe$", re.IGNORECASE)
WIFI_AUTH = ("WPA2PSK", "WPA3SAE", "open")
GPO_STATUS = ("AllSettingsEnabled", "UserSettingsDisabled", "ComputerSettingsDisabled", "AllSettingsDisabled")
REG_TYPES = ("String", "ExpandString", "DWord", "QWord", "MultiString", "Binary")
PERMS = ("GpoRead", "GpoApply", "GpoEdit", "GpoEditDeleteModifySecurity", "None")
AUDIT_CHOICES = [("0", "No auditing"), ("1", "Success"), ("2", "Failure"), ("3", "Success and failure")]
LOGO_TYPES = {b"\x89PNG": "image/png", b"\xff\xd8\xff": "image/jpeg", b"RIFF": "image/webp"}


# ================================================================ helpers

def agent(request: Request):
    return request.app.state.agent


async def call(request: Request, sess: Session, method: str, path: str, **kw) -> Any:
    return await agent(request).call(method, path, token=sess.token, **kw)


def tr(request: Request):
    return translator_for(request)


async def form_of(request: Request):
    return await request.form()


def back(request: Request, default: str) -> str:
    return safe_next(request.query_params.get("back") or request.headers.get("x-back"), default)


def ok(request: Request, url: str, key: str, **args) -> RedirectResponse:
    return redirect(request, url, ("success", flash_text(request, key, **args)))


def fail(request: Request, url: str, exc: AgentError | str) -> RedirectResponse:
    text = agent_message(request, exc) if isinstance(exc, AgentError) else flash_text(request, exc)
    return redirect(request, url, ("error", text))


def lines(value: str | None) -> list[str]:
    return [ln.strip() for ln in (value or "").replace("\r", "").split("\n") if ln.strip()]


def super_ok(request: Request, form, action: str, target: str) -> bool:
    return request.app.state.confirm.check(action, target, form.get("confirm_name"), form.get("confirm_token"))


def confirm_token(request: Request, action: str, target: str) -> str:
    return request.app.state.confirm.issue(action, target)


def regex_error(request: Request) -> str | None:
    """Validate the regex search toggle. Returns an error text or None."""
    if request.query_params.get("re") != "1":
        return None
    q = request.query_params.get("q") or ""
    if len(q) > 200:
        return tr(request).plain("Invalid pattern") + ": " + tr(request).plain("the pattern is longer than 200 characters.")
    try:
        re.compile(q)
    except re.error as exc:
        return tr(request).plain("Invalid pattern") + f": {exc.msg}"
    return None


def view(request: Request, rows, columns, **kw):
    """Table with optional regex search (re=1). Invalid patterns show an error
    and fall back to no filtering."""
    err = regex_error(request)
    if request.query_params.get("re") == "1":
        q = request.query_params.get("q") or ""
        res = table(request, rows, columns, **kw)
        if isinstance(res, Response):
            return res, err
        if err:
            res.rows = list(rows or [])
        else:
            pat = re.compile(q, re.IGNORECASE)
            from .tables import cell, text

            keys = [c[0] for c in columns] + ([kw["key"]] if kw.get("key") else [])
            src = list(rows or [])
            res.rows = [r for r in src if pat.search(" ".join(text(cell(r, k)) for k in keys))] if q else src
        res.regex = True
        return res, err
    res = table(request, rows, columns, **kw)
    if not isinstance(res, Response):
        res.regex = False
    return res, err


def data_dir(request: Request) -> Path:
    return Path(request.app.state.settings.data_dir)


def read_json_file(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json_file(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(value, fh)
    os.replace(tmp, path)


def iso_local(value) -> str:
    return value or ""


# ================================================================ login / logout / elevation

@router.get("/login")
async def login_page(request: Request):
    if current_session(request):
        return RedirectResponse("/", status_code=303)
    return await render(request, "admin/login.html", {"next": safe_next(request.query_params.get("next"))})


@router.post("/login", dependencies=CSRF)
async def login(request: Request):
    form = await form_of(request)
    nxt = safe_next(form.get("next"))
    username = (form.get("username") or "").strip()
    password = form.get("password") or ""
    if not username or not password:
        return await render(request, "admin/login.html", {"next": nxt, "error_key": "Enter your username and password.", "username": username}, status=400)
    ip = client_ip(request, request.app.state.settings.trusted_proxies)
    allowed, _ = request.app.state.login_limiter.check(ip)
    if not allowed:
        return await render(request, "admin/login.html", {"next": nxt, "error_key": "Too many sign-in attempts. Please wait a few minutes and try again.", "username": username}, status=429)
    try:
        res = await agent(request).post("/auth/login", json={"username": username, "password": password}, client_ip=ip)
    except AgentError as exc:
        key = "That username and password were not accepted, or the account is not in the admin group." if exc.code in ("unauthorized", "forbidden") else None
        ctx = {"next": nxt, "username": username}
        if key:
            ctx["error_key"] = key
        else:
            ctx["error_text"] = agent_message(request, exc)
        return await render(request, "admin/login.html", ctx, status=401 if key else 502)
    exp = None
    try:
        exp = datetime.fromisoformat(str(res.get("expiresAt")).replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError):
        pass
    _sess, cookie = request.app.state.sessions.create(res["token"], res.get("user") or {"sam": username}, exp)
    state = read_json_file(data_dir(request) / "onboarding.json", {})
    target = "/welcome" if not state.get("done") and nxt == "/" else nxt
    resp = RedirectResponse(target, status_code=303)
    set_cookie(request, resp, SESSION_COOKIE, cookie, max_age=8 * 3600)
    return resp


@router.post("/logout", dependencies=CSRF)
async def logout(request: Request):
    sess = current_session(request)
    if sess:
        try:
            await agent(request).post("/auth/logout", token=sess.token)
        except (AgentError, AgentUnavailable):
            pass
        request.app.state.sessions.drop(sess.sid)
    resp = RedirectResponse("/login", status_code=303)
    resp.delete_cookie(SESSION_COOKIE, path="/")
    return resp


@router.get("/auth/elevate")
async def elevate_page(request: Request, sess: Session = Depends(require_admin)):
    return await render(request, "admin/elevate.html", {"next": safe_next(request.query_params.get("next"))})


@router.post("/auth/elevate", dependencies=CSRF)
async def elevate(request: Request, sess: Session = Depends(require_admin)):
    """Confirm your password: POST /auth/confirm and keep the elevation token
    server side for 10 minutes."""
    form = await form_of(request)
    nxt = safe_next(form.get("next"))
    pw = form.get("password") or ""
    is_api = request.headers.get("x-requested-with") == "fetch"
    try:
        resp = await agent(request).request("POST", "/auth/confirm", json={"password": pw}, token=sess.token)
    except AgentError as exc:
        if is_api:
            return JSONResponse({"ok": False, "error": tr(request).plain("That password was not accepted.", serious=True)}, status_code=401)
        if exc.code in ("unauthorized", "forbidden"):
            return await render(request, "admin/elevate.html", {"next": nxt, "error_key": "That password was not accepted."}, status=401)
        raise
    token = resp.headers.get("x-tempdesk-elevation")
    if not token:
        try:
            body = resp.json()
            token = body.get("token") or body.get("elevation") or body.get("elevationToken")
        except ValueError:
            token = None
    if not token:
        raise AgentError(502, "internal", "The agent did not return an elevation token.")
    sess.set_elevation(token, 600)
    if is_api:
        return JSONResponse({"ok": True})
    return ok(request, nxt, "Password confirmed for 10 minutes.")


async def require_elevation(request: Request, sess: Session = Depends(require_admin)) -> Session:
    """Dependency for routes that need a fresh password confirmation."""
    if not sess.elevated:
        nxt = request.url.path + (("?" + request.url.query) if request.url.query else "")
        raise _ElevateRedirect(nxt)
    return sess


class _ElevateRedirect(HTTPException):
    def __init__(self, nxt: str):
        super().__init__(status_code=303, headers={"Location": "/auth/elevate?next=" + quote(nxt, safe="/")})


# ================================================================ dashboard

@router.get("/")
async def dashboard(request: Request, sess: Session = Depends(require_admin)):
    health = await agent(request).health(force=True)
    request.state.health = health
    caps = set((health or {}).get("capabilities") or []) if health else set()
    guests, audit_rows, guest_error = None, [], None
    if "guest" in caps or not health:
        try:
            guests = await call(request, sess, "GET", "/guests")
        except AgentError as exc:
            guest_error = agent_message(request, exc)
    if "audit" in caps:
        try:
            audit_rows = (await call(request, sess, "GET", "/audit", params={"limit": 8})) or []
        except AgentError:
            audit_rows = []
    active = [g for g in guests or [] if g.get("enabled")]
    onboarding = read_json_file(data_dir(request) / "onboarding.json", {})
    return await render(request, "admin/dashboard.html", {
        "health": health, "guest_total": len(guests or []) if guests is not None else None,
        "guest_active": len(active), "guest_error": guest_error,
        "audit_rows": audit_rows[:8] if isinstance(audit_rows, list) else [],
        "audit_cols": audit_columns(audit_rows if isinstance(audit_rows, list) else []),
        "onboarding_done": bool(onboarding.get("done")),
    })


def audit_columns(rows: list) -> list[tuple[str, str]]:
    preferred = ["time", "timeCreated", "user", "action", "level", "message", "id"]
    keys: list[str] = []
    for r in rows[:50]:
        if isinstance(r, dict):
            for k in r:
                if k not in keys:
                    keys.append(k)
    keys.sort(key=lambda k: preferred.index(k) if k in preferred else 99)
    return [(k, k[:1].upper() + k[1:]) for k in keys[:6]]


# ================================================================ guests

GUEST_COLS = [("username", "Username"), ("displayName", "Display name"), ("created", "Created"),
              ("expiresAt", "Expires"), ("enabled", "Enabled"), ("lastLogon", "Last sign-in")]


@router.get("/guests")
async def guests(request: Request, sess: Session = Depends(require_admin)):
    rows = await call(request, sess, "GET", "/guests") or []
    tv, err = view(request, rows, GUEST_COLS, id="guests", key="username", filename="guests")
    if isinstance(tv, Response):
        return tv
    try:
        settings = await call(request, sess, "GET", "/settings") or {}
    except AgentError:
        settings = {}
    return await render(request, "admin/guests.html", {
        "tv": tv, "regex_error": err, "choices": settings.get("expiryChoices") or [],
        "bulk_token": confirm_token(request, "bulk-delete-guests", "delete"),
    })


@router.post("/guests", dependencies=CSRF)
async def guest_create(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    body: dict[str, Any] = {}
    if (form.get("displayName") or "").strip():
        body["displayName"] = form.get("displayName").strip()[:64]
    choice = form.get("expiryId") or ""
    if choice == "custom":
        try:
            minutes = int(form.get("minutes") or "")
        except ValueError:
            return fail(request, "/guests", "Enter the custom expiry as a whole number of minutes.")
        if not 0 <= minutes <= settings_schema.MAX_MINUTES:
            return fail(request, "/guests", "Custom minutes must be between 0 and 525600.")
        body["minutes"] = minutes
    elif choice:
        body["expiryId"] = choice
    else:
        return fail(request, "/guests", "Choose an expiry.")
    try:
        created = await call(request, sess, "POST", "/guests", json=body)
    except AgentError as exc:
        return fail(request, "/guests", exc)
    uname = (created or {}).get("username", "")
    track(request, sess, action="guest.create", target=f"guest:{uname}", summary=f"Create guest {uname}",
          request={"method": "POST", "path": "/guests", "json": body}, after={"username": uname},
          inverse=http_inv("DELETE", f"/guests/{quote(uname, safe='')}"),
          redo=None)
    once = request.app.state.once.put(created)
    resp = RedirectResponse("/guests/created", status_code=303)
    set_cookie(request, resp, ONCE_COOKIE, once, max_age=600)
    return resp


@router.get("/guests/created")
async def guest_created(request: Request, sess: Session = Depends(require_admin)):
    creds = request.app.state.once.pop(request.cookies.get(ONCE_COOKIE))
    if not creds:
        return redirect(request, "/guests", ("info", flash_text(request, "That password was already shown. Reset it from the directory if it was lost.")))
    domain = creds.get("domain") or ""
    resp = await render(request, "admin/guest_created.html", {"c": creds, "netbios": domain.split(".")[0].upper()}, headers=NO_STORE)
    resp.delete_cookie(ONCE_COOKIE, path="/")
    return resp


@router.post("/guests/{username}/extend", dependencies=CSRF)
async def guest_extend(username: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    try:
        minutes = int(form.get("minutes") or "")
    except ValueError:
        return fail(request, "/guests", "Enter the extension as a whole number of minutes.")
    before = await guest_expiry(request, sess, username)
    try:
        await call(request, sess, "POST", f"/guests/{quote(username, safe='')}/extend", json={"minutes": minutes})
    except AgentError as exc:
        return fail(request, "/guests", exc)
    track_extend(request, sess, username, minutes, before)
    return ok(request, "/guests", "Expiry updated for {name}.", name=username)


async def guest_expiry(request: Request, sess: Session, username: str):
    try:
        rows = await call(request, sess, "GET", "/guests") or []
    except AgentError:
        return None
    g = next((r for r in rows if r.get("username") == username), None)
    return g.get("expiresAt") if g else None


def track_extend(request: Request, sess: Session, username: str, minutes: int, before) -> None:
    if before is None:
        inv, reason = http_inv("POST", f"/guests/{quote(username, safe='')}/extend", None, {"minutes": 0}), ""
    else:
        try:
            left = (datetime.fromisoformat(str(before).replace("Z", "+00:00")) - datetime.now(timezone.utc)).total_seconds() / 60
        except ValueError:
            left = -1
        inv = http_inv("POST", f"/guests/{quote(username, safe='')}/extend", None, {"minutes": max(1, round(left))}) if left > 0 else None
        reason = "" if inv else "The previous expiry has already passed."
    track(request, sess, action="guest.extend", target=f"guest:{username}", summary=f"Change expiry of {username}",
          request={"method": "POST", "path": f"/guests/{quote(username, safe='')}/extend", "json": {"minutes": minutes}},
          before=before, inverse=inv, undoable=inv is not None, reason=reason)


@router.get("/guests/{username}/delete")
async def guest_delete_page(username: str, request: Request, sess: Session = Depends(require_admin)):
    return await render(request, "admin/confirm_delete.html", {
        "what": username, "kind_key": "guest account", "action": f"/guests/{quote(username, safe='')}/delete",
        "token": confirm_token(request, "delete-guest", username), "back": "/guests"})


@router.post("/guests/{username}/delete", dependencies=CSRF)
async def guest_delete(username: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    if not super_ok(request, form, "delete-guest", username):
        return fail(request, "/guests", "Deletion was not confirmed. Type the name and hold the button.")
    try:
        await call(request, sess, "DELETE", f"/guests/{quote(username, safe='')}")
    except AgentError as exc:
        return fail(request, "/guests", exc)
    track(request, sess, action="guest.delete", target=f"guest:{username}", summary=f"Delete guest {username}",
          request={"method": "DELETE", "path": f"/guests/{quote(username, safe='')}"}, undoable=False,
          reason="A deleted guest account cannot be restored from the guest list. Create a new one instead.")
    return ok(request, "/guests", "Deleted {name}.", name=username)


@router.post("/guests/bulk", dependencies=CSRF)
async def guest_bulk(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    names = [n for n in form.getlist("sel") if n]
    action = form.get("bulk")
    if not names:
        return fail(request, "/guests", "Select at least one row first.")
    done, errors = 0, []
    if action == "delete":
        if not super_ok(request, form, "bulk-delete-guests", "delete"):
            return fail(request, "/guests", "Bulk delete was not confirmed. Type delete and hold the button.")
        for n in names:
            try:
                await call(request, sess, "DELETE", f"/guests/{quote(n, safe='')}")
                done += 1
            except AgentError as exc:
                errors.append(f"{n}: {exc.message}")
    elif action == "extend":
        try:
            minutes = int(form.get("minutes") or "")
        except ValueError:
            return fail(request, "/guests", "Enter the extension as a whole number of minutes.")
        for n in names:
            try:
                await call(request, sess, "POST", f"/guests/{quote(n, safe='')}/extend", json={"minutes": minutes})
                done += 1
            except AgentError as exc:
                errors.append(f"{n}: {exc.message}")
    else:
        return fail(request, "/guests", "Choose a bulk action.")
    return bulk_result(request, "/guests", done, errors)


def bulk_result(request: Request, url: str, done: int, errors: list[str]) -> RedirectResponse:
    if errors:
        text = flash_text(request, "{done} done, {failed} failed.", done=done, failed=len(errors)) + " " + "; ".join(errors[:5])
        return redirect(request, url, ("error", text))
    return ok(request, url, "{done} done.", done=done)


# ================================================================ directory

def dn_q(dn: str) -> str:
    return quote(dn, safe="")


OBJ_COLS = [("name", "Name"), ("objectClass", "Class"), ("dn", "Distinguished name")]


@router.get("/directory")
async def directory(request: Request, sess: Session = Depends(require_admin)):
    dn = request.query_params.get("dn") or None
    children = await call(request, sess, "GET", "/ad/tree", params={"dn": dn}) or []
    for c in children:
        oc = c.get("objectClass")
        c["objectClass"] = oc[-1] if isinstance(oc, list) and oc else oc
    tv, err = view(request, children, OBJ_COLS, id="children", key="dn", filename="directory")
    if isinstance(tv, Response):
        return tv
    root = await call(request, sess, "GET", "/ad/tree") or [] if dn else children
    return await render(request, "admin/directory.html", {
        "dn": dn, "tv": tv, "regex_error": err, "root": root,
        "bulk_token": confirm_token(request, "bulk-delete-objects", "delete"),
    })


@router.get("/directory/children")
async def directory_children(request: Request, sess: Session = Depends(require_admin)):
    dn = request.query_params.get("dn") or None
    rows = await call(request, sess, "GET", "/ad/tree", params={"dn": dn}) or []
    return JSONResponse([{"dn": r.get("dn"), "name": r.get("name"), "objectClass": r.get("objectClass"),
                          "hasChildren": bool(r.get("hasChildren"))} for r in rows])


@router.get("/directory/object")
async def directory_object(request: Request, sess: Session = Depends(require_admin)):
    dn = request.query_params.get("dn") or ""
    if not dn:
        return RedirectResponse("/directory", status_code=303)
    obj = await call(request, sess, "GET", "/ad/object", params={"dn": dn})
    classes = [c.lower() for c in obj.get("objectClass") or []]
    attrs = obj.get("attributes") or {}
    rows = [{"name": k, "values": v if isinstance(v, list) else [v]} for k, v in attrs.items()]
    tv, err = view(request, rows, [("name", "Attribute"), ("values", "Values")], id="attrs", filename="attributes")
    if isinstance(tv, Response):
        return tv
    members = attrs.get("member") or []
    return await render(request, "admin/object.html", {
        "obj": obj, "dn": dn, "tv": tv, "regex_error": err,
        "is_user": "user" in classes and "computer" not in classes,
        "is_group": "group" in classes,
        "members": members if isinstance(members, list) else [members],
        "delete_token": confirm_token(request, "delete-object", dn),
        "tab_title": (attrs.get("name") or [dn])[0] if isinstance(attrs.get("name"), list) else dn,
    })


@router.post("/directory/object/attr", dependencies=CSRF)
async def directory_attr(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    dn = form.get("dn") or ""
    attr = (form.get("attr") or "").strip()
    op = form.get("op") or "set"
    url = "/directory/object?dn=" + dn_q(dn)
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,127}", attr):
        return fail(request, url, "Enter a valid attribute name.")
    vals = lines(form.get("values"))
    body: dict[str, Any] = {"dn": dn}
    if op == "clear":
        body["clear"] = [attr]
    elif op in ("set", "add", "remove"):
        if not vals:
            return fail(request, url, "Enter at least one value, one per line.")
        body[op] = {attr: vals}
    else:
        return fail(request, url, "Choose an operation.")
    try:
        before_obj = await call(request, sess, "GET", "/ad/object", params={"dn": dn}) or {}
        before = (before_obj.get("attributes") or {}).get(attr)
        res = await call(request, sess, "PATCH", "/ad/object", json=body)
        after = ((res or {}).get("attributes") or {}).get(attr) if isinstance(res, dict) else None
        if not isinstance(res, dict):
            after_obj = await call(request, sess, "GET", "/ad/object", params={"dn": dn}) or {}
            after = (after_obj.get("attributes") or {}).get(attr)
    except AgentError as exc:
        return fail(request, url, exc)
    inv_body = {"dn": dn, "set": {attr: before}} if before else {"dn": dn, "clear": [attr]}
    track(request, sess, action=f"attribute.{op}", target=dn, summary=f"{op} {attr} on {dn}",
          request={"method": "PATCH", "path": "/ad/object", "json": body}, before=before, after=after,
          inverse=http_inv("PATCH", "/ad/object", None, inv_body),
          check=check_spec("/ad/object", {"dn": dn}, f"attributes.{attr}"))
    return ok(request, url, "Saved {name}.", name=attr)


@router.get("/directory/create")
async def directory_create_page(request: Request, sess: Session = Depends(require_admin)):
    return await render(request, "admin/object_create.html", {"parent": request.query_params.get("parent") or ""})


@router.post("/directory/create", dependencies=CSRF)
async def directory_create(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    parent = (form.get("parentDn") or "").strip()
    oc = (form.get("objectClass") or "").strip()
    rdn = (form.get("rdn") or "").strip()
    attrs: dict[str, list[str]] = {}
    for ln in lines(form.get("attributes")):
        if "=" not in ln:
            return fail(request, "/directory/create?parent=" + dn_q(parent), "Write each attribute as name=value on its own line.")
        k, v = ln.split("=", 1)
        attrs.setdefault(k.strip(), []).append(v.strip())
    if not (parent and oc and re.fullmatch(r"(CN|OU|DC)=.+", rdn, re.IGNORECASE)):
        return fail(request, "/directory/create?parent=" + dn_q(parent), "Parent, class and a name such as CN=Example are required.")
    try:
        res = await call(request, sess, "POST", "/ad/object", json={"parentDn": parent, "objectClass": oc, "rdn": rdn, "attributes": attrs})
    except AgentError as exc:
        return fail(request, "/directory/create?parent=" + dn_q(parent), exc)
    new_dn = (res or {}).get("dn") or f"{rdn},{parent}"
    track(request, sess, action="object.create", target=new_dn, summary=f"Create {oc} {new_dn}",
          request={"method": "POST", "path": "/ad/object", "json": {"parentDn": parent, "objectClass": oc, "rdn": rdn, "attributes": attrs}},
          before=None, after=new_dn, inverse=http_inv("DELETE", "/ad/object", {"dn": new_dn, "recursive": "false"}),
          check=check_spec("/ad/object", {"dn": new_dn}, "dn"))
    return ok(request, "/directory/object?dn=" + dn_q((res or {}).get("dn") or f"{rdn},{parent}"), "Created {name}.", name=rdn)


@router.post("/directory/move", dependencies=CSRF)
async def directory_move(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    dn = form.get("dn") or ""
    body = {"dn": dn, "newParentDn": (form.get("newParentDn") or "").strip()}
    if (form.get("newRdn") or "").strip():
        body["newRdn"] = form.get("newRdn").strip()
    if not body["newParentDn"]:
        return fail(request, "/directory/object?dn=" + dn_q(dn), "Enter the new parent container.")
    try:
        res = await call(request, sess, "POST", "/ad/object/move", json=body)
    except AgentError as exc:
        return fail(request, "/directory/object?dn=" + dn_q(dn), exc)
    new_dn = (res or {}).get("dn") or dn
    old_rdn, old_parent = (dn.split(",", 1) + [""])[:2]
    track(request, sess, action="object.move", target=new_dn, summary=f"Move {dn} to {new_dn}",
          request={"method": "POST", "path": "/ad/object/move", "json": body}, before=dn, after=new_dn,
          inverse=http_inv("POST", "/ad/object/move", None, {"dn": new_dn, "newParentDn": old_parent, "newRdn": old_rdn}),
          check=check_spec("/ad/object", {"dn": new_dn}, "dn"))
    return ok(request, "/directory/object?dn=" + dn_q((res or {}).get("dn") or dn), "Moved.")


async def recycle_info(request: Request, sess: Session, dn: str) -> tuple[str | None, bool, str]:
    """Decide whether deleting *dn* can be undone through the AD Recycle Bin."""
    health = await agent(request).health()
    if (health or {}).get("backend") == "samba" or "cmdlets" not in set((health or {}).get("capabilities") or []):
        return None, False, "Undo is not available on this backend: deleted objects cannot be restored from here."
    try:
        obj = await call(request, sess, "GET", "/ad/object", params={"dn": dn}) or {}
    except AgentError:
        return None, False, "The object could not be read before deletion."
    vals = (obj.get("attributes") or {}).get("objectGUID") or []
    guid = vals[0] if isinstance(vals, list) and vals else (vals or None)
    if not guid:
        return None, False, "The object GUID could not be recorded, so the AD Recycle Bin cannot be used."
    if isinstance(guid, str) and guid.startswith("b64:"):
        import base64
        import uuid as _uuid

        try:
            guid = str(_uuid.UUID(bytes_le=base64.b64decode(guid[4:])))
        except (ValueError, TypeError):
            return None, False, "The object GUID could not be read."
    return str(guid), True, ""


def delete_undo_note(health: dict | None) -> tuple[bool, str]:
    if (health or {}).get("backend") == "samba" or "cmdlets" not in set((health or {}).get("capabilities") or []):
        return False, "Deleted objects cannot be restored on this backend."
    return True, "It can be restored from the AD Recycle Bin with Undo."


@router.post("/directory/delete", dependencies=CSRF)
async def directory_delete(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    dn = form.get("dn") or ""
    url = "/directory/object?dn=" + dn_q(dn)
    if not super_ok(request, form, "delete-object", dn):
        return fail(request, url, "Deletion was not confirmed. Type the name and hold the button.")
    params = {"dn": dn, "recursive": "true" if form.get("recursive") == "on" else "false"}
    if form.get("force") == "on":
        params["force"] = "true"
    guid, undoable, reason = await recycle_info(request, sess, dn)
    try:
        await call(request, sess, "DELETE", "/ad/object", params=params)
    except AgentError as exc:
        return fail(request, url, exc)
    track(request, sess, action="object.delete", target=dn, summary=f"Delete {dn}",
          request={"method": "DELETE", "path": "/ad/object", "params": params}, before={"dn": dn, "objectGUID": guid}, after=None,
          inverse={"kind": "recycle", "guid": guid, "name": dn} if undoable else None, undoable=undoable, reason=reason,
          check=None)
    parent = dn.split(",", 1)[1] if "," in dn else ""
    return ok(request, "/directory" + ("?dn=" + dn_q(parent) if parent else ""), "Deleted {name}.", name=dn)


@router.post("/directory/user/{action}", dependencies=CSRF)
async def directory_user(action: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    dn = form.get("dn") or ""
    url = "/directory/object?dn=" + dn_q(dn)
    try:
        if action == "password":
            pw = form.get("password") or ""
            if len(pw) < 8:
                return fail(request, url, "The new password must be at least 8 characters.")
            await call(request, sess, "POST", "/ad/user/password", json={"dn": dn, "password": pw, "mustChange": form.get("mustChange") == "on"})
            track(request, sess, action="user.password", target=dn, summary=f"Reset password of {dn}",
                  request={"method": "POST", "path": "/ad/user/password", "json": {"dn": dn, "password": pw}},
                  undoable=False, reason="A password reset cannot be undone: the old password is never stored.")
            return ok(request, url, "Password reset.")
        if action in ("enable", "disable"):
            await call(request, sess, "POST", "/ad/user/enable", json={"dn": dn, "enabled": action == "enable"})
            track(request, sess, action=f"user.{action}", target=dn, summary=f"{action.capitalize()} {dn}",
                  request={"method": "POST", "path": "/ad/user/enable", "json": {"dn": dn, "enabled": action == "enable"}},
                  inverse=http_inv("POST", "/ad/user/enable", None, {"dn": dn, "enabled": action != "enable"}))
            return ok(request, url, "Account enabled." if action == "enable" else "Account disabled.")
        if action == "unlock":
            await call(request, sess, "POST", "/ad/user/unlock", json={"dn": dn})
            track(request, sess, action="user.unlock", target=dn, summary=f"Unlock {dn}", undoable=False,
                  request={"method": "POST", "path": "/ad/user/unlock", "json": {"dn": dn}},
                  reason="Unlocking has no inverse: an account cannot be locked on purpose.")
            return ok(request, url, "Account unlocked.")
    except AgentError as exc:
        return fail(request, url, exc)
    raise HTTPException(404)


@router.post("/directory/group/members", dependencies=CSRF)
async def directory_members(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    gdn = form.get("groupDn") or ""
    url = "/directory/object?dn=" + dn_q(gdn)
    add, remove = lines(form.get("add")), form.getlist("remove")
    if not add and not remove:
        return fail(request, url, "Add or select at least one member.")
    try:
        await call(request, sess, "POST", "/ad/group/members", json={"groupDn": gdn, "add": add, "remove": remove})
    except AgentError as exc:
        return fail(request, url, exc)
    track(request, sess, action="group.members", target=gdn, summary=f"Change members of {gdn}",
          request={"method": "POST", "path": "/ad/group/members", "json": {"groupDn": gdn, "add": add, "remove": remove}},
          before={"add": add, "remove": remove}, inverse=http_inv("POST", "/ad/group/members", None, {"groupDn": gdn, "add": remove, "remove": add}))
    return ok(request, url, "Members updated.")


@router.post("/directory/bulk", dependencies=CSRF)
async def directory_bulk(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    dns = [d for d in form.getlist("sel") if d]
    action = form.get("bulk")
    url = safe_next(form.get("back"), "/directory")
    if not dns:
        return fail(request, url, "Select at least one row first.")
    done, errors = 0, []
    if action == "delete" and not super_ok(request, form, "bulk-delete-objects", "delete"):
        return fail(request, url, "Bulk delete was not confirmed. Type delete and hold the button.")
    target = (form.get("target") or "").strip()
    if action in ("move", "add-to-group") and not target:
        return fail(request, url, "Enter the target distinguished name.")
    if action == "add-to-group":
        try:
            await call(request, sess, "POST", "/ad/group/members", json={"groupDn": target, "add": dns, "remove": []})
            return ok(request, url, "{done} done.", done=len(dns))
        except AgentError as exc:
            return fail(request, url, exc)
    for dn in dns:
        try:
            if action == "delete":
                await call(request, sess, "DELETE", "/ad/object", params={"dn": dn, "recursive": "false"})
            elif action in ("enable", "disable"):
                await call(request, sess, "POST", "/ad/user/enable", json={"dn": dn, "enabled": action == "enable"})
            elif action == "move":
                await call(request, sess, "POST", "/ad/object/move", json={"dn": dn, "newParentDn": target})
            else:
                return fail(request, url, "Choose a bulk action.")
            done += 1
        except AgentError as exc:
            errors.append(f"{dn}: {exc.message}")
    return bulk_result(request, url, done, errors)


@router.get("/directory/search")
async def directory_search(request: Request, sess: Session = Depends(require_admin)):
    qp = request.query_params
    filt = qp.get("filter") or ""
    results, error = None, None
    attrs = qp.get("attrs") or "name,objectClass"
    if filt:
        params = {"base": qp.get("base") or None, "filter": filt, "scope": qp.get("scope") or "sub",
                  "attrs": attrs, "limit": qp.get("limit") or "500"}
        try:
            results = await call(request, sess, "GET", "/ad/search", params=params) or []
        except AgentError as exc:
            error = agent_message(request, exc)
    cols = [("dn", "Distinguished name")] + [(f"attributes.{a.strip()}", a.strip()) for a in attrs.split(",") if a.strip()][:8]
    tv, err = view(request, results or [], cols, id="search", key="dn", filename="ldap-search")
    if isinstance(tv, Response):
        return tv
    return await render(request, "admin/search.html", {
        "tv": tv, "regex_error": err, "results": results, "error": error, "f": dict(qp), "attrs": attrs,
        "bulk_token": confirm_token(request, "bulk-delete-objects", "delete"),
    })


# ================================================================ group policy

GPO_COLS = [("displayName", "Name"), ("status", "Status"), ("modified", "Modified"), ("wmiFilter", "WMI filter"), ("id", "Id")]


@router.get("/gpo")
async def gpo_list(request: Request, sess: Session = Depends(require_admin)):
    rows = await call(request, sess, "GET", "/gpo") or []
    for r in rows:
        r["linkCount"] = len(r.get("links") or [])
    tv, err = view(request, rows, GPO_COLS + [("linkCount", "Links")], id="gpos", key="id", filename="gpos")
    if isinstance(tv, Response):
        return tv
    return await render(request, "admin/gpo_list.html", {"tv": tv, "regex_error": err,
                                                         "bulk_token": confirm_token(request, "bulk-delete-gpos", "delete")})


@router.post("/gpo", dependencies=CSRF)
async def gpo_create(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    name = (form.get("name") or "").strip()
    if not name or len(name) > 200:
        return fail(request, "/gpo", "Enter a name for the new policy.")
    try:
        g = await call(request, sess, "POST", "/gpo", json={"name": name, "comment": (form.get("comment") or "").strip()})
    except AgentError as exc:
        return fail(request, "/gpo", exc)
    if g and g.get("id"):
        track(request, sess, action="gpo.create", target=f"gpo:{g['id']}", summary=f"Create policy {name}",
              request={"method": "POST", "path": "/gpo", "json": {"name": name}}, after={"id": g["id"]},
              inverse=http_inv("DELETE", f"/gpo/{quote(g['id'], safe='')}"), redo=None)
    return ok(request, f"/gpo/{(g or {}).get('id', '')}" if g and g.get("id") else "/gpo", "Created {name}.", name=name)


@router.post("/gpo/bulk", dependencies=CSRF)
async def gpo_bulk(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    ids = [i for i in form.getlist("sel") if i]
    action = form.get("bulk")
    if not ids:
        return fail(request, "/gpo", "Select at least one row first.")
    done, errors = 0, []
    if action == "delete":
        if not super_ok(request, form, "bulk-delete-gpos", "delete"):
            return fail(request, "/gpo", "Bulk delete was not confirmed. Type delete and hold the button.")
    elif action == "backup":
        pass
    elif action in GPO_STATUS:
        pass
    else:
        return fail(request, "/gpo", "Choose a bulk action.")
    for i in ids:
        try:
            if action == "delete":
                await call(request, sess, "DELETE", f"/gpo/{quote(i, safe='')}")
            elif action == "backup":
                await call(request, sess, "POST", f"/gpo/{quote(i, safe='')}/backup")
            else:
                await call(request, sess, "PATCH", f"/gpo/{quote(i, safe='')}", json={"status": action})
            done += 1
        except AgentError as exc:
            errors.append(f"{i}: {exc.message}")
    return bulk_result(request, "/gpo", done, errors)


@router.get("/gpo/backups")
async def gpo_backups(request: Request, sess: Session = Depends(require_admin)):
    rows = await call(request, sess, "GET", "/gpo/backups") or []
    cols = [(k, k[:1].upper() + k[1:]) for k in (["backupId", "displayName", "gpoId", "created", "path"])]
    tv, err = view(request, rows, cols, id="backups", key="backupId", filename="gpo-backups")
    if isinstance(tv, Response):
        return tv
    return await render(request, "admin/gpo_backups.html", {"tv": tv, "regex_error": err})


@router.post("/gpo/backups/restore", dependencies=CSRF)
async def gpo_restore(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    gid, bid = form.get("gpoId") or "", form.get("backupId") or ""
    if form.get("confirm_name") != bid:
        return fail(request, "/gpo/backups", "Type the backup id to confirm the restore.")
    try:
        await call(request, sess, "POST", f"/gpo/{quote(gid, safe='')}/restore", json={"backupId": bid})
    except AgentError as exc:
        return fail(request, "/gpo/backups", exc)
    return ok(request, "/gpo/backups", "Backup restored.")


@router.post("/gpo/backups/import", dependencies=CSRF)
async def gpo_import(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    body = {"backupId": form.get("backupId") or "", "targetName": (form.get("targetName") or "").strip(),
            "createIfNeeded": form.get("createIfNeeded") == "on"}
    if not body["backupId"] or not body["targetName"]:
        return fail(request, "/gpo/backups", "Choose a backup and enter the target policy name.")
    try:
        await call(request, sess, "POST", "/gpo/import", json=body)
    except AgentError as exc:
        return fail(request, "/gpo/backups", exc)
    return ok(request, "/gpo/backups", "Imported into {name}.", name=body["targetName"])


@router.get("/gpo/wmi")
async def gpo_wmi(request: Request, sess: Session = Depends(require_admin)):
    rows = await call(request, sess, "GET", "/gpo/wmifilters") or []
    tv, err = view(request, rows, [("name", "Name"), ("description", "Description"), ("query", "Query")], id="wmi", key="name", filename="wmi-filters")
    if isinstance(tv, Response):
        return tv
    return await render(request, "admin/gpo_wmi.html", {"tv": tv, "regex_error": err})


@router.post("/gpo/wmi", dependencies=CSRF)
async def gpo_wmi_create(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    body = {k: (form.get(k) or "").strip() for k in ("name", "description", "query")}
    if not body["name"] or not body["query"]:
        return fail(request, "/gpo/wmi", "Name and query are required.")
    try:
        await call(request, sess, "POST", "/gpo/wmifilters", json=body)
    except AgentError as exc:
        return fail(request, "/gpo/wmi", exc)
    return ok(request, "/gpo/wmi", "Created {name}.", name=body["name"])


@router.get("/gpo/inheritance")
async def gpo_inheritance_page(request: Request, sess: Session = Depends(require_admin)):
    return await render(request, "admin/gpo_inheritance.html", {"target": request.query_params.get("target") or ""})


@router.post("/gpo/inheritance", dependencies=CSRF)
async def gpo_inheritance(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    target = (form.get("target") or "").strip()
    url = form.get("back") and safe_next(form.get("back"), "/gpo/inheritance") or "/gpo/inheritance"
    if not target:
        return fail(request, url, "Enter the target OU or domain distinguished name.")
    try:
        await call(request, sess, "PUT", "/gpo/inheritance", json={"target": target, "blocked": form.get("blocked") == "on"})
    except AgentError as exc:
        return fail(request, url, exc)
    return ok(request, url, "Inheritance updated.")


async def _gpo(request, sess, gid):
    return await call(request, sess, "GET", f"/gpo/{quote(gid, safe='')}")


@router.get("/gpo/{gid}")
async def gpo_detail(gid: str, request: Request, sess: Session = Depends(require_admin)):
    g = await _gpo(request, sess, gid)
    tab = request.query_params.get("tab") or "overview"
    ctx: dict[str, Any] = {"g": g, "gid": gid, "tab": tab, "statuses": GPO_STATUS, "reg_types": REG_TYPES,
                           "perms": PERMS, "tab_title": g.get("displayName") or gid,
                           "delete_token": confirm_token(request, "delete-gpo", g.get("displayName") or gid)}
    caps = request.state.caps if hasattr(request.state, "caps") else None
    if tab == "registry":
        key = request.query_params.get("key") or "HKLM\\Software\\Policies"
        rows = await call(request, sess, "GET", f"/gpo/{quote(gid, safe='')}/registry", params={"key": key}) or []
        ctx["tv"], ctx["regex_error"] = view(request, rows, [("key", "Key"), ("valueName", "Value name"), ("type", "Type"), ("value", "Value"), ("policyState", "State")], id="reg", filename="gpo-registry")
        ctx["key"] = key
    elif tab == "preferences":
        rows = await call(request, sess, "GET", f"/gpo/{quote(gid, safe='')}/preferences/registry") or []
        ctx["tv"], ctx["regex_error"] = view(request, rows, [("context", "Context"), ("action", "Action"), ("key", "Key"), ("valueName", "Value name"), ("type", "Type"), ("value", "Value")], id="prefs", filename="gpo-preferences")
    elif tab == "permissions":
        ctx["tv"], ctx["regex_error"] = view(request, g.get("permissions") or [], [("trustee", "Trustee"), ("permission", "Permission"), ("denied", "Denied")], id="perms", filename="gpo-permissions")
    elif tab == "links":
        ctx["tv"], ctx["regex_error"] = view(request, g.get("links") or [], [("target", "Target"), ("enabled", "Enabled"), ("enforced", "Enforced"), ("order", "Order")], id="links", key="target", filename="gpo-links")
    elif tab == "overview":
        try:
            ctx["wmifilters"] = await call(request, sess, "GET", "/gpo/wmifilters") or []
        except AgentError:
            ctx["wmifilters"] = []
    if isinstance(ctx.get("tv"), Response):
        return ctx["tv"]
    del caps
    return await render(request, "admin/gpo_detail.html", ctx)


@router.post("/gpo/{gid}/update", dependencies=CSRF)
async def gpo_update(gid: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    url = f"/gpo/{quote(gid, safe='')}"
    body = {}
    for k in ("displayName", "comment"):
        if form.get(k) is not None:
            body[k] = form.get(k).strip()
    if form.get("status") in GPO_STATUS:
        body["status"] = form.get("status")
    snap = await gpo_snapshot(request, sess, gid)
    try:
        await call(request, sess, "PATCH", url, json=body)
        if form.get("wmiFilter") is not None:
            name = form.get("wmiFilter") or None
            await call(request, sess, "PUT", f"{url}/wmifilter", json={"name": name})
    except AgentError as exc:
        return fail(request, url, exc)
    track_gpo(request, sess, gid, snap, "gpo.update", "Edit policy properties", {"method": "PATCH", "path": url, "json": body})
    return ok(request, url, "Saved.")


def track_gpo(request: Request, sess: Session, gid: str, snap: str | None, action: str, summary: str, req: dict) -> None:
    track(request, sess, action=action, target=f"gpo:{gid}", summary=f"{summary} ({gid})", request=req,
          before={"backupId": snap}, inverse={"kind": "gpo-restore", "gpoId": gid, "backupId": snap} if snap else None,
          undoable=bool(snap), reason="" if snap else "The policy could not be backed up before the change.")


@router.post("/gpo/{gid}/delete", dependencies=CSRF)
async def gpo_delete(gid: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    g = await _gpo(request, sess, gid)
    name = g.get("displayName") or gid
    if not super_ok(request, form, "delete-gpo", name):
        return fail(request, f"/gpo/{quote(gid, safe='')}", "Deletion was not confirmed. Type the name and hold the button.")
    snap = await gpo_snapshot(request, sess, gid)
    try:
        await call(request, sess, "DELETE", f"/gpo/{quote(gid, safe='')}")
    except AgentError as exc:
        return fail(request, f"/gpo/{quote(gid, safe='')}", exc)
    track(request, sess, action="gpo.delete", target=f"gpo:{gid}", summary=f"Delete policy {name}",
          request={"method": "DELETE", "path": f"/gpo/{gid}"}, before={"backupId": snap, "name": name},
          inverse=http_inv("POST", "/gpo/import", None, {"backupId": snap, "targetName": name, "createIfNeeded": True}) if snap else None,
          undoable=bool(snap), reason="" if snap else "The policy could not be backed up first. Links are not restored by undo.")
    return ok(request, "/gpo", "Deleted {name}.", name=name)


@router.post("/gpo/{gid}/backup", dependencies=CSRF)
async def gpo_backup(gid: str, request: Request, sess: Session = Depends(require_admin)):
    try:
        res = await call(request, sess, "POST", f"/gpo/{quote(gid, safe='')}/backup")
    except AgentError as exc:
        return fail(request, f"/gpo/{quote(gid, safe='')}", exc)
    return ok(request, f"/gpo/{quote(gid, safe='')}", "Backup created: {id}", id=(res or {}).get("backupId", ""))


@router.post("/gpo/{gid}/links", dependencies=CSRF)
async def gpo_links(gid: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    url = f"/gpo/{quote(gid, safe='')}?tab=links"
    target = (form.get("target") or "").strip()
    op = form.get("op") or "add"
    if not target:
        return fail(request, url, "Enter the target distinguished name.")
    path = f"/gpo/{quote(gid, safe='')}/links"
    snap = await gpo_snapshot(request, sess, gid)
    try:
        if op == "remove":
            await call(request, sess, "DELETE", path, params={"target": target})
        else:
            body: dict[str, Any] = {"target": target, "enabled": form.get("enabled") == "on", "enforced": form.get("enforced") == "on"}
            if (form.get("order") or "").strip():
                try:
                    body["order"] = int(form.get("order"))
                except ValueError:
                    return fail(request, url, "Link order must be a whole number.")
            await call(request, sess, "POST" if op == "add" else "PATCH", path, json=body)
    except AgentError as exc:
        return fail(request, url, exc)
    track_gpo(request, sess, gid, snap, "gpo.links", f"Change link {target}", {"method": op, "path": path, "json": {"target": target}})
    return ok(request, url, "Links updated.")


def _reg_value(type_: str, raw: str):
    if type_ in ("DWord", "QWord"):
        raw = raw.strip()
        return int(raw, 16) if raw.lower().startswith("0x") else int(raw)
    if type_ == "MultiString":
        return lines(raw)
    return raw


@router.post("/gpo/{gid}/registry", dependencies=CSRF)
async def gpo_registry(gid: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    pref = form.get("kind") == "preferences"
    url = f"/gpo/{quote(gid, safe='')}?tab=" + ("preferences" if pref else "registry")
    path = f"/gpo/{quote(gid, safe='')}/" + ("preferences/registry" if pref else "registry")
    key, name = (form.get("key") or "").strip(), (form.get("valueName") or "").strip()
    snap = None
    if not re.match(r"^(HKLM|HKCU|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER)\\", key, re.IGNORECASE):
        return fail(request, url, "The key must start with HKLM\\ or HKCU\\.")
    snap = await gpo_snapshot(request, sess, gid)
    try:
        if form.get("op") == "delete":
            params = {"key": key, "valueName": name}
            if pref:
                params["context"] = form.get("context") or "Computer"
            await call(request, sess, "DELETE", path, params=params)
            track_gpo(request, sess, gid, snap, "gpo.registry", f"Remove {key}\\{name}", {"method": "DELETE", "path": path, "params": params})
            return ok(request, url, "Value removed.")
        type_ = form.get("type") or "String"
        if type_ not in REG_TYPES:
            return fail(request, url, "Choose a value type.")
        try:
            value = _reg_value(type_, form.get("value") or "")
        except ValueError:
            return fail(request, url, "DWord and QWord values must be numbers (decimal or 0x hex).")
        body = {"key": key, "valueName": name, "type": type_, "value": value}
        if pref:
            body["context"] = form.get("context") if form.get("context") in ("Computer", "User") else "Computer"
            body["action"] = form.get("action") if form.get("action") in ("Create", "Replace", "Update", "Delete") else "Update"
        await call(request, sess, "PUT", path, json=body)
    except AgentError as exc:
        return fail(request, url, exc)
    track_gpo(request, sess, gid, snap, "gpo.registry", f"Set {key}\\{name}", {"method": "PUT", "path": path, "json": body})
    return ok(request, url, "Value saved.")


@router.post("/gpo/{gid}/permissions", dependencies=CSRF)
async def gpo_permissions(gid: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    url = f"/gpo/{quote(gid, safe='')}?tab=permissions"
    body = {"trustee": (form.get("trustee") or "").strip(),
            "trusteeType": form.get("trusteeType") if form.get("trusteeType") in ("User", "Group", "Computer") else "Group",
            "permission": form.get("permission") if form.get("permission") in PERMS else "GpoRead",
            "replace": form.get("replace") == "on"}
    if not body["trustee"]:
        return fail(request, url, "Enter a user, group or computer name.")
    snap = await gpo_snapshot(request, sess, gid)
    try:
        await call(request, sess, "PUT", f"/gpo/{quote(gid, safe='')}/permissions", json=body)
    except AgentError as exc:
        return fail(request, url, exc)
    track_gpo(request, sess, gid, snap, "gpo.permissions", f"Permission for {body['trustee']}", {"method": "PUT", "path": "permissions", "json": body})
    return ok(request, url, "Permissions updated.")


@router.get("/gpo/{gid}/report")
async def gpo_report(gid: str, request: Request, sess: Session = Depends(require_admin)):
    g = await _gpo(request, sess, gid)
    html = await call(request, sess, "GET", f"/gpo/{quote(gid, safe='')}/report", params={"format": "html"})
    srcdoc = ('<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">'
              + (html if isinstance(html, str) else ""))
    return await render(request, "admin/gpo_report.html", {"g": g, "gid": gid, "srcdoc": srcdoc, "tab_title": g.get("displayName")})


@router.get("/gpo/{gid}/report/download")
async def gpo_report_download(gid: str, request: Request, sess: Session = Depends(require_admin)):
    fmt = "xml" if request.query_params.get("format") == "xml" else "html"
    body = await call(request, sess, "GET", f"/gpo/{quote(gid, safe='')}/report", params={"format": fmt})
    safe = re.sub(r"[^A-Za-z0-9_-]", "", gid)[:64] or "gpo"
    return Response(body if isinstance(body, str) else "", media_type="text/html" if fmt == "html" else "application/xml",
                    headers={"Content-Disposition": f'attachment; filename="gpo-report-{safe}.{fmt}"',
                             "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'"})


# ---------------------------------------------------------------- Administrative Templates

def _cat_tree(cats: list[dict]) -> list[dict]:
    by_id = {c["id"]: {**c, "children": []} for c in cats if isinstance(c, dict) and c.get("id")}
    roots = []
    for c in by_id.values():
        p = c.get("parentId")
        (by_id[p]["children"] if p in by_id else roots).append(c)
    for c in by_id.values():
        c["children"].sort(key=lambda x: (x.get("name") or "").casefold())
    roots.sort(key=lambda x: (x.get("name") or "").casefold())
    return roots


@router.get("/gpo/{gid}/admx")
async def gpo_admx(gid: str, request: Request, sess: Session = Depends(require_admin)):
    g = await _gpo(request, sess, gid)
    cls = "User" if request.query_params.get("class") == "User" else "Machine"
    cat = request.query_params.get("category") or ""
    q = (request.query_params.get("q") or "").strip()
    cats = await call(request, sess, "GET", "/admx/categories") or []
    policies = []
    if cat or q:
        policies = await call(request, sess, "GET", "/admx/policies", params={"category": cat or None, "q": q or None, "class": cls}) or []
        policies = [p for p in policies if p.get("class") in (cls, "Both", None)]
    cat_name = next((c.get("name") for c in cats if c.get("id") == cat), "")
    return await render(request, "admin/admx.html", {
        "g": g, "gid": gid, "cls": cls, "cat": cat, "cat_name": cat_name, "q": q, "tree": _cat_tree(cats),
        "policies": policies, "tab_title": g.get("displayName")})


async def _find_policy(request, sess, pid: str, cat: str, cls: str) -> dict | None:
    for params in ({"category": cat or None, "class": cls}, {"q": pid, "class": cls}):
        rows = await call(request, sess, "GET", "/admx/policies", params=params) or []
        for p in rows:
            if p.get("id") == pid:
                return p
    return None


@router.get("/gpo/{gid}/admx/{pid}")
async def gpo_admx_policy(gid: str, pid: str, request: Request, sess: Session = Depends(require_admin)):
    g = await _gpo(request, sess, gid)
    cls = "User" if request.query_params.get("class") == "User" else "Machine"
    cat = request.query_params.get("category") or ""
    pol = await _find_policy(request, sess, pid, cat, cls)
    if not pol:
        raise HTTPException(404)
    state = await call(request, sess, "GET", f"/gpo/{quote(gid, safe='')}/admx/{quote(pid, safe='')}", params={"class": cls}) or {}
    return await render(request, "admin/admx_policy.html", {
        "g": g, "gid": gid, "cls": cls, "cat": cat, "p": pol, "state": state.get("state") or "NotConfigured",
        "values": state.get("values") or {}, "tab_title": pol.get("name")})


def admx_values(pol: dict, form) -> tuple[dict, str | None]:
    values: dict[str, Any] = {}
    for el in pol.get("elements") or []:
        eid, typ = el.get("id"), el.get("type")
        name = f"el_{eid}"
        label = el.get("label") or eid
        if typ == "boolean":
            values[eid] = form.get(name) == "on"
        elif typ == "decimal":
            raw = (form.get(name) or "").strip()
            if not raw:
                if el.get("required"):
                    return {}, f"{label}: a number is required."
                continue
            try:
                n = int(raw)
            except ValueError:
                return {}, f"{label}: enter a whole number."
            if el.get("min") is not None and n < int(el["min"]) or el.get("max") is not None and n > int(el["max"]):
                return {}, f"{label}: the number must be between {el.get('min')} and {el.get('max')}."
            values[eid] = n
        elif typ == "text":
            v = form.get(name) or ""
            if el.get("required") and not v:
                return {}, f"{label}: a value is required."
            if el.get("maxLength") and len(v) > int(el["maxLength"]):
                return {}, f"{label}: at most {el['maxLength']} characters."
            values[eid] = v
        elif typ == "multiText":
            values[eid] = [ln for ln in (form.get(name) or "").replace("\r", "").split("\n") if ln != ""]
        elif typ == "enum":
            v = form.get(name) or ""
            ids = [str(i.get("id")) for i in el.get("items") or []]
            if v not in ids:
                return {}, f"{label}: choose one of the options."
            values[eid] = v
        elif typ == "list":
            names = form.getlist(name + "_name")
            vals = form.getlist(name)
            if names and any(n.strip() for n in names):
                values[eid] = {n.strip(): v for n, v in zip(names, vals) if n.strip()}
            else:
                values[eid] = [v for v in vals if v.strip()]
    return values, None


@router.post("/gpo/{gid}/admx/{pid}", dependencies=CSRF)
async def gpo_admx_save(gid: str, pid: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    cls = "User" if form.get("class") == "User" else "Machine"
    cat = form.get("category") or ""
    url = f"/gpo/{quote(gid, safe='')}/admx/{quote(pid, safe='')}?class={cls}&category={quote(cat, safe='')}"
    state = form.get("state")
    if state not in ("NotConfigured", "Enabled", "Disabled"):
        return fail(request, url, "Choose Not configured, Enabled or Disabled.")
    values: dict = {}
    if state == "Enabled":
        pol = await _find_policy(request, sess, pid, cat, cls)
        if not pol:
            raise HTTPException(404)
        values, err = admx_values(pol, form)
        if err:
            return redirect(request, url, ("error", err))
    snap = await gpo_snapshot(request, sess, gid)
    try:
        await call(request, sess, "PUT", f"/gpo/{quote(gid, safe='')}/admx/{quote(pid, safe='')}", json={"class": cls, "state": state, "values": values})
    except AgentError as exc:
        return fail(request, url, exc)
    track_gpo(request, sess, gid, snap, "gpo.admx", f"{pid} set to {state}", {"method": "PUT", "path": f"admx/{pid}", "json": {"class": cls, "state": state, "values": values}})
    return ok(request, url, "Policy saved.")


# ---------------------------------------------------------------- security settings

def normalize_catalog(cat) -> dict[str, list[dict]]:
    """Accept {"sections": {name: [items]}} , {name: [items]} or [{"section",...}]."""
    out: dict[str, list[dict]] = {}
    if isinstance(cat, dict) and isinstance(cat.get("sections"), (dict, list)):
        cat = cat["sections"]
    if isinstance(cat, dict):
        for sec, items in cat.items():
            if isinstance(items, dict):
                items = [{"key": k, **(v if isinstance(v, dict) else {"label": str(v)})} for k, v in items.items()]
            out[sec] = [i for i in items or [] if isinstance(i, dict) and i.get("key")]
    elif isinstance(cat, list):
        for i in cat:
            if isinstance(i, dict) and i.get("key") and i.get("section"):
                out.setdefault(i["section"], []).append(i)
    return out


def sec_kind(section: str, item: dict) -> str:
    t = (item.get("type") or "").lower()
    if t in ("number", "int", "integer", "decimal"):
        return "number"
    if t in ("bool", "boolean"):
        return "bool"
    if t in ("audit",) or section == "Event Audit":
        return "audit"
    if t in ("principals", "sids", "users", "userright") or section == "Privilege Rights":
        return "principals"
    if t in ("select", "enum") and item.get("options"):
        return "select"
    return "text"


@router.get("/gpo/{gid}/security")
async def gpo_security(gid: str, request: Request, sess: Session = Depends(require_admin)):
    g = await _gpo(request, sess, gid)
    data = await call(request, sess, "GET", f"/gpo/{quote(gid, safe='')}/security") or {}
    sections = data.get("sections") or {}
    catalog = normalize_catalog(await call(request, sess, "GET", "/security/catalog") or {})
    forms = []
    for sec, items in catalog.items():
        current = sections.get(sec) or {}
        fields = []
        for it in items:
            kind = sec_kind(sec, it)
            val = current.get(it["key"])
            fields.append({**it, "kind": kind, "value": val,
                           "chips": [p.strip() for p in str(val or "").split(",") if p.strip()] if kind == "principals" else []})
        forms.append({"name": sec, "fields": fields})
    raw = {}
    for sec, vals in sections.items():
        known = {i["key"] for i in catalog.get(sec, [])}
        extra = {k: v for k, v in (vals or {}).items() if k not in known}
        raw[sec] = "\n".join(f"{k} = {v}" for k, v in extra.items())
    for sec in catalog:
        raw.setdefault(sec, "")
    return await render(request, "admin/security.html", {"g": g, "gid": gid, "forms": forms, "raw": raw,
                                                          "audit_choices": AUDIT_CHOICES, "tab_title": g.get("displayName")})


def parse_raw_section(text: str) -> dict[str, str]:
    out = {}
    for ln in (text or "").replace("\r", "").split("\n"):
        if not ln.strip() or ln.strip().startswith(";"):
            continue
        if "=" not in ln:
            raise ValueError(ln.strip()[:60])
        k, v = ln.split("=", 1)
        out[k.strip()] = v.strip()
    return out


@router.post("/gpo/{gid}/security", dependencies=CSRF)
async def gpo_security_save(gid: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    url = f"/gpo/{quote(gid, safe='')}/security"
    data = await call(request, sess, "GET", url) or {}
    sections: dict[str, dict] = {k: dict(v or {}) for k, v in (data.get("sections") or {}).items()}
    catalog = normalize_catalog(await call(request, sess, "GET", "/security/catalog") or {})
    for sec, items in catalog.items():
        cur = sections.setdefault(sec, {})
        for it in items:
            kind = sec_kind(sec, it)
            field = f"f::{sec}::{it['key']}"
            if kind == "bool":
                cur[it["key"]] = "1" if form.get(field) == "on" else "0"
                continue
            v = form.get(field)
            if v is None:
                continue
            v = v.strip()
            if v == "":
                cur.pop(it["key"], None)
                continue
            if kind == "number":
                if not re.fullmatch(r"-?\d+", v):
                    return redirect(request, url, ("error", f"{it.get('label') or it['key']}: enter a whole number."))
                n = int(v)
                if it.get("min") is not None and n < int(it["min"]) or it.get("max") is not None and n > int(it["max"]):
                    return redirect(request, url, ("error", f"{it.get('label') or it['key']}: must be between {it.get('min')} and {it.get('max')}."))
            if kind == "principals":
                v = ",".join(p.strip() for p in v.split(",") if p.strip())
            cur[it["key"]] = v
        raw = form.get(f"raw::{sec}")
        if raw is not None:
            known = {i["key"] for i in items}
            try:
                extra = parse_raw_section(raw)
            except ValueError:
                return redirect(request, url, ("error", flash_text(request, "Raw lines must look like Key = Value.")))
            for k in [k for k in cur if k not in known]:
                cur.pop(k)
            cur.update(extra)
    for key in form.keys():
        if key.startswith("raw::"):
            sec = key[5:]
            if sec in catalog:
                continue
            try:
                sections[sec] = parse_raw_section(form.get(key))
            except ValueError:
                return redirect(request, url, ("error", flash_text(request, "Raw lines must look like Key = Value.")))
    new_sec = (form.get("new_section") or "").strip()
    if new_sec and re.fullmatch(r"[A-Za-z][A-Za-z ]{1,60}", new_sec):
        sections.setdefault(new_sec, {})
    snap = await gpo_snapshot(request, sess, gid)
    try:
        await call(request, sess, "PUT", url, json={"sections": sections})
    except AgentError as exc:
        return fail(request, url, exc)
    track_gpo(request, sess, gid, snap, "gpo.security", "Security settings", {"method": "PUT", "path": url, "json": {"sections": sections}})
    return ok(request, url, "Security settings saved.")


# ================================================================ cmdlet runner

def cmdlet_input(param: dict) -> str:
    t = (param.get("type") or "").lower()
    if "switch" in t:
        return "switch"
    if t in ("bool", "boolean", "system.boolean"):
        return "bool"
    if any(x in t for x in ("int", "uint", "long", "double", "decimal")) and "[]" not in t:
        return "number"
    if t.endswith("[]") or "collection" in t or "list" in t:
        return "multi"
    if "securestring" in t:
        return "secret"
    if "hashtable" in t or "dictionary" in t:
        return "json"
    return "text"


@router.get("/cmdlets")
async def cmdlets(request: Request, sess: Session = Depends(require_admin)):
    scope = "all" if request.query_params.get("scope") == "all" else None
    if scope and not sess.elevated:
        return RedirectResponse("/auth/elevate?next=" + quote("/cmdlets?scope=all", safe="/"), status_code=303)
    rows = await call(request, sess, "GET", "/cmdlets", params={"scope": scope}, elevation=sess.elevation_token() if scope else None) or []
    for r in rows:
        r["paramCount"] = len(r.get("parameters") or [])
    tv, err = view(request, rows, [("name", "Cmdlet"), ("module", "Module"), ("verb", "Verb"), ("noun", "Noun"), ("paramCount", "Parameters")], id="cmdlets", key="name", filename="cmdlets")
    if isinstance(tv, Response):
        return tv
    return await render(request, "admin/cmdlets.html", {"tv": tv, "regex_error": err, "scope": scope})


@router.get("/cmdlets/run")
async def cmdlet_form(request: Request, sess: Session = Depends(require_admin)):
    name = request.query_params.get("name") or ""
    scope = "all" if request.query_params.get("scope") == "all" else None
    rows = await call(request, sess, "GET", "/cmdlets", params={"scope": scope}, elevation=sess.elevation_token() if scope else None) or []
    c = next((r for r in rows if r.get("name") == name), None)
    if not c:
        raise HTTPException(404)
    params = [{**p, "input": cmdlet_input(p)} for p in c.get("parameters") or []]
    sets = sorted({s for p in params for s in (p.get("sets") or []) if s and s != "__AllParameterSets"})
    return await render(request, "admin/cmdlet_run.html", {
        "c": c, "params": params, "sets": sets, "destructive": name.startswith(DESTRUCTIVE_CMDLET),
        "result": None, "scope": scope, "tab_title": name})


@router.post("/cmdlets/run", dependencies=CSRF)
async def cmdlet_run(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    name = form.get("name") or ""
    scope = "all" if form.get("scope") == "all" else None
    rows = await call(request, sess, "GET", "/cmdlets", params={"scope": scope}, elevation=sess.elevation_token() if scope else None) or []
    c = next((r for r in rows if r.get("name") == name), None)
    if not c:
        raise HTTPException(404)
    params_meta = [{**p, "input": cmdlet_input(p)} for p in c.get("parameters") or []]
    parameters: dict[str, Any] = {}
    error = None
    for p in params_meta:
        field = "p_" + p["name"]
        kind = p["input"]
        if kind == "switch":
            if form.get(field) == "on":
                parameters[p["name"]] = True
            continue
        raw = form.get(field)
        if raw is None or raw.strip() == "":
            if p.get("mandatory") and not (p.get("sets") and len(p["sets"]) > 1):
                pass  # let the agent decide; mandatory may depend on the parameter set
            continue
        if kind == "bool":
            parameters[p["name"]] = raw == "true"
        elif kind == "number":
            try:
                parameters[p["name"]] = float(raw) if "." in raw else int(raw)
            except ValueError:
                error = f"{p['name']}: enter a number."
        elif kind == "multi":
            parameters[p["name"]] = lines(raw)
        elif kind == "json":
            try:
                parameters[p["name"]] = json.loads(raw)
            except ValueError:
                error = f"{p['name']}: enter valid JSON."
        else:
            parameters[p["name"]] = raw
    body: dict[str, Any] = {"name": name, "parameters": parameters, "whatIf": form.get("whatIf") == "on"}
    destructive = name.startswith(DESTRUCTIVE_CMDLET)
    if destructive:
        if (form.get("confirm") or "").strip() != name and not body["whatIf"]:
            error = flash_text(request, "Type the cmdlet name to confirm this destructive cmdlet.")
        body["confirm"] = (form.get("confirm") or "").strip()
    if scope:
        body["scope"] = "all"
    result = None
    if not error:
        try:
            result = await call(request, sess, "POST", "/cmdlets/invoke", json=body, elevation=sess.elevation_token())
        except AgentError as exc:
            error = agent_message(request, exc)
    sets = sorted({s for p in params_meta for s in (p.get("sets") or []) if s and s != "__AllParameterSets"})
    return await render(request, "admin/cmdlet_run.html", {
        "c": c, "params": params_meta, "sets": sets, "destructive": destructive, "result": result,
        "error_text": error, "submitted": dict(form), "scope": scope, "tab_title": name}, headers=NO_STORE)


# ================================================================ samba-tool runner

@router.get("/sambatool")
async def sambatool(request: Request, sess: Session = Depends(require_admin)):
    rows = await call(request, sess, "GET", "/sambatool") or []
    for r in rows:
        r["argCount"] = len(r.get("args") or [])
        r["destructive"] = bool(DESTRUCTIVE_SAMBA.search(r.get("command") or ""))
    tv, err = view(request, rows, [("command", "Command"), ("argCount", "Arguments"), ("destructive", "Needs confirmation")], id="sambatool", key="command", filename="samba-tool")
    if isinstance(tv, Response):
        return tv
    return await render(request, "admin/sambatool.html", {"tv": tv, "regex_error": err})


@router.get("/sambatool/run")
async def sambatool_form(request: Request, sess: Session = Depends(require_admin)):
    cmd = request.query_params.get("command") or ""
    rows = await call(request, sess, "GET", "/sambatool") or []
    c = next((r for r in rows if r.get("command") == cmd), None)
    if not c:
        raise HTTPException(404)
    return await render(request, "admin/sambatool_run.html", {"c": c, "destructive": bool(DESTRUCTIVE_SAMBA.search(cmd)), "result": None})


def build_argv(c: dict, form) -> list[str]:
    argv: list[str] = []
    for a in c.get("args") or []:
        field = "a_" + a["name"]
        flag = a.get("flag") or ""
        typ = (a.get("type") or "string").lower()
        if typ in ("bool", "boolean", "switch", "flag"):
            if form.get(field) == "on":
                argv.append(flag or a["name"])
            continue
        v = (form.get(field) or "").strip()
        if not v:
            continue
        if flag:
            argv.append(f"{flag}={v}" if flag.startswith("--") else flag)
            if not flag.startswith("--"):
                argv.append(v)
        else:
            argv.append(v)
    argv += lines(form.get("extra"))
    return argv


@router.post("/sambatool/run", dependencies=CSRF)
async def sambatool_run(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    cmd = form.get("command") or ""
    rows = await call(request, sess, "GET", "/sambatool") or []
    c = next((r for r in rows if r.get("command") == cmd), None)
    if not c:
        raise HTTPException(404)
    destructive = bool(DESTRUCTIVE_SAMBA.search(cmd))
    argv = build_argv(c, form)
    body: dict[str, Any] = {"command": cmd, "args": argv}
    error, result = None, None
    if destructive:
        if (form.get("confirm") or "").strip() != cmd:
            error = flash_text(request, "Type the command to confirm this destructive command.")
        body["confirm"] = (form.get("confirm") or "").strip()
    if not error:
        try:
            result = await call(request, sess, "POST", "/sambatool/invoke", json=body)
        except AgentError as exc:
            error = agent_message(request, exc)
    return await render(request, "admin/sambatool_run.html", {"c": c, "destructive": destructive, "result": result,
                                                              "argv": argv, "error_text": error, "submitted": dict(form)}, headers=NO_STORE)


# ================================================================ presetup: Wi-Fi

@router.get("/wifi")
async def wifi(request: Request, sess: Session = Depends(require_admin)):
    rows = await call(request, sess, "GET", "/wifi") or []
    tv, err = view(request, rows, [("ssid", "Network name"), ("auth", "Security"), ("hidden", "Hidden"), ("autoConnect", "Connect automatically")], id="wifi", key="id", filename="wifi")
    if isinstance(tv, Response):
        return tv
    edit = None
    eid = request.query_params.get("edit")
    if eid:
        edit = next((r for r in rows if r.get("id") == eid), None)
    return await render(request, "admin/wifi.html", {"tv": tv, "regex_error": err, "edit": edit, "auths": WIFI_AUTH,
                                                     "bulk_token": confirm_token(request, "bulk-delete-wifi", "delete")})


@router.post("/wifi", dependencies=CSRF)
async def wifi_save(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    ssid = (form.get("ssid") or "").strip()
    auth = form.get("auth")
    key = form.get("key") or ""
    pid = form.get("id") or ""
    if not 1 <= len(ssid.encode()) <= 32:
        return fail(request, "/wifi", "The network name must be 1 to 32 bytes.")
    if auth not in WIFI_AUTH:
        return fail(request, "/wifi", "Choose a security type.")
    if auth != "open" and key and not 8 <= len(key) <= 63:
        return fail(request, "/wifi", "The Wi-Fi key must be 8 to 63 characters.")
    if auth != "open" and not key and not pid:
        return fail(request, "/wifi", "Enter the Wi-Fi key for a new secured network.")
    if not pid:
        pid = re.sub(r"[^A-Za-z0-9-]", "-", ssid).strip("-")[:40].lower() or "wifi"
        pid = f"{pid}-{uuid.uuid4().hex[:6]}"
    body = {"ssid": ssid, "auth": auth, "hidden": form.get("hidden") == "on", "autoConnect": form.get("autoConnect") == "on"}
    if key:
        body["key"] = key
    existing = None
    try:
        existing = next((w for w in await call(request, sess, "GET", "/wifi") or [] if w.get("id") == pid), None)
        await call(request, sess, "PUT", f"/wifi/{quote(pid, safe='')}", json=body)
    except AgentError as exc:
        return fail(request, "/wifi", exc)
    if existing is None:
        inv, reason = http_inv("DELETE", f"/wifi/{quote(pid, safe='')}"), ""
    elif key:
        inv, reason = None, "The previous Wi-Fi key is never stored, so a key change cannot be undone."
    else:
        inv, reason = http_inv("PUT", f"/wifi/{quote(pid, safe='')}", None, {k: existing.get(k) for k in ("ssid", "auth", "hidden", "autoConnect")}), ""
    track(request, sess, action="wifi.save", target=f"wifi:{pid}", summary=f"Save Wi-Fi profile {ssid}",
          request={"method": "PUT", "path": f"/wifi/{pid}", "json": body}, before=existing, inverse=inv,
          undoable=inv is not None, reason=reason)
    return ok(request, "/wifi", "Saved {name}.", name=ssid)


@router.post("/wifi/{pid}/delete", dependencies=CSRF)
async def wifi_delete(pid: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    if not super_ok(request, form, "delete-wifi", form.get("ssid") or "") :
        return fail(request, "/wifi", "Deletion was not confirmed. Type the name and hold the button.")
    try:
        await call(request, sess, "DELETE", f"/wifi/{quote(pid, safe='')}")
    except AgentError as exc:
        return fail(request, "/wifi", exc)
    track(request, sess, action="wifi.delete", target=f"wifi:{pid}", summary=f"Delete Wi-Fi profile {form.get('ssid') or pid}",
          request={"method": "DELETE", "path": f"/wifi/{pid}"}, undoable=False,
          reason="The Wi-Fi key is never stored, so a deleted profile cannot be restored. Import it again instead.")
    return ok(request, "/wifi", "Deleted {name}.", name=form.get("ssid") or pid)


@router.get("/wifi/{pid}/delete")
async def wifi_delete_page(pid: str, request: Request, sess: Session = Depends(require_admin)):
    rows = await call(request, sess, "GET", "/wifi") or []
    w = next((r for r in rows if r.get("id") == pid), None)
    if not w:
        raise HTTPException(404)
    return await render(request, "admin/confirm_delete.html", {
        "what": w["ssid"], "kind_key": "Wi-Fi profile", "action": f"/wifi/{quote(pid, safe='')}/delete",
        "token": confirm_token(request, "delete-wifi", w["ssid"]), "back": "/wifi", "extra": {"ssid": w["ssid"]}})


@router.post("/wifi/bulk", dependencies=CSRF)
async def wifi_bulk(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    ids = [i for i in form.getlist("sel") if i]
    if not ids:
        return fail(request, "/wifi", "Select at least one row first.")
    if form.get("bulk") != "delete" or not super_ok(request, form, "bulk-delete-wifi", "delete"):
        return fail(request, "/wifi", "Bulk delete was not confirmed. Type delete and hold the button.")
    done, errors = 0, []
    for i in ids:
        try:
            await call(request, sess, "DELETE", f"/wifi/{quote(i, safe='')}")
            done += 1
        except AgentError as exc:
            errors.append(f"{i}: {exc.message}")
    return bulk_result(request, "/wifi", done, errors)


# ================================================================ presetup: scripts

@router.get("/scripts")
async def scripts(request: Request, sess: Session = Depends(require_admin)):
    rows = []
    for kind in ("startup", "logon"):
        rows += await call(request, sess, "GET", "/scripts", params={"kind": kind}) or []
    for r in rows:
        r["ref"] = f"{r.get('kind')}/{r.get('name')}"
    tv, err = view(request, rows, [("name", "Name"), ("kind", "Kind"), ("size", "Size (bytes)"), ("modified", "Modified")], id="scripts", key="ref", filename="scripts")
    if isinstance(tv, Response):
        return tv
    return await render(request, "admin/scripts.html", {"tv": tv, "regex_error": err,
                                                        "bulk_token": confirm_token(request, "bulk-delete-scripts", "delete")})


def _script_ok(kind: str, name: str) -> bool:
    return kind in ("startup", "logon") and bool(SCRIPT_RE.fullmatch(name)) and name.lower().endswith((".ps1", ".cmd"))


@router.get("/scripts/{kind}/{name}")
async def script_edit(kind: str, name: str, request: Request, sess: Session = Depends(require_admin)):
    if not _script_ok(kind, name) and name != "new":
        raise HTTPException(404)
    content = ""
    if name != "new":
        res = await call(request, sess, "GET", f"/scripts/{kind}/{quote(name, safe='')}") or {}
        content = res.get("content") or ""
    return await render(request, "admin/script_edit.html", {"kind": kind, "name": "" if name == "new" else name,
                                                            "content": content, "is_new": name == "new",
                                                            "delete_token": confirm_token(request, "delete-script", name),
                                                            "tab_title": name})


@router.post("/scripts/save", dependencies=CSRF)
async def script_save(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    kind, name = form.get("kind") or "", (form.get("name") or "").strip()
    if not _script_ok(kind, name):
        return fail(request, "/scripts", "Script names may use letters, digits, dot, dash and underscore, up to 64 characters, ending in .ps1 or .cmd.")
    if len((form.get("content") or "").encode()) > 1024 * 1024:
        return fail(request, "/scripts", "Scripts are limited to 1 MB.")
    spath = f"/scripts/{kind}/{quote(name, safe='')}"
    try:
        old = (await call(request, sess, "GET", spath) or {}).get("content")
    except AgentError:
        old = None
    new = form.get("content") or ""
    try:
        await call(request, sess, "PUT", spath, json={"content": new})
    except AgentError as exc:
        return fail(request, spath, exc)
    hist = request.app.state.history
    if old is not None and not hist.list(f"script-{kind}", name):
        hist.record(f"script-{kind}", name, old, "(before history)")
    hist.record(f"script-{kind}", name, new, str(sess.user.get("sam") or "admin"))
    track(request, sess, action="script.save", target=f"script:{kind}/{name}", summary=f"Save {kind} script {name}",
          request={"method": "PUT", "path": spath, "json": {"content": new}}, before=old, after=new,
          inverse=http_inv("PUT", spath, None, {"content": old}) if old is not None else http_inv("DELETE", spath),
          check=check_spec(spath, None, "content"))
    return ok(request, f"/scripts/{kind}/{quote(name, safe='')}", "Saved {name}.", name=name)


@router.post("/scripts/{kind}/{name}/delete", dependencies=CSRF)
async def script_delete(kind: str, name: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    if not _script_ok(kind, name):
        raise HTTPException(404)
    if not super_ok(request, form, "delete-script", name):
        return fail(request, f"/scripts/{kind}/{quote(name, safe='')}", "Deletion was not confirmed. Type the name and hold the button.")
    spath = f"/scripts/{kind}/{quote(name, safe='')}"
    try:
        old = (await call(request, sess, "GET", spath) or {}).get("content")
        await call(request, sess, "DELETE", spath)
    except AgentError as exc:
        return fail(request, "/scripts", exc)
    track(request, sess, action="script.delete", target=f"script:{kind}/{name}", summary=f"Delete {kind} script {name}",
          request={"method": "DELETE", "path": spath}, before=old, after=None,
          inverse=http_inv("PUT", spath, None, {"content": old or ""}))
    return ok(request, "/scripts", "Deleted {name}.", name=name)


@router.post("/scripts/bulk", dependencies=CSRF)
async def scripts_bulk(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    refs = [r for r in form.getlist("sel") if "/" in r]
    if not refs:
        return fail(request, "/scripts", "Select at least one row first.")
    if form.get("bulk") != "delete" or not super_ok(request, form, "bulk-delete-scripts", "delete"):
        return fail(request, "/scripts", "Bulk delete was not confirmed. Type delete and hold the button.")
    done, errors = 0, []
    for ref in refs:
        kind, name = ref.split("/", 1)
        if not _script_ok(kind, name):
            continue
        try:
            await call(request, sess, "DELETE", f"/scripts/{kind}/{quote(name, safe='')}")
            done += 1
        except AgentError as exc:
            errors.append(f"{name}: {exc.message}")
    return bulk_result(request, "/scripts", done, errors)


# ================================================================ presetup: allowlist

@router.get("/allowlist")
async def allowlist(request: Request, sess: Session = Depends(require_admin)):
    data = await call(request, sess, "GET", "/allowlist") or {"enabled": False, "apps": []}
    rows = [{"app": a} for a in data.get("apps") or []]
    tv, err = view(request, rows, [("app", "Program")], id="apps", key="app", filename="allowlist")
    if isinstance(tv, Response):
        return tv
    return await render(request, "admin/allowlist.html", {"data": data, "tv": tv, "regex_error": err})


@router.post("/allowlist", dependencies=CSRF)
async def allowlist_save(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    data = await call(request, sess, "GET", "/allowlist") or {"enabled": False, "apps": []}
    apps = list(data.get("apps") or [])
    op = form.get("op") or "replace"
    if op == "replace":
        apps = lines(form.get("apps"))
    elif op == "add":
        apps += [a for a in lines(form.get("apps")) if a not in apps]
    elif op == "remove":
        sel = set(form.getlist("sel"))
        apps = [a for a in apps if a not in sel]
    bad = [a for a in apps if not EXE_RE.fullmatch(a)]
    if bad:
        return redirect(request, "/allowlist", ("error", flash_text(request, "Each entry must be a program file name ending in .exe, for example msedge.exe.") + " " + ", ".join(bad[:5])))
    seen, uniq = set(), []
    for a in apps:
        if a.lower() not in seen:
            seen.add(a.lower())
            uniq.append(a)
    enabled = form.get("enabled") == "on" if op == "replace" else bool(data.get("enabled"))
    try:
        await call(request, sess, "PUT", "/allowlist", json={"enabled": enabled, "apps": uniq})
    except AgentError as exc:
        return fail(request, "/allowlist", exc)
    track(request, sess, action="allowlist.update", target="allowlist", summary="Edit the app allowlist",
          request={"method": "PUT", "path": "/allowlist", "json": {"enabled": enabled, "apps": uniq}},
          before=data, after={"enabled": enabled, "apps": uniq}, inverse=http_inv("PUT", "/allowlist", None, data),
          check=check_spec("/allowlist"))
    return ok(request, "/allowlist", "Allowlist saved.")


# ================================================================ settings and personal wording

@router.get("/settings")
async def settings_page(request: Request, sess: Session = Depends(require_admin)):
    doc, err = None, None
    try:
        doc = await call(request, sess, "GET", "/settings")
    except AgentError as exc:
        err = agent_message(request, exc)
    voc = request.app.state.vocab
    return await render(request, "admin/settings.html", {
        "doc": doc or {}, "doc_error": err, "fields": settings_schema.FIELDS, "errors": {},
        "wording": {"count": voc.count, "updated": voc.updated, "invalid": voc.load_error},
    })


@router.post("/settings", dependencies=CSRF)
async def settings_save(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    current = await call(request, sess, "GET", "/settings") or {}
    doc = settings_schema.from_form(form, current)
    clean, errors = settings_schema.validate_settings(doc)
    if errors:
        voc = request.app.state.vocab
        return await render(request, "admin/settings.html", {
            "doc": doc, "doc_error": None, "fields": settings_schema.FIELDS, "errors": errors,
            "wording": {"count": voc.count, "updated": voc.updated, "invalid": voc.load_error}}, status=400)
    try:
        await call(request, sess, "PUT", "/settings", json=clean)
    except AgentError as exc:
        return fail(request, "/settings", exc)
    from .history import settings_text

    hist = request.app.state.history
    if not hist.list("settings", "settings"):
        hist.record("settings", "settings", settings_text(current), "(before history)")
    hist.record("settings", "settings", settings_text(clean), str(sess.user.get("sam") or "admin"))
    track(request, sess, action="settings.update", target="settings", summary="Edit TempDesk settings",
          request={"method": "PUT", "path": "/settings", "json": clean}, before=current, after=clean,
          inverse=http_inv("PUT", "/settings", None, current), check=check_spec("/settings"))
    return ok(request, "/settings", "Settings saved.")


@router.post("/settings/wording", dependencies=CSRF)
async def wording_upload(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    up = form.get("file")
    if up is None or not hasattr(up, "read"):
        return fail(request, "/settings#wording", "Choose a JSON file first.")
    raw = await up.read(256 * 1024 + 1)
    try:
        entries = request.app.state.vocab.apply(raw)
    except WordingError as exc:
        return redirect(request, "/settings#wording", ("error", tr(request).plain("This file was not applied", serious=True) + ": " + str(exc)))
    resp = redirect(request, "/settings#wording", ("success", flash_text(request, "Personal wording loaded: {count} entries.", count=len(entries))))
    return resp


@router.post("/api/wording", dependencies=CSRF)
async def wording_api(request: Request, sess: Session = Depends(require_admin)):
    """Drag-and-drop upload. Body is the raw JSON file."""
    raw = b""
    async for chunk in request.stream():
        raw += chunk
        if len(raw) > 256 * 1024:
            break
    try:
        entries = request.app.state.vocab.apply(raw)
    except WordingError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=400)
    return JSONResponse({"ok": True, "count": len(entries), "headline": headline_for(entries)})


@router.post("/settings/wording/clear", dependencies=CSRF)
async def wording_clear(request: Request, sess: Session = Depends(require_admin)):
    try:
        request.app.state.vocab.clear()
    except WordingError as exc:
        return redirect(request, "/settings#wording", ("error", str(exc)))
    return ok(request, "/settings#wording", "Personal wording cleared. The original wording is back.")


@router.post("/settings/logo", dependencies=CSRF)
async def logo_upload(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    d = data_dir(request)
    if form.get("op") == "clear":
        for n in ("logo.bin", "logo.type"):
            try:
                (d / n).unlink()
            except FileNotFoundError:
                pass
        return ok(request, "/settings#appearance", "Logo removed.")
    up = form.get("file")
    if up is None or not hasattr(up, "read"):
        return fail(request, "/settings#appearance", "Choose an image first.")
    raw = await up.read(512 * 1024 + 1)
    if len(raw) > 512 * 1024:
        return fail(request, "/settings#appearance", "The logo must be 512 KB or smaller.")
    ctype = next((t for magic, t in LOGO_TYPES.items() if raw.startswith(magic)), None)
    if ctype == "image/webp" and raw[8:12] != b"WEBP":
        ctype = None
    if not ctype:
        return fail(request, "/settings#appearance", "Use a PNG, JPEG or WebP image.")
    d.mkdir(parents=True, exist_ok=True)
    for name, data in (("logo.bin", raw), ("logo.type", ctype.encode())):
        fd = os.open(d / name, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
    return ok(request, "/settings#appearance", "Logo saved. The guest portal shows it too.")


# ================================================================ onboarding

STEPS = [
    {"id": "health", "title": "Check the agent", "optional": False},
    {"id": "org", "title": "Organization name and welcome text", "optional": False},
    {"id": "expiry", "title": "Expiry choices", "optional": True},
    {"id": "wifi", "title": "Wi-Fi profile", "optional": True},
    {"id": "allowlist", "title": "App allowlist review", "optional": True},
    {"id": "done", "title": "Done", "optional": False},
]


@router.get("/welcome")
async def welcome(request: Request, sess: Session = Depends(require_admin)):
    path = data_dir(request) / "onboarding.json"
    state = read_json_file(path, {})
    try:
        step = int(request.query_params.get("step") or state.get("step") or 1)
    except ValueError:
        step = 1
    step = max(1, min(len(STEPS), step))
    ctx: dict[str, Any] = {"steps": STEPS, "step": step, "s": STEPS[step - 1], "state": state}
    sid = STEPS[step - 1]["id"]
    if sid == "health":
        ctx["health"] = await agent(request).health(force=True)
    elif sid in ("org", "expiry"):
        ctx["doc"] = await call(request, sess, "GET", "/settings") or {}
    elif sid == "wifi":
        ctx["wifi"] = await call(request, sess, "GET", "/wifi") or []
    elif sid == "allowlist":
        ctx["allow"] = await call(request, sess, "GET", "/allowlist") or {"enabled": False, "apps": []}
    if state.get("step") != step and not state.get("done"):
        state["step"] = step
        try:
            write_json_file(path, state)
        except OSError:
            pass
    return await render(request, "admin/welcome.html", ctx)


@router.post("/welcome", dependencies=CSRF)
async def welcome_post(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    path = data_dir(request) / "onboarding.json"
    state = read_json_file(path, {})
    try:
        step = int(form.get("step") or 1)
    except ValueError:
        step = 1
    step = max(1, min(len(STEPS), step))
    sid = STEPS[step - 1]["id"]
    nav = form.get("nav") or "next"
    if nav == "back":
        return RedirectResponse(f"/welcome?step={max(1, step - 1)}", status_code=303)
    if nav == "skip":
        state.setdefault("skipped", [])
        if sid not in state["skipped"]:
            state["skipped"].append(sid)
    elif nav == "next":
        try:
            if sid == "org":
                doc = await call(request, sess, "GET", "/settings") or {}
                doc["orgName"] = (form.get("orgName") or "").strip()
                doc["welcomeText"] = (form.get("welcomeText") or "").strip()
                clean, errors = settings_schema.validate_settings(doc)
                if errors:
                    return redirect(request, f"/welcome?step={step}", ("error", " ".join(errors.values())))
                await call(request, sess, "PUT", "/settings", json=clean)
            elif sid == "expiry":
                doc = await call(request, sess, "GET", "/settings") or {}
                doc = settings_schema.from_form(form, doc) if form.getlist("exp_id") else doc
                doc["allowPermanent"] = form.get("allowPermanent") == "on"
                for k, *_ in settings_schema.FIELDS:
                    pass
                clean, errors = settings_schema.validate_settings(doc)
                if "expiryChoices" in errors:
                    return redirect(request, f"/welcome?step={step}", ("error", errors["expiryChoices"]))
                await call(request, sess, "PUT", "/settings", json=clean)
            elif sid == "wifi" and (form.get("ssid") or "").strip():
                ssid = form.get("ssid").strip()
                auth = form.get("auth") if form.get("auth") in WIFI_AUTH else "WPA2PSK"
                key = form.get("key") or ""
                if auth != "open" and not 8 <= len(key) <= 63:
                    return redirect(request, f"/welcome?step={step}", ("error", flash_text(request, "The Wi-Fi key must be 8 to 63 characters.")))
                pid = (re.sub(r"[^A-Za-z0-9-]", "-", ssid).strip("-")[:40].lower() or "wifi") + "-" + uuid.uuid4().hex[:6]
                body = {"ssid": ssid, "auth": auth, "hidden": False, "autoConnect": True}
                if key:
                    body["key"] = key
                await call(request, sess, "PUT", f"/wifi/{pid}", json=body)
            elif sid == "allowlist" and form.get("apps") is not None:
                apps = lines(form.get("apps"))
                bad = [a for a in apps if not EXE_RE.fullmatch(a)]
                if bad:
                    return redirect(request, f"/welcome?step={step}", ("error", flash_text(request, "Each entry must be a program file name ending in .exe, for example msedge.exe.")))
                await call(request, sess, "PUT", "/allowlist", json={"enabled": form.get("enabled") == "on", "apps": apps})
            elif sid == "done":
                state["done"] = True
                state["finished"] = datetime.now(timezone.utc).isoformat()
                write_json_file(path, state)
                return ok(request, "/", "Setup complete.")
        except AgentError as exc:
            return fail(request, f"/welcome?step={step}", exc)
    elif nav == "dismiss":
        state["done"] = True
        write_json_file(path, state)
        return RedirectResponse("/", status_code=303)
    state["step"] = min(len(STEPS), step + 1)
    try:
        write_json_file(path, state)
    except OSError:
        pass
    return RedirectResponse(f"/welcome?step={state['step']}", status_code=303)


@router.post("/welcome/restart", dependencies=CSRF)
async def welcome_restart(request: Request, sess: Session = Depends(require_admin)):
    write_json_file(data_dir(request) / "onboarding.json", {"step": 1})
    return RedirectResponse("/welcome?step=1", status_code=303)


# ================================================================ audit, docs, changelog

@router.get("/audit")
async def audit(request: Request, sess: Session = Depends(require_admin)):
    try:
        limit = max(1, min(5000, int(request.query_params.get("limit") or 200)))
    except ValueError:
        limit = 200
    rows = await call(request, sess, "GET", "/audit", params={"limit": limit}) or []
    rows = [r if isinstance(r, dict) else {"message": str(r)} for r in rows]
    cols = audit_columns(rows) or [("message", "Message")]
    tv, err = view(request, rows, cols, id="audit", filename="audit", default_sort=cols[0][0])
    if isinstance(tv, Response):
        return tv
    if "sort" not in request.query_params:
        tv.rows = list(reversed(tv.rows)) if cols[0][0] in ("time", "timeCreated") else tv.rows
    return await render(request, "admin/audit.html", {"tv": tv, "regex_error": err, "limit": limit})


@router.get("/docs")
async def docs(request: Request, sess: Session = Depends(require_admin)):
    q = (request.query_params.get("q") or "").strip()
    return await render(request, "admin/docs.html", {"docs": docs_index(q), "q": q, "doc": None})


@router.get("/docs/{name}")
async def doc(name: str, request: Request, sess: Session = Depends(require_admin)):
    d = render_doc(name)
    if not d:
        raise HTTPException(404)
    return await render(request, "admin/docs.html", {"docs": docs_index(""), "q": "", "doc": d, "tab_title": d["title"]})


@router.get("/changelog")
async def changelog(request: Request, sess: Session = Depends(require_admin)):
    return await render(request, "admin/changelog.html", {"html": changelog_html()})


Markup
time
