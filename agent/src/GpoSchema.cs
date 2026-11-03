using System;
using System.Collections.Generic;

namespace TempDesk.Agent
{
    /// <summary>
    /// Item/field schemas for the Group Policy editor nodes, published by
    /// GET /gpo/nodes/schema so the portal can render rich controls: field
    /// types, enums with a per-value description, help text, and defaults. The
    /// help text here is written for this project; the field names match the
    /// on-disk format each node writes (GptTmpl.inf keys, GPP Properties
    /// attributes, firewall rule tokens, audit.csv columns, and so on).
    /// </summary>
    public static class GpoSchema
    {
        private static Dictionary<string, object> F(string id, string label, string type, string help)
        {
            Dictionary<string, object> f = new Dictionary<string, object>(StringComparer.Ordinal);
            f["id"] = id; f["label"] = label; f["type"] = type; f["help"] = help;
            return f;
        }

        private static Dictionary<string, object> Enum(string id, string label, string help, params string[][] values)
        {
            Dictionary<string, object> f = F(id, label, "enum", help);
            List<object> vals = new List<object>();
            foreach (string[] v in values)
            {
                Dictionary<string, object> o = new Dictionary<string, object>(StringComparer.Ordinal);
                o["value"] = v[0]; o["label"] = v[1]; o["description"] = v.Length > 2 ? v[2] : "";
                vals.Add(o);
            }
            f["values"] = vals;
            return f;
        }

        private static Dictionary<string, object> Def(object d, Dictionary<string, object> f)
        {
            f["default"] = d;
            return f;
        }

        private static List<object> Fields(params Dictionary<string, object>[] fields)
        {
            return new List<object>(fields);
        }

        // GPP common action enum, used by most preference item schemas.
        private static Dictionary<string, object> ActionField()
        {
            return Def("U", Enum("action", "Action", "What this preference item does when applied.",
                new[] { "C", "Create", "Create the item if it does not exist." },
                new[] { "R", "Replace", "Delete and recreate the item so it exactly matches." },
                new[] { "U", "Update", "Create if absent, otherwise modify the existing item." },
                new[] { "D", "Delete", "Remove the item." }));
        }

        private static Dictionary<string, object> Schema(string id, string kind, List<object> fields)
        {
            Dictionary<string, object> s = new Dictionary<string, object>(StringComparer.Ordinal);
            s["id"] = id; s["kind"] = kind; s["fields"] = fields;
            return s;
        }

        /// <summary>
        /// The GPP common-options block (stop-on-error, run-as-user, remove
        /// when no longer applied, apply once) and the item-level-targeting
        /// editor description, shared by every preference-items schema.
        /// </summary>
        private static Dictionary<string, object> CommonOptions()
        {
            Dictionary<string, object> c = new Dictionary<string, object>(StringComparer.Ordinal);
            List<object> opts = new List<object>();
            opts.Add(Def(false, F("bypassErrors", "Stop processing items on this extension if an error occurs", "bool", "GPP bypassErrors=0 stops processing on error; here true maps to bypassErrors=0.")));
            opts.Add(Def(false, F("userContext", "Run in the logged-on user's security context", "bool", "GPP userContext attribute.")));
            opts.Add(Def(false, F("removePolicy", "Remove this item when it is no longer applied", "bool", "GPP removePolicy attribute.")));
            opts.Add(Def(false, F("applyOnce", "Apply once and do not reapply", "bool", "Stored as a FilterRunOnce targeting item.")));
            c["options"] = opts;
            c["targeting"] = TargetingEditor();
            return c;
        }

        /// <summary>
        /// The full item-level-targeting editor description: every targeting
        /// item type with its attributes, plus the collection/AND/OR/NOT
        /// combiners. The portal builds the Filters XML from this and sends it
        /// back as the item's raw "filters" field.
        /// </summary>
        private static Dictionary<string, object> TargetingEditor()
        {
            Dictionary<string, object> t = new Dictionary<string, object>(StringComparer.Ordinal);
            t["combiners"] = new List<object> { "AND", "OR" };
            t["supportsNot"] = true;
            t["supportsCollections"] = true;
            List<object> items = new List<object>();
            Action<string, string, string[]> add = delegate(string type, string label, string[] attrs)
            {
                Dictionary<string, object> it = new Dictionary<string, object>(StringComparer.Ordinal);
                it["type"] = type; it["label"] = label; it["attributes"] = new List<object>(attrs);
                items.Add(it);
            };
            add("FilterGroup", "Security group", new[] { "name", "sid", "userContext", "primaryGroup", "localGroup" });
            add("FilterOrgUnit", "Organizational unit", new[] { "name", "userContext", "directMember" });
            add("FilterComputer", "Computer name", new[] { "name", "type" });
            add("FilterIpRange", "IP address range", new[] { "min", "max" });
            add("FilterOs", "Operating system", new[] { "class", "version", "type", "edition", "sp" });
            add("FilterWMI", "WMI query", new[] { "query", "nameSpace", "variableName", "property" });
            add("FilterRegistry", "Registry match", new[] { "type", "subtype", "valueType", "valueName", "valueData", "key", "hive" });
            add("FilterFile", "File match", new[] { "path", "type", "min", "max", "gte", "lte", "folder" });
            add("FilterLanguage", "Language", new[] { "language", "locale", "default", "system", "native" });
            add("FilterBattery", "Battery present", new string[0]);
            add("FilterPortable", "Portable computer", new[] { "docked", "undocked", "unknown" });
            add("FilterTime", "Time range", new[] { "begin", "end" });
            add("FilterDomain", "Domain", new[] { "name", "userContext" });
            add("FilterUser", "User", new[] { "name", "sid" });
            add("FilterSite", "AD site", new[] { "name" });
            add("FilterDisk", "Disk space", new[] { "drive", "freeSpace" });
            add("FilterRam", "RAM", new[] { "totalMB" });
            add("FilterCpu", "CPU speed", new[] { "speedMHz" });
            add("FilterMacRange", "MAC address range", new[] { "min", "max" });
            add("FilterDate", "Date", new[] { "period", "dow", "day", "month", "year" });
            add("FilterMsi", "MSI query", new[] { "type", "subtype", "code", "item", "value", "min", "max" });
            add("FilterEnvironment", "Environment variable", new[] { "variableName", "value" });
            add("FilterLdap", "LDAP query", new[] { "searchFilter", "binding", "variableName", "attribute" });
            add("FilterTerminal", "Terminal session", new[] { "type", "option", "value" });
            t["items"] = items;
            return t;
        }

        private static Dictionary<string, Dictionary<string, object>> _schemas;

        public static Dictionary<string, Dictionary<string, object>> Build()
        {
            if (_schemas != null) { return _schemas; }
            Dictionary<string, Dictionary<string, object>> s =
                new Dictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);

            // ---- Security form nodes (GptTmpl.inf) ----
            s["sec-password"] = Schema("sec-password", "form", Fields(
                Def(7, F("MinimumPasswordLength", "Minimum password length", "int", "Fewest characters a password may contain.")),
                Def(24, F("PasswordHistorySize", "Enforce password history", "int", "Old passwords remembered.")),
                Def(42, F("MaximumPasswordAge", "Maximum password age (days)", "int", "-1 means never expires.")),
                Def(1, F("MinimumPasswordAge", "Minimum password age (days)", "int", "Days before a password can be changed.")),
                Def(true, F("PasswordComplexity", "Password must meet complexity requirements", "bool01", "Stored as 1/0.")),
                Def(false, F("ClearTextPassword", "Store passwords using reversible encryption", "bool01", "Insecure; usually 0."))));

            s["sec-lockout"] = Schema("sec-lockout", "form", Fields(
                Def(0, F("LockoutBadCount", "Account lockout threshold", "int", "Failed sign-ins before lockout. 0 never locks out.")),
                Def(30, F("LockoutDuration", "Account lockout duration (minutes)", "int", "-1 until an admin unlocks.")),
                Def(30, F("ResetLockoutCount", "Reset account lockout counter after (minutes)", "int", "Minutes before the bad-count counter resets."))));

            s["sec-kerberos"] = Schema("sec-kerberos", "form", Fields(
                Def(10, F("MaxTicketAge", "Maximum lifetime for user ticket (hours)", "int", "Hours a TGT is valid.")),
                Def(7, F("MaxRenewAge", "Maximum lifetime for user ticket renewal (days)", "int", "Days a TGT may be renewed.")),
                Def(600, F("MaxServiceAge", "Maximum lifetime for service ticket (minutes)", "int", "Minutes a service ticket is valid.")),
                Def(5, F("MaxClockSkew", "Maximum tolerance for computer clock synchronization (minutes)", "int", "Allowed clock skew.")),
                Def(true, F("TicketValidateClient", "Enforce user logon restrictions", "bool01", "Validate every request against user rights."))));

            s["sec-audit"] = Schema("sec-audit", "form", AuditFields());
            s["sec-eventlog"] = Schema("sec-eventlog", "form", Fields(
                F("MaximumLogSize", "Maximum application log size (KB)", "int", "Event Log section key."),
                F("MaximumSecurityLogSize", "Maximum security log size (KB)", "int", ""),
                F("MaximumSystemLogSize", "Maximum system log size (KB)", "int", ""),
                F("RetentionDays", "Retain application log (days)", "int", ""),
                F("AuditLogRetentionPeriod", "Retention method for security log", "int", "0 overwrite as needed, 1 overwrite by days, 2 do not overwrite.")));

            s["sec-user-right"] = Schema("sec-user-right", "table", Fields(
                Enum("right", "User right", "The Se* privilege or logon right in the Privilege Rights section.", UserRightValues()),
                F("accounts", "Assigned accounts", "accountList", "Comma-separated accounts or SIDs (SIDs prefixed with *).")));

            s["sec-option"] = Schema("sec-option", "table", Fields(
                F("key", "Registry value path", "string", "MACHINE\\... path under the Registry Values section."),
                Enum("regType", "Value type", "The INF numeric type prefix.",
                    new[] { "1", "String (REG_SZ)" }, new[] { "4", "DWord (REG_DWORD)" }, new[] { "7", "Multi-string (REG_MULTI_SZ)" }),
                F("value", "Value", "string", "The value stored after the type prefix.")));

            s["sec-restricted-group"] = Schema("sec-restricted-group", "table", Fields(
                F("group", "Group", "string", "Group name or SID (the Group Membership section key stem)."),
                F("members", "Members", "accountList", "Comma-separated accounts (Group__Members)."),
                F("memberOf", "Member of", "accountList", "Comma-separated parent groups (Group__Memberof).")));

            s["sec-system-service"] = Schema("sec-system-service", "table", Fields(
                F("service", "Service name", "string", "Service General Setting section key."),
                Enum("startup", "Startup mode", "Service start value.",
                    new[] { "2", "Automatic" }, new[] { "3", "Manual" }, new[] { "4", "Disabled" }),
                F("sddl", "Permissions (SDDL)", "sddl", "Security descriptor applied to the service.")));

            s["sec-registry-perm"] = Schema("sec-registry-perm", "table", Fields(
                F("key", "Registry key", "string", "Fully qualified key name (Registry Keys section)."),
                Enum("propagation", "Propagation", "PermPropagationMode.",
                    new[] { "0", "Propagate inheritable permissions" }, new[] { "1", "Replace existing permissions" }, new[] { "2", "Do not allow permissions to be replaced" }),
                F("sddl", "Permissions (SDDL)", "sddl", "Security descriptor.")));

            s["sec-file-perm"] = Schema("sec-file-perm", "table", Fields(
                F("path", "File or folder path", "string", "File System section key."),
                Enum("propagation", "Propagation", "PermPropagationMode.",
                    new[] { "0", "Propagate inheritable permissions" }, new[] { "1", "Replace existing permissions" }, new[] { "2", "Do not allow permissions to be replaced" }),
                F("sddl", "Permissions (SDDL)", "sddl", "Security descriptor.")));

            // ---- Advanced audit (audit.csv) ----
            s["advanced-audit"] = Schema("advanced-audit", "table", Fields(
                F("subcategory", "Subcategory", "string", "Audit subcategory name, e.g. 'File System'."),
                F("subcategoryGuid", "Subcategory GUID", "string", "The {0CCE....} subcategory GUID from audit.csv."),
                F("policyTarget", "Policy target", "string", "'System' for system audit, or a user SID for per-user audit."),
                Enum("settingValue", "Setting", "Inclusion/exclusion; written as the Setting Value column.",
                    new[] { "0", "No Auditing", "No auditing of this subcategory." },
                    new[] { "1", "Success", "Audit successful events." },
                    new[] { "2", "Failure", "Audit failed events." },
                    new[] { "3", "Success and Failure", "Audit both." })));

            // ---- Firewall ----
            s["firewall-profiles"] = Schema("firewall-profiles", "form", FirewallProfileFields());
            s["firewall-rule"] = Schema("firewall-rule", "table", FirewallRuleFields());
            s["firewall-csr"] = Schema("firewall-csr", "table", Fields(
                F("name", "Name", "string", "Connection security rule name (EmbedCtxt)."),
                F("rule", "Rule string", "string", "The raw MS-GPFAS connection security rule grammar string."),
                Def(true, F("active", "Enabled", "bool", "Whether the rule is active."))));

            // ---- NRPT ----
            s["nrpt-rule"] = Schema("nrpt-rule", "table", Fields(
                F("ruleName", "Rule name", "string", "Unique key name under DnsPolicyConfig."),
                F("name", "Namespace / suffix", "string", "DNS suffix (leading dot), FQDN, or subnet. Multiple values comma-separated."),
                F("genericDnsServers", "DNS servers", "string", "Semicolon-separated DNS servers for this namespace."),
                Def(false, F("dnssecValidation", "Require DNSSEC validation", "bool", "DNSSEC validation required.")),
                F("proxyName", "Proxy", "string", "DirectAccess/proxy name, optional."),
                Enum("configOptions", "Configuration", "ConfigOptions bitmask for which option groups apply.",
                    new[] { "8", "Generic DNS server", "Generic DNS server option only." },
                    new[] { "2", "DNSSEC", "DNSSEC options only." },
                    new[] { "4", "DirectAccess", "DirectAccess options only." })));

            // ---- QoS ----
            s["qos-policy"] = Schema("qos-policy", "table", Fields(
                F("name", "Policy name", "string", "QoS policy name (stored under the QoS registry key)."),
                F("appName", "Application name or path", "string", "Executable to match, or * for all."),
                Def(-1, F("dscpValue", "DSCP value", "int", "0-63, or -1 to not set.")),
                F("throttleRate", "Throttle rate", "string", "Outbound throttle rate, e.g. '10 MBps', optional."),
                F("protocol", "Protocol", "string", "TCP, UDP, or * ."),
                F("localPort", "Source port(s)", "string", "Port or range, or * ."),
                F("remotePort", "Destination port(s)", "string", "Port or range, or * .")));

            // ---- Deployed printers ----
            s["deployed-printer"] = Schema("deployed-printer", "table", Fields(
                F("uncName", "Printer connection (UNC)", "string", "\\\\server\\printer connection name."),
                F("printerName", "Printer name", "string", "Printer share name part."),
                F("serverName", "Server name", "string", "Print server part.")));

            // ---- Folder redirection ----
            s["folder-redirection"] = Schema("folder-redirection", "table", Fields(
                Enum("folder", "Folder", "The known folder to redirect.", KnownFolderValues()),
                F("securityGroup", "Security group SID", "string", "SID the mapping applies to, or S-1-1-0 (Everyone)."),
                F("fullPath", "Target path", "string", "Redirection destination, e.g. \\\\server\\share\\%USERNAME%\\Documents."),
                Def("1001", F("flags", "Flags", "string", "Hex flag value (0x1 Move, 0x1000 Redirect To FullPath, 0x20 Relocate On Move, 0x10 Exclusive Access)."))));

            // ---- Wireless / wired ----
            s["wireless-policy"] = Schema("wireless-policy", "table", Fields(
                F("name", "Policy name", "string", "Friendly name of the wireless policy."),
                F("description", "Description", "string", ""),
                F("xml", "WLAN profile XML", "xml", "The ms-net-ieee-80211-GP-PolicyData XML (WLANProfile).")));
            s["wired-policy"] = Schema("wired-policy", "table", Fields(
                F("name", "Policy name", "string", "Friendly name of the wired policy."),
                F("description", "Description", "string", ""),
                F("xml", "LAN profile XML", "xml", "The ms-net-ieee-8023-GP-PolicyData XML (LANProfile).")));

            // ---- Network List Manager ----
            s["netlist-policy"] = Schema("netlist-policy", "table", Fields(
                F("network", "Network", "string", "Identifying network name, or 'Unidentified'/'Identifying'."),
                Enum("category", "Network location", "Category the network is forced to.",
                    new[] { "0", "Public" }, new[] { "1", "Private" }, new[] { "2", "Domain authenticated" }),
                F("name", "Name", "string", "Display name to force, optional.")));

            // ---- Public key / SRP / AppLocker / IPsec ----
            s["pki-trusted-cert"] = Schema("pki-trusted-cert", "table", Fields(
                Enum("store", "Store", "Which Public Key store the certificate goes in.",
                    new[] { "Root", "Trusted Root Certification Authorities" },
                    new[] { "CA", "Intermediate Certification Authorities" },
                    new[] { "Trust", "Enterprise Trust" }),
                F("thumbprint", "Thumbprint", "string", "Certificate SHA-1 thumbprint."),
                F("certificate", "Certificate (base64 DER)", "string", "The DER certificate, base64 encoded."),
                Def(false, F("autoEnrollment", "Enable certificate auto-enrollment", "bool", "Turns on the auto-enrollment registry policy."))));

            s["srp-rule"] = Schema("srp-rule", "table", Fields(
                Enum("ruleType", "Rule type", "Software Restriction rule kind.",
                    new[] { "path", "Path rule" }, new[] { "hash", "Hash rule" }, new[] { "cert", "Certificate rule" }, new[] { "zone", "Network zone rule" }),
                F("value", "Value", "string", "Path, hash, or zone the rule matches."),
                Enum("securityLevel", "Security level", "Safer level.",
                    new[] { "0", "Disallowed" }, new[] { "262144", "Basic User" }, new[] { "131072", "Unrestricted" })));

            s["applocker-rule"] = Schema("applocker-rule", "table", Fields(
                Enum("collection", "Rule collection", "Which AppLocker collection under SrpV2.",
                    new[] { "Exe", "Executable rules" }, new[] { "Msi", "Windows Installer rules" }, new[] { "Script", "Script rules" },
                    new[] { "Appx", "Packaged app rules" }, new[] { "Dll", "DLL rules" }),
                Enum("enforcementMode", "Enforcement", "Collection enforcement mode.",
                    new[] { "NotConfigured", "Not configured" }, new[] { "Enabled", "Enforce rules" }, new[] { "AuditOnly", "Audit only" }),
                F("ruleXml", "Rule XML", "xml", "A single AppLocker rule element (FilePathRule, FilePublisherRule, FileHashRule).")));

            s["ipsec-policy"] = Schema("ipsec-policy", "table", Fields(
                F("name", "Policy name", "string", "IPsec policy name (ipsecPolicy object)."),
                F("description", "Description", "string", ""),
                Def(false, F("assigned", "Assigned", "bool", "Whether this policy is the assigned IPsec policy for the GPO."))));

            // ---- Software installation ----
            s["software-installation"] = Schema("software-installation", "table", Fields(
                F("name", "Package name", "string", "Display name of the deployed package."),
                F("path", "Package path (UNC .msi)", "string", "UNC path to the .msi to deploy (create)."),
                Enum("deploymentType", "Deployment", "How the package is deployed.",
                    new[] { "A", "Assigned", "Install automatically." },
                    new[] { "P", "Published", "Available to install (user only)." }),
                F("productCode", "Product code", "string", "MSI product code GUID (read-only, set from the package).")));

            // ---- Scripts ----
            s["script-entry"] = Schema("script-entry", "table", Fields(
                F("script", "Script name or path", "string", "Executable or script path (CmdLine)."),
                F("parameters", "Parameters", "string", "Command-line parameters."),
                Def(false, F("powershell", "PowerShell script", "bool", "Stored in psscripts.ini instead of scripts.ini.")),
                F("content", "Script content", "text", "Optional: file content to write into the GPO scripts folder.")));

            // ---- GPP preference item schemas ----
            BuildPreferenceSchemas(s);

            _schemas = s;
            return s;
        }

        private static List<object> AuditFields()
        {
            string help = "0 none, 1 success, 2 failure, 3 success and failure.";
            string[][] vals = {
                new[] { "0", "No auditing", "No auditing." },
                new[] { "1", "Success", "Audit successful events." },
                new[] { "2", "Failure", "Audit failed events." },
                new[] { "3", "Success and Failure", "Audit both." } };
            string[][] keys = {
                new[]{"AuditSystemEvents","Audit system events"},
                new[]{"AuditLogonEvents","Audit logon events"},
                new[]{"AuditObjectAccess","Audit object access"},
                new[]{"AuditPrivilegeUse","Audit privilege use"},
                new[]{"AuditPolicyChange","Audit policy change"},
                new[]{"AuditAccountManage","Audit account management"},
                new[]{"AuditProcessTracking","Audit process tracking"},
                new[]{"AuditDSAccess","Audit directory service access"},
                new[]{"AuditAccountLogon","Audit account logon events"} };
            List<object> f = new List<object>();
            foreach (string[] k in keys)
            {
                f.Add(Def("0", Enum(k[0], k[1], help, vals)));
            }
            return f;
        }

        private static List<object> FirewallProfileFields()
        {
            List<object> f = new List<object>();
            foreach (string profile in new[] { "Domain", "Private", "Public" })
            {
                f.Add(Enum(profile + "State", profile + " profile: Firewall state", "EnableFirewall for this profile.",
                    new[] { "1", "On" }, new[] { "0", "Off" }));
                f.Add(Enum(profile + "Inbound", profile + " profile: Inbound connections", "DefaultInboundAction.",
                    new[] { "1", "Block (default)" }, new[] { "0", "Allow" }, new[] { "2", "Block all connections" }));
                f.Add(Enum(profile + "Outbound", profile + " profile: Outbound connections", "DefaultOutboundAction.",
                    new[] { "0", "Allow (default)" }, new[] { "1", "Block" }));
            }
            return f;
        }

        private static List<object> FirewallRuleFields()
        {
            return Fields(
                F("name", "Name", "string", "Rule display name (Name= token)."),
                F("description", "Description", "string", "Desc= token."),
                Enum("action", "Action", "Allow or block matching traffic.",
                    new[] { "Allow", "Allow the connection" }, new[] { "Block", "Block the connection" }),
                Enum("direction", "Direction", "Dir= token.", new[] { "In", "Inbound" }, new[] { "Out", "Outbound" }),
                Def(true, F("active", "Enabled", "bool", "Active= token.")),
                F("protocol", "Protocol number", "string", "6 TCP, 17 UDP, 1 ICMPv4, 58 ICMPv6, blank for any."),
                F("localPorts", "Local ports", "string", "LPort= token, e.g. 445 or RPC."),
                F("remotePorts", "Remote ports", "string", "RPort= token."),
                F("localAddresses", "Local addresses", "string", "LA4=/LA6= tokens, comma-separated."),
                F("remoteAddresses", "Remote addresses", "string", "RA4=/RA6= tokens, or LocalSubnet."),
                F("application", "Program path", "string", "App= token."),
                F("service", "Service", "string", "Svc= token, or * for any."),
                Enum("profiles", "Profiles", "Profile= token.",
                    new[] { "", "All profiles" }, new[] { "Domain", "Domain" }, new[] { "Private", "Private" }, new[] { "Public", "Public" }),
                Def(false, F("edge", "Edge traversal", "bool", "Edge= token.")));
        }

        private static string[][] UserRightValues()
        {
            string[] rights = {
                "SeNetworkLogonRight","SeDenyNetworkLogonRight","SeInteractiveLogonRight","SeDenyInteractiveLogonRight",
                "SeRemoteInteractiveLogonRight","SeDenyRemoteInteractiveLogonRight","SeBatchLogonRight","SeDenyBatchLogonRight",
                "SeServiceLogonRight","SeDenyServiceLogonRight","SeBackupPrivilege","SeRestorePrivilege","SeShutdownPrivilege",
                "SeRemoteShutdownPrivilege","SeTakeOwnershipPrivilege","SeDebugPrivilege","SeSystemtimePrivilege",
                "SeTimeZonePrivilege","SeLoadDriverPrivilege","SeImpersonatePrivilege","SeAssignPrimaryTokenPrivilege",
                "SeIncreaseQuotaPrivilege","SeChangeNotifyPrivilege","SeCreatePagefilePrivilege","SeManageVolumePrivilege",
                "SeSecurityPrivilege","SeSystemEnvironmentPrivilege","SeProfileSingleProcessPrivilege","SeSystemProfilePrivilege",
                "SeCreateGlobalPrivilege","SeCreateSymbolicLinkPrivilege","SeCreatePermanentPrivilege","SeLockMemoryPrivilege",
                "SeIncreaseBasePriorityPrivilege","SeIncreaseWorkingSetPrivilege","SeUndockPrivilege","SeTcbPrivilege",
                "SeMachineAccountPrivilege","SeEnableDelegationPrivilege","SeAuditPrivilege","SeTrustedCredManAccessPrivilege",
                "SeRelabelPrivilege","SeDelegateSessionUserImpersonatePrivilege","SeCreateTokenPrivilege","SeSyncAgentPrivilege" };
            List<string[]> v = new List<string[]>();
            foreach (string r in rights) { v.Add(new[] { r, r }); }
            return v.ToArray();
        }

        private static string[][] KnownFolderValues()
        {
            return new string[][] {
                new[] { "{FDD39AD0-238F-46AF-ADB4-6C85480369C7}", "Documents" },
                new[] { "{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}", "AppData (Roaming)" },
                new[] { "{B4BFCC3A-DB2C-424C-B029-7FE99A87C641}", "Desktop" },
                new[] { "{625B53C3-AB48-4EC1-BA1F-A1EF4146FC19}", "Start Menu" },
                new[] { "{33E28130-4E1E-4676-835A-98395C3BC3BB}", "Pictures" },
                new[] { "{4BD8D571-6D19-48D3-BE97-422220080E43}", "Music" },
                new[] { "{18989B1D-99B5-455B-841C-AB7C74E4DDFC}", "Videos" },
                new[] { "{1777F761-68AD-4D8A-87BD-30B759FA33DD}", "Favorites" },
                new[] { "{56784854-C6CB-462b-8169-88E350ACB882}", "Contacts" },
                new[] { "{374DE290-123F-4565-9164-39C4925E467B}", "Downloads" },
                new[] { "{bfb9d5e0-c6a9-404c-b2b2-ae6db6af4968}", "Links" },
                new[] { "{4C5C32FF-BB9D-43b0-B5B4-2D72E54EAAA4}", "Saved Games" },
                new[] { "{7d1d3a04-debb-4115-95cf-2f29da2920da}", "Searches" } };
        }

        // Preference item schemas: the Properties attributes per area, with the
        // action verb and the common options block. Fields match the GPP XML.
        private static void BuildPreferenceSchemas(Dictionary<string, Dictionary<string, object>> s)
        {
            PrefSchema(s, "Drives", Fields(
                ActionField(),
                F("path", "Location (UNC path)", "string", "\\\\server\\share to map."),
                F("letter", "Drive letter", "string", "Drive letter, e.g. S."),
                F("label", "Label", "string", "Volume label."),
                Def(true, F("persistent", "Reconnect", "bool", "persistent attribute.")),
                F("userName", "Connect as (user)", "string", "Optional alternate credentials user."),
                F("cpassword", "Password", "password", "GPP cpassword (stored encrypted by Windows; avoid.)")));

            PrefSchema(s, "EnvironmentVariables", Fields(
                ActionField(),
                F("name", "Variable name", "string", "Environment variable name."),
                F("value", "Value", "string", "Variable value."),
                Def(true, F("user", "User variable", "bool", "user=1 user variable, 0 system variable.")),
                Def(false, F("partial", "Partial (append to PATH-like)", "bool", "partial attribute."))));

            PrefSchema(s, "Files", Fields(
                ActionField(),
                F("fromPath", "Source file(s)", "string", "Source path, may contain wildcards."),
                F("targetPath", "Destination file", "string", "Target path."),
                Def(false, F("readOnly", "Read-only", "bool", "")),
                Def(false, F("hidden", "Hidden", "bool", "")),
                Def(false, F("archive", "Archive", "bool", ""))));

            PrefSchema(s, "Folders", Fields(
                ActionField(),
                F("path", "Folder path", "string", "Folder to create/modify."),
                Def(false, F("readOnly", "Read-only", "bool", "")),
                Def(false, F("hidden", "Hidden", "bool", "")),
                Def(false, F("archive", "Archive", "bool", ""))));

            PrefSchema(s, "IniFiles", Fields(
                ActionField(),
                F("path", "INI file path", "string", "The .ini file."),
                F("section", "Section", "string", "Section name."),
                F("property", "Property", "string", "Key name."),
                F("value", "Value", "string", "Value.")));

            PrefSchema(s, "Registry", Fields(
                ActionField(),
                Enum("hive", "Hive", "Registry hive.",
                    new[] { "HKEY_LOCAL_MACHINE", "HKEY_LOCAL_MACHINE" }, new[] { "HKEY_CURRENT_USER", "HKEY_CURRENT_USER" },
                    new[] { "HKEY_CLASSES_ROOT", "HKEY_CLASSES_ROOT" }, new[] { "HKEY_USERS", "HKEY_USERS" }),
                F("key", "Key", "string", "Subkey path."),
                F("name", "Value name", "string", "Value name (blank for default)."),
                Enum("type", "Type", "Registry value type.",
                    new[] { "REG_SZ", "String" }, new[] { "REG_EXPAND_SZ", "Expandable string" }, new[] { "REG_DWORD", "DWord" },
                    new[] { "REG_QWORD", "QWord" }, new[] { "REG_MULTI_SZ", "Multi-string" }, new[] { "REG_BINARY", "Binary" }),
                F("value", "Value", "string", "Value data.")));

            PrefSchema(s, "Shortcuts", Fields(
                ActionField(),
                F("shortcutPath", "Shortcut location", "string", "Where the shortcut is created, e.g. %DesktopDir%\\App."),
                Enum("targetType", "Target type", "What the shortcut points to.",
                    new[] { "FILESYSTEM", "File or folder" }, new[] { "URL", "URL" }, new[] { "SHELL", "Shell object" }),
                F("targetPath", "Target", "string", "Target path or URL."),
                F("arguments", "Arguments", "string", "Command-line arguments."),
                F("startIn", "Start in", "string", "Working directory."),
                F("iconPath", "Icon path", "string", "Icon file."),
                F("comment", "Comment", "string", "Tooltip.")));

            PrefSchema(s, "Applications", Fields(ActionField(),
                F("name", "Application", "string", "Application name.")));

            PrefSchema(s, "NetworkShares", Fields(
                ActionField(),
                F("name", "Share name", "string", "Share name."),
                F("path", "Folder path", "string", "Local folder shared."),
                F("comment", "Comment", "string", "Share comment.")));

            PrefSchema(s, "DataSources", Fields(
                ActionField(),
                F("dsn", "Data source name", "string", "DSN name."),
                F("driver", "Driver", "string", "ODBC driver."),
                Def(true, F("userDSN", "User DSN", "bool", "userDSN=1 user DSN, 0 system DSN.")),
                F("description", "Description", "string", "")));

            PrefSchema(s, "Devices", Fields(
                Enum("deviceAction", "Action", "Enable or disable the device class.",
                    new[] { "ENABLE", "Enable this device" }, new[] { "DISABLE", "Disable this device" }),
                F("deviceClass", "Device class", "string", "Class name."),
                F("deviceType", "Device type", "string", "Device type name."),
                F("deviceClassGUID", "Class GUID", "string", "Device setup class GUID.")));

            PrefSchema(s, "FolderOptions", Fields(ActionField(),
                F("fileExtension", "File extension", "string", "For OpenWith/FileType associations."),
                F("applicationPath", "Associated program", "string", "Program for the extension.")));

            PrefSchema(s, "InternetSettings", Fields(
                F("name", "Settings set", "string", "Internet Explorer version label."),
                F("proxyServer", "Proxy server", "string", "ProxyServer value, host:port."),
                Def(false, F("proxyEnable", "Use a proxy server", "bool", "ProxyEnable.")),
                F("homePage", "Home page", "string", "Start page URL.")));

            PrefSchema(s, "LocalUsersAndGroups", Fields(
                ActionField(),
                Enum("itemType", "Item type", "Create a local user or a local group.",
                    new[] { "group", "Local group" }, new[] { "user", "Local user" }),
                F("groupName", "Group name", "string", "Group name (for group items)."),
                F("userName", "User name", "string", "User name (for user items)."),
                F("members", "Members to add/remove", "string", "Comma-separated members, prefix - to remove."),
                F("fullName", "Full name", "string", "For user items."),
                F("description", "Description", "string", ""),
                Def(false, F("acctDisabled", "Account disabled", "bool", ""))));

            PrefSchema(s, "NetworkOptions", Fields(
                ActionField(),
                Enum("connType", "Connection type", "VPN or dial-up.",
                    new[] { "VPN", "VPN connection" }, new[] { "DUN", "Dial-up connection" }),
                F("name", "Connection name", "string", ""),
                F("ipAddress", "VPN server / phone number", "string", "")));

            PrefSchema(s, "PowerOptions", Fields(
                ActionField(),
                F("name", "Power scheme name", "string", "Scheme name."),
                Def(false, F("default", "Set as active scheme", "bool", "default=1.")),
                F("monitorAc", "Turn off monitor after (min, plugged in)", "int", ""),
                F("standbyAc", "Sleep after (min, plugged in)", "int", "")));

            PrefSchema(s, "Printers", Fields(
                ActionField(),
                Enum("printerType", "Printer type", "Which printer element to write.",
                    new[] { "SharedPrinter", "Shared (network) printer" }, new[] { "PortPrinter", "TCP/IP printer" }, new[] { "LocalPrinter", "Local printer" }),
                F("path", "Printer path / share", "string", "\\\\server\\printer for shared."),
                F("ipAddress", "IP address", "string", "For TCP/IP printers."),
                Def(false, F("default", "Set as default printer", "bool", ""))));

            PrefSchema(s, "RegionalOptions", Fields(
                F("localeId", "Locale ID", "string", "e.g. 1033."),
                F("localeName", "Locale name", "string", "e.g. English (United States)."),
                F("numDeciSymbol", "Decimal symbol", "string", "")));

            PrefSchema(s, "ScheduledTasks", Fields(
                ActionField(),
                Enum("taskType", "Task type", "Which task element to write.",
                    new[] { "TaskV2", "Scheduled task (Vista+)" }, new[] { "ImmediateTaskV2", "Immediate task (Vista+)" },
                    new[] { "Task", "Scheduled task (XP)" }, new[] { "ImmediateTask", "Immediate task (XP)" }),
                F("name", "Task name", "string", ""),
                F("appName", "Program", "string", "Executable to run."),
                F("args", "Arguments", "string", ""),
                F("runAs", "Run as", "string", "Account to run under.")));

            PrefSchema(s, "Services", Fields(
                Enum("startupType", "Startup type", "Service start mode.",
                    new[] { "NOCHANGE", "No change" }, new[] { "AUTOMATIC", "Automatic" }, new[] { "MANUAL", "Manual" }, new[] { "DISABLED", "Disabled" }),
                F("serviceName", "Service name", "string", ""),
                Enum("serviceAction", "Service action", "What to do with the service.",
                    new[] { "NOCHANGE", "No change" }, new[] { "START", "Start" }, new[] { "STOP", "Stop" }, new[] { "RESTART", "Restart" }),
                F("accountName", "Log on as", "string", "Service account.")));

            PrefSchema(s, "StartMenu", Fields(
                F("name", "Settings set", "string", "Start menu settings label."),
                Def(6, F("minMFU", "Number of programs on Start menu", "int", ""))));
        }

        private static void PrefSchema(Dictionary<string, Dictionary<string, object>> s, string area, List<object> fields)
        {
            Dictionary<string, object> schema = Schema("pref-" + area, "preference-items", fields);
            schema["common"] = CommonOptions();
            schema["area"] = area;
            s["pref-" + area] = schema;
        }
    }
}
