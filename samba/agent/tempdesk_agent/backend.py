"""Backend interface and the SYSVOL file logic shared by every backend.

The HTTP layer (server.py) and the application logic (app.py) only talk to
a Backend. SambaBackend (samba_backend.py) implements it on a real Samba AD
DC; FakeBackend (fake.py) keeps everything in memory plus a temporary
SYSVOL folder for tests and local development.
"""

from __future__ import annotations

import datetime as dt
import os
import re
import threading
import xml.etree.ElementTree as ET

from . import admx as admxmod
from . import gpt, preg, secinf
from .errors import ApiError, bad, not_found
from .util import (WIFI_ID_RE, html_escape, iso, valid_id, valid_script_name,
                   xml_escape)

GUID_RE = re.compile(r"^\{?([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}?$")

RESTRICT_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
RESTRICT_RUN_LIST = RESTRICT_RUN_KEY + r"\RestrictRun"

ALL_CAPABILITIES = ["guest", "directory", "gpo", "gpo-registry", "gpo-permissions", "gpo-backup",
                    "admx", "security", "samba-tool", "wifi", "scripts", "allowlist", "audit",
                    # Full Group Policy editor: the file-backed nodes the Samba
                    # backend serves. AD-object nodes (wireless/wired, deployed
                    # printers, software installation, IP security) are listed
                    # in the tree with an unavailable reason rather than here.
                    "gpo-editor", "gpo-security-full", "gpo-advanced-audit", "gpo-firewall",
                    "gpo-scripts-full", "gpo-folder-redirection", "gpo-nrpt", "gpo-qos",
                    "gpo-srp", "gpo-applocker", "gpo-preferences-full"]


def norm_guid(gpo_id: str) -> str:
    m = GUID_RE.match((gpo_id or "").strip())
    if not m:
        raise bad("GPO id must be a GUID")
    return "{" + m.group(1).upper() + "}"


def public_id(guid: str) -> str:
    return guid.strip("{}").lower()


def unsupported(what: str) -> ApiError:
    return ApiError("not_found", f"{what} is not supported by the Samba backend")


def ci_path(root: str, rel: str) -> str:
    """Resolve rel under root, matching existing components case
    insensitively (SYSVOL is case insensitive for SMB clients)."""
    cur = root
    for part in [p for p in re.split(r"[\\/]+", rel) if p]:
        if part in (".", ".."):
            raise bad("bad path")
        cand = os.path.join(cur, part)
        if not os.path.exists(cand) and os.path.isdir(cur):
            low = part.lower()
            for n in os.listdir(cur):
                if n.lower() == low:
                    cand = os.path.join(cur, n)
                    break
        cur = cand
    return cur


class Backend:
    """Interface. Every method raises ApiError on failure."""

    name = "abstract"

    # --- info / auth ---------------------------------------------------
    def info(self) -> dict: raise NotImplementedError
    def capabilities(self) -> list[str]: return list(ALL_CAPABILITIES)
    def check_password(self, username: str, password: str) -> dict | None:
        """Validate credentials. Returns {"sam","displayName","dn"} or None."""
        raise NotImplementedError
    def is_member_recursive(self, sam: str, group_name: str) -> bool: raise NotImplementedError

    # --- guests --------------------------------------------------------
    def guest_ou_dn(self) -> str: raise NotImplementedError
    def create_guest(self, sam, password, display_name, expires, info_json, group_name) -> dict:
        raise NotImplementedError
    def find_guest(self, sam: str) -> dict | None: raise NotImplementedError
    def list_guests(self) -> list[dict]: raise NotImplementedError
    def count_guests(self) -> int: return len(self.list_guests())
    def delete_guest(self, sam: str) -> None: raise NotImplementedError
    def set_guest_expiry(self, sam: str, expires) -> dict: raise NotImplementedError
    def username_exists(self, sam: str) -> bool: raise NotImplementedError

    # --- directory -----------------------------------------------------
    def ad_tree(self, dn): raise unsupported("directory")
    def ad_search(self, base, flt, scope, attrs, limit): raise unsupported("directory")
    def ad_get(self, dn): raise unsupported("directory")
    def ad_create(self, parent_dn, object_class, rdn, attributes): raise unsupported("directory")
    def ad_modify(self, dn, set_, add, remove, clear): raise unsupported("directory")
    def ad_move(self, dn, new_parent, new_rdn): raise unsupported("directory")
    def ad_delete(self, dn, recursive, force): raise unsupported("directory")
    def ad_set_password(self, dn, password, must_change): raise unsupported("directory")
    def ad_enable(self, dn, enabled): raise unsupported("directory")
    def ad_unlock(self, dn): raise unsupported("directory")
    def ad_group_members(self, group_dn, add, remove): raise unsupported("directory")

    # --- gpo objects ---------------------------------------------------
    def gpo_list(self): raise unsupported("gpo")
    def gpo_get(self, gpo_id, with_permissions=False): raise unsupported("gpo")
    def gpo_create(self, name, comment): raise unsupported("gpo")
    def gpo_update(self, gpo_id, display_name, status, comment): raise unsupported("gpo")
    def gpo_delete(self, gpo_id): raise unsupported("gpo")
    def gpo_set_link(self, gpo_id, target, enabled, enforced, order, create): raise unsupported("gpo")
    def gpo_delete_link(self, gpo_id, target): raise unsupported("gpo")
    def gpo_set_inheritance(self, target, blocked): raise unsupported("gpo")
    def gpo_set_permission(self, gpo_id, trustee, trustee_type, permission, replace): raise unsupported("gpo-permissions")
    def gpo_backup(self, gpo_id): raise unsupported("gpo-backup")
    def gpo_backups(self): raise unsupported("gpo-backup")
    def gpo_restore(self, gpo_id, backup_id): raise unsupported("gpo-backup")
    def gpo_import(self, backup_id, target_name, create): raise unsupported("gpo-backup")
    def find_gpo_by_name(self, name: str) -> str | None: raise NotImplementedError

    # --- samba-tool ----------------------------------------------------
    def sambatool_invoke(self, command, args, confirm): raise unsupported("samba-tool")

    # --- maintenance ---------------------------------------------------
    def reap_expired(self, now: dt.datetime) -> list[str]: raise NotImplementedError


class SysvolMixin:
    """GPO file editing in SYSVOL plus TempDesk SYSVOL folders.

    Subclasses provide:
      sysvol_domain_dir: <sysvol>/<realm lower>
      _gpo_meta(guid) -> {"versionNumber","machineExt","userExt","displayName"} or None
      _gpo_meta_update(guid, version=None, machineExt=None, userExt=None)
      _after_sysvol_write(path, kind)  (fix ACLs on Samba; no-op in tests)
    """

    sysvol_domain_dir: str = ""
    _gpo_lock = threading.RLock()

    # -- paths --------------------------------------------------------
    def gpo_dir(self, guid: str) -> str:
        d = ci_path(os.path.join(self.sysvol_domain_dir, "Policies"), guid)
        if not os.path.isdir(d):
            raise not_found(f"GPO folder for {guid} not found in SYSVOL")
        return d

    def tempdesk_dir(self, *parts) -> str:
        return os.path.join(self.sysvol_domain_dir, "TempDesk", *parts)

    def admx_dir(self) -> str:
        return ci_path(self.sysvol_domain_dir, "Policies/PolicyDefinitions")

    def _after_sysvol_write(self, path: str, kind: str = "gpo") -> None:
        pass

    def _admx_store(self):
        st = getattr(self, "_admx_cache", None)
        d = self.admx_dir()
        if st is None or st.root != d:
            st = admxmod.AdmxStore(d)
            self._admx_cache = st
        return st

    # -- versions / CSE -------------------------------------------------
    def _bump(self, guid: str, machine=False, user=False, cse_pairs=()):
        meta = self._gpo_meta(guid)
        if meta is None:
            raise not_found("GPO not found")
        gdir = self.gpo_dir(guid)
        ini_path = ci_path(gdir, "GPT.INI")
        try:
            with open(ini_path, "r", encoding="utf-8", errors="replace", newline="") as f:
                ini = f.read()
        except FileNotFoundError:
            ini = ""
        base = max(int(meta.get("versionNumber") or 0), gpt.read_gpt_ini_version(ini))
        new = gpt.bump_version(base, machine=machine, user=user)
        mext, uext = meta.get("machineExt") or "", meta.get("userExt") or ""
        for side, cse, tool in cse_pairs:
            if side == "Machine":
                mext = gpt.merge_cse(mext, cse, tool)
            else:
                uext = gpt.merge_cse(uext, cse, tool)
        with open(ini_path, "w", encoding="utf-8", newline="") as f:
            f.write(gpt.set_gpt_ini_version(ini, new))
        self._gpo_meta_update(guid, version=new,
                              machineExt=mext if mext != (meta.get("machineExt") or "") else None,
                              userExt=uext if uext != (meta.get("userExt") or "") else None)
        self._after_sysvol_write(ini_path)
        return new

    # -- Registry.pol -----------------------------------------------------
    def _pol_path(self, guid: str, side: str) -> str:
        return ci_path(self.gpo_dir(guid), f"{side}/Registry.pol")

    def load_pol(self, guid: str, side: str) -> preg.PolFile:
        return preg.PolFile.load(self._pol_path(guid, side))

    def save_pol(self, guid: str, side: str, pol: preg.PolFile) -> None:
        path = self._pol_path(guid, side)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tdtmp"
        with open(tmp, "wb") as f:
            f.write(pol.to_bytes())
        os.replace(tmp, path)
        self._after_sysvol_write(path)
        tool = gpt.REGISTRY_TOOL_MACHINE if side == "Machine" else gpt.REGISTRY_TOOL_USER
        self._bump(guid, machine=side == "Machine", user=side == "User",
                   cse_pairs=[(side, gpt.REGISTRY_CSE, tool)])

    def gpo_registry_get(self, gpo_id: str, key: str | None):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        sides = []
        if key:
            side, rel = preg.split_hive(key)
            sides = [(side, rel)]
        else:
            sides = [("Machine", ""), ("User", "")]
        out = []
        for side, rel in sides:
            pol = self.load_pol(guid, side)
            for e in pol.under(rel, recursive=True):
                vn = e.value_name
                state = "Set"
                low = vn.lower()
                if low.startswith("**del."):
                    vn, state = vn[6:], "Delete"
                elif low.startswith("**delvals."):
                    vn, state = "", "Delete"
                elif low.startswith("**"):
                    state = "Delete"
                out.append({"key": preg.join_hive(side, e.key), "valueName": vn,
                            "type": preg.TYPE_NAMES.get(e.type, str(e.type)),
                            "value": None if state == "Delete" else e.decoded(),
                            "policyState": state})
        return out

    def gpo_registry_set(self, gpo_id: str, key: str, value_name: str, type_name: str, value):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        if not key:
            raise bad("key is required")
        if value_name is None:
            value_name = ""
        if not isinstance(value_name, str) or len(value_name) > 255:
            raise bad("valueName must be a string")
        try:
            side, rel = preg.split_hive(key)
            t = preg.type_from_name(type_name)
            data = preg.encode_value(t, value)
        except (preg.PolError, ValueError, TypeError) as e:
            raise bad(str(e))
        if not rel:
            raise bad("key needs a path below the hive")
        with self._gpo_lock:
            pol = self.load_pol(guid, side)
            pol.set(rel, value_name, t, data)
            self.save_pol(guid, side, pol)
        return {"key": preg.join_hive(side, rel), "valueName": value_name,
                "type": preg.TYPE_NAMES[t], "value": preg.decode_value(t, data), "policyState": "Set"}

    def gpo_registry_delete(self, gpo_id: str, key: str, value_name: str | None):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        try:
            side, rel = preg.split_hive(key or "")
        except preg.PolError as e:
            raise bad(str(e))
        with self._gpo_lock:
            pol = self.load_pol(guid, side)
            n = pol.remove(rel, value_name if value_name else None, recursive=not value_name)
            if n == 0:
                raise not_found("no matching registry value in this GPO")
            self.save_pol(guid, side, pol)

    def _require_gpo(self, guid: str):
        if self._gpo_meta(guid) is None:
            raise not_found("GPO not found")

    # -- security (GptTmpl.inf) -------------------------------------------
    def gpo_security_get(self, gpo_id: str):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        path = ci_path(self.gpo_dir(guid), secinf.PATH)
        try:
            with open(path, "rb") as f:
                sections = secinf.parse(secinf.decode(f.read()))
        except FileNotFoundError:
            sections = {}
        return {"sections": {k: v for k, v in sections.items() if k not in secinf.KEEP_SECTIONS}}

    def gpo_security_put(self, gpo_id: str, sections):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        if not isinstance(sections, dict):
            raise bad("sections must be an object")
        path = ci_path(self.gpo_dir(guid), secinf.PATH)
        with self._gpo_lock:
            try:
                with open(path, "rb") as f:
                    original = secinf.parse(secinf.decode(f.read()))
            except FileNotFoundError:
                original = {}
            try:
                text = secinf.render(sections, original)
            except ValueError as e:
                raise bad(str(e))
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(secinf.encode(text))
            self._after_sysvol_write(path)
            self._bump(guid, machine=True, cse_pairs=[("Machine", gpt.SECURITY_CSE, gpt.SECURITY_TOOL)])
        return self.gpo_security_get(gpo_id)

    # -- ADMX -------------------------------------------------------------
    def admx_categories(self):
        return self._admx_store().list_categories()

    def admx_policies(self, category, q, klass):
        return self._admx_store().list_policies(category, q, klass)

    def admx_stats(self):
        st = self._admx_store()
        st.ensure_loaded()
        return {"files": st.files_parsed, "categories": len(st.categories),
                "policies": len(st.policies), "languages": st.languages(),
                "parseWarnings": st.warnings, "store": st.root}

    def _admx_side(self, p: dict, klass: str | None) -> str:
        pc = p["class"]
        if pc in ("Machine", "User"):
            if klass and klass not in (pc, "Both"):
                raise bad(f"policy class is {pc}")
            return pc
        if klass not in ("Machine", "User"):
            raise bad("class Machine or User is required for this policy")
        return klass

    def gpo_admx_get(self, gpo_id, policy_id, klass):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        p = self._admx_store().get(policy_id)
        if not p:
            raise not_found("policy not found in the central store")
        side = self._admx_side(p, klass)
        return admxmod.read_state(p, self.load_pol(guid, side))

    def gpo_admx_put(self, gpo_id, policy_id, klass, state, values):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        p = self._admx_store().get(policy_id)
        if not p:
            raise not_found("policy not found in the central store")
        side = self._admx_side(p, klass)
        with self._gpo_lock:
            pol = self.load_pol(guid, side)
            try:
                admxmod.write_state(p, pol, state, values if isinstance(values, dict) else {})
            except (ValueError, TypeError, preg.PolError) as e:
                raise bad(str(e))
            self.save_pol(guid, side, pol)
            return admxmod.read_state(p, pol)

    # -- allowlist ---------------------------------------------------------
    def _guest_gpo(self, settings) -> str:
        guid = self.find_gpo_by_name(settings["guestGpoName"])
        if not guid:
            raise not_found(f"guest GPO {settings['guestGpoName']!r} not found")
        return guid

    def allowlist_get(self, settings):
        guid = self._guest_gpo(settings)
        pol = self.load_pol(guid, "User")
        e = pol.find(RESTRICT_RUN_KEY, "RestrictRun")
        enabled = bool(e and not e.is_delete_marker and e.decoded() == 1)
        apps = []
        for x in pol.under(RESTRICT_RUN_LIST, recursive=False):
            if not x.is_delete_marker:
                apps.append((x.value_name, x.decoded()))

        def order(item):
            try:
                return (0, int(item[0]))
            except ValueError:
                return (1, item[0])
        return {"enabled": enabled, "apps": [str(v) for _, v in sorted(apps, key=order)]}

    def allowlist_put(self, settings, enabled, apps):
        if not isinstance(apps, list) or not all(isinstance(a, str) for a in apps):
            raise bad("apps must be a list of strings")
        clean = []
        for a in apps:
            a = a.strip()
            if not a:
                continue
            if not re.match(r"^[^\\/:*?\"<>|\r\n]{1,255}$", a):
                raise bad(f"invalid executable name {a!r}")
            if a.lower() not in [c.lower() for c in clean]:
                clean.append(a)
        guid = self._guest_gpo(settings)
        with self._gpo_lock:
            pol = self.load_pol(guid, "User")
            pol.remove(RESTRICT_RUN_KEY, "RestrictRun")
            pol.remove(RESTRICT_RUN_LIST, None)
            pol.entries = [e for e in pol.entries if not (e.key.lower() == RESTRICT_RUN_LIST.lower())]
            pol.set(RESTRICT_RUN_KEY, "RestrictRun", preg.REG_DWORD,
                    preg.encode_value(preg.REG_DWORD, 1 if enabled else 0))
            pol.mark_delvals(RESTRICT_RUN_LIST)
            for i, a in enumerate(clean, 1):
                pol.set(RESTRICT_RUN_LIST, str(i), preg.REG_SZ, preg.encode_value(preg.REG_SZ, a))
            self.save_pol(guid, "User", pol)
        return self.allowlist_get(settings)

    # -- report -------------------------------------------------------------
    def gpo_report(self, gpo_id: str, fmt: str = "html") -> tuple[str, str]:
        g = self.gpo_get(gpo_id)
        regs = self.gpo_registry_get(gpo_id, None)
        sec = self.gpo_security_get(gpo_id)["sections"]
        if fmt == "xml":
            out = ['<?xml version="1.0" encoding="utf-8"?>',
                   f'<GPO id="{xml_escape(g["id"])}" displayName="{xml_escape(g["displayName"])}" '
                   f'status="{xml_escape(g["status"])}" version="{g.get("version", 0)}">']
            out.append("<Links>")
            for l in g["links"]:
                out.append(f'<Link target="{xml_escape(l["target"])}" enabled="{str(l["enabled"]).lower()}" '
                           f'enforced="{str(l["enforced"]).lower()}" order="{l["order"]}"/>')
            out.append("</Links><Registry>")
            for r in regs:
                out.append(f'<Value key="{xml_escape(r["key"])}" name="{xml_escape(r["valueName"])}" '
                           f'type="{xml_escape(r["type"])}" state="{r["policyState"]}">'
                           f'{xml_escape(r["value"] if r["value"] is not None else "")}</Value>')
            out.append("</Registry><Security>")
            for s, kv in sec.items():
                out.append(f'<Section name="{xml_escape(s)}">')
                for k, v in kv.items():
                    out.append(f'<Setting name="{xml_escape(k)}">{xml_escape(v)}</Setting>')
                out.append("</Section>")
            out.append("</Security></GPO>")
            return "application/xml; charset=utf-8", "\n".join(out)
        h = html_escape
        rows = lambda cells: "<tr>" + "".join(f"<td>{h(c)}</td>" for c in cells) + "</tr>"
        parts = [
            "<!doctype html><html><head><meta charset='utf-8'>",
            f"<title>{h(g['displayName'])}</title>",
            "<style>body{font-family:system-ui,sans-serif;margin:24px;color:#1b1b1b;background:#fff}"
            "table{border-collapse:collapse;margin:8px 0 24px;width:100%}"
            "td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;font-size:14px;vertical-align:top}"
            "th{background:#f2f2f2}h1{font-size:22px}h2{font-size:18px;margin-top:24px}</style></head><body>",
            f"<h1>{h(g['displayName'])}</h1>",
            "<table>",
            rows(["GPO id", g["id"]]), rows(["Status", g["status"]]),
            rows(["Created", g.get("created") or ""]), rows(["Modified", g.get("modified") or ""]),
            rows(["Version (user / computer)", f"{g.get('userVersion', 0)} / {g.get('computerVersion', 0)}"]),
            "</table><h2>Links</h2>",
        ]
        if g["links"]:
            parts.append("<table><tr><th>Target</th><th>Enabled</th><th>Enforced</th><th>Order</th></tr>")
            parts += [rows([l["target"], l["enabled"], l["enforced"], l["order"]]) for l in g["links"]]
            parts.append("</table>")
        else:
            parts.append("<p>Not linked.</p>")
        for side, title in (("HKLM", "Computer configuration: registry policy"),
                            ("HKCU", "User configuration: registry policy")):
            items = [r for r in regs if r["key"].startswith(side)]
            parts.append(f"<h2>{title}</h2>")
            if not items:
                parts.append("<p>No settings.</p>")
                continue
            parts.append("<table><tr><th>Key</th><th>Value name</th><th>Type</th><th>Value</th><th>State</th></tr>")
            for r in items:
                v = r["value"]
                if isinstance(v, list):
                    v = "; ".join(map(str, v))
                parts.append(rows([r["key"], r["valueName"], r["type"], "" if v is None else v, r["policyState"]]))
            parts.append("</table>")
        parts.append("<h2>Computer configuration: security settings</h2>")
        if not sec:
            parts.append("<p>No settings.</p>")
        for s, kv in sec.items():
            parts.append(f"<h3>{h(s)}</h3><table><tr><th>Setting</th><th>Value</th></tr>")
            parts += [rows([k, v]) for k, v in kv.items()]
            parts.append("</table>")
        parts.append("<p><small>Generated by the TempDesk Samba agent. Settings stored in other client "
                     "side extensions (preferences, scripts, software installation) are not shown.</small></p>")
        parts.append("</body></html>")
        return "text/html; charset=utf-8", "".join(parts)

    # -- wifi -------------------------------------------------------------
    WLAN_NS = "http://www.microsoft.com/networking/WLAN/profile/v1"

    def wifi_list(self):
        d = self.tempdesk_dir("wifi")
        out = []
        try:
            names = sorted(os.listdir(d))
        except FileNotFoundError:
            return out
        for n in names:
            if not n.lower().endswith(".xml"):
                continue
            try:
                out.append(self._wifi_parse(os.path.join(d, n), n[:-4]))
            except (ET.ParseError, OSError):
                continue
        return out

    def _wifi_parse(self, path, wid):
        ns = {"w": self.WLAN_NS}
        root = ET.parse(path).getroot()
        ssid = root.findtext("w:SSIDConfig/w:SSID/w:name", default="", namespaces=ns)
        hidden = root.findtext("w:SSIDConfig/w:nonBroadcast", default="false", namespaces=ns) == "true"
        mode = root.findtext("w:connectionMode", default="auto", namespaces=ns)
        auth = root.findtext("w:MSM/w:security/w:authEncryption/w:authentication", default="open", namespaces=ns)
        return {"id": wid, "ssid": ssid, "auth": auth if auth in ("WPA2PSK", "WPA3SAE") else "open",
                "hidden": hidden, "autoConnect": mode == "auto"}

    def wifi_put(self, wid, ssid, auth, key, hidden, auto_connect):
        if not valid_id(wid, WIFI_ID_RE):
            raise bad("id must match ^[A-Za-z0-9._-]{1,64}$")
        if not isinstance(ssid, str) or not 1 <= len(ssid.encode("utf-8")) <= 32:
            raise bad("ssid must be 1 to 32 bytes")
        if any(ord(c) < 32 for c in ssid):
            raise bad("ssid contains control characters")
        if auth not in ("WPA2PSK", "WPA3SAE", "open"):
            raise bad("auth must be WPA2PSK, WPA3SAE or open")
        path = os.path.join(self.tempdesk_dir("wifi"), wid + ".xml")
        if auth != "open":
            if key is None and os.path.exists(path):
                # keep the existing key when the portal leaves it out
                key = self._wifi_existing_key(path)
            if not isinstance(key, str) or not 8 <= len(key) <= 63 or any(ord(c) < 32 or ord(c) > 126 for c in key):
                raise bad("key must be 8 to 63 printable ASCII characters")
        x = xml_escape
        hexssid = ssid.encode("utf-8").hex().upper()
        if auth == "open":
            sec = ("<authEncryption><authentication>open</authentication><encryption>none</encryption>"
                   "<useOneX>false</useOneX></authEncryption>")
        else:
            sec = (f"<authEncryption><authentication>{auth}</authentication><encryption>AES</encryption>"
                   "<useOneX>false</useOneX></authEncryption>"
                   f"<sharedKey><keyType>passPhrase</keyType><protected>false</protected>"
                   f"<keyMaterial>{x(key)}</keyMaterial></sharedKey>")
        body = (f'<?xml version="1.0"?>\r\n<WLANProfile xmlns="{self.WLAN_NS}">'
                f"<name>{x(ssid)}</name><SSIDConfig><SSID><hex>{hexssid}</hex><name>{x(ssid)}</name></SSID>"
                f"<nonBroadcast>{'true' if hidden else 'false'}</nonBroadcast></SSIDConfig>"
                f"<connectionType>ESS</connectionType><connectionMode>{'auto' if auto_connect else 'manual'}</connectionMode>"
                f"<MSM><security>{sec}</security></MSM></WLANProfile>\r\n")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fd = os.open(path + ".tmp", os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
            f.write(body)
        os.replace(path + ".tmp", path)
        self._after_sysvol_write(path, "wifi")
        return self._wifi_parse(path, wid)

    def _wifi_existing_key(self, path):
        ns = {"w": self.WLAN_NS}
        try:
            return ET.parse(path).getroot().findtext("w:MSM/w:security/w:sharedKey/w:keyMaterial", namespaces=ns)
        except (ET.ParseError, OSError):
            return None

    def wifi_delete(self, wid):
        if not valid_id(wid, WIFI_ID_RE):
            raise bad("bad id")
        path = os.path.join(self.tempdesk_dir("wifi"), wid + ".xml")
        try:
            os.remove(path)
        except FileNotFoundError:
            raise not_found("wifi profile not found")

    # -- scripts ------------------------------------------------------------
    def _script_path(self, kind, name=None):
        if kind not in ("startup", "logon"):
            raise bad("kind must be startup or logon")
        if name is None:
            return self.tempdesk_dir("scripts", kind)
        if not valid_script_name(name):
            raise bad("name must match ^[A-Za-z0-9._-]{1,64}$ and end in .ps1 or .cmd")
        return os.path.join(self.tempdesk_dir("scripts", kind), name)

    def scripts_list(self, kind):
        kinds = [kind] if kind else ["startup", "logon"]
        out = []
        for k in kinds:
            d = self._script_path(k)
            try:
                names = sorted(os.listdir(d))
            except FileNotFoundError:
                continue
            for n in names:
                p = os.path.join(d, n)
                if os.path.isfile(p) and valid_script_name(n):
                    st = os.stat(p)
                    out.append({"name": n, "kind": k, "size": st.st_size,
                                "modified": iso(dt.datetime.fromtimestamp(st.st_mtime, dt.timezone.utc))})
        return out

    def script_get(self, kind, name):
        p = self._script_path(kind, name)
        try:
            with open(p, "rb") as f:
                data = f.read()
        except FileNotFoundError:
            raise not_found("script not found")
        if data.startswith(b"\xef\xbb\xbf"):
            data = data[3:]
        return {"content": data.decode("utf-8", errors="replace")}

    def script_put(self, kind, name, content):
        p = self._script_path(kind, name)
        if not isinstance(content, str):
            raise bad("content must be a string")
        if len(content.encode("utf-8")) > 1024 * 1024:
            raise bad("script larger than 1 MB")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        # UTF-8 with BOM keeps Windows PowerShell 5.1 happy with non ASCII text
        data = content.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8")
        if name.lower().endswith(".ps1"):
            data = b"\xef\xbb\xbf" + data
        with open(p + ".tmp", "wb") as f:
            f.write(data)
        os.replace(p + ".tmp", p)
        self._after_sysvol_write(p, "scripts")
        return {"name": name, "kind": kind, "size": len(data)}

    def script_delete(self, kind, name):
        p = self._script_path(kind, name)
        try:
            os.remove(p)
        except FileNotFoundError:
            raise not_found("script not found")
