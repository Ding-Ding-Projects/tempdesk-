"""Shared web plumbing: templates, per-request context, dependencies, errors.

Hooks for other route modules (for example app/server_routes.py):
  * ``require_admin``      FastAPI dependency, returns the admin Session
                           (``session.token`` is the agent bearer token,
                           ``session.elevation_token()`` the fresh elevation
                           token or None).
  * ``get_agent_client()`` returns the shared AgentClient. Its
                           ``request(method, path, *, params, json, data,
                           files, elevation, token)`` returns an
                           httpx.Response and raises AgentError /
                           AgentUnavailable.
  * ``csrf_protect``       dependency that validates the form CSRF token.
  * ``render(request, "server/x.html", {...})`` renders with the shared
                           context (layout ``layouts/admin.html``).
  * ``app.nav.NAV_ITEMS``  append dicts to add pages to the rail and palette.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

from fastapi import Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.templating import Jinja2Templates
from markupsafe import Markup

from . import nav as navmod
from .agent_client import AgentClient, AgentError, AgentUnavailable
from .i18n import MODE_LABELS, MODES, Translator
from .security import (
    CSRF_COOKIE,
    CSRF_FIELD,
    FLASH_COOKIE,
    SESSION_COOKIE,
    CsrfError,
    Session,
    is_https,
)

log = logging.getLogger("tempdesk.web")
HERE = Path(__file__).parent

templates = Jinja2Templates(directory=str(HERE / "templates"))
templates.env.trim_blocks = True
templates.env.lstrip_blocks = True

PREF_LANG = "td_lang"
PREF_FUN = "td_fun"
PREF_SCHOOL = "td_school"
PREF_MOTION = "td_motion"

# Strings the browser scripts need (palette, toasts, dialogs, tabs, regex).
JS_STRINGS = [
    "Search pages and actions", "No matches", "Copied", "Copy failed", "Show", "Hide",
    "Expired", "Close", "Notifications", "No notifications yet", "Mark all read", "Clear all",
    "Invalid pattern", "{count} matches", "Hold to confirm", "Keep holding", "Confirmed",
    "Close tab", "Plain", "Regex", "Actions", "Remove", "Add row", "Restore", "Previous versions",
    "No previous versions saved in this browser yet.", "Version restored into the form. Review it, then save.",
    "Personal wording applied", "This file was not applied", "Uploading personal wording",
    "Wrong PIN", "School mode is on", "School mode is off", "Set a PIN first", "Days", "Hours", "Minutes", "Seconds",
    "Contrast {ratio}:1 passes", "Contrast {ratio}:1 is too low for text", "Saved in this browser",
    "Select all", "selected", "Loading", "Expand", "Collapse", "Command palette", "Open", "Theme switched",
]


def get_settings(request: Request):
    return request.app.state.settings


def get_agent_client(request: Request | None = None) -> AgentClient:
    """Return the shared agent client. Works with or without a request."""
    if request is not None:
        return request.app.state.agent
    from .main import current_app  # late import to avoid a cycle

    return current_app().state.agent


def wants_json(request: Request) -> bool:
    return "application/json" in request.headers.get("accept", "") and "text/html" not in request.headers.get("accept", "")


# ---------------------------------------------------------------- session

def current_session(request: Request) -> Session | None:
    if hasattr(request.state, "session"):
        return request.state.session
    store = getattr(request.app.state, "sessions", None)
    sess = store.get(request.cookies.get(SESSION_COOKIE)) if store else None
    request.state.session = sess
    return sess


class LoginRequired(Exception):
    pass


async def require_admin(request: Request) -> Session:
    """Dependency: an authenticated admin session or a redirect to /login."""
    if request.app.state.settings.mode != "admin":
        raise HTTPException(status_code=404)
    sess = current_session(request)
    if sess is None:
        raise LoginRequired()
    return sess


async def csrf_protect(request: Request) -> None:
    """Dependency: verify the signed double-submit token on a form post."""
    token = request.headers.get("x-csrf-token")
    if not token:
        ctype = request.headers.get("content-type", "")
        if "form" in ctype:
            form = await request.form()
            token = form.get(CSRF_FIELD)
    try:
        request.app.state.csrf.verify(request, token if isinstance(token, str) else None)
    except CsrfError:
        raise HTTPException(status_code=403, detail="csrf") from None


# ---------------------------------------------------------------- preferences

def translator_for(request: Request) -> Translator:
    if hasattr(request.state, "tr"):
        return request.state.tr
    school = request.cookies.get(PREF_SCHOOL) == "1"
    mode = request.cookies.get(PREF_LANG, "en")
    if mode not in MODES or school:
        mode = "en"
    try:
        fun = int(request.cookies.get(PREF_FUN, "0"))
    except ValueError:
        fun = 0
    if school:
        fun = 0
    vocab = None
    settings = request.app.state.settings
    # Personal wording only after admin sign-in, never in school mode.
    if settings.mode == "admin" and not school and current_session(request) is not None:
        voc = request.app.state.vocab
        if voc.count:
            vocab = voc.translator()
    tr = Translator(mode, fun, vocab)
    request.state.tr = tr
    return tr


# ---------------------------------------------------------------- rendering

async def capabilities(request: Request) -> set[str] | None:
    if hasattr(request.state, "caps"):
        return request.state.caps
    health = await request.app.state.agent.health()
    request.state.health = health
    caps = set(health.get("capabilities") or []) if health else None
    if health and "capabilities" not in health:
        # Older agents do not report capabilities: assume the Windows set.
        caps = {"guest", "directory", "gpo", "gpo-registry", "gpo-preferences", "gpo-permissions", "gpo-backup",
                "wmifilters", "admx", "security", "cmdlets", "wifi", "scripts", "allowlist", "audit"}
    request.state.caps = caps
    return caps


def has_cap(request: Request, cap: str | None) -> bool:
    caps = getattr(request.state, "caps", None)
    return not cap or bool(caps and cap in caps)


async def base_context(request: Request) -> dict:
    settings = request.app.state.settings
    tr = translator_for(request)
    sess = current_session(request) if settings.mode == "admin" else None
    caps = await capabilities(request) if (settings.mode == "guest" or sess) else None
    if settings.mode == "admin":
        items = navmod.visible(navmod.NAV_ITEMS, caps) if sess else []
        actions = navmod.visible(navmod.PALETTE_ACTIONS, caps) if sess else [
            a for a in navmod.PALETTE_ACTIONS if a.get("action") == "theme"]
    else:
        pub = getattr(request.state, "public", None) or {}
        items = [i for i in navmod.GUEST_NAV if i.get("capability") != "self-delete" or pub.get("allowSelfDelete", True)]
        actions = list(navmod.GUEST_ACTIONS)
    school = request.cookies.get(PREF_SCHOOL) == "1"
    if school:
        actions = [a for a in actions if not a["id"].startswith("act-wording")]
    palette = [
        {"label": tr.plain(i["label"]), "href": i["href"], "group": tr.plain(i.get("group") or ""),
         "keywords": i.get("keywords", ""), "action": i.get("action", "")}
        for i in items + actions
    ]
    extra = getattr(request.state, "palette_extra", None) or []
    palette += extra
    ctx = {
        "request": request,
        "mode": settings.mode,
        "t": tr.html,
        "ta": tr.plain,
        "tr": tr,
        "lang_modes": MODE_LABELS,
        "school": school,
        "fun": tr.fun,
        "session": sess,
        "user": sess.user if sess else None,
        "nav_items": items,
        "palette_json": Markup(json.dumps(palette, ensure_ascii=False).replace("<", "\\u003c")),
        "js_strings": Markup(json.dumps({k: tr.plain(k) for k in JS_STRINGS}, ensure_ascii=False).replace("<", "\\u003c")),
        "csrf_token": request.app.state.csrf.token(request),
        "csrf_field": CSRF_FIELD,
        "health": getattr(request.state, "health", None),
        "caps": caps,
        "has_cap": lambda c: has_cap(request, c),
        "flash": request.app.state.flash.loads(request.cookies.get(FLASH_COOKIE)),
        "plain_http_agent": settings.agent_plain_http,
        "plain_http_console": not is_https(request, settings.trusted_proxies, "auto"),
        "path": request.url.path,
        "org_name": getattr(request.state, "org_name", None) or "TempDesk",
        "has_logo": (Path(settings.data_dir) / "logo.bin").exists(),
        "now": time.time(),
        "elevated": bool(sess and sess.elevated),
        "wording_count": request.app.state.vocab.count if settings.mode == "admin" and sess and not school else 0,
    }
    return ctx


async def render(request: Request, name: str, ctx: dict | None = None, status: int = 200,
                 headers: dict | None = None) -> HTMLResponse:
    full = await base_context(request)
    if ctx:
        full.update(ctx)
    resp = templates.TemplateResponse(request, name, full, status_code=status, headers=headers)
    if full.get("flash"):
        resp.delete_cookie(FLASH_COOKIE, path="/")
    return resp


def set_cookie(request: Request, resp: Response, name: str, value: str, max_age: int | None = None,
               httponly: bool = True) -> None:
    settings = request.app.state.settings
    secure = is_https(request, settings.trusted_proxies, settings.cookie_secure)
    resp.set_cookie(name, value, max_age=max_age, httponly=httponly, secure=secure,
                    samesite="strict", path="/")


def redirect(request: Request, url: str, flash: tuple[str, str] | None = None) -> RedirectResponse:
    resp = RedirectResponse(url, status_code=303)
    if flash:
        set_cookie(request, resp, FLASH_COOKIE, request.app.state.flash.dumps(*flash), max_age=300)
    return resp


def flash_text(request: Request, key: str, **args) -> str:
    return translator_for(request).plain(key, **args)


def agent_message(request: Request, exc: AgentError) -> str:
    tr = translator_for(request)
    friendly = {
        "unauthorized": "Your session has ended. Please sign in again.",
        "forbidden": "The agent refused this action.",
        "not_found": "That item was not found.",
        "conflict": "That conflicts with something that already exists.",
        "rate_limited": "Too many requests. Please wait a little and try again.",
        "bad_request": "The agent did not accept the request.",
        "internal": "The agent reported an internal error.",
    }
    base = tr.plain(friendly.get(exc.code, "The agent reported an error."), serious=True)
    detail = (exc.message or "").strip()
    return f"{base} {detail}" if detail and detail.lower() not in base.lower() else base


async def error_page(request: Request, status: int, title_key: str, body_key: str, **extra) -> Response:
    if wants_json(request):
        return JSONResponse({"error": title_key}, status_code=status)
    try:
        return await render(request, "error.html", {"status": status, "title_key": title_key, "body_key": body_key,
                                                     **extra}, status=status, headers={"Cache-Control": "no-store"})
    except Exception:  # noqa: BLE001 - last resort, never leak details
        log.exception("error page failed")
        return HTMLResponse("<h1>Something went wrong</h1>", status_code=status)


def install_error_handlers(app) -> None:
    @app.exception_handler(LoginRequired)
    async def _login(request: Request, exc: LoginRequired):
        if wants_json(request) or request.url.path.startswith("/api/"):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        nxt = request.url.path + (("?" + request.url.query) if request.url.query else "")
        from urllib.parse import quote

        return RedirectResponse(f"/login?next={quote(nxt, safe='/')}", status_code=303)

    @app.exception_handler(AgentUnavailable)
    async def _down(request: Request, exc: AgentUnavailable):
        request.state.caps = None
        return await error_page(request, 503, "The agent cannot be reached",
                                "The TempDesk Agent on the domain controller did not answer. Check that the server is on and the TempDesk Agent service is running, then try again.")

    @app.exception_handler(AgentError)
    async def _agent(request: Request, exc: AgentError):
        if exc.code == "unauthorized" and request.app.state.settings.mode == "admin":
            sess = current_session(request)
            if sess:
                request.app.state.sessions.drop(sess.sid)
            request.state.session = None
            raise LoginRequired()
        status = exc.status if 400 <= exc.status < 600 else 502
        return await error_page(request, status, "The agent did not accept that", "",
                                message=agent_message(request, exc))

    @app.exception_handler(HTTPException)
    async def _http(request: Request, exc: HTTPException):
        if exc.status_code in (302, 303) and exc.headers and exc.headers.get("Location"):
            return RedirectResponse(exc.headers["Location"], status_code=303)
        if exc.status_code == 403 and exc.detail == "csrf":
            return await error_page(request, 403, "This form has expired",
                                    "For your safety the form could not be accepted. Go back, reload the page and try again.")
        if exc.status_code == 404:
            return await error_page(request, 404, "Page not found", "There is nothing at this address.")
        if exc.status_code == 429:
            return await error_page(request, 429, "Too many attempts",
                                    "Please wait a few minutes and try again.", retry_after=exc.detail,
                                    )
        if exc.status_code == 400:
            return await error_page(request, 400, "Something in the form was not valid", "",
                                    message=str(exc.detail or ""))
        return await error_page(request, exc.status_code, "Something went wrong", "Please try again.")

    @app.exception_handler(Exception)
    async def _any(request: Request, exc: Exception):
        log.error("unhandled error on %s: %s", request.url.path, type(exc).__name__)
        return await error_page(request, 500, "Something went wrong", "Please try again. If it keeps happening, check the portal logs.")


def json_tree(value: Any) -> Any:
    """Normalise a JSON value for the recursive tree macro."""
    return value


Depends  # re-export for route modules
Any
