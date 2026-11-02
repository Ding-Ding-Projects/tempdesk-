"""History page, undo and redo.

Inverse operation kinds:
  {"kind": "http", "method", "path", "params", "json"}       replay one agent call
  {"kind": "multi", "steps": [inverse, ...]}                  several in order
  {"kind": "gpo-restore", "gpoId", "backupId"}                restore a GPO backup
  {"kind": "recycle", "guid", "name"}                         Restore-ADObject from the AD Recycle Bin
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from .agent_client import AgentError
from .security import Session
from .undo import REDACTED, Journal, normalize, pick
from .web import agent_message, flash_text, redirect, render, require_admin, csrf_protect

router = APIRouter()
CSRF = [Depends(csrf_protect)]


def journal(request: Request) -> Journal:
    return request.app.state.journal


def user_of(sess: Session) -> str:
    return str(sess.user.get("sam") or sess.user.get("displayName") or "admin")


def track(_req: Request, sess: Session, **kw) -> dict | None:
    """Record one successful action. Never raises."""
    try:
        return journal(_req).record(user=user_of(sess), **kw)
    except Exception:  # noqa: BLE001
        return None


def http_inv(method: str, path: str, params: dict | None = None, json_body: Any = None) -> dict:
    return {"kind": "http", "method": method, "path": path, "params": params, "json": json_body}


def check_spec(path: str, params: dict | None = None, pick_path: str | None = None, method: str = "GET") -> dict:
    return {"method": method, "path": path, "params": params, "pick": pick_path}


async def gpo_snapshot(request: Request, sess: Session, gid: str) -> str | None:
    """Back up a GPO before a change. Returns the backup id or None."""
    try:
        res = await request.app.state.agent.call("POST", f"/gpo/{quote(gid, safe='')}/backup", token=sess.token)
        return (res or {}).get("backupId")
    except AgentError:
        return None


def _contains_redacted(v: Any) -> bool:
    if v == REDACTED:
        return True
    if isinstance(v, dict):
        return any(_contains_redacted(x) for x in v.values())
    if isinstance(v, list):
        return any(_contains_redacted(x) for x in v)
    return False


async def _run(request: Request, sess: Session, inv: dict) -> None:
    agent = request.app.state.agent
    kind = inv.get("kind", "http")
    if kind == "multi":
        for step in inv.get("steps") or []:
            await _run(request, sess, step)
    elif kind == "http":
        if _contains_redacted(inv.get("json")):
            raise AgentError(400, "bad_request", "This step needs a secret that is never stored, so it cannot be replayed.")
        await agent.call(inv["method"], inv["path"], params=inv.get("params"), json=inv.get("json"), token=sess.token)
    elif kind == "gpo-restore":
        await agent.call("POST", f"/gpo/{quote(inv['gpoId'], safe='')}/restore", json={"backupId": inv["backupId"]}, token=sess.token)
    elif kind == "recycle":
        res = await agent.call("POST", "/cmdlets/invoke", token=sess.token, json={
            "name": "Restore-ADObject", "parameters": {"Identity": inv["guid"]}, "whatIf": False, "confirm": "Restore-ADObject"})
        if isinstance(res, dict) and res.get("errors"):
            raise AgentError(400, "bad_request", "; ".join(map(str, res["errors"]))[:300])
    else:
        raise AgentError(400, "bad_request", "Unknown inverse operation.")


async def conflict(request: Request, sess: Session, rec: dict) -> str | None:
    """Return a reason when the current state no longer equals the recorded AFTER state."""
    chk = rec.get("check")
    if not chk:
        return None
    try:
        cur = await request.app.state.agent.call(chk.get("method", "GET"), chk["path"], params=chk.get("params"), token=sess.token)
    except AgentError as exc:
        if exc.code == "not_found" and rec.get("after") is None:
            return None
        if exc.code == "not_found":
            return flash_text(request, "The item no longer exists, so this cannot be undone safely.")
        raise
    if normalize(pick(cur, chk.get("pick"))) != normalize(rec.get("after")):
        return flash_text(request, "The item was changed after this action, so undoing it would overwrite newer work. Undo the later change first, or change it by hand.")
    return None


async def do_undo(request: Request, sess: Session, rid: str) -> tuple[bool, str]:
    j = journal(request)
    rec = j.get(rid)
    if not rec:
        return False, flash_text(request, "That history entry was not found.")
    if rec.get("status") != "done":
        return False, flash_text(request, "That action is already undone.")
    if not rec.get("undoable"):
        return False, flash_text(request, "This action cannot be undone.") + " " + (rec.get("reason") or "")
    deps = j.dependents(rec)
    if deps:
        return False, flash_text(request, "Later changes to the same item exist. Undo those first ({count}).", count=len(deps))
    why = await conflict(request, sess, rec)
    if why:
        return False, why
    try:
        await _run(request, sess, rec["inverse"])
    except AgentError as exc:
        return False, agent_message(request, exc)
    j.mark(rid, "undone", user_of(sess))
    j.record(user=user_of(sess), action="undo", target=rec.get("target", ""), summary=f"Undo: {rec.get('summary', '')}",
             request=rec["inverse"], undo_of=rid, inverse=None, undoable=False, reason="Use Redo to apply the original action again.")
    return True, flash_text(request, "Undone: {what}", what=rec.get("summary", ""))


async def do_redo(request: Request, sess: Session, rid: str) -> tuple[bool, str]:
    j = journal(request)
    rec = j.get(rid)
    if not rec or rec.get("status") != "undone":
        return False, flash_text(request, "There is nothing to redo.")
    redo = rec.get("redo")
    if not redo or _contains_redacted(redo):
        return False, flash_text(request, "This action included a secret that is never stored, so it cannot be redone automatically.")
    try:
        await _run(request, sess, {"kind": "http", **{k: redo.get(k) for k in ("method", "path", "params", "json")}})
    except AgentError as exc:
        return False, agent_message(request, exc)
    j.mark(rid, "done", user_of(sess))
    j.record(user=user_of(sess), action="redo", target=rec.get("target", ""), summary=f"Redo: {rec.get('summary', '')}",
             request=redo, redo_of=rid, inverse=None, undoable=False, reason="Use Undo on the original entry.")
    return True, flash_text(request, "Redone: {what}", what=rec.get("summary", ""))


@router.post("/undo", dependencies=CSRF)
async def undo_last(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    rid = form.get("id")
    if not rid:
        nxt, _ = journal(request).stack(user_of(sess))
        rid = nxt["id"] if nxt else None
    back = form.get("back") or "/history"
    if not rid:
        return _reply(request, back, False, flash_text(request, "There is nothing to undo."))
    ok, msg = await do_undo(request, sess, rid)
    return _reply(request, back, ok, msg)


@router.post("/redo", dependencies=CSRF)
async def redo_last(request: Request, sess: Session = Depends(require_admin)):
    form = await request.form()
    rid = form.get("id")
    if not rid:
        _, nxt = journal(request).stack(user_of(sess))
        rid = nxt["id"] if nxt else None
    back = form.get("back") or "/history"
    if not rid:
        return _reply(request, back, False, flash_text(request, "There is nothing to redo."))
    ok, msg = await do_redo(request, sess, rid)
    return _reply(request, back, ok, msg)


def _reply(request: Request, back: str, ok: bool, msg: str):
    from .security import safe_next

    if request.headers.get("x-requested-with") == "fetch":
        return JSONResponse({"ok": ok, "message": msg}, status_code=200 if ok else 409)
    return redirect(request, safe_next(back, "/history"), ("success" if ok else "error", msg))


@router.get("/history")
async def history_page(request: Request, sess: Session = Depends(require_admin)):
    j = journal(request)
    qp = request.query_params
    scope = qp.get("scope") or "all"
    action = qp.get("action") or ""
    q = (qp.get("q") or "").casefold()
    rows = list(reversed(j.all()))
    if scope == "mine":
        rows = [r for r in rows if r.get("user") == user_of(sess)]
    if qp.get("user"):
        rows = [r for r in rows if r.get("user") == qp.get("user")]
    if action:
        rows = [r for r in rows if r.get("action") == action]
    if q:
        rows = [r for r in rows if q in json.dumps([r.get("summary"), r.get("target"), r.get("user")], ensure_ascii=False).casefold()]
    users = sorted({r.get("user", "") for r in j.all()})
    actions = sorted({r.get("action", "") for r in j.all()})
    sel = j.get(qp.get("id") or "") if qp.get("id") else None
    diff_lines = None
    if sel:
        from .history import diff as mkdiff

        diff_lines = mkdiff(json.dumps(sel.get("before"), indent=2, ensure_ascii=False, sort_keys=True, default=str),
                            json.dumps(sel.get("after"), indent=2, ensure_ascii=False, sort_keys=True, default=str), "before", "after")
    if qp.get("export") == "json":
        from fastapi.responses import Response

        return Response(json.dumps(rows, indent=2, ensure_ascii=False, default=str), media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="tempdesk-history.json"'})
    return await render(request, "admin/history_log.html", {
        "rows": rows[:500], "total": len(rows), "users": users, "actions": actions, "scope": scope, "f": dict(qp),
        "sel": sel, "diff": diff_lines, "repo_size": j.repo_size(), "git": j.git_available(),
        "deps": {r["id"]: len(j.dependents(r)) for r in rows[:500] if r.get("status") == "done" and r.get("undoable")}})
