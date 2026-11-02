"""Import, export and version history for the Admin console.

Every import is validated in full before anything is written, shows a
preview, and is applied only on a second confirmed POST. Pending imports are
held server side (one-time, 10 minutes) keyed by a random id.
"""

from __future__ import annotations

import csv
import io
import json
import re
import secrets
import uuid
import xml.etree.ElementTree as ET
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from . import settings_schema
from .admin_routes import (
    CSRF,
    EXE_RE,
    NO_STORE,
    SCRIPT_RE,
    WIFI_AUTH,
    call,
    fail,
    form_of,
    ok,
    _script_ok,
)
from .agent_client import AgentError
from .history import diff, settings_text
from .security import OneTimeStore, Session
from .web import agent_message, flash_text, render, require_admin

router = APIRouter()
PENDING = OneTimeStore(ttl_seconds=600, max_items=200)
MAX_IMPORT = 2 * 1024 * 1024
MAX_ROWS = 2000
SAM_RE = re.compile(r"^[A-Za-z0-9._-]{1,20}$")


def _download(body: str | bytes, name: str, ctype: str) -> Response:
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:80]
    return Response(body, media_type=ctype, headers={"Content-Disposition": f'attachment; filename="{safe}"', **NO_STORE})


async def _upload(form, field: str = "file", limit: int = MAX_IMPORT) -> bytes | None:
    up = form.get(field)
    if up is None or not hasattr(up, "read"):
        return None
    raw = await up.read(limit + 1)
    if len(raw) > limit:
        raise ValueError("too large")
    return raw


def _user(sess: Session) -> str:
    return str(sess.user.get("sam") or sess.user.get("displayName") or "admin")


def _dupe_hook(pairs):
    out = {}
    for k, v in pairs:
        if k in out:
            raise ValueError("duplicate key")
        out[k] = v
    return out


# ================================================================ settings

@router.get("/settings/export")
async def settings_export(request: Request, sess: Session = Depends(require_admin)):
    doc = await call(request, sess, "GET", "/settings") or {}
    return _download(json.dumps(doc, indent=2, ensure_ascii=False), "tempdesk-settings.json", "application/json")


@router.post("/settings/import", dependencies=CSRF)
async def settings_import(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    try:
        raw = await _upload(form, limit=256 * 1024)
    except ValueError:
        return fail(request, "/settings#import", "The file is larger than 256 KiB.")
    if not raw:
        return fail(request, "/settings#import", "Choose a JSON file first.")
    try:
        doc = json.loads(raw.decode("utf-8-sig"), object_pairs_hook=_dupe_hook)
    except (UnicodeDecodeError, ValueError):
        return fail(request, "/settings#import", "The file is not valid JSON (or has duplicate keys).")
    if not isinstance(doc, dict):
        return fail(request, "/settings#import", "The settings file must be a JSON object.")
    unknown = [k for k in doc if k not in settings_schema.FIELD_NAMES]
    current = await call(request, sess, "GET", "/settings") or {}
    merged = {**current, **{k: v for k, v in doc.items() if k in settings_schema.FIELD_NAMES}}
    clean, errors = settings_schema.validate_settings(merged)
    pending_id = PENDING.put({"kind": "settings", "doc": clean, "user": _user(sess)}) if not errors else None
    changes = [(k, current.get(k), clean.get(k)) for k in settings_schema.FIELD_NAMES if current.get(k) != clean.get(k)]
    return await render(request, "admin/import_preview.html", {
        "title_key": "Import settings", "errors": errors, "unknown": unknown, "changes": changes,
        "pending": pending_id, "apply_url": "/settings/import/apply", "back": "/settings",
        "diff": diff(settings_text(current), settings_text(clean), "current", "imported")}, headers=NO_STORE)


@router.post("/settings/import/apply", dependencies=CSRF)
async def settings_import_apply(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    item = PENDING.pop(form.get("pending"))
    if not item or item.get("kind") != "settings":
        return fail(request, "/settings", "That import has expired. Upload the file again.")
    clean, errors = settings_schema.validate_settings(item["doc"])
    if errors:
        return fail(request, "/settings", "The imported settings are not valid.")
    try:
        before = await call(request, sess, "GET", "/settings") or {}
        await call(request, sess, "PUT", "/settings", json=clean)
    except AgentError as exc:
        return fail(request, "/settings", exc)
    hist = request.app.state.history
    if not hist.list("settings", "settings"):
        hist.record("settings", "settings", settings_text(before), "(before history)")
    hist.record("settings", "settings", settings_text(clean), _user(sess))
    return ok(request, "/settings", "Settings imported.")


# ================================================================ Wi-Fi (netsh WLAN XML)

NS = re.compile(r"\{[^}]*\}")


def parse_wlan_xml(raw: bytes) -> dict:
    """Parse one profile from `netsh wlan export profile key=clear`."""
    text = raw.decode("utf-8-sig", errors="strict") if not raw.startswith(b"\xff\xfe") else raw.decode("utf-16")
    if re.search(r"<!DOCTYPE|<!ENTITY", text, re.IGNORECASE):
        raise ValueError("The XML must not contain a DOCTYPE or entities.")
    root = ET.fromstring(text.encode("utf-8") if text.lstrip().startswith("<?xml") is False else re.sub(r"^<\?xml[^>]*\?>", "", text.strip()).encode("utf-8"))

    def find(tag_path: str):
        node = root
        for tag in tag_path.split("/"):
            node = next((c for c in node if NS.sub("", c.tag) == tag), None) if node is not None else None
        return node

    if NS.sub("", root.tag) != "WLANProfile":
        raise ValueError("This is not a Windows WLAN profile (WLANProfile root element missing).")
    ssid = find("SSIDConfig/SSID/name")
    name = find("name")
    ssid_text = (ssid.text if ssid is not None else None) or (name.text if name is not None else None) or ""
    nb = find("SSIDConfig/nonBroadcast")
    mode = find("connectionMode")
    auth = find("MSM/security/authEncryption/authentication")
    key = find("MSM/security/sharedKey/keyMaterial")
    protected = find("MSM/security/sharedKey/protected")
    a = (auth.text or "").strip() if auth is not None else "open"
    mapping = {"WPA2PSK": "WPA2PSK", "WPA3SAE": "WPA3SAE", "open": "open", "WPA2": None, "WPA3": None, "WPA3ENT": None}
    if a not in mapping or mapping[a] is None:
        raise ValueError(f"Authentication {a} is not supported (use WPA2PSK, WPA3SAE or open).")
    if protected is not None and (protected.text or "").strip().lower() == "true":
        raise ValueError("The key in this file is encrypted. Export it again with key=clear.")
    k = (key.text or "") if key is not None else ""
    if mapping[a] != "open" and not 8 <= len(k) <= 63:
        raise ValueError("The Wi-Fi key in the file must be 8 to 63 characters.")
    if not 1 <= len(ssid_text.encode()) <= 32:
        raise ValueError("The network name must be 1 to 32 bytes.")
    return {"ssid": ssid_text, "auth": mapping[a], "key": k, "hidden": (nb is not None and (nb.text or "").strip().lower() == "true"),
            "autoConnect": (mode is None or (mode.text or "").strip().lower() == "auto")}


@router.post("/wifi/import", dependencies=CSRF)
async def wifi_import(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    ups = [u for u in form.getlist("file") if hasattr(u, "read")]
    if not ups:
        return fail(request, "/wifi", "Choose one or more WLAN profile XML files.")
    profiles, errors = [], []
    for n, up in enumerate(ups[:50], start=1):
        raw = await up.read(64 * 1024 + 1)
        try:
            if len(raw) > 64 * 1024:
                raise ValueError("The file is larger than 64 KiB.")
            profiles.append(parse_wlan_xml(raw))
        except (ValueError, ET.ParseError, UnicodeDecodeError) as exc:
            errors.append(f"File {n}: {exc if isinstance(exc, ValueError) and not isinstance(exc, UnicodeDecodeError) else 'not valid XML'}")
    if errors:
        return fail(request, "/wifi", "Nothing was imported. " + " ".join(errors[:5]))
    pending = PENDING.put({"kind": "wifi", "profiles": profiles})
    rows = [{"ssid": p["ssid"], "auth": p["auth"], "hidden": p["hidden"], "autoConnect": p["autoConnect"], "key": "set" if p["key"] else ""} for p in profiles]
    return await render(request, "admin/import_preview.html", {
        "title_key": "Import Wi-Fi profiles", "errors": {}, "unknown": [], "rows": rows,
        "row_cols": [("ssid", "Network name"), ("auth", "Security"), ("hidden", "Hidden"), ("autoConnect", "Connect automatically"), ("key", "Key")],
        "pending": pending, "apply_url": "/wifi/import/apply", "back": "/wifi"}, headers=NO_STORE)


@router.post("/wifi/import/apply", dependencies=CSRF)
async def wifi_import_apply(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    item = PENDING.pop(form.get("pending"))
    if not item or item.get("kind") != "wifi":
        return fail(request, "/wifi", "That import has expired. Upload the file again.")
    results = []
    for p in item["profiles"]:
        pid = (re.sub(r"[^A-Za-z0-9-]", "-", p["ssid"]).strip("-")[:40].lower() or "wifi") + "-" + uuid.uuid4().hex[:6]
        body = {k: v for k, v in p.items() if k != "key" or v}
        try:
            await call(request, sess, "PUT", f"/wifi/{pid}", json=body)
            results.append({"row": p["ssid"], "ok": True, "message": flash_text(request, "Imported")})
        except AgentError as exc:
            results.append({"row": p["ssid"], "ok": False, "message": agent_message(request, exc)})
    return await render(request, "admin/import_results.html", {"title_key": "Import Wi-Fi profiles", "results": results, "back": "/wifi"})


# ================================================================ scripts

@router.post("/scripts/upload", dependencies=CSRF)
async def scripts_upload(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    kind = form.get("kind") or ""
    ups = [u for u in form.getlist("file") if hasattr(u, "read")]
    if kind not in ("startup", "logon") or not ups:
        return fail(request, "/scripts", "Choose the script kind and at least one .ps1 or .cmd file.")
    staged, errors = [], []
    for up in ups[:20]:
        name = (getattr(up, "filename", "") or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        raw = await up.read(1024 * 1024 + 1)
        if not _script_ok(kind, name):
            errors.append(flash_text(request, "{name}: names must match letters, digits, dot, dash or underscore and end in .ps1 or .cmd.", name=name[:64]))
            continue
        if len(raw) > 1024 * 1024:
            errors.append(f"{name}: larger than 1 MB")
            continue
        try:
            text = raw.decode("utf-8-sig") if not raw.startswith(b"\xff\xfe") else raw.decode("utf-16")
        except UnicodeDecodeError:
            errors.append(f"{name}: not UTF-8 or UTF-16 text")
            continue
        staged.append((name, text))
    if errors:
        return fail(request, "/scripts", "Nothing was uploaded. " + " ".join(errors[:5]))
    hist = request.app.state.history
    for name, text in staged:
        try:
            await call(request, sess, "PUT", f"/scripts/{kind}/{quote(name, safe='')}", json={"content": text})
        except AgentError as exc:
            return fail(request, "/scripts", exc)
        hist.record(f"script-{kind}", name, text, _user(sess))
    return ok(request, "/scripts", "{done} done.", done=len(staged))


@router.get("/scripts/{kind}/{name}/download")
async def script_download(kind: str, name: str, request: Request, sess: Session = Depends(require_admin)):
    if not _script_ok(kind, name):
        raise HTTPException(404)
    res = await call(request, sess, "GET", f"/scripts/{kind}/{quote(name, safe='')}") or {}
    return _download((res.get("content") or "").encode("utf-8"), name, "text/plain; charset=utf-8")


# ================================================================ allowlist / app catalog

@router.get("/allowlist/export")
async def allowlist_export(request: Request, sess: Session = Depends(require_admin)):
    data = await call(request, sess, "GET", "/allowlist") or {"enabled": False, "apps": []}
    if request.query_params.get("format") == "json":
        return _download(json.dumps({"schemaVersion": 1, "enabled": bool(data.get("enabled")), "apps": data.get("apps") or []}, indent=2), "tempdesk-app-catalog.json", "application/json")
    return _download("\r\n".join(data.get("apps") or []) + "\r\n", "tempdesk-allowlist.txt", "text/plain; charset=utf-8")


@router.post("/allowlist/import", dependencies=CSRF)
async def allowlist_import(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    try:
        raw = await _upload(form, limit=256 * 1024)
    except ValueError:
        return fail(request, "/allowlist", "The file is larger than 256 KiB.")
    if not raw:
        return fail(request, "/allowlist", "Choose a file first.")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return fail(request, "/allowlist", "The file is not UTF-8 text.")
    enabled = None
    if text.lstrip().startswith("{"):
        try:
            doc = json.loads(text, object_pairs_hook=_dupe_hook)
        except ValueError:
            return fail(request, "/allowlist", "The app catalog JSON is not valid.")
        if not isinstance(doc, dict) or not isinstance(doc.get("apps"), list) or set(doc) - {"schemaVersion", "enabled", "apps"}:
            return fail(request, "/allowlist", "The app catalog must look like {\"schemaVersion\":1,\"enabled\":true,\"apps\":[...]}.")
        apps = [a for a in doc["apps"] if isinstance(a, str)]
        if len(apps) != len(doc["apps"]):
            return fail(request, "/allowlist", "Every app in the catalog must be text.")
        enabled = bool(doc.get("enabled", True))
    else:
        apps = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.strip().startswith("#")]
    bad = [a for a in apps if not EXE_RE.fullmatch(a)]
    if bad or len(apps) > 1000:
        return fail(request, "/allowlist", "Nothing was imported. Each entry must be a program file name ending in .exe, for example msedge.exe.")
    current = await call(request, sess, "GET", "/allowlist") or {"enabled": False, "apps": []}
    mode = form.get("mode") or "replace"
    final = apps if mode == "replace" else list(dict.fromkeys((current.get("apps") or []) + apps))
    body = {"enabled": current.get("enabled", False) if enabled is None else enabled, "apps": list(dict.fromkeys(final))}
    try:
        await call(request, sess, "PUT", "/allowlist", json=body)
    except AgentError as exc:
        return fail(request, "/allowlist", exc)
    return ok(request, "/allowlist", "Allowlist saved.")


# ================================================================ directory export

def _ldif(entries: list[dict]) -> str:
    out = []
    for e in entries:
        out.append(f"dn: {e.get('dn')}")
        for k, vals in (e.get("attributes") or {}).items():
            for v in vals if isinstance(vals, list) else [vals]:
                s = str(v)
                if s.startswith("b64:"):
                    out.append(f"{k}:: {s[4:]}")
                elif s and (not s.isascii() or s[0] in " :<" or "\n" in s):
                    import base64

                    out.append(f"{k}:: {base64.b64encode(s.encode()).decode()}")
                else:
                    out.append(f"{k}: {s}")
        out.append("")
    return "\n".join(out)


@router.get("/directory/export")
async def directory_export(request: Request, sess: Session = Depends(require_admin)):
    qp = request.query_params
    dn = qp.get("dn") or ""
    scope = qp.get("scope") if qp.get("scope") in ("base", "one", "sub") else "base"
    fmt = qp.get("format") if qp.get("format") in ("json", "csv", "ldif") else "json"
    if scope == "base":
        obj = await call(request, sess, "GET", "/ad/object", params={"dn": dn})
        entries = [{"dn": obj.get("dn"), "attributes": obj.get("attributes") or {}}]
    else:
        entries = await call(request, sess, "GET", "/ad/search", params={"base": dn or None, "filter": "(objectClass=*)", "scope": scope, "attrs": qp.get("attrs") or "*", "limit": "5000"}) or []
    base_name = re.sub(r"[^A-Za-z0-9_-]", "_", dn.split(",", 1)[0])[:40] or "directory"
    if fmt == "ldif":
        return _download(_ldif(entries), f"{base_name}.ldif", "text/plain; charset=utf-8")
    if fmt == "json":
        return _download(json.dumps(entries, indent=2, ensure_ascii=False), f"{base_name}.json", "application/json")
    keys: list[str] = []
    for e in entries:
        for k in e.get("attributes") or {}:
            if k not in keys:
                keys.append(k)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["dn"] + keys)
    for e in entries:
        attrs = e.get("attributes") or {}
        row = [e.get("dn", "")]
        for k in keys:
            v = attrs.get(k)
            s = "; ".join(map(str, v)) if isinstance(v, list) else ("" if v is None else str(v))
            row.append("'" + s if s[:1] in "=+-@" else s)
        w.writerow(row)
    return _download("﻿" + buf.getvalue(), f"{base_name}.csv", "text/csv; charset=utf-8")


# ================================================================ CSV bulk import (guests or users)

GUEST_HEADERS = {"displayName", "expiryId", "minutes"}
USER_HEADERS = {"sAMAccountName", "givenName", "sn", "displayName", "password", "mail", "description", "department", "title", "mustChange", "enabled"}


def parse_csv(raw: bytes, kind: str) -> tuple[list[dict], list[str]]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], ["The file is not UTF-8 text."]
    try:
        sample = text[:4096]
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t") if sample else csv.excel
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    allowed = GUEST_HEADERS if kind == "guests" else USER_HEADERS
    headers = [h.strip() for h in reader.fieldnames or []]
    unknown = [h for h in headers if h not in allowed]
    if not headers:
        return [], ["The file has no header row."]
    if unknown:
        return [], [f"Unknown columns: {', '.join(unknown[:10])}. Allowed: {', '.join(sorted(allowed))}."]
    if kind == "users" and "sAMAccountName" not in headers:
        return [], ["The column sAMAccountName is required."]
    rows, errors = [], []
    seen = set()
    for n, r in enumerate(reader, start=2):
        if n - 1 > MAX_ROWS:
            errors.append(f"More than {MAX_ROWS} rows.")
            break
        r = {(k or "").strip(): (v or "").strip() for k, v in r.items() if k}
        if not any(r.values()):
            continue
        problems = []
        if kind == "guests":
            if r.get("minutes"):
                if not re.fullmatch(r"\d{1,6}", r["minutes"]) or int(r["minutes"]) > settings_schema.MAX_MINUTES:
                    problems.append("minutes must be 0 to 525600")
            elif not r.get("expiryId"):
                problems.append("expiryId or minutes is required")
            if len(r.get("displayName", "")) > 64:
                problems.append("displayName longer than 64")
        else:
            sam = r.get("sAMAccountName", "")
            if not SAM_RE.fullmatch(sam):
                problems.append("sAMAccountName must be 1 to 20 letters, digits, dot, dash or underscore")
            elif sam.lower() in seen:
                problems.append("duplicate sAMAccountName in file")
            seen.add(sam.lower())
            if r.get("password") and len(r["password"]) < 8:
                problems.append("password shorter than 8")
            for k in ("mustChange", "enabled"):
                if r.get(k) and r[k].lower() not in ("true", "false", "yes", "no", "1", "0"):
                    problems.append(f"{k} must be true or false")
        rows.append({"line": n, "data": r, "problems": problems})
    return rows, errors


def _public_row(r: dict) -> dict:
    d = dict(r["data"])
    if d.get("password"):
        d["password"] = "(set)"
    return {"line": r["line"], "data": d, "problems": r["problems"], "exists": r.get("exists", False)}


@router.get("/import")
async def import_page(request: Request, sess: Session = Depends(require_admin)):
    return await render(request, "admin/import.html", {"ou": request.query_params.get("ou") or ""})


@router.post("/import/preview", dependencies=CSRF)
async def import_preview(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    kind = "users" if form.get("kind") == "users" else "guests"
    ou = (form.get("ou") or "").strip()
    try:
        raw = await _upload(form)
    except ValueError:
        return fail(request, "/import", "The file is larger than 2 MB.")
    if not raw:
        return fail(request, "/import", "Choose a CSV file first.")
    if kind == "users" and not ou:
        return fail(request, "/import", "Enter the target OU for user accounts.")
    rows, errors = parse_csv(raw, kind)
    if kind == "users" and not errors:
        # Dry run: check which accounts already exist.
        for r in rows:
            if r["problems"]:
                continue
            try:
                found = await call(request, sess, "GET", "/ad/search", params={"filter": f"(sAMAccountName={r['data']['sAMAccountName']})", "scope": "sub", "attrs": "sAMAccountName", "limit": "1"})
            except AgentError:
                found = None
            if found:
                r["exists"] = True
                r["problems"].append("an account with this name already exists")
    valid = [r for r in rows if not r["problems"]]
    pending = PENDING.put({"kind": "csv-" + kind, "rows": valid, "ou": ou}) if valid and not errors else None
    return await render(request, "admin/import_csv_preview.html", {
        "kind": kind, "ou": ou, "rows": [_public_row(r) for r in rows], "errors": errors,
        "valid": len(valid), "invalid": len(rows) - len(valid), "pending": pending}, headers=NO_STORE)


def _bool(v: str | None, default: bool) -> bool:
    if not v:
        return default
    return v.lower() in ("true", "yes", "1")


@router.post("/import/apply", dependencies=CSRF)
async def import_apply(request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    item = PENDING.pop(form.get("pending"))
    if not item or not str(item.get("kind", "")).startswith("csv-"):
        return fail(request, "/import", "That import has expired. Upload the file again.")
    results, created_pw = [], []
    for r in item["rows"]:
        d = r["data"]
        label = f"Line {r['line']}"
        try:
            if item["kind"] == "csv-guests":
                body: dict[str, Any] = {"displayName": d["displayName"]} if d.get("displayName") else {}
                if d.get("minutes"):
                    body["minutes"] = int(d["minutes"])
                else:
                    body["expiryId"] = d["expiryId"]
                res = await call(request, sess, "POST", "/guests", json=body)
                created_pw.append({"username": res.get("username"), "upn": res.get("upn"), "password": res.get("password"), "expiresAt": res.get("expiresAt")})
                results.append({"row": f"{label}: {res.get('username')}", "ok": True, "message": flash_text(request, "Created")})
            else:
                sam = d["sAMAccountName"]
                attrs = {"sAMAccountName": [sam]}
                for k in ("givenName", "sn", "displayName", "mail", "description", "department", "title"):
                    if d.get(k):
                        attrs[k] = [d[k]]
                res = await call(request, sess, "POST", "/ad/object", json={"parentDn": item["ou"], "objectClass": "user", "rdn": f"CN={d.get('displayName') or sam}", "attributes": attrs})
                dn = (res or {}).get("dn") or f"CN={d.get('displayName') or sam},{item['ou']}"
                pw = d.get("password") or ""
                if not pw:
                    pw = secrets.token_urlsafe(12) + "a1!"
                    created_pw.append({"username": sam, "upn": "", "password": pw, "expiresAt": None})
                await call(request, sess, "POST", "/ad/user/password", json={"dn": dn, "password": pw, "mustChange": _bool(d.get("mustChange"), True)})
                if _bool(d.get("enabled"), True):
                    await call(request, sess, "POST", "/ad/user/enable", json={"dn": dn, "enabled": True})
                results.append({"row": f"{label}: {sam}", "ok": True, "message": flash_text(request, "Created")})
        except AgentError as exc:
            results.append({"row": label, "ok": False, "message": agent_message(request, exc)})
    return await render(request, "admin/import_results.html", {
        "title_key": "CSV import", "results": results, "back": "/import", "passwords": created_pw}, headers=NO_STORE)


@router.get("/import/template")
async def import_template(request: Request, sess: Session = Depends(require_admin)):
    if request.query_params.get("kind") == "users":
        body = "sAMAccountName,givenName,sn,displayName,password,mail,mustChange,enabled\r\njdoe,Jane,Doe,Jane Doe,,jane@example.org,true,true\r\n"
        return _download(body, "users-template.csv", "text/csv; charset=utf-8")
    return _download("displayName,expiryId,minutes\r\nVisitor one,4h,\r\nVisitor two,,90\r\n", "guests-template.csv", "text/csv; charset=utf-8")


# ================================================================ version history

def _hist_target(kind: str, name: str) -> tuple[str, str]:
    if kind == "settings":
        return "settings", "settings"
    m = re.fullmatch(r"script-(startup|logon)", kind)
    if m and SCRIPT_RE.fullmatch(name):
        return kind, name
    raise HTTPException(404)


async def _current(request, sess, kind: str, name: str) -> str:
    if kind == "settings":
        return settings_text(await call(request, sess, "GET", "/settings") or {})
    k = kind.split("-", 1)[1]
    try:
        res = await call(request, sess, "GET", f"/scripts/{k}/{quote(name, safe='')}") or {}
    except AgentError:
        return ""
    return res.get("content") or ""


@router.get("/history/{kind}")
async def history_list(kind: str, request: Request, sess: Session = Depends(require_admin)):
    kind, name = _hist_target(kind, request.query_params.get("name") or "settings")
    hist = request.app.state.history
    versions = hist.list(kind, name)
    sel = request.query_params.get("v")
    d, selected = None, None
    if sel:
        selected = hist.get(kind, name, sel)
        if selected:
            d = diff(selected.get("content") or "", await _current(request, sess, kind, name))
    back = "/settings" if kind == "settings" else f"/scripts/{kind.split('-', 1)[1]}/{quote(name, safe='')}"
    return await render(request, "admin/history.html", {"kind": kind, "name": name, "versions": versions, "sel": sel,
                                                        "diff": d, "selected": selected, "back": back})


@router.post("/history/{kind}/restore", dependencies=CSRF)
async def history_restore(kind: str, request: Request, sess: Session = Depends(require_admin)):
    form = await form_of(request)
    kind, name = _hist_target(kind, form.get("name") or "settings")
    hist = request.app.state.history
    v = hist.get(kind, name, form.get("v") or "")
    url = f"/history/{kind}?name={quote(name, safe='')}"
    if not v:
        return fail(request, url, "That version was not found.")
    try:
        if kind == "settings":
            doc = json.loads(v["content"])
            clean, errors = settings_schema.validate_settings(doc)
            if errors:
                return fail(request, url, "That version does not pass validation any more, so it was not restored.")
            await call(request, sess, "PUT", "/settings", json=clean)
            hist.record(kind, name, settings_text(clean), _user(sess))
        else:
            k = kind.split("-", 1)[1]
            await call(request, sess, "PUT", f"/scripts/{k}/{quote(name, safe='')}", json={"content": v["content"]})
            hist.record(kind, name, v["content"], _user(sess))
    except AgentError as exc:
        return fail(request, url, exc)
    return ok(request, url, "Version restored.")


WIFI_AUTH, Response
