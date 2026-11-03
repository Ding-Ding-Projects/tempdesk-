"""JSON endpoints behind the control room console: the live pulse (home tiles,
sparklines, timeline, activity), global find for the command bar, and the
directory studio helpers. Every call carries the signed-in administrator's
bearer token; writes go through the undo journal like the form routes."""

from __future__ import annotations

import base64
import json
import re
import struct
import time
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from . import nav as navmod
from .agent_client import AgentError, AgentUnavailable
from .security import Session
from .undo_routes import check_spec, http_inv, journal, track, user_of
from .web import agent_message, csrf_protect, has_cap, render, require_admin, translator_for

router = APIRouter()
CSRF = [Depends(csrf_protect)]
NO_STORE = {"Cache-Control": "no-store"}


async def call(request: Request, sess: Session, method: str, path: str, **kw) -> Any:
    return await request.app.state.agent.call(method, path, token=sess.token, **kw)


def err_json(request: Request, exc: Exception, status: int = 400) -> JSONResponse:
    if isinstance(exc, AgentError):
        return JSONResponse({"ok": False, "message": agent_message(request, exc), "code": exc.code}, status_code=exc.status if 400 <= exc.status < 600 else 502)
    if isinstance(exc, AgentUnavailable):
        return JSONResponse({"ok": False, "message": translator_for(request).plain("The agent cannot be reached", serious=True)}, status_code=503)
    return JSONResponse({"ok": False, "message": str(exc)}, status_code=status)


def parse_iso(v) -> float | None:
    if not v or not isinstance(v, str):
        return None
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


# ================================================================ pulse

@router.get("/api/console/pulse")
async def pulse(request: Request, sess: Session = Depends(require_admin)):
    health = await request.app.state.agent.health(force=True)
    caps = set((health or {}).get("capabilities") or [])
    out: dict[str, Any] = {"time": time.time(), "health": health, "guests": None, "metrics": None, "audit": [], "undo": []}
    if health is None:
        return JSONResponse(out, headers=NO_STORE)
    if "guest" in caps:
        try:
            rows = await call(request, sess, "GET", "/guests") or []
            out["guests"] = [{"username": g.get("username"), "displayName": g.get("displayName") or "", "created": g.get("created"),
                              "expiresAt": g.get("expiresAt"), "enabled": bool(g.get("enabled")), "lastLogon": g.get("lastLogon"),
                              "computer": g.get("computer") or g.get("lastComputer") or ""} for g in rows if isinstance(g, dict)]
        except (AgentError, AgentUnavailable):
            out["guests"] = None
    try:
        out["metrics"] = await call(request, sess, "GET", "/server/metrics")
    except (AgentError, AgentUnavailable):
        out["metrics"] = None
    if "audit" in caps:
        try:
            a = await call(request, sess, "GET", "/audit", params={"limit": 12}) or []
            out["audit"] = a[-12:] if isinstance(a, list) else []
        except (AgentError, AgentUnavailable):
            pass
    recs = list(reversed(journal(request).all()))[:12]
    out["undo"] = [{"id": r.get("id"), "time": r.get("time"), "user": r.get("user"), "summary": r.get("summary"),
                    "action": r.get("action"), "status": r.get("status"), "undoable": bool(r.get("undoable")) and r.get("status") == "done" and not r.get("undoOf")}
                   for r in recs]
    return JSONResponse(out, headers=NO_STORE)


# ================================================================ find (command bar fallback)

@router.get("/api/console/find")
async def find_api(request: Request, sess: Session = Depends(require_admin)):
    q = (request.query_params.get("q") or "").strip()
    return JSONResponse(await _find(request, sess, q), headers=NO_STORE)


async def _find(request: Request, sess: Session, q: str) -> dict:
    res: dict[str, list] = {"guests": [], "objects": [], "gpos": [], "pages": []}
    if not q:
        return res
    ql = q.casefold()
    tr = translator_for(request)
    caps = getattr(request.state, "caps", None)
    if caps is None:
        h = await request.app.state.agent.health()
        caps = set((h or {}).get("capabilities") or [])
    for it in navmod.visible(navmod.NAV_ITEMS + navmod.PALETTE_ACTIONS, caps):
        label = tr.plain(it["label"])
        if ql in label.casefold() or ql in it.get("keywords", "").casefold():
            res["pages"].append({"label": label, "href": it["href"]})
    if "guest" in caps:
        try:
            for g in await call(request, sess, "GET", "/guests") or []:
                if ql in (g.get("username") or "").casefold() or ql in (g.get("displayName") or "").casefold():
                    res["guests"].append({"username": g.get("username"), "displayName": g.get("displayName") or "", "expiresAt": g.get("expiresAt")})
        except (AgentError, AgentUnavailable):
            pass
    if "directory" in caps:
        safe = re.sub(r"[()\\*\x00]", "", q)[:64]
        if safe:
            try:
                rows = await call(request, sess, "GET", "/ad/search", params={
                    "filter": f"(|(name=*{safe}*)(sAMAccountName=*{safe}*)(displayName=*{safe}*))", "scope": "sub",
                    "attrs": "name,objectClass,sAMAccountName", "limit": "25"}) or []
                for r in rows[:25]:
                    a = r.get("attributes") or {}
                    oc = a.get("objectClass") or []
                    res["objects"].append({"dn": r.get("dn"), "name": _first(a.get("name")) or r.get("dn"),
                                           "class": (oc[-1] if isinstance(oc, list) and oc else oc) or ""})
            except (AgentError, AgentUnavailable):
                pass
    if "gpo" in caps:
        try:
            for g in await call(request, sess, "GET", "/gpo") or []:
                if ql in (g.get("displayName") or "").casefold():
                    res["gpos"].append({"id": g.get("id"), "name": g.get("displayName")})
        except (AgentError, AgentUnavailable):
            pass
    return res


def _first(v):
    if isinstance(v, list):
        return v[0] if v else None
    return v


@router.get("/find")
async def find_page(request: Request, sess: Session = Depends(require_admin)):
    q = (request.query_params.get("q") or "").strip()
    res = await _find(request, sess, q)
    return await render(request, "admin/find.html", {"q": q, "res": res, "total": sum(len(v) for v in res.values())})


@router.post("/api/console/resolve")
async def resolve(request: Request, sess: Session = Depends(require_admin), _: None = Depends(csrf_protect)):
    """Resolve a user or computer name typed in the command bar to a DN."""
    body = await request.json()
    name = re.sub(r"[()\\*\x00]", "", str(body.get("name") or ""))[:128].strip()
    if not name:
        return JSONResponse({"ok": False, "matches": []})
    try:
        rows = await call(request, sess, "GET", "/ad/search", params={
            "filter": f"(|(sAMAccountName={name})(name={name})(userPrincipalName={name}))", "scope": "sub", "attrs": "name,objectClass", "limit": "10"}) or []
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    return JSONResponse({"ok": True, "matches": [{"dn": r.get("dn"), "name": _first((r.get("attributes") or {}).get("name")) or r.get("dn")} for r in rows]})


# ================================================================ directory studio

FILETIME_ATTRS = {"accountExpires", "lastLogon", "lastLogonTimestamp", "pwdLastSet", "badPasswordTime", "lockoutTime"}
GENERALIZED = {"whenCreated", "whenChanged"}
UAC_FLAGS = [
    (0x0002, "ACCOUNTDISABLE", "Account disabled"), (0x0010, "LOCKOUT", "Locked out"),
    (0x0020, "PASSWD_NOTREQD", "No password required"), (0x0040, "PASSWD_CANT_CHANGE", "User cannot change password"),
    (0x0080, "ENCRYPTED_TEXT_PWD_ALLOWED", "Store password with reversible encryption"),
    (0x0200, "NORMAL_ACCOUNT", "Normal account"), (0x1000, "WORKSTATION_TRUST_ACCOUNT", "Workstation trust account"),
    (0x2000, "SERVER_TRUST_ACCOUNT", "Domain controller account"), (0x10000, "DONT_EXPIRE_PASSWORD", "Password never expires"),
    (0x40000, "SMARTCARD_REQUIRED", "Smart card required"), (0x80000, "TRUSTED_FOR_DELEGATION", "Trusted for delegation"),
    (0x100000, "NOT_DELEGATED", "Sensitive, cannot be delegated"), (0x400000, "DONT_REQ_PREAUTH", "No Kerberos pre-authentication"),
    (0x800000, "PASSWORD_EXPIRED", "Password expired"),
]
ATTR_HELP = {
    "accountExpires": "When the account stops working. TempDesk's reaper deletes guest accounts after this time and PCs sign them out.",
    "userAccountControl": "Account flags: enabled or disabled, password rules, delegation. Each switch is one bit.",
    "logonHours": "Hours of the week when the account may sign in, stored as 21 bytes in UTC.",
    "objectSid": "Security identifier: never changes while the object exists.",
    "objectGUID": "Globally unique identifier used by the AD Recycle Bin.",
    "pwdLastSet": "When the password was last set. 0 means the user must change it at next sign-in.",
    "lastLogonTimestamp": "Last sign-in, replicated roughly every 14 days.",
    "lastLogon": "Last sign-in recorded on this domain controller only.",
    "memberOf": "Groups this object belongs to (read only here, change it from the group).",
    "member": "Members of this group.",
    "description": "Free text shown in admin tools.",
    "gPLink": "Group Policy objects linked to this container, in order.",
    "sAMAccountName": "Pre-Windows 2000 sign-in name, up to 20 characters.",
    "userPrincipalName": "Sign-in name in name@domain form.",
    "displayName": "Name shown in address lists and on the sign-in screen.",
    "info": "Notes. TempDesk stores guest creation data here as JSON.",
}


def decode_attr(name: str, values: list) -> dict:
    """Return a decoded, display friendly view of one attribute."""
    out: dict[str, Any] = {"name": name, "values": values, "kind": "text", "decoded": None, "help": ATTR_HELP.get(name, "")}
    v0 = values[0] if values else None
    try:
        if name in FILETIME_ATTRS and v0 is not None:
            n = int(v0)
            out["kind"] = "filetime"
            if n in (0, 0x7FFFFFFFFFFFFFFF):
                out["decoded"] = None
            else:
                out["decoded"] = datetime.fromtimestamp((n - 116444736000000000) / 1e7, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        elif name in GENERALIZED and v0:
            out["kind"] = "generalized"
            s = str(v0)
            out["decoded"] = f"{s[0:4]}-{s[4:6]}-{s[6:8]}T{s[8:10]}:{s[10:12]}:{s[12:14]}Z" if re.match(r"^\d{14}", s) else s
        elif name == "userAccountControl" and v0 is not None:
            n = int(v0)
            out["kind"] = "uac"
            out["decoded"] = [{"bit": b, "id": i, "label": lbl, "on": bool(n & b)} for b, i, lbl in UAC_FLAGS]
        elif name == "objectSid" and isinstance(v0, str) and v0.startswith("b64:"):
            out["kind"] = "sid"
            out["decoded"] = sid_str(base64.b64decode(v0[4:]))
        elif name == "objectGUID" and isinstance(v0, str) and v0.startswith("b64:"):
            out["kind"] = "guid"
            out["decoded"] = str(uuid.UUID(bytes_le=base64.b64decode(v0[4:])))
        elif name == "logonHours" and isinstance(v0, str) and v0.startswith("b64:"):
            raw = base64.b64decode(v0[4:])
            if len(raw) == 21:
                out["kind"] = "hours"
                out["decoded"] = [bool(raw[i // 8] & (1 << (i % 8))) for i in range(168)]
        elif isinstance(v0, str) and v0.startswith("b64:"):
            out["kind"] = "binary"
            out["decoded"] = base64.b64decode(v0[4:]).hex(" ")[:240]
        elif len(values) > 1 or name in ("member", "memberOf", "objectClass", "servicePrincipalName", "proxyAddresses"):
            out["kind"] = "multi"
    except (ValueError, TypeError, struct.error):
        pass
    return out


def sid_str(b: bytes) -> str:
    if len(b) < 8:
        return b.hex()
    rev, cnt = b[0], b[1]
    auth = int.from_bytes(b[2:8], "big")
    subs = [struct.unpack("<I", b[8 + 4 * i: 12 + 4 * i])[0] for i in range(cnt) if 12 + 4 * i <= len(b)]
    return "S-" + "-".join([str(rev), str(auth)] + [str(s) for s in subs])


def to_filetime(iso: str) -> str:
    if not iso:
        return "0"
    ts = parse_iso(iso if iso.endswith("Z") or "+" in iso else iso + "Z")
    if ts is None:
        raise ValueError("bad date")
    return str(int(ts * 1e7 + 116444736000000000))


@router.get("/api/dir/children")
async def dir_children(request: Request, sess: Session = Depends(require_admin)):
    dn = request.query_params.get("dn") or None
    try:
        rows = await call(request, sess, "GET", "/ad/tree", params={"dn": dn}) or []
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    out = []
    for r in rows:
        oc = r.get("objectClass")
        out.append({"dn": r.get("dn"), "name": r.get("name"), "objectClass": oc[-1] if isinstance(oc, list) and oc else oc,
                    "hasChildren": bool(r.get("hasChildren"))})
    return JSONResponse(out, headers=NO_STORE)


@router.get("/api/dir/object")
async def dir_object(request: Request, sess: Session = Depends(require_admin)):
    dn = request.query_params.get("dn") or ""
    try:
        obj = await call(request, sess, "GET", "/ad/object", params={"dn": dn}) or {}
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    attrs = obj.get("attributes") or {}
    dec = {k: decode_attr(k, v if isinstance(v, list) else [v]) for k, v in attrs.items()}
    links = await effective_policy(request, sess, dn)
    return JSONResponse({"dn": obj.get("dn") or dn, "objectClass": obj.get("objectClass") or [], "attributes": attrs, "decoded": dec,
                         "schemaAllowed": obj.get("schemaAllowed") or [], "policies": links,
                         "uacFlags": [{"bit": b, "id": i, "label": lbl} for b, i, lbl in UAC_FLAGS]}, headers=NO_STORE)


async def effective_policy(request: Request, sess: Session, dn: str) -> list[dict]:
    """GPOs linked on the object's containers, nearest first (from GET /gpo links)."""
    if not has_cap(request, "gpo"):
        h = await request.app.state.agent.health()
        if "gpo" not in set((h or {}).get("capabilities") or []):
            return []
    try:
        gpos = await call(request, sess, "GET", "/gpo") or []
    except (AgentError, AgentUnavailable):
        return []
    parts = dn.split(",")
    chain = [",".join(parts[i:]) for i in range(len(parts))]
    out = []
    for depth, c in enumerate(chain):
        for g in gpos:
            for ln in g.get("links") or []:
                if (ln.get("target") or "").casefold() == c.casefold() and ln.get("enabled", True):
                    out.append({"id": g.get("id"), "name": g.get("displayName"), "via": c, "enforced": bool(ln.get("enforced")), "depth": depth})
    return out


@router.get("/api/dir/search")
async def dir_search(request: Request, sess: Session = Depends(require_admin)):
    qp = request.query_params
    filt = qp.get("filter") or "(objectClass=*)"
    params = {"filter": filt, "base": qp.get("base") or None, "scope": qp.get("scope") or "sub",
              "attrs": qp.get("attrs") or "name,objectClass", "limit": qp.get("limit") or "500"}
    t0 = time.monotonic()
    try:
        rows = await call(request, sess, "GET", "/ad/search", params=params) or []
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    return JSONResponse({"ok": True, "rows": rows, "ms": round((time.monotonic() - t0) * 1000), "request": params}, headers=NO_STORE)


@router.post("/api/dir/patch", dependencies=CSRF)
async def dir_patch(request: Request, sess: Session = Depends(require_admin)):
    """Body: {"dn", "set": {attr: [values]}, "clear": [attr], "filetime": {attr: iso}} with undo."""
    body = await request.json()
    dn = str(body.get("dn") or "")
    setv: dict[str, list] = {}
    for k, v in (body.get("set") or {}).items():
        if not re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,127}", k):
            return JSONResponse({"ok": False, "message": "Invalid attribute name."}, status_code=400)
        setv[k] = [str(x) for x in (v if isinstance(v, list) else [v])]
    try:
        for k, iso in (body.get("filetime") or {}).items():
            setv[k] = [to_filetime(iso)]
    except ValueError:
        return JSONResponse({"ok": False, "message": "Enter a valid date and time."}, status_code=400)
    clear = [c for c in body.get("clear") or [] if re.fullmatch(r"[A-Za-z][A-Za-z0-9-]{0,127}", str(c))]
    if not dn or not (setv or clear):
        return JSONResponse({"ok": False, "message": "Nothing to save."}, status_code=400)
    try:
        before_obj = await call(request, sess, "GET", "/ad/object", params={"dn": dn}) or {}
        before = {k: (before_obj.get("attributes") or {}).get(k) for k in list(setv) + clear}
        req = {"dn": dn}
        if setv:
            req["set"] = setv
        if clear:
            req["clear"] = clear
        await call(request, sess, "PATCH", "/ad/object", json=req)
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    inv_set = {k: v for k, v in before.items() if v}
    inv_clear = [k for k, v in before.items() if not v]
    inv = {"dn": dn}
    if inv_set:
        inv["set"] = inv_set
    if inv_clear:
        inv["clear"] = inv_clear
    single = (list(setv) + clear)[0] if len(setv) + len(clear) == 1 else None
    rec = track(request, sess, action="attribute.set", target=dn, summary=f"Edit {', '.join(list(setv) + clear)} on {dn}",
                request={"method": "PATCH", "path": "/ad/object", "json": req}, before=before,
                after=(setv.get(single) if single else setv),
                inverse=http_inv("PATCH", "/ad/object", None, inv),
                check=check_spec("/ad/object", {"dn": dn}, f"attributes.{single}") if single else None)
    return JSONResponse({"ok": True, "message": translator_for(request).plain("Saved."), "undoId": (rec or {}).get("id")})


@router.post("/api/dir/move", dependencies=CSRF)
async def dir_move(request: Request, sess: Session = Depends(require_admin)):
    body = await request.json()
    dn, parent = str(body.get("dn") or ""), str(body.get("newParentDn") or "")
    if not dn or not parent:
        return JSONResponse({"ok": False, "message": "Choose the object and the new container."}, status_code=400)
    try:
        res = await call(request, sess, "POST", "/ad/object/move", json={"dn": dn, "newParentDn": parent})
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    new_dn = (res or {}).get("dn") or f"{dn.split(',', 1)[0]},{parent}"
    old_rdn, old_parent = (dn.split(",", 1) + [""])[:2]
    rec = track(request, sess, action="object.move", target=new_dn, summary=f"Move {dn} to {new_dn}",
                request={"method": "POST", "path": "/ad/object/move", "json": {"dn": dn, "newParentDn": parent}}, before=dn, after=new_dn,
                inverse=http_inv("POST", "/ad/object/move", None, {"dn": new_dn, "newParentDn": old_parent, "newRdn": old_rdn}),
                check=check_spec("/ad/object", {"dn": new_dn}, "dn"))
    return JSONResponse({"ok": True, "dn": new_dn, "undoId": (rec or {}).get("id"), "message": translator_for(request).plain("Moved.")})


@router.post("/api/dir/members", dependencies=CSRF)
async def dir_members(request: Request, sess: Session = Depends(require_admin)):
    body = await request.json()
    gdn = str(body.get("groupDn") or "")
    add = [str(x) for x in body.get("add") or []]
    remove = [str(x) for x in body.get("remove") or []]
    try:
        await call(request, sess, "POST", "/ad/group/members", json={"groupDn": gdn, "add": add, "remove": remove})
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    rec = track(request, sess, action="group.members", target=gdn, summary=f"Change members of {gdn}",
                request={"method": "POST", "path": "/ad/group/members", "json": {"groupDn": gdn, "add": add, "remove": remove}},
                before={"add": add, "remove": remove}, inverse=http_inv("POST", "/ad/group/members", None, {"groupDn": gdn, "add": remove, "remove": add}))
    return JSONResponse({"ok": True, "undoId": (rec or {}).get("id"), "message": translator_for(request).plain("Members updated.")})


@router.post("/api/dir/user", dependencies=CSRF)
async def dir_user(request: Request, sess: Session = Depends(require_admin)):
    """Enable, disable or unlock from the studio (password resets use the form route)."""
    body = await request.json()
    dn, action = str(body.get("dn") or ""), body.get("action")
    try:
        if action in ("enable", "disable"):
            await call(request, sess, "POST", "/ad/user/enable", json={"dn": dn, "enabled": action == "enable"})
            rec = track(request, sess, action=f"user.{action}", target=dn, summary=f"{action.capitalize()} {dn}",
                        request={"method": "POST", "path": "/ad/user/enable", "json": {"dn": dn, "enabled": action == "enable"}},
                        inverse=http_inv("POST", "/ad/user/enable", None, {"dn": dn, "enabled": action != "enable"}))
        elif action == "unlock":
            await call(request, sess, "POST", "/ad/user/unlock", json={"dn": dn})
            rec = track(request, sess, action="user.unlock", target=dn, summary=f"Unlock {dn}", undoable=False,
                        request={"method": "POST", "path": "/ad/user/unlock", "json": {"dn": dn}},
                        reason="Unlocking has no inverse: an account cannot be locked on purpose.")
        else:
            return JSONResponse({"ok": False, "message": "Unknown action."}, status_code=400)
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    return JSONResponse({"ok": True, "undoId": (rec or {}).get("id"), "message": translator_for(request).plain("Saved.")})


def _filetime_age_days(v) -> float | None:
    try:
        n = int(_first(v) or 0)
    except (TypeError, ValueError):
        return None
    if n <= 0 or n == 0x7FFFFFFFFFFFFFFF:
        return None
    return (time.time() - (n - 116444736000000000) / 1e7) / 86400


@router.get("/api/dir/problems")
async def dir_problems(request: Request, sess: Session = Depends(require_admin)):
    """Directory health checks computed from /ad/search and /guests."""
    probs: list[dict] = []
    checked: list[str] = []
    try:
        admins = await call(request, sess, "GET", "/ad/search", params={"filter": "(objectClass=group)", "scope": "sub", "attrs": "name,member,objectClass", "limit": "2000"}) or []
        users = await call(request, sess, "GET", "/ad/search", params={"filter": "(objectClass=user)", "scope": "sub", "attrs": "name,userAccountControl,lastLogonTimestamp,objectClass,sAMAccountName", "limit": "5000"}) or []
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    disabled = set()
    stale = []
    for u in users:
        a = u.get("attributes") or {}
        oc = [c.lower() for c in (a.get("objectClass") or [])] if isinstance(a.get("objectClass"), list) else []
        try:
            uac = int(_first(a.get("userAccountControl")) or 0)
        except (TypeError, ValueError):
            uac = 0
        if uac & 2:
            disabled.add(u.get("dn", "").casefold())
        if "computer" in oc:
            age = _filetime_age_days(a.get("lastLogonTimestamp"))
            if age is not None and age > 30:
                stale.append({"dn": u.get("dn"), "name": _first(a.get("name")), "days": round(age)})
    checked += ["disabled-admins", "stale-computers", "empty-groups"]
    for g in admins:
        a = g.get("attributes") or {}
        name = _first(a.get("name")) or g.get("dn")
        members = a.get("member") if isinstance(a.get("member"), list) else ([a["member"]] if a.get("member") else [])
        if name and re.search(r"admin", str(name), re.IGNORECASE):
            bad = [m for m in members if m.casefold() in disabled]
            if bad:
                probs.append({"id": "disabled-admins", "severity": "warn", "text": f"{len(bad)} disabled account(s) still in {name}",
                              "target": g.get("dn"), "items": bad, "fix": "remove-members"})
        if "member" in a and not members and ",CN=BUILTIN," not in ("," + str(g.get("dn", ""))).upper():
            probs.append({"id": "empty-group", "severity": "info", "text": f"{name} has no members", "target": g.get("dn"), "items": [], "fix": "review"})
    for c in stale:
        probs.append({"id": "stale-computer", "severity": "warn", "text": f"{c['name']} has not contacted the domain for {c['days']} days",
                      "target": c["dn"], "items": [c["dn"]], "fix": "disable"})
    try:
        now = time.time()
        for g in await call(request, sess, "GET", "/guests") or []:
            exp = parse_iso(g.get("expiresAt"))
            if exp and exp < now - 600:
                probs.append({"id": "expired-guest", "severity": "warn", "text": f"{g.get('username')} expired but is not deleted yet",
                              "target": g.get("username"), "items": [], "fix": "delete-guest"})
        checked.append("expired-guests")
    except (AgentError, AgentUnavailable):
        pass
    return JSONResponse({"ok": True, "problems": probs, "checked": checked, "users": len(users), "groups": len(admins)}, headers=NO_STORE)


@router.get("/api/dir/history")
async def dir_history(request: Request, sess: Session = Depends(require_admin)):
    recs = [r for r in reversed(journal(request).all()) if str(r.get("action", "")).split(".")[0] in ("attribute", "object", "user", "group")][:60]
    return JSONResponse([{"id": r.get("id"), "time": r.get("time"), "user": r.get("user"), "summary": r.get("summary"), "status": r.get("status"),
                          "undoable": bool(r.get("undoable")) and r.get("status") == "done" and not r.get("undoOf")} for r in recs], headers=NO_STORE)


@router.get("/api/dir/signins")
async def dir_signins(request: Request, sess: Session = Depends(require_admin)):
    """Sign-in facts for a user through the cmdlet runner (Get-ADUser), when available."""
    dn = request.query_params.get("dn") or ""
    h = await request.app.state.agent.health()
    if "cmdlets" not in set((h or {}).get("capabilities") or []):
        return JSONResponse({"ok": False, "available": False})
    try:
        res = await call(request, sess, "POST", "/cmdlets/invoke", json={"name": "Get-ADUser", "parameters": {
            "Identity": dn, "Properties": ["lastLogon", "lastLogonTimestamp", "LastLogonDate", "logonCount", "badPwdCount", "badPasswordTime", "LastBadPasswordAttempt", "LockedOut", "PasswordLastSet"]}, "whatIf": False})
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    out = (res or {}).get("output") or []
    return JSONResponse({"ok": True, "available": True, "data": out[0] if out and isinstance(out[0], dict) else None, "errors": (res or {}).get("errors") or []})


@router.get("/directory/studio")
async def studio_alias(request: Request, sess: Session = Depends(require_admin)):
    from fastapi.responses import RedirectResponse

    return RedirectResponse("/directory", status_code=303)


def json_attr(v: Any) -> str:
    return json.dumps(v, ensure_ascii=False).replace("<", "\\u003c")


quote  # re-export


# ================================================================ Group Policy editor

GPO_PATH_RE = re.compile(r"^/gpo/[^/?#]+(/[A-Za-z0-9._~%{}\-]+)*$")


def _gq(gid: str) -> str:
    return quote(gid, safe="")


async def _agent_try(request: Request, sess: Session, method: str, path: str, **kw):
    """Call the agent; return (data, None) or (None, AgentError) for 404 / bad_request."""
    try:
        return await call(request, sess, method, path, **kw), None
    except AgentError as exc:
        if exc.status in (404, 405, 501) or exc.code in ("not_found", "bad_request"):
            return None, exc
        raise


def _fallback_tree(cats: list[dict], scope: str, caps: set[str], gid: str) -> list[dict]:
    """Group Policy Management Editor tree built from the routes the agent already has."""
    by_parent: dict[str | None, list[dict]] = {}
    for c in cats:
        if isinstance(c, dict) and c.get("id"):
            by_parent.setdefault(c.get("parentId"), []).append(c)

    def admx(parent):
        out = []
        for c in sorted(by_parent.get(parent, []), key=lambda x: (x.get("name") or "").casefold()):
            out.append({"id": f"admx:{c['id']}", "name": c.get("name") or c["id"], "kind": "admx", "category": c["id"], "children": admx(c["id"])})
        return out
    win = []
    if "security" in caps and scope == "Computer":
        win.append({"id": "security", "name": "Security Settings", "kind": "link", "href": f"/gpo/{_gq(gid)}/security", "children": []})
    if "scripts" in caps:
        win.append({"id": "scripts", "name": "Scripts (Startup/Shutdown)" if scope == "Computer" else "Scripts (Logon/Logoff)", "kind": "link", "href": "/scripts", "children": []})
    adm = admx(None)
    adm.append({"id": "admx:*", "name": "All Settings", "kind": "admx", "category": "", "all": True, "children": []})
    pol = [{"id": "software", "name": "Software Settings", "kind": "folder", "children": []},
           {"id": "windows", "name": "Windows Settings", "kind": "folder", "children": win},
           {"id": "admx", "name": "Administrative Templates", "kind": "folder", "children": adm}]
    if "gpo-registry" in caps:
        pol.append({"id": "registry", "name": "Registry values (raw)", "kind": "table", "node": "registry", "children": []})
    prefs = []
    if "gpo-preferences" in caps:
        prefs.append({"id": "prefs-windows", "name": "Windows Settings", "kind": "folder", "children": [
            {"id": "pref-registry", "name": "Registry", "kind": "table", "node": "preferences/registry", "children": []}]})
    return [{"id": "policies", "name": "Policies", "kind": "folder", "children": pol}] + (
        [{"id": "preferences", "name": "Preferences", "kind": "folder", "children": prefs}] if prefs else [])


@router.get("/api/gpo/{gid}/tree")
async def gpo_tree(gid: str, request: Request, sess: Session = Depends(require_admin)):
    scope = "User" if request.query_params.get("scope") == "User" else "Computer"
    h = await request.app.state.agent.health()
    caps = set((h or {}).get("capabilities") or [])
    try:
        data, _ = await _agent_try(request, sess, "GET", f"/gpo/{_gq(gid)}/tree", params={"scope": scope})
        source = "agent"
        if data is None:
            cats = await call(request, sess, "GET", "/admx/categories") or [] if "admx" in caps else []
            data, source = _fallback_tree(cats, scope, caps, gid), "portal"
        stats = None
        st, _ = await _agent_try(request, sess, "GET", "/admx/stats")
        if isinstance(st, dict):
            stats = st
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    tree = data.get("tree") if isinstance(data, dict) and "tree" in data else data
    if isinstance(data, dict) and isinstance(data.get("stats"), dict):
        stats = data["stats"]
    if isinstance(tree, dict):
        tree = tree.get(scope) or tree.get(scope.lower()) or tree.get("children") or []
    return JSONResponse({"ok": True, "scope": scope, "tree": tree or [], "source": source, "stats": stats}, headers=NO_STORE)


@router.get("/api/gpo/{gid}/policies")
async def gpo_policies(gid: str, request: Request, sess: Session = Depends(require_admin)):
    """ADMX policies of a category (or a search) with each policy's state in this GPO."""
    qp = request.query_params
    cls = "User" if qp.get("scope") == "User" else "Machine"
    cat, q = qp.get("category") or None, (qp.get("q") or "").strip() or None
    try:
        rows = await call(request, sess, "GET", "/admx/policies", params={"category": cat, "q": q, "class": cls}) or []
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    rows = [p for p in rows if isinstance(p, dict) and p.get("class") in (cls, "Both", None)][:400]
    import asyncio

    sem = asyncio.Semaphore(8)

    async def state(p):
        async with sem:
            try:
                s = await call(request, sess, "GET", f"/gpo/{_gq(gid)}/admx/{quote(str(p.get('id')), safe='')}", params={"class": cls}) or {}
                return s.get("state") or "NotConfigured"
            except (AgentError, AgentUnavailable):
                return None
    states = await asyncio.gather(*(state(p) for p in rows[:150]))
    out = []
    for i, p in enumerate(rows):
        out.append({**p, "state": states[i] if i < len(states) else None})
    return JSONResponse({"ok": True, "policies": out, "class": cls}, headers=NO_STORE)


@router.get("/api/gpo/{gid}/policy/{pid}")
async def gpo_policy(gid: str, pid: str, request: Request, sess: Session = Depends(require_admin)):
    qp = request.query_params
    cls = "User" if qp.get("scope") == "User" else "Machine"
    try:
        st = await call(request, sess, "GET", f"/gpo/{_gq(gid)}/admx/{quote(pid, safe='')}", params={"class": cls}) or {}
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    return JSONResponse({"ok": True, "state": st.get("state") or "NotConfigured", "values": st.get("values") or {}}, headers=NO_STORE)


@router.get("/api/gpo/schema")
async def gpo_schema(request: Request, sess: Session = Depends(require_admin)):
    try:
        data, _ = await _agent_try(request, sess, "GET", "/gpo/nodes/schema")
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    return JSONResponse({"ok": True, "schema": data, "source": "agent" if data is not None else "portal"}, headers=NO_STORE)


@router.api_route("/api/gpo/{gid}/node", methods=["GET", "POST"])
async def gpo_node(gid: str, request: Request, sess: Session = Depends(require_admin)):
    """Items of a table node (rules, services, drive maps, registry values...).
    GET ?node=<path below /gpo/{id}/> lists. POST {"node","method":"PUT|POST|PATCH|DELETE","params","json","summary"} writes,
    after a policy backup so Undo can restore it."""
    if request.method == "GET":
        node = request.query_params.get("node") or ""
        path = f"/gpo/{_gq(gid)}/{node}"
        if not GPO_PATH_RE.match(path) or ".." in node:
            return JSONResponse({"ok": False, "message": "Invalid node."}, status_code=400)
        params = {k: v for k, v in request.query_params.items() if k != "node"}
        try:
            data = await call(request, sess, "GET", path, params=params or None)
        except (AgentError, AgentUnavailable) as exc:
            return err_json(request, exc)
        return JSONResponse({"ok": True, "items": data}, headers=NO_STORE)
    await csrf_protect(request)
    body = await request.json()
    node = str(body.get("node") or "")
    method = str(body.get("method") or "PUT").upper()
    path = f"/gpo/{_gq(gid)}/{node}"
    if method not in ("PUT", "POST", "PATCH", "DELETE") or not GPO_PATH_RE.match(path) or ".." in node:
        return JSONResponse({"ok": False, "message": "Invalid request."}, status_code=400)
    from .undo_routes import gpo_snapshot

    snap = await gpo_snapshot(request, sess, gid)
    kw: dict[str, Any] = {}
    if body.get("params"):
        kw["params"] = {str(k): str(v) for k, v in body["params"].items()}
    if method != "DELETE" and body.get("json") is not None:
        kw["json"] = body["json"]
    try:
        res = await call(request, sess, method, path, **kw)
    except (AgentError, AgentUnavailable) as exc:
        return err_json(request, exc)
    summary = str(body.get("summary") or f"{method} {node}")[:200]
    rec = track(request, sess, action="gpo.node", target=f"gpo:{gid}", summary=f"{summary} ({gid})",
                request={"method": method, "path": path, **kw}, before={"backupId": snap},
                inverse={"kind": "gpo-restore", "gpoId": gid, "backupId": snap} if snap else None,
                undoable=bool(snap), reason="" if snap else "The policy could not be backed up before the change.")
    return JSONResponse({"ok": True, "result": res if isinstance(res, (dict, list)) else None, "undoId": (rec or {}).get("id"),
                         "message": translator_for(request).plain("Saved.")})


@router.get("/gpo/{gid}/edit")
async def gpo_edit(gid: str, request: Request, sess: Session = Depends(require_admin)):
    g = await call(request, sess, "GET", f"/gpo/{_gq(gid)}")
    h = await request.app.state.agent.health()
    cfg = {"gid": gid, "name": g.get("displayName") or gid, "caps": sorted((h or {}).get("capabilities") or []),
           "scope": "User" if request.query_params.get("scope") == "User" else "Computer",
           "category": request.query_params.get("category") or "", "policy": request.query_params.get("policy") or ""}
    from markupsafe import Markup

    return await render(request, "admin/gpo_edit.html", {"g": g, "gid": gid, "tab": "edit", "tab_title": g.get("displayName") or gid,
                                                         "cfg": Markup(json_attr(cfg))})


@router.get("/api/console/metrics")
async def metrics_soft(request: Request, sess: Session = Depends(require_admin)):
    """Live metrics for the server strip. Always 200 so pages can show a truthful
    'not available' state without browser console errors."""
    try:
        data = await call(request, sess, "GET", "/server/metrics")
    except (AgentError, AgentUnavailable) as exc:
        return JSONResponse({"available": False, "message": getattr(exc, "message", "") or ""}, headers=NO_STORE)
    return JSONResponse({"available": True, **(data if isinstance(data, dict) else {})}, headers=NO_STORE)
