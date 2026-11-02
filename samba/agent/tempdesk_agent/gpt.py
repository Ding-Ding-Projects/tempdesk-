"""Pure helpers for Group Policy metadata: GPT.INI versions, client side
extension (CSE) lists and gPLink strings."""

from __future__ import annotations

import re

# Client side extension pairs [{CSE}{admin tool}]
REGISTRY_CSE = "{35378EAA-683F-11D2-A89A-00C04FBBCFA2}"
REGISTRY_TOOL_MACHINE = "{D02B1F72-3407-48AE-BA88-E8213C6761F1}"
REGISTRY_TOOL_USER = "{D02B1F73-3407-48AE-BA88-E8213C6761F1}"
SECURITY_CSE = "{827D319E-6EAC-11D2-A4EA-00C04F79F83A}"
SECURITY_TOOL = "{803E14A0-B4FB-11D0-A0D0-00A0C90F574B}"

GPO_FLAG_USER_DISABLED = 1
GPO_FLAG_MACHINE_DISABLED = 2

STATUS_BY_FLAGS = {
    0: "AllSettingsEnabled",
    1: "UserSettingsDisabled",
    2: "ComputerSettingsDisabled",
    3: "AllSettingsDisabled",
}
FLAGS_BY_STATUS = {v: k for k, v in STATUS_BY_FLAGS.items()}

LINK_DISABLED = 1
LINK_ENFORCED = 2


# --------------------------------------------------------------------------
# Version numbers. versionNumber = (user << 16) | machine, each 16 bits.

def split_version(v: int) -> tuple[int, int]:
    v = int(v) & 0xFFFFFFFF
    return (v >> 16) & 0xFFFF, v & 0xFFFF


def bump_version(v: int, machine: bool = False, user: bool = False) -> int:
    u, m = split_version(v)
    if machine:
        m = (m + 1) & 0xFFFF
        if m == 0:
            m = 1
    if user:
        u = (u + 1) & 0xFFFF
        if u == 0:
            u = 1
    return (u << 16) | m


def read_gpt_ini_version(text: str) -> int:
    m = re.search(r"^\s*Version\s*=\s*(\d+)\s*$", text, re.M | re.I)
    return int(m.group(1)) if m else 0


def set_gpt_ini_version(text: str, version: int) -> str:
    """Return GPT.INI text with Version= updated (other lines preserved)."""
    if not text.strip():
        return f"[General]\r\nVersion={version}\r\n"
    if re.search(r"^\s*Version\s*=", text, re.M | re.I):
        return re.sub(r"^(\s*Version\s*=\s*)\d*", lambda m: m.group(1) + str(version),
                      text, count=1, flags=re.M | re.I)
    # Insert after [General] header, or add header
    m = re.search(r"^\s*\[General\]\s*$", text, re.M | re.I)
    nl = "\r\n" if "\r\n" in text else "\n"
    if m:
        i = m.end()
        return text[:i] + nl + f"Version={version}" + text[i:]
    return f"[General]{nl}Version={version}{nl}" + text


# --------------------------------------------------------------------------
# gPCMachineExtensionNames / gPCUserExtensionNames

_GUID = r"\{[0-9A-Fa-f-]{36}\}"


def parse_cse_list(s: str | None) -> list[list[str]]:
    """Parse "[{a}{b}][{c}{d}{e}]" into [["{a}","{b}"], ["{c}","{d}","{e}"]]."""
    out = []
    if not s:
        return out
    for grp in re.findall(r"\[([^\]]*)\]", s):
        guids = re.findall(_GUID, grp)
        if guids:
            out.append(guids)
    return out


def format_cse_list(groups: list[list[str]]) -> str:
    return "".join("[" + "".join(g) + "]" for g in groups)


def merge_cse(s: str | None, cse: str, tool: str) -> str:
    """Add the pair cse/tool, merging tool GUIDs per CSE, sorted the way
    Windows sorts them (by upper case GUID string)."""
    table: dict[str, set[str]] = {}
    for g in parse_cse_list(s):
        head, tools = g[0].upper(), {t.upper() for t in g[1:]}
        table.setdefault(head, set()).update(tools)
    table.setdefault(cse.upper(), set()).add(tool.upper())
    groups = []
    for head in sorted(table):
        groups.append([head] + sorted(table[head]))
    return format_cse_list(groups)


def remove_cse(s: str | None, cse: str) -> str:
    groups = [g for g in parse_cse_list(s) if g[0].upper() != cse.upper()]
    return format_cse_list(groups)


# --------------------------------------------------------------------------
# gPLink

_LINK_RE = re.compile(r"\[\s*LDAP://([^;\]]+);\s*(\d+)\s*\]", re.I)


def parse_gplink(s: str | None) -> list[dict]:
    """Parse a gPLink value into [{"dn","options"}] in attribute order.

    In the attribute string the last entry has the highest precedence
    (link order 1), new links are prepended."""
    if not s:
        return []
    return [{"dn": m.group(1).strip(), "options": int(m.group(2))} for m in _LINK_RE.finditer(s)]


def format_gplink(links: list[dict]) -> str:
    return "".join(f"[LDAP://{l['dn']};{int(l['options'])}]" for l in links)


def gpo_guid_from_dn(dn: str) -> str | None:
    m = re.match(r"\s*cn=(\{[0-9A-Fa-f-]{36}\})\s*,", dn, re.I)
    return m.group(1).upper() if m else None


def links_with_order(links: list[dict]) -> list[dict]:
    """Annotate parsed links with enabled/enforced/order (1 = highest)."""
    n = len(links)
    out = []
    for i, l in enumerate(links):
        out.append({
            "dn": l["dn"],
            "guid": gpo_guid_from_dn(l["dn"]),
            "enabled": not (l["options"] & LINK_DISABLED),
            "enforced": bool(l["options"] & LINK_ENFORCED),
            "order": n - i,
        })
    return out


def set_link(links: list[dict], gpo_dn: str, enabled: bool = True, enforced: bool = False,
             order: int | None = None) -> list[dict]:
    """Insert or update the link to gpo_dn. order is 1 based (1 = highest
    precedence). Existing links keep their order unless order is given;
    new links without order get the lowest precedence."""
    guid = gpo_guid_from_dn(gpo_dn)
    opts = (0 if enabled else LINK_DISABLED) | (LINK_ENFORCED if enforced else 0)
    existing = None
    rest = []
    for l in links:
        if guid and gpo_guid_from_dn(l["dn"]) == guid:
            existing = l
        else:
            rest.append(l)
    entry = {"dn": existing["dn"] if existing else gpo_dn, "options": opts}
    if order is None:
        if existing is not None:
            idx = links.index(existing)
            out = list(links)
            out[idx] = entry
            return out
        return [entry] + rest
    # Work in precedence order (index 0 = order 1), then reverse.
    prec = list(reversed(rest))
    pos = max(0, min(int(order) - 1, len(prec)))
    prec.insert(pos, entry)
    return list(reversed(prec))


def remove_link(links: list[dict], gpo_guid: str) -> list[dict]:
    g = gpo_guid.upper()
    return [l for l in links if gpo_guid_from_dn(l["dn"]) != g]
