"""Navigation registry shared by the nav rail, the bottom bar and the command palette.

Other modules (for example app/server_routes.py) may append to NAV_ITEMS or
PALETTE_ACTIONS at import time. Each item is a dict:

    {"id": "server-overview", "label": "Server overview", "href": "/server",
     "icon": "server", "capability": "server", "group": "Server"}

capability: an id from /health "capabilities", or None for always shown.
group: heading used in the palette and the "More" sections of the rail.
primary: True puts the item on the nav rail and bottom bar (keep it to 5 or 6).
keywords: extra words the palette and settings search match on.
"""

from __future__ import annotations

NAV_ITEMS: list[dict] = [
    {"id": "dashboard", "label": "Dashboard", "href": "/", "icon": "home", "capability": None, "group": "General", "primary": True},
    {"id": "guests", "label": "Guests", "href": "/guests", "icon": "person", "capability": "guest", "group": "General", "primary": True},
    {"id": "directory", "label": "Directory", "href": "/directory", "icon": "tree", "capability": "directory", "group": "Directory", "primary": True},
    {"id": "search", "label": "LDAP search", "href": "/directory/search", "icon": "search", "capability": "directory", "group": "Directory"},
    {"id": "dir-create", "label": "Create directory object", "href": "/directory/create", "icon": "add", "capability": "directory", "group": "Directory"},
    {"id": "gpo", "label": "Group Policy", "href": "/gpo", "icon": "policy", "capability": "gpo", "group": "Group Policy", "primary": True},
    {"id": "gpo-backups", "label": "Policy backups", "href": "/gpo/backups", "icon": "backup", "capability": "gpo-backup", "group": "Group Policy"},
    {"id": "gpo-wmi", "label": "WMI filters", "href": "/gpo/wmi", "icon": "filter", "capability": "wmifilters", "group": "Group Policy"},
    {"id": "gpo-inheritance", "label": "Block inheritance", "href": "/gpo/inheritance", "icon": "block", "capability": "gpo", "group": "Group Policy"},
    {"id": "cmdlets", "label": "Cmdlet runner", "href": "/cmdlets", "icon": "terminal", "capability": "cmdlets", "group": "Tools"},
    {"id": "sambatool", "label": "samba-tool runner", "href": "/sambatool", "icon": "terminal", "capability": "samba-tool", "group": "Tools"},
    {"id": "wifi", "label": "Wi-Fi profiles", "href": "/wifi", "icon": "wifi", "capability": "wifi", "group": "Presetup"},
    {"id": "scripts", "label": "Startup and logon scripts", "href": "/scripts", "icon": "script", "capability": "scripts", "group": "Presetup"},
    {"id": "allowlist", "label": "App allowlist", "href": "/allowlist", "icon": "apps", "capability": "allowlist", "group": "Presetup"},
    {"id": "settings", "label": "Settings", "href": "/settings", "icon": "settings", "capability": None, "group": "Presetup", "primary": True},
    {"id": "audit", "label": "Audit log", "href": "/audit", "icon": "history", "capability": "audit", "group": "General"},
]

# Extra palette entries that are actions rather than pages.
PALETTE_ACTIONS: list[dict] = [
    {"id": "act-create-guest", "label": "Create a guest account", "href": "/guests#create", "capability": "guest", "group": "Actions"},
    {"id": "act-new-gpo", "label": "Create a Group Policy object", "href": "/gpo#create", "capability": "gpo", "group": "Actions"},
    {"id": "act-wording-upload", "label": "Upload personal wording file", "href": "/settings#wording", "capability": None, "group": "Personal wording", "keywords": "vocabulary json upload"},
    {"id": "act-wording-status", "label": "Personal wording status", "href": "/settings#wording-status", "capability": None, "group": "Personal wording", "keywords": "vocabulary loaded entries"},
    {"id": "act-wording-replace", "label": "Replace personal wording file", "href": "/settings#wording", "capability": None, "group": "Personal wording", "keywords": "vocabulary replace"},
    {"id": "act-wording-clear", "label": "Clear personal wording (restore original wording)", "href": "/settings#wording-clear", "capability": None, "group": "Personal wording", "keywords": "vocabulary reset remove"},
    {"id": "act-theme", "label": "Switch light or dark theme", "href": "#theme", "capability": None, "group": "Actions", "action": "theme"},
    {"id": "act-elevate", "label": "Confirm your password (elevation)", "href": "/auth/elevate", "capability": None, "group": "Actions"},
    {"id": "act-logout", "label": "Sign out", "href": "#logout", "capability": None, "group": "Actions", "action": "logout"},
]

GUEST_NAV: list[dict] = [
    {"id": "home", "label": "Create sign-in", "href": "/", "icon": "add", "capability": None, "group": "Guest", "primary": True},
    {"id": "check", "label": "Check my sign-in", "href": "/check", "icon": "search", "capability": None, "group": "Guest", "primary": True},
    {"id": "delete", "label": "Delete my sign-in", "href": "/delete", "icon": "delete", "capability": "self-delete", "group": "Guest", "primary": True},
]

GUEST_ACTIONS: list[dict] = [
    {"id": "act-theme", "label": "Switch light or dark theme", "href": "#theme", "capability": None, "group": "Actions", "action": "theme"},
    {"id": "act-print", "label": "Print this page", "href": "#print", "capability": None, "group": "Actions", "action": "print"},
]


def visible(items: list[dict], capabilities: set[str] | None) -> list[dict]:
    """Filter items by capability. When health is unknown (agent down) every
    item without a capability is kept and capability items are hidden."""
    caps = capabilities or set()
    return [i for i in items if not i.get("capability") or i["capability"] in caps]
