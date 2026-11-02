"""Minimal SDDL string manipulation for the DACL part of a security
descriptor. Samba converts between binary descriptors and SDDL; these
helpers only edit the text so they are testable without Samba."""

from __future__ import annotations

import re

USER_CHANGE_PASSWORD = "ab721a53-1e2f-11d0-9819-00aa0040529b"
APPLY_GROUP_POLICY = "edacfd8f-ffb3-11d1-b41d-00a0c968f939"

# Rights strings used by GPMC for each permission level on the GPO object.
GPO_READ_RIGHTS = "LCRPLORC"
GPO_EDIT_RIGHTS = "CCDCLCSWRPWPLORC"
GPO_FULL_RIGHTS = "CCDCLCSWRPWPDTLOCRSDRCWDWO"

WELL_KNOWN = {
    "WD": "S-1-1-0", "AU": "S-1-5-11", "PS": "S-1-5-10", "SY": "S-1-5-18", "BA": "S-1-5-32-544",
    "BU": "S-1-5-32-545", "ED": "S-1-5-9", "CO": "S-1-3-0", "AN": "S-1-5-7", "NS": "S-1-5-20",
    "LS": "S-1-5-19", "PU": "S-1-5-32-547", "AO": "S-1-5-32-548", "SO": "S-1-5-32-549",
    "PO": "S-1-5-32-550", "BO": "S-1-5-32-551", "RE": "S-1-5-32-552", "RU": "S-1-5-32-554",
    "RD": "S-1-5-32-555", "NO": "S-1-5-32-556", "IU": "S-1-5-4", "NU": "S-1-5-2", "SU": "S-1-5-6",
    "ER": "S-1-5-32-573", "RS": "S-1-5-32-575",
}
# Domain relative aliases
DOMAIN_RID = {"DA": 512, "DU": 513, "DG": 514, "DC": 515, "DD": 516, "CA": 517, "SA": 518,
              "EA": 519, "PA": 520, "RO": 498, "CN": 522}

_ACE_RE = re.compile(r"\(([^()]*)\)")


def split(sddl: str) -> dict:
    """Split SDDL into {"O","G","D","S"} raw parts (without the "X:" prefix)."""
    parts = {}
    for m in re.finditer(r"([OGDS]):(.*?)(?=(?:[OGDS]:)|$)", sddl):
        # The lookahead stops at "S:" inside an ACE like ";;;S-1-..."? ACE
        # contents never contain "X:" because SIDs use dashes, so this is safe
        parts[m.group(1)] = m.group(2)
    return parts


def join(parts: dict) -> str:
    return "".join(f"{k}:{parts[k]}" for k in ("O", "G", "D", "S") if k in parts)


def dacl_flags_and_aces(dacl: str) -> tuple[str, list[str]]:
    i = dacl.find("(")
    if i < 0:
        return dacl, []
    return dacl[:i], _ACE_RE.findall(dacl[i:])


def build_dacl(flags: str, aces: list[str]) -> str:
    return flags + "".join(f"({a})" for a in aces)


def ace_fields(ace: str) -> list[str]:
    f = ace.split(";")
    while len(f) < 6:
        f.append("")
    return f


def resolve_sid(token: str, domain_sid: str | None) -> str:
    t = token.strip()
    if t.upper().startswith("S-"):
        return t.upper()
    if t.upper() in WELL_KNOWN:
        return WELL_KNOWN[t.upper()]
    if t.upper() in DOMAIN_RID and domain_sid:
        return f"{domain_sid}-{DOMAIN_RID[t.upper()]}"
    return t.upper()


def insert_deny_aces(sddl: str, aces: list[str]) -> str:
    """Put deny ACEs at the front of the DACL, skipping ones already present."""
    parts = split(sddl)
    flags, cur = dacl_flags_and_aces(parts.get("D", ""))
    cur_u = {a.upper() for a in cur}
    new = [a for a in aces if a.upper() not in cur_u]
    parts["D"] = build_dacl(flags, new + cur)
    return join(parts)


def cannot_change_password(sddl: str) -> str:
    return insert_deny_aces(sddl, [f"OD;;CR;{USER_CHANGE_PASSWORD};;PS",
                                   f"OD;;CR;{USER_CHANGE_PASSWORD};;WD"])


def is_protected_from_deletion(sddl: str) -> bool:
    _, aces = dacl_flags_and_aces(split(sddl).get("D", ""))
    for a in aces:
        f = ace_fields(a)
        if f[0].upper() == "D" and f[5].upper() in ("WD", "S-1-1-0") and ("DT" in f[2].upper() or "SD" in f[2].upper()):
            return True
    return False


def remove_deletion_protection(sddl: str) -> str:
    parts = split(sddl)
    flags, aces = dacl_flags_and_aces(parts.get("D", ""))
    keep = []
    for a in aces:
        f = ace_fields(a)
        if f[0].upper() == "D" and f[5].upper() in ("WD", "S-1-1-0") and ("DT" in f[2].upper() or "SD" in f[2].upper()):
            continue
        keep.append(a)
    parts["D"] = build_dacl(flags, keep)
    return join(parts)


def _rights(r: str) -> set[str]:
    r = r.upper()
    if r.startswith("0X"):
        return {r}
    return {r[i:i + 2] for i in range(0, len(r), 2)}


def gpo_permissions(sddl: str, domain_sid: str | None = None) -> list[dict]:
    """Classify explicit ACEs per trustee SID into GPMC permission levels.
    Returns [{"sid","permission","denied"}]."""
    _, aces = dacl_flags_and_aces(split(sddl).get("D", ""))
    per: dict[str, dict] = {}
    for a in aces:
        f = ace_fields(a)
        typ, flg, rights, obj = f[0].upper(), f[1].upper(), f[2], f[3].lower()
        if "ID" in flg or "IO" in flg:
            continue
        sid = resolve_sid(f[5], domain_sid)
        d = per.setdefault(sid, {"rights": set(), "apply": False, "denied": False})
        if typ in ("D", "OD"):
            d["denied"] = True
            if obj == APPLY_GROUP_POLICY or (typ == "D" and "CR" in _rights(rights)):
                d["denyApply"] = True
            continue
        if typ == "OA" and obj == APPLY_GROUP_POLICY:
            d["apply"] = True
            continue
        if typ == "A":
            r = _rights(rights)
            d["rights"] |= r
            if "CR" in r or "GA" in r:
                d["apply"] = True
    out = []
    full, edit, read = _rights(GPO_FULL_RIGHTS), _rights(GPO_EDIT_RIGHTS), _rights(GPO_READ_RIGHTS)
    for sid, d in per.items():
        r = d["rights"]
        if "GA" in r or full <= r:
            perm = "GpoEditDeleteModifySecurity"
        elif edit <= r:
            perm = "GpoEdit"
        elif (read <= r or "GR" in r) and d["apply"]:
            perm = "GpoApply"
        elif read <= r or "GR" in r:
            perm = "GpoRead"
        elif d["denied"]:
            perm = "None"
        else:
            perm = "Custom"
        out.append({"sid": sid, "permission": perm, "denied": d["denied"]})
    return out


def aces_for_permission(sid: str, permission: str) -> list[str]:
    # Container inherit (CI) so the User and Machine child containers follow.
    if permission == "GpoRead":
        return [f"A;CI;{GPO_READ_RIGHTS};;;{sid}"]
    if permission == "GpoApply":
        return [f"A;CI;{GPO_READ_RIGHTS};;;{sid}", f"OA;CI;CR;{APPLY_GROUP_POLICY};;{sid}"]
    if permission == "GpoEdit":
        return [f"A;CI;{GPO_EDIT_RIGHTS};;;{sid}"]
    if permission == "GpoEditDeleteModifySecurity":
        return [f"A;CI;{GPO_FULL_RIGHTS};;;{sid}"]
    if permission == "None":
        return []
    raise ValueError("unknown permission level")


def set_gpo_permission(sddl: str, sid: str, permission: str, replace: bool = True,
                       domain_sid: str | None = None) -> str:
    """Set the permission level for sid. replace=True drops existing explicit
    ACEs for that trustee first (GPMC behaviour)."""
    parts = split(sddl)
    flags, aces = dacl_flags_and_aces(parts.get("D", ""))
    sid_u = sid.upper()
    if replace or permission == "None":
        kept = []
        for a in aces:
            f = ace_fields(a)
            if "ID" not in f[1].upper() and resolve_sid(f[5], domain_sid) == sid_u:
                continue
            kept.append(a)
        aces = kept
    new = aces_for_permission(sid_u, permission)
    # Allow ACEs go after explicit deny ACEs and before inherited ones.
    idx = 0
    for i, a in enumerate(aces):
        f = ace_fields(a)
        if "ID" in f[1].upper():
            break
        idx = i + 1
    aces = aces[:idx] + [n for n in new if n.upper() not in {x.upper() for x in aces}] + aces[idx:]
    parts["D"] = build_dacl(flags, aces)
    return join(parts)


def inherit_sddl(parent_sddl: str, is_dir: bool) -> str:
    """Compute the SDDL a new child object gets from its parent folder,
    following Windows inheritance rules for the DACL:

    files take ACEs with OI; folders take ACEs with CI (keeping OI/CI so
    they propagate further, unless NP) and ACEs with only OI as inherit
    only. Inherited ACEs get the ID flag. CREATOR OWNER / CREATOR GROUP
    entries are replaced by the owner / group for the effective ACE.
    Owner and group are copied from the parent."""
    parts = split(parent_sddl)
    _, aces = dacl_flags_and_aces(parts.get("D", ""))
    owner, group = parts.get("O"), parts.get("G")
    out = []
    for a in aces:
        f = ace_fields(a)
        flags = f[1].upper()
        fl = {flags[i:i + 2] for i in range(0, len(flags), 2)}
        oi, ci, np_ = "OI" in fl, "CI" in fl, "NP" in fl
        if not (oi or ci):
            continue
        if not is_dir:
            if not oi:
                continue
            new_fl = ["ID"]
            g = list(f)
            if g[5].upper() == "CO" and owner:
                g[5] = owner
            elif g[5].upper() == "CG" and group:
                g[5] = group
            g[1] = "".join(new_fl)
            out.append(";".join(g))
            continue
        # directory
        if ci:
            effective = list(f)
            if np_:
                effective[1] = "ID"
            else:
                keep = [x for x in ("OI", "CI") if x in fl]
                effective[1] = "".join(keep) + "ID"
            if effective[5].upper() in ("CO", "CG"):
                # effective ACE for the creator plus an inherit only template
                sub = owner if effective[5].upper() == "CO" else group
                if sub:
                    e2 = list(f)
                    e2[5] = sub
                    e2[1] = "ID"
                    out.append(";".join(e2))
                if not np_:
                    t = list(f)
                    t[1] = "".join(x for x in ("OI", "CI") if x in fl) + "IOID"
                    out.append(";".join(t))
                continue
            out.append(";".join(effective))
        elif oi and not np_:
            t = list(f)
            t[1] = "OIIOID"
            out.append(";".join(t))
    res = {}
    if owner:
        res["O"] = owner
    if group:
        res["G"] = group
    res["D"] = "AI" + "".join(f"({a})" for a in out)
    return join(res)
