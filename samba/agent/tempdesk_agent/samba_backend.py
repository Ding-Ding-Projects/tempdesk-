"""Backend for a Samba 4 AD DC, using the samba Python bindings directly
(SamDB with a system session for directory work, ntacls for SYSVOL ACLs)
and samba-tool for GPO create/delete/backup.

Only importable where python3-samba is installed (inside the image).
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import threading
import uuid

import ldb
from samba import Ldb as SambaLdb
from samba.auth import system_session
from samba.credentials import DONT_USE_KERBEROS, Credentials
from samba.dcerpc import security
from samba.ndr import ndr_pack, ndr_unpack
from samba.param import LoadParm
from samba.samdb import SamDB

from . import gpt, sambatool, sddl as sddlmod
from .backend import ALL_CAPABILITIES, Backend, SysvolMixin, ci_path, norm_guid, public_id
from .gpoeditor import GpoEditorMixin
from .errors import ApiError, bad, conflict, forbidden, not_found
from .util import (BACKUP_ID_RE, NEVER_EXPIRES, UF_ACCOUNTDISABLE, UF_DONT_EXPIRE_PASSWD,
                   UF_NORMAL_ACCOUNT, dn_is_under, from_filetime, iso, parse_generalized_time,
                   to_filetime, utcnow, valid_id)

BINARY_ATTRS = {
    "objectguid", "objectsid", "ntsecuritydescriptor", "msexchmailboxsecuritydescriptor", "thumbnailphoto",
    "jpegphoto", "usercertificate", "cacertificate", "sidhistory", "tokengroups", "logonhours",
    "msds-generationid", "replpropertymetadata", "replupstodatevector", "repsfrom", "repsto",
    "dnsrecord", "dnsproperty", "supplementalcredentials", "unicodepwd", "dbcspwd", "ntpwdhistory",
    "lmpwdhistory", "msds-allowedtoactonbehalfofotheridentity", "schemaidguid", "attributesecurityguid",
    "msds-trustforesttrustinfo", "pekList".lower(), "msds-keycredentiallink", "objectclasscategory_bin",
}
SECRET_ATTRS = {"unicodepwd", "dbcspwd", "ntpwdhistory", "lmpwdhistory", "supplementalcredentials",
                "currentvalue", "priorvalue", "initialauthincoming", "initialauthoutgoing",
                "trustauthincoming", "trustauthoutgoing", "peklist", "msds-executescriptpassword"}

WELL_KNOWN_TRUSTEES = {
    "authenticated users": "S-1-5-11", "everyone": "S-1-1-0", "system": "S-1-5-18",
    "enterprise domain controllers": "S-1-5-9", "creator owner": "S-1-3-0",
}

LDB_ERR = {
    ldb.ERR_NO_SUCH_OBJECT: "not_found",
    ldb.ERR_ENTRY_ALREADY_EXISTS: "conflict",
    ldb.ERR_INSUFFICIENT_ACCESS_RIGHTS: "forbidden",
    ldb.ERR_NOT_ALLOWED_ON_NON_LEAF: "conflict",
    ldb.ERR_ATTRIBUTE_OR_VALUE_EXISTS: "conflict",
}


def ldb_error(e: ldb.LdbError) -> ApiError:
    code, msg = (e.args + (None, ""))[:2]
    return ApiError(LDB_ERR.get(code, "bad_request"), f"{msg} (ldb error {code})")


def esc(v: str) -> str:
    return ldb.binary_encode(v)


def _vals(el) -> list[bytes]:
    out = []
    for i in range(len(el)):
        v = el[i]
        out.append(v if isinstance(v, bytes) else str(v).encode("utf-8"))
    return out


def _first(msg, attr, default=None):
    if attr in msg and len(msg[attr]):
        v = msg[attr][0]
        return v.decode("utf-8", "replace") if isinstance(v, bytes) else str(v)
    return default


def serialize_value(attr: str, v: bytes) -> str:
    if attr.lower() in BINARY_ATTRS:
        return "b64:" + base64.b64encode(v).decode()
    try:
        s = v.decode("utf-8")
    except UnicodeDecodeError:
        return "b64:" + base64.b64encode(v).decode()
    if any(ord(c) < 32 and c not in "\t\r\n" for c in s):
        return "b64:" + base64.b64encode(v).decode()
    return s


def parse_value(v) -> bytes:
    if isinstance(v, bool):
        return b"TRUE" if v else b"FALSE"
    if isinstance(v, (int, float)):
        return str(int(v)).encode()
    if not isinstance(v, str):
        raise bad("attribute values must be strings, numbers or booleans")
    if v.startswith("b64:"):
        try:
            return base64.b64decode(v[4:], validate=True)
        except ValueError:
            raise bad("invalid base64 value")
    return v.encode("utf-8")


def _as_list(v):
    return v if isinstance(v, list) else [v]


class SambaBackend(GpoEditorMixin, SysvolMixin, Backend):
    name = "samba"

    def __init__(self, smb_conf: str | None = None, data_dir: str = "/var/lib/tempdesk",
                 settings_getter=None):
        self.lp = LoadParm()
        if smb_conf:
            self.lp.load(smb_conf)
        else:
            self.lp.load_default()
        self.data_dir = data_dir
        self.settings_getter = settings_getter or (lambda: {})
        self.realm = self.lp.get("realm").lower()
        self.netbios = self.lp.get("workgroup").upper()
        self.hostname = self.lp.get("netbios name").lower()
        self.fqdn = f"{self.hostname}.{self.realm}"
        sysvol = self.lp.get("path", "sysvol") or "/var/lib/samba/sysvol"
        self.sysvol_domain_dir = os.path.join(sysvol, self.realm)
        self.auth_file = os.path.join(data_dir, "private", "svc.auth")
        self.backup_dir = os.path.join(data_dir, "gpo-backups")
        self._lock = threading.RLock()
        self._db = None
        self._connect()

    # ------------------------------------------------------------------
    def _connect(self):
        self._db = SamDB(url=self.lp.samdb_url(), session_info=system_session(), lp=self.lp)
        self.base_dn = str(self._db.domain_dn())
        self.domain_sid = str(self._db.get_domain_sid())
        self.config_dn = str(self._db.get_config_basedn())

    def _run(self, fn):
        """Run fn(db) under the lock, reconnecting once on a broken handle."""
        with self._lock:
            try:
                return fn(self._db)
            except ldb.LdbError as e:
                if e.args and e.args[0] in (ldb.ERR_OPERATIONS_ERROR, ldb.ERR_UNAVAILABLE):
                    self._connect()
                    try:
                        return fn(self._db)
                    except ldb.LdbError as e2:
                        raise ldb_error(e2)
                raise ldb_error(e)

    def _dn(self, s: str) -> ldb.Dn:
        if not isinstance(s, str) or not s.strip():
            raise bad("dn is required")
        d = ldb.Dn(self._db, s)
        if not d.is_valid():
            raise bad("invalid dn")
        return d

    def _rel_dn(self, rel: str) -> str:
        """Settings hold OUs relative to the domain (OU=Guests,OU=TempDesk)."""
        rel = rel.strip().strip(",")
        if rel.lower().endswith(self.base_dn.lower()):
            return rel
        return f"{rel},{self.base_dn}"

    # ------------------------------------------------------------------
    def info(self):
        return {"domain": self.realm, "dc": self.fqdn, "netbios": self.netbios}

    def capabilities(self):
        caps = list(ALL_CAPABILITIES)
        return caps

    def check_password(self, username, password):
        if not username or not password or len(password) > 512:
            return None
        lp = LoadParm()
        lp.load(self.lp.configfile)
        lp.set("tls verify peer", "no_check")
        creds = Credentials()
        creds.guess(lp)
        creds.set_username(username)
        creds.set_password(password)
        creds.set_domain(self.netbios)
        creds.set_workstation(self.hostname.upper())
        creds.set_kerberos_state(DONT_USE_KERBEROS)
        try:
            # NTLM authenticated bind against the local DC over LDAP with
            # signing and sealing. This counts bad passwords and honours
            # disabled, expired and locked out accounts like a real logon.
            conn = SambaLdb(url="ldap://127.0.0.1", credentials=creds, lp=lp)
            conn.search(base="", scope=ldb.SCOPE_BASE, attrs=["dnsHostName"])
            del conn
        except ldb.LdbError:
            return None
        except Exception:  # noqa: BLE001 - NTSTATUS errors from the transport
            return None

        def find(db):
            r = db.search(self.base_dn, ldb.SCOPE_SUBTREE,
                          f"(&(objectClass=user)(sAMAccountName={esc(username)}))",
                          ["sAMAccountName", "displayName"])
            return r[0] if len(r) else None
        m = self._run(find)
        if m is None:
            return None
        return {"sam": _first(m, "sAMAccountName"), "displayName": _first(m, "displayName") or _first(m, "sAMAccountName"),
                "dn": str(m.dn)}

    def is_member_recursive(self, sam, group_name):
        def f(db):
            u = db.search(self.base_dn, ldb.SCOPE_SUBTREE, f"(sAMAccountName={esc(sam)})", ["primaryGroupID"])
            if not len(u):
                return False
            udn = str(u[0].dn)
            g = db.search(self.base_dn, ldb.SCOPE_SUBTREE,
                          f"(&(objectClass=group)(sAMAccountName={esc(group_name)})"
                          f"(member:1.2.840.113556.1.4.1941:={esc(udn)}))", ["dn"])
            return len(g) > 0
        return self._run(f)

    # ------------------------------------------------------------------
    # Guests
    def guest_ou_dn(self):
        return self._rel_dn(self.settings_getter().get("guestOu", "OU=Guests,OU=TempDesk"))

    GUEST_ATTRS = ["sAMAccountName", "displayName", "whenCreated", "accountExpires", "userAccountControl",
                   "lastLogonTimestamp", "lockoutTime"]

    def _guest_pub(self, m):
        uac = int(_first(m, "userAccountControl", "0"))
        created = parse_generalized_time(_first(m, "whenCreated", ""))
        ll = from_filetime(_first(m, "lastLogonTimestamp", "0"))
        return {"username": _first(m, "sAMAccountName"), "displayName": _first(m, "displayName") or "",
                "created": iso(created), "expiresAt": iso(from_filetime(_first(m, "accountExpires", "0"))),
                "enabled": not (uac & UF_ACCOUNTDISABLE), "lastLogon": iso(ll), "dn": str(m.dn)}

    def _guest_search(self, extra=""):
        ou = self.guest_ou_dn()

        def f(db):
            try:
                return list(db.search(ou, ldb.SCOPE_SUBTREE,
                                      f"(&(objectClass=user)(!(objectClass=computer)){extra})", self.GUEST_ATTRS))
            except ldb.LdbError as e:
                if e.args[0] == ldb.ERR_NO_SUCH_OBJECT:
                    return []
                raise
        return self._run(f)

    def username_exists(self, sam):
        return self._run(lambda db: len(db.search(self.base_dn, ldb.SCOPE_SUBTREE,
                                                  f"(sAMAccountName={esc(sam)})", ["dn"])) > 0)

    def count_guests(self):
        return len(self._guest_search())

    def list_guests(self):
        out = [self._guest_pub(m) for m in self._guest_search()]
        for g in out:
            g.pop("dn", None)
        return sorted(out, key=lambda g: g["created"] or "")

    def find_guest(self, sam):
        r = self._guest_search(f"(sAMAccountName={esc(sam)})")
        if not r:
            return None
        g = self._guest_pub(r[0])
        if not dn_is_under(g["dn"], self.guest_ou_dn()):
            return None
        return g

    def create_guest(self, sam, password, display_name, expires, info_json, group_name):
        ou_rel = self.settings_getter().get("guestOu", "OU=Guests,OU=TempDesk")
        acct_exp = str(to_filetime(expires)) if expires else str(NEVER_EXPIRES)

        def f(db):
            db.transaction_start()
            try:
                db.newuser(sam, password, userou=ou_rel, description="TempDesk guest",
                           givenname=None, surname=None)
                r = db.search(self.base_dn, ldb.SCOPE_SUBTREE, f"(sAMAccountName={esc(sam)})", ["dn"])
                dn = r[0].dn
                m = ldb.Message(dn)
                m["userAccountControl"] = ldb.MessageElement(str(UF_NORMAL_ACCOUNT | UF_DONT_EXPIRE_PASSWD),
                                                             ldb.FLAG_MOD_REPLACE, "userAccountControl")
                m["accountExpires"] = ldb.MessageElement(acct_exp, ldb.FLAG_MOD_REPLACE, "accountExpires")
                m["info"] = ldb.MessageElement(info_json, ldb.FLAG_MOD_REPLACE, "info")
                m["displayName"] = ldb.MessageElement(display_name or sam, ldb.FLAG_MOD_REPLACE, "displayName")
                m["userPrincipalName"] = ldb.MessageElement(f"{sam}@{self.realm}", ldb.FLAG_MOD_REPLACE,
                                                            "userPrincipalName")
                db.modify(m)
                # "User cannot change password": deny the Change Password
                # extended right to SELF and Everyone, as ADUC does.
                self._modify_sd(db, dn, sddlmod.cannot_change_password)
                db.add_remove_group_members(group_name, [sam], add_members_operation=True)
                db.transaction_commit()
            except Exception:
                db.transaction_cancel()
                raise
        self._run(f)
        return {"upn": f"{sam}@{self.realm}"}

    def _read_sd(self, db, dn, flags: int = 4) -> str:
        """SDDL of an object's security descriptor. flags 4 = DACL only,
        7 = owner, group and DACL."""
        r = db.search(dn, ldb.SCOPE_BASE, attrs=["nTSecurityDescriptor"], controls=[f"sd_flags:1:{flags}"])
        sd = ndr_unpack(security.descriptor, r[0]["nTSecurityDescriptor"][0])
        return sd.as_sddl(security.dom_sid(self.domain_sid))

    def _write_sd(self, db, dn, sddl_text: str):
        sd = security.descriptor.from_sddl(sddl_text, security.dom_sid(self.domain_sid))
        m = ldb.Message(dn if isinstance(dn, ldb.Dn) else ldb.Dn(db, str(dn)))
        m["nTSecurityDescriptor"] = ldb.MessageElement(ndr_pack(sd), ldb.FLAG_MOD_REPLACE, "nTSecurityDescriptor")
        db.modify(m, controls=["sd_flags:1:4"])

    def _modify_sd(self, db, dn, fn):
        self._write_sd(db, dn, fn(self._read_sd(db, dn)))

    def delete_guest(self, sam):
        g = self.find_guest(sam)
        if not g:
            raise not_found("guest not found")
        self._run(lambda db: db.delete(g["dn"]))

    def set_guest_expiry(self, sam, expires):
        g = self.find_guest(sam)
        if not g:
            raise not_found("guest not found")
        val = str(to_filetime(expires)) if expires else str(NEVER_EXPIRES)

        def f(db):
            m = ldb.Message(ldb.Dn(db, g["dn"]))
            m["accountExpires"] = ldb.MessageElement(val, ldb.FLAG_MOD_REPLACE, "accountExpires")
            db.modify(m)
        self._run(f)
        out = self.find_guest(sam)
        out.pop("dn", None)
        return out

    def reap_expired(self, now):
        cutoff = to_filetime(now)
        gone = []
        for m in self._guest_search():
            try:
                v = int(_first(m, "accountExpires", "0"))
            except ValueError:
                continue
            if 0 < v < NEVER_EXPIRES and v <= cutoff:
                sam = _first(m, "sAMAccountName")
                try:
                    self._run(lambda db, dn=m.dn: db.delete(dn))
                    gone.append(sam)
                except ApiError:
                    continue
        return gone

    # ------------------------------------------------------------------
    # Directory
    def _msg_to_attrs(self, m, skip_secret=True):
        out = {}
        for a in m.keys():
            if a.lower() in ("dn", "distinguishedname") and a != "distinguishedName":
                continue
            if skip_secret and a.lower() in SECRET_ATTRS:
                continue
            out[a] = [serialize_value(a, v) for v in _vals(m[a])]
        return out

    def ad_tree(self, dn):
        base = dn or self.base_dn

        def f(db):
            d = self._dn(base)
            res = db.search(d, ldb.SCOPE_ONELEVEL, "(objectClass=*)", ["name", "objectClass"])
            out = []
            for m in res:
                try:
                    kids = db.search(m.dn, ldb.SCOPE_ONELEVEL, "(objectClass=*)", ["dn"])
                    has = len(kids) > 0
                except ldb.LdbError:
                    has = False
                oc = [v.decode() for v in _vals(m["objectClass"])] if "objectClass" in m else []
                out.append({"dn": str(m.dn), "name": _first(m, "name") or str(m.dn).split(",")[0].split("=", 1)[-1],
                            "objectClass": oc[-1] if oc else "", "hasChildren": has})
            out.sort(key=lambda x: (not x["hasChildren"], x["name"].lower()))
            return out
        return self._run(f)

    def ad_search(self, base, flt, scope, attrs, limit):
        sc = {"sub": ldb.SCOPE_SUBTREE, "one": ldb.SCOPE_ONELEVEL, "base": ldb.SCOPE_BASE}[scope]
        if len(flt) > 4096:
            raise bad("filter too long")

        def f(db):
            try:
                res = db.search(self._dn(base or self.base_dn), sc, flt, attrs or ["*"])
            except ldb.LdbError as e:
                if e.args[0] in (ldb.ERR_OPERATIONS_ERROR, ldb.ERR_PROTOCOL_ERROR):
                    raise bad(f"invalid filter: {e.args[1]}")
                raise
            out = []
            for m in res:
                if m.dn is None:
                    continue
                out.append({"dn": str(m.dn), "attributes": self._msg_to_attrs(m)})
                if len(out) >= limit:
                    break
            return out
        return self._run(f)

    def ad_get(self, dn):
        def f(db):
            d = self._dn(dn)
            res = db.search(d, ldb.SCOPE_BASE, attrs=["*", "allowedAttributes"])
            if not len(res):
                raise not_found("object not found")
            m = res[0]
            attrs = self._msg_to_attrs(m)
            allowed = sorted(attrs.pop("allowedAttributes", []), key=str.lower)
            return {"dn": str(m.dn), "objectClass": attrs.get("objectClass", []), "attributes": attrs,
                    "schemaAllowed": allowed}
        return self._run(f)

    def ad_create(self, parent_dn, object_class, rdn, attributes):
        if not re.match(r"^(CN|OU|DC|O|L)=.+", rdn, re.I):
            raise bad("rdn must look like CN=name or OU=name")

        def f(db):
            parent = self._dn(parent_dn)
            dn = ldb.Dn(db, rdn)
            if not dn.is_valid() or len(dn) != 1:
                raise bad("rdn must be a single RDN")
            dn.add_base(parent)
            m = ldb.Message(dn)
            m["objectClass"] = ldb.MessageElement([str(c).encode() for c in _as_list(object_class)],
                                                  ldb.FLAG_MOD_ADD, "objectClass")
            for a, vs in attributes.items():
                if a.lower() in ("objectclass", "distinguishedname", "dn"):
                    continue
                m[a] = ldb.MessageElement([parse_value(v) for v in _as_list(vs)], ldb.FLAG_MOD_ADD, a)
            db.add(m)
            return str(dn)
        return self._run(f)

    def ad_modify(self, dn, set_, add, remove, clear):
        def f(db):
            d = self._dn(dn)
            m = ldb.Message(d)
            n = 0
            for flag, group in ((ldb.FLAG_MOD_REPLACE, set_), (ldb.FLAG_MOD_ADD, add), (ldb.FLAG_MOD_DELETE, remove)):
                for a, vs in group.items():
                    m.add(ldb.MessageElement([parse_value(v) for v in _as_list(vs)], flag, a))
                    n += 1
            for a in clear:
                m.add(ldb.MessageElement([], ldb.FLAG_MOD_DELETE, str(a)))
                n += 1
            if n == 0:
                raise bad("nothing to change")
            if any(a.lower() == "ntsecuritydescriptor" for a in list(set_) + list(add)):
                db.modify(m, controls=["sd_flags:1:15"])
            else:
                db.modify(m)
        self._run(f)
        return self.ad_get(dn)

    def ad_move(self, dn, new_parent, new_rdn):
        def f(db):
            old = self._dn(dn)
            if new_rdn:
                r = ldb.Dn(db, new_rdn)
                if not r.is_valid() or len(r) != 1:
                    raise bad("newRdn must be a single RDN")
            else:
                r = ldb.Dn(db, str(old))
                r.remove_base_components(len(old) - 1)
            nd = ldb.Dn(db, str(r))
            nd.add_base(self._dn(new_parent))
            db.rename(old, nd)
            return str(nd)
        return self._run(f)

    def ad_delete(self, dn, recursive, force):
        def f(db):
            d = self._dn(dn)
            if str(d).lower() == self.base_dn.lower():
                raise forbidden("refusing to delete the domain root")
            r = db.search(d, ldb.SCOPE_BASE, attrs=["isCriticalSystemObject", "systemFlags"])
            if not len(r):
                raise not_found("object not found")
            if not force:
                if _first(r[0], "isCriticalSystemObject", "FALSE").upper() == "TRUE":
                    raise forbidden("critical system object; pass force=true to delete anyway")
                if sddlmod.is_protected_from_deletion(self._read_sd(db, d)):
                    raise forbidden("object is protected from accidental deletion; pass force=true")
            controls = ["tree_delete:1"] if recursive else []
            db.delete(d, controls)
        self._run(f)

    def _user_filter(self, dn):
        return f"(&(objectClass=user)(distinguishedName={esc(str(self._dn(dn)))}))"

    def ad_set_password(self, dn, password, must_change):
        if not isinstance(password, str) or not password:
            raise bad("password is required")

        def f(db):
            try:
                db.setpassword(self._user_filter(dn), password, force_change_at_next_login=must_change)
            except ldb.LdbError as e:
                if e.args[0] in (ldb.ERR_CONSTRAINT_VIOLATION, ldb.ERR_UNWILLING_TO_PERFORM):
                    raise bad("password does not meet the domain password policy")
                raise
            except Exception as e:  # samba raises plain Exception for "unable to find user"
                raise not_found(str(e))
        self._run(f)

    def ad_enable(self, dn, enabled):
        def f(db):
            flt = self._user_filter(dn)
            try:
                db.enable_account(flt) if enabled else db.disable_account(flt)
            except ldb.LdbError:
                raise
            except Exception as e:  # noqa: BLE001
                raise not_found(str(e))
        self._run(f)

    def ad_unlock(self, dn):
        def f(db):
            m = ldb.Message(self._dn(dn))
            m["lockoutTime"] = ldb.MessageElement("0", ldb.FLAG_MOD_REPLACE, "lockoutTime")
            db.modify(m)
        self._run(f)

    def ad_group_members(self, group_dn, add, remove):
        def f(db):
            g = self._dn(group_dn)
            for flag, items in ((ldb.FLAG_MOD_ADD, add), (ldb.FLAG_MOD_DELETE, remove)):
                for x in items:
                    m = ldb.Message(g)
                    m["member"] = ldb.MessageElement(str(self._dn(x)), flag, "member")
                    try:
                        db.modify(m)
                    except ldb.LdbError as e:
                        # already a member / not a member: treat as done
                        if e.args[0] in (ldb.ERR_ENTRY_ALREADY_EXISTS, ldb.ERR_ATTRIBUTE_OR_VALUE_EXISTS,
                                         ldb.ERR_NO_SUCH_ATTRIBUTE, ldb.ERR_UNWILLING_TO_PERFORM):
                            continue
                        raise
        self._run(f)

    # ------------------------------------------------------------------
    # GPO objects
    @property
    def policies_dn(self):
        return f"CN=Policies,CN=System,{self.base_dn}"

    GPO_ATTRS = ["name", "displayName", "flags", "versionNumber", "gPCMachineExtensionNames",
                 "gPCUserExtensionNames", "whenCreated", "whenChanged", "gPCWQLFilter", "gPCFileSysPath"]

    def _gpo_msgs(self, guid=None):
        flt = "(objectClass=groupPolicyContainer)"
        if guid:
            flt = f"(&{flt}(name={esc(guid)}))"
        return self._run(lambda db: list(db.search(self.policies_dn, ldb.SCOPE_ONELEVEL, flt, self.GPO_ATTRS)))

    def _gpo_meta(self, guid):
        r = self._gpo_msgs(guid)
        if not r:
            return None
        m = r[0]
        return {"dn": str(m.dn), "displayName": _first(m, "displayName", ""),
                "versionNumber": int(_first(m, "versionNumber", "0")),
                "machineExt": _first(m, "gPCMachineExtensionNames", ""),
                "userExt": _first(m, "gPCUserExtensionNames", "")}

    def _gpo_meta_update(self, guid, version=None, machineExt=None, userExt=None):
        meta = self._gpo_meta(guid)

        def f(db):
            m = ldb.Message(ldb.Dn(db, meta["dn"]))
            if version is not None:
                m["versionNumber"] = ldb.MessageElement(str(version), ldb.FLAG_MOD_REPLACE, "versionNumber")
            if machineExt is not None:
                m["gPCMachineExtensionNames"] = ldb.MessageElement(machineExt or [], ldb.FLAG_MOD_REPLACE,
                                                                   "gPCMachineExtensionNames")
            if userExt is not None:
                m["gPCUserExtensionNames"] = ldb.MessageElement(userExt or [], ldb.FLAG_MOD_REPLACE,
                                                                "gPCUserExtensionNames")
            if len(m) > 0:
                db.modify(m)
        self._run(f)

    def _all_links(self) -> dict[str, list[dict]]:
        """guid -> [{"target","enabled","enforced","order"}] across the
        domain partition and sites."""
        def f(db):
            res = list(db.search(self.base_dn, ldb.SCOPE_SUBTREE, "(gPLink=*)", ["gPLink"]))
            try:
                res += list(db.search(f"CN=Sites,{self.config_dn}", ldb.SCOPE_SUBTREE, "(gPLink=*)", ["gPLink"]))
            except ldb.LdbError:
                pass
            return res
        out: dict[str, list] = {}
        for m in self._run(f):
            for l in gpt.links_with_order(gpt.parse_gplink(_first(m, "gPLink", ""))):
                if l["guid"]:
                    out.setdefault(l["guid"], []).append({"target": str(m.dn), "enabled": l["enabled"],
                                                          "enforced": l["enforced"], "order": l["order"]})
        return out

    def _gpo_public(self, m, links):
        guid = _first(m, "name").upper()
        flags = int(_first(m, "flags", "0")) & 3
        ver = int(_first(m, "versionNumber", "0"))
        u, c = gpt.split_version(ver)
        wmi = _first(m, "gPCWQLFilter")
        return {"id": public_id(guid), "displayName": _first(m, "displayName", ""),
                "status": gpt.STATUS_BY_FLAGS[flags],
                "created": iso(parse_generalized_time(_first(m, "whenCreated", ""))),
                "modified": iso(parse_generalized_time(_first(m, "whenChanged", ""))),
                "wmiFilter": wmi or None, "version": ver, "userVersion": u, "computerVersion": c,
                "comment": self._read_comment(guid), "links": links.get(guid, [])}

    def _read_comment(self, guid):
        try:
            p = ci_path(self.gpo_dir(guid), "GPO.cmt")
            with open(p, "rb") as f:
                data = f.read()
            for enc in ("utf-16", "utf-8"):
                try:
                    return data.decode(enc).strip("﻿\x00").strip()
                except UnicodeDecodeError:
                    continue
        except (OSError, ApiError):
            pass
        return None

    def _write_comment(self, guid, comment):
        p = os.path.join(self.gpo_dir(guid), "GPO.cmt")
        if comment:
            with open(p, "wb") as f:
                f.write(b"\xff\xfe" + str(comment).encode("utf-16-le"))
            self._after_sysvol_write(p)
        elif os.path.exists(p):
            os.remove(p)

    def gpo_list(self):
        links = self._all_links()
        out = [self._gpo_public(m, links) for m in self._gpo_msgs()]
        return sorted(out, key=lambda g: g["displayName"].lower())

    def gpo_get(self, gpo_id, with_permissions=False):
        guid = norm_guid(gpo_id)
        r = self._gpo_msgs(guid)
        if not r:
            raise not_found("GPO not found")
        g = self._gpo_public(r[0], self._all_links())
        if with_permissions:
            g["permissions"] = self._gpo_permissions(str(r[0].dn))
        return g

    def find_gpo_by_name(self, name):
        r = self._run(lambda db: list(db.search(self.policies_dn, ldb.SCOPE_ONELEVEL,
                                                f"(&(objectClass=groupPolicyContainer)(displayName={esc(name)}))",
                                                ["name"])))
        return _first(r[0], "name").upper() if r else None

    # samba-tool with the service account credentials -----------------
    def _cred_args(self, command: str) -> list[str]:
        if not os.path.exists(self.auth_file):
            return []
        if command.startswith("gpo "):
            return ["-H", f"ldap://{self.fqdn}", "-A", self.auth_file]
        return ["-A", self.auth_file]

    def _tool(self, words: list[str], extra: list[str]) -> dict:
        command = " ".join(words)
        argv = ["samba-tool"] + words + extra + self._cred_args(command)
        r = sambatool.run(argv)
        return r

    def gpo_create(self, name, comment=None):
        if not isinstance(name, str) or not 1 <= len(name) <= 255 or any(ord(c) < 32 for c in name):
            raise bad("name must be 1 to 255 printable characters")
        if self.find_gpo_by_name(name):
            raise conflict("a GPO with that name already exists")
        r = self._tool(["gpo", "create"], [name])
        m = re.search(r"\{[0-9A-Fa-f-]{36}\}", r["stdout"] + r["stderr"])
        if r["exitCode"] != 0 or not m:
            raise ApiError("internal", "samba-tool gpo create failed: " + (r["stderr"] or r["stdout"])[-500:])
        guid = m.group(0).upper()
        try:
            self._sync_gpo_fs_acl(guid)
        except Exception:  # noqa: BLE001 - GPO works anyway; sysvolreset can fix ACLs later
            pass
        if comment:
            self._write_comment(guid, comment)
        return self.gpo_get(guid)

    def gpo_update(self, gpo_id, display_name, status, comment):
        guid = norm_guid(gpo_id)
        meta = self._gpo_meta(guid)
        if not meta:
            raise not_found("GPO not found")

        def f(db):
            m = ldb.Message(ldb.Dn(db, meta["dn"]))
            if display_name is not None:
                if not isinstance(display_name, str) or not display_name.strip():
                    raise bad("displayName must be a non empty string")
                m["displayName"] = ldb.MessageElement(display_name, ldb.FLAG_MOD_REPLACE, "displayName")
            if status is not None:
                m["flags"] = ldb.MessageElement(str(gpt.FLAGS_BY_STATUS[status]), ldb.FLAG_MOD_REPLACE, "flags")
            if len(m):
                db.modify(m)
        if display_name is not None:
            other = self.find_gpo_by_name(display_name)
            if other and other != guid:
                raise conflict("a GPO with that name already exists")
        self._run(f)
        if comment is not None:
            self._write_comment(guid, comment)
        return self.gpo_get(guid)

    def gpo_delete(self, gpo_id):
        guid = norm_guid(gpo_id)
        if not self._gpo_meta(guid):
            raise not_found("GPO not found")
        for l in self._all_links().get(guid, []):
            self.gpo_delete_link(guid, l["target"])
        r = self._tool(["gpo", "del"], [guid])
        if r["exitCode"] != 0:
            raise ApiError("internal", "samba-tool gpo del failed: " + (r["stderr"] or r["stdout"])[-500:])

    def _link_container(self, db, target):
        d = self._dn(target)
        r = db.search(d, ldb.SCOPE_BASE, attrs=["gPLink", "objectClass"])
        if not len(r):
            raise not_found("link target not found")
        ocs = {v.decode().lower() for v in _vals(r[0]["objectClass"])}
        if not ocs & {"organizationalunit", "domaindns", "site", "domain"}:
            raise bad("GPOs can only be linked to the domain, an OU or a site")
        return r[0]

    def gpo_set_link(self, gpo_id, target, enabled, enforced, order, create):
        guid = norm_guid(gpo_id)
        meta = self._gpo_meta(guid)
        if not meta:
            raise not_found("GPO not found")

        def f(db):
            c = self._link_container(db, target)
            links = gpt.parse_gplink(_first(c, "gPLink", ""))
            cur = next((l for l in gpt.links_with_order(links) if l["guid"] == guid), None)
            if cur is None and not create:
                raise not_found("this GPO is not linked to the target")
            en = cur["enabled"] if (enabled is None and cur) else (True if enabled is None else bool(enabled))
            enf = cur["enforced"] if (enforced is None and cur) else bool(enforced)
            new = gpt.set_link(links, meta["dn"], en, enf, order)
            m = ldb.Message(c.dn)
            m["gPLink"] = ldb.MessageElement(gpt.format_gplink(new), ldb.FLAG_MOD_REPLACE, "gPLink")
            db.modify(m)
        self._run(f)
        return self.gpo_get(guid)

    def gpo_delete_link(self, gpo_id, target):
        guid = norm_guid(gpo_id)

        def f(db):
            c = self._link_container(db, target)
            links = gpt.parse_gplink(_first(c, "gPLink", ""))
            new = gpt.remove_link(links, guid)
            if len(new) == len(links):
                raise not_found("this GPO is not linked to the target")
            m = ldb.Message(c.dn)
            m["gPLink"] = ldb.MessageElement(gpt.format_gplink(new) or [], ldb.FLAG_MOD_REPLACE, "gPLink")
            db.modify(m)
        self._run(f)

    def gpo_set_inheritance(self, target, blocked):
        def f(db):
            c = self._link_container(db, target)
            m = ldb.Message(c.dn)
            m["gPOptions"] = ldb.MessageElement("1" if blocked else "0", ldb.FLAG_MOD_REPLACE, "gPOptions")
            db.modify(m)
        self._run(f)

    # permissions -------------------------------------------------------
    def _sid_name(self, db, sid):
        if sid in sddlmod.WELL_KNOWN.values():
            for n, s in WELL_KNOWN_TRUSTEES.items():
                if s == sid:
                    return n.title()
        try:
            r = db.search(self.base_dn, ldb.SCOPE_SUBTREE, f"(objectSid={esc(sid)})", ["sAMAccountName"])
            if len(r):
                return f"{self.netbios}\\{_first(r[0], 'sAMAccountName')}"
            r = db.search(f"CN=WellKnown Security Principals,{self.config_dn}", ldb.SCOPE_ONELEVEL,
                          f"(objectSid={esc(sid)})", ["cn"])
            if len(r):
                return _first(r[0], "cn")
            r = db.search(f"CN=Builtin,{self.base_dn}", ldb.SCOPE_ONELEVEL, f"(objectSid={esc(sid)})",
                          ["sAMAccountName"])
            if len(r):
                return f"BUILTIN\\{_first(r[0], 'sAMAccountName')}"
        except ldb.LdbError:
            pass
        return sid

    def _gpo_permissions(self, gpo_dn):
        def f(db):
            perms = sddlmod.gpo_permissions(self._read_sd(db, ldb.Dn(db, gpo_dn)), self.domain_sid)
            return [{"trustee": self._sid_name(db, p["sid"]), "sid": p["sid"], "permission": p["permission"],
                     "denied": p["denied"]} for p in perms]
        return self._run(f)

    def _resolve_trustee(self, db, trustee, ttype):
        t = trustee.strip()
        if t.upper().startswith("S-1-"):
            return t.upper()
        if t.lower() in WELL_KNOWN_TRUSTEES:
            return WELL_KNOWN_TRUSTEES[t.lower()]
        name = t.split("\\")[-1]
        if ttype == "Computer" and not name.endswith("$"):
            name += "$"
        r = db.search(self.base_dn, ldb.SCOPE_SUBTREE, f"(sAMAccountName={esc(name)})", ["objectSid"])
        if not len(r):
            raise not_found(f"trustee {trustee!r} not found")
        return str(ndr_unpack(security.dom_sid, r[0]["objectSid"][0]))

    def gpo_set_permission(self, gpo_id, trustee, trustee_type, permission, replace):
        guid = norm_guid(gpo_id)
        meta = self._gpo_meta(guid)
        if not meta:
            raise not_found("GPO not found")

        def f(db):
            dn = ldb.Dn(db, meta["dn"])
            sid = self._resolve_trustee(db, trustee, trustee_type)
            new = sddlmod.set_gpo_permission(self._read_sd(db, dn), sid, permission, replace, self.domain_sid)
            self._write_sd(db, dn, new)
        self._run(f)
        self._sync_gpo_fs_acl(guid)
        return self.gpo_get(guid, with_permissions=True)

    def _sync_gpo_fs_acl(self, guid, ds_sddl=None):
        """Set the SYSVOL folder of a GPO, and everything in it, to the
        filesystem form of the GPO object's DACL. This is the exact ACL
        "samba-tool ntacl sysvolcheck" expects."""
        root = self.gpo_dir(guid)
        if ds_sddl is None:
            meta = self._gpo_meta(guid)
            ds_sddl = self._run(lambda db: self._read_sd(db, ldb.Dn(db, meta["dn"]), 7))
        fs = self._nt.dsacl_to_fs(ds_sddl)
        self._setntacl(root, fs)
        for dirpath, dirnames, filenames in os.walk(root):
            for n in dirnames + filenames:
                self._setntacl(os.path.join(dirpath, n), fs)

    _GPO_PATH_RE = re.compile(r"[\\/]Policies[\\/](\{[0-9A-Fa-f-]{36}\})(?:[\\/]|$)")

    # ACL helpers --------------------------------------------------------
    @property
    def _nt(self):
        if getattr(self, "_ntacl", None) is None:
            from .ntacl import NtAcl
            self._ntacl = NtAcl(self.lp, self.domain_sid)
        return self._ntacl

    def _getntacl(self, path):
        return self._nt.get(path)

    def _setntacl(self, path, sddl_text):
        self._nt.set(path, sddl_text)

    def _after_sysvol_write(self, path, kind="gpo"):
        """Give a file the NT ACL it would inherit from its parent folder,
        so clients see the same permissions as for files copied over SMB."""
        try:
            m = self._GPO_PATH_RE.search(path[len(self.sysvol_domain_dir):])
            if m:
                guid = m.group(1).upper()
                meta = self._gpo_meta(guid)
                ds = self._run(lambda db: self._read_sd(db, ldb.Dn(db, meta["dn"]), 7))
                fs = self._nt.dsacl_to_fs(ds)
                # parent folders created on the way get the same ACL
                d = os.path.dirname(path)
                gdir = self.gpo_dir(guid)
                while len(d) > len(gdir):
                    self._setntacl(d, fs)
                    d = os.path.dirname(d)
                self._setntacl(path, fs)
            else:
                self._nt.inherit(path)
        except Exception as e:  # noqa: BLE001
            # Fall back to tight POSIX permissions; "samba-tool ntacl sysvolreset" fixes the rest.
            self._acl_warn = f"{path}: {e}"
            try:
                os.chmod(path, 0o700 if os.path.isdir(path) else (0o600 if kind == "wifi" else 0o644))
            except OSError:
                pass

    # backups --------------------------------------------------------------
    def gpo_backup(self, gpo_id):
        guid = norm_guid(gpo_id)
        meta = self._gpo_meta(guid)
        if not meta:
            raise not_found("GPO not found")
        stamp = utcnow().strftime("%Y%m%dT%H%M%SZ")
        bid = f"{public_id(guid)}-{stamp}-{uuid.uuid4().hex[:6]}"
        dest = os.path.join(self.backup_dir, bid)
        os.makedirs(dest, mode=0o700)
        shutil.copytree(self.gpo_dir(guid), os.path.join(dest, "files"))
        g = self.gpo_get(guid)
        with open(os.path.join(dest, "backup.json"), "w", encoding="utf-8") as f:
            json.dump({"backupId": bid, "gpoId": g["id"], "displayName": g["displayName"], "created": iso(utcnow()),
                       "status": g["status"], "machineExt": meta["machineExt"], "userExt": meta["userExt"],
                       "comment": g.get("comment")}, f, indent=2)
        # Also keep a native samba-tool backup for use with "samba-tool gpo restore".
        native = os.path.join(dest, "samba-tool")
        os.makedirs(native, mode=0o700)
        r = self._tool(["gpo", "backup"], [guid, f"--tmpdir={native}"])
        if r["exitCode"] != 0:
            with open(os.path.join(native, "ERROR.txt"), "w", encoding="utf-8") as f:
                f.write(r["stderr"] or r["stdout"])
        return {"backupId": bid, "path": dest}

    def gpo_backups(self):
        out = []
        try:
            names = sorted(os.listdir(self.backup_dir), reverse=True)
        except FileNotFoundError:
            return out
        for n in names:
            try:
                with open(os.path.join(self.backup_dir, n, "backup.json"), encoding="utf-8") as f:
                    meta = json.load(f)
                out.append({"backupId": n, "gpoId": meta.get("gpoId"), "displayName": meta.get("displayName"),
                            "created": meta.get("created")})
            except (OSError, ValueError):
                continue
        return out

    def _backup_path(self, bid):
        if not valid_id(bid, BACKUP_ID_RE):
            raise bad("bad backupId")
        p = os.path.join(self.backup_dir, bid)
        if not os.path.isfile(os.path.join(p, "backup.json")):
            raise not_found("backup not found")
        with open(os.path.join(p, "backup.json"), encoding="utf-8") as f:
            return p, json.load(f)

    def gpo_restore(self, gpo_id, backup_id):
        guid = norm_guid(gpo_id)
        meta = self._gpo_meta(guid)
        if not meta:
            raise not_found("GPO not found")
        path, bmeta = self._backup_path(backup_id)
        gdir = self.gpo_dir(guid)
        src = os.path.join(path, "files")
        with self._gpo_lock:
            # Replace Machine and User contents; keep GPT.INI version moving forward.
            for side in ("Machine", "User"):
                dst = ci_path(gdir, side)
                if os.path.isdir(dst):
                    shutil.rmtree(dst)
                s = ci_path(src, side)
                if os.path.isdir(s):
                    shutil.copytree(s, dst)
                else:
                    os.makedirs(dst)
            for extra in ("GPO.cmt",):
                s = ci_path(src, extra)
                if os.path.isfile(s):
                    shutil.copy2(s, os.path.join(gdir, extra))
            self._sync_gpo_fs_acl(guid)
            new_ver = gpt.bump_version(gpt.bump_version(meta["versionNumber"], machine=True, user=True))
            ini = ci_path(gdir, "GPT.INI")
            try:
                with open(ini, encoding="utf-8", errors="replace", newline="") as f:
                    text = f.read()
            except FileNotFoundError:
                text = ""
            with open(ini, "w", encoding="utf-8", newline="") as f:
                f.write(gpt.set_gpt_ini_version(text, new_ver))
            self._after_sysvol_write(ini)
            self._gpo_meta_update(guid, version=new_ver, machineExt=bmeta.get("machineExt") or "",
                                  userExt=bmeta.get("userExt") or "")
            if bmeta.get("status") in gpt.FLAGS_BY_STATUS:
                self.gpo_update(guid, None, bmeta["status"], None)
        return self.gpo_get(guid)

    def gpo_import(self, backup_id, target_name, create):
        self._backup_path(backup_id)
        guid = self.find_gpo_by_name(target_name)
        if not guid:
            if not create:
                raise not_found("target GPO not found")
            guid = norm_guid(self.gpo_create(target_name)["id"])
        return self.gpo_restore(guid, backup_id)

    # samba-tool ------------------------------------------------------------
    def sambatool_invoke(self, command, args, confirm):
        command = " ".join(command.split())
        argv = sambatool.build_argv(command, args, confirm, cred_args=self._cred_args(command))
        return sambatool.run(argv)
