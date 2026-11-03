"""In memory backend for tests and portal development. Directory objects
are minimal; GPO files live in a real temporary SYSVOL folder so the
shared SysvolMixin code paths are exercised."""

from __future__ import annotations

import datetime as dt
import os
import uuid

from . import gpt
from .backend import Backend, SysvolMixin, norm_guid, public_id
from .gpoeditor import GpoEditorMixin
from .errors import bad, conflict, not_found
from .sambatool import build_argv
from .util import iso


class FakeBackend(GpoEditorMixin, SysvolMixin, Backend):
    name = "fake"

    def __init__(self, sysvol_root: str, domain="lab.example.org", netbios="LAB", admins=None):
        self.domain = domain
        self.netbios = netbios
        self.base_dn = ",".join(f"DC={p}" for p in domain.split("."))
        self.sysvol_domain_dir = os.path.join(sysvol_root, domain)
        os.makedirs(os.path.join(self.sysvol_domain_dir, "Policies"), exist_ok=True)
        self.users = {"administrator": {"sam": "Administrator", "password": "Passw0rd!", "displayName": "Administrator",
                                        "groups": {"TempDesk Admins"}}}
        if admins:
            self.users.update(admins)
        self.guests: dict[str, dict] = {}
        self.gpos: dict[str, dict] = {}
        self.links: dict[str, list] = {}
        self.invocations: list[list[str]] = []

    # info/auth
    def info(self):
        return {"domain": self.domain, "dc": "dc1." + self.domain, "netbios": self.netbios}

    def check_password(self, username, password):
        u = self.users.get(username.lower())
        if u and u["password"] == password:
            return {"sam": u["sam"], "displayName": u.get("displayName", u["sam"])}
        g = self.guests.get(username.lower())
        if g and g["password"] == password:
            return {"sam": g["username"], "displayName": g.get("displayName") or g["username"]}
        return None

    def is_member_recursive(self, sam, group_name):
        u = self.users.get(sam.lower())
        return bool(u and group_name in u.get("groups", set()))

    # guests
    def guest_ou_dn(self):
        return "OU=Guests,OU=TempDesk," + self.base_dn

    def username_exists(self, sam):
        return sam.lower() in self.guests or sam.lower() in self.users

    def create_guest(self, sam, password, display_name, expires, info_json, group_name):
        now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
        self.guests[sam.lower()] = {"username": sam, "password": password, "displayName": display_name or sam,
                                    "created": iso(now), "expires": expires, "enabled": True,
                                    "info": info_json, "group": group_name}
        return {"upn": f"{sam}@{self.domain}"}

    def _pub(self, g):
        return {"username": g["username"], "displayName": g["displayName"], "created": g["created"],
                "expiresAt": iso(g["expires"]), "enabled": g["enabled"], "lastLogon": None}

    def find_guest(self, sam):
        g = self.guests.get(sam.lower())
        return self._pub(g) if g else None

    def list_guests(self):
        return [self._pub(g) for g in self.guests.values()]

    def delete_guest(self, sam):
        if self.guests.pop(sam.lower(), None) is None:
            raise not_found("guest not found")

    def set_guest_expiry(self, sam, expires):
        g = self.guests[sam.lower()]
        g["expires"] = expires
        return self._pub(g)

    def reap_expired(self, now):
        gone = [g["username"] for g in self.guests.values() if g["expires"] and g["expires"] <= now]
        for s in gone:
            self.guests.pop(s.lower(), None)
        return gone

    # gpo
    def _gpo_meta(self, guid):
        return self.gpos.get(guid)

    def _gpo_meta_update(self, guid, version=None, machineExt=None, userExt=None):
        g = self.gpos[guid]
        if version is not None:
            g["versionNumber"] = version
        if machineExt is not None:
            g["machineExt"] = machineExt
        if userExt is not None:
            g["userExt"] = userExt

    def find_gpo_by_name(self, name):
        for k, g in self.gpos.items():
            if g["displayName"].lower() == name.lower():
                return k
        return None

    def gpo_create(self, name, comment=None):
        if self.find_gpo_by_name(name):
            raise conflict("a GPO with that name exists")
        guid = "{" + str(uuid.uuid4()).upper() + "}"
        d = os.path.join(self.sysvol_domain_dir, "Policies", guid)
        os.makedirs(os.path.join(d, "Machine"))
        os.makedirs(os.path.join(d, "User"))
        with open(os.path.join(d, "GPT.INI"), "w", newline="") as f:
            f.write("[General]\r\nVersion=0\r\n")
        self.gpos[guid] = {"displayName": name, "versionNumber": 0, "machineExt": "", "userExt": "", "flags": 0,
                           "comment": comment}
        return self.gpo_get(guid)

    def gpo_get(self, gpo_id, with_permissions=False):
        guid = norm_guid(gpo_id)
        g = self.gpos.get(guid)
        if not g:
            raise not_found("GPO not found")
        u, m = gpt.split_version(g["versionNumber"])
        out = {"id": public_id(guid), "displayName": g["displayName"], "status": gpt.STATUS_BY_FLAGS[g["flags"]],
               "created": None, "modified": None, "wmiFilter": None, "version": g["versionNumber"],
               "userVersion": u, "computerVersion": m,
               "links": [{"target": t, "enabled": l["enabled"], "enforced": l["enforced"], "order": l["order"]}
                         for t, ls in self.links.items() for l in ls if l["guid"] == guid]}
        if with_permissions:
            out["permissions"] = []
        return out

    def gpo_list(self):
        return [self.gpo_get(g) for g in self.gpos]

    def gpo_set_link(self, gpo_id, target, enabled, enforced, order, create):
        guid = norm_guid(gpo_id)
        ls = self.links.setdefault(target, [])
        cur = next((l for l in ls if l["guid"] == guid), None)
        if cur is None:
            if not create:
                raise not_found("link not found")
            cur = {"guid": guid, "enabled": True, "enforced": False, "order": len(ls) + 1}
            ls.append(cur)
        if enabled is not None:
            cur["enabled"] = bool(enabled)
        if enforced is not None:
            cur["enforced"] = bool(enforced)
        return self.gpo_get(guid)

    def sambatool_invoke(self, command, args, confirm):
        argv = build_argv(command, args, confirm)
        self.invocations.append(argv)
        return {"exitCode": 0, "stdout": "", "stderr": ""}

    def ad_tree(self, dn):
        return [{"dn": "OU=TempDesk," + self.base_dn, "name": "TempDesk", "objectClass": "organizationalUnit",
                 "hasChildren": True}]

    def gpo_delete(self, gpo_id):
        guid = norm_guid(gpo_id)
        if self.gpos.pop(guid, None) is None:
            raise not_found("GPO not found")

    def ad_get(self, dn):
        if not dn:
            raise bad("dn is required")
        raise not_found("object not found")
