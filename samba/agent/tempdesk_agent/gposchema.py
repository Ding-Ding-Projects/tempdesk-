"""Item/field schemas for the Group Policy editor nodes, published by
GET /gpo/nodes/schema. Mirrors the Windows agent's GpoSchema.cs: same schema
ids, field names, enum values and help text, so the portal renders identical
controls against either backend.
"""

from __future__ import annotations


def _f(fid, label, ftype, help_, **extra):
    d = {"id": fid, "label": label, "type": ftype, "help": help_}
    d.update(extra)
    return d


def _enum(fid, label, help_, values, **extra):
    vals = [{"value": v[0], "label": v[1], "description": v[2] if len(v) > 2 else ""} for v in values]
    return _f(fid, label, "enum", help_, values=vals, **extra)


def _schema(sid, kind, fields, **extra):
    s = {"id": sid, "kind": kind, "fields": fields}
    s.update(extra)
    return s


def _action():
    return _enum("action", "Action", "What this preference item does when applied.", [
        ("C", "Create", "Create the item if it does not exist."),
        ("R", "Replace", "Delete and recreate the item so it exactly matches."),
        ("U", "Update", "Create if absent, otherwise modify the existing item."),
        ("D", "Delete", "Remove the item."),
    ], default="U")


def _targeting():
    items = []

    def add(t, label, attrs):
        items.append({"type": t, "label": label, "attributes": list(attrs)})

    add("FilterGroup", "Security group", ["name", "sid", "userContext", "primaryGroup", "localGroup"])
    add("FilterOrgUnit", "Organizational unit", ["name", "userContext", "directMember"])
    add("FilterComputer", "Computer name", ["name", "type"])
    add("FilterIpRange", "IP address range", ["min", "max"])
    add("FilterOs", "Operating system", ["class", "version", "type", "edition", "sp"])
    add("FilterWMI", "WMI query", ["query", "nameSpace", "variableName", "property"])
    add("FilterRegistry", "Registry match", ["type", "subtype", "valueType", "valueName", "valueData", "key", "hive"])
    add("FilterFile", "File match", ["path", "type", "min", "max", "gte", "lte", "folder"])
    add("FilterLanguage", "Language", ["language", "locale", "default", "system", "native"])
    add("FilterBattery", "Battery present", [])
    add("FilterPortable", "Portable computer", ["docked", "undocked", "unknown"])
    add("FilterTime", "Time range", ["begin", "end"])
    add("FilterDomain", "Domain", ["name", "userContext"])
    add("FilterUser", "User", ["name", "sid"])
    add("FilterSite", "AD site", ["name"])
    add("FilterDisk", "Disk space", ["drive", "freeSpace"])
    add("FilterRam", "RAM", ["totalMB"])
    add("FilterCpu", "CPU speed", ["speedMHz"])
    add("FilterMacRange", "MAC address range", ["min", "max"])
    add("FilterDate", "Date", ["period", "dow", "day", "month", "year"])
    add("FilterMsi", "MSI query", ["type", "subtype", "code", "item", "value", "min", "max"])
    add("FilterEnvironment", "Environment variable", ["variableName", "value"])
    add("FilterLdap", "LDAP query", ["searchFilter", "binding", "variableName", "attribute"])
    add("FilterTerminal", "Terminal session", ["type", "option", "value"])
    return {"combiners": ["AND", "OR"], "supportsNot": True, "supportsCollections": True, "items": items}


def _common():
    return {
        "options": [
            _f("bypassErrors", "Stop processing items on this extension if an error occurs", "bool",
               "GPP bypassErrors attribute.", default=False),
            _f("userContext", "Run in the logged-on user's security context", "bool", "GPP userContext attribute.", default=False),
            _f("removePolicy", "Remove this item when it is no longer applied", "bool", "GPP removePolicy attribute.", default=False),
            _f("applyOnce", "Apply once and do not reapply", "bool", "Stored as a FilterRunOnce targeting item.", default=False),
        ],
        "targeting": _targeting(),
    }


_AUDIT_VALUES = [("0", "No auditing", "No auditing."), ("1", "Success", "Audit successful events."),
                 ("2", "Failure", "Audit failed events."), ("3", "Success and Failure", "Audit both.")]

_USER_RIGHTS = [
    "SeNetworkLogonRight", "SeDenyNetworkLogonRight", "SeInteractiveLogonRight", "SeDenyInteractiveLogonRight",
    "SeRemoteInteractiveLogonRight", "SeDenyRemoteInteractiveLogonRight", "SeBatchLogonRight", "SeDenyBatchLogonRight",
    "SeServiceLogonRight", "SeDenyServiceLogonRight", "SeBackupPrivilege", "SeRestorePrivilege", "SeShutdownPrivilege",
    "SeRemoteShutdownPrivilege", "SeTakeOwnershipPrivilege", "SeDebugPrivilege", "SeSystemtimePrivilege",
    "SeTimeZonePrivilege", "SeLoadDriverPrivilege", "SeImpersonatePrivilege", "SeAssignPrimaryTokenPrivilege",
    "SeIncreaseQuotaPrivilege", "SeChangeNotifyPrivilege", "SeCreatePagefilePrivilege", "SeManageVolumePrivilege",
    "SeSecurityPrivilege", "SeSystemEnvironmentPrivilege", "SeProfileSingleProcessPrivilege", "SeSystemProfilePrivilege",
    "SeCreateGlobalPrivilege", "SeCreateSymbolicLinkPrivilege", "SeCreatePermanentPrivilege", "SeLockMemoryPrivilege",
    "SeIncreaseBasePriorityPrivilege", "SeIncreaseWorkingSetPrivilege", "SeUndockPrivilege", "SeTcbPrivilege",
    "SeMachineAccountPrivilege", "SeEnableDelegationPrivilege", "SeAuditPrivilege", "SeTrustedCredManAccessPrivilege",
    "SeRelabelPrivilege", "SeDelegateSessionUserImpersonatePrivilege", "SeCreateTokenPrivilege", "SeSyncAgentPrivilege",
]

_KNOWN_FOLDERS = [
    ("{FDD39AD0-238F-46AF-ADB4-6C85480369C7}", "Documents"),
    ("{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}", "AppData (Roaming)"),
    ("{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}", "Desktop"),
    ("{625B53C3-AB48-4EC1-BA1F-A1EF4146FC19}", "Start Menu"),
    ("{33E28130-4E1E-4676-835A-98395C3BC3BB}", "Pictures"),
    ("{4BD8D571-6D19-48D3-BE97-422220080E43}", "Music"),
    ("{18989B1D-99B5-455B-841C-AB7C74E4DDFC}", "Videos"),
    ("{1777F761-68AD-4D8A-87BD-30B759FA33DD}", "Favorites"),
    ("{374DE290-123F-4565-9164-39C4925E467B}", "Downloads"),
]

_CACHE = None


def build() -> dict:
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    s = {}

    s["sec-password"] = _schema("sec-password", "form", [
        _f("MinimumPasswordLength", "Minimum password length", "int", "Fewest characters a password may contain.", default=7),
        _f("PasswordHistorySize", "Enforce password history", "int", "Old passwords remembered.", default=24),
        _f("MaximumPasswordAge", "Maximum password age (days)", "int", "-1 means never expires.", default=42),
        _f("MinimumPasswordAge", "Minimum password age (days)", "int", "Days before a password can be changed.", default=1),
        _f("PasswordComplexity", "Password must meet complexity requirements", "bool01", "Stored as 1/0.", default=True),
        _f("ClearTextPassword", "Store passwords using reversible encryption", "bool01", "Insecure; usually 0.", default=False),
    ])
    s["sec-lockout"] = _schema("sec-lockout", "form", [
        _f("LockoutBadCount", "Account lockout threshold", "int", "Failed sign-ins before lockout. 0 never locks out.", default=0),
        _f("LockoutDuration", "Account lockout duration (minutes)", "int", "-1 until an admin unlocks.", default=30),
        _f("ResetLockoutCount", "Reset account lockout counter after (minutes)", "int", "Minutes before the counter resets.", default=30),
    ])
    s["sec-kerberos"] = _schema("sec-kerberos", "form", [
        _f("MaxTicketAge", "Maximum lifetime for user ticket (hours)", "int", "Hours a TGT is valid.", default=10),
        _f("MaxRenewAge", "Maximum lifetime for user ticket renewal (days)", "int", "Days a TGT may be renewed.", default=7),
        _f("MaxServiceAge", "Maximum lifetime for service ticket (minutes)", "int", "Minutes a service ticket is valid.", default=600),
        _f("MaxClockSkew", "Maximum tolerance for computer clock synchronization (minutes)", "int", "Allowed clock skew.", default=5),
        _f("TicketValidateClient", "Enforce user logon restrictions", "bool01", "Validate every request.", default=True),
    ])
    s["sec-audit"] = _schema("sec-audit", "form", [
        _enum(k, lbl, "0 none, 1 success, 2 failure, 3 both.", _AUDIT_VALUES, default="0")
        for k, lbl in [
            ("AuditSystemEvents", "Audit system events"), ("AuditLogonEvents", "Audit logon events"),
            ("AuditObjectAccess", "Audit object access"), ("AuditPrivilegeUse", "Audit privilege use"),
            ("AuditPolicyChange", "Audit policy change"), ("AuditAccountManage", "Audit account management"),
            ("AuditProcessTracking", "Audit process tracking"), ("AuditDSAccess", "Audit directory service access"),
            ("AuditAccountLogon", "Audit account logon events")]
    ])
    s["sec-eventlog"] = _schema("sec-eventlog", "form", [
        _f("MaximumLogSize", "Maximum application log size (KB)", "int", "Event Log section key."),
        _f("MaximumSecurityLogSize", "Maximum security log size (KB)", "int", ""),
        _f("MaximumSystemLogSize", "Maximum system log size (KB)", "int", ""),
        _f("RetentionDays", "Retain application log (days)", "int", ""),
    ])
    s["sec-user-right"] = _schema("sec-user-right", "table", [
        _enum("right", "User right", "The Se* privilege or logon right.", [(r, r) for r in _USER_RIGHTS]),
        _f("accounts", "Assigned accounts", "accountList", "Comma-separated accounts or SIDs (SIDs prefixed with *)."),
    ])
    s["sec-option"] = _schema("sec-option", "table", [
        _f("key", "Registry value path", "string", "MACHINE\\... path under the Registry Values section."),
        _enum("regType", "Value type", "The INF numeric type prefix.",
              [("1", "String (REG_SZ)"), ("4", "DWord (REG_DWORD)"), ("7", "Multi-string (REG_MULTI_SZ)")]),
        _f("value", "Value", "string", "The value stored after the type prefix."),
    ])
    s["sec-restricted-group"] = _schema("sec-restricted-group", "table", [
        _f("group", "Group", "string", "Group name or SID."),
        _f("members", "Members", "accountList", "Comma-separated accounts."),
        _f("memberOf", "Member of", "accountList", "Comma-separated parent groups."),
    ])
    s["sec-system-service"] = _schema("sec-system-service", "table", [
        _f("service", "Service name", "string", "Service General Setting key."),
        _enum("startup", "Startup mode", "Service start value.", [("2", "Automatic"), ("3", "Manual"), ("4", "Disabled")]),
        _f("sddl", "Permissions (SDDL)", "sddl", "Security descriptor applied to the service."),
    ])
    s["sec-registry-perm"] = _schema("sec-registry-perm", "table", [
        _f("key", "Registry key", "string", "Fully qualified key name."),
        _enum("propagation", "Propagation", "PermPropagationMode.",
              [("0", "Propagate inheritable permissions"), ("1", "Replace existing permissions"), ("2", "Do not allow replacement")]),
        _f("sddl", "Permissions (SDDL)", "sddl", "Security descriptor."),
    ])
    s["sec-file-perm"] = _schema("sec-file-perm", "table", [
        _f("path", "File or folder path", "string", "File System section key."),
        _enum("propagation", "Propagation", "PermPropagationMode.",
              [("0", "Propagate inheritable permissions"), ("1", "Replace existing permissions"), ("2", "Do not allow replacement")]),
        _f("sddl", "Permissions (SDDL)", "sddl", "Security descriptor."),
    ])
    s["advanced-audit"] = _schema("advanced-audit", "table", [
        _f("subcategory", "Subcategory", "string", "Audit subcategory name."),
        _f("subcategoryGuid", "Subcategory GUID", "string", "The {0CCE....} subcategory GUID."),
        _f("policyTarget", "Policy target", "string", "'System' or a user SID."),
        _enum("settingValue", "Setting", "Written as the Setting Value column.", _AUDIT_VALUES),
    ])
    s["firewall-profiles"] = _schema("firewall-profiles", "form", _firewall_profile_fields())
    s["firewall-rule"] = _schema("firewall-rule", "table", _firewall_rule_fields())
    s["firewall-csr"] = _schema("firewall-csr", "table", [
        _f("name", "Name", "string", "Connection security rule name."),
        _f("rule", "Rule string", "string", "Raw MS-GPFAS connection security rule grammar string."),
        _f("active", "Enabled", "bool", "Whether the rule is active.", default=True),
    ])
    s["nrpt-rule"] = _schema("nrpt-rule", "table", [
        _f("ruleName", "Rule name", "string", "Unique key under DnsPolicyConfig."),
        _f("name", "Namespace / suffix", "string", "DNS suffix, FQDN or subnet; comma-separated."),
        _f("genericDnsServers", "DNS servers", "string", "Semicolon-separated DNS servers."),
        _enum("configOptions", "Configuration", "ConfigOptions bitmask.",
              [("8", "Generic DNS server"), ("2", "DNSSEC"), ("4", "DirectAccess")]),
    ])
    s["qos-policy"] = _schema("qos-policy", "table", [
        _f("name", "Policy name", "string", "QoS policy name."),
        _f("appName", "Application name or path", "string", "Executable to match, or *."),
        _f("dscpValue", "DSCP value", "int", "0-63, or -1 to not set.", default=-1),
        _f("throttleRate", "Throttle rate", "string", "Outbound throttle rate, optional."),
        _f("protocol", "Protocol", "string", "TCP, UDP, or *."),
        _f("localPort", "Source port(s)", "string", "Port, range, or *."),
        _f("remotePort", "Destination port(s)", "string", "Port, range, or *."),
    ])
    s["deployed-printer"] = _schema("deployed-printer", "table", [
        _f("uncName", "Printer connection (UNC)", "string", "\\\\server\\printer."),
        _f("printerName", "Printer name", "string", "Printer share name."),
        _f("serverName", "Server name", "string", "Print server part."),
    ])
    s["folder-redirection"] = _schema("folder-redirection", "table", [
        _enum("folder", "Folder", "The known folder to redirect.", _KNOWN_FOLDERS),
        _f("securityGroup", "Security group SID", "string", "SID the mapping applies to, or S-1-1-0."),
        _f("fullPath", "Target path", "string", "Redirection destination."),
        _f("flags", "Flags", "string", "Hex flag value (0x1 Move, 0x1000 Redirect To FullPath).", default="1001"),
    ])
    s["wireless-policy"] = _schema("wireless-policy", "table", [
        _f("name", "Policy name", "string", "Friendly name."),
        _f("description", "Description", "string", ""),
        _f("xml", "WLAN profile XML", "xml", "The ms-net-ieee-80211-GP-PolicyData XML."),
    ])
    s["wired-policy"] = _schema("wired-policy", "table", [
        _f("name", "Policy name", "string", "Friendly name."),
        _f("description", "Description", "string", ""),
        _f("xml", "LAN profile XML", "xml", "The ms-net-ieee-8023-GP-PolicyData XML."),
    ])
    s["netlist-policy"] = _schema("netlist-policy", "table", [
        _f("network", "Network", "string", "Network name, or 'Unidentified'/'Identifying'."),
        _enum("category", "Network location", "Category.",
              [("0", "Public"), ("1", "Private"), ("2", "Domain authenticated")]),
        _f("name", "Name", "string", "Display name to force, optional."),
    ])
    s["pki-trusted-cert"] = _schema("pki-trusted-cert", "table", [
        _enum("store", "Store", "Which Public Key store.",
              [("Root", "Trusted Root Certification Authorities"), ("CA", "Intermediate Certification Authorities"),
               ("Trust", "Enterprise Trust")]),
        _f("thumbprint", "Thumbprint", "string", "Certificate SHA-1 thumbprint."),
        _f("certificate", "Certificate (base64 DER)", "string", "The DER certificate, base64 encoded."),
        _f("autoEnrollment", "Enable certificate auto-enrollment", "bool", "Turns on auto-enrollment.", default=False),
    ])
    s["srp-rule"] = _schema("srp-rule", "table", [
        _enum("ruleType", "Rule type", "Software Restriction rule kind.",
              [("path", "Path rule"), ("hash", "Hash rule"), ("cert", "Certificate rule"), ("zone", "Network zone rule")]),
        _f("value", "Value", "string", "Path, hash, or zone the rule matches."),
        _enum("securityLevel", "Security level", "Safer level.",
              [("0", "Disallowed"), ("262144", "Basic User"), ("131072", "Unrestricted")]),
    ])
    s["applocker-rule"] = _schema("applocker-rule", "table", [
        _enum("collection", "Rule collection", "Which AppLocker collection.",
              [("Exe", "Executable rules"), ("Msi", "Windows Installer rules"), ("Script", "Script rules"),
               ("Appx", "Packaged app rules"), ("Dll", "DLL rules")]),
        _enum("enforcementMode", "Enforcement", "Collection enforcement mode.",
              [("NotConfigured", "Not configured"), ("Enabled", "Enforce rules"), ("AuditOnly", "Audit only")]),
        _f("ruleXml", "Rule XML", "xml", "A single AppLocker rule element."),
    ])
    s["ipsec-policy"] = _schema("ipsec-policy", "table", [
        _f("name", "Policy name", "string", "IPsec policy name."),
        _f("description", "Description", "string", ""),
        _f("assigned", "Assigned", "bool", "Whether this policy is assigned to the GPO.", default=False),
    ])
    s["software-installation"] = _schema("software-installation", "table", [
        _f("name", "Package name", "string", "Display name."),
        _f("path", "Package path (UNC .msi)", "string", "UNC path to the .msi."),
        _enum("deploymentType", "Deployment", "How the package is deployed.",
              [("A", "Assigned", "Install automatically."), ("P", "Published", "Available to install (user only).")]),
        _f("productCode", "Product code", "string", "MSI product code GUID."),
    ])
    s["script-entry"] = _schema("script-entry", "table", [
        _f("script", "Script name or path", "string", "Executable or script path."),
        _f("parameters", "Parameters", "string", "Command-line parameters."),
        _f("powershell", "PowerShell script", "bool", "Stored in psscripts.ini.", default=False),
        _f("content", "Script content", "text", "Optional: content to write into the GPO scripts folder."),
    ])

    _preference_schemas(s)
    _CACHE = s
    return s


def _firewall_profile_fields():
    fields = []
    for profile in ("Domain", "Private", "Public"):
        fields.append(_enum(profile + "State", profile + " profile: Firewall state", "EnableFirewall.",
                            [("1", "On"), ("0", "Off")]))
        fields.append(_enum(profile + "Inbound", profile + " profile: Inbound connections", "DefaultInboundAction.",
                            [("1", "Block (default)"), ("0", "Allow"), ("2", "Block all connections")]))
        fields.append(_enum(profile + "Outbound", profile + " profile: Outbound connections", "DefaultOutboundAction.",
                            [("0", "Allow (default)"), ("1", "Block")]))
    return fields


def _firewall_rule_fields():
    return [
        _f("name", "Name", "string", "Rule display name (Name= token)."),
        _f("description", "Description", "string", "Desc= token."),
        _enum("action", "Action", "Allow or block.", [("Allow", "Allow the connection"), ("Block", "Block the connection")]),
        _enum("direction", "Direction", "Dir= token.", [("In", "Inbound"), ("Out", "Outbound")]),
        _f("active", "Enabled", "bool", "Active= token.", default=True),
        _f("protocol", "Protocol number", "string", "6 TCP, 17 UDP, 1 ICMPv4, 58 ICMPv6, blank for any."),
        _f("localPorts", "Local ports", "string", "LPort= token."),
        _f("remotePorts", "Remote ports", "string", "RPort= token."),
        _f("localAddresses", "Local addresses", "string", "LA4=/LA6= tokens, comma-separated."),
        _f("remoteAddresses", "Remote addresses", "string", "RA4=/RA6= tokens, or LocalSubnet."),
        _f("application", "Program path", "string", "App= token."),
        _f("service", "Service", "string", "Svc= token, or *."),
        _enum("profiles", "Profiles", "Profile= token.",
              [("", "All profiles"), ("Domain", "Domain"), ("Private", "Private"), ("Public", "Public")]),
        _f("edge", "Edge traversal", "bool", "Edge= token.", default=False),
    ]


def _preference_schemas(s):
    def pref(area, fields):
        schema = _schema("pref-" + area, "preference-items", fields, common=_common(), area=area)
        s["pref-" + area] = schema

    pref("Drives", [_action(),
        _f("path", "Location (UNC path)", "string", "\\\\server\\share to map."),
        _f("letter", "Drive letter", "string", "Drive letter, e.g. S."),
        _f("label", "Label", "string", "Volume label."),
        _f("persistent", "Reconnect", "bool", "persistent attribute.", default=True),
        _f("userName", "Connect as (user)", "string", "Optional alternate credentials user."),
        _f("cpassword", "Password", "password", "GPP cpassword; avoid.")])
    pref("EnvironmentVariables", [_action(),
        _f("name", "Variable name", "string", "Environment variable name."),
        _f("value", "Value", "string", "Variable value."),
        _f("user", "User variable", "bool", "user=1 user, 0 system.", default=True),
        _f("partial", "Partial", "bool", "partial attribute.", default=False)])
    pref("Files", [_action(),
        _f("fromPath", "Source file(s)", "string", "Source path."),
        _f("targetPath", "Destination file", "string", "Target path."),
        _f("readOnly", "Read-only", "bool", "", default=False),
        _f("hidden", "Hidden", "bool", "", default=False),
        _f("archive", "Archive", "bool", "", default=False)])
    pref("Folders", [_action(),
        _f("path", "Folder path", "string", "Folder to create/modify."),
        _f("readOnly", "Read-only", "bool", "", default=False),
        _f("hidden", "Hidden", "bool", "", default=False),
        _f("archive", "Archive", "bool", "", default=False)])
    pref("IniFiles", [_action(),
        _f("path", "INI file path", "string", "The .ini file."),
        _f("section", "Section", "string", "Section name."),
        _f("property", "Property", "string", "Key name."),
        _f("value", "Value", "string", "Value.")])
    pref("Registry", [_action(),
        _enum("hive", "Hive", "Registry hive.",
              [("HKEY_LOCAL_MACHINE", "HKEY_LOCAL_MACHINE"), ("HKEY_CURRENT_USER", "HKEY_CURRENT_USER"),
               ("HKEY_CLASSES_ROOT", "HKEY_CLASSES_ROOT"), ("HKEY_USERS", "HKEY_USERS")]),
        _f("key", "Key", "string", "Subkey path."),
        _f("name", "Value name", "string", "Value name (blank for default)."),
        _enum("type", "Type", "Registry value type.",
              [("REG_SZ", "String"), ("REG_EXPAND_SZ", "Expandable string"), ("REG_DWORD", "DWord"),
               ("REG_QWORD", "QWord"), ("REG_MULTI_SZ", "Multi-string"), ("REG_BINARY", "Binary")]),
        _f("value", "Value", "string", "Value data.")])
    pref("Shortcuts", [_action(),
        _f("shortcutPath", "Shortcut location", "string", "Where the shortcut is created."),
        _enum("targetType", "Target type", "What the shortcut points to.",
              [("FILESYSTEM", "File or folder"), ("URL", "URL"), ("SHELL", "Shell object")]),
        _f("targetPath", "Target", "string", "Target path or URL."),
        _f("arguments", "Arguments", "string", "Command-line arguments."),
        _f("startIn", "Start in", "string", "Working directory."),
        _f("iconPath", "Icon path", "string", "Icon file."),
        _f("comment", "Comment", "string", "Tooltip.")])
    pref("Applications", [_action(), _f("name", "Application", "string", "Application name.")])
    pref("NetworkShares", [_action(),
        _f("name", "Share name", "string", "Share name."),
        _f("path", "Folder path", "string", "Local folder shared."),
        _f("comment", "Comment", "string", "Share comment.")])
    pref("DataSources", [_action(),
        _f("dsn", "Data source name", "string", "DSN name."),
        _f("driver", "Driver", "string", "ODBC driver."),
        _f("userDSN", "User DSN", "bool", "userDSN=1 user, 0 system.", default=True),
        _f("description", "Description", "string", "")])
    pref("Devices", [
        _enum("deviceAction", "Action", "Enable or disable the device class.",
              [("ENABLE", "Enable this device"), ("DISABLE", "Disable this device")]),
        _f("deviceClass", "Device class", "string", "Class name."),
        _f("deviceType", "Device type", "string", "Device type name."),
        _f("deviceClassGUID", "Class GUID", "string", "Device setup class GUID.")])
    pref("FolderOptions", [_action(),
        _f("fileExtension", "File extension", "string", "For OpenWith/FileType associations."),
        _f("applicationPath", "Associated program", "string", "Program for the extension.")])
    pref("InternetSettings", [
        _f("name", "Settings set", "string", "Internet Explorer version label."),
        _f("proxyServer", "Proxy server", "string", "ProxyServer host:port."),
        _f("proxyEnable", "Use a proxy server", "bool", "ProxyEnable.", default=False),
        _f("homePage", "Home page", "string", "Start page URL.")])
    pref("LocalUsersAndGroups", [_action(),
        _enum("itemType", "Item type", "Create a local user or group.",
              [("group", "Local group"), ("user", "Local user")]),
        _f("groupName", "Group name", "string", "For group items."),
        _f("userName", "User name", "string", "For user items."),
        _f("members", "Members to add/remove", "string", "Comma-separated, prefix - to remove."),
        _f("fullName", "Full name", "string", "For user items."),
        _f("description", "Description", "string", ""),
        _f("acctDisabled", "Account disabled", "bool", "", default=False)])
    pref("NetworkOptions", [_action(),
        _enum("connType", "Connection type", "VPN or dial-up.",
              [("VPN", "VPN connection"), ("DUN", "Dial-up connection")]),
        _f("name", "Connection name", "string", ""),
        _f("ipAddress", "VPN server / phone number", "string", "")])
    pref("PowerOptions", [_action(),
        _f("name", "Power scheme name", "string", "Scheme name."),
        _f("default", "Set as active scheme", "bool", "default=1.", default=False),
        _f("monitorAc", "Turn off monitor after (min, plugged in)", "int", ""),
        _f("standbyAc", "Sleep after (min, plugged in)", "int", "")])
    pref("Printers", [_action(),
        _enum("printerType", "Printer type", "Which printer element to write.",
              [("SharedPrinter", "Shared (network) printer"), ("PortPrinter", "TCP/IP printer"), ("LocalPrinter", "Local printer")]),
        _f("path", "Printer path / share", "string", "\\\\server\\printer for shared."),
        _f("ipAddress", "IP address", "string", "For TCP/IP printers."),
        _f("default", "Set as default printer", "bool", "", default=False)])
    pref("RegionalOptions", [
        _f("localeId", "Locale ID", "string", "e.g. 1033."),
        _f("localeName", "Locale name", "string", "e.g. English (United States)."),
        _f("numDeciSymbol", "Decimal symbol", "string", "")])
    pref("ScheduledTasks", [_action(),
        _enum("taskType", "Task type", "Which task element to write.",
              [("TaskV2", "Scheduled task (Vista+)"), ("ImmediateTaskV2", "Immediate task (Vista+)"),
               ("Task", "Scheduled task (XP)"), ("ImmediateTask", "Immediate task (XP)")]),
        _f("name", "Task name", "string", ""),
        _f("appName", "Program", "string", "Executable to run."),
        _f("args", "Arguments", "string", ""),
        _f("runAs", "Run as", "string", "Account to run under.")])
    pref("Services", [
        _enum("startupType", "Startup type", "Service start mode.",
              [("NOCHANGE", "No change"), ("AUTOMATIC", "Automatic"), ("MANUAL", "Manual"), ("DISABLED", "Disabled")]),
        _f("serviceName", "Service name", "string", ""),
        _enum("serviceAction", "Service action", "What to do with the service.",
              [("NOCHANGE", "No change"), ("START", "Start"), ("STOP", "Stop"), ("RESTART", "Restart")]),
        _f("accountName", "Log on as", "string", "Service account.")])
    pref("StartMenu", [
        _f("name", "Settings set", "string", "Start menu settings label."),
        _f("minMFU", "Number of programs on Start menu", "int", "", default=6)])
