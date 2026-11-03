"""The full Group Policy Management Editor tree and generic node CRUD for the
Samba backend, mirroring the Windows agent's GpoEditorService.

Where the storage is file based in SYSVOL (GptTmpl.inf sections, audit.csv,
Registry.pol-backed nodes, scripts.ini/psscripts.ini, GPP XML, fdeploy1.ini)
the Samba backend implements the node fully. Nodes whose storage is an AD
object (wireless/wired, deployed printers, software installation, IP
Security) are present in the tree but marked unavailable with a reason, so the
portal can show them greyed out.

The tree shape and item schemas are kept byte-for-byte compatible with the
Windows side by sharing the same node ids and schema ids.
"""

from __future__ import annotations

import datetime as dt
import os
import uuid

from . import gppxml, gpt, preg, secinf
from .backend import ci_path, norm_guid
from .errors import bad, not_found

# Nodes whose backing store is an AD object, unavailable on the file-only
# Samba editor, with the reason returned in the tree.
AD_OBJECT_NODES = {
    "machine/pol/win/sec/wired": "Wired (802.3) policies are stored as AD objects; not available on the Samba backend.",
    "machine/pol/win/sec/wireless": "Wireless (802.11) policies are stored as AD objects; not available on the Samba backend.",
    "machine/pol/win/sec/ipsec": "IP Security policies are stored as AD objects; not available on the Samba backend.",
    "machine/pol/win/printers": "Deployed Printers are stored as AD objects; not available on the Samba backend.",
    "user/pol/win/printers": "Deployed Printers are stored as AD objects; not available on the Samba backend.",
    "machine/pol/sw/install": "Software installation packages are stored as AD objects; not available on the Samba backend.",
    "user/pol/sw/install": "Software installation packages are stored as AD objects; not available on the Samba backend.",
}


def build_tree() -> list[dict]:
    """The GPME tree, Computer then User. Kept in sync with the Windows
    GpoNodes tree."""
    return [_class_tree("Machine", "machine", "Computer Configuration"),
            _class_tree("User", "user", "User Configuration")]


def _node(nid, name, kind, cls, schema=None, children=None):
    n = {"id": nid, "name": name, "kind": kind, "class": cls, "itemSchema": schema,
         "capability": None, "children": children or []}
    reason = AD_OBJECT_NODES.get(nid)
    n["available"] = reason is None
    n["unavailableReason"] = reason
    return n


def _class_tree(cls, p, label):
    pol_win = _pol_win(cls, p)
    pol_children = [
        _node(p + "/pol/sw", "Software Settings", "container", cls, None, [
            _node(p + "/pol/sw/install", "Software installation", "table", cls, "software-installation")]),
        pol_win,
    ]
    if cls == "Machine":
        pol_children.append(_node(p + "/pol/nrpt", "Name Resolution Policy", "table", cls, "nrpt-rule"))
    pol_children.append(_node(p + "/pol/admx", "Administrative Templates", "admx", cls))
    return _node(p, label, "container", cls, None, [
        _node(p + "/pol", "Policies", "container", cls, None, pol_children),
        _preferences(cls, p),
    ])


def _pol_win(cls, p):
    children = []
    if cls == "Machine":
        children.append(_node(p + "/pol/win/scripts", "Scripts (Startup/Shutdown)", "container", cls, None, [
            _node(p + "/pol/win/scripts/startup", "Startup", "script-list", cls, "script-entry"),
            _node(p + "/pol/win/scripts/shutdown", "Shutdown", "script-list", cls, "script-entry")]))
        children.append(_machine_security(p))
        children.append(_node(p + "/pol/win/qos", "Policy-based QoS", "table", cls, "qos-policy"))
        children.append(_node(p + "/pol/win/printers", "Deployed Printers", "table", cls, "deployed-printer"))
    else:
        children.append(_node(p + "/pol/win/scripts", "Scripts (Logon/Logoff)", "container", cls, None, [
            _node(p + "/pol/win/scripts/logon", "Logon", "script-list", cls, "script-entry"),
            _node(p + "/pol/win/scripts/logoff", "Logoff", "script-list", cls, "script-entry")]))
        children.append(_node(p + "/pol/win/sec", "Security Settings", "container", cls, None, [
            _node(p + "/pol/win/sec/pki", "Public Key Policies", "table", cls, "pki-trusted-cert"),
            _node(p + "/pol/win/sec/srp", "Software Restriction Policies", "table", cls, "srp-rule")]))
        children.append(_node(p + "/pol/win/qos", "Policy-based QoS", "table", cls, "qos-policy"))
        children.append(_node(p + "/pol/win/printers", "Deployed Printers", "table", cls, "deployed-printer"))
        children.append(_node(p + "/pol/win/folderredir", "Folder Redirection", "table", cls, "folder-redirection"))
    return _node(p + "/pol/win", "Windows Settings", "container", cls, None, children)


def _machine_security(p):
    s = p + "/pol/win/sec"
    return _node(s, "Security Settings", "container", "Machine", None, [
        _node(s + "/account", "Account Policies", "container", "Machine", None, [
            _node(s + "/account/password", "Password Policy", "form", "Machine", "sec-password"),
            _node(s + "/account/lockout", "Account Lockout Policy", "form", "Machine", "sec-lockout"),
            _node(s + "/account/kerberos", "Kerberos Policy", "form", "Machine", "sec-kerberos")]),
        _node(s + "/local", "Local Policies", "container", "Machine", None, [
            _node(s + "/local/audit", "Audit Policy", "form", "Machine", "sec-audit"),
            _node(s + "/local/rights", "User Rights Assignment", "table", "Machine", "sec-user-right"),
            _node(s + "/local/options", "Security Options", "table", "Machine", "sec-option")]),
        _node(s + "/eventlog", "Event Log", "form", "Machine", "sec-eventlog"),
        _node(s + "/restrictedgroups", "Restricted Groups", "table", "Machine", "sec-restricted-group"),
        _node(s + "/services", "System Services", "table", "Machine", "sec-system-service"),
        _node(s + "/registry", "Registry", "table", "Machine", "sec-registry-perm"),
        _node(s + "/filesystem", "File System", "table", "Machine", "sec-file-perm"),
        _node(s + "/wired", "Wired Network (IEEE 802.3) Policies", "table", "Machine", "wired-policy"),
        _node(s + "/firewall", "Windows Defender Firewall with Advanced Security", "container", "Machine", None, [
            _node(s + "/firewall/profiles", "Firewall Profiles", "form", "Machine", "firewall-profiles"),
            _node(s + "/firewall/inbound", "Inbound Rules", "table", "Machine", "firewall-rule"),
            _node(s + "/firewall/outbound", "Outbound Rules", "table", "Machine", "firewall-rule"),
            _node(s + "/firewall/csr", "Connection Security Rules", "table", "Machine", "firewall-csr")]),
        _node(s + "/netlist", "Network List Manager Policies", "table", "Machine", "netlist-policy"),
        _node(s + "/wireless", "Wireless Network (IEEE 802.11) Policies", "table", "Machine", "wireless-policy"),
        _node(s + "/pki", "Public Key Policies", "table", "Machine", "pki-trusted-cert"),
        _node(s + "/srp", "Software Restriction Policies", "table", "Machine", "srp-rule"),
        _node(s + "/applocker", "Application Control Policies (AppLocker)", "table", "Machine", "applocker-rule"),
        _node(s + "/ipsec", "IP Security Policies", "table", "Machine", "ipsec-policy"),
        _node(s + "/advaudit", "Advanced Audit Policy Configuration", "table", "Machine", "advanced-audit")])


_PREF_WIN = ["Applications", "Drives", "EnvironmentVariables", "Files", "Folders", "IniFiles",
             "NetworkShares", "Registry", "Shortcuts"]
_PREF_CP = ["DataSources", "Devices", "FolderOptions", "InternetSettings", "LocalUsersAndGroups",
            "NetworkOptions", "PowerOptions", "Printers", "RegionalOptions", "ScheduledTasks",
            "Services", "StartMenu"]
_PREF_LABEL = {"Drives": "Drive Maps", "EnvironmentVariables": "Environment", "IniFiles": "Ini Files",
               "NetworkShares": "Network Shares", "DataSources": "Data Sources", "FolderOptions": "Folder Options",
               "InternetSettings": "Internet Settings", "LocalUsersAndGroups": "Local Users and Groups",
               "NetworkOptions": "Network Options", "PowerOptions": "Power Options",
               "RegionalOptions": "Regional Options", "ScheduledTasks": "Scheduled Tasks", "StartMenu": "Start Menu"}


def _preferences(cls, p):
    def area_nodes(parent, areas):
        out = []
        for area in areas:
            a = gppxml.get(area)
            if a is None:
                continue
            if (cls == "Machine" and not a.computer) or (cls == "User" and not a.user):
                continue
            label = _PREF_LABEL.get(area, area)
            out.append(_node(parent + "/" + area.lower(), label, "preference-items", cls, "pref-" + area))
        return out

    return _node(p + "/pref", "Preferences", "container", cls, None, [
        _node(p + "/pref/win", "Windows Settings", "container", cls, None, area_nodes(p + "/pref/win", _PREF_WIN)),
        _node(p + "/pref/cp", "Control Panel Settings", "container", cls, None, area_nodes(p + "/pref/cp", _PREF_CP))])


# Flatten the tree once into id -> node metadata for lookups.
def _flatten(nodes, out):
    for n in nodes:
        out[n["id"]] = n
        _flatten(n.get("children", []), out)
    return out


NODE_INDEX = _flatten(build_tree(), {})


class GpoEditorMixin:
    """Mixed into SysvolMixin-based backends. Serves the GPME tree and node
    CRUD against the GPO's SYSVOL folder."""

    # -- tree / schema ----------------------------------------------------
    def gpo_tree(self, gpo_id):
        norm_guid(gpo_id)
        self._require_gpo(norm_guid(gpo_id))
        return {"nodes": build_tree()}

    def gpo_node_schemas(self):
        from . import gposchema
        return {"schemas": list(gposchema.build().values())}

    # -- helpers ----------------------------------------------------------
    def _node(self, node_id):
        n = NODE_INDEX.get(node_id)
        if n is None:
            raise not_found(f"no such node '{node_id}'")
        if not n.get("available", True):
            raise not_found(n.get("unavailableReason") or "node not available on the Samba backend")
        return n

    def _inf_path(self, guid):
        return ci_path(self.gpo_dir(guid), secinf.PATH)

    def _load_inf(self):
        pass

    # Section helpers reuse secinf.parse / render.
    def _read_inf(self, guid):
        path = self._inf_path(guid)
        try:
            with open(path, "rb") as f:
                return secinf.parse(secinf.decode(f.read()))
        except FileNotFoundError:
            return {}

    def _write_inf(self, guid, sections):
        path = self._inf_path(guid)
        try:
            with open(path, "rb") as f:
                original = secinf.parse(secinf.decode(f.read()))
        except FileNotFoundError:
            original = {}
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(secinf.encode(secinf.render(sections, original)))
        self._after_sysvol_write(path)
        self._bump(guid, machine=True, cse_pairs=[("Machine", gpt.SECURITY_CSE, gpt.SECURITY_TOOL)])

    # -- form nodes -------------------------------------------------------
    _FORM_SECTION = {
        "password": "System Access", "lockout": "System Access", "kerberos": "Kerberos Policy",
        "audit": "Event Audit", "eventlog": "Event Log",
    }

    def gpo_node_get(self, gpo_id, node_id):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        n = self._node(node_id)
        if n["kind"] != "form":
            raise bad(f"node '{node_id}' is a {n['kind']} node; use the items endpoint")
        section = self._section_for(node_id)
        sections = self._read_inf(guid)
        values = dict(sections.get(section, {}))
        return {"nodeId": node_id, "schema": n["itemSchema"], "values": values}

    def gpo_node_put(self, gpo_id, node_id, values):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        n = self._node(node_id)
        if n["kind"] != "form":
            raise bad(f"node '{node_id}' is a {n['kind']} node; use the items endpoint")
        if not isinstance(values, dict):
            raise bad("values must be an object")
        if node_id.endswith("/firewall/profiles"):
            self._write_firewall_profiles(guid, values)
            return self.gpo_node_get(gpo_id, node_id)
        section = self._section_for(node_id)
        sections = self._read_inf(guid)
        sect = dict(sections.get(section, {}))
        for k, v in values.items():
            sect[k] = "1" if v is True else "0" if v is False else str(v)
        sections[section] = sect
        self._write_inf(guid, sections)
        return self.gpo_node_get(gpo_id, node_id)

    def _section_for(self, node_id):
        leaf = node_id.rsplit("/", 1)[-1]
        if node_id.endswith("/firewall/profiles"):
            return None
        return self._FORM_SECTION.get(leaf, "System Access")

    # -- item nodes -------------------------------------------------------
    def gpo_node_items(self, gpo_id, node_id):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        n = self._node(node_id)
        items = self._read_items(guid, n)
        return {"nodeId": node_id, "schema": n["itemSchema"], "items": items}

    def gpo_node_item_create(self, gpo_id, node_id, body):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        n = self._node(node_id)
        return self._mutate(guid, n, "create", None, body)

    def gpo_node_item_update(self, gpo_id, node_id, item_id, body):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        n = self._node(node_id)
        return self._mutate(guid, n, "update", item_id, body)

    def gpo_node_item_delete(self, gpo_id, node_id, item_id):
        guid = norm_guid(gpo_id)
        self._require_gpo(guid)
        n = self._node(node_id)
        self._mutate(guid, n, "delete", item_id, None)

    # -- dispatch ---------------------------------------------------------
    def _read_items(self, guid, n):
        schema = n["itemSchema"]
        if schema and schema.startswith("pref-"):
            return self._read_pref(guid, n)
        if schema == "sec-user-right":
            return self._read_inf_section_rows(guid, "Privilege Rights", "right", "accounts")
        if schema == "sec-option":
            return self._read_registry_values(guid)
        if schema == "sec-restricted-group":
            return self._read_restricted_groups(guid)
        if schema == "sec-system-service":
            return self._read_services(guid)
        if schema == "sec-registry-perm":
            return self._read_keyed(guid, "Registry Keys", "key")
        if schema == "sec-file-perm":
            return self._read_keyed(guid, "File Security", "path")
        if schema == "pki-trusted-cert":
            return self._read_keyed(guid, "Public Key Policies", "thumbprint")
        if schema == "advanced-audit":
            return self._read_audit(guid)
        if schema == "script-entry":
            return self._read_scripts(guid, n)
        if schema == "folder-redirection":
            return self._read_fdeploy(guid)
        if schema == "firewall-rule":
            return self._read_firewall_rules(guid, n)
        if schema == "firewall-csr":
            return self._read_pol_named(guid, "Machine", _FW_BASE + r"\ConSecRules", "rule")
        if schema == "nrpt-rule":
            return self._read_nrpt(guid)
        if schema in ("qos-policy", "srp-rule", "applocker-rule", "netlist-policy"):
            return self._read_pol_subkeys(guid, n, schema)
        return []

    def _mutate(self, guid, n, op, item_id, body):
        schema = n["itemSchema"]
        if schema and schema.startswith("pref-"):
            return self._mutate_pref(guid, n, op, item_id, body)
        if schema == "sec-user-right":
            return self._mutate_inf_rows(guid, "Privilege Rights", "right", "accounts", op, item_id, body)
        if schema == "sec-option":
            return self._mutate_registry_values(guid, op, item_id, body)
        if schema == "sec-restricted-group":
            return self._mutate_restricted_groups(guid, op, item_id, body)
        if schema == "sec-system-service":
            return self._mutate_services(guid, op, item_id, body)
        if schema == "sec-registry-perm":
            return self._mutate_keyed(guid, "Registry Keys", "key", op, item_id, body)
        if schema == "sec-file-perm":
            return self._mutate_keyed(guid, "File Security", "path", op, item_id, body)
        if schema == "pki-trusted-cert":
            return self._mutate_keyed(guid, "Public Key Policies", "thumbprint", op, item_id, body)
        if schema == "advanced-audit":
            return self._mutate_audit(guid, op, item_id, body)
        if schema == "script-entry":
            return self._mutate_scripts(guid, n, op, item_id, body)
        if schema == "folder-redirection":
            return self._mutate_fdeploy(guid, op, item_id, body)
        if schema == "firewall-rule":
            return self._mutate_firewall_rules(guid, n, op, item_id, body)
        if schema == "firewall-csr":
            return self._mutate_pol_named(guid, "Machine", _FW_BASE + r"\ConSecRules", "rule", op, item_id, body,
                                          cse=(gpt.REGISTRY_CSE, gpt.REGISTRY_TOOL_MACHINE))
        if schema == "nrpt-rule":
            return self._mutate_nrpt(guid, op, item_id, body)
        if schema in ("qos-policy", "srp-rule", "applocker-rule", "netlist-policy"):
            return self._mutate_pol_subkeys(guid, n, schema, op, item_id, body)
        raise bad(f"node '{n['id']}' does not support item editing")

    # ---- GptTmpl.inf keyed sections ------------------------------------
    def _read_inf_section_rows(self, guid, section, key_field, value_field):
        sections = self._read_inf(guid)
        rows = []
        for k, v in sections.get(section, {}).items():
            rows.append({"id": k, key_field: k, value_field: v})
        return rows

    def _mutate_inf_rows(self, guid, section, key_field, value_field, op, item_id, body):
        sections = self._read_inf(guid)
        sect = dict(sections.get(section, {}))
        if op == "delete":
            sect.pop(item_id, None)
            sections[section] = sect
            self._write_inf(guid, sections)
            return None
        key = item_id if op == "update" else body.get(key_field)
        if not key:
            raise bad(f"{key_field} is required")
        sect[key] = str(body.get(value_field, ""))
        sections[section] = sect
        self._write_inf(guid, sections)
        return {"id": key, key_field: key, value_field: sect[key]}

    def _read_registry_values(self, guid):
        sections = self._read_inf(guid)
        rows = []
        for k, v in sections.get("Registry Values", {}).items():
            reg_type, _, val = v.partition(",")
            rows.append({"id": k, "key": k, "regType": reg_type, "value": val})
        return rows

    def _mutate_registry_values(self, guid, op, item_id, body):
        sections = self._read_inf(guid)
        sect = dict(sections.get("Registry Values", {}))
        if op == "delete":
            sect.pop(item_id, None)
        else:
            key = item_id if op == "update" else body.get("key")
            if not key:
                raise bad("key is required")
            sect[key] = f"{body.get('regType', '4')},{body.get('value', '')}"
        sections["Registry Values"] = sect
        self._write_inf(guid, sections)
        if op == "delete":
            return None
        return {"id": key, "key": key, "regType": body.get("regType"), "value": body.get("value")}

    def _read_restricted_groups(self, guid):
        sections = self._read_inf(guid)
        by_group = {}
        for k, v in sections.get("Group Membership", {}).items():
            if k.endswith("__Members"):
                g, which = k[:-9], "members"
            elif k.endswith("__Memberof"):
                g, which = k[:-10], "memberOf"
            else:
                continue
            row = by_group.setdefault(g, {"id": g, "group": g, "members": "", "memberOf": ""})
            row[which] = v
        return list(by_group.values())

    def _mutate_restricted_groups(self, guid, op, item_id, body):
        sections = self._read_inf(guid)
        sect = dict(sections.get("Group Membership", {}))
        if op == "delete":
            sect.pop(item_id + "__Members", None)
            sect.pop(item_id + "__Memberof", None)
            sections["Group Membership"] = sect
            self._write_inf(guid, sections)
            return None
        group = item_id if op == "update" else body.get("group")
        if not group:
            raise bad("group is required")
        sect[group + "__Members"] = str(body.get("members", ""))
        sect[group + "__Memberof"] = str(body.get("memberOf", ""))
        sections["Group Membership"] = sect
        self._write_inf(guid, sections)
        return {"id": group, "group": group, "members": sect[group + "__Members"],
                "memberOf": sect[group + "__Memberof"]}

    def _read_services(self, guid):
        sections = self._read_inf(guid)
        rows = []
        for k, v in sections.get("Service General Setting", {}).items():
            startup, _, sddl = v.partition(",")
            rows.append({"id": k.strip('"'), "service": k.strip('"'), "startup": startup, "sddl": sddl.strip('"')})
        return rows

    def _mutate_services(self, guid, op, item_id, body):
        sections = self._read_inf(guid)
        sect = dict(sections.get("Service General Setting", {}))
        if op == "delete":
            sect.pop(f'"{item_id}"', None)
            sect.pop(item_id, None)
            sections["Service General Setting"] = sect
            self._write_inf(guid, sections)
            return None
        svc = item_id if op == "update" else body.get("service")
        if not svc:
            raise bad("service is required")
        sect[f'"{svc}"'] = f'{body.get("startup", "4")},"{body.get("sddl", "")}"'
        sections["Service General Setting"] = sect
        self._write_inf(guid, sections)
        return {"id": svc, "service": svc, "startup": body.get("startup"), "sddl": body.get("sddl")}

    def _read_keyed(self, guid, section, key_field):
        sections = self._read_inf(guid)
        rows = []
        for k, v in sections.get(section, {}).items():
            prop, _, sddl = v.partition(",")
            rows.append({"id": k.strip('"'), key_field: k.strip('"'), "propagation": prop, "sddl": sddl.strip('"')})
        return rows

    def _mutate_keyed(self, guid, section, key_field, op, item_id, body):
        sections = self._read_inf(guid)
        sect = dict(sections.get(section, {}))
        if op == "delete":
            sect.pop(f'"{item_id}"', None)
            sect.pop(item_id, None)
            sections[section] = sect
            self._write_inf(guid, sections)
            return None
        key = item_id if op == "update" else body.get(key_field)
        if not key:
            raise bad(f"{key_field} is required")
        sect[f'"{key}"'] = f'{body.get("propagation", "0")},"{body.get("sddl", "")}"'
        sections[section] = sect
        self._write_inf(guid, sections)
        return {"id": key, key_field: key, "propagation": body.get("propagation"), "sddl": body.get("sddl")}

    # ---- audit.csv -----------------------------------------------------
    _AUDIT_HEADER = ("Machine Name,Policy Target,Subcategory,Subcategory GUID,"
                     "Inclusion Setting,Exclusion Setting,Setting Value")

    def _audit_path(self, guid):
        return ci_path(self.gpo_dir(guid), "Machine/Microsoft/Windows NT/Audit/audit.csv")

    def _read_audit(self, guid):
        path = self._audit_path(guid)
        rows = []
        try:
            with open(path, "r", encoding="utf-8") as f:
                lines = f.read().splitlines()
        except FileNotFoundError:
            return rows
        for line in lines[1:]:
            if not line.strip():
                continue
            c = line.split(",")
            if len(c) < 7:
                continue
            rows.append({"id": c[3].strip("{}"), "policyTarget": c[1], "subcategory": c[2],
                         "subcategoryGuid": c[3], "settingValue": c[6]})
        return rows

    def _mutate_audit(self, guid, op, item_id, body):
        rows = self._read_audit(guid)
        kept = [r for r in rows if not (op != "create" and r["id"].lower() == (item_id or "").strip("{}").lower())]
        result = None
        if op != "delete":
            gu = ("{" + item_id.strip("{}") + "}") if op == "update" else body.get("subcategoryGuid")
            if not gu:
                raise bad("subcategoryGuid is required")
            target = body.get("policyTarget", "System")
            sub = body.get("subcategory", "")
            val = str(body.get("settingValue", "0"))
            kept.append({"id": gu.strip("{}"), "policyTarget": target, "subcategory": sub,
                         "subcategoryGuid": gu, "settingValue": val})
            result = kept[-1]
        out = [self._AUDIT_HEADER]
        for r in kept:
            incl = {"1": "Success", "2": "Failure", "3": "Success and Failure"}.get(r["settingValue"], "No Auditing")
            out.append(f",{r['policyTarget']},{r['subcategory']},{r['subcategoryGuid']},{incl},,{r['settingValue']}")
        path = self._audit_path(guid)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write("\r\n".join(out) + "\r\n")
        self._after_sysvol_write(path)
        self._bump(guid, machine=True, cse_pairs=[("Machine", _AUDIT_CSE, _AUDIT_TOOL)])
        return result

    # ---- Registry.pol backed nodes -------------------------------------
    def _read_firewall_rules(self, guid, n):
        inbound = n["id"].endswith("/inbound")
        pol = self.load_pol(guid, "Machine")
        rows = []
        for e in pol.under(_FW_RULES, recursive=False):
            data = e.decoded()
            if not isinstance(data, str) or not data:
                continue
            r = _parse_fw_rule(e.value_name, data)
            is_in = (r.get("direction") or "").lower() == "in"
            if is_in != inbound:
                continue
            rows.append(r)
        return rows

    def _mutate_firewall_rules(self, guid, n, op, item_id, body):
        pol = self.load_pol(guid, "Machine")
        if op == "delete":
            pol.remove(_FW_RULES, item_id)
            self.save_pol(guid, "Machine", pol)
            return None
        body = dict(body or {})
        if not body.get("direction"):
            body["direction"] = "Out" if n["id"].endswith("/outbound") else "In"
        name = item_id if op == "update" else "{" + str(uuid.uuid4()).upper() + "}"
        pol.set_value(_FW_RULES, name, "String", _build_fw_rule(body))
        self.save_pol(guid, "Machine", pol)
        row = _parse_fw_rule(name, _build_fw_rule(body))
        return row

    def _write_firewall_profiles(self, guid, values):
        pol = self.load_pol(guid, "Machine")
        mapping = {"State": "EnableFirewall", "Inbound": "DefaultInboundAction", "Outbound": "DefaultOutboundAction"}
        for profile in ("Domain", "Private", "Public"):
            key = _FW_BASE + "\\" + profile + "Profile"
            for suffix, value_name in mapping.items():
                v = values.get(profile + suffix)
                if v is None:
                    continue
                pol.set_value(key, value_name, "DWord", int(v))
        self.save_pol(guid, "Machine", pol)

    def _read_firewall_profiles(self, guid):
        pol = self.load_pol(guid, "Machine")
        values = {}
        mapping = {"EnableFirewall": "State", "DefaultInboundAction": "Inbound", "DefaultOutboundAction": "Outbound"}
        for profile in ("Domain", "Private", "Public"):
            key = _FW_BASE + "\\" + profile + "Profile"
            for e in pol.under(key, recursive=False):
                suffix = mapping.get(e.value_name)
                if suffix:
                    values[profile + suffix] = str(e.decoded())
        return values

    def _read_pol_named(self, guid, side, key, value_field):
        pol = self.load_pol(guid, side)
        rows = []
        for e in pol.under(key, recursive=False):
            rows.append({"id": e.value_name, "name": e.value_name, value_field: e.decoded(), "active": True})
        return rows

    def _mutate_pol_named(self, guid, side, key, value_field, op, item_id, body, cse):
        pol = self.load_pol(guid, side)
        if op == "delete":
            pol.remove(key, item_id)
            self.save_pol(guid, side, pol)
            return None
        name = item_id if op == "update" else "{" + str(uuid.uuid4()).upper() + "}"
        val = body.get(value_field)
        if val is None:
            raise bad(f"{value_field} is required")
        pol.set_value(key, name, "String", val)
        self.save_pol(guid, side, pol)
        return {"id": name, "name": name, value_field: val, "active": True}

    def _nrpt_base(self):
        return r"Software\Policies\Microsoft\Windows NT\DNSClient\DnsPolicyConfig"

    def _read_nrpt(self, guid):
        pol = self.load_pol(guid, "Machine")
        base = self._nrpt_base().lower()
        by_rule = {}
        for e in pol.under(self._nrpt_base(), recursive=True):
            ek = e.key.lower()
            if ek == base:
                continue
            rule = e.key[len(self._nrpt_base()) + 1:].split("\\")[0]
            row = by_rule.setdefault(rule, {"id": rule, "ruleName": rule})
            if e.value_name == "Name":
                v = e.decoded()
                row["name"] = ",".join(v) if isinstance(v, list) else v
            elif e.value_name == "GenericDNSServers":
                row["genericDnsServers"] = e.decoded()
            elif e.value_name == "ConfigOptions":
                row["configOptions"] = str(e.decoded())
        return list(by_rule.values())

    def _mutate_nrpt(self, guid, op, item_id, body):
        pol = self.load_pol(guid, "Machine")
        rule = (body.get("ruleName") if op == "create" else item_id) or ("{" + str(uuid.uuid4()).upper() + "}")
        key = self._nrpt_base() + "\\" + rule
        if op == "delete":
            pol.remove(key, None, recursive=True)
            self.save_pol(guid, "Machine", pol)
            return None
        if body.get("name") is not None:
            pol.set_value(key, "Name", "MultiString", str(body["name"]).split(","))
        if body.get("genericDnsServers") is not None:
            pol.set_value(key, "GenericDNSServers", "String", body["genericDnsServers"])
        pol.set_value(key, "ConfigOptions", "DWord", int(body.get("configOptions", 8)))
        pol.set_value(key, "Version", "DWord", 2)
        self.save_pol(guid, "Machine", pol)
        return {"id": rule, "ruleName": rule, "name": body.get("name"),
                "genericDnsServers": body.get("genericDnsServers"), "configOptions": body.get("configOptions")}

    # Generic "subkey of a base key" nodes: QoS, SRP, AppLocker, NetworkList.
    def _pol_subkey_spec(self, n, schema):
        side = "Machine" if n["class"] == "Machine" else "User"
        hive_prefix = "" if True else ""
        if schema == "qos-policy":
            return side, r"Software\Policies\Microsoft\Windows\QoS"
        if schema == "srp-rule":
            return side, r"Software\Policies\Microsoft\Windows\Safer\CodeIdentifiers\0\Paths"
        if schema == "applocker-rule":
            return "Machine", r"Software\Policies\Microsoft\Windows\SrpV2\Exe"
        if schema == "netlist-policy":
            return side, r"Software\Policies\Microsoft\Windows\NetworkList"
        raise bad("unknown subkey node")

    def _read_pol_subkeys(self, guid, n, schema):
        side, base = self._pol_subkey_spec(n, schema)
        pol = self.load_pol(guid, side)
        rows = {}
        bl = base.lower()
        for e in pol.under(base, recursive=True):
            if e.key.lower() == bl:
                # Collection-level value (e.g. AppLocker EnforcementMode).
                continue
            sub = e.key[len(base) + 1:].split("\\")[0]
            row = rows.setdefault(sub, {"id": sub})
            row[e.value_name] = e.decoded()
        return [{"id": k, **_subkey_shape(schema, v)} for k, v in rows.items()]

    def _mutate_pol_subkeys(self, guid, n, schema, op, item_id, body):
        side, base = self._pol_subkey_spec(n, schema)
        machine = side == "Machine"
        pol = self.load_pol(guid, side)
        if op == "delete":
            pol.remove(base + "\\" + item_id, None, recursive=True)
            self._save_pol_side(guid, side, pol)
            return None
        sub = item_id if op == "update" else "{" + str(uuid.uuid4()).upper() + "}"
        key = base + "\\" + sub
        for value_name, type_name, value in _subkey_values(schema, body):
            pol.set_value(key, value_name, type_name, value)
        self._save_pol_side(guid, side, pol)
        return {"id": sub, **body}

    def _save_pol_side(self, guid, side, pol):
        self.save_pol(guid, side, pol)

    # ---- scripts.ini / psscripts.ini -----------------------------------
    def _scripts_ini(self, guid, n, ps):
        side = "Machine" if n["class"] == "Machine" else "User"
        name = "psscripts.ini" if ps else "scripts.ini"
        return os.path.join(self.gpo_dir(guid), side, "Scripts", name)

    def _scripts_section(self, n):
        leaf = n["id"].rsplit("/", 1)[-1]
        return leaf[:1].upper() + leaf[1:]

    def _read_scripts(self, guid, n):
        section = self._scripts_section(n)
        rows = []
        for ps in (False, True):
            path = self._scripts_ini(guid, n, ps)
            ini = _parse_ini(path)
            sect = ini.get(section, {})
            i = 0
            while f"{i}CmdLine" in sect:
                rows.append({"id": ("ps:" if ps else "cmd:") + str(i), "script": sect[f"{i}CmdLine"],
                             "parameters": sect.get(f"{i}Parameters", ""), "powershell": ps})
                i += 1
        return rows

    def _mutate_scripts(self, guid, n, op, item_id, body):
        body = body or {}
        ps = (item_id or "").startswith("ps:") if op == "delete" else bool(body.get("powershell"))
        path = self._scripts_ini(guid, n, ps)
        section = self._scripts_section(n)
        ini = _parse_ini(path)
        sect = ini.setdefault(section, {})
        entries = []
        i = 0
        while f"{i}CmdLine" in sect:
            entries.append([sect[f"{i}CmdLine"], sect.get(f"{i}Parameters", "")])
            i += 1
        target = -1
        if item_id and ":" in item_id:
            try:
                target = int(item_id.split(":", 1)[1])
            except ValueError:
                target = -1
        result = None
        if op == "delete":
            if 0 <= target < len(entries):
                entries.pop(target)
        else:
            script = body.get("script")
            if not script:
                raise bad("script is required")
            parms = body.get("parameters", "")
            content = body.get("content")
            if content is not None:
                folder = os.path.join(self.gpo_dir(guid), "Machine" if n["class"] == "Machine" else "User",
                                      "Scripts", section)
                os.makedirs(folder, exist_ok=True)
                with open(os.path.join(folder, os.path.basename(script)), "w", encoding="utf-8") as f:
                    f.write(content)
            if op == "update" and 0 <= target < len(entries):
                entries[target] = [script, parms]
            else:
                entries.append([script, parms])
                target = len(entries) - 1
            result = {"id": ("ps:" if ps else "cmd:") + str(target), "script": script,
                      "parameters": parms, "powershell": ps}
        new_sect = {}
        for idx, (cmd, par) in enumerate(entries):
            new_sect[f"{idx}CmdLine"] = cmd
            new_sect[f"{idx}Parameters"] = par
        ini[section] = new_sect
        _write_ini(path, ini)
        self._after_sysvol_write(path, "scripts")
        self._bump(guid, machine=n["class"] == "Machine", user=n["class"] == "User",
                   cse_pairs=[(n["class"], _SCRIPTS_CSE, _SCRIPTS_TOOL_M if n["class"] == "Machine" else _SCRIPTS_TOOL_U)])
        return result

    # ---- fdeploy1.ini (folder redirection, user) -----------------------
    def _fdeploy_path(self, guid):
        return os.path.join(self.gpo_dir(guid), "User", "Documents & Settings", "fdeploy1.ini")

    def _read_fdeploy(self, guid):
        path = self._fdeploy_path(guid)
        ini = _parse_ini(path, encoding="utf-16")
        fr = ini.get("Folder_Redirection", {})
        rows = []
        for folder, sids in fr.items():
            for sid in [s.strip() for s in sids.split(";") if s.strip()]:
                key = f"{folder}_{sid}"
                per = ini.get(key, {})
                rows.append({"id": key, "folder": folder, "securityGroup": sid,
                             "flags": per.get("Flags", ""), "fullPath": per.get("FullPath", "")})
        return rows

    def _mutate_fdeploy(self, guid, op, item_id, body):
        path = self._fdeploy_path(guid)
        ini = _parse_ini(path, encoding="utf-16")
        ini.setdefault("version", {"version": "100"})
        fr = ini.setdefault("Folder_Redirection", {})
        if op == "delete":
            ini.pop(item_id, None)
            folder, _, sid = item_id.partition("_")
            if folder in fr:
                sids = [s.strip() for s in fr[folder].split(";") if s.strip() and s.strip() != sid]
                if sids:
                    fr[folder] = "; ".join(sids)
                else:
                    fr.pop(folder, None)
            _write_ini(path, ini, encoding="utf-16")
            self._after_sysvol_write(path)
            self._bump(guid, user=True, cse_pairs=[("User", _FR_CSE, _FR_TOOL)])
            return None
        folder = body.get("folder")
        if not folder:
            raise bad("folder is required")
        group = body.get("securityGroup", "S-1-1-0")
        flags = body.get("flags", "1001")
        full_path = body.get("fullPath")
        key = f"{folder}_{group}"
        if folder in fr:
            if group.lower() not in fr[folder].lower():
                fr[folder] = fr[folder].rstrip("; ") + "; " + group
        else:
            fr[folder] = group + ";"
        per = ini.setdefault(key, {})
        per["Flags"] = flags
        if full_path is not None:
            per["FullPath"] = full_path
        _write_ini(path, ini, encoding="utf-16")
        self._after_sysvol_write(path)
        self._bump(guid, user=True, cse_pairs=[("User", _FR_CSE, _FR_TOOL)])
        return {"id": key, "folder": folder, "securityGroup": group, "flags": flags, "fullPath": full_path}

    # ---- GPP preference items ------------------------------------------
    def _pref_path(self, guid, n):
        area = n["itemSchema"][len("pref-"):]
        a = gppxml.get(area)
        side = "Machine" if n["class"] == "Machine" else "User"
        return os.path.join(self.gpo_dir(guid), side, "Preferences", a.outer, a.outer + ".xml")

    def _read_pref(self, guid, n):
        return gppxml.read_items(self._pref_path(guid, n))

    def _mutate_pref(self, guid, n, op, item_id, body):
        area = n["itemSchema"][len("pref-"):]
        a = gppxml.get(area)
        path = self._pref_path(guid, n)
        items = gppxml.read_items(path)
        result = None
        if op == "delete":
            items = [it for it in items if (it.get("id") or "").lower() != (item_id or "").lower()]
        else:
            item = dict(body or {})
            if op == "update":
                item["id"] = item_id
                items = [it for it in items if (it.get("id") or "").lower() != (item_id or "").lower()]
            items.append(item)
            result = item
        gppxml.write_items(path, a, items)
        self._after_sysvol_write(path, "preferences")
        tool = _PREF_CSE.get(area)
        if tool:
            self._bump(guid, machine=n["class"] == "Machine", user=n["class"] == "User",
                       cse_pairs=[(n["class"], tool[0], tool[1])])
        return result


# ----------------------------------------------------------------------------
# Module-level CSE constants and helpers (mirroring GpoCse.cs).
# ----------------------------------------------------------------------------

_FW_BASE = r"Software\Policies\Microsoft\WindowsFirewall"
_FW_RULES = _FW_BASE + r"\FirewallRules"
_AUDIT_CSE = "{F3CCC681-B74C-4060-9F26-CD84525DCA2A}"
_AUDIT_TOOL = "{0F3F3735-573D-9804-99E4-AB2A69BA5FD4}"
_SCRIPTS_CSE = "{42B5FAAE-6536-11D2-AE5A-0000F87571E3}"
_SCRIPTS_TOOL_M = "{40B6664F-4972-11D1-A7CA-0000F87571E3}"
_SCRIPTS_TOOL_U = "{40B66650-4972-11D1-A7CA-0000F87571E3}"
_FR_CSE = "{25537BA6-77A8-11D2-9B6C-0000F8080861}"
_FR_TOOL = "{88E729D6-BDC1-11D1-BD2A-00C04FB9603F}"

# GPP area CSE/tool pairs from [MS-GPPREF] 1.9.
_PREF_CSE = {
    "Applications": ("{F9C77450-3A41-477E-9310-9ACD617BD9E3}", "{0DA274B5-EB93-47A7-AAFB-65BA532D3FE6}"),
    "DataSources": ("{728EE579-943C-4519-9EF7-AB56765798ED}", "{1612B55C-243C-48DD-A449-FFC097B19776}"),
    "Devices": ("{1A6364EB-776B-4120-ADE1-B63A406A76B5}", "{1B767E9A-7BE4-4D35-85C1-2E174A7BA951}"),
    "Drives": ("{5794DAFD-BE60-433F-88A2-1A31939AC01F}", "{2EA1A81B-48E5-45E9-8BB7-A6E3AC170006}"),
    "EnvironmentVariables": ("{0E28E245-9368-4853-AD84-6DA3BA35BB75}", "{35141B6B-498A-4CC7-AD59-CEF93D89B2CE}"),
    "Files": ("{7150F9BF-48AD-4DA4-A49C-29EF4A8369BA}", "{3BAE7E51-E3F4-41D0-853D-9BB9FD47605F}"),
    "FolderOptions": ("{A3F3E39B-5D83-4940-B954-28315B82F0A8}", "{3BFAE46A-7F3A-467B-8CEA-6AA34DC71F53}"),
    "Folders": ("{6232C319-91AC-4931-9385-E70C2B099F0E}", "{3EC4E9D3-714D-471F-88DC-4DD4471AAB47}"),
    "IniFiles": ("{74EE6C03-5363-4554-B161-627540339CAB}", "{516FC620-5D34-4B08-8165-6A06B623EDEB}"),
    "InternetSettings": ("{E47248BA-94CC-49C4-BBB5-9EB7F05183D0}", "{5C935941-A954-4F7C-B507-885941ECE5C4}"),
    "LocalUsersAndGroups": ("{17D89FEC-5C44-4972-B12D-241CAEF74509}", "{79F92669-4224-476C-9C5C-6EFB4D87DF4A}"),
    "NetworkOptions": ("{3A0DBA37-F8B2-4356-83DE-3E90BD5C261F}", "{949FB894-E883-42C6-88C1-29169720E8CA}"),
    "NetworkShares": ("{6A4C88C6-C502-4F74-8F60-2CB23EDC24E2}", "{BFCBBEB0-9DF4-4C0C-A728-434EA66A0373}"),
    "PowerOptions": ("{E62688F0-25FD-4C90-BFF5-F508B9D2E31F}", "{9AD2BAFE-63B4-4883-A08C-C3C6196BCAFD}"),
    "Printers": ("{BC75B1ED-5833-4858-9BB8-CBF0B166DF9D}", "{A8C42CEA-CDB8-4388-97F4-5831F933DA84}"),
    "RegionalOptions": ("{E5094040-C46C-4115-B030-04FB2E545B00}", "{B9CCA4DE-E2B9-4CBD-BF7D-11B6EBFBDDF7}"),
    "Registry": ("{B087BE9D-ED37-454F-AF9C-04291E351182}", "{BEE07A6A-EC9F-4659-B8C9-0B1937907C83}"),
    "ScheduledTasks": ("{AADCED64-746C-4633-A97C-D61349046527}", "{CAB54552-DEEA-4691-817E-ED4A4D1AFC72}"),
    "Services": ("{91FBB303-0CD5-4055-BF42-E512A681B325}", "{CC5746A9-9B74-4BE5-AE2E-64379C86E0E4}"),
    "Shortcuts": ("{C418DD9D-0D14-4EFB-8FBF-CFE535C8FAC7}", "{CEFFA6E2-E3BD-421B-852C-6F6A79A59BC1}"),
    "StartMenu": ("{E4F48E54-F38D-4884-BFB9-D4D2E5729C18}", "{CF848D48-888D-4F45-B530-6A201E62A605}"),
}


def _parse_fw_rule(rule_id, data):
    row = {"id": rule_id, "active": True, "localAddresses": [], "remoteAddresses": []}
    fields = data.split("|")
    for i, f in enumerate(fields):
        if not f:
            continue
        if i == 0 and f[:1].lower() == "v":
            row["version"] = f[1:]
            continue
        k, _, v = f.partition("=")
        if k == "Action":
            row["action"] = v
        elif k == "Dir":
            row["direction"] = v
        elif k == "Active":
            row["active"] = v.upper() == "TRUE"
        elif k == "Protocol":
            row["protocol"] = v
        elif k == "LPort":
            row["localPorts"] = (row.get("localPorts", "") + "," + v).strip(",")
        elif k == "RPort":
            row["remotePorts"] = (row.get("remotePorts", "") + "," + v).strip(",")
        elif k in ("LA4", "LA6"):
            row["localAddresses"].append(v)
        elif k in ("RA4", "RA6"):
            row["remoteAddresses"].append(v)
        elif k == "App":
            row["application"] = v
        elif k == "Svc":
            row["service"] = v
        elif k == "Profile":
            row["profiles"] = (row.get("profiles", "") + "," + v).strip(",")
        elif k == "Edge":
            row["edge"] = v.upper() == "TRUE"
        elif k == "Name":
            row["name"] = v
        elif k == "Desc":
            row["description"] = v
    row["localAddresses"] = ",".join(row["localAddresses"])
    row["remoteAddresses"] = ",".join(row["remoteAddresses"])
    return row


def _build_fw_rule(body):
    parts = ["v" + str(body.get("version", "2.30"))]

    def add(key, value):
        if value is not None and value != "":
            parts.append(f"{key}={value}")

    add("Action", body.get("action", "Allow"))
    parts.append("Active=" + ("TRUE" if body.get("active", True) else "FALSE"))
    add("Dir", body.get("direction"))
    add("Protocol", body.get("protocol"))
    add("LPort", body.get("localPorts"))
    add("RPort", body.get("remotePorts"))
    for a in [x.strip() for x in str(body.get("localAddresses", "")).split(",") if x.strip()]:
        add("LA6" if ":" in a else "LA4", a)
    for a in [x.strip() for x in str(body.get("remoteAddresses", "")).split(",") if x.strip()]:
        add("RA6" if ":" in a else "RA4", a)
    add("App", body.get("application"))
    add("Svc", body.get("service"))
    for prof in [x.strip() for x in str(body.get("profiles", "")).split(",") if x.strip()]:
        add("Profile", prof)
    if body.get("edge"):
        add("Edge", "TRUE")
    add("Name", body.get("name"))
    add("Desc", body.get("description"))
    return "|".join(parts) + "|"


def _subkey_shape(schema, v):
    if schema == "qos-policy":
        return {"name": v.get("Application Name", ""), "appName": v.get("Application Name", ""),
                "dscpValue": v.get("DSCP Value", ""), "protocol": v.get("Protocol", ""),
                "localPort": v.get("Local Port", ""), "remotePort": v.get("Remote Port", ""),
                "throttleRate": v.get("Throttle Rate", "")}
    if schema == "srp-rule":
        return {"ruleType": "path", "value": v.get("ItemData", "")}
    if schema == "applocker-rule":
        return {"collection": "Exe", "ruleXml": v.get("Value", "")}
    if schema == "netlist-policy":
        return {"network": "", "category": v.get("Category", ""), "name": v.get("Name", "")}
    return v


def _subkey_values(schema, body):
    if schema == "qos-policy":
        out = [("Version", "String", "1.0")]
        for value_name, field in (("Application Name", "appName"), ("Protocol", "protocol"),
                                   ("Local Port", "localPort"), ("Remote Port", "remotePort"),
                                   ("Throttle Rate", "throttleRate")):
            if body.get(field) is not None:
                out.append((value_name, "String", str(body[field])))
        out.append(("DSCP Value", "String", str(body.get("dscpValue", "-1"))))
        return out
    if schema == "srp-rule":
        return [("ItemData", "ExpandString", body.get("value", "")), ("SaferFlags", "DWord", 0)]
    if schema == "applocker-rule":
        out = []
        if body.get("ruleXml") is not None:
            out.append(("Value", "String", body["ruleXml"]))
        return out
    if schema == "netlist-policy":
        out = [("Category", "DWord", int(body.get("category", 0)))]
        if body.get("name") is not None:
            out.append(("Name", "String", body["name"]))
        return out
    return []


def _parse_ini(path, encoding=None):
    ini = {}
    try:
        if encoding:
            with open(path, "r", encoding=encoding, errors="replace") as f:
                text = f.read()
        else:
            with open(path, "rb") as f:
                raw = f.read()
            if raw.startswith(b"\xff\xfe"):
                text = raw[2:].decode("utf-16-le", errors="replace")
            elif raw.startswith(b"\xef\xbb\xbf"):
                text = raw[3:].decode("utf-8", errors="replace")
            else:
                text = raw.decode("utf-8", errors="replace")
    except FileNotFoundError:
        return ini
    cur = None
    for raw_line in text.replace("\r\n", "\n").split("\n"):
        line = raw_line.strip()
        if not line or line.startswith(";"):
            continue
        if line.startswith("[") and line.endswith("]"):
            cur = line[1:-1]
            ini.setdefault(cur, {})
            continue
        if cur is None or "=" not in line:
            continue
        k, _, v = line.partition("=")
        ini[cur][k.strip()] = v.strip()
    return ini


def _write_ini(path, ini, encoding=None):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out = []
    for section, body in ini.items():
        out.append(f"[{section}]")
        for k, v in body.items():
            out.append(f"{k}={v}")
    text = "\r\n".join(out) + "\r\n"
    if encoding == "utf-16":
        data = b"\xff\xfe" + text.encode("utf-16-le")
    else:
        data = text.encode("utf-8")
    tmp = path + ".tdtmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


