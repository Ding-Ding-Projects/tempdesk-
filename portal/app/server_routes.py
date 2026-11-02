"""Server management console (Windows Admin Center style).

The portal owner includes ``server_routes.router`` when this module is present.
Everything here acts on the server the agent runs on, through the
``/server/*``, ``/jobs/*``, ``/dns/*`` and ``/dhcp/*`` agent routes documented in
docs/API.md.

Hooks used (adapt here if the owner's names differ):
  * ``require_admin``       -> the signed-in admin Session
  * ``get_agent_client()``  -> shared AgentClient (``.request(...)`` / ``.call(...)``)
  * ``render(request, name, ctx)`` -> renders against ``layouts/admin.html``
  * ``csrf_protect``        -> form CSRF dependency
  * ``app.nav.NAV_ITEMS``   -> nav rail / palette registry (appended at import)

Live charts (Overview) and every table action are driven by the static scripts
in ``static/js/server-*.js``; the CSP forbids inline scripts, so no JS lives in
the templates. JSON proxy endpoints below feed those scripts.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse, Response
from urllib.parse import quote

from . import nav as navmod
from .agent_client import AgentError, AgentUnavailable
from .security import Session
from .web import (
    csrf_protect,
    get_agent_client,
    render,
    require_admin,
)

router = APIRouter(prefix="/server")
CSRF = [Depends(csrf_protect)]


# ------------------------------------------------------------------ nav

# Group "Server" so the rail and command palette show these together. Each
# entry's capability is the /health id the agent reports for that tool, so the
# item hides when the backend (for example Samba) does not support it.
_NAV = [
    ("server-overview", "Server overview", "/server", "server", "server"),
    ("server-services", "Services", "/server/services", "service", "services"),
    ("server-processes", "Processes", "/server/processes", "cpu", "processes"),
    ("server-events", "Event logs", "/server/events", "history", "events"),
    ("server-files", "Files", "/server/files", "folder", "files"),
    ("server-firewall", "Firewall", "/server/firewall", "shield", "firewall"),
    ("server-features", "Roles and features", "/server/features", "apps", "features"),
    ("server-updates", "Updates", "/server/updates", "download", "updates"),
    ("server-storage", "Storage", "/server/storage", "disk", "storage"),
    ("server-network", "Networks", "/server/network", "wifi", "network"),
    ("server-registry", "Registry", "/server/registry", "tree", "registry"),
    ("server-tasks", "Scheduled tasks", "/server/tasks", "clock", "tasks"),
    ("server-certificates", "Certificates", "/server/certificates", "lock", "certificates"),
    ("server-devices", "Devices", "/server/devices", "chip", "devices"),
    ("server-dns", "DNS server", "/server/dns", "globe", "dns"),
    ("server-dhcp", "DHCP server", "/server/dhcp", "network", "dhcp"),
    ("server-perfmon", "Performance", "/server/perfmon", "chart", "perfmon"),
    ("server-console", "PowerShell", "/server/console", "terminal", "console"),
]


def _register_nav() -> None:
    have = {i["id"] for i in navmod.NAV_ITEMS}
    for id_, label, href, icon, cap in _NAV:
        if id_ in have:
            continue
        navmod.NAV_ITEMS.append({
            "id": id_, "label": label, "href": href, "icon": icon,
            "capability": cap, "group": "Server",
            "primary": id_ == "server-overview",
        })


_register_nav()


# ------------------------------------------------------------------ helpers

def _agent(request: Request):
    return get_agent_client(request)


async def _call(request: Request, sess: Session, method: str, path: str, **kw) -> Any:
    """Agent call carrying the admin bearer token."""
    return await _agent(request).call(method, path, token=sess.token, **kw)


async def _req(request: Request, sess: Session, method: str, path: str, **kw):
    """Agent call returning the raw httpx.Response (for downloads / status)."""
    return await _agent(request).request(method, path, token=sess.token, **kw)


def _needs_elevation(request: Request, sess: Session) -> RedirectResponse | None:
    """Return a redirect to the elevation page when a fresh password
    confirmation is missing, else None."""
    if sess.elevated:
        return None
    nxt = request.url.path + (("?" + request.url.query) if request.url.query else "")
    return RedirectResponse("/auth/elevate?next=" + quote(nxt, safe="/"), status_code=303)


async def _page(request: Request, sess: Session, template: str, title: str,
                extra: dict | None = None) -> Response:
    ctx = {"tab_title": title, "page_title": title}
    if extra:
        ctx.update(extra)
    return await render(request, template, ctx)


def _json_error(exc: AgentError) -> JSONResponse:
    return JSONResponse({"error": exc.code, "message": exc.message}, status_code=exc.status)


# ================================================================ Overview

@router.get("")
async def overview(request: Request, sess: Session = Depends(require_admin)):
    data = None
    error = None
    try:
        data = await _call(request, sess, "GET", "/server/overview")
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/overview.html", "Server overview",
                       {"overview": data, "overview_error": error})


@router.get("/metrics")
async def metrics(request: Request, sess: Session = Depends(require_admin)):
    """JSON proxy the Overview charts poll every 2 seconds."""
    try:
        data = await _call(request, sess, "GET", "/server/metrics")
    except AgentError as exc:
        return _json_error(exc)
    except AgentUnavailable:
        return JSONResponse({"error": "unavailable"}, status_code=503)
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


@router.post("/power", dependencies=CSRF)
async def power(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    action = (form.get("action") or "").strip()
    if action not in ("restart", "shutdown"):
        raise HTTPException(status_code=400, detail="action must be restart or shutdown")
    # The destructive "confirm" value is forwarded to the agent exactly as the
    # API requires; the agent is the authority, not the UI.
    confirm = form.get("confirm_name") or ""
    try:
        delay = int(form.get("delaySeconds") or 30)
    except ValueError:
        delay = 30
    try:
        await _call(request, sess, "POST", "/server/power",
                    json={"action": action, "confirm": confirm, "delaySeconds": delay})
    except AgentError as exc:
        return RedirectResponse("/server?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server?scheduled=" + action, status_code=303)


@router.post("/identity", dependencies=CSRF)
async def identity(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    name = (form.get("computerName") or "").strip()
    try:
        await _call(request, sess, "PUT", "/server/identity", json={"computerName": name})
    except AgentError as exc:
        return RedirectResponse("/server?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server?renamed=1", status_code=303)


# ================================================================ Services

@router.get("/services")
async def services(request: Request, sess: Session = Depends(require_admin)):
    rows = []
    error = None
    try:
        rows = await _call(request, sess, "GET", "/server/services") or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/services.html", "Services",
                       {"services": rows, "error": error})


@router.post("/services/{name}/{op}", dependencies=CSRF)
async def service_op(name: str, op: str, request: Request, sess: Session = Depends(require_admin)):
    try:
        await _call(request, sess, "POST", f"/server/services/{quote(name, safe='')}/{op}")
    except AgentError as exc:
        return RedirectResponse("/server/services?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/services?done=1", status_code=303)


@router.post("/services/{name}/startup", dependencies=CSRF)
async def service_startup(name: str, request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    try:
        await _call(request, sess, "PATCH", f"/server/services/{quote(name, safe='')}",
                    json={"startupType": form.get("startupType") or "Manual"})
    except AgentError as exc:
        return RedirectResponse("/server/services?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/services?done=1", status_code=303)


# ================================================================ Processes

@router.get("/processes")
async def processes(request: Request, sess: Session = Depends(require_admin)):
    rows = []
    error = None
    try:
        rows = await _call(request, sess, "GET", "/server/processes") or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/processes.html", "Processes",
                       {"processes": rows, "error": error})


@router.post("/processes/{pid}/kill", dependencies=CSRF)
async def kill_process(pid: int, request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    confirm = form.get("confirm_name") or ""
    try:
        await _call(request, sess, "DELETE", f"/server/processes/{pid}", params={"confirm": confirm})
    except AgentError as exc:
        return RedirectResponse("/server/processes?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/processes?done=1", status_code=303)


# ================================================================ Events

@router.get("/events")
async def events(request: Request, sess: Session = Depends(require_admin)):
    logs = []
    rows = []
    error = None
    log = request.query_params.get("log") or "System"
    try:
        logs = await _call(request, sess, "GET", "/server/eventlogs") or []
        params = {
            "log": log,
            "level": request.query_params.get("level"),
            "since": request.query_params.get("since"),
            "q": request.query_params.get("q"),
            "limit": request.query_params.get("limit") or 200,
        }
        rows = await _call(request, sess, "GET", "/server/events", params=params) or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/events.html", "Event logs",
                       {"logs": logs, "events": rows, "selected_log": log, "error": error})


@router.get("/events/export")
async def events_export(request: Request, sess: Session = Depends(require_admin)):
    log = request.query_params.get("log") or "System"
    try:
        resp = await _req(request, sess, "GET", f"/server/eventlogs/{quote(log, safe='')}/export")
    except AgentError as exc:
        return _json_error(exc)
    return Response(resp.content, media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{log}.evtx"'})


@router.post("/events/clear", dependencies=CSRF)
async def events_clear(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    name = form.get("log") or ""
    confirm = form.get("confirm_name") or ""
    try:
        await _call(request, sess, "POST", f"/server/eventlogs/{quote(name, safe='')}/clear",
                    json={"confirm": confirm})
    except AgentError as exc:
        return RedirectResponse("/server/events?err=" + quote(exc.message), status_code=303)
    return RedirectResponse(f"/server/events?log={quote(name)}&cleared=1", status_code=303)


# ================================================================ Files

@router.get("/files")
async def files(request: Request, sess: Session = Depends(require_admin)):
    path = request.query_params.get("path") or ""
    listing = None
    error = None
    try:
        listing = await _call(request, sess, "GET", "/server/files", params={"path": path})
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/files.html", "Files",
                       {"listing": listing, "path": path, "error": error})


@router.get("/files/download")
async def files_download(request: Request, sess: Session = Depends(require_admin)):
    path = request.query_params.get("path") or ""
    try:
        resp = await _req(request, sess, "GET", "/server/files/download", params={"path": path})
    except AgentError as exc:
        return _json_error(exc)
    leaf = path.rstrip("\\/").rsplit("\\", 1)[-1].rsplit("/", 1)[-1] or "download"
    return Response(resp.content, media_type="application/octet-stream",
                    headers={"Content-Disposition": f'attachment; filename="{leaf}"'})


@router.post("/files/upload", dependencies=CSRF)
async def files_upload(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    path = form.get("path") or ""
    upload = form.get("file")
    if upload is None or not hasattr(upload, "filename"):
        raise HTTPException(status_code=400, detail="no file")
    content = await upload.read()
    try:
        await _req(request, sess, "POST", "/server/files/upload", params={"path": path},
                   files={"file": (upload.filename, content)})
    except AgentError as exc:
        return RedirectResponse(f"/server/files?path={quote(path)}&err=" + quote(exc.message), status_code=303)
    return RedirectResponse(f"/server/files?path={quote(path)}&uploaded=1", status_code=303)


# Registered before the catch-all /files/{op} so the literal "delete" path
# wins (FastAPI matches routes in definition order).
@router.post("/files/delete", dependencies=CSRF)
async def files_delete(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    path = form.get("path") or ""
    parent = path.rstrip("\\/").rsplit("\\", 1)[0]
    confirm = form.get("confirm_name") or ""
    try:
        await _call(request, sess, "DELETE", "/server/files", params={"path": path, "confirm": confirm})
    except AgentError as exc:
        return RedirectResponse(f"/server/files?path={quote(parent)}&err=" + quote(exc.message), status_code=303)
    return RedirectResponse(f"/server/files?path={quote(parent)}&done=1", status_code=303)


@router.post("/files/{op}", dependencies=CSRF)
async def files_op(op: str, request: Request, sess: Session = Depends(require_admin)):
    if op not in ("mkdir", "rename", "copy", "move"):
        raise HTTPException(status_code=404)
    form = await request.form()
    body = {k: v for k, v in form.items() if k not in ("csrf_token",)}
    try:
        await _call(request, sess, "POST", f"/server/files/{op}", json=body)
    except AgentError as exc:
        return RedirectResponse(f"/server/files?path={quote(body.get('path', ''))}&err=" + quote(exc.message), status_code=303)
    return RedirectResponse(f"/server/files?path={quote(body.get('path', ''))}&done=1", status_code=303)


# ================================================================ Firewall

@router.get("/firewall")
async def firewall(request: Request, sess: Session = Depends(require_admin)):
    profiles = []
    rules = []
    error = None
    try:
        profiles = await _call(request, sess, "GET", "/server/firewall/profiles") or []
        rules = await _call(request, sess, "GET", "/server/firewall/rules",
                            params={"q": request.query_params.get("q")}) or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/firewall.html", "Firewall",
                       {"profiles": profiles, "rules": rules, "error": error})


@router.post("/firewall/profiles/{name}", dependencies=CSRF)
async def firewall_profile(name: str, request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    body: dict = {}
    if "enabled" in form:
        body["enabled"] = form.get("enabled") == "true"
    for key in ("defaultInboundAction", "defaultOutboundAction"):
        if form.get(key):
            body[key] = form.get(key)
    try:
        await _call(request, sess, "PATCH", f"/server/firewall/profiles/{name}", json=body)
    except AgentError as exc:
        return RedirectResponse("/server/firewall?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/firewall?done=1", status_code=303)


@router.post("/firewall/rules", dependencies=CSRF)
async def firewall_rule_create(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    body = {k: v for k, v in form.items() if k != "csrf_token" and v != ""}
    try:
        await _call(request, sess, "POST", "/server/firewall/rules", json=body)
    except AgentError as exc:
        return RedirectResponse("/server/firewall?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/firewall?done=1", status_code=303)


@router.post("/firewall/rules/{name}/delete", dependencies=CSRF)
async def firewall_rule_delete(name: str, request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    confirm = form.get("confirm_name") or ""
    try:
        await _call(request, sess, "DELETE", f"/server/firewall/rules/{quote(name, safe='')}",
                    params={"confirm": confirm})
    except AgentError as exc:
        return RedirectResponse("/server/firewall?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/firewall?done=1", status_code=303)


# ================================================================ Features / Updates (jobs)

@router.get("/features")
async def features(request: Request, sess: Session = Depends(require_admin)):
    rows = []
    error = None
    try:
        rows = await _call(request, sess, "GET", "/server/features") or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/features.html", "Roles and features",
                       {"features": rows, "error": error})


@router.post("/features/{action}", dependencies=CSRF)
async def features_change(action: str, request: Request, sess: Session = Depends(require_admin)):
    if action not in ("install", "uninstall"):
        raise HTTPException(status_code=404)
    form = await request.form()
    names = [n for n in (form.get("names") or "").replace("\r", "").split("\n") if n.strip()]
    body = {
        "names": [n.strip() for n in names],
        "includeManagementTools": form.get("includeManagementTools") == "on",
        "restart": form.get("restart") == "on",
    }
    try:
        resp = await _req(request, sess, "POST", f"/server/features/{action}", json=body)
        data = resp.json()
    except AgentError as exc:
        return RedirectResponse("/server/features?err=" + quote(exc.message), status_code=303)
    job_id = data.get("jobId") if isinstance(data, dict) else None
    return RedirectResponse(f"/server/jobs/{job_id}", status_code=303)


@router.get("/updates")
async def updates(request: Request, sess: Session = Depends(require_admin)):
    data = None
    error = None
    try:
        data = await _call(request, sess, "GET", "/server/updates")
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/updates.html", "Updates",
                       {"updates": data, "error": error})


@router.post("/updates/scan", dependencies=CSRF)
async def updates_scan(request: Request, sess: Session = Depends(require_admin)):
    try:
        await _call(request, sess, "POST", "/server/updates/scan")
    except AgentError as exc:
        return RedirectResponse("/server/updates?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/updates?scanned=1", status_code=303)


@router.post("/updates/install", dependencies=CSRF)
async def updates_install(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    ids = form.getlist("ids") if hasattr(form, "getlist") else [form.get("ids")]
    ids = [i for i in ids if i]
    try:
        resp = await _req(request, sess, "POST", "/server/updates/install", json={"ids": ids})
        data = resp.json()
    except AgentError as exc:
        return RedirectResponse("/server/updates?err=" + quote(exc.message), status_code=303)
    job_id = data.get("jobId") if isinstance(data, dict) else None
    return RedirectResponse(f"/server/jobs/{job_id}", status_code=303)


@router.get("/jobs/{job_id}")
async def job_page(job_id: str, request: Request, sess: Session = Depends(require_admin)):
    return await _page(request, sess, "server/job.html", "Working", {"job_id": job_id})


@router.get("/jobs/{job_id}/status")
async def job_status(job_id: str, request: Request, sess: Session = Depends(require_admin)):
    """JSON proxy the job progress view polls."""
    try:
        data = await _call(request, sess, "GET", f"/jobs/{quote(job_id, safe='')}")
    except AgentError as exc:
        return _json_error(exc)
    return JSONResponse(data, headers={"Cache-Control": "no-store"})


# ================================================================ Storage

@router.get("/storage")
async def storage(request: Request, sess: Session = Depends(require_admin)):
    disks = volumes = partitions = shares = []
    error = None
    try:
        disks = await _call(request, sess, "GET", "/server/disks") or []
        volumes = await _call(request, sess, "GET", "/server/volumes") or []
        partitions = await _call(request, sess, "GET", "/server/partitions") or []
        shares = await _call(request, sess, "GET", "/server/shares") or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/storage.html", "Storage",
                       {"disks": disks, "volumes": volumes, "partitions": partitions,
                        "shares": shares, "error": error})


@router.post("/storage/volumes/{vid}/format", dependencies=CSRF)
async def volume_format(vid: str, request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    body = {"confirm": form.get("confirm_name") or "", "fileSystem": form.get("fileSystem") or "NTFS"}
    if form.get("label"):
        body["label"] = form.get("label")
    try:
        await _call(request, sess, "POST", f"/server/volumes/{quote(vid, safe='')}/format", json=body)
    except AgentError as exc:
        return RedirectResponse("/server/storage?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/storage?done=1", status_code=303)


@router.post("/storage/shares", dependencies=CSRF)
async def share_create(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    body = {"name": form.get("name") or "", "path": form.get("path") or ""}
    if form.get("description"):
        body["description"] = form.get("description")
    try:
        await _call(request, sess, "POST", "/server/shares", json=body)
    except AgentError as exc:
        return RedirectResponse("/server/storage?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/storage?done=1", status_code=303)


@router.post("/storage/shares/delete", dependencies=CSRF)
async def share_delete(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    name = form.get("name") or ""
    try:
        await _call(request, sess, "DELETE", "/server/shares",
                    params={"name": name, "confirm": form.get("confirm_name") or ""})
    except AgentError as exc:
        return RedirectResponse("/server/storage?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/storage?done=1", status_code=303)


# ================================================================ Network

@router.get("/network")
async def network(request: Request, sess: Session = Depends(require_admin)):
    adapters = routes = []
    error = None
    try:
        adapters = await _call(request, sess, "GET", "/server/network/adapters") or []
        routes = await _call(request, sess, "GET", "/server/network/routes") or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/network.html", "Networks",
                       {"adapters": adapters, "routes": routes, "error": error})


@router.post("/network/adapters/{if_index}", dependencies=CSRF)
async def network_adapter(if_index: int, request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    body: dict = {}
    if "enabled" in form:
        body["enabled"] = form.get("enabled") == "true"
    if form.get("dhcp") == "on":
        body["dhcp"] = True
    else:
        for k in ("ipAddress", "gateway"):
            if form.get(k):
                body[k] = form.get(k)
        if form.get("prefixLength"):
            try:
                body["prefixLength"] = int(form.get("prefixLength"))
            except ValueError:
                pass
    dns = [d.strip() for d in (form.get("dnsServers") or "").replace("\r", "").split("\n") if d.strip()]
    if dns or form.get("setDns") == "on":
        body["dnsServers"] = dns
    try:
        await _call(request, sess, "PATCH", f"/server/network/adapters/{if_index}", json=body)
    except AgentError as exc:
        return RedirectResponse("/server/network?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/network?done=1", status_code=303)


@router.post("/network/test", dependencies=CSRF)
async def network_test(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    body: dict = {"target": form.get("target") or ""}
    if form.get("port"):
        try:
            body["port"] = int(form.get("port"))
        except ValueError:
            pass
    try:
        data = await _call(request, sess, "POST", "/server/network/test", json=body)
    except AgentError as exc:
        return _json_error(exc)
    return JSONResponse(data)


# ================================================================ Registry

@router.get("/registry")
async def registry(request: Request, sess: Session = Depends(require_admin)):
    path = request.query_params.get("path") or "HKLM:\\SOFTWARE"
    data = None
    error = None
    try:
        data = await _call(request, sess, "GET", "/server/registry", params={"path": path})
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/registry.html", "Registry",
                       {"registry": data, "path": path, "error": error})


@router.post("/registry/value", dependencies=CSRF)
async def registry_value(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    body = {
        "path": form.get("path") or "",
        "name": form.get("name") or "",
        "type": form.get("type") or "String",
        "value": form.get("value") or "",
    }
    try:
        await _call(request, sess, "PUT", "/server/registry/value", json=body)
    except AgentError as exc:
        return RedirectResponse(f"/server/registry?path={quote(body['path'])}&err=" + quote(exc.message), status_code=303)
    return RedirectResponse(f"/server/registry?path={quote(body['path'])}&done=1", status_code=303)


@router.post("/registry/key/delete", dependencies=CSRF)
async def registry_key_delete(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    path = form.get("path") or ""
    parent = path.rsplit("\\", 1)[0]
    try:
        await _call(request, sess, "DELETE", "/server/registry/key",
                    params={"path": path, "confirm": form.get("confirm_name") or ""})
    except AgentError as exc:
        return RedirectResponse(f"/server/registry?path={quote(parent)}&err=" + quote(exc.message), status_code=303)
    return RedirectResponse(f"/server/registry?path={quote(parent)}&done=1", status_code=303)


@router.get("/registry/export")
async def registry_export(request: Request, sess: Session = Depends(require_admin)):
    path = request.query_params.get("path") or ""
    try:
        resp = await _req(request, sess, "GET", "/server/registry/export", params={"path": path})
    except AgentError as exc:
        return _json_error(exc)
    return Response(resp.content, media_type="application/octet-stream",
                    headers={"Content-Disposition": 'attachment; filename="registry-export.reg"'})


# ================================================================ Tasks

@router.get("/tasks")
async def tasks(request: Request, sess: Session = Depends(require_admin)):
    rows = []
    error = None
    try:
        rows = await _call(request, sess, "GET", "/server/tasks",
                          params={"path": request.query_params.get("path")}) or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/tasks.html", "Scheduled tasks",
                       {"tasks": rows, "error": error})


@router.post("/tasks", dependencies=CSRF)
async def task_create(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    body: dict = {
        "name": form.get("name") or "",
        "path": form.get("path") or "\\",
        "description": form.get("description") or "",
        "actions": [{
            "execute": form.get("execute") or "",
            "arguments": form.get("arguments") or "",
            "workingDirectory": form.get("workingDirectory") or "",
        }],
        "principal": {"userId": form.get("userId") or "SYSTEM", "runLevel": form.get("runLevel") or "Highest"},
    }
    trigger: dict = {"type": form.get("triggerType") or "daily"}
    if form.get("at"):
        trigger["at"] = form.get("at")
    days = form.getlist("daysOfWeek") if hasattr(form, "getlist") else []
    if days:
        trigger["daysOfWeek"] = days
    if form.get("user"):
        trigger["user"] = form.get("user")
    body["triggers"] = [trigger]
    try:
        await _call(request, sess, "POST", "/server/tasks", json=body)
    except AgentError as exc:
        return RedirectResponse("/server/tasks?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/tasks?done=1", status_code=303)


@router.post("/tasks/{path}/{name}/{op}", dependencies=CSRF)
async def task_op(path: str, name: str, op: str, request: Request, sess: Session = Depends(require_admin)):
    if op == "delete":
        form = await request.form()
        try:
            await _call(request, sess, "DELETE", f"/server/tasks/{quote(path, safe='')}/{quote(name, safe='')}",
                        params={"confirm": form.get("confirm_name") or ""})
        except AgentError as exc:
            return RedirectResponse("/server/tasks?err=" + quote(exc.message), status_code=303)
    else:
        try:
            await _call(request, sess, "POST",
                        f"/server/tasks/{quote(path, safe='')}/{quote(name, safe='')}/{op}")
        except AgentError as exc:
            return RedirectResponse("/server/tasks?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/tasks?done=1", status_code=303)


# ================================================================ Certificates

@router.get("/certificates")
async def certificates(request: Request, sess: Session = Depends(require_admin)):
    store = request.query_params.get("store") or "LocalMachine\\My"
    rows = []
    error = None
    try:
        rows = await _call(request, sess, "GET", "/server/certificates", params={"store": store}) or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/certificates.html", "Certificates",
                       {"certificates": rows, "store": store, "error": error})


@router.post("/certificates/selfsigned", dependencies=CSRF)
async def cert_selfsigned(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    names = [n.strip() for n in (form.get("dnsNames") or "").replace("\r", "").split("\n") if n.strip()]
    body: dict = {"dnsNames": names}
    try:
        body["years"] = int(form.get("years") or 5)
    except ValueError:
        body["years"] = 5
    try:
        await _call(request, sess, "POST", "/server/certificates/selfsigned", json=body,
                    params={"store": form.get("store")})
    except AgentError as exc:
        return RedirectResponse("/server/certificates?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/certificates?done=1", status_code=303)


@router.post("/certificates/{thumbprint}/delete", dependencies=CSRF)
async def cert_delete(thumbprint: str, request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    try:
        await _call(request, sess, "DELETE", f"/server/certificates/{thumbprint}",
                    params={"confirm": form.get("confirm_name") or "", "store": form.get("store")})
    except AgentError as exc:
        return RedirectResponse("/server/certificates?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/certificates?done=1", status_code=303)


@router.get("/certificates/{thumbprint}/export")
async def cert_export(thumbprint: str, request: Request, sess: Session = Depends(require_admin)):
    try:
        resp = await _req(request, sess, "GET", f"/server/certificates/{thumbprint}/export",
                          params={"store": request.query_params.get("store")})
    except AgentError as exc:
        return _json_error(exc)
    return Response(resp.content, media_type="application/x-x509-ca-cert",
                    headers={"Content-Disposition": f'attachment; filename="{thumbprint}.cer"'})


# ================================================================ Devices

@router.get("/devices")
async def devices(request: Request, sess: Session = Depends(require_admin)):
    rows = []
    error = None
    try:
        rows = await _call(request, sess, "GET", "/server/devices") or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/devices.html", "Devices",
                       {"devices": rows, "error": error})


@router.post("/devices/{op}", dependencies=CSRF)
async def device_op(op: str, request: Request, sess: Session = Depends(require_admin)):
    if op not in ("enable", "disable"):
        raise HTTPException(status_code=404)
    form = await request.form()
    instance = form.get("instanceId") or ""
    try:
        await _call(request, sess, "POST", f"/server/devices/{quote(instance, safe='')}/{op}")
    except AgentError as exc:
        return RedirectResponse("/server/devices?err=" + quote(exc.message), status_code=303)
    return RedirectResponse("/server/devices?done=1", status_code=303)


# ================================================================ DNS

@router.get("/dns")
async def dns(request: Request, sess: Session = Depends(require_admin)):
    zones = []
    error = None
    records = None
    zone = request.query_params.get("zone")
    try:
        zones = await _call(request, sess, "GET", "/dns/zones") or []
        if zone:
            records = await _call(request, sess, "GET",
                                  f"/dns/zones/{quote(zone, safe='')}/records") or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/dns.html", "DNS server",
                       {"zones": zones, "records": records, "zone": zone, "error": error})


@router.post("/dns/records", dependencies=CSRF)
async def dns_record_create(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    zone = form.get("zone") or ""
    body = {k: v for k, v in form.items() if k not in ("csrf_token", "zone") and v != ""}
    try:
        await _call(request, sess, "POST", f"/dns/zones/{quote(zone, safe='')}/records", json=body)
    except AgentError as exc:
        return RedirectResponse(f"/server/dns?zone={quote(zone)}&err=" + quote(exc.message), status_code=303)
    return RedirectResponse(f"/server/dns?zone={quote(zone)}&done=1", status_code=303)


@router.post("/dns/records/delete", dependencies=CSRF)
async def dns_record_delete(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    zone = form.get("zone") or ""
    params = {
        "name": form.get("name") or "",
        "recordType": form.get("recordType") or "",
        "confirm": form.get("confirm_name") or "",
    }
    try:
        await _call(request, sess, "DELETE", f"/dns/zones/{quote(zone, safe='')}/records", params=params)
    except AgentError as exc:
        return RedirectResponse(f"/server/dns?zone={quote(zone)}&err=" + quote(exc.message), status_code=303)
    return RedirectResponse(f"/server/dns?zone={quote(zone)}&done=1", status_code=303)


# ================================================================ DHCP

@router.get("/dhcp")
async def dhcp(request: Request, sess: Session = Depends(require_admin)):
    scopes = []
    error = None
    try:
        scopes = await _call(request, sess, "GET", "/dhcp/scopes") or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/dhcp.html", "DHCP server",
                       {"scopes": scopes, "error": error})


# ================================================================ Performance

@router.get("/perfmon")
async def perfmon(request: Request, sess: Session = Depends(require_admin)):
    sets = []
    error = None
    try:
        sets = await _call(request, sess, "GET", "/server/counters",
                          params={"set": request.query_params.get("set")}) or []
    except AgentError as exc:
        error = exc.message
    return await _page(request, sess, "server/perfmon.html", "Performance",
                       {"counter_sets": sets, "error": error})


@router.post("/perfmon/sample", dependencies=CSRF)
async def perfmon_sample(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    paths = [p.strip() for p in (form.get("paths") or "").replace("\r", "").split("\n") if p.strip()]
    body: dict = {"paths": paths}
    try:
        body["samples"] = int(form.get("samples") or 1)
    except ValueError:
        body["samples"] = 1
    try:
        data = await _call(request, sess, "POST", "/server/counters/sample", json=body)
    except AgentError as exc:
        return _json_error(exc)
    return JSONResponse(data)


# ================================================================ PowerShell console

@router.get("/console")
async def console(request: Request, sess: Session = Depends(require_admin)):
    # Full control of the domain controller: a fresh password confirmation is
    # required before the page loads, matching the agent's requiresElevation.
    redirect = _needs_elevation(request, sess)
    if redirect is not None:
        return redirect
    return await _page(request, sess, "server/console.html", "PowerShell")


@router.post("/console/sessions", dependencies=CSRF)
async def console_new(request: Request, sess: Session = Depends(require_admin)):
    if not sess.elevated:
        return JSONResponse({"error": "forbidden", "message": "Confirm your password first."}, status_code=403)
    try:
        resp = await _req(request, sess, "POST", "/server/console/sessions",
                          elevation=sess.elevation_token())
        return JSONResponse(resp.json(), status_code=201)
    except AgentError as exc:
        return _json_error(exc)


@router.post("/console/sessions/{sid}/run", dependencies=CSRF)
async def console_run(sid: str, request: Request, sess: Session = Depends(require_admin)):
    if not sess.elevated:
        return JSONResponse({"error": "forbidden", "message": "Confirm your password first."}, status_code=403)
    body = await request.json()
    try:
        data = await _call(request, sess, "POST", f"/server/console/sessions/{quote(sid, safe='')}/run",
                           json={"command": (body or {}).get("command", "")},
                           elevation=sess.elevation_token())
    except AgentError as exc:
        return _json_error(exc)
    return JSONResponse(data)


@router.post("/console/sessions/{sid}/close", dependencies=CSRF)
async def console_close(sid: str, request: Request, sess: Session = Depends(require_admin)):
    try:
        await _call(request, sess, "DELETE", f"/server/console/sessions/{quote(sid, safe='')}",
                    elevation=sess.elevation_token())
    except AgentError:
        pass
    return JSONResponse({"ok": True})
