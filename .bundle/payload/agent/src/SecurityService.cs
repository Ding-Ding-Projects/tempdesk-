using System;
using System.Collections.Generic;
using System.DirectoryServices;
using System.Globalization;
using System.IO;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// Security settings stored in a GPO's GptTmpl.inf, the file edited by the
    /// Security Settings node of the Group Policy editor. The file is a UTF-16 LE
    /// INI under
    /// SYSVOL\...\{GUID}\Machine\Microsoft\Windows NT\SecEdit\GptTmpl.inf.
    /// Writing it also registers the Security client-side-extension pair on the
    /// GPO and bumps the GPO version in both AD (versionNumber) and GPT.INI so
    /// clients re-apply the policy.
    /// </summary>
    public class SecurityService : IAgentModule
    {
        private readonly AgentConfig _config;

        // The Security CSE / SnapIn pair that must appear in
        // gPCMachineExtensionNames when GptTmpl.inf carries settings.
        private const string SecurityCse = "{827D319E-6EAC-11D2-A4EA-00C04F79F83A}";
        private const string SecuritySnapIn = "{803E14A0-B4FB-11D0-A0D0-00A0C90F574B}";

        public SecurityService(AgentConfig config)
        {
            _config = config;
        }

        public string[] Capabilities { get { return new string[] { "security" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "gpo/{id}/security", true, false, GetSecurity);
            router.Map("PUT", "gpo/{id}/security", true, false, PutSecurity);
            router.Map("GET", "security/catalog", true, false, GetCatalog);
        }

        private string DnsDomain()
        {
            List<string> parts = new List<string>();
            foreach (string piece in _config.DomainDn.Split(','))
            {
                string trimmed = piece.Trim();
                if (trimmed.StartsWith("DC=", StringComparison.OrdinalIgnoreCase))
                {
                    parts.Add(trimmed.Substring(3));
                }
            }
            return string.Join(".", parts.ToArray());
        }

        private string GpoSysvolPath(string gpoId)
        {
            string guid = "{" + GpoService.NormalizeGuid(gpoId) + "}";
            string dns = DnsDomain();
            return @"\\" + dns + @"\SYSVOL\" + dns + @"\Policies\" + guid;
        }

        private string GptTmplPath(string gpoId)
        {
            return Path.Combine(GpoSysvolPath(gpoId),
                @"Machine\Microsoft\Windows NT\SecEdit\GptTmpl.inf");
        }

        // ---------------------------------------------------------------
        // GET
        // ---------------------------------------------------------------

        private object GetSecurity(RequestContext ctx)
        {
            string gpoId = ctx.Route("id");
            string path = GptTmplPath(gpoId);
            Dictionary<string, object> sections = new Dictionary<string, object>(StringComparer.Ordinal);
            if (File.Exists(path))
            {
                ParseInf(ReadInf(path), sections);
            }
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["sections"] = sections;
            return result;
        }

        // ---------------------------------------------------------------
        // PUT
        // ---------------------------------------------------------------

        private object PutSecurity(RequestContext ctx)
        {
            string gpoId = ctx.Route("id");
            Dictionary<string, object> body = ctx.BodyJson();
            Dictionary<string, object> sections = Json.GetDict(body, "sections");
            if (sections == null)
            {
                throw AgentException.BadRequest("A 'sections' object is required.");
            }

            string path = GptTmplPath(gpoId);
            string dir = Path.GetDirectoryName(path);
            Directory.CreateDirectory(dir);

            string inf = BuildInf(sections);
            // GptTmpl.inf is UTF-16 LE with a BOM.
            File.WriteAllText(path, inf, new UnicodeEncoding(false, true));

            // Register the Security CSE pair and bump the version so clients reapply.
            AddSecurityCse(gpoId);
            int newVersion = BumpVersion(gpoId);
            UpdateGptIni(gpoId, newVersion);

            ctx.Audit("gpo security put", gpoId);
            return GetSecurity(ctx);
        }

        // ---------------------------------------------------------------
        // CSE registration and version bump
        // ---------------------------------------------------------------

        private string GpoDn(string gpoId)
        {
            return "CN={" + GpoService.NormalizeGuid(gpoId) + "},CN=Policies,CN=System," + _config.DomainDn;
        }

        /// <summary>
        /// Merges the Security CSE pair into gPCMachineExtensionNames. The
        /// attribute is a list of [CSE GUID][SnapIn GUID ...] groups, each GUID
        /// upper-case in braces, groups sorted by CSE GUID, snap-ins sorted
        /// within a group. We parse, add our pair, and write it back sorted.
        /// </summary>
        private void AddSecurityCse(string gpoId)
        {
            using (DirectoryEntry gpo = DirectoryService.Bind(GpoDn(gpoId)))
            {
                string current = (string)(gpo.Properties["gPCMachineExtensionNames"].Value ?? "");
                string merged = MergeExtension(current, SecurityCse, SecuritySnapIn);
                gpo.Properties["gPCMachineExtensionNames"].Value = merged;
                gpo.CommitChanges();
            }
        }

        /// <summary>
        /// Parses the bracketed extension list, adds the snap-in under the CSE
        /// (creating the group if needed), and returns the re-serialized, sorted
        /// value. This is exposed for unit reasoning and kept pure.
        /// </summary>
        public static string MergeExtension(string current, string cse, string snapIn)
        {
            // Parse existing groups: each "[guid guid ...]" block. Groups are
            // kept in a sorted map keyed by the CSE GUID so the output is sorted.
            SortedDictionary<string, SortedDictionary<string, bool>> map =
                new SortedDictionary<string, SortedDictionary<string, bool>>(StringComparer.OrdinalIgnoreCase);

            if (!string.IsNullOrEmpty(current))
            {
                int i = 0;
                while (i < current.Length)
                {
                    int open = current.IndexOf('[', i);
                    if (open < 0) { break; }
                    int close = current.IndexOf(']', open + 1);
                    if (close < 0) { break; }
                    string inner = current.Substring(open + 1, close - open - 1);
                    List<string> guids = SplitGuids(inner);
                    if (guids.Count > 0)
                    {
                        string groupCse = guids[0].ToUpperInvariant();
                        SortedDictionary<string, bool> snaps;
                        if (!map.TryGetValue(groupCse, out snaps))
                        {
                            snaps = new SortedDictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
                            map[groupCse] = snaps;
                        }
                        for (int g = 1; g < guids.Count; g++)
                        {
                            snaps[guids[g].ToUpperInvariant()] = true;
                        }
                    }
                    i = close + 1;
                }
            }

            string cseKey = cse.ToUpperInvariant();
            SortedDictionary<string, bool> target;
            if (!map.TryGetValue(cseKey, out target))
            {
                target = new SortedDictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
                map[cseKey] = target;
            }
            target[snapIn.ToUpperInvariant()] = true;

            StringBuilder sb = new StringBuilder();
            foreach (KeyValuePair<string, SortedDictionary<string, bool>> group in map)
            {
                sb.Append('[');
                sb.Append(group.Key);
                foreach (KeyValuePair<string, bool> snap in group.Value)
                {
                    sb.Append(snap.Key);
                }
                sb.Append(']');
            }
            return sb.ToString();
        }

        private static List<string> SplitGuids(string inner)
        {
            List<string> result = new List<string>();
            int i = 0;
            while (i < inner.Length)
            {
                int open = inner.IndexOf('{', i);
                if (open < 0) { break; }
                int close = inner.IndexOf('}', open + 1);
                if (close < 0) { break; }
                result.Add(inner.Substring(open, close - open + 1));
                i = close + 1;
            }
            return result;
        }

        /// <summary>
        /// Increments the GPO version. versionNumber packs computer version in
        /// the high 16 bits and user version in the low 16 bits. A machine
        /// (Security) change bumps the computer half. Returns the new combined
        /// number for GPT.INI.
        /// </summary>
        private int BumpVersion(string gpoId)
        {
            using (DirectoryEntry gpo = DirectoryService.Bind(GpoDn(gpoId)))
            {
                int current = 0;
                object raw = gpo.Properties["versionNumber"].Value;
                if (raw != null)
                {
                    current = Convert.ToInt32(raw, CultureInfo.InvariantCulture);
                }
                int user = current & 0xFFFF;
                int computer = (current >> 16) & 0xFFFF;
                computer = (computer + 1) & 0xFFFF;
                int combined = (computer << 16) | user;
                gpo.Properties["versionNumber"].Value = combined;
                gpo.CommitChanges();
                return combined;
            }
        }

        private void UpdateGptIni(string gpoId, int version)
        {
            string path = Path.Combine(GpoSysvolPath(gpoId), "GPT.INI");
            // GPT.INI is a small ANSI INI: [General] Version=<n>. Preserve other
            // lines if present, update or add the Version line.
            List<string> lines = new List<string>();
            bool hasGeneral = false;
            bool wroteVersion = false;
            if (File.Exists(path))
            {
                foreach (string line in File.ReadAllLines(path))
                {
                    string trimmed = line.Trim();
                    if (trimmed.StartsWith("[General]", StringComparison.OrdinalIgnoreCase))
                    {
                        hasGeneral = true;
                        lines.Add(line);
                    }
                    else if (trimmed.StartsWith("Version=", StringComparison.OrdinalIgnoreCase))
                    {
                        lines.Add("Version=" + version.ToString(CultureInfo.InvariantCulture));
                        wroteVersion = true;
                    }
                    else
                    {
                        lines.Add(line);
                    }
                }
            }
            if (!hasGeneral)
            {
                lines.Insert(0, "[General]");
            }
            if (!wroteVersion)
            {
                lines.Add("Version=" + version.ToString(CultureInfo.InvariantCulture));
            }
            File.WriteAllLines(path, lines.ToArray(), Encoding.ASCII);
        }

        // ---------------------------------------------------------------
        // INF read/write
        // ---------------------------------------------------------------

        private static string ReadInf(string path)
        {
            // GptTmpl.inf is UTF-16 LE; StreamReader with BOM detection handles it.
            return File.ReadAllText(path, Encoding.Unicode);
        }

        /// <summary>
        /// Parses an INF into {sectionName: {key: value}}. Values keep their raw
        /// text; the Privilege Rights section's comma lists stay as single
        /// strings so round-tripping is exact.
        /// </summary>
        private static void ParseInf(string text, Dictionary<string, object> sections)
        {
            string current = null;
            Dictionary<string, object> section = null;
            foreach (string rawLine in text.Replace("\r\n", "\n").Split('\n'))
            {
                string line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith(";"))
                {
                    continue;
                }
                if (line.StartsWith("[") && line.EndsWith("]"))
                {
                    current = line.Substring(1, line.Length - 2);
                    // Skip the structural [Unicode] and [Version] sections.
                    if (string.Equals(current, "Unicode", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(current, "Version", StringComparison.OrdinalIgnoreCase))
                    {
                        section = null;
                        current = null;
                        continue;
                    }
                    section = new Dictionary<string, object>(StringComparer.Ordinal);
                    sections[current] = section;
                    continue;
                }
                if (section == null)
                {
                    continue;
                }
                int eq = line.IndexOf('=');
                if (eq < 0)
                {
                    continue;
                }
                string key = line.Substring(0, eq).Trim();
                string value = line.Substring(eq + 1).Trim();
                section[key] = value;
            }
        }

        /// <summary>
        /// Serializes sections back to a GptTmpl.inf, always emitting the
        /// structural [Unicode] and [Version] sections the format requires.
        /// </summary>
        private static string BuildInf(Dictionary<string, object> sections)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("[Unicode]\r\n");
            sb.Append("Unicode=yes\r\n");

            foreach (KeyValuePair<string, object> kv in sections)
            {
                if (string.Equals(kv.Key, "Unicode", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(kv.Key, "Version", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                Dictionary<string, object> section = kv.Value as Dictionary<string, object>;
                if (section == null)
                {
                    continue;
                }
                sb.Append("[").Append(kv.Key).Append("]\r\n");
                foreach (KeyValuePair<string, object> entry in section)
                {
                    sb.Append(entry.Key).Append(" = ").Append(ValueText(entry.Value)).Append("\r\n");
                }
            }

            sb.Append("[Version]\r\n");
            sb.Append("signature=\"$CHICAGO$\"\r\n");
            sb.Append("Revision=1\r\n");
            return sb.ToString();
        }

        private static string ValueText(object value)
        {
            if (value == null)
            {
                return "";
            }
            List<object> list = Json.AsList(value);
            if (list != null)
            {
                List<string> parts = new List<string>();
                foreach (object item in list)
                {
                    parts.Add(Convert.ToString(item, CultureInfo.InvariantCulture));
                }
                return string.Join(",", parts.ToArray());
            }
            return Convert.ToString(value, CultureInfo.InvariantCulture);
        }

        // ---------------------------------------------------------------
        // GET /security/catalog
        // ---------------------------------------------------------------

        private object GetCatalog(RequestContext ctx)
        {
            return SecurityCatalog.Build();
        }
    }

    /// <summary>
    /// The static catalog of well-known security settings per section with a
    /// label, a type and help text, so the portal can render proper forms
    /// instead of raw INI. This is a curated, documented subset: the common
    /// password/lockout/Kerberos policy, every Se* user right, audit categories
    /// and the frequently used registry-value security options.
    /// </summary>
    public static class SecurityCatalog
    {
        private static Dictionary<string, object> Entry(string key, string label, string type, string help)
        {
            Dictionary<string, object> d = new Dictionary<string, object>(StringComparer.Ordinal);
            d["key"] = key;
            d["label"] = label;
            d["type"] = type;
            d["help"] = help;
            return d;
        }

        public static Dictionary<string, object> Build()
        {
            Dictionary<string, object> catalog = new Dictionary<string, object>(StringComparer.Ordinal);

            // System Access: password and account-lockout policy.
            List<object> systemAccess = new List<object>();
            systemAccess.Add(Entry("MinimumPasswordAge", "Minimum password age (days)", "int", "Days before a password can be changed."));
            systemAccess.Add(Entry("MaximumPasswordAge", "Maximum password age (days)", "int", "Days before a password must be changed. -1 means never."));
            systemAccess.Add(Entry("MinimumPasswordLength", "Minimum password length", "int", "Fewest characters a password may contain."));
            systemAccess.Add(Entry("PasswordComplexity", "Password must meet complexity requirements", "bool01", "1 enables complexity requirements, 0 disables."));
            systemAccess.Add(Entry("PasswordHistorySize", "Enforce password history", "int", "Number of old passwords remembered."));
            systemAccess.Add(Entry("ClearTextPassword", "Store passwords using reversible encryption", "bool01", "1 stores reversibly, which is insecure."));
            systemAccess.Add(Entry("LockoutBadCount", "Account lockout threshold", "int", "Failed sign-ins before lockout. 0 never locks out."));
            systemAccess.Add(Entry("ResetLockoutCount", "Reset lockout counter after (minutes)", "int", "Minutes before the bad-count counter resets."));
            systemAccess.Add(Entry("LockoutDuration", "Account lockout duration (minutes)", "int", "Minutes an account stays locked. -1 means until an admin unlocks it."));
            systemAccess.Add(Entry("RequireLogonToChangePassword", "Require logon to change password", "bool01", "Legacy setting, usually 0."));
            systemAccess.Add(Entry("ForceLogoffWhenHourExpire", "Force logoff when logon hours expire", "bool01", "1 disconnects users outside their logon hours."));
            systemAccess.Add(Entry("NewAdministratorName", "Rename administrator account", "string", "New name for the built-in Administrator account."));
            systemAccess.Add(Entry("NewGuestName", "Rename guest account", "string", "New name for the built-in Guest account."));
            systemAccess.Add(Entry("EnableAdminAccount", "Administrator account status", "bool01", "1 enables, 0 disables the built-in Administrator."));
            systemAccess.Add(Entry("EnableGuestAccount", "Guest account status", "bool01", "1 enables, 0 disables the built-in Guest account."));
            catalog["System Access"] = systemAccess;

            // Kerberos Policy.
            List<object> kerberos = new List<object>();
            kerberos.Add(Entry("MaxTicketAge", "Maximum lifetime for user ticket (hours)", "int", "Hours a Kerberos TGT is valid."));
            kerberos.Add(Entry("MaxRenewAge", "Maximum lifetime for user ticket renewal (days)", "int", "Days a TGT may be renewed."));
            kerberos.Add(Entry("MaxServiceAge", "Maximum lifetime for service ticket (minutes)", "int", "Minutes a service ticket is valid."));
            kerberos.Add(Entry("MaxClockSkew", "Maximum tolerance for computer clock synchronization (minutes)", "int", "Allowed clock skew in minutes."));
            kerberos.Add(Entry("TicketValidateClient", "Enforce user logon restrictions", "bool01", "1 validates every request against the user rights policy."));
            catalog["Kerberos Policy"] = kerberos;

            // Event Audit: legacy audit categories (0 none,1 success,2 failure,3 both).
            List<object> eventAudit = new List<object>();
            string auditType = "audit";
            string auditHelp = "0 no auditing, 1 success, 2 failure, 3 success and failure.";
            eventAudit.Add(Entry("AuditSystemEvents", "Audit system events", auditType, auditHelp));
            eventAudit.Add(Entry("AuditLogonEvents", "Audit logon events", auditType, auditHelp));
            eventAudit.Add(Entry("AuditObjectAccess", "Audit object access", auditType, auditHelp));
            eventAudit.Add(Entry("AuditPrivilegeUse", "Audit privilege use", auditType, auditHelp));
            eventAudit.Add(Entry("AuditPolicyChange", "Audit policy change", auditType, auditHelp));
            eventAudit.Add(Entry("AuditAccountManage", "Audit account management", auditType, auditHelp));
            eventAudit.Add(Entry("AuditProcessTracking", "Audit process tracking", auditType, auditHelp));
            eventAudit.Add(Entry("AuditDSAccess", "Audit directory service access", auditType, auditHelp));
            eventAudit.Add(Entry("AuditAccountLogon", "Audit account logon events", auditType, auditHelp));
            catalog["Event Audit"] = eventAudit;

            // Privilege Rights: every Se* user right. Value is a comma list of
            // SIDs or account names (prefix *S-1-... for SIDs).
            List<object> rights = new List<object>();
            string[] seRights = new string[]
            {
                "SeTrustedCredManAccessPrivilege", "SeNetworkLogonRight", "SeTcbPrivilege",
                "SeMachineAccountPrivilege", "SeIncreaseQuotaPrivilege", "SeInteractiveLogonRight",
                "SeRemoteInteractiveLogonRight", "SeBackupPrivilege", "SeChangeNotifyPrivilege",
                "SeSystemtimePrivilege", "SeTimeZonePrivilege", "SeCreatePagefilePrivilege",
                "SeCreateTokenPrivilege", "SeCreateGlobalPrivilege", "SeCreatePermanentPrivilege",
                "SeCreateSymbolicLinkPrivilege", "SeDebugPrivilege", "SeDenyNetworkLogonRight",
                "SeDenyBatchLogonRight", "SeDenyServiceLogonRight", "SeDenyInteractiveLogonRight",
                "SeDenyRemoteInteractiveLogonRight", "SeEnableDelegationPrivilege",
                "SeRemoteShutdownPrivilege", "SeAuditPrivilege", "SeImpersonatePrivilege",
                "SeIncreaseWorkingSetPrivilege", "SeIncreaseBasePriorityPrivilege",
                "SeLoadDriverPrivilege", "SeLockMemoryPrivilege", "SeBatchLogonRight",
                "SeServiceLogonRight", "SeSecurityPrivilege", "SeRelabelPrivilege",
                "SeSystemEnvironmentPrivilege", "SeManageVolumePrivilege",
                "SeProfileSingleProcessPrivilege", "SeSystemProfilePrivilege",
                "SeUndockPrivilege", "SeAssignPrimaryTokenPrivilege", "SeRestorePrivilege",
                "SeShutdownPrivilege", "SeSyncAgentPrivilege", "SeTakeOwnershipPrivilege",
                "SeDelegateSessionUserImpersonatePrivilege"
            };
            foreach (string right in seRights)
            {
                rights.Add(Entry(right, HumanizeRight(right), "accountList",
                    "Comma-separated accounts or SIDs (SIDs prefixed with *) granted this right."));
            }
            catalog["Privilege Rights"] = rights;

            // Registry Values: common security options. The INF value form is
            // "<regtype>,<value>" for example "4,1".
            List<object> registryValues = new List<object>();
            registryValues.Add(Entry(
                @"MACHINE\System\CurrentControlSet\Control\Lsa\LimitBlankPasswordUse",
                "Accounts: Limit local account use of blank passwords to console logon only", "regDword", "4,1 enables."));
            registryValues.Add(Entry(
                @"MACHINE\System\CurrentControlSet\Control\Lsa\NoLMHash",
                "Network security: Do not store LAN Manager hash value on next password change", "regDword", "4,1 enables."));
            registryValues.Add(Entry(
                @"MACHINE\System\CurrentControlSet\Control\Lsa\RestrictAnonymous",
                "Network access: Do not allow anonymous enumeration of SAM accounts and shares", "regDword", "4,1 enables."));
            registryValues.Add(Entry(
                @"MACHINE\System\CurrentControlSet\Control\Lsa\LmCompatibilityLevel",
                "Network security: LAN Manager authentication level", "regDword", "4,5 for NTLMv2 only."));
            registryValues.Add(Entry(
                @"MACHINE\System\CurrentControlSet\Services\LanManServer\Parameters\RequireSecuritySignature",
                "Microsoft network server: Digitally sign communications (always)", "regDword", "4,1 enables."));
            registryValues.Add(Entry(
                @"MACHINE\System\CurrentControlSet\Services\LanmanWorkstation\Parameters\RequireSecuritySignature",
                "Microsoft network client: Digitally sign communications (always)", "regDword", "4,1 enables."));
            registryValues.Add(Entry(
                @"MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System\EnableLUA",
                "User Account Control: Run all administrators in Admin Approval Mode", "regDword", "4,1 enables."));
            registryValues.Add(Entry(
                @"MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System\ConsentPromptBehaviorAdmin",
                "User Account Control: Behavior of the elevation prompt for administrators", "regDword", "4,2 prompt for consent."));
            registryValues.Add(Entry(
                @"MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System\LegalNoticeCaption",
                "Interactive logon: Message title for users attempting to log on", "regString", "1,<title text>."));
            registryValues.Add(Entry(
                @"MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System\LegalNoticeText",
                "Interactive logon: Message text for users attempting to log on", "regString", "7,<message text>."));
            registryValues.Add(Entry(
                @"MACHINE\Software\Microsoft\Windows\CurrentVersion\Policies\System\DontDisplayLastUserName",
                "Interactive logon: Do not display last user name", "regDword", "4,1 enables."));
            registryValues.Add(Entry(
                @"MACHINE\System\CurrentControlSet\Control\Lsa\RestrictAnonymousSAM",
                "Network access: Restrict anonymous access to SAM", "regDword", "4,1 enables."));
            catalog["Registry Values"] = registryValues;

            return catalog;
        }

        private static string HumanizeRight(string se)
        {
            // Drop the leading "Se" and trailing "Privilege"/"Right" for a label.
            string s = se;
            if (s.StartsWith("Se", StringComparison.Ordinal)) { s = s.Substring(2); }
            if (s.EndsWith("Privilege", StringComparison.Ordinal)) { s = s.Substring(0, s.Length - "Privilege".Length); }
            if (s.EndsWith("Right", StringComparison.Ordinal)) { s = s.Substring(0, s.Length - "Right".Length); }
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < s.Length; i++)
            {
                char c = s[i];
                if (i > 0 && char.IsUpper(c)) { sb.Append(' '); }
                sb.Append(c);
            }
            return sb.ToString();
        }
    }
}
