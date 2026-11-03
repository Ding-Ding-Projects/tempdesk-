"""Transport independent request handling: authentication, authorization,
rate limiting, routing and the TempDesk guest rules.

App.handle(Request) -> Response. server.py adapts this to http.server; the
tests call it directly with a FakeBackend.
"""

from __future__ import annotations

import datetime as dt
import json
import re
import threading
import time
from dataclasses import dataclass, field
from urllib.parse import parse_qs, unquote

from . import secinf
from .auth import Lockout, RateLimiter, TokenSigner, keys_equal
from .backend import Backend
from .errors import ApiError, bad, forbidden, not_found
from .stores import AuditLog, SettingsStore
from .util import guest_password, guest_username, iso, utcnow

VERSION = "1.0.0"
PREFIX = "/api/v1"
MAX_BODY = 2 * 1024 * 1024
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,20}$")


@dataclass
class Request:
    method: str
    path: str
    query: dict = field(default_factory=dict)  # name -> str (first value)
    headers: dict = field(default_factory=dict)  # lower case names
    body: bytes = b""
    remote: str = ""


@dataclass
class Response:
    status: int = 200
    body: object = None  # JSON value, or str/bytes with content_type
    content_type: str = "application/json; charset=utf-8"
    headers: dict = field(default_factory=dict)

    def encode(self) -> bytes:
        if self.status == 204:
            return b""
        if isinstance(self.body, bytes):
            return self.body
        if isinstance(self.body, str) and not self.content_type.startswith("application/json"):
            return self.body.encode("utf-8")
        return json.dumps(self.body, ensure_ascii=False, default=str).encode("utf-8")


def parse_query(qs: str) -> dict:
    return {k: v[0] for k, v in parse_qs(qs, keep_blank_values=True).items()}


class Route:
    def __init__(self, method, pattern, func, access):
        self.method = method
        self.regex = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "$")
        self.func = func
        self.access = access  # "public" (either key), "guest" (either key), "login", "admin"


class App:
    def __init__(self, backend: Backend, settings: SettingsStore, audit: AuditLog, guest_key: str,
                 admin_key: str, signer: TokenSigner, clock=time.time):
        self.backend = backend
        self.settings = settings
        self.audit = audit
        self.guest_key = guest_key
        self.admin_key = admin_key
        self.signer = signer
        self.clock = clock
        self.lockout = Lockout(clock=clock)
        self.ratelimit = RateLimiter(clock=clock)
        self._guest_lock = threading.Lock()
        self.routes: list[Route] = []
        self._register()

    # ------------------------------------------------------------------
    def route(self, method, pattern, access="admin"):
        def deco(f):
            self.routes.append(Route(method, pattern, f, access))
            return f
        return deco

    def handle(self, req: Request) -> Response:
        try:
            return self._handle(req)
        except ApiError as e:
            return Response(e.status, {"error": e.code, "message": e.message})
        except Exception as e:  # noqa: BLE001 - last resort, never leak a traceback
            self.audit.write(event="internal_error", path=req.path, error=type(e).__name__, detail=str(e)[:500])
            return Response(500, {"error": "internal", "message": "internal error"})

    def _handle(self, req: Request) -> Response:
        path = req.path
        if not path.startswith(PREFIX + "/"):
            raise not_found("unknown route")
        sub = path[len(PREFIX):]
        match, allowed_methods = None, False
        for r in self.routes:
            m = r.regex.match(sub)
            if m:
                allowed_methods = True
                if r.method == req.method:
                    match = (r, {k: unquote(v) for k, v in m.groupdict().items()})
                    break
        # Authenticate before revealing whether a route exists.
        role = self._key_role(req)
        if role is None:
            raise ApiError("unauthorized", "missing or invalid X-TempDesk-Key")
        if match is None:
            if allowed_methods:
                raise ApiError("bad_request", "method not allowed for this route", 405)
            raise not_found("unknown route")
        route, params = match
        user = None
        if route.access in ("public", "guest"):
            pass
        elif role != "admin":
            raise forbidden("this key cannot use admin routes")
        elif route.access == "admin":
            token = self._bearer(req)
            user = self.signer.verify(token)
            if not user:
                raise ApiError("unauthorized", "missing, invalid or expired session token")
            req.token = token  # type: ignore[attr-defined]
        if req.method in ("POST", "PUT", "PATCH") and req.body:
            try:
                body = json.loads(req.body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError):
                raise bad("body must be JSON")
        else:
            body = {}
        resp = route.func(req, params, body if body is not None else {}, user)
        if not isinstance(resp, Response):
            resp = Response(200, resp)
        if user and req.method != "GET":
            self.audit.write(event="admin_call", user=user.get("sub"), method=req.method, path=sub,
                             query={k: v for k, v in req.query.items() if k.lower() != "password"},
                             status=resp.status, remote=req.remote)
        return resp

    def _key_role(self, req: Request) -> str | None:
        k = req.headers.get("x-tempdesk-key")
        # Compare against both keys every time so timing does not reveal which matched.
        is_admin = keys_equal(k, self.admin_key)
        is_guest = keys_equal(k, self.guest_key)
        if is_admin:
            return "admin"
        if is_guest:
            return "guest"
        return None

    @staticmethod
    def _bearer(req: Request) -> str | None:
        h = req.headers.get("authorization", "")
        if h[:7].lower() == "bearer ":
            return h[7:].strip()
        return None

    @staticmethod
    def _client_ip(req: Request) -> str:
        xff = req.headers.get("x-forwarded-for", "")
        if xff:
            return xff.split(",")[0].strip()[:64]
        return req.remote

    # ------------------------------------------------------------------
    # Guest helpers
    def _expiry_minutes(self, s: dict, expiry_id) -> int:
        for c in s.get("expiryChoices", []):
            if c.get("id") == expiry_id:
                if c["minutes"] == 0 and not s.get("allowPermanent", True):
                    raise bad("permanent accounts are disabled")
                return int(c["minutes"])
        raise bad("unknown expiryId")

    def create_guest(self, display_name, minutes: int, created_by: str, req: Request, enforce_rate: bool):
        s = self.settings.get()
        if display_name is not None and (not isinstance(display_name, str) or len(display_name) > 64
                                         or any(ord(c) < 32 for c in display_name)):
            raise bad("displayName must be up to 64 printable characters")
        if enforce_rate:
            ip = self._client_ip(req)
            if not self.ratelimit.allow("guest-create:" + ip, int(s.get("guestCreatePerHour", 20)), 3600):
                raise ApiError("rate_limited", "too many accounts created from this address, try again later")
        with self._guest_lock:
            if self.backend.count_guests() >= int(s.get("guestMaxActive", 200)):
                raise ApiError("rate_limited", "the maximum number of active guest accounts has been reached")
            prefix = s.get("usernamePrefix", "guest-")
            for _ in range(20):
                sam = guest_username(prefix)
                if not self.backend.username_exists(sam):
                    break
            else:
                raise ApiError("conflict", "could not find a free username")
            pw = guest_password(int(s.get("passwordLength", 14)))
            now = utcnow().replace(microsecond=0)
            expires = None if minutes == 0 else now + dt.timedelta(minutes=minutes)
            info = json.dumps({"createdBy": created_by, "createdAt": iso(now), "expiresAt": iso(expires)},
                              separators=(",", ":"))
            res = self.backend.create_guest(sam, pw, (display_name or "").strip() or None, expires, info,
                                            s.get("guestGroup", "TempDesk Guests"))
        self.audit.write(event="guest_created", username=sam, createdBy=created_by,
                         expiresAt=iso(expires), remote=self._client_ip(req))
        info_ = self.backend.info()
        return {"username": sam, "upn": res.get("upn") or f"{sam}@{info_['domain']}", "password": pw,
                "expiresAt": iso(expires), "domain": info_.get("netbios") or info_["domain"]}

    def _guest_check_password(self, req, username, body):
        if not USERNAME_RE.match(username or ""):
            raise bad("bad username")
        pw = body.get("password")
        if not isinstance(pw, str) or not pw:
            raise bad("password is required")
        ip = self._client_ip(req)
        lk = f"guest:{username.lower()}"
        if self.lockout.locked(lk) or self.lockout.locked("guestip:" + ip):
            raise ApiError("rate_limited", "too many failed attempts, try again later")
        g = self.backend.find_guest(username)
        ok = g is not None and self.backend.check_password(username, pw) is not None
        if not ok:
            self.lockout.fail(lk)
            self.lockout.fail("guestip:" + ip)
            # Same answer for unknown user and wrong password
            raise ApiError("unauthorized", "username or password is incorrect")
        self.lockout.success(lk)
        return g

    # ------------------------------------------------------------------
    def _register(self):
        r = self.route
        be = self.backend

        @r("GET", "/health", "public")
        def health(req, p, b, u):
            i = be.info()
            return {"status": "ok", "version": VERSION, "domain": i["domain"], "dc": i["dc"],
                    "time": iso(utcnow()), "backend": "samba", "capabilities": be.capabilities()}

        @r("GET", "/public/settings", "public")
        def public_settings(req, p, b, u):
            s = self.settings.get()
            choices = [c for c in s.get("expiryChoices", []) if c["minutes"] != 0 or s.get("allowPermanent")]
            return {"orgName": s.get("orgName"), "welcomeText": s.get("welcomeText"),
                    "expiryChoices": [{"id": c["id"], "label": c["label"], "minutes": c["minutes"]} for c in choices],
                    "allowPermanent": bool(s.get("allowPermanent")), "allowSelfDelete": bool(s.get("allowSelfDelete")),
                    "usernamePrefix": s.get("usernamePrefix")}

        # -- guest ------------------------------------------------------
        @r("POST", "/guest/users", "guest")
        def guest_create(req, p, b, u):
            s = self.settings.get()
            minutes = self._expiry_minutes(s, b.get("expiryId"))
            return Response(201, self.create_guest(b.get("displayName"), minutes, "guest-portal", req, True))

        @r("POST", "/guest/users/{username}/delete", "guest")
        def guest_delete(req, p, b, u):
            if not self.settings.get().get("allowSelfDelete", True):
                raise forbidden("self delete is disabled")
            g = self._guest_check_password(req, p["username"], b)
            be.delete_guest(g["username"])
            self.audit.write(event="guest_self_deleted", username=g["username"], remote=self._client_ip(req))
            return Response(204)

        @r("POST", "/guest/users/{username}/status", "guest")
        def guest_status(req, p, b, u):
            g = self._guest_check_password(req, p["username"], b)
            return {"username": g["username"], "expiresAt": g.get("expiresAt"), "enabled": g.get("enabled", True)}

        # -- auth ---------------------------------------------------------
        @r("POST", "/auth/login", "login")
        def login(req, p, b, u):
            user, pw = b.get("username"), b.get("password")
            if not isinstance(user, str) or not isinstance(pw, str) or not user or not pw or len(user) > 256:
                raise bad("username and password are required")
            sam = user.split("\\")[-1].split("@")[0]
            ip = self._client_ip(req)
            if self.lockout.locked("admin:" + sam) or self.lockout.locked("adminip:" + ip):
                self.audit.write(event="login_locked", user=sam, remote=ip)
                raise ApiError("rate_limited", "too many failed sign-ins, try again in 15 minutes")
            who = be.check_password(sam, pw)
            group = self.settings.get().get("adminGroup", "TempDesk Admins")
            if not who or not be.is_member_recursive(who["sam"], group):
                self.lockout.fail("admin:" + sam)
                self.lockout.fail("adminip:" + ip)
                self.audit.write(event="login_failed", user=sam, remote=ip)
                raise ApiError("unauthorized", "sign-in failed: wrong credentials or not a TempDesk admin")
            self.lockout.success("admin:" + sam)
            token, exp = self.signer.issue(who["sam"], who.get("displayName") or who["sam"])
            self.audit.write(event="login", user=who["sam"], remote=ip)
            return {"token": token, "expiresAt": iso(dt.datetime.fromtimestamp(exp, dt.timezone.utc)),
                    "user": {"sam": who["sam"], "displayName": who.get("displayName") or who["sam"]}}

        @r("POST", "/auth/logout", "admin")
        def logout(req, p, b, u):
            self.signer.revoke(req.token)
            return Response(204)

        # -- directory ----------------------------------------------------
        @r("GET", "/ad/tree")
        def ad_tree(req, p, b, u):
            return be.ad_tree(req.query.get("dn") or None)

        @r("GET", "/ad/search")
        def ad_search(req, p, b, u):
            q = req.query
            scope = q.get("scope", "sub")
            if scope not in ("sub", "one", "base"):
                raise bad("scope must be sub, one or base")
            try:
                limit = max(1, min(int(q.get("limit", "500")), 5000))
            except ValueError:
                raise bad("limit must be a number")
            attrs = [a for a in (q.get("attrs") or "").split(",") if a.strip()]
            return be.ad_search(q.get("base") or None, q.get("filter") or "(objectClass=*)", scope, attrs, limit)

        @r("GET", "/ad/object")
        def ad_get(req, p, b, u):
            return be.ad_get(_req(req.query, "dn"))

        @r("POST", "/ad/object")
        def ad_create(req, p, b, u):
            attrs = b.get("attributes") or {}
            if not isinstance(attrs, dict):
                raise bad("attributes must be an object")
            dn = be.ad_create(_req(b, "parentDn"), _req(b, "objectClass"), _req(b, "rdn"), attrs)
            return Response(201, {"dn": dn})

        @r("PATCH", "/ad/object")
        def ad_patch(req, p, b, u):
            for k in ("set", "add", "remove"):
                if not isinstance(b.get(k) or {}, dict):
                    raise bad(f"{k} must be an object")
            if not isinstance(b.get("clear") or [], list):
                raise bad("clear must be a list")
            return be.ad_modify(_req(b, "dn"), b.get("set") or {}, b.get("add") or {}, b.get("remove") or {},
                                b.get("clear") or [])

        @r("POST", "/ad/object/move")
        def ad_move(req, p, b, u):
            return {"dn": be.ad_move(_req(b, "dn"), _req(b, "newParentDn"), b.get("newRdn"))}

        @r("DELETE", "/ad/object")
        def ad_delete(req, p, b, u):
            be.ad_delete(_req(req.query, "dn"), _bool(req.query.get("recursive")), _bool(req.query.get("force")))
            return Response(204)

        @r("POST", "/ad/user/password")
        def ad_password(req, p, b, u):
            be.ad_set_password(_req(b, "dn"), _req(b, "password"), bool(b.get("mustChange", False)))
            return Response(204)

        @r("POST", "/ad/user/enable")
        def ad_enable(req, p, b, u):
            be.ad_enable(_req(b, "dn"), bool(b.get("enabled", True)))
            return Response(204)

        @r("POST", "/ad/user/unlock")
        def ad_unlock(req, p, b, u):
            be.ad_unlock(_req(b, "dn"))
            return Response(204)

        @r("POST", "/ad/group/members")
        def ad_members(req, p, b, u):
            add, rem = b.get("add") or [], b.get("remove") or []
            if not isinstance(add, list) or not isinstance(rem, list):
                raise bad("add and remove must be lists")
            be.ad_group_members(_req(b, "groupDn"), add, rem)
            return Response(204)

        # -- GPO ----------------------------------------------------------
        @r("GET", "/gpo")
        def gpo_list(req, p, b, u):
            return be.gpo_list()

        @r("POST", "/gpo")
        def gpo_create(req, p, b, u):
            return Response(201, be.gpo_create(_req(b, "name"), b.get("comment")))

        @r("GET", "/gpo/backups")
        def gpo_backups(req, p, b, u):
            return be.gpo_backups()

        @r("POST", "/gpo/import")
        def gpo_import(req, p, b, u):
            return be.gpo_import(_req(b, "backupId"), _req(b, "targetName"), bool(b.get("createIfNeeded", True)))

        @r("PUT", "/gpo/inheritance")
        def gpo_inherit(req, p, b, u):
            be.gpo_set_inheritance(_req(b, "target"), bool(b.get("blocked", True)))
            return {"target": b["target"], "blocked": bool(b.get("blocked", True))}

        for m in ("GET", "POST"):
            @r(m, "/gpo/wmifilters")
            def wmi_list(req, p, b, u):
                raise not_found("WMI filters are not supported by the Samba backend")

        @r("GET", "/gpo/{id}")
        def gpo_get(req, p, b, u):
            return be.gpo_get(p["id"], with_permissions=True)

        @r("PATCH", "/gpo/{id}")
        def gpo_patch(req, p, b, u):
            st = b.get("status")
            if st is not None and st not in ("AllSettingsEnabled", "UserSettingsDisabled",
                                             "ComputerSettingsDisabled", "AllSettingsDisabled"):
                raise bad("invalid status")
            return be.gpo_update(p["id"], b.get("displayName"), st, b.get("comment"))

        @r("DELETE", "/gpo/{id}")
        def gpo_delete(req, p, b, u):
            be.gpo_delete(p["id"])
            return Response(204)

        @r("GET", "/gpo/{id}/report")
        def gpo_report(req, p, b, u):
            fmt = req.query.get("format", "html")
            if fmt not in ("html", "xml"):
                raise bad("format must be html or xml")
            ct, body = be.gpo_report(p["id"], fmt)
            return Response(200, body, ct)

        @r("POST", "/gpo/{id}/links")
        def link_add(req, p, b, u):
            return be.gpo_set_link(p["id"], _req(b, "target"), bool(b.get("enabled", True)),
                                   bool(b.get("enforced", False)), _opt_int(b.get("order")), True)

        @r("PATCH", "/gpo/{id}/links")
        def link_patch(req, p, b, u):
            return be.gpo_set_link(p["id"], _req(b, "target"), b.get("enabled"), b.get("enforced"),
                                   _opt_int(b.get("order")), False)

        @r("DELETE", "/gpo/{id}/links")
        def link_delete(req, p, b, u):
            be.gpo_delete_link(p["id"], _req(req.query, "target"))
            return Response(204)

        @r("GET", "/gpo/{id}/registry")
        def reg_get(req, p, b, u):
            return be.gpo_registry_get(p["id"], req.query.get("key") or None)

        @r("PUT", "/gpo/{id}/registry")
        def reg_put(req, p, b, u):
            return be.gpo_registry_set(p["id"], _req(b, "key"), b.get("valueName", ""), _req(b, "type"),
                                       b.get("value"))

        @r("DELETE", "/gpo/{id}/registry")
        def reg_del(req, p, b, u):
            be.gpo_registry_delete(p["id"], _req(req.query, "key"), req.query.get("valueName"))
            return Response(204)

        for m in ("GET", "PUT", "DELETE"):
            @r(m, "/gpo/{id}/preferences/registry")
            def prefs(req, p, b, u):
                raise not_found("Group Policy Preferences are not supported by the Samba backend")

        @r("PUT", "/gpo/{id}/wmifilter")
        def wmi_set(req, p, b, u):
            raise not_found("WMI filters are not supported by the Samba backend")

        @r("PUT", "/gpo/{id}/permissions")
        def gpo_perm(req, p, b, u):
            perm = _req(b, "permission")
            if perm not in ("GpoRead", "GpoApply", "GpoEdit", "GpoEditDeleteModifySecurity", "None"):
                raise bad("invalid permission")
            tt = b.get("trusteeType", "Group")
            if tt not in ("User", "Group", "Computer"):
                raise bad("trusteeType must be User, Group or Computer")
            return be.gpo_set_permission(p["id"], _req(b, "trustee"), tt, perm, bool(b.get("replace", True)))

        @r("POST", "/gpo/{id}/backup")
        def gpo_backup(req, p, b, u):
            return be.gpo_backup(p["id"])

        @r("POST", "/gpo/{id}/restore")
        def gpo_restore(req, p, b, u):
            return be.gpo_restore(p["id"], _req(b, "backupId"))

        @r("GET", "/gpo/{id}/security")
        def sec_get(req, p, b, u):
            return be.gpo_security_get(p["id"])

        @r("PUT", "/gpo/{id}/security")
        def sec_put(req, p, b, u):
            return be.gpo_security_put(p["id"], b.get("sections"))

        @r("GET", "/security/catalog")
        def sec_catalog(req, p, b, u):
            return secinf.CATALOG

        # -- ADMX ---------------------------------------------------------
        @r("GET", "/admx/categories")
        def admx_cats(req, p, b, u):
            return be.admx_categories()

        @r("GET", "/admx/policies")
        def admx_pols(req, p, b, u):
            k = req.query.get("class")
            if k and k not in ("Machine", "User", "Both"):
                raise bad("class must be Machine, User or Both")
            return be.admx_policies(req.query.get("category"), req.query.get("q"), k)

        @r("GET", "/admx/stats")
        def admx_stats(req, p, b, u):
            return be.admx_stats()

        @r("GET", "/gpo/{id}/admx/{policyId}")
        def admx_get(req, p, b, u):
            return be.gpo_admx_get(p["id"], p["policyId"], req.query.get("class"))

        # -- full Group Policy editor -------------------------------------
        @r("GET", "/gpo/nodes/schema")
        def gpo_node_schema(req, p, b, u):
            return be.gpo_node_schemas()

        @r("GET", "/gpo/{id}/tree")
        def gpo_tree(req, p, b, u):
            return be.gpo_tree(p["id"])

        @r("GET", "/gpo/{id}/node/{nodeId}")
        def gpo_node_get(req, p, b, u):
            return be.gpo_node_get(p["id"], p["nodeId"])

        @r("PUT", "/gpo/{id}/node/{nodeId}")
        def gpo_node_put(req, p, b, u):
            return be.gpo_node_put(p["id"], p["nodeId"], b.get("values"))

        @r("GET", "/gpo/{id}/node/{nodeId}/items")
        def gpo_node_items(req, p, b, u):
            return be.gpo_node_items(p["id"], p["nodeId"])

        @r("POST", "/gpo/{id}/node/{nodeId}/items")
        def gpo_node_item_create(req, p, b, u):
            return Response(201, be.gpo_node_item_create(p["id"], p["nodeId"], b))

        @r("PATCH", "/gpo/{id}/node/{nodeId}/items/{itemId}")
        def gpo_node_item_patch(req, p, b, u):
            return be.gpo_node_item_update(p["id"], p["nodeId"], p["itemId"], b)

        @r("DELETE", "/gpo/{id}/node/{nodeId}/items/{itemId}")
        def gpo_node_item_delete(req, p, b, u):
            be.gpo_node_item_delete(p["id"], p["nodeId"], p["itemId"])
            return Response(204)

        @r("PUT", "/gpo/{id}/admx/{policyId}")
        def admx_put(req, p, b, u):
            return be.gpo_admx_put(p["id"], p["policyId"], b.get("class"), _req(b, "state"), b.get("values"))

        # -- cmdlets (Windows only) -----------------------------------------
        @r("GET", "/cmdlets")
        def cmdlets(req, p, b, u):
            raise not_found("the cmdlet runner is only available on the Windows backend; use /sambatool")

        @r("POST", "/cmdlets/invoke")
        def cmdlets_inv(req, p, b, u):
            raise not_found("the cmdlet runner is only available on the Windows backend; use /sambatool")

        # -- samba-tool -----------------------------------------------------
        @r("GET", "/sambatool")
        def st_list(req, p, b, u):
            from .sambatool import catalog
            return catalog()

        @r("POST", "/sambatool/invoke")
        def st_invoke(req, p, b, u):
            from .sambatool import SambaToolError, build_argv
            try:
                build_argv(_req(b, "command"), b.get("args"), b.get("confirm"))  # validate first
            except SambaToolError as e:
                raise bad(str(e))
            return be.sambatool_invoke(b["command"], b.get("args") or [], b.get("confirm"))

        # -- settings / guests ----------------------------------------------
        @r("GET", "/settings")
        def settings_get(req, p, b, u):
            return self.settings.get()

        @r("PUT", "/settings")
        def settings_put(req, p, b, u):
            return self.settings.put(b)

        @r("GET", "/guests")
        def guests(req, p, b, u):
            return be.list_guests()

        @r("POST", "/guests")
        def guests_create(req, p, b, u):
            if "minutes" in b:
                m = b["minutes"]
                if isinstance(m, bool) or not isinstance(m, int) or m < 0 or m > 60 * 24 * 3650:
                    raise bad("minutes must be 0 (permanent) or a positive integer")
            else:
                m = self._expiry_minutes(self.settings.get(), b.get("expiryId"))
            return Response(201, self.create_guest(b.get("displayName"), m, f"admin:{u['sub']}", req, False))

        @r("DELETE", "/guests/{username}")
        def guests_delete(req, p, b, u):
            if not USERNAME_RE.match(p["username"]):
                raise bad("bad username")
            if not be.find_guest(p["username"]):
                raise not_found("guest not found")
            be.delete_guest(p["username"])
            return Response(204)

        @r("POST", "/guests/{username}/extend")
        def guests_extend(req, p, b, u):
            if not USERNAME_RE.match(p["username"]):
                raise bad("bad username")
            m = b.get("minutes")
            if isinstance(m, bool) or not isinstance(m, int) or m < 0:
                raise bad("minutes must be 0 (permanent) or a positive integer")
            g = be.find_guest(p["username"])
            if not g:
                raise not_found("guest not found")
            expires = None if m == 0 else utcnow().replace(microsecond=0) + dt.timedelta(minutes=m)
            return be.set_guest_expiry(g["username"], expires)

        # -- presetup -------------------------------------------------------
        @r("GET", "/wifi")
        def wifi_list(req, p, b, u):
            return be.wifi_list()

        @r("PUT", "/wifi/{id}")
        def wifi_put(req, p, b, u):
            return be.wifi_put(p["id"], b.get("ssid"), b.get("auth", "WPA2PSK"), b.get("key"),
                               bool(b.get("hidden", False)), bool(b.get("autoConnect", True)))

        @r("DELETE", "/wifi/{id}")
        def wifi_del(req, p, b, u):
            be.wifi_delete(p["id"])
            return Response(204)

        @r("GET", "/scripts")
        def scripts(req, p, b, u):
            k = req.query.get("kind")
            if k and k not in ("startup", "logon"):
                raise bad("kind must be startup or logon")
            return be.scripts_list(k)

        @r("GET", "/scripts/{kind}/{name}")
        def script_get(req, p, b, u):
            return be.script_get(p["kind"], p["name"])

        @r("PUT", "/scripts/{kind}/{name}")
        def script_put(req, p, b, u):
            return be.script_put(p["kind"], p["name"], b.get("content"))

        @r("DELETE", "/scripts/{kind}/{name}")
        def script_del(req, p, b, u):
            be.script_delete(p["kind"], p["name"])
            return Response(204)

        @r("GET", "/allowlist")
        def allow_get(req, p, b, u):
            return be.allowlist_get(self.settings.get())

        @r("PUT", "/allowlist")
        def allow_put(req, p, b, u):
            return be.allowlist_put(self.settings.get(), bool(b.get("enabled", True)), b.get("apps", []))

        @r("GET", "/audit")
        def audit(req, p, b, u):
            try:
                limit = int(req.query.get("limit", "200"))
            except ValueError:
                raise bad("limit must be a number")
            return self.audit.recent(limit)

    # ------------------------------------------------------------------
    def reap_once(self) -> list[str]:
        removed = self.backend.reap_expired(utcnow())
        for sam in removed:
            self.audit.write(event="guest_expired_deleted", username=sam)
        return removed


def _req(d: dict, k: str):
    v = d.get(k)
    if v is None or (isinstance(v, str) and not v.strip()):
        raise bad(f"{k} is required")
    return v


def _bool(v) -> bool:
    return str(v or "").lower() in ("1", "true", "yes")


def _opt_int(v):
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, int) or v < 1:
        raise bad("order must be a positive integer")
    return v
