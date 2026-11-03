"""ADMX/ADML parsing and mapping between Administrative Template policy
state and Registry.pol entries.

The central store is SYSVOL/<realm>/Policies/PolicyDefinitions with ADMX
files and an en-US subfolder holding the ADML files. Samba does not ship
it: the administrator copies it from a Windows machine (see README).

Ids: category and policy ids are "<namespace>:<name>", for example
"Microsoft.Policies.WindowsLogon:DontDisplayNetworkSelectionUI".
"""

from __future__ import annotations

import os
import re
import threading
import xml.etree.ElementTree as ET

from . import preg

_NS_RE = re.compile(r"^\{[^}]*\}")


def _local(tag: str) -> str:
    return _NS_RE.sub("", tag)


def _children(el, name):
    return [c for c in el if _local(c.tag) == name]


def _child(el, name):
    for c in el:
        if _local(c.tag) == name:
            return c
    return None


class AdmxStore:
    def __init__(self, root: str, lang: str = "en-US"):
        self.root = root
        self.lang = lang
        self.categories: dict[str, dict] = {}
        self.policies: dict[str, dict] = {}
        self.files_parsed = 0
        self.warnings: list[str] = []
        self._loaded_sig = None
        self._lock = threading.Lock()

    # ------------------------------------------------------------------
    def _signature(self):
        try:
            names = sorted(os.listdir(self.root))
        except OSError:
            return None
        sig = []
        for n in names:
            if n.lower().endswith(".admx"):
                try:
                    sig.append((n, os.path.getmtime(os.path.join(self.root, n))))
                except OSError:
                    pass
        return tuple(sig)

    def ensure_loaded(self):
        with self._lock:
            sig = self._signature()
            if sig == self._loaded_sig:
                return
            self.categories, self.policies = {}, {}
            self.files_parsed = 0
            self.warnings = []
            self._loaded_sig = sig
            if not sig:
                return
            for name, _ in sig:
                try:
                    self._load_file(os.path.join(self.root, name))
                    self.files_parsed += 1
                except (ET.ParseError, OSError, ValueError) as e:
                    # skip broken files rather than failing the whole store
                    self.warnings.append(f"{name}: {e}")

    def languages(self) -> int:
        n = 0
        try:
            for entry in os.listdir(self.root):
                if len(entry) >= 4 and entry[2:3] == "-" and os.path.isdir(os.path.join(self.root, entry)):
                    n += 1
        except OSError:
            pass
        return n

    def _find_adml(self, admx_path: str) -> str | None:
        base = os.path.splitext(os.path.basename(admx_path))[0]
        for lang in (self.lang, "en-US"):
            d = os.path.join(self.root, lang)
            if not os.path.isdir(d):
                # case insensitive folder lookup
                try:
                    for n in os.listdir(self.root):
                        if n.lower() == lang.lower():
                            d = os.path.join(self.root, n)
                            break
                except OSError:
                    return None
            try:
                for n in os.listdir(d):
                    if n.lower() == (base + ".adml").lower():
                        return os.path.join(d, n)
            except OSError:
                continue
        return None

    def _load_file(self, path: str):
        tree = ET.parse(path)
        root = tree.getroot()
        prefixes = {}
        target_ns = None
        pn = _child(root, "policyNamespaces")
        if pn is not None:
            for c in pn:
                t = _local(c.tag)
                if t in ("target", "using"):
                    prefixes[c.get("prefix")] = c.get("namespace")
                    if t == "target":
                        target_ns = c.get("namespace")
        if not target_ns:
            return
        strings, presentations = {}, {}
        adml = self._find_adml(path)
        if adml:
            r = ET.parse(adml).getroot()
            res = _child(r, "resources")
            if res is not None:
                st = _child(res, "stringTable")
                if st is not None:
                    for s in _children(st, "string"):
                        strings[s.get("id")] = (s.text or "").strip()
                pt = _child(res, "presentationTable")
                if pt is not None:
                    for p in _children(pt, "presentation"):
                        presentations[p.get("id")] = p

        def ref(r: str | None) -> str | None:
            if not r:
                return None
            if ":" in r:
                pfx, name = r.split(":", 1)
                return f"{prefixes.get(pfx, pfx)}:{name}"
            return f"{target_ns}:{r}"

        def text(v: str | None) -> str:
            if not v:
                return ""
            m = re.match(r"^\$\(string\.([^)]+)\)$", v)
            return strings.get(m.group(1), m.group(1)) if m else v

        cats = _child(root, "categories")
        if cats is not None:
            for c in _children(cats, "category"):
                pc = _child(c, "parentCategory")
                cid = f"{target_ns}:{c.get('name')}"
                self.categories[cid] = {
                    "id": cid, "name": text(c.get("displayName")) or c.get("name"),
                    "parentId": ref(pc.get("ref")) if pc is not None else None,
                    "explain": text(c.get("explainText")),
                }
        pols = _child(root, "policies")
        if pols is None:
            return
        for p in _children(pols, "policy"):
            pid = f"{target_ns}:{p.get('name')}"
            pc = _child(p, "parentCategory")
            so = _child(p, "supportedOn")
            pres = None
            m = re.match(r"^\$\(presentation\.([^)]+)\)$", p.get("presentation") or "")
            if m:
                pres = presentations.get(m.group(1))
            labels = {}
            if pres is not None:
                for c in pres:
                    rid = c.get("refId")
                    if rid:
                        lab = _child(c, "label")
                        labels[rid] = ((lab.text if lab is not None else c.text) or "").strip()
            pol = {
                "id": pid,
                "name": text(p.get("displayName")) or p.get("name"),
                "class": p.get("class") or "Both",
                "categoryId": ref(pc.get("ref")) if pc is not None else None,
                "explain": text(p.get("explainText")),
                "supportedOn": ref(so.get("ref")) if so is not None else None,
                "key": p.get("key") or "",
                "valueName": p.get("valueName"),
                "elements": [],
                "_enabledValue": _parse_value(_child(p, "enabledValue")),
                "_disabledValue": _parse_value(_child(p, "disabledValue")),
                "_enabledList": _parse_list(_child(p, "enabledList"), p.get("key") or ""),
                "_disabledList": _parse_list(_child(p, "disabledList"), p.get("key") or ""),
            }
            els = _child(p, "elements")
            if els is not None:
                for e in els:
                    pol["elements"].append(_parse_element(e, pol["key"], labels, text))
            self.policies[pid] = pol

    # ------------------------------------------------------------------
    def list_categories(self) -> list[dict]:
        self.ensure_loaded()
        return sorted(self.categories.values(), key=lambda c: (c["name"] or "").lower())

    def list_policies(self, category=None, q=None, klass=None) -> list[dict]:
        self.ensure_loaded()
        out = []
        ql = (q or "").lower()
        for p in self.policies.values():
            if category and p["categoryId"] != category:
                continue
            if klass and klass != "Both" and p["class"] not in (klass, "Both"):
                continue
            if ql and ql not in (p["name"] or "").lower() and ql not in (p["explain"] or "").lower():
                continue
            out.append(public_policy(p))
        out.sort(key=lambda p: (p["name"] or "").lower())
        return out

    def get(self, pid: str) -> dict | None:
        self.ensure_loaded()
        return self.policies.get(pid)


def public_policy(p: dict) -> dict:
    return {k: v for k, v in p.items() if not k.startswith("_")} | {
        "elements": [{k: v for k, v in e.items() if not k.startswith("_")} for e in p["elements"]]}


# ----------------------------------------------------------------------
# ADMX value parsing. A value is ("dword", n) | ("qword", n) | ("string", s)
# | ("delete", None) | None.

def _parse_value(el):
    if el is None:
        return None
    for c in el:
        t = _local(c.tag)
        if t == "decimal":
            return ("dword", int(c.get("value", "0")))
        if t == "longDecimal":
            return ("qword", int(c.get("value", "0")))
        if t == "string":
            return ("string", c.text or "")
        if t == "delete":
            return ("delete", None)
    return None


def _parse_list(el, default_key):
    if el is None:
        return []
    default_key = el.get("defaultKey") or default_key
    out = []
    for it in _children(el, "item"):
        out.append({"key": it.get("key") or default_key, "valueName": it.get("valueName"),
                    "value": _parse_value(_child(it, "value"))})
    return out


def _parse_element(e, pkey, labels, text=lambda v: v or "") -> dict:
    t = _local(e.tag)
    eid = e.get("id")
    base = {"id": eid, "type": t, "label": labels.get(eid, eid),
            "required": e.get("required") == "true",
            "key": e.get("key") or pkey, "valueName": e.get("valueName")}
    if t == "decimal":
        base["min"] = int(e.get("minValue", "0"))
        base["max"] = int(e.get("maxValue", "9999"))
        base["_storeAsText"] = e.get("storeAsText") == "true"
    elif t == "longDecimal":
        base["type"] = "decimal"
        base["min"] = int(e.get("minValue", "0"))
        base["max"] = int(e.get("maxValue", str(2 ** 63 - 1)))
        base["_storeAsText"] = e.get("storeAsText") == "true"
        base["_long"] = True
    elif t == "text":
        base["maxLength"] = int(e.get("maxLength", "1023"))
        base["_expandable"] = e.get("expandable") == "true"
    elif t == "multiText":
        base["maxLength"] = int(e.get("maxLength", "1023"))
    elif t == "boolean":
        base["_true"] = _parse_value(_child(e, "trueValue")) or ("dword", 1)
        base["_false"] = _parse_value(_child(e, "falseValue")) or ("dword", 0)
        base["_trueList"] = _parse_list(_child(e, "trueList"), base["key"])
        base["_falseList"] = _parse_list(_child(e, "falseList"), base["key"])
    elif t == "enum":
        items = []
        for i, it in enumerate(_children(e, "item")):
            items.append({"id": str(i), "label": text(it.get("displayName")),
                          "_value": _parse_value(_child(it, "value")),
                          "_valueList": _parse_list(_child(it, "valueList"), base["key"])})
        base["items"] = items
    elif t == "list":
        base["_prefix"] = e.get("valuePrefix")
        base["_additive"] = e.get("additive") == "true"
        base["_explicit"] = e.get("explicitValue") == "true"
        base["_expandable"] = e.get("expandable") == "true"
    return base


# ----------------------------------------------------------------------
# Registry mapping

def _val_matches(entry: preg.PolEntry | None, v) -> bool:
    if v is None or entry is None:
        return False
    kind, x = v
    if kind == "delete":
        return entry.is_delete_marker
    if entry.is_delete_marker:
        return False
    d = entry.decoded()
    if kind in ("dword", "qword"):
        try:
            return int(d) == int(x)
        except (TypeError, ValueError):
            return False
    return str(d) == str(x)


def _write_val(pol: preg.PolFile, key: str, name: str, v):
    kind, x = v
    if kind == "dword":
        pol.set(key, name, preg.REG_DWORD, preg.encode_value(preg.REG_DWORD, x))
    elif kind == "qword":
        pol.set(key, name, preg.REG_QWORD, preg.encode_value(preg.REG_QWORD, x))
    elif kind == "string":
        pol.set(key, name, preg.REG_SZ, preg.encode_value(preg.REG_SZ, x))
    elif kind == "delete":
        pol.mark_delete(key, name)


def _list_matches(pol, lst) -> bool:
    return bool(lst) and all(_val_matches(pol.find(i["key"], i["valueName"] or ""), i["value"]) for i in lst)


def _effective_enabled(p):
    if p["_enabledValue"] is not None:
        return p["_enabledValue"]
    if p["valueName"]:
        return ("dword", 1)
    return None


def _effective_disabled(p):
    if p["_disabledValue"] is not None:
        return p["_disabledValue"]
    if p["valueName"]:
        return ("dword", 0)
    return None


def read_state(p: dict, pol: preg.PolFile) -> dict:
    state = "NotConfigured"
    if p["valueName"]:
        e = pol.find(p["key"], p["valueName"])
        if _val_matches(e, _effective_enabled(p)):
            state = "Enabled"
        elif _val_matches(e, _effective_disabled(p)) or (e is not None and e.is_delete_marker):
            state = "Disabled"
    if state == "NotConfigured":
        if _list_matches(pol, p["_enabledList"]):
            state = "Enabled"
        elif _list_matches(pol, p["_disabledList"]):
            state = "Disabled"
    values = {}
    any_el, all_del = False, True
    for el in p["elements"]:
        v = _read_element(el, pol)
        if v is _DELETED:
            any_el = True
            continue
        if v is not None:
            any_el, all_del = True, False
            values[el["id"]] = v
    if state == "NotConfigured" and any_el:
        state = "Disabled" if all_del else "Enabled"
    return {"state": state, "values": values if state == "Enabled" else {}}


_DELETED = object()


def _read_element(el, pol):
    t = el["type"]
    key, name = el["key"], el.get("valueName") or ""
    if t == "list":
        entries = [e for e in pol.under(key, recursive=False) if not e.is_delete_marker]
        if not entries:
            return _DELETED if pol.find(key, "**delvals.") else None
        if el["_explicit"]:
            return {e.value_name: e.decoded() for e in entries}
        return [e.decoded() for e in entries]
    e = pol.find(key, name)
    if e is None:
        return None
    if e.is_delete_marker:
        return _DELETED
    d = e.decoded()
    if t == "boolean":
        if _val_matches(e, el["_true"]):
            return True
        if _val_matches(e, el["_false"]):
            return False
        return None
    if t == "decimal":
        try:
            return int(d)
        except (TypeError, ValueError):
            return None
    if t == "enum":
        for it in el["items"]:
            if _val_matches(e, it["_value"]):
                return it["id"]
        return None
    if t == "multiText":
        return d if isinstance(d, list) else [d]
    return d


def write_state(p: dict, pol: preg.PolFile, state: str, values: dict | None) -> None:
    """Apply the policy state to pol in place."""
    values = values or {}
    if state not in ("NotConfigured", "Enabled", "Disabled"):
        raise ValueError("state must be NotConfigured, Enabled or Disabled")
    # Always start by clearing everything this policy owns.
    if p["valueName"]:
        pol.remove(p["key"], p["valueName"])
    for lst in (p["_enabledList"], p["_disabledList"]):
        for i in lst:
            pol.remove(i["key"], i["valueName"] or "")
    for el in p["elements"]:
        if el["type"] == "list":
            pol.remove(el["key"])
            pol.entries = [e for e in pol.entries if not (e.key.lower() == el["key"].lower()
                                                           and e.value_name.lower() == "**delvals.")]
        else:
            pol.remove(el["key"], el.get("valueName") or "")
        for sub in ("_trueList", "_falseList"):
            for i in el.get(sub, []):
                pol.remove(i["key"], i["valueName"] or "")
        for it in el.get("items", []):
            for i in it["_valueList"]:
                pol.remove(i["key"], i["valueName"] or "")
    if state == "NotConfigured":
        return
    if state == "Disabled":
        dv = _effective_disabled(p)
        if p["valueName"] and dv is not None:
            _write_val(pol, p["key"], p["valueName"], dv)
        for i in p["_disabledList"]:
            if i["value"] is not None:
                _write_val(pol, i["key"], i["valueName"] or "", i["value"])
        for el in p["elements"]:
            if el["type"] == "list":
                pol.mark_delvals(el["key"])
            elif el.get("valueName"):
                pol.mark_delete(el["key"], el["valueName"])
        return
    # Enabled
    ev = _effective_enabled(p)
    if p["valueName"] and ev is not None:
        _write_val(pol, p["key"], p["valueName"], ev)
    for i in p["_enabledList"]:
        if i["value"] is not None:
            _write_val(pol, i["key"], i["valueName"] or "", i["value"])
    for el in p["elements"]:
        v = values.get(el["id"])
        if v is None:
            if el.get("required"):
                raise ValueError(f"value for {el['id']} is required")
            continue
        _write_element(el, pol, v)


def _write_element(el, pol, v):
    t, key, name = el["type"], el["key"], el.get("valueName") or ""
    if t == "boolean":
        b = v if isinstance(v, bool) else str(v).lower() in ("1", "true", "yes", "on")
        _write_val(pol, key, name, el["_true"] if b else el["_false"])
        for i in el["_trueList" if b else "_falseList"]:
            if i["value"] is not None:
                _write_val(pol, i["key"], i["valueName"] or "", i["value"])
    elif t == "decimal":
        n = int(v)
        if not el["min"] <= n <= el["max"]:
            raise ValueError(f"{el['id']} must be between {el['min']} and {el['max']}")
        if el.get("_storeAsText"):
            _write_val(pol, key, name, ("string", str(n)))
        else:
            _write_val(pol, key, name, ("qword" if el.get("_long") else "dword", n))
    elif t == "text":
        s = str(v)
        if len(s) > el["maxLength"]:
            raise ValueError(f"{el['id']} is too long")
        typ = preg.REG_EXPAND_SZ if el.get("_expandable") else preg.REG_SZ
        pol.set(key, name, typ, preg.encode_value(typ, s))
    elif t == "multiText":
        items = v if isinstance(v, list) else str(v).splitlines()
        pol.set(key, name, preg.REG_MULTI_SZ, preg.encode_value(preg.REG_MULTI_SZ, items))
    elif t == "enum":
        it = next((i for i in el["items"] if i["id"] == str(v)), None)
        if it is None:
            raise ValueError(f"{el['id']}: unknown item {v!r}")
        if it["_value"] is not None:
            _write_val(pol, key, name, it["_value"])
        for i in it["_valueList"]:
            if i["value"] is not None:
                _write_val(pol, i["key"], i["valueName"] or "", i["value"])
    elif t == "list":
        typ = preg.REG_EXPAND_SZ if el.get("_expandable") else preg.REG_SZ
        if not el["_additive"]:
            pol.mark_delvals(key)
        if el["_explicit"]:
            if not isinstance(v, dict):
                raise ValueError(f"{el['id']} needs an object of name: value")
            for n_, val in v.items():
                pol.set(key, str(n_), typ, preg.encode_value(typ, val))
        else:
            items = v if isinstance(v, list) else [v]
            prefix = el.get("_prefix")
            for idx, val in enumerate(items, 1):
                vn = f"{prefix}{idx}" if prefix is not None else str(val)
                pol.set(key, vn, typ, preg.encode_value(typ, val))
