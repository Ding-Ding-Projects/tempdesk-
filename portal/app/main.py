"""TempDesk portal entry point. One image, two modes: PORTAL_MODE=guest|admin."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles

from . import nav as navmod
from .agent_client import AgentClient
from .config import Settings
from .security import (
    CSP_DEFAULT,
    CSRF_COOKIE,
    SECURITY_HEADERS,
    Csrf,
    Flash,
    OneTimeStore,
    RateLimiter,
    SessionStore,
    SuperConfirm,
    is_https,
)
from .history import History
from .undo import Journal
from .vocab import Vocabulary
from .web import install_error_handlers

log = logging.getLogger("tempdesk")
HERE = Path(__file__).parent
_APP: FastAPI | None = None


def current_app() -> FastAPI:
    if _APP is None:
        raise RuntimeError("app not created")
    return _APP


class QuietAccessFilter(logging.Filter):
    """Drop query strings from uvicorn access logs (they could hold search
    terms). Credentials are never in URLs, this is defence in depth."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if record.args and len(record.args) >= 3:
                args = list(record.args)
                if isinstance(args[2], str):
                    args[2] = args[2].split("?", 1)[0]
                record.args = tuple(args)
        except Exception:  # noqa: BLE001
            pass
        return True


def create_app(settings: Settings | None = None, transport: httpx.AsyncBaseTransport | None = None) -> FastAPI:
    global _APP
    settings = settings or Settings.from_env()
    logging.getLogger("uvicorn.access").addFilter(QuietAccessFilter())

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        await app.state.agent.aclose()

    app = FastAPI(title="TempDesk portal", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.settings = settings
    app.state.agent = AgentClient(settings, transport=transport)
    app.state.csrf = Csrf(settings.session_secret)
    app.state.flash = Flash(settings.session_secret)
    app.state.confirm = SuperConfirm(settings.session_secret)
    app.state.once = OneTimeStore(ttl_seconds=600)
    app.state.create_limiter = RateLimiter(settings.create_limit, settings.create_window_seconds)
    app.state.lookup_limiter = RateLimiter(settings.lookup_limit, settings.lookup_window_seconds)
    app.state.login_limiter = RateLimiter(settings.login_limit, settings.login_window_seconds)
    app.state.sessions = SessionStore(settings.session_secret)
    app.state.vocab = Vocabulary(settings.data_dir)
    app.state.history = History(settings.data_dir)
    app.state.journal = Journal(settings.data_dir)

    @app.middleware("http")
    async def headers_mw(request: Request, call_next):
        response: Response = await call_next(request)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        response.headers.setdefault("Content-Security-Policy", CSP_DEFAULT)
        if is_https(request, settings.trusted_proxies, settings.cookie_secure) and settings.cookie_secure != "false":
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        if not request.url.path.startswith("/static/"):
            response.headers.setdefault("Cache-Control", "no-store" if settings.mode == "admin" else "no-cache")
        # Issue the CSRF cookie the first time a page needed one.
        if getattr(request.state, "csrf_new", False) and CSRF_COOKIE not in response.headers.get("set-cookie", ""):
            secure = is_https(request, settings.trusted_proxies, settings.cookie_secure)
            response.set_cookie(CSRF_COOKIE, request.state.csrf_cookie, httponly=True, secure=secure,
                                samesite="strict", path="/", max_age=4 * 3600)
        return response

    install_error_handlers(app)

    static = StaticFiles(directory=str(HERE / "static"))
    app.mount("/static", static, name="static")

    @app.get("/healthz", include_in_schema=False)
    async def healthz():
        return PlainTextResponse("ok")

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        return FileResponse(HERE / "static" / "img" / "icon.svg", media_type="image/svg+xml")

    @app.get("/logo", include_in_schema=False)
    async def logo():
        p = Path(settings.data_dir) / "logo.bin"
        meta = Path(settings.data_dir) / "logo.type"
        if not p.exists():
            return Response(status_code=404)
        ctype = meta.read_text().strip() if meta.exists() else "image/png"
        if ctype not in ("image/png", "image/jpeg", "image/webp"):
            ctype = "application/octet-stream"
        return FileResponse(p, media_type=ctype, headers={"Cache-Control": "no-cache"})

    from .common_routes import router as common_router
    from .common_routes import tools_router

    app.include_router(common_router)
    app.include_router(tools_router)
    if settings.mode == "admin":
        from .admin_routes import router as admin_router

        from .io_routes import router as io_router
        from .undo_routes import router as undo_router

        app.include_router(io_router)
        app.include_router(undo_router)
        app.include_router(admin_router)
        try:
            from . import server_routes  # built separately; optional

            app.include_router(server_routes.router)
            log.info("server area loaded")
        except ImportError as exc:
            if "server_routes" not in str(exc):
                log.warning("server area failed to import: %s", type(exc).__name__)
    else:
        from .guest_routes import router as guest_router

        app.include_router(guest_router)

    _APP = app
    navmod  # imported so other modules can extend it before startup
    return app


def build() -> FastAPI:
    """uvicorn factory: uvicorn app.main:build --factory"""
    return create_app()


if __name__ == "__main__":  # pragma: no cover
    import uvicorn

    s = Settings.from_env()
    kwargs = {}
    if s.tls_cert_file and s.tls_key_file:
        kwargs = {"ssl_certfile": s.tls_cert_file, "ssl_keyfile": s.tls_key_file}
    uvicorn.run(create_app(s), host=os.environ.get("HOST", "0.0.0.0"), port=s.port, proxy_headers=False,
                server_header=False, **kwargs)
