"""Routes shared by both modes: display preferences."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from .i18n import MODES
from .security import safe_next
from .web import PREF_FUN, PREF_LANG, csrf_protect, redirect, set_cookie

router = APIRouter()
YEAR = 365 * 24 * 3600


@router.post("/prefs", dependencies=[Depends(csrf_protect)])
async def prefs(request: Request):
    form = await request.form()
    nxt = safe_next(form.get("next"), "/")
    resp = redirect(request, nxt)
    lang = form.get("lang")
    if lang in MODES:
        set_cookie(request, resp, PREF_LANG, lang, max_age=YEAR, httponly=False)
    fun = form.get("fun")
    if fun in ("0", "1", "2", "3"):
        set_cookie(request, resp, PREF_FUN, fun, max_age=YEAR, httponly=False)
    return resp
