"""In-memory sample data and handlers for the full Group Policy editor, used
by fake_agent.py so the portal UI can be built against every GPME node.

It mirrors the agent contract: GET /gpo/{id}/tree, GET /gpo/nodes/schema,
form nodes GET/PUT /gpo/{id}/node/{nodeId}, and table/preference nodes
GET/POST/PATCH/DELETE /gpo/{id}/node/{nodeId}/items[/{itemId}].

Node ids use '.' as the separator (route paths split on '/'). A generated
ADMX catalog of several thousand realistic policies across the true category
tree shape backs /admx/categories, /admx/policies and /admx/stats. No real
ADMX files are shipped: the names are synthesized.
"""

from __future__ import annotations

import secrets

# ---------------------------------------------------------------------------
# Node tree (dotted ids), kept in step with the agent's GpoNodes tree.
# ---------------------------------------------------------------------------

_AD_OBJECT = {
    "machine.pol.win.sec.wired": "Wired (802.3) policies are AD objects (Windows backend only).",
    "machine.pol.win.sec.wireless": "Wireless (802.11) policies are AD objects (Windows backend only).",
    "machine.pol.win.sec.ipsec": "IP Security policies are AD objects (Windows backend only).",
}


def _n(nid, name, kind, cls, schema=None, children=None):
    return {"id": nid, "name": name, "kind": kind, "class": cls, "itemSchema": schema,
            "capability": None, "children": children or [],
            "available": nid not in _AD_OBJECT, "unavailableReason": _AD_OBJECT.get(nid)}


def _machine_security(p):
    s = p + ".pol.win.sec"
    return _n(s, "Security Settings", "container", "Machine", None, [
        _n(s + ".account", "Account Policies", "container", "Machine", None, [
            _n(s + ".account.password", "Password Policy", "form", "Machine", "sec-password"),
            _n(s + ".account.lockout", "Account Lockout Policy", "form", "Machine", "sec-lockout"),
            _n(s + ".account.kerberos", "Kerberos Policy", "form", "Machine", "sec-kerberos")]),
        _n(s + ".local", "Local Policies", "container", "Machine", None, [
            _n(s + ".local.audit", "Audit Policy", "form", "Machine", "sec-audit"),
            _n(s + ".local.rights", "User Rights Assignment", "table", "Machine", "sec-user-right"),
            _n(s + ".local.options", "Security Options", "table", "Machine", "sec-option")]),
        _n(s + ".eventlog", "Event Log", "form", "Machine", "sec-eventlog"),
        _n(s + ".restrictedgroups", "Restricted Groups", "table", "Machine", "sec-restricted-group"),
        _n(s + ".services", "System Services", "table", "Machine", "sec-system-service"),
        _n(s + ".registry", "Registry", "table", "Machine", "sec-registry-perm"),
        _n(s + ".filesystem", "File System", "table", "Machine", "sec-file-perm"),
        _n(s + ".wired", "Wired Network (IEEE 802.3) Policies", "table", "Machine", "wired-policy"),
        _n(s + ".firewall", "Windows Defender Firewall with Advanced Security", "container", "Machine", None, [
            _n(s + ".firewall.profiles", "Firewall Profiles", "form", "Machine", "firewall-profiles"),
            _n(s + ".firewall.inbound", "Inbound Rules", "table", "Machine", "firewall-rule"),
            _n(s + ".firewall.outbound", "Outbound Rules", "table", "Machine", "firewall-rule"),
            _n(s + ".firewall.csr", "Connection Security Rules", "table", "Machine", "firewall-csr")]),
        _n(s + ".netlist", "Network List Manager Policies", "table", "Machine", "netlist-policy"),
        _n(s + ".wireless", "Wireless Network (IEEE 802.11) Policies", "table", "Machine", "wireless-policy"),
        _n(s + ".pki", "Public Key Policies", "table", "Machine", "pki-trusted-cert"),
        _n(s + ".srp", "Software Restriction Policies", "table", "Machine", "srp-rule"),
        _n(s + ".applocker", "Application Control Policies (AppLocker)", "table", "Machine", "applocker-rule"),
        _n(s + ".ipsec", "IP Security Policies", "table", "Machine", "ipsec-policy"),
        _n(s + ".advaudit", "Advanced Audit Policy Configuration", "table", "Machine", "advanced-audit")])


_PREF_WIN = [("Applications", "Applications"), ("Drives", "Drive Maps"), ("EnvironmentVariables", "Environment"),
             ("Files", "Files"), ("Folders", "Folders"), ("IniFiles", "Ini Files"),
             ("NetworkShares", "Network Shares"), ("Registry", "Registry"), ("Shortcuts", "Shortcuts")]
_PREF_CP = [("DataSources", "Data Sources"), ("Devices", "Devices"), ("FolderOptions", "Folder Options"),
            ("InternetSettings", "Internet Settings"), ("LocalUsersAndGroups", "Local Users and Groups"),
            ("NetworkOptions", "Network Options"), ("PowerOptions", "Power Options"), ("Printers", "Printers"),
            ("RegionalOptions", "Regional Options"), ("ScheduledTasks", "Scheduled Tasks"),
            ("Services", "Services"), ("StartMenu", "Start Menu")]
_PREF_COMPUTER_ONLY = {"NetworkShares", "Services"}
_PREF_USER_ONLY = {"Drives", "InternetSettings", "RegionalOptions", "StartMenu"}


def _preferences(cls, p):
    def area_nodes(parent, areas):
        out = []
        for area, label in areas:
            if cls == "Machine" and area in _PREF_USER_ONLY:
                continue
            if cls == "User" and area in _PREF_COMPUTER_ONLY:
                continue
            out.append(_n(parent + "." + area.lower(), label, "preference-items", cls, "pref-" + area))
        return out

    return _n(p + ".pref", "Preferences", "container", cls, None, [
        _n(p + ".pref.win", "Windows Settings", "container", cls, None, area_nodes(p + ".pref.win", _PREF_WIN)),
        _n(p + ".pref.cp", "Control Panel Settings", "container", cls, None, area_nodes(p + ".pref.cp", _PREF_CP))])


def _class_tree(cls, p, label):
    if cls == "Machine":
        win = _n(p + ".pol.win", "Windows Settings", "container", cls, None, [
            _n(p + ".pol.win.scripts", "Scripts (Startup/Shutdown)", "container", cls, None, [
                _n(p + ".pol.win.scripts.startup", "Startup", "script-list", cls, "script-entry"),
                _n(p + ".pol.win.scripts.shutdown", "Shutdown", "script-list", cls, "script-entry")]),
            _machine_security(p),
            _n(p + ".pol.win.qos", "Policy-based QoS", "table", cls, "qos-policy"),
            _n(p + ".pol.win.printers", "Deployed Printers", "table", cls, "deployed-printer")])
        pol_children = [
            _n(p + ".pol.sw", "Software Settings", "container", cls, None, [
                _n(p + ".pol.sw.install", "Software installation", "table", cls, "software-installation")]),
            win,
            _n(p + ".pol.nrpt", "Name Resolution Policy", "table", cls, "nrpt-rule"),
            _n(p + ".pol.admx", "Administrative Templates", "admx", cls)]
    else:
        win = _n(p + ".pol.win", "Windows Settings", "container", cls, None, [
            _n(p + ".pol.win.scripts", "Scripts (Logon/Logoff)", "container", cls, None, [
                _n(p + ".pol.win.scripts.logon", "Logon", "script-list", cls, "script-entry"),
                _n(p + ".pol.win.scripts.logoff", "Logoff", "script-list", cls, "script-entry")]),
            _n(p + ".pol.win.sec", "Security Settings", "container", cls, None, [
                _n(p + ".pol.win.sec.pki", "Public Key Policies", "table", cls, "pki-trusted-cert"),
                _n(p + ".pol.win.sec.srp", "Software Restriction Policies", "table", cls, "srp-rule")]),
            _n(p + ".pol.win.qos", "Policy-based QoS", "table", cls, "qos-policy"),
            _n(p + ".pol.win.printers", "Deployed Printers", "table", cls, "deployed-printer"),
            _n(p + ".pol.win.folderredir", "Folder Redirection", "table", cls, "folder-redirection")])
        pol_children = [
            _n(p + ".pol.sw", "Software Settings", "container", cls, None, [
                _n(p + ".pol.sw.install", "Software installation", "table", cls, "software-installation")]),
            win,
            _n(p + ".pol.admx", "Administrative Templates", "admx", cls)]
    return _n(p, label, "container", cls, None, [
        _n(p + ".pol", "Policies", "container", cls, None, pol_children),
        _preferences(cls, p)])


def tree():
    return [_class_tree("Machine", "machine", "Computer Configuration"),
            _class_tree("User", "user", "User Configuration")]


def _index(nodes, out):
    for n in nodes:
        out[n["id"]] = n
        _index(n.get("children", []), out)
    return out


NODE_INDEX = _index(tree(), {})


# ---------------------------------------------------------------------------
# Item schemas (a representative subset with the exact ids the agent uses; the
# portal renders controls from these). Kept intentionally compact but with the
# rich bits — enums with per-value descriptions, the GPP common/targeting
# blocks — so the UI can exercise them.
# ---------------------------------------------------------------------------

def _f(fid, label, ftype, help_="", **extra):
    return {"id": fid, "label": label, "type": ftype, "help": help_, **extra}


def _enum(fid, label, values, help_=""):
    return {"id": fid, "label": label, "type": "enum", "help": help_,
            "values": [{"value": v[0], "label": v[1], "description": v[2] if len(v) > 2 else ""} for v in values]}


_ACTION = _enum("action", "Action", [
    ("C", "Create", "Create the item if it does not exist."),
    ("R", "Replace", "Delete and recreate the item."),
    ("U", "Update", "Create if absent, otherwise modify."),
    ("D", "Delete", "Remove the item.")], "GPP action verb.")

_TARGETING = {
    "combiners": ["AND", "OR"], "supportsNot": True, "supportsCollections": True,
    "items": [
        {"type": "FilterGroup", "label": "Security group", "attributes": ["name", "sid", "userContext", "primaryGroup", "localGroup"]},
        {"type": "FilterOrgUnit", "label": "Organizational unit", "attributes": ["name", "userContext", "directMember"]},
        {"type": "FilterComputer", "label": "Computer name", "attributes": ["name", "type"]},
        {"type": "FilterIpRange", "label": "IP address range", "attributes": ["min", "max"]},
        {"type": "FilterOs", "label": "Operating system", "attributes": ["class", "version", "type", "edition", "sp"]},
        {"type": "FilterWMI", "label": "WMI query", "attributes": ["query", "nameSpace", "variableName", "property"]},
        {"type": "FilterRegistry", "label": "Registry match", "attributes": ["type", "subtype", "valueType", "valueName", "valueData", "key", "hive"]},
        {"type": "FilterFile", "label": "File match", "attributes": ["path", "type", "min", "max"]},
        {"type": "FilterLanguage", "label": "Language", "attributes": ["language", "locale"]},
        {"type": "FilterBattery", "label": "Battery present", "attributes": []},
        {"type": "FilterTime", "label": "Time range", "attributes": ["begin", "end"]},
    ],
}
_COMMON = {
    "options": [
        _f("bypassErrors", "Stop processing on error", "bool", default=False),
        _f("userContext", "Run as the logged-on user", "bool", default=False),
        _f("removePolicy", "Remove when no longer applied", "bool", default=False),
        _f("applyOnce", "Apply once", "bool", default=False),
    ],
    "targeting": _TARGETING,
}


def _schemas():
    s = {}

    def add(sid, kind, fields, **extra):
        s[sid] = {"id": sid, "kind": kind, "fields": fields, **extra}

    add("sec-password", "form", [
        _f("MinimumPasswordLength", "Minimum password length", "int", default=7),
        _f("PasswordComplexity", "Complexity requirements", "bool01", default=True),
        _f("MaximumPasswordAge", "Maximum password age (days)", "int", default=42)])
    add("sec-lockout", "form", [
        _f("LockoutBadCount", "Account lockout threshold", "int", default=0),
        _f("LockoutDuration", "Lockout duration (min)", "int", default=30),
        _f("ResetLockoutCount", "Reset counter after (min)", "int", default=30)])
    add("sec-kerberos", "form", [
        _f("MaxTicketAge", "Max user ticket lifetime (hours)", "int", default=10),
        _f("MaxServiceAge", "Max service ticket lifetime (min)", "int", default=600)])
    audit_vals = [("0", "No auditing"), ("1", "Success"), ("2", "Failure"), ("3", "Success and Failure")]
    add("sec-audit", "form", [_enum(k, k, audit_vals) for k in
        ["AuditSystemEvents", "AuditLogonEvents", "AuditObjectAccess", "AuditPrivilegeUse",
         "AuditPolicyChange", "AuditAccountManage", "AuditProcessTracking", "AuditDSAccess", "AuditAccountLogon"]])
    add("sec-eventlog", "form", [_f("MaximumSecurityLogSize", "Max security log size (KB)", "int")])
    add("sec-user-right", "table", [
        _f("right", "User right", "string"), _f("accounts", "Assigned accounts", "accountList")])
    add("sec-option", "table", [
        _f("key", "Registry value path", "string"),
        _enum("regType", "Value type", [("1", "String"), ("4", "DWord"), ("7", "Multi-string")]),
        _f("value", "Value", "string")])
    add("sec-restricted-group", "table", [
        _f("group", "Group", "string"), _f("members", "Members", "accountList"), _f("memberOf", "Member of", "accountList")])
    add("sec-system-service", "table", [
        _f("service", "Service name", "string"),
        _enum("startup", "Startup mode", [("2", "Automatic"), ("3", "Manual"), ("4", "Disabled")]),
        _f("sddl", "Permissions (SDDL)", "sddl")])
    add("sec-registry-perm", "table", [_f("key", "Registry key", "string"), _f("sddl", "Permissions (SDDL)", "sddl")])
    add("sec-file-perm", "table", [_f("path", "Path", "string"), _f("sddl", "Permissions (SDDL)", "sddl")])
    add("advanced-audit", "table", [
        _f("subcategory", "Subcategory", "string"), _f("subcategoryGuid", "Subcategory GUID", "string"),
        _f("policyTarget", "Policy target", "string"), _enum("settingValue", "Setting", audit_vals)])
    fw_profile = []
    for prof in ("Domain", "Private", "Public"):
        fw_profile.append(_enum(prof + "State", prof + " firewall state", [("1", "On"), ("0", "Off")]))
        fw_profile.append(_enum(prof + "Inbound", prof + " inbound", [("1", "Block (default)"), ("0", "Allow"), ("2", "Block all")]))
        fw_profile.append(_enum(prof + "Outbound", prof + " outbound", [("0", "Allow (default)"), ("1", "Block")]))
    add("firewall-profiles", "form", fw_profile)
    add("firewall-rule", "table", [
        _f("name", "Name", "string"), _f("description", "Description", "string"),
        _enum("action", "Action", [("Allow", "Allow"), ("Block", "Block")]),
        _enum("direction", "Direction", [("In", "Inbound"), ("Out", "Outbound")]),
        _f("active", "Enabled", "bool", default=True), _f("protocol", "Protocol number", "string"),
        _f("localPorts", "Local ports", "string"), _f("remotePorts", "Remote ports", "string"),
        _f("localAddresses", "Local addresses", "string"), _f("remoteAddresses", "Remote addresses", "string"),
        _f("application", "Program path", "string"), _f("service", "Service", "string"),
        _enum("profiles", "Profiles", [("", "All"), ("Domain", "Domain"), ("Private", "Private"), ("Public", "Public")]),
        _f("edge", "Edge traversal", "bool", default=False)])
    add("firewall-csr", "table", [_f("name", "Name", "string"), _f("rule", "Rule string", "string"), _f("active", "Enabled", "bool", default=True)])
    add("nrpt-rule", "table", [
        _f("ruleName", "Rule name", "string"), _f("name", "Namespace / suffix", "string"),
        _f("genericDnsServers", "DNS servers", "string"),
        _enum("configOptions", "Configuration", [("8", "Generic DNS server"), ("2", "DNSSEC"), ("4", "DirectAccess")])])
    add("qos-policy", "table", [
        _f("name", "Policy name", "string"), _f("appName", "Application", "string"),
        _f("dscpValue", "DSCP value", "int", default=-1), _f("protocol", "Protocol", "string"),
        _f("localPort", "Source port(s)", "string"), _f("remotePort", "Destination port(s)", "string"),
        _f("throttleRate", "Throttle rate", "string")])
    add("deployed-printer", "table", [
        _f("uncName", "Printer connection (UNC)", "string"), _f("printerName", "Printer name", "string"),
        _f("serverName", "Server name", "string")])
    known_folders = [("{FDD39AD0-238F-46AF-ADB4-6C85480369C7}", "Documents"),
                     ("{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}", "Desktop"),
                     ("{33E28130-4E1E-4676-835A-98395C3BC3BB}", "Pictures")]
    add("folder-redirection", "table", [
        _enum("folder", "Folder", known_folders), _f("securityGroup", "Security group SID", "string"),
        _f("fullPath", "Target path", "string"), _f("flags", "Flags", "string", default="1001")])
    add("wireless-policy", "table", [_f("name", "Policy name", "string"), _f("description", "Description", "string"), _f("xml", "WLAN profile XML", "xml")])
    add("wired-policy", "table", [_f("name", "Policy name", "string"), _f("description", "Description", "string"), _f("xml", "LAN profile XML", "xml")])
    add("netlist-policy", "table", [
        _f("network", "Network", "string"),
        _enum("category", "Network location", [("0", "Public"), ("1", "Private"), ("2", "Domain authenticated")]),
        _f("name", "Name", "string")])
    add("pki-trusted-cert", "table", [
        _enum("store", "Store", [("Root", "Trusted Root CAs"), ("CA", "Intermediate CAs"), ("Trust", "Enterprise Trust")]),
        _f("thumbprint", "Thumbprint", "string"), _f("certificate", "Certificate (base64 DER)", "string"),
        _f("autoEnrollment", "Enable auto-enrollment", "bool", default=False)])
    add("srp-rule", "table", [
        _enum("ruleType", "Rule type", [("path", "Path"), ("hash", "Hash"), ("cert", "Certificate"), ("zone", "Zone")]),
        _f("value", "Value", "string"),
        _enum("securityLevel", "Security level", [("0", "Disallowed"), ("262144", "Basic User"), ("131072", "Unrestricted")])])
    add("applocker-rule", "table", [
        _enum("collection", "Collection", [("Exe", "Executable"), ("Msi", "Installer"), ("Script", "Script"), ("Appx", "Packaged app"), ("Dll", "DLL")]),
        _enum("enforcementMode", "Enforcement", [("NotConfigured", "Not configured"), ("Enabled", "Enforce"), ("AuditOnly", "Audit only")]),
        _f("ruleXml", "Rule XML", "xml")])
    add("ipsec-policy", "table", [_f("name", "Policy name", "string"), _f("description", "Description", "string"), _f("assigned", "Assigned", "bool", default=False)])
    add("software-installation", "table", [
        _f("name", "Package name", "string"), _f("path", "Package path (UNC .msi)", "string"),
        _enum("deploymentType", "Deployment", [("A", "Assigned", "Install automatically."), ("P", "Published", "Available to install.")]),
        _f("productCode", "Product code", "string")])
    add("script-entry", "table", [
        _f("script", "Script name or path", "string"), _f("parameters", "Parameters", "string"),
        _f("powershell", "PowerShell script", "bool", default=False), _f("content", "Script content", "text")])

    # GPP preference item schemas with common + targeting.
    pref_fields = {
        "Drives": [_ACTION, _f("path", "Location (UNC path)", "string"), _f("letter", "Drive letter", "string"),
                   _f("label", "Label", "string"), _f("persistent", "Reconnect", "bool", default=True)],
        "Registry": [_ACTION, _enum("hive", "Hive", [("HKEY_LOCAL_MACHINE", "HKLM"), ("HKEY_CURRENT_USER", "HKCU")]),
                     _f("key", "Key", "string"), _f("name", "Value name", "string"),
                     _enum("type", "Type", [("REG_SZ", "String"), ("REG_DWORD", "DWord"), ("REG_MULTI_SZ", "Multi-string")]),
                     _f("value", "Value", "string")],
        "Shortcuts": [_ACTION, _f("shortcutPath", "Shortcut location", "string"),
                      _enum("targetType", "Target type", [("FILESYSTEM", "File/folder"), ("URL", "URL"), ("SHELL", "Shell object")]),
                      _f("targetPath", "Target", "string"), _f("arguments", "Arguments", "string")],
        "EnvironmentVariables": [_ACTION, _f("name", "Variable", "string"), _f("value", "Value", "string"),
                                 _f("user", "User variable", "bool", default=True)],
        "Files": [_ACTION, _f("fromPath", "Source", "string"), _f("targetPath", "Destination", "string")],
        "Folders": [_ACTION, _f("path", "Folder path", "string")],
        "IniFiles": [_ACTION, _f("path", "INI file", "string"), _f("section", "Section", "string"),
                     _f("property", "Property", "string"), _f("value", "Value", "string")],
        "NetworkShares": [_ACTION, _f("name", "Share name", "string"), _f("path", "Folder path", "string")],
        "Applications": [_ACTION, _f("name", "Application", "string")],
        "DataSources": [_ACTION, _f("dsn", "DSN", "string"), _f("driver", "Driver", "string")],
        "Devices": [_enum("deviceAction", "Action", [("ENABLE", "Enable"), ("DISABLE", "Disable")]),
                    _f("deviceClass", "Device class", "string")],
        "FolderOptions": [_ACTION, _f("fileExtension", "Extension", "string"), _f("applicationPath", "Program", "string")],
        "InternetSettings": [_f("name", "Settings set", "string"), _f("proxyServer", "Proxy server", "string"),
                             _f("proxyEnable", "Use a proxy", "bool", default=False), _f("homePage", "Home page", "string")],
        "LocalUsersAndGroups": [_ACTION, _enum("itemType", "Item type", [("group", "Group"), ("user", "User")]),
                                _f("groupName", "Group name", "string"), _f("members", "Members", "string")],
        "NetworkOptions": [_ACTION, _enum("connType", "Type", [("VPN", "VPN"), ("DUN", "Dial-up")]), _f("name", "Name", "string")],
        "PowerOptions": [_ACTION, _f("name", "Scheme name", "string"), _f("default", "Active scheme", "bool", default=False)],
        "Printers": [_ACTION, _enum("printerType", "Type", [("SharedPrinter", "Shared"), ("PortPrinter", "TCP/IP"), ("LocalPrinter", "Local")]),
                     _f("path", "Printer path", "string"), _f("default", "Default printer", "bool", default=False)],
        "RegionalOptions": [_f("localeId", "Locale ID", "string"), _f("localeName", "Locale name", "string")],
        "ScheduledTasks": [_ACTION, _enum("taskType", "Task type", [("TaskV2", "Task (Vista+)"), ("ImmediateTaskV2", "Immediate (Vista+)")]),
                           _f("name", "Task name", "string"), _f("appName", "Program", "string"), _f("args", "Arguments", "string")],
        "Services": [_enum("startupType", "Startup", [("NOCHANGE", "No change"), ("AUTOMATIC", "Automatic"), ("MANUAL", "Manual"), ("DISABLED", "Disabled")]),
                     _f("serviceName", "Service name", "string")],
        "StartMenu": [_f("name", "Settings set", "string"), _f("minMFU", "Programs on Start menu", "int", default=6)],
    }
    for area, fields in pref_fields.items():
        s["pref-" + area] = {"id": "pref-" + area, "kind": "preference-items", "fields": fields,
                             "common": _COMMON, "area": area}
    return s


SCHEMAS = _schemas()


# ---------------------------------------------------------------------------
# Generated ADMX catalog: a realistic category tree and several thousand
# synthetic policies. Names are invented, not from any real ADMX file.
# ---------------------------------------------------------------------------

_CAT_TOP = [
    "System", "Administrative Templates", "Windows Components", "Network", "Control Panel",
    "Printers", "Start Menu and Taskbar", "Desktop", "Shared Folders", "Server",
]
_CAT_SUB = {
    "System": ["Logon", "Group Policy", "Power Management", "Device Installation", "Kerberos",
               "User Profiles", "Scripts", "Internet Communication Management", "Storage Health", "Credentials Delegation"],
    "Windows Components": ["Windows Update", "Microsoft Defender Antivirus", "BitLocker Drive Encryption",
                           "Remote Desktop Services", "Windows Firewall", "Microsoft Edge", "File Explorer",
                           "Windows Installer", "Event Logging", "Cloud Content", "Search", "Store"],
    "Network": ["DNS Client", "Background Intelligent Transfer Service", "Lanman Workstation",
                "Network Connections", "QoS Packet Scheduler", "TCPIP Settings", "Windows Connection Manager"],
    "Control Panel": ["Personalization", "Regional and Language Options", "Programs", "Display", "Add or Remove Programs"],
}
_VERBS = ["Allow", "Prevent", "Configure", "Enable", "Disable", "Turn off", "Turn on", "Require",
          "Specify", "Restrict", "Do not allow", "Set", "Hide", "Remove"]
_OBJECTS = ["automatic updates", "the lock screen", "background tasks", "driver installation",
            "telemetry collection", "password reveal button", "removable storage access",
            "the command prompt", "Control Panel", "network discovery", "scheduled scans",
            "cloud protection", "the Run menu", "toast notifications", "roaming profiles",
            "offline files", "clipboard history", "camera access", "location services",
            "the Microsoft Store", "legacy protocols", "SMBv1", "guest logons", "cached credentials"]
_ELEM_KINDS = ["boolean", "decimal", "text", "multiText", "enum", "list"]


def generate_admx(seed=20260101, target=3600):
    """Build categories and policies deterministically so the UI sees a stable
    catalog of several thousand policies across the real category tree shape."""
    rnd = __import__("random").Random(seed)
    categories = []
    policies = []
    cat_ids = []

    for top in _CAT_TOP:
        top_id = "Fake.Policies.%s:%s" % (top.replace(" ", ""), top.replace(" ", ""))
        categories.append({"id": top_id, "name": top, "parentId": None, "explain": f"{top} policy settings."})
        subs = _CAT_SUB.get(top, ["General"])
        for sub in subs:
            sub_id = "Fake.Policies.%s:%s" % (top.replace(" ", ""), sub.replace(" ", ""))
            categories.append({"id": sub_id, "name": sub, "parentId": top_id, "explain": f"{sub} settings under {top}."})
            cat_ids.append((sub_id, top, sub))

    per_cat = max(1, target // max(1, len(cat_ids)))
    i = 0
    for cat_id, top, sub in cat_ids:
        for _ in range(per_cat):
            verb = rnd.choice(_VERBS)
            obj = rnd.choice(_OBJECTS)
            name = f"{verb} {obj} in {sub}"
            cls = rnd.choice(["Machine", "User", "Both"])
            pid = f"{cat_id}:P{i}"
            elements = []
            if rnd.random() < 0.45:
                kind = rnd.choice(_ELEM_KINDS)
                el = {"id": f"opt{i}", "type": kind, "label": f"{obj.title()} option",
                      "required": rnd.random() < 0.3, "key": None, "valueName": f"Value{i}"}
                if kind == "decimal":
                    el["min"], el["max"] = 0, rnd.choice([10, 100, 3600, 65535])
                elif kind == "text":
                    el["maxLength"] = rnd.choice([64, 255, 1024])
                elif kind == "enum":
                    el["items"] = [{"id": "0", "label": "Off"}, {"id": "1", "label": "On"}, {"id": "2", "label": "Prompt"}]
                elements.append(el)
            policies.append({
                "id": pid, "name": name, "class": cls, "categoryId": cat_id,
                "explain": f"This policy controls whether to {verb.lower()} {obj}. "
                           f"If enabled, the setting is applied; if disabled or not configured, the default behavior applies.",
                "supportedOn": "At least Windows 10", "key": f"Software\\Policies\\Fake\\{top.replace(' ', '')}",
                "valueName": f"Policy{i}", "elements": elements})
            i += 1
    return categories, policies


ADMX_CATEGORIES, ADMX_POLICIES = generate_admx()
ADMX_BY_ID = {p["id"]: p for p in ADMX_POLICIES}
ADMX_LANGUAGES = 21


def register(app, state, err, Response, JSONResponse, Request):
    """Attach the editor routes to the FastAPI app. `state` is the per-app
    State; node item storage lives in state.node_items."""

    def store(gid):
        return state.node_items.setdefault(gid, {})

    def resolve(node_id):
        n = NODE_INDEX.get(node_id)
        if n is None:
            return None, err(404, "not_found", f"No such node '{node_id}'.")
        if not n["available"]:
            return None, err(404, "not_found", n["unavailableReason"])
        return n, None

    @app.get("/api/v1/gpo/nodes/schema")
    async def node_schema():
        return {"schemas": list(SCHEMAS.values())}

    @app.get("/api/v1/gpo/{gid}/tree")
    async def gpo_tree(gid: str):
        if gid not in state.gpos:
            return err(404, "not_found", "No such GPO.")
        return {"nodes": tree()}

    @app.api_route("/api/v1/gpo/{gid}/node/{node_id}", methods=["GET", "PUT"])
    async def node_form(gid: str, node_id: str, request: Request):
        n, e = resolve(node_id)
        if e:
            return e
        forms = store(gid).setdefault("_forms", {})
        if request.method == "PUT":
            if n["kind"] != "form":
                return err(400, "bad_request", f"Node '{node_id}' is a {n['kind']} node; use the items endpoint.")
            forms[node_id] = (await request.json()).get("values", {})
        return {"nodeId": node_id, "schema": n["itemSchema"], "values": forms.get(node_id, {})}

    @app.api_route("/api/v1/gpo/{gid}/node/{node_id}/items", methods=["GET", "POST"])
    async def node_items(gid: str, node_id: str, request: Request):
        n, e = resolve(node_id)
        if e:
            return e
        items = store(gid).setdefault(node_id, [])
        if request.method == "POST":
            b = await request.json()
            b = dict(b)
            b.setdefault("id", "{" + secrets.token_hex(8).upper() + "}")
            items.append(b)
            return JSONResponse(b, status_code=201)
        return {"nodeId": node_id, "schema": n["itemSchema"], "items": items}

    @app.api_route("/api/v1/gpo/{gid}/node/{node_id}/items/{item_id}", methods=["PATCH", "DELETE"])
    async def node_item(gid: str, node_id: str, item_id: str, request: Request):
        n, e = resolve(node_id)
        if e:
            return e
        items = store(gid).setdefault(node_id, [])
        if request.method == "DELETE":
            store(gid)[node_id] = [i for i in items if i.get("id") != item_id]
            return Response(status_code=204)
        b = await request.json()
        for i in items:
            if i.get("id") == item_id:
                i.update(b)
                i["id"] = item_id
                return i
        return err(404, "not_found", "No such item.")

    @app.get("/api/v1/admx/stats")
    async def admx_stats():
        return {"files": 235, "categories": len(ADMX_CATEGORIES), "policies": len(ADMX_POLICIES),
                "languages": ADMX_LANGUAGES, "parseWarnings": [], "store": "(generated sample catalog)"}
