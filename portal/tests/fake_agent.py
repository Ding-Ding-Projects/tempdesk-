"""A small in-memory fake of the TempDesk Agent API, for tests and local runs.

Run standalone:  uvicorn tests.fake_agent:app --port 9000
Keys: FAKE_GUEST_KEY (default guest-key), FAKE_ADMIN_KEY (default admin-key).
Admin sign-in: any username with password FAKE_ADMIN_PASSWORD (default
Passw0rd!). FAKE_BACKEND=samba switches the reported capabilities.
"""

from __future__ import annotations

import base64
import copy
import json
import os
import secrets
import string
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, Response

GUEST_KEY = os.environ.get("FAKE_GUEST_KEY", "guest-key")
ADMIN_KEY = os.environ.get("FAKE_ADMIN_KEY", "admin-key")
ADMIN_PASSWORD = os.environ.get("FAKE_ADMIN_PASSWORD", "Passw0rd!")
DOMAIN = "corp.example"
BASE = "DC=corp,DC=example"
WINDOWS_CAPS = ["guest", "directory", "gpo", "gpo-registry", "gpo-preferences", "gpo-permissions", "gpo-backup",
                "wmifilters", "admx", "security", "cmdlets", "wifi", "scripts", "allowlist", "audit"]
SAMBA_CAPS = ["guest", "directory", "gpo", "gpo-registry", "gpo-permissions", "gpo-backup", "admx", "security",
              "samba-tool", "wifi", "scripts", "allowlist", "audit"]

with open(os.path.join(os.path.dirname(__file__), "..", "..", "server", "config", "settings.default.json"), encoding="utf-8") if os.path.exists(os.path.join(os.path.dirname(__file__), "..", "..", "server", "config", "settings.default.json")) else open(os.path.join(os.path.dirname(__file__), "settings_fixture.json"), encoding="utf-8") as fh:
    DEFAULT_SETTINGS = json.load(fh)


def now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime | None) -> str | None:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


def err(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": code, "message": message}, status_code=status)


class State:
    def __init__(self, backend: str = "windows"):
        self.backend = backend
        self.settings = copy.deepcopy(DEFAULT_SETTINGS)
        self.guests: dict[str, dict] = {}
        self.tokens: dict[str, dict] = {}
        self.elevations: set[str] = set()
        self.audit: list[dict] = []
        self.calls: list[tuple[str, str, dict]] = []  # (method, path, headers subset)
        self.objects: dict[str, dict] = {}
        self.wifi: dict[str, dict] = {"lib-wifi": {"id": "lib-wifi", "ssid": "Library", "auth": "WPA2PSK", "hidden": False, "autoConnect": True, "key": "secretkey1"}}
        self.scripts: dict[tuple[str, str], str] = {("logon", "map-drives.cmd"): "@echo off\r\nnet use H: \\\\files\\home\r\n"}
        self.allow = {"enabled": True, "apps": ["msedge.exe", "WINWORD.EXE"]}
        self.gpos: dict[str, dict] = {}
        self.registry: dict[str, list[dict]] = {}
        self.prefs: dict[str, list[dict]] = {}
        self.admx_state: dict[tuple[str, str, str], dict] = {}
        self.security: dict[str, dict] = {}
        self.backups: list[dict] = []
        self.wmi: list[dict] = [{"name": "Windows 11", "description": "Client OS only", "query": "SELECT * FROM Win32_OperatingSystem WHERE ProductType = 1"}]
        self._seed()

    def _seed(self):
        def add(dn, classes, attrs):
            self.objects[dn] = {"dn": dn, "objectClass": classes, "attributes": attrs}

        add(BASE, ["top", "domain", "domainDNS"], {"name": ["corp"], "dc": ["corp"]})
        add(f"OU=TempDesk,{BASE}", ["top", "organizationalUnit"], {"name": ["TempDesk"], "ou": ["TempDesk"]})
        add(f"OU=Guests,OU=TempDesk,{BASE}", ["top", "organizationalUnit"], {"name": ["Guests"], "ou": ["Guests"]})
        add(f"CN=Users,{BASE}", ["top", "container"], {"name": ["Users"]})
        add(f"CN=Administrator,CN=Users,{BASE}", ["top", "person", "organizationalPerson", "user"],
            {"name": ["Administrator"], "sAMAccountName": ["Administrator"], "userAccountControl": ["512"], "objectSid": ["b64:AQUAAAAAAAU="]})
        add(f"CN=TempDesk Guests,OU=TempDesk,{BASE}", ["top", "group"], {"name": ["TempDesk Guests"], "member": []})
        gid = "{31B2F340-016D-11D2-945F-00C04FB984F9}"
        self.gpos[gid] = {"id": gid, "displayName": "Default Domain Policy", "status": "AllSettingsEnabled", "created": "2026-01-01T00:00:00Z",
                          "modified": "2026-10-01T00:00:00Z", "wmiFilter": None, "comment": "",
                          "links": [{"target": BASE, "enabled": True, "enforced": False, "order": 1}],
                          "permissions": [{"trustee": "Authenticated Users", "permission": "GpoApply", "denied": False}]}
        self.security[gid] = {"System Access": {"MinimumPasswordLength": "7", "LockoutBadCount": "0", "CustomKey": "5"},
                              "Privilege Rights": {"SeRemoteInteractiveLogonRight": "*S-1-5-32-544"}}

    def log(self, user: str, action: str, message: str):
        self.audit.append({"time": iso(now()), "user": user, "action": action, "message": message})


ADMX_CATEGORIES = [
    {"id": "system", "name": "System", "parentId": None, "explain": ""},
    {"id": "system.logon", "name": "Logon", "parentId": "system", "explain": ""},
    {"id": "desktop", "name": "Desktop", "parentId": None, "explain": ""},
]
ADMX_POLICIES = [
    {"id": "DisableCMD", "name": "Prevent access to the command prompt", "class": "User", "categoryId": "system",
     "explain": "Stops users from opening the command prompt.", "supportedOn": "Windows 2000 and later",
     "key": "Software\\Policies\\Microsoft\\Windows\\System", "valueName": "DisableCMD",
     "elements": [{"id": "DisableCMDScripts", "type": "enum", "label": "Disable the command prompt script processing also?", "required": True,
                   "items": [{"id": "1", "label": "Yes"}, {"id": "2", "label": "No"}], "key": None, "valueName": "DisableCMD"}]},
    {"id": "WelcomeTimeout", "name": "Logon screen timeout", "class": "Machine", "categoryId": "system.logon",
     "explain": "Seconds before the logon screen dims.", "supportedOn": "Windows 10 and later", "key": "Software\\Policies\\X", "valueName": "T",
     "elements": [{"id": "Seconds", "type": "decimal", "label": "Seconds", "required": True, "min": 1, "max": 600},
                  {"id": "Banner", "type": "text", "label": "Banner text", "maxLength": 80},
                  {"id": "Show", "type": "boolean", "label": "Show the banner"},
                  {"id": "Lines", "type": "multiText", "label": "Extra lines"},
                  {"id": "Apps", "type": "list", "label": "Allowed apps"}]},
]
SECURITY_CATALOG = {"sections": {
    "System Access": [
        {"key": "MinimumPasswordLength", "label": "Minimum password length", "type": "number", "min": 0, "max": 128, "help": "Characters."},
        {"key": "LockoutBadCount", "label": "Account lockout threshold", "type": "number", "min": 0, "max": 999, "help": "0 never locks."},
        {"key": "PasswordComplexity", "label": "Password must meet complexity requirements", "type": "boolean", "help": ""},
    ],
    "Event Audit": [{"key": "AuditLogonEvents", "label": "Audit logon events", "type": "audit", "help": ""}],
    "Privilege Rights": [{"key": "SeRemoteInteractiveLogonRight", "label": "Allow log on through Remote Desktop Services", "type": "principals", "help": ""}],
}}
CMDLETS = [
    {"name": "Get-ADUser", "module": "ActiveDirectory", "verb": "Get", "noun": "ADUser",
     "parameters": [{"name": "Identity", "type": "Microsoft.ActiveDirectory.Management.ADUser", "mandatory": True, "sets": ["Identity"]},
                    {"name": "Filter", "type": "String", "mandatory": True, "sets": ["Filter"]},
                    {"name": "Properties", "type": "String[]", "mandatory": False, "sets": []},
                    {"name": "ResultSetSize", "type": "Int32", "mandatory": False, "sets": ["Filter"]}]},
    {"name": "Remove-ADUser", "module": "ActiveDirectory", "verb": "Remove", "noun": "ADUser",
     "parameters": [{"name": "Identity", "type": "Microsoft.ActiveDirectory.Management.ADUser", "mandatory": True, "sets": []},
                    {"name": "Confirm", "type": "SwitchParameter", "mandatory": False, "sets": []}]},
]
SAMBATOOL = [
    {"command": "user list", "args": [{"name": "verbose", "flag": "--verbose", "type": "bool", "help": "More detail"}]},
    {"command": "user delete", "args": [{"name": "username", "flag": "", "type": "string", "help": "Account to delete"}]},
]


def create_app(backend: str | None = None) -> FastAPI:
    app = FastAPI()
    st = State(backend or os.environ.get("FAKE_BACKEND", "windows"))
    app.state.fake = st

    GUEST_ROUTES = ("/api/v1/health", "/api/v1/public/settings")
    OPEN_ADMIN = ("/api/v1/health", "/api/v1/public/settings", "/api/v1/auth/login")

    @app.middleware("http")
    async def auth(request: Request, call_next):
        path = request.url.path
        key = request.headers.get("x-tempdesk-key")
        st.calls.append((request.method, path, {k: v for k, v in request.headers.items() if k in ("x-forwarded-for", "authorization", "x-tempdesk-elevation", "x-tempdesk-key")}))
        if key == GUEST_KEY:
            if not (path in GUEST_ROUTES or path.startswith("/api/v1/guest/")):
                return err(403, "forbidden", "The guest key cannot use this route.")
        elif key == ADMIN_KEY:
            if path not in OPEN_ADMIN:
                auth_h = request.headers.get("authorization", "")
                tok = auth_h[7:] if auth_h.startswith("Bearer ") else ""
                if tok not in st.tokens:
                    return err(401, "unauthorized", "Sign in again.")
                request.state.user = st.tokens[tok]
        else:
            return err(401, "unauthorized", "Missing or wrong key.")
        return await call_next(request)

    def user(request: Request) -> str:
        return getattr(request.state, "user", {}).get("sam", "guest-portal")

    # ------------------------------------------------------------ open
    @app.get("/api/v1/health")
    async def health():
        return {"status": "ok", "version": "1.0.0-fake", "domain": DOMAIN, "dc": "DC01", "time": iso(now()),
                "backend": st.backend, "capabilities": SAMBA_CAPS if st.backend == "samba" else WINDOWS_CAPS}

    @app.get("/api/v1/public/settings")
    async def public_settings():
        s = st.settings
        return {k: s[k] for k in ("orgName", "welcomeText", "expiryChoices", "allowPermanent", "allowSelfDelete", "usernamePrefix")}

    @app.post("/api/v1/auth/login")
    async def login(request: Request):
        body = await request.json()
        if body.get("password") != ADMIN_PASSWORD:
            return err(401, "unauthorized", "Wrong username or password.")
        tok = secrets.token_urlsafe(24)
        st.tokens[tok] = {"sam": body.get("username"), "displayName": "Sam Admin"}
        return {"token": tok, "expiresAt": iso(now() + timedelta(hours=8)), "user": st.tokens[tok]}

    @app.post("/api/v1/auth/logout")
    async def logout(request: Request):
        tok = request.headers.get("authorization", "")[7:]
        st.tokens.pop(tok, None)
        return Response(status_code=204)

    @app.post("/api/v1/auth/confirm")
    async def confirm(request: Request):
        body = await request.json()
        if body.get("password") != ADMIN_PASSWORD:
            return err(401, "unauthorized", "Wrong password.")
        t = secrets.token_urlsafe(16)
        st.elevations.add(t)
        return JSONResponse({"token": t, "expiresAt": iso(now() + timedelta(minutes=10))}, headers={"X-TempDesk-Elevation": t})

    # ------------------------------------------------------------ guests
    def make_guest(display: str | None, minutes: int, created_by: str) -> dict:
        alphabet = string.ascii_lowercase + string.digits
        name = st.settings["usernamePrefix"] + "".join(secrets.choice(alphabet) for _ in range(6))
        pw = "".join(secrets.choice(string.ascii_letters + string.digits + "#+!") for _ in range(st.settings["passwordLength"]))
        exp = None if minutes == 0 else now() + timedelta(minutes=minutes)
        st.guests[name] = {"username": name, "displayName": display or "", "created": iso(now()), "expiresAt": iso(exp),
                           "enabled": True, "lastLogon": None, "password": pw}
        st.log(created_by, "guest.create", f"Guest {name} created")
        return {"username": name, "upn": f"{name}@{DOMAIN}", "password": pw, "expiresAt": iso(exp), "domain": DOMAIN}

    @app.post("/api/v1/guest/users")
    async def guest_create(request: Request):
        body = await request.json()
        choice = next((c for c in st.settings["expiryChoices"] if c["id"] == body.get("expiryId")), None)
        if not choice:
            return err(400, "bad_request", "Unknown expiry.")
        if choice["minutes"] == 0 and not st.settings["allowPermanent"]:
            return err(400, "bad_request", "Permanent accounts are not allowed.")
        return JSONResponse(make_guest(body.get("displayName"), choice["minutes"], "guest-portal"), status_code=201)

    def guest_auth(username, body):
        g = st.guests.get(username)
        if not g or g["password"] != body.get("password"):
            return None
        return g

    @app.post("/api/v1/guest/users/{username}/delete")
    async def guest_delete(username: str, request: Request):
        if not guest_auth(username, await request.json()):
            return err(401, "unauthorized", "Wrong username or password.")
        st.guests.pop(username)
        return Response(status_code=204)

    @app.post("/api/v1/guest/users/{username}/status")
    async def guest_status(username: str, request: Request):
        g = guest_auth(username, await request.json())
        if not g:
            return err(401, "unauthorized", "Wrong username or password.")
        return {"username": username, "expiresAt": g["expiresAt"], "enabled": g["enabled"]}

    @app.get("/api/v1/guests")
    async def guests():
        return [{k: v for k, v in g.items() if k != "password"} for g in st.guests.values()]

    @app.post("/api/v1/guests")
    async def admin_guest_create(request: Request):
        body = await request.json()
        if "minutes" in body:
            minutes = int(body["minutes"])
        else:
            c = next((c for c in st.settings["expiryChoices"] if c["id"] == body.get("expiryId")), None)
            if not c:
                return err(400, "bad_request", "Unknown expiry.")
            minutes = c["minutes"]
        return JSONResponse(make_guest(body.get("displayName"), minutes, user(request)), status_code=201)

    @app.delete("/api/v1/guests/{username}")
    async def admin_guest_delete(username: str):
        if st.guests.pop(username, None) is None:
            return err(404, "not_found", "No such guest.")
        return Response(status_code=204)

    @app.post("/api/v1/guests/{username}/extend")
    async def extend(username: str, request: Request):
        g = st.guests.get(username)
        if not g:
            return err(404, "not_found", "No such guest.")
        m = int((await request.json()).get("minutes", 0))
        g["expiresAt"] = None if m == 0 else iso(now() + timedelta(minutes=m))
        return {k: v for k, v in g.items() if k != "password"}

    # ------------------------------------------------------------ settings, audit
    @app.get("/api/v1/settings")
    async def get_settings():
        return st.settings

    @app.put("/api/v1/settings")
    async def put_settings(request: Request):
        st.settings = await request.json()
        st.log(user(request), "settings.update", "Settings updated")
        return st.settings

    @app.get("/api/v1/audit")
    async def audit(limit: int = 200):
        return st.audit[-limit:]

    # ------------------------------------------------------------ directory
    def children(dn: str):
        out = []
        for o in st.objects.values():
            if o["dn"] != dn and o["dn"].endswith("," + dn) and o["dn"][: -len(dn) - 1].count(",") == 0:
                has = any(x["dn"].endswith("," + o["dn"]) for x in st.objects.values())
                out.append({"dn": o["dn"], "name": o["attributes"].get("name", [o["dn"]])[0], "objectClass": o["objectClass"][-1], "hasChildren": has})
        return out

    @app.get("/api/v1/ad/tree")
    async def tree(dn: str | None = None):
        if not dn:
            return [{"dn": BASE, "name": "corp.example", "objectClass": "domainDNS", "hasChildren": True}]
        return children(dn)

    @app.get("/api/v1/ad/object")
    async def get_object(dn: str):
        o = st.objects.get(dn)
        if not o:
            return err(404, "not_found", "No such object.")
        return {**o, "schemaAllowed": ["description", "info", "mail", "member", "displayName"]}

    @app.post("/api/v1/ad/object")
    async def create_object(request: Request):
        b = await request.json()
        dn = f"{b['rdn']},{b['parentDn']}"
        if dn in st.objects:
            return err(409, "conflict", "Exists.")
        attrs = {k: (v if isinstance(v, list) else [v]) for k, v in (b.get("attributes") or {}).items()}
        attrs.setdefault("name", [b["rdn"].split("=", 1)[1]])
        st.objects[dn] = {"dn": dn, "objectClass": ["top", b["objectClass"]], "attributes": attrs}
        return JSONResponse({"dn": dn}, status_code=201)

    @app.patch("/api/v1/ad/object")
    async def patch_object(request: Request):
        b = await request.json()
        o = st.objects.get(b["dn"])
        if not o:
            return err(404, "not_found", "No such object.")
        a = o["attributes"]
        for k, v in (b.get("set") or {}).items():
            a[k] = list(v)
        for k, v in (b.get("add") or {}).items():
            a.setdefault(k, []).extend(v)
        for k, v in (b.get("remove") or {}).items():
            a[k] = [x for x in a.get(k, []) if x not in v]
        for k in b.get("clear") or []:
            a.pop(k, None)
        return o

    @app.post("/api/v1/ad/object/move")
    async def move(request: Request):
        b = await request.json()
        o = st.objects.pop(b["dn"], None)
        if not o:
            return err(404, "not_found", "No such object.")
        rdn = b.get("newRdn") or b["dn"].split(",", 1)[0]
        o["dn"] = f"{rdn},{b['newParentDn']}"
        st.objects[o["dn"]] = o
        return {"dn": o["dn"]}

    @app.delete("/api/v1/ad/object")
    async def delete_object(dn: str, recursive: str = "false"):
        if dn not in st.objects:
            return err(404, "not_found", "No such object.")
        st.objects.pop(dn)
        return Response(status_code=204)

    @app.get("/api/v1/ad/search")
    async def search(filter: str, base: str | None = None, scope: str = "sub", attrs: str = "", limit: int = 500):
        want = [a for a in attrs.split(",") if a and a != "*"]
        out = []
        needle = filter.split("=", 1)[1].rstrip(")") if "=" in filter else ""
        for o in st.objects.values():
            if base and not o["dn"].endswith(base):
                continue
            flat = json.dumps(o["attributes"])
            if needle in ("*", "") or needle.strip("*").lower() in flat.lower():
                a = {k: v for k, v in o["attributes"].items() if not want or k in want}
                out.append({"dn": o["dn"], "attributes": a})
        return out[:limit]

    @app.post("/api/v1/ad/user/password")
    async def pw(request: Request):
        return Response(status_code=204)

    @app.post("/api/v1/ad/user/enable")
    async def enable(request: Request):
        return Response(status_code=204)

    @app.post("/api/v1/ad/user/unlock")
    async def unlock(request: Request):
        return Response(status_code=204)

    @app.post("/api/v1/ad/group/members")
    async def members(request: Request):
        b = await request.json()
        o = st.objects.get(b["groupDn"])
        if not o:
            return err(404, "not_found", "No such group.")
        m = o["attributes"].setdefault("member", [])
        m.extend(x for x in b.get("add", []) if x not in m)
        o["attributes"]["member"] = [x for x in m if x not in b.get("remove", [])]
        return Response(status_code=204)

    # ------------------------------------------------------------ gpo
    def gpo_or_404(gid):
        return st.gpos.get(gid)

    @app.get("/api/v1/gpo")
    async def gpo_list():
        return [{k: v for k, v in g.items() if k != "permissions"} for g in st.gpos.values()]

    @app.post("/api/v1/gpo")
    async def gpo_create(request: Request):
        b = await request.json()
        gid = "{" + secrets.token_hex(4).upper() + "-0000-0000-0000-" + secrets.token_hex(6).upper() + "}"
        st.gpos[gid] = {"id": gid, "displayName": b["name"], "status": "AllSettingsEnabled", "created": iso(now()), "modified": iso(now()),
                        "wmiFilter": None, "comment": b.get("comment", ""), "links": [], "permissions": []}
        return JSONResponse(st.gpos[gid], status_code=201)

    @app.get("/api/v1/gpo/backups")
    async def backups():
        return st.backups

    @app.get("/api/v1/gpo/wmifilters")
    async def wmi():
        return st.wmi

    @app.post("/api/v1/gpo/wmifilters")
    async def wmi_create(request: Request):
        st.wmi.append(await request.json())
        return JSONResponse(st.wmi[-1], status_code=201)

    @app.put("/api/v1/gpo/inheritance")
    async def inheritance(request: Request):
        return Response(status_code=204)

    @app.post("/api/v1/gpo/import")
    async def gpo_import(request: Request):
        return {"ok": True}

    @app.get("/api/v1/gpo/{gid}")
    async def gpo_get(gid: str):
        g = gpo_or_404(gid)
        return g if g else err(404, "not_found", "No such GPO.")

    @app.patch("/api/v1/gpo/{gid}")
    async def gpo_patch(gid: str, request: Request):
        g = gpo_or_404(gid)
        if not g:
            return err(404, "not_found", "No such GPO.")
        g.update({k: v for k, v in (await request.json()).items() if k in ("displayName", "status", "comment")})
        return g

    @app.delete("/api/v1/gpo/{gid}")
    async def gpo_delete(gid: str):
        if not st.gpos.pop(gid, None):
            return err(404, "not_found", "No such GPO.")
        return Response(status_code=204)

    @app.get("/api/v1/gpo/{gid}/report")
    async def report(gid: str, format: str = "html"):
        g = gpo_or_404(gid)
        if format == "xml":
            return Response(f"<GPO><Name>{g['displayName']}</Name></GPO>", media_type="application/xml")
        return Response(f"<html><head><style>h1{{color:teal}}</style></head><body><h1>{g['displayName']}</h1><script>alert(1)</script></body></html>", media_type="text/html")

    @app.api_route("/api/v1/gpo/{gid}/links", methods=["POST", "PATCH", "DELETE"])
    async def links(gid: str, request: Request):
        g = gpo_or_404(gid)
        if request.method == "DELETE":
            g["links"] = [x for x in g["links"] if x["target"] != request.query_params.get("target")]
            return Response(status_code=204)
        b = await request.json()
        g["links"] = [x for x in g["links"] if x["target"] != b["target"]] + [{"order": len(g["links"]) + 1, **b}]
        return g

    @app.api_route("/api/v1/gpo/{gid}/registry", methods=["GET", "PUT", "DELETE"])
    async def registry(gid: str, request: Request):
        rows = st.registry.setdefault(gid, [])
        if request.method == "GET":
            return rows
        if request.method == "PUT":
            b = await request.json()
            rows.append({**b, "policyState": "Set"})
            return b
        st.registry[gid] = [r for r in rows if not (r["key"] == request.query_params.get("key") and r["valueName"] == request.query_params.get("valueName"))]
        return Response(status_code=204)

    @app.api_route("/api/v1/gpo/{gid}/preferences/registry", methods=["GET", "PUT", "DELETE"])
    async def prefs(gid: str, request: Request):
        rows = st.prefs.setdefault(gid, [])
        if request.method == "GET":
            return rows
        if request.method == "PUT":
            rows.append(await request.json())
            return rows[-1]
        return Response(status_code=204)

    @app.put("/api/v1/gpo/{gid}/permissions")
    async def perms(gid: str, request: Request):
        b = await request.json()
        st.gpos[gid]["permissions"].append({"trustee": b["trustee"], "permission": b["permission"], "denied": False})
        return Response(status_code=204)

    @app.post("/api/v1/gpo/{gid}/backup")
    async def backup(gid: str):
        b = {"backupId": secrets.token_hex(8), "gpoId": gid, "displayName": st.gpos[gid]["displayName"], "created": iso(now()), "path": "C:\\Backups"}
        st.backups.append(b)
        return b

    @app.post("/api/v1/gpo/{gid}/restore")
    async def restore(gid: str):
        return {"ok": True}

    @app.put("/api/v1/gpo/{gid}/wmifilter")
    async def set_wmi(gid: str, request: Request):
        st.gpos[gid]["wmiFilter"] = (await request.json()).get("name")
        return Response(status_code=204)

    @app.get("/api/v1/admx/categories")
    async def admx_categories():
        return ADMX_CATEGORIES

    @app.get("/api/v1/admx/policies")
    async def admx_policies(category: str | None = None, q: str | None = None):
        rows = ADMX_POLICIES
        if category:
            rows = [p for p in rows if p["categoryId"] == category]
        if q:
            rows = [p for p in rows if q.lower() in (p["name"] + p["id"]).lower()]
        return rows

    @app.api_route("/api/v1/gpo/{gid}/admx/{pid}", methods=["GET", "PUT"])
    async def admx_policy(gid: str, pid: str, request: Request):
        if request.method == "GET":
            return st.admx_state.get((gid, pid, request.query_params.get("class", "Machine")), {"state": "NotConfigured", "values": {}})
        b = await request.json()
        st.admx_state[(gid, pid, b["class"])] = {"state": b["state"], "values": b.get("values") or {}}
        return st.admx_state[(gid, pid, b["class"])]

    @app.api_route("/api/v1/gpo/{gid}/security", methods=["GET", "PUT"])
    async def security(gid: str, request: Request):
        if request.method == "GET":
            return {"sections": st.security.get(gid, {})}
        st.security[gid] = (await request.json())["sections"]
        return {"sections": st.security[gid]}

    @app.get("/api/v1/security/catalog")
    async def catalog():
        return SECURITY_CATALOG

    # ------------------------------------------------------------ runners
    @app.get("/api/v1/cmdlets")
    async def cmdlets(request: Request):
        if st.backend == "samba":
            return err(404, "not_found", "No cmdlets on Samba.")
        if request.query_params.get("scope") == "all" and request.headers.get("x-tempdesk-elevation") not in st.elevations:
            return err(403, "forbidden", "Elevation required.")
        return CMDLETS

    @app.post("/api/v1/cmdlets/invoke")
    async def invoke(request: Request):
        b = await request.json()
        if b["name"].startswith(("Remove-", "Clear-", "Reset-", "Restore-", "Disable-")) and b.get("confirm") != b["name"]:
            return err(400, "bad_request", "Confirmation required.")
        return {"output": [{"Name": "Administrator", "Enabled": True, "Groups": ["Domain Admins"], "Params": b["parameters"]}], "errors": [], "warnings": ["What if: nothing changed"] if b.get("whatIf") else []}

    @app.get("/api/v1/sambatool")
    async def sambatool():
        if st.backend != "samba":
            return err(404, "not_found", "Not on Windows.")
        return SAMBATOOL

    @app.post("/api/v1/sambatool/invoke")
    async def sambatool_invoke(request: Request):
        b = await request.json()
        if "delete" in b["command"] and b.get("confirm") != b["command"]:
            return err(400, "bad_request", "Confirmation required.")
        return {"exitCode": 0, "stdout": "Administrator\nGuest\n", "stderr": ""}

    # ------------------------------------------------------------ presetup
    @app.get("/api/v1/wifi")
    async def wifi():
        return [{k: v for k, v in w.items() if k != "key"} for w in st.wifi.values()]

    @app.put("/api/v1/wifi/{pid}")
    async def wifi_put(pid: str, request: Request):
        b = await request.json()
        cur = st.wifi.get(pid, {})
        st.wifi[pid] = {**cur, **b, "id": pid}
        return {k: v for k, v in st.wifi[pid].items() if k != "key"}

    @app.delete("/api/v1/wifi/{pid}")
    async def wifi_delete(pid: str):
        st.wifi.pop(pid, None)
        return Response(status_code=204)

    @app.get("/api/v1/scripts")
    async def scripts(kind: str):
        return [{"name": n, "kind": k, "size": len(c), "modified": iso(now())} for (k, n), c in st.scripts.items() if k == kind]

    @app.api_route("/api/v1/scripts/{kind}/{name}", methods=["GET", "PUT", "DELETE"])
    async def script(kind: str, name: str, request: Request):
        if request.method == "GET":
            if (kind, name) not in st.scripts:
                return err(404, "not_found", "No such script.")
            return {"content": st.scripts[(kind, name)]}
        if request.method == "PUT":
            st.scripts[(kind, name)] = (await request.json())["content"]
            return Response(status_code=204)
        st.scripts.pop((kind, name), None)
        return Response(status_code=204)

    @app.api_route("/api/v1/allowlist", methods=["GET", "PUT"])
    async def allowlist(request: Request):
        if request.method == "PUT":
            st.allow = await request.json()
        return st.allow

    return app


app = create_app()

base64  # noqa: B018 (kept for binary attribute experiments)
