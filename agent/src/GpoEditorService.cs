using System;
using System.Collections.Generic;
using System.DirectoryServices;
using System.Globalization;
using System.IO;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// The full Group Policy Management Editor as a generic tree plus node
    /// CRUD. GET /gpo/{id}/tree returns the GPME tree (GpoNodes) with each
    /// node's capability and schema. GET /gpo/nodes/schema publishes the item
    /// schemas (GpoSchema). Form nodes use GET/PUT /gpo/{id}/node/{nodeId};
    /// table and preference nodes use
    /// GET/POST/PATCH/DELETE /gpo/{id}/node/{nodeId}/items[/{itemId}].
    ///
    /// Each node id maps to a real backing: GptTmpl.inf sections, audit.csv,
    /// Registry.pol values (written through Set-GPRegistryValue so the registry
    /// CSE and version bump are handled, with firewall/QoS/NRPT/SRP/AppLocker
    /// keys per their documented layout), scripts.ini/psscripts.ini,
    /// fdeploy1.ini, GPP XML, and the AD objects for wireless/wired, deployed
    /// printers and software installation. Writes register the matching CSE
    /// pair (GpoWrite / GpoCse) and bump the GPO version.
    /// </summary>
    public class GpoEditorService : IAgentModule
    {
        private readonly AgentConfig _config;

        public GpoEditorService(AgentConfig config)
        {
            _config = config;
        }

        public string[] Capabilities
        {
            get
            {
                return new string[]
                {
                    "gpo-editor", "gpo-security-full", "gpo-advanced-audit", "gpo-firewall",
                    "gpo-scripts-full", "gpo-folder-redirection", "gpo-nrpt", "gpo-qos",
                    "gpo-wired", "gpo-wireless", "gpo-deployed-printers", "gpo-ipsec",
                    "gpo-applocker", "gpo-srp", "gpo-software-installation", "gpo-preferences-full"
                };
            }
        }

        public void Register(Router router)
        {
            router.Map("GET", "gpo/nodes/schema", true, false, Schemas);
            router.Map("GET", "gpo/{id}/tree", true, false, Tree);
            router.Map("GET", "gpo/{id}/node/{nodeId}", true, false, GetNode);
            router.Map("PUT", "gpo/{id}/node/{nodeId}", true, false, PutNode);
            router.Map("GET", "gpo/{id}/node/{nodeId}/items", true, false, ListItems);
            router.Map("POST", "gpo/{id}/node/{nodeId}/items", true, false, CreateItem);
            router.Map("PATCH", "gpo/{id}/node/{nodeId}/items/{itemId}", true, false, PatchItem);
            router.Map("DELETE", "gpo/{id}/node/{nodeId}/items/{itemId}", true, false, DeleteItem);
        }

        private PowerShellHost Ps(RequestContext ctx)
        {
            if (ctx.Ps == null) { throw AgentException.Internal("PowerShell host is not available."); }
            return ctx.Ps;
        }

        // ===============================================================
        // Tree and schema
        // ===============================================================

        private object Schemas(RequestContext ctx)
        {
            Dictionary<string, Dictionary<string, object>> schemas = GpoSchema.Build();
            List<object> list = new List<object>();
            foreach (KeyValuePair<string, Dictionary<string, object>> kv in schemas)
            {
                list.Add(kv.Value);
            }
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["schemas"] = list;
            return result;
        }

        private object Tree(RequestContext ctx)
        {
            ctx.Route("id"); // validate present
            List<object> roots = new List<object>();
            foreach (string rootId in GpoNodes.Roots)
            {
                roots.Add(ShapeNode(rootId));
            }
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["nodes"] = roots;
            return result;
        }

        private object ShapeNode(string id)
        {
            GpoNode n = GpoNodes.Get(id);
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = n.Id;
            row["name"] = n.Name;
            row["kind"] = n.Kind;
            row["class"] = n.Class;
            row["capability"] = n.Capability;
            row["itemSchema"] = n.ItemSchema;
            row["available"] = true;        // Windows backend serves every node
            row["unavailableReason"] = n.Unavailable;
            if (n.Children.Count > 0)
            {
                List<object> children = new List<object>();
                foreach (string c in n.Children) { children.Add(ShapeNode(c)); }
                row["children"] = children;
            }
            return row;
        }

        private GpoNode RequireNode(RequestContext ctx)
        {
            string nodeId = ctx.Route("nodeId");
            GpoNode n = GpoNodes.Get(nodeId);
            if (n == null) { throw AgentException.NotFound("No such node '" + nodeId + "'."); }
            return n;
        }

        // ===============================================================
        // Form nodes
        // ===============================================================

        private object GetNode(RequestContext ctx)
        {
            string gpoId = ctx.Route("id");
            GpoNode n = RequireNode(ctx);
            if (n.Kind != "form")
            {
                throw AgentException.BadRequest("Node '" + n.Id + "' is a " + n.Kind + " node; use the items endpoint.");
            }
            Dictionary<string, object> values = ReadForm(ctx, gpoId, n);
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["nodeId"] = n.Id;
            result["schema"] = n.ItemSchema;
            result["values"] = values;
            return result;
        }

        private object PutNode(RequestContext ctx)
        {
            string gpoId = ctx.Route("id");
            GpoNode n = RequireNode(ctx);
            if (n.Kind != "form")
            {
                throw AgentException.BadRequest("Node '" + n.Id + "' is a " + n.Kind + " node; use the items endpoint.");
            }
            Dictionary<string, object> body = ctx.BodyJson();
            Dictionary<string, object> values = Json.GetDict(body, "values");
            if (values == null) { throw AgentException.BadRequest("A 'values' object is required."); }
            WriteForm(ctx, gpoId, n, values);
            ctx.Audit("gpo node put", gpoId + " " + n.Id);
            return GetNode(ctx);
        }

        private Dictionary<string, object> ReadForm(RequestContext ctx, string gpoId, GpoNode n)
        {
            if (n.Id.StartsWith(n.Class.ToLowerInvariant() + "/pol/win/sec/", StringComparison.Ordinal)
                || n.Id.EndsWith("/eventlog", StringComparison.Ordinal)
                || n.Id.Contains("/account/") || n.Id.EndsWith("/local/audit", StringComparison.Ordinal))
            {
                return ReadInfSection(gpoId, InfSectionFor(n));
            }
            if (n.Id.EndsWith("/firewall/profiles", StringComparison.Ordinal))
            {
                return ReadFirewallProfiles(ctx, gpoId);
            }
            return new Dictionary<string, object>(StringComparer.Ordinal);
        }

        private void WriteForm(RequestContext ctx, string gpoId, GpoNode n, Dictionary<string, object> values)
        {
            if (n.Id.EndsWith("/firewall/profiles", StringComparison.Ordinal))
            {
                WriteFirewallProfiles(ctx, gpoId, values);
                return;
            }
            // Everything else in a security form is a GptTmpl.inf section.
            WriteInfSection(gpoId, InfSectionFor(n), values);
        }

        private string InfSectionFor(GpoNode n)
        {
            if (n.Id.EndsWith("/account/password", StringComparison.Ordinal)
                || n.Id.EndsWith("/account/lockout", StringComparison.Ordinal))
            {
                return "System Access";
            }
            if (n.Id.EndsWith("/account/kerberos", StringComparison.Ordinal)) { return "Kerberos Policy"; }
            if (n.Id.EndsWith("/local/audit", StringComparison.Ordinal)) { return "Event Audit"; }
            if (n.Id.EndsWith("/eventlog", StringComparison.Ordinal)) { return "Event Log"; }
            throw AgentException.BadRequest("Node '" + n.Id + "' has no security section.");
        }

        // ===============================================================
        // Item (table / preference / script) nodes
        // ===============================================================

        private object ListItems(RequestContext ctx)
        {
            string gpoId = ctx.Route("id");
            GpoNode n = RequireNode(ctx);
            List<object> items = ReadItems(ctx, gpoId, n);
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["nodeId"] = n.Id;
            result["schema"] = n.ItemSchema;
            result["items"] = items;
            return result;
        }

        private object CreateItem(RequestContext ctx)
        {
            string gpoId = ctx.Route("id");
            GpoNode n = RequireNode(ctx);
            Dictionary<string, object> body = ctx.BodyJson();
            object created = MutateItems(ctx, gpoId, n, "create", null, body);
            ctx.Audit("gpo item create", gpoId + " " + n.Id);
            return StatusResult.Created(created);
        }

        private object PatchItem(RequestContext ctx)
        {
            string gpoId = ctx.Route("id");
            GpoNode n = RequireNode(ctx);
            string itemId = ctx.Route("itemId");
            Dictionary<string, object> body = ctx.BodyJson();
            object updated = MutateItems(ctx, gpoId, n, "update", itemId, body);
            ctx.Audit("gpo item patch", gpoId + " " + n.Id + " " + itemId);
            return updated;
        }

        private object DeleteItem(RequestContext ctx)
        {
            string gpoId = ctx.Route("id");
            GpoNode n = RequireNode(ctx);
            string itemId = ctx.Route("itemId");
            MutateItems(ctx, gpoId, n, "delete", itemId, null);
            ctx.Audit("gpo item delete", gpoId + " " + n.Id + " " + itemId);
            return StatusResult.NoContent();
        }

        private List<object> ReadItems(RequestContext ctx, string gpoId, GpoNode n)
        {
            switch (n.ItemSchema)
            {
                case "pref-Applications": case "pref-Drives": case "pref-EnvironmentVariables":
                case "pref-Files": case "pref-Folders": case "pref-IniFiles": case "pref-NetworkShares":
                case "pref-Registry": case "pref-Shortcuts": case "pref-DataSources": case "pref-Devices":
                case "pref-FolderOptions": case "pref-InternetSettings": case "pref-LocalUsersAndGroups":
                case "pref-NetworkOptions": case "pref-PowerOptions": case "pref-Printers":
                case "pref-RegionalOptions": case "pref-ScheduledTasks": case "pref-Services":
                case "pref-StartMenu":
                    return ReadPreferenceItems(gpoId, n);
                case "sec-user-right": return ReadUserRights(gpoId);
                case "sec-option": return ReadRegistryValuesSection(gpoId);
                case "sec-restricted-group": return ReadRestrictedGroups(gpoId);
                case "sec-system-service": return ReadServicesSection(gpoId);
                case "sec-registry-perm": return ReadInfKeyedSection(gpoId, "Registry Keys", "key");
                case "sec-file-perm": return ReadInfKeyedSection(gpoId, "File Security", "path");
                case "advanced-audit": return ReadAdvancedAudit(gpoId);
                case "firewall-rule": return ReadFirewallRules(ctx, gpoId, n);
                case "firewall-csr": return ReadFirewallCsr(ctx, gpoId);
                case "nrpt-rule": return ReadNrpt(ctx, gpoId);
                case "qos-policy": return ReadQos(ctx, gpoId, n);
                case "srp-rule": return ReadSrp(ctx, gpoId, n);
                case "applocker-rule": return ReadAppLocker(ctx, gpoId, n);
                case "netlist-policy": return ReadNetList(ctx, gpoId, n);
                case "folder-redirection": return ReadFolderRedirection(gpoId);
                case "script-entry": return ReadScripts(gpoId, n);
                case "deployed-printer": return ReadDeployedPrinters(gpoId, n);
                case "wireless-policy": return ReadNetworkAdPolicy(gpoId, "IEEE80211");
                case "wired-policy": return ReadNetworkAdPolicy(gpoId, "IEEE8023");
                case "software-installation": return ReadSoftwareInstallation(gpoId, n);
                case "pki-trusted-cert": return ReadInfKeyedSection(gpoId, "Public Key Policies", "thumbprint");
                case "ipsec-policy": return ReadIpsec(gpoId);
                default:
                    return new List<object>();
            }
        }

        private object MutateItems(RequestContext ctx, string gpoId, GpoNode n, string op, string itemId, Dictionary<string, object> body)
        {
            string schema = n.ItemSchema;
            if (schema != null && schema.StartsWith("pref-", StringComparison.Ordinal))
            {
                return MutatePreferenceItems(gpoId, n, op, itemId, body);
            }
            switch (schema)
            {
                case "sec-user-right": return MutateUserRights(gpoId, op, itemId, body);
                case "sec-option": return MutateRegistryValues(gpoId, op, itemId, body);
                case "sec-restricted-group": return MutateRestrictedGroups(gpoId, op, itemId, body);
                case "sec-system-service": return MutateServices(gpoId, op, itemId, body);
                case "sec-registry-perm": return MutateInfKeyed(gpoId, "Registry Keys", "key", op, itemId, body);
                case "sec-file-perm": return MutateInfKeyed(gpoId, "File Security", "path", op, itemId, body);
                case "advanced-audit": return MutateAdvancedAudit(gpoId, op, itemId, body);
                case "firewall-rule": return MutateFirewallRules(ctx, gpoId, n, op, itemId, body);
                case "firewall-csr": return MutateFirewallCsr(ctx, gpoId, op, itemId, body);
                case "nrpt-rule": return MutateNrpt(ctx, gpoId, op, itemId, body);
                case "qos-policy": return MutateQos(ctx, gpoId, n, op, itemId, body);
                case "srp-rule": return MutateSrp(ctx, gpoId, n, op, itemId, body);
                case "applocker-rule": return MutateAppLocker(ctx, gpoId, n, op, itemId, body);
                case "netlist-policy": return MutateNetList(ctx, gpoId, n, op, itemId, body);
                case "folder-redirection": return MutateFolderRedirection(gpoId, op, itemId, body);
                case "script-entry": return MutateScripts(gpoId, n, op, itemId, body);
                case "deployed-printer": return MutateDeployedPrinters(gpoId, n, op, itemId, body);
                case "wireless-policy": return MutateNetworkAdPolicy(gpoId, "IEEE80211", op, itemId, body);
                case "wired-policy": return MutateNetworkAdPolicy(gpoId, "IEEE8023", op, itemId, body);
                case "software-installation": return MutateSoftwareInstallation(gpoId, n, op, itemId, body);
                case "pki-trusted-cert": return MutateInfKeyed(gpoId, "Public Key Policies", "thumbprint", op, itemId, body);
                case "ipsec-policy": return MutateIpsec(gpoId, op, itemId, body);
                default:
                    throw AgentException.BadRequest("Node '" + n.Id + "' does not support item editing.");
            }
        }

        // ===============================================================
        // GptTmpl.inf access (reused INF reader/writer)
        // ===============================================================

        private string GptTmplPath(string gpoId)
        {
            return Path.Combine(GpoWrite.SysvolPath(_config, gpoId),
                @"Machine\Microsoft\Windows NT\SecEdit\GptTmpl.inf");
        }

        private Dictionary<string, Dictionary<string, string>> LoadInf(string gpoId)
        {
            Dictionary<string, Dictionary<string, string>> inf =
                new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            string path = GptTmplPath(gpoId);
            if (!File.Exists(path)) { return inf; }
            string current = null;
            foreach (string rawLine in File.ReadAllText(path, Encoding.Unicode).Replace("\r\n", "\n").Split('\n'))
            {
                string line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith(";")) { continue; }
                if (line.StartsWith("[") && line.EndsWith("]"))
                {
                    current = line.Substring(1, line.Length - 2);
                    if (!inf.ContainsKey(current)) { inf[current] = new Dictionary<string, string>(StringComparer.Ordinal); }
                    continue;
                }
                if (current == null) { continue; }
                int eq = line.IndexOf('=');
                if (eq < 0) { inf[current][line] = ""; continue; }
                inf[current][line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
            return inf;
        }

        private void SaveInf(string gpoId, Dictionary<string, Dictionary<string, string>> inf)
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("[Unicode]\r\nUnicode=yes\r\n");
            foreach (KeyValuePair<string, Dictionary<string, string>> sect in inf)
            {
                if (string.Equals(sect.Key, "Unicode", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(sect.Key, "Version", StringComparison.OrdinalIgnoreCase)) { continue; }
                sb.Append("[").Append(sect.Key).Append("]\r\n");
                foreach (KeyValuePair<string, string> kv in sect.Value)
                {
                    sb.Append(kv.Key).Append(" = ").Append(kv.Value).Append("\r\n");
                }
            }
            sb.Append("[Version]\r\nsignature=\"$CHICAGO$\"\r\nRevision=1\r\n");
            string path = GptTmplPath(gpoId);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, sb.ToString(), new UnicodeEncoding(false, true));
            GpoWrite.Touch(_config, gpoId, true, false,
                new[] { GpoWrite.Cse("Machine", GpoCse.Security) });
        }

        private Dictionary<string, object> ReadInfSection(string gpoId, string section)
        {
            Dictionary<string, object> values = new Dictionary<string, object>(StringComparer.Ordinal);
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (inf.TryGetValue(section, out sect))
            {
                foreach (KeyValuePair<string, string> kv in sect) { values[kv.Key] = kv.Value; }
            }
            return values;
        }

        private void WriteInfSection(string gpoId, string section, Dictionary<string, object> values)
        {
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (!inf.TryGetValue(section, out sect))
            {
                sect = new Dictionary<string, string>(StringComparer.Ordinal);
                inf[section] = sect;
            }
            foreach (KeyValuePair<string, object> kv in values)
            {
                object v = kv.Value;
                string text;
                if (v is bool) { text = (bool)v ? "1" : "0"; }
                else { text = Convert.ToString(v, CultureInfo.InvariantCulture); }
                sect[kv.Key] = text;
            }
            SaveInf(gpoId, inf);
        }

        // User Rights Assignment (Privilege Rights section).
        private List<object> ReadUserRights(string gpoId)
        {
            List<object> items = new List<object>();
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (inf.TryGetValue("Privilege Rights", out sect))
            {
                foreach (KeyValuePair<string, string> kv in sect)
                {
                    Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                    row["id"] = kv.Key;
                    row["right"] = kv.Key;
                    row["accounts"] = kv.Value;
                    items.Add(row);
                }
            }
            return items;
        }

        private object MutateUserRights(string gpoId, string op, string itemId, Dictionary<string, object> body)
        {
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (!inf.TryGetValue("Privilege Rights", out sect))
            {
                sect = new Dictionary<string, string>(StringComparer.Ordinal);
                inf["Privilege Rights"] = sect;
            }
            if (op == "delete") { sect.Remove(itemId); SaveInf(gpoId, inf); return null; }
            string right = op == "update" ? itemId : Json.RequireString(body, "right", 128);
            string accounts = Json.GetString(body, "accounts");
            sect[right] = accounts != null ? accounts : "";
            SaveInf(gpoId, inf);
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = right; row["right"] = right; row["accounts"] = sect[right];
            return row;
        }

        private List<object> ReadRegistryValuesSection(string gpoId)
        {
            List<object> items = new List<object>();
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (inf.TryGetValue("Registry Values", out sect))
            {
                foreach (KeyValuePair<string, string> kv in sect)
                {
                    Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                    row["id"] = kv.Key; row["key"] = kv.Key;
                    int comma = kv.Value.IndexOf(',');
                    if (comma > 0)
                    {
                        row["regType"] = kv.Value.Substring(0, comma);
                        row["value"] = kv.Value.Substring(comma + 1);
                    }
                    else { row["regType"] = ""; row["value"] = kv.Value; }
                    items.Add(row);
                }
            }
            return items;
        }

        private object MutateRegistryValues(string gpoId, string op, string itemId, Dictionary<string, object> body)
        {
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (!inf.TryGetValue("Registry Values", out sect))
            {
                sect = new Dictionary<string, string>(StringComparer.Ordinal);
                inf["Registry Values"] = sect;
            }
            if (op == "delete") { sect.Remove(itemId); SaveInf(gpoId, inf); return null; }
            string key = op == "update" ? itemId : Json.RequireString(body, "key", 512);
            string regType = Json.GetString(body, "regType");
            string value = Json.GetString(body, "value");
            sect[key] = (regType != null ? regType : "4") + "," + (value != null ? value : "");
            SaveInf(gpoId, inf);
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = key; row["key"] = key; row["regType"] = regType; row["value"] = value;
            return row;
        }

        // Restricted Groups: Group__Members / Group__Memberof keys in [Group Membership].
        private List<object> ReadRestrictedGroups(string gpoId)
        {
            List<object> items = new List<object>();
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (!inf.TryGetValue("Group Membership", out sect)) { return items; }
            Dictionary<string, Dictionary<string, object>> byGroup =
                new Dictionary<string, Dictionary<string, object>>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, string> kv in sect)
            {
                string group, which;
                if (kv.Key.EndsWith("__Members", StringComparison.Ordinal))
                { group = kv.Key.Substring(0, kv.Key.Length - 9); which = "members"; }
                else if (kv.Key.EndsWith("__Memberof", StringComparison.Ordinal))
                { group = kv.Key.Substring(0, kv.Key.Length - 10); which = "memberOf"; }
                else { continue; }
                Dictionary<string, object> row;
                if (!byGroup.TryGetValue(group, out row))
                {
                    row = new Dictionary<string, object>(StringComparer.Ordinal);
                    row["id"] = group; row["group"] = group; row["members"] = ""; row["memberOf"] = "";
                    byGroup[group] = row;
                }
                row[which] = kv.Value;
            }
            foreach (Dictionary<string, object> r in byGroup.Values) { items.Add(r); }
            return items;
        }

        private object MutateRestrictedGroups(string gpoId, string op, string itemId, Dictionary<string, object> body)
        {
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (!inf.TryGetValue("Group Membership", out sect))
            {
                sect = new Dictionary<string, string>(StringComparer.Ordinal);
                inf["Group Membership"] = sect;
            }
            if (op == "delete")
            {
                sect.Remove(itemId + "__Members");
                sect.Remove(itemId + "__Memberof");
                SaveInf(gpoId, inf);
                return null;
            }
            string group = op == "update" ? itemId : Json.RequireString(body, "group", 256);
            sect[group + "__Members"] = Json.GetString(body, "members") ?? "";
            sect[group + "__Memberof"] = Json.GetString(body, "memberOf") ?? "";
            SaveInf(gpoId, inf);
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = group; row["group"] = group;
            row["members"] = sect[group + "__Members"]; row["memberOf"] = sect[group + "__Memberof"];
            return row;
        }

        // System Services: "ServiceName = startup,SDDL" in [Service General Setting].
        private List<object> ReadServicesSection(string gpoId)
        {
            List<object> items = new List<object>();
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (!inf.TryGetValue("Service General Setting", out sect)) { return items; }
            foreach (KeyValuePair<string, string> kv in sect)
            {
                Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                row["id"] = kv.Key.Trim('"'); row["service"] = kv.Key.Trim('"');
                string val = kv.Value;
                int comma = val.IndexOf(',');
                if (comma > 0)
                {
                    row["startup"] = val.Substring(0, comma);
                    row["sddl"] = val.Substring(comma + 1).Trim('"');
                }
                else { row["startup"] = val; row["sddl"] = ""; }
                items.Add(row);
            }
            return items;
        }

        private object MutateServices(string gpoId, string op, string itemId, Dictionary<string, object> body)
        {
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (!inf.TryGetValue("Service General Setting", out sect))
            {
                sect = new Dictionary<string, string>(StringComparer.Ordinal);
                inf["Service General Setting"] = sect;
            }
            if (op == "delete") { sect.Remove("\"" + itemId + "\""); sect.Remove(itemId); SaveInf(gpoId, inf); return null; }
            string svc = op == "update" ? itemId : Json.RequireString(body, "service", 256);
            string startup = Json.GetString(body, "startup") ?? "4";
            string sddl = Json.GetString(body, "sddl") ?? "";
            sect["\"" + svc + "\""] = startup + ",\"" + sddl + "\"";
            SaveInf(gpoId, inf);
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = svc; row["service"] = svc; row["startup"] = startup; row["sddl"] = sddl;
            return row;
        }

        // Generic "key,propagation,SDDL" INF sections (Registry Keys / File Security / Public Key Policies).
        private List<object> ReadInfKeyedSection(string gpoId, string section, string keyField)
        {
            List<object> items = new List<object>();
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (!inf.TryGetValue(section, out sect)) { return items; }
            foreach (KeyValuePair<string, string> kv in sect)
            {
                Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                row["id"] = kv.Key.Trim('"');
                row[keyField] = kv.Key.Trim('"');
                string[] parts = kv.Value.Split(new char[] { ',' }, 2);
                row["propagation"] = parts.Length > 0 ? parts[0] : "0";
                row["sddl"] = parts.Length > 1 ? parts[1].Trim('"') : "";
                items.Add(row);
            }
            return items;
        }

        private object MutateInfKeyed(string gpoId, string section, string keyField, string op, string itemId, Dictionary<string, object> body)
        {
            Dictionary<string, Dictionary<string, string>> inf = LoadInf(gpoId);
            Dictionary<string, string> sect;
            if (!inf.TryGetValue(section, out sect))
            {
                sect = new Dictionary<string, string>(StringComparer.Ordinal);
                inf[section] = sect;
            }
            if (op == "delete") { sect.Remove("\"" + itemId + "\""); sect.Remove(itemId); SaveInf(gpoId, inf); return null; }
            string key = op == "update" ? itemId : Json.RequireString(body, keyField, 1024);
            string prop = Json.GetString(body, "propagation") ?? "0";
            string sddl = Json.GetString(body, "sddl") ?? "";
            sect["\"" + key + "\""] = prop + ",\"" + sddl + "\"";
            SaveInf(gpoId, inf);
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = key; row[keyField] = key; row["propagation"] = prop; row["sddl"] = sddl;
            return row;
        }

        // ===============================================================
        // Advanced audit (audit.csv under Machine\Microsoft\Windows NT\Audit)
        // ===============================================================

        private string AuditCsvPath(string gpoId)
        {
            return Path.Combine(GpoWrite.SysvolPath(_config, gpoId),
                @"Machine\Microsoft\Windows NT\Audit\audit.csv");
        }

        private const string AuditHeader =
            "Machine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting,Setting Value";

        private List<object> ReadAdvancedAudit(string gpoId)
        {
            List<object> items = new List<object>();
            string path = AuditCsvPath(gpoId);
            if (!File.Exists(path)) { return items; }
            string[] lines = File.ReadAllLines(path, new UTF8Encoding(false));
            for (int i = 1; i < lines.Length; i++)
            {
                if (lines[i].Trim().Length == 0) { continue; }
                string[] c = lines[i].Split(',');
                if (c.Length < 7) { continue; }
                Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                row["id"] = c[3].Trim('{', '}');
                row["policyTarget"] = c[1];
                row["subcategory"] = c[2];
                row["subcategoryGuid"] = c[3];
                row["settingValue"] = c[6];
                items.Add(row);
            }
            return items;
        }

        private object MutateAdvancedAudit(string gpoId, string op, string itemId, Dictionary<string, object> body)
        {
            List<object> rows = ReadAdvancedAudit(gpoId);
            List<string[]> csv = new List<string[]>();
            foreach (object o in rows)
            {
                Dictionary<string, object> r = (Dictionary<string, object>)o;
                if (op != "create" && string.Equals(Convert.ToString(r["id"]), itemId, StringComparison.OrdinalIgnoreCase))
                {
                    continue; // drop; re-added below for update
                }
                csv.Add(new string[]
                {
                    "", Convert.ToString(r["policyTarget"]), Convert.ToString(r["subcategory"]),
                    Convert.ToString(r["subcategoryGuid"]), "", "", Convert.ToString(r["settingValue"])
                });
            }
            Dictionary<string, object> result = null;
            if (op != "delete")
            {
                string guid = op == "update" ? ("{" + itemId.Trim('{', '}') + "}") : Json.RequireString(body, "subcategoryGuid", 64);
                string target = Json.GetString(body, "policyTarget") ?? "System";
                string sub = Json.GetString(body, "subcategory") ?? "";
                string val = Json.GetString(body, "settingValue") ?? "0";
                string inclusion = val == "1" ? "Success" : val == "2" ? "Failure" : val == "3" ? "Success and Failure" : "No Auditing";
                csv.Add(new string[] { "", target, sub, guid, inclusion, "", val });
                result = new Dictionary<string, object>(StringComparer.Ordinal);
                result["id"] = guid.Trim('{', '}'); result["subcategoryGuid"] = guid; result["subcategory"] = sub;
                result["policyTarget"] = target; result["settingValue"] = val;
            }
            StringBuilder sb = new StringBuilder();
            sb.Append(AuditHeader).Append("\r\n");
            foreach (string[] c in csv) { sb.Append(string.Join(",", c)).Append("\r\n"); }
            string path = AuditCsvPath(gpoId);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, sb.ToString(), new UTF8Encoding(false));
            GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.AdvancedAudit) });
            return result;
        }

        // ===============================================================
        // Registry.pol backed nodes (firewall, QoS, NRPT, SRP, AppLocker,
        // network list) written through Set-GPRegistryValue.
        // ===============================================================

        private const string FwBase = @"HKLM\Software\Policies\Microsoft\WindowsFirewall";
        private const string FwRules = FwBase + @"\FirewallRules";

        private object RegGet(RequestContext ctx, string gpoId, string key)
        {
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = gpoId; p["Key"] = key;
            try { return Ps(ctx).Invoke("Get-GPRegistryValue", p); }
            catch (Exception) { return new List<object>(); }
        }

        private void RegSet(RequestContext ctx, string gpoId, string key, string valueName, string type, object value)
        {
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = gpoId; p["Key"] = key;
            if (!string.IsNullOrEmpty(valueName)) { p["ValueName"] = valueName; }
            p["Type"] = type; p["Value"] = value;
            Ps(ctx).Invoke("Set-GPRegistryValue", p);
        }

        private void RegRemove(RequestContext ctx, string gpoId, string key, string valueName)
        {
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = gpoId; p["Key"] = key;
            if (!string.IsNullOrEmpty(valueName)) { p["ValueName"] = valueName; }
            try { Ps(ctx).Invoke("Remove-GPRegistryValue", p); } catch (Exception) { }
        }

        private List<Dictionary<string, object>> RegValues(object raw)
        {
            List<Dictionary<string, object>> rows = new List<Dictionary<string, object>>();
            List<Dictionary<string, object>> output = raw as List<Dictionary<string, object>>;
            if (output != null) { rows = output; }
            return rows;
        }

        // Firewall rules: one REG_SZ value per rule under FirewallRules, value
        // name = a GUID, data = the MS-GPFAS rule string.
        private List<object> ReadFirewallRules(RequestContext ctx, string gpoId, GpoNode n)
        {
            bool inbound = n.Id.EndsWith("/inbound", StringComparison.Ordinal);
            List<object> items = new List<object>();
            foreach (Dictionary<string, object> row in RegValues(RegGet(ctx, gpoId, FwRules)))
            {
                string name = Convert.ToString(Get(row, "ValueName"), CultureInfo.InvariantCulture);
                string data = Convert.ToString(Get(row, "Value"), CultureInfo.InvariantCulture);
                if (string.IsNullOrEmpty(data)) { continue; }
                FirewallRule fr = FirewallRule.Parse(name, data);
                bool isInbound = string.Equals(fr.Direction, "In", StringComparison.OrdinalIgnoreCase);
                if (isInbound != inbound) { continue; }
                items.Add(fr.ToRow());
            }
            return items;
        }

        private object MutateFirewallRules(RequestContext ctx, string gpoId, GpoNode n, string op, string itemId, Dictionary<string, object> body)
        {
            if (op == "delete")
            {
                RegRemove(ctx, gpoId, FwRules, itemId);
                GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.FirewallTool) });
                return null;
            }
            FirewallRule fr = FirewallRule.FromBody(body);
            if (string.IsNullOrEmpty(fr.Direction))
            {
                fr.Direction = n.Id.EndsWith("/outbound", StringComparison.Ordinal) ? "Out" : "In";
            }
            string name = op == "update" ? itemId : "{" + Guid.NewGuid().ToString().ToUpperInvariant() + "}";
            RegSet(ctx, gpoId, FwRules, name, "String", fr.ToRuleString());
            GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.FirewallTool) });
            Dictionary<string, object> row = fr.ToRow();
            row["id"] = name;
            return row;
        }

        private Dictionary<string, object> ReadFirewallProfiles(RequestContext ctx, string gpoId)
        {
            Dictionary<string, object> values = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (string profile in new[] { "Domain", "Private", "Public" })
            {
                string key = FwBase + @"\" + profile + "Profile";
                foreach (Dictionary<string, object> row in RegValues(RegGet(ctx, gpoId, key)))
                {
                    string vn = Convert.ToString(Get(row, "ValueName"), CultureInfo.InvariantCulture);
                    object v = Get(row, "Value");
                    if (string.Equals(vn, "EnableFirewall", StringComparison.OrdinalIgnoreCase)) { values[profile + "State"] = Convert.ToString(v); }
                    else if (string.Equals(vn, "DefaultInboundAction", StringComparison.OrdinalIgnoreCase)) { values[profile + "Inbound"] = Convert.ToString(v); }
                    else if (string.Equals(vn, "DefaultOutboundAction", StringComparison.OrdinalIgnoreCase)) { values[profile + "Outbound"] = Convert.ToString(v); }
                }
            }
            return values;
        }

        private void WriteFirewallProfiles(RequestContext ctx, string gpoId, Dictionary<string, object> values)
        {
            foreach (string profile in new[] { "Domain", "Private", "Public" })
            {
                string key = FwBase + @"\" + profile + "Profile";
                WriteFwVal(ctx, gpoId, key, "EnableFirewall", values, profile + "State");
                WriteFwVal(ctx, gpoId, key, "DefaultInboundAction", values, profile + "Inbound");
                WriteFwVal(ctx, gpoId, key, "DefaultOutboundAction", values, profile + "Outbound");
            }
            GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.FirewallTool) });
        }

        private void WriteFwVal(RequestContext ctx, string gpoId, string key, string valueName, Dictionary<string, object> values, string field)
        {
            object v;
            if (!values.TryGetValue(field, out v) || v == null) { return; }
            long num; Json.TryToLong(v, out num);
            RegSet(ctx, gpoId, key, valueName, "DWord", (int)num);
        }

        private List<object> ReadFirewallCsr(RequestContext ctx, string gpoId)
        {
            List<object> items = new List<object>();
            foreach (Dictionary<string, object> row in RegValues(RegGet(ctx, gpoId, FwBase + @"\ConSecRules")))
            {
                Dictionary<string, object> r = new Dictionary<string, object>(StringComparer.Ordinal);
                r["id"] = Convert.ToString(Get(row, "ValueName"), CultureInfo.InvariantCulture);
                r["name"] = r["id"];
                r["rule"] = Convert.ToString(Get(row, "Value"), CultureInfo.InvariantCulture);
                r["active"] = true;
                items.Add(r);
            }
            return items;
        }

        private object MutateFirewallCsr(RequestContext ctx, string gpoId, string op, string itemId, Dictionary<string, object> body)
        {
            string key = FwBase + @"\ConSecRules";
            if (op == "delete")
            {
                RegRemove(ctx, gpoId, key, itemId);
                GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.FirewallTool) });
                return null;
            }
            string name = op == "update" ? itemId : "{" + Guid.NewGuid().ToString().ToUpperInvariant() + "}";
            string rule = Json.RequireString(body, "rule", 8000);
            RegSet(ctx, gpoId, key, name, "String", rule);
            GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.FirewallTool) });
            Dictionary<string, object> r = new Dictionary<string, object>(StringComparer.Ordinal);
            r["id"] = name; r["name"] = name; r["rule"] = rule; r["active"] = true;
            return r;
        }

        // NRPT rules under DnsPolicyConfig\{rule}.
        private const string NrptBase = @"HKLM\Software\Policies\Microsoft\Windows NT\DNSClient\DnsPolicyConfig";

        private List<object> ReadNrpt(RequestContext ctx, string gpoId)
        {
            List<object> items = new List<object>();
            Dictionary<string, Dictionary<string, object>> byRule = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
            foreach (Dictionary<string, object> row in RegValues(RegGet(ctx, gpoId, NrptBase)))
            {
                string fullKey = Convert.ToString(Get(row, "FullKeyPath") ?? Get(row, "Key"), CultureInfo.InvariantCulture);
                string vn = Convert.ToString(Get(row, "ValueName"), CultureInfo.InvariantCulture);
                object v = Get(row, "Value");
                string rule = LastSegment(fullKey);
                if (string.IsNullOrEmpty(rule)) { continue; }
                Dictionary<string, object> r;
                if (!byRule.TryGetValue(rule, out r))
                {
                    r = new Dictionary<string, object>(StringComparer.Ordinal);
                    r["id"] = rule; r["ruleName"] = rule;
                    byRule[rule] = r;
                }
                if (string.Equals(vn, "Name", StringComparison.OrdinalIgnoreCase)) { r["name"] = ToCsv(v); }
                else if (string.Equals(vn, "GenericDNSServers", StringComparison.OrdinalIgnoreCase)) { r["genericDnsServers"] = Convert.ToString(v); }
                else if (string.Equals(vn, "ConfigOptions", StringComparison.OrdinalIgnoreCase)) { r["configOptions"] = Convert.ToString(v); }
            }
            foreach (Dictionary<string, object> r in byRule.Values) { items.Add(r); }
            return items;
        }

        private object MutateNrpt(RequestContext ctx, string gpoId, string op, string itemId, Dictionary<string, object> body)
        {
            string rule = op == "create" ? (Json.GetString(body, "ruleName") ?? "{" + Guid.NewGuid().ToString().ToUpperInvariant() + "}") : itemId;
            string key = NrptBase + "\\" + rule;
            if (op == "delete")
            {
                RegRemove(ctx, gpoId, key, null);
                GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.Registry) });
                return null;
            }
            string name = Json.GetString(body, "name");
            if (name != null) { RegSet(ctx, gpoId, key, "Name", "MultiString", name.Split(',')); }
            string dns = Json.GetString(body, "genericDnsServers");
            if (dns != null) { RegSet(ctx, gpoId, key, "GenericDNSServers", "String", dns); }
            string config = Json.GetString(body, "configOptions") ?? "8";
            long cfg; Json.TryToLong(config, out cfg);
            RegSet(ctx, gpoId, key, "ConfigOptions", "DWord", (int)cfg);
            RegSet(ctx, gpoId, key, "Version", "DWord", 2);
            GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.Registry) });
            Dictionary<string, object> r = new Dictionary<string, object>(StringComparer.Ordinal);
            r["id"] = rule; r["ruleName"] = rule; r["name"] = name; r["genericDnsServers"] = dns; r["configOptions"] = config;
            return r;
        }

        // Policy-based QoS under the QoS key.
        private string QosBase(GpoNode n)
        {
            return (n.Class == "Machine" ? "HKLM" : "HKCU")
                + @"\Software\Policies\Microsoft\Windows\QoS";
        }

        private List<object> ReadQos(RequestContext ctx, string gpoId, GpoNode n)
        {
            List<object> items = new List<object>();
            Dictionary<string, Dictionary<string, object>> byName = new Dictionary<string, Dictionary<string, object>>(StringComparer.OrdinalIgnoreCase);
            foreach (Dictionary<string, object> row in RegValues(RegGet(ctx, gpoId, QosBase(n))))
            {
                string fullKey = Convert.ToString(Get(row, "FullKeyPath") ?? Get(row, "Key"), CultureInfo.InvariantCulture);
                string policy = LastSegment(fullKey);
                string vn = Convert.ToString(Get(row, "ValueName"), CultureInfo.InvariantCulture);
                object v = Get(row, "Value");
                if (string.IsNullOrEmpty(policy)) { continue; }
                Dictionary<string, object> r;
                if (!byName.TryGetValue(policy, out r))
                {
                    r = new Dictionary<string, object>(StringComparer.Ordinal);
                    r["id"] = policy; r["name"] = policy;
                    byName[policy] = r;
                }
                MapQos(r, vn, v);
            }
            foreach (Dictionary<string, object> r in byName.Values) { items.Add(r); }
            return items;
        }

        private void MapQos(Dictionary<string, object> r, string vn, object v)
        {
            if (string.Equals(vn, "Application Name", StringComparison.OrdinalIgnoreCase)) { r["appName"] = Convert.ToString(v); }
            else if (string.Equals(vn, "DSCP Value", StringComparison.OrdinalIgnoreCase)) { r["dscpValue"] = Convert.ToString(v); }
            else if (string.Equals(vn, "Throttle Rate", StringComparison.OrdinalIgnoreCase)) { r["throttleRate"] = Convert.ToString(v); }
            else if (string.Equals(vn, "Protocol", StringComparison.OrdinalIgnoreCase)) { r["protocol"] = Convert.ToString(v); }
            else if (string.Equals(vn, "Local Port", StringComparison.OrdinalIgnoreCase)) { r["localPort"] = Convert.ToString(v); }
            else if (string.Equals(vn, "Remote Port", StringComparison.OrdinalIgnoreCase)) { r["remotePort"] = Convert.ToString(v); }
        }

        private object MutateQos(RequestContext ctx, string gpoId, GpoNode n, string op, string itemId, Dictionary<string, object> body)
        {
            string policy = op == "create" ? Json.RequireString(body, "name", 256) : itemId;
            string key = QosBase(n) + "\\" + policy;
            bool machine = n.Class == "Machine";
            if (op == "delete")
            {
                RegRemove(ctx, gpoId, key, null);
                GpoWrite.Touch(_config, gpoId, machine, !machine, new[] { GpoWrite.Cse(n.Class, GpoCse.Registry) });
                return null;
            }
            RegSet(ctx, gpoId, key, "Version", "String", "1.0");
            SetQosVal(ctx, gpoId, key, "Application Name", body, "appName");
            SetQosVal(ctx, gpoId, key, "Protocol", body, "protocol");
            SetQosVal(ctx, gpoId, key, "Local Port", body, "localPort");
            SetQosVal(ctx, gpoId, key, "Remote Port", body, "remotePort");
            SetQosVal(ctx, gpoId, key, "Throttle Rate", body, "throttleRate");
            long dscp; Json.TryToLong(Json.GetString(body, "dscpValue") ?? "-1", out dscp);
            RegSet(ctx, gpoId, key, "DSCP Value", "String", dscp.ToString(CultureInfo.InvariantCulture));
            GpoWrite.Touch(_config, gpoId, machine, !machine, new[] { GpoWrite.Cse(n.Class, GpoCse.Registry) });
            Dictionary<string, object> r = new Dictionary<string, object>(StringComparer.Ordinal);
            r["id"] = policy; r["name"] = policy;
            MapBody(r, body, "appName", "protocol", "localPort", "remotePort", "throttleRate", "dscpValue");
            return r;
        }

        private void SetQosVal(RequestContext ctx, string gpoId, string key, string valueName, Dictionary<string, object> body, string field)
        {
            string v = Json.GetString(body, field);
            if (v != null) { RegSet(ctx, gpoId, key, valueName, "String", v); }
        }

        // Software Restriction Policies under Safer.
        private string SaferBase(GpoNode n)
        {
            return (n.Class == "Machine" ? "HKLM" : "HKCU")
                + @"\Software\Policies\Microsoft\Windows\Safer\CodeIdentifiers";
        }

        private List<object> ReadSrp(RequestContext ctx, string gpoId, GpoNode n)
        {
            List<object> items = new List<object>();
            foreach (Dictionary<string, object> row in RegValues(RegGet(ctx, gpoId, SaferBase(n) + @"\0\Paths")))
            {
                string fullKey = Convert.ToString(Get(row, "FullKeyPath") ?? Get(row, "Key"), CultureInfo.InvariantCulture);
                string vn = Convert.ToString(Get(row, "ValueName"), CultureInfo.InvariantCulture);
                if (!string.Equals(vn, "ItemData", StringComparison.OrdinalIgnoreCase)) { continue; }
                Dictionary<string, object> r = new Dictionary<string, object>(StringComparer.Ordinal);
                r["id"] = LastSegment(fullKey); r["ruleType"] = "path";
                r["value"] = Convert.ToString(Get(row, "Value"));
                items.Add(r);
            }
            return items;
        }

        private object MutateSrp(RequestContext ctx, string gpoId, GpoNode n, string op, string itemId, Dictionary<string, object> body)
        {
            bool machine = n.Class == "Machine";
            string level = Json.GetString(body, "securityLevel") ?? "0";
            string id = op == "create" ? "{" + Guid.NewGuid().ToString().ToUpperInvariant() + "}" : itemId;
            string key = SaferBase(n) + @"\" + level + @"\Paths\" + id;
            if (op == "delete")
            {
                RegRemove(ctx, gpoId, SaferBase(n) + @"\0\Paths\" + id, null);
                RegRemove(ctx, gpoId, SaferBase(n) + @"\262144\Paths\" + id, null);
                RegRemove(ctx, gpoId, SaferBase(n) + @"\131072\Paths\" + id, null);
                GpoWrite.Touch(_config, gpoId, machine, !machine, new[] { GpoWrite.Cse(n.Class, GpoCse.Registry) });
                return null;
            }
            string value = Json.RequireString(body, "value", 1024);
            RegSet(ctx, gpoId, key, "ItemData", "ExpandString", value);
            RegSet(ctx, gpoId, key, "SaferFlags", "DWord", 0);
            GpoWrite.Touch(_config, gpoId, machine, !machine, new[] { GpoWrite.Cse(n.Class, GpoCse.Registry) });
            Dictionary<string, object> r = new Dictionary<string, object>(StringComparer.Ordinal);
            r["id"] = id; r["ruleType"] = Json.GetString(body, "ruleType") ?? "path";
            r["value"] = value; r["securityLevel"] = level;
            return r;
        }

        // AppLocker under SrpV2\<collection>.
        private const string SrpV2 = @"HKLM\Software\Policies\Microsoft\Windows\SrpV2";

        private List<object> ReadAppLocker(RequestContext ctx, string gpoId, GpoNode n)
        {
            List<object> items = new List<object>();
            foreach (string coll in new[] { "Exe", "Msi", "Script", "Appx", "Dll" })
            {
                string key = SrpV2 + "\\" + coll;
                foreach (Dictionary<string, object> row in RegValues(RegGet(ctx, gpoId, key)))
                {
                    string fullKey = Convert.ToString(Get(row, "FullKeyPath") ?? Get(row, "Key"), CultureInfo.InvariantCulture);
                    string vn = Convert.ToString(Get(row, "ValueName"), CultureInfo.InvariantCulture);
                    if (!string.Equals(vn, "Value", StringComparison.OrdinalIgnoreCase)) { continue; }
                    string seg = LastSegment(fullKey);
                    if (string.Equals(seg, coll, StringComparison.OrdinalIgnoreCase)) { continue; } // enforcement value
                    Dictionary<string, object> r = new Dictionary<string, object>(StringComparer.Ordinal);
                    r["id"] = seg; r["collection"] = coll;
                    r["ruleXml"] = Convert.ToString(Get(row, "Value"));
                    items.Add(r);
                }
            }
            return items;
        }

        private object MutateAppLocker(RequestContext ctx, string gpoId, GpoNode n, string op, string itemId, Dictionary<string, object> body)
        {
            string coll = Json.GetString(body, "collection") ?? "Exe";
            string collKey = SrpV2 + "\\" + coll;
            if (op == "delete")
            {
                RegRemove(ctx, gpoId, collKey + "\\" + itemId, null);
                GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.Registry) });
                return null;
            }
            string enforce = Json.GetString(body, "enforcementMode");
            if (enforce != null)
            {
                int mode = enforce == "Enabled" ? 1 : enforce == "AuditOnly" ? 0 : -1;
                if (mode >= 0) { RegSet(ctx, gpoId, collKey, "EnforcementMode", "DWord", mode); }
            }
            string ruleXml = Json.GetString(body, "ruleXml");
            string id = op == "create" ? "{" + Guid.NewGuid().ToString().ToUpperInvariant() + "}" : itemId;
            if (ruleXml != null) { RegSet(ctx, gpoId, collKey + "\\" + id, "Value", "String", ruleXml); }
            GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.Registry) });
            Dictionary<string, object> r = new Dictionary<string, object>(StringComparer.Ordinal);
            r["id"] = id; r["collection"] = coll; r["enforcementMode"] = enforce; r["ruleXml"] = ruleXml;
            return r;
        }

        // Network List Manager under NetworkList.
        private string NetListBase(GpoNode n)
        {
            return (n.Class == "Machine" ? "HKLM" : "HKCU")
                + @"\Software\Policies\Microsoft\Windows\NetworkList";
        }

        private List<object> ReadNetList(RequestContext ctx, string gpoId, GpoNode n)
        {
            List<object> items = new List<object>();
            foreach (Dictionary<string, object> row in RegValues(RegGet(ctx, gpoId, NetListBase(n))))
            {
                string fullKey = Convert.ToString(Get(row, "FullKeyPath") ?? Get(row, "Key"), CultureInfo.InvariantCulture);
                string vn = Convert.ToString(Get(row, "ValueName"), CultureInfo.InvariantCulture);
                if (!string.Equals(vn, "Category", StringComparison.OrdinalIgnoreCase)) { continue; }
                Dictionary<string, object> r = new Dictionary<string, object>(StringComparer.Ordinal);
                r["id"] = LastSegment(fullKey); r["network"] = LastSegment(fullKey);
                r["category"] = Convert.ToString(Get(row, "Value"));
                items.Add(r);
            }
            return items;
        }

        private object MutateNetList(RequestContext ctx, string gpoId, GpoNode n, string op, string itemId, Dictionary<string, object> body)
        {
            bool machine = n.Class == "Machine";
            string network = op == "create" ? Json.RequireString(body, "network", 256) : itemId;
            string key = NetListBase(n) + "\\" + network;
            if (op == "delete")
            {
                RegRemove(ctx, gpoId, key, null);
                GpoWrite.Touch(_config, gpoId, machine, !machine, new[] { GpoWrite.Cse(n.Class, GpoCse.Registry) });
                return null;
            }
            long cat; Json.TryToLong(Json.GetString(body, "category") ?? "0", out cat);
            RegSet(ctx, gpoId, key, "Category", "DWord", (int)cat);
            string name = Json.GetString(body, "name");
            if (name != null) { RegSet(ctx, gpoId, key, "Name", "String", name); }
            GpoWrite.Touch(_config, gpoId, machine, !machine, new[] { GpoWrite.Cse(n.Class, GpoCse.Registry) });
            Dictionary<string, object> r = new Dictionary<string, object>(StringComparer.Ordinal);
            r["id"] = network; r["network"] = network; r["category"] = cat.ToString(CultureInfo.InvariantCulture); r["name"] = name;
            return r;
        }

        // ===============================================================
        // Scripts (scripts.ini / psscripts.ini)
        // ===============================================================

        private string ScriptsIniPath(string gpoId, GpoNode n, bool ps)
        {
            string side = n.Class == "Machine" ? "Machine" : "User";
            string file = ps ? "psscripts.ini" : "scripts.ini";
            return Path.Combine(GpoWrite.SysvolPath(_config, gpoId), side, "Scripts", file);
        }

        private string ScriptsFolder(string gpoId, GpoNode n)
        {
            string side = n.Class == "Machine" ? "Machine" : "User";
            string leaf = n.Id.Substring(n.Id.LastIndexOf('/') + 1);
            string cap = char.ToUpperInvariant(leaf[0]) + leaf.Substring(1);
            return Path.Combine(GpoWrite.SysvolPath(_config, gpoId), side, "Scripts", cap);
        }

        private string ScriptsSection(GpoNode n)
        {
            string leaf = n.Id.Substring(n.Id.LastIndexOf('/') + 1);
            return char.ToUpperInvariant(leaf[0]) + leaf.Substring(1); // Startup/Shutdown/Logon/Logoff
        }

        private List<object> ReadScripts(string gpoId, GpoNode n)
        {
            List<object> items = new List<object>();
            string section = ScriptsSection(n);
            foreach (bool ps in new[] { false, true })
            {
                string path = ScriptsIniPath(gpoId, n, ps);
                if (!File.Exists(path)) { continue; }
                Dictionary<string, Dictionary<string, string>> ini = ParseIni(path);
                Dictionary<string, string> sect;
                if (!ini.TryGetValue(section, out sect)) { continue; }
                int i = 0;
                while (sect.ContainsKey(i + "CmdLine"))
                {
                    Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                    row["id"] = (ps ? "ps:" : "cmd:") + i;
                    row["script"] = sect[i + "CmdLine"];
                    row["parameters"] = sect.ContainsKey(i + "Parameters") ? sect[i + "Parameters"] : "";
                    row["powershell"] = ps;
                    items.Add(row);
                    i++;
                }
            }
            return items;
        }

        private object MutateScripts(string gpoId, GpoNode n, string op, string itemId, Dictionary<string, object> body)
        {
            bool ps = op == "delete" ? (itemId != null && itemId.StartsWith("ps:")) : Json.GetBool(body, "powershell", false);
            string path = ScriptsIniPath(gpoId, n, ps);
            string section = ScriptsSection(n);
            Dictionary<string, Dictionary<string, string>> ini = File.Exists(path) ? ParseIni(path) : new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            Dictionary<string, string> sect;
            if (!ini.TryGetValue(section, out sect)) { sect = new Dictionary<string, string>(StringComparer.Ordinal); ini[section] = sect; }

            // Collect existing entries into an ordered list.
            List<string[]> entries = new List<string[]>();
            int idx = 0;
            while (sect.ContainsKey(idx + "CmdLine"))
            {
                entries.Add(new[] { sect[idx + "CmdLine"], sect.ContainsKey(idx + "Parameters") ? sect[idx + "Parameters"] : "" });
                idx++;
            }
            int target = -1;
            if (itemId != null && itemId.Contains(":")) { int.TryParse(itemId.Substring(itemId.IndexOf(':') + 1), out target); }

            Dictionary<string, object> result = null;
            if (op == "delete")
            {
                if (target >= 0 && target < entries.Count) { entries.RemoveAt(target); }
            }
            else
            {
                string script = Json.RequireString(body, "script", 1024);
                string parms = Json.GetString(body, "parameters") ?? "";
                string content = Json.GetString(body, "content");
                if (content != null)
                {
                    string folder = ScriptsFolder(gpoId, n);
                    Directory.CreateDirectory(folder);
                    string file = Path.Combine(folder, Path.GetFileName(script));
                    File.WriteAllText(file, content, new UTF8Encoding(ps));
                }
                if (op == "update" && target >= 0 && target < entries.Count) { entries[target] = new[] { script, parms }; }
                else { entries.Add(new[] { script, parms }); target = entries.Count - 1; }
                result = new Dictionary<string, object>(StringComparer.Ordinal);
                result["id"] = (ps ? "ps:" : "cmd:") + target; result["script"] = script;
                result["parameters"] = parms; result["powershell"] = ps;
            }

            // Rewrite the section with contiguous indices.
            sect.Clear();
            for (int i = 0; i < entries.Count; i++)
            {
                sect[i + "CmdLine"] = entries[i][0];
                sect[i + "Parameters"] = entries[i][1];
            }
            WriteIni(path, ini);
            GpoWrite.Touch(_config, gpoId, n.Class == "Machine", n.Class == "User",
                new[] { GpoWrite.Cse(n.Class, GpoCse.Scripts) });
            return result;
        }

        // ===============================================================
        // Folder Redirection (fdeploy1.ini, user only)
        // ===============================================================

        private string FdeployPath(string gpoId)
        {
            return Path.Combine(GpoWrite.SysvolPath(_config, gpoId),
                @"User\Documents & Settings\fdeploy1.ini");
        }

        private List<object> ReadFolderRedirection(string gpoId)
        {
            List<object> items = new List<object>();
            string path = FdeployPath(gpoId);
            if (!File.Exists(path)) { return items; }
            Dictionary<string, Dictionary<string, string>> ini = ParseIni(path, Encoding.Unicode);
            Dictionary<string, string> fr;
            if (!ini.TryGetValue("Folder_Redirection", out fr)) { return items; }
            foreach (KeyValuePair<string, string> kv in fr)
            {
                string folder = kv.Key;
                foreach (string sidPart in kv.Value.Split(';'))
                {
                    string sid = sidPart.Trim();
                    if (sid.Length == 0) { continue; }
                    string perKey = folder + "_" + sid;
                    Dictionary<string, string> per;
                    Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                    row["id"] = perKey; row["folder"] = folder; row["securityGroup"] = sid;
                    if (ini.TryGetValue(perKey, out per))
                    {
                        row["flags"] = per.ContainsKey("Flags") ? per["Flags"] : "";
                        row["fullPath"] = per.ContainsKey("FullPath") ? per["FullPath"] : "";
                    }
                    items.Add(row);
                }
            }
            return items;
        }

        private object MutateFolderRedirection(string gpoId, string op, string itemId, Dictionary<string, object> body)
        {
            string path = FdeployPath(gpoId);
            Dictionary<string, Dictionary<string, string>> ini = File.Exists(path) ? ParseIni(path, Encoding.Unicode) : new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            if (!ini.ContainsKey("version")) { ini["version"] = new Dictionary<string, string>(StringComparer.Ordinal); ini["version"]["version"] = "100"; }
            Dictionary<string, string> fr;
            if (!ini.TryGetValue("Folder_Redirection", out fr)) { fr = new Dictionary<string, string>(StringComparer.Ordinal); ini["Folder_Redirection"] = fr; }

            if (op == "delete")
            {
                ini.Remove(itemId);
                string folder = itemId.Substring(0, itemId.IndexOf('_'));
                string sid = itemId.Substring(itemId.IndexOf('_') + 1);
                if (fr.ContainsKey(folder))
                {
                    List<string> sids = new List<string>(fr[folder].Split(';'));
                    sids.RemoveAll(delegate(string x) { return x.Trim() == sid || x.Trim().Length == 0; });
                    if (sids.Count == 0) { fr.Remove(folder); } else { fr[folder] = string.Join("; ", sids.ToArray()); }
                }
                WriteIni(path, ini, Encoding.Unicode);
                GpoWrite.Touch(_config, gpoId, false, true, new[] { GpoWrite.Cse("User", GpoCse.FolderRedirection) });
                return null;
            }

            string f = Json.RequireString(body, "folder", 64);
            string group = Json.GetString(body, "securityGroup") ?? "S-1-1-0";
            string flags = Json.GetString(body, "flags") ?? "1001";
            string fullPath = Json.GetString(body, "fullPath");
            string key = f + "_" + group;
            // Register the GUID-Groups mapping.
            if (fr.ContainsKey(f))
            {
                if (fr[f].IndexOf(group, StringComparison.OrdinalIgnoreCase) < 0) { fr[f] = fr[f].TrimEnd(';', ' ') + "; " + group; }
            }
            else { fr[f] = group + ";"; }
            Dictionary<string, string> per;
            if (!ini.TryGetValue(key, out per)) { per = new Dictionary<string, string>(StringComparer.Ordinal); ini[key] = per; }
            per["Flags"] = flags;
            if (fullPath != null) { per["FullPath"] = fullPath; }
            WriteIni(path, ini, Encoding.Unicode);
            GpoWrite.Touch(_config, gpoId, false, true, new[] { GpoWrite.Cse("User", GpoCse.FolderRedirection) });
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = key; row["folder"] = f; row["securityGroup"] = group; row["flags"] = flags; row["fullPath"] = fullPath;
            return row;
        }

        // ===============================================================
        // GPP preference items
        // ===============================================================

        private string PrefPath(string gpoId, GpoNode n)
        {
            string area = n.ItemSchema.Substring("pref-".Length);
            GppXml.Area def = GppXml.Get(area);
            string side = n.Class == "Machine" ? "Machine" : "User";
            return Path.Combine(GpoWrite.SysvolPath(_config, gpoId), side, "Preferences", def.Outer, def.Outer + ".xml");
        }

        private List<object> ReadPreferenceItems(string gpoId, GpoNode n)
        {
            List<object> items = new List<object>();
            foreach (Dictionary<string, object> item in GppXml.ReadItems(PrefPath(gpoId, n)))
            {
                items.Add(item);
            }
            return items;
        }

        private object MutatePreferenceItems(string gpoId, GpoNode n, string op, string itemId, Dictionary<string, object> body)
        {
            string area = n.ItemSchema.Substring("pref-".Length);
            GppXml.Area def = GppXml.Get(area);
            string path = PrefPath(gpoId, n);
            List<Dictionary<string, object>> items = GppXml.ReadItems(path);

            Dictionary<string, object> result = null;
            if (op == "delete")
            {
                items.RemoveAll(delegate(Dictionary<string, object> it)
                {
                    return string.Equals(Convert.ToString(it["id"]), itemId, StringComparison.OrdinalIgnoreCase);
                });
            }
            else
            {
                Dictionary<string, object> item = new Dictionary<string, object>(StringComparer.Ordinal);
                foreach (KeyValuePair<string, object> kv in body) { item[kv.Key] = kv.Value; }
                if (op == "update")
                {
                    item["id"] = itemId;
                    items.RemoveAll(delegate(Dictionary<string, object> it)
                    {
                        return string.Equals(Convert.ToString(it["id"]), itemId, StringComparison.OrdinalIgnoreCase);
                    });
                }
                items.Add(item);
                result = item;
            }
            GppXml.WriteItems(path, def, items);
            GpoWrite.Touch(_config, gpoId, n.Class == "Machine", n.Class == "User",
                new[] { GpoWrite.Cse(n.Class, GpoCse.Preference(area)) });
            return result;
        }

        // ===============================================================
        // AD-object nodes: wireless/wired, deployed printers, software install
        // ===============================================================

        private string ScopedGpoDn(string gpoId, string side)
        {
            return "CN=" + side + ",CN={" + GpoService.NormalizeGuid(gpoId) + "},CN=Policies,CN=System," + _config.DomainDn;
        }

        private List<object> ReadNetworkAdPolicy(string gpoId, string kind)
        {
            // kind: IEEE80211 (wireless XML) or IEEE8023 (wired).
            List<object> items = new List<object>();
            string container = "CN=" + kind + ",CN=Windows,CN=Microsoft," + ScopedGpoDn(gpoId, "Machine");
            string objClass = kind == "IEEE80211" ? "ms-net-ieee-80211-GroupPolicy" : "ms-net-ieee-8023-GroupPolicy";
            string dataAttr = kind == "IEEE80211" ? "ms-net-ieee-80211-GP-PolicyData" : "ms-net-ieee-8023-GP-PolicyData";
            string guidAttr = kind == "IEEE80211" ? "ms-net-ieee-80211-GP-PolicyGUID" : "ms-net-ieee-8023-GP-PolicyGUID";
            try
            {
                using (DirectoryEntry root = DirectoryService.Bind(container))
                using (DirectorySearcher searcher = new DirectorySearcher(root))
                {
                    searcher.Filter = "(objectClass=" + objClass + ")";
                    searcher.SearchScope = SearchScope.OneLevel;
                    searcher.PropertiesToLoad.Add("cn");
                    searcher.PropertiesToLoad.Add("description");
                    searcher.PropertiesToLoad.Add(dataAttr);
                    searcher.PropertiesToLoad.Add(guidAttr);
                    foreach (SearchResult sr in searcher.FindAll())
                    {
                        Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                        row["id"] = PropStr(sr, guidAttr);
                        row["name"] = PropStr(sr, "cn");
                        row["description"] = PropStr(sr, "description");
                        row["xml"] = PropStr(sr, dataAttr);
                        items.Add(row);
                    }
                }
            }
            catch (Exception) { }
            return items;
        }

        private object MutateNetworkAdPolicy(string gpoId, string kind, string op, string itemId, Dictionary<string, object> body)
        {
            string objClass = kind == "IEEE80211" ? "ms-net-ieee-80211-GroupPolicy" : "ms-net-ieee-8023-GroupPolicy";
            string dataAttr = kind == "IEEE80211" ? "ms-net-ieee-80211-GP-PolicyData" : "ms-net-ieee-8023-GP-PolicyData";
            string guidAttr = kind == "IEEE80211" ? "ms-net-ieee-80211-GP-PolicyGUID" : "ms-net-ieee-8023-GP-PolicyGUID";
            GpoCse.Pair cse = kind == "IEEE80211" ? GpoCse.WirelessXml : GpoCse.WiredXml;

            EnsureNetworkContainers(gpoId, kind);
            string container = "CN=" + kind + ",CN=Windows,CN=Microsoft," + ScopedGpoDn(gpoId, "Machine");

            if (op == "delete")
            {
                string dn = "CN=" + itemId + "," + container;
                try { using (DirectoryEntry e = DirectoryService.Bind(dn)) { e.DeleteTree(); e.CommitChanges(); } }
                catch (Exception) { }
                GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", cse) });
                return null;
            }

            string guid = op == "update" ? itemId : "{" + Guid.NewGuid().ToString().ToUpperInvariant() + "}";
            string name = Json.GetString(body, "name") ?? guid;
            string xml = Json.RequireString(body, "xml", 200000);
            string desc = Json.GetString(body, "description") ?? "";
            string dn2 = "CN=" + guid + "," + container;
            using (DirectoryEntry parent = DirectoryService.Bind(container))
            {
                DirectoryEntry child;
                try { child = DirectoryService.Bind(dn2); }
                catch (Exception) { child = parent.Children.Add("CN=" + guid, objClass); }
                child.Properties[dataAttr].Value = xml;
                child.Properties[guidAttr].Value = guid;
                child.Properties["description"].Value = desc;
                child.CommitChanges();
                child.Dispose();
            }
            GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", cse) });
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = guid; row["name"] = name; row["description"] = desc; row["xml"] = xml;
            return row;
        }

        private void EnsureNetworkContainers(string gpoId, string kind)
        {
            string machine = ScopedGpoDn(gpoId, "Machine");
            EnsureContainer("CN=Microsoft," + machine);
            EnsureContainer("CN=Windows,CN=Microsoft," + machine);
            EnsureContainer("CN=" + kind + ",CN=Windows,CN=Microsoft," + machine);
        }

        private void EnsureContainer(string dn)
        {
            try { using (DirectoryService.Bind(dn)) { return; } }
            catch (Exception) { }
            int comma = dn.IndexOf(',');
            string rdn = dn.Substring(0, comma);
            string parent = dn.Substring(comma + 1);
            using (DirectoryEntry p = DirectoryService.Bind(parent))
            {
                DirectoryEntry child = p.Children.Add(rdn, "container");
                child.CommitChanges();
                child.Dispose();
            }
        }

        private List<object> ReadDeployedPrinters(string gpoId, GpoNode n)
        {
            List<object> items = new List<object>();
            string side = n.Class == "Machine" ? "Machine" : "User";
            string container = "CN=PushedPrinterConnections," + ScopedGpoDn(gpoId, side);
            try
            {
                using (DirectoryEntry root = DirectoryService.Bind(container))
                using (DirectorySearcher searcher = new DirectorySearcher(root))
                {
                    searcher.Filter = "(objectClass=msPrint-ConnectionPolicy)";
                    searcher.SearchScope = SearchScope.OneLevel;
                    searcher.PropertiesToLoad.Add("uNCName");
                    searcher.PropertiesToLoad.Add("printerName");
                    searcher.PropertiesToLoad.Add("serverName");
                    searcher.PropertiesToLoad.Add("cn");
                    foreach (SearchResult sr in searcher.FindAll())
                    {
                        Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                        row["id"] = PropStr(sr, "cn");
                        row["uncName"] = PropStr(sr, "uNCName");
                        row["printerName"] = PropStr(sr, "printerName");
                        row["serverName"] = PropStr(sr, "serverName");
                        items.Add(row);
                    }
                }
            }
            catch (Exception) { }
            return items;
        }

        private object MutateDeployedPrinters(string gpoId, GpoNode n, string op, string itemId, Dictionary<string, object> body)
        {
            string side = n.Class == "Machine" ? "Machine" : "User";
            string container = "CN=PushedPrinterConnections," + ScopedGpoDn(gpoId, side);
            if (op != "delete") { EnsureContainer(container); }

            if (op == "delete")
            {
                try { using (DirectoryEntry e = DirectoryService.Bind("CN=" + itemId + "," + container)) { e.DeleteTree(); e.CommitChanges(); } }
                catch (Exception) { }
                GpoWrite.Touch(_config, gpoId, side == "Machine", side == "User", new[] { GpoWrite.Cse(n.Class, GpoCse.DeployedPrinters) });
                return null;
            }

            string unc = Json.RequireString(body, "uncName", 512);
            string printerName = Json.GetString(body, "printerName") ?? LastUnc(unc, true);
            string serverName = Json.GetString(body, "serverName") ?? LastUnc(unc, false);
            string cn = op == "update" ? itemId : printerName.Replace("\\", "_");
            string dn = "CN=" + cn + "," + container;
            using (DirectoryEntry parent = DirectoryService.Bind(container))
            {
                DirectoryEntry child;
                try { child = DirectoryService.Bind(dn); }
                catch (Exception) { child = parent.Children.Add("CN=" + cn, "msPrint-ConnectionPolicy"); }
                child.Properties["uNCName"].Value = unc;
                child.Properties["printerName"].Value = printerName;
                child.Properties["serverName"].Value = serverName;
                child.Properties["printAttributes"].Value = 0;
                child.CommitChanges();
                child.Dispose();
            }
            GpoWrite.Touch(_config, gpoId, side == "Machine", side == "User", new[] { GpoWrite.Cse(n.Class, GpoCse.DeployedPrinters) });
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = cn; row["uncName"] = unc; row["printerName"] = printerName; row["serverName"] = serverName;
            return row;
        }

        private List<object> ReadSoftwareInstallation(string gpoId, GpoNode n)
        {
            List<object> items = new List<object>();
            string side = n.Class == "Machine" ? "Machine" : "User";
            string container = "CN=Packages,CN=Class Store," + ScopedGpoDn(gpoId, side);
            try
            {
                using (DirectoryEntry root = DirectoryService.Bind(container))
                using (DirectorySearcher searcher = new DirectorySearcher(root))
                {
                    searcher.Filter = "(objectClass=packageRegistration)";
                    searcher.SearchScope = SearchScope.OneLevel;
                    searcher.PropertiesToLoad.Add("cn");
                    searcher.PropertiesToLoad.Add("displayName");
                    searcher.PropertiesToLoad.Add("msiScriptName");
                    searcher.PropertiesToLoad.Add("msiFileList");
                    searcher.PropertiesToLoad.Add("productCode");
                    foreach (SearchResult sr in searcher.FindAll())
                    {
                        Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                        row["id"] = PropStr(sr, "cn");
                        row["name"] = PropStr(sr, "displayName");
                        row["deploymentType"] = PropStr(sr, "msiScriptName");
                        row["productCode"] = PropStr(sr, "productCode");
                        List<object> files = new List<object>();
                        if (sr.Properties.Contains("msiFileList"))
                        {
                            foreach (object f in sr.Properties["msiFileList"]) { files.Add(Convert.ToString(f)); }
                        }
                        row["path"] = files.Count > 0 ? files[0] : null;
                        items.Add(row);
                    }
                }
            }
            catch (Exception) { }
            return items;
        }

        private object MutateSoftwareInstallation(string gpoId, GpoNode n, string op, string itemId, Dictionary<string, object> body)
        {
            string side = n.Class == "Machine" ? "Machine" : "User";
            string classStore = "CN=Class Store," + ScopedGpoDn(gpoId, side);
            string packages = "CN=Packages," + classStore;

            if (op == "delete")
            {
                try { using (DirectoryEntry e = DirectoryService.Bind("CN=" + itemId + "," + packages)) { e.DeleteTree(); e.CommitChanges(); } }
                catch (Exception) { }
                GpoWrite.Touch(_config, gpoId, side == "Machine", side == "User", new[] { GpoWrite.Cse(n.Class, GpoCse.SoftwareInstallation) });
                return null;
            }
            if (op == "update")
            {
                throw AgentException.BadRequest("Software installation packages are created and removed, not modified in place; delete and re-add.");
            }

            // Create: class store + packages container, then a packageRegistration.
            EnsureClassStore(classStore, packages);
            string name = Json.RequireString(body, "name", 256);
            string unc = Json.RequireString(body, "path", 1024);
            string deploy = Json.GetString(body, "deploymentType") ?? "A"; // Assigned
            string pkgId = "{" + Guid.NewGuid().ToString().ToUpperInvariant() + "}";
            string aas = "{" + Guid.NewGuid().ToString().ToUpperInvariant() + "}.aas";
            string scriptsPath = @"\\" + GpoWrite.DnsDomain(_config) + @"\SYSVOL\" + GpoWrite.DnsDomain(_config)
                + @"\Policies\{" + GpoService.NormalizeGuid(gpoId) + @"}\" + side + @"\Applications";
            using (DirectoryEntry parent = DirectoryService.Bind(packages))
            {
                DirectoryEntry child = parent.Children.Add("CN=" + pkgId, "packageRegistration");
                child.Properties["displayName"].Value = name;
                child.Properties["msiScriptName"].Value = deploy;
                child.Properties["msiFileList"].Value = "0:" + unc;
                child.Properties["msiScriptPath"].Value = scriptsPath + "\\" + aas;
                child.Properties["packageType"].Value = 5; // DrwFilePath (.msi)
                child.Properties["packageFlags"].Value = deploy == "P" ? 0x00000008 : 0x00000410; // Published or Assigned+valid
                child.Properties["machineArchitecture"].Value = 0;
                child.CommitChanges();
                child.Dispose();
            }
            GpoWrite.Touch(_config, gpoId, side == "Machine", side == "User", new[] { GpoWrite.Cse(n.Class, GpoCse.SoftwareInstallation) });
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = pkgId; row["name"] = name; row["path"] = unc; row["deploymentType"] = deploy;
            return row;
        }

        private void EnsureClassStore(string classStore, string packages)
        {
            try { using (DirectoryService.Bind(classStore)) { } }
            catch (Exception)
            {
                int comma = classStore.IndexOf(',');
                using (DirectoryEntry p = DirectoryService.Bind(classStore.Substring(comma + 1)))
                {
                    DirectoryEntry cs = p.Children.Add(classStore.Substring(0, comma), "classStore");
                    cs.Properties["description"].Value = "Application Store";
                    cs.CommitChanges(); cs.Dispose();
                }
            }
            try { using (DirectoryService.Bind(packages)) { } }
            catch (Exception)
            {
                int comma = packages.IndexOf(',');
                using (DirectoryEntry p = DirectoryService.Bind(packages.Substring(comma + 1)))
                {
                    DirectoryEntry pk = p.Children.Add(packages.Substring(0, comma), "classStore");
                    pk.Properties["description"].Value = "Application Packages";
                    pk.CommitChanges(); pk.Dispose();
                }
            }
        }

        // IP Security policies (ipsecPolicy objects).
        private List<object> ReadIpsec(string gpoId)
        {
            List<object> items = new List<object>();
            string container = "CN=IP Security,CN=System," + _config.DomainDn;
            try
            {
                using (DirectoryEntry root = DirectoryService.Bind(container))
                using (DirectorySearcher searcher = new DirectorySearcher(root))
                {
                    searcher.Filter = "(objectClass=ipsecPolicy)";
                    searcher.SearchScope = SearchScope.OneLevel;
                    searcher.PropertiesToLoad.Add("ipsecName");
                    searcher.PropertiesToLoad.Add("description");
                    searcher.PropertiesToLoad.Add("cn");
                    foreach (SearchResult sr in searcher.FindAll())
                    {
                        Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                        row["id"] = PropStr(sr, "cn");
                        row["name"] = PropStr(sr, "ipsecName");
                        row["description"] = PropStr(sr, "description");
                        row["assigned"] = false;
                        items.Add(row);
                    }
                }
            }
            catch (Exception) { }
            return items;
        }

        private object MutateIpsec(string gpoId, string op, string itemId, Dictionary<string, object> body)
        {
            // IPsec policy objects live under CN=IP Security,CN=System and are
            // assigned to a GPO via the ipsecOwnersReference on the GPO's IPSEC
            // object. Creating full negotiation policies is out of scope here;
            // we support assigning/clearing an existing policy on the GPO.
            string ipsecObj = "CN=ipsec,CN=Windows,CN=Microsoft," + ScopedGpoDn(gpoId, "Machine");
            if (op == "delete")
            {
                try { using (DirectoryEntry e = DirectoryService.Bind(ipsecObj)) { e.Properties["ipsecOwnersReference"].Clear(); e.CommitChanges(); } }
                catch (Exception) { }
                GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.IpSecurity) });
                return null;
            }
            string policyDn = Json.RequireString(body, "name", 1024); // DN of the ipsecPolicy to assign
            EnsureContainer("CN=Microsoft," + ScopedGpoDn(gpoId, "Machine"));
            EnsureContainer("CN=Windows,CN=Microsoft," + ScopedGpoDn(gpoId, "Machine"));
            using (DirectoryEntry parent = DirectoryService.Bind("CN=Windows,CN=Microsoft," + ScopedGpoDn(gpoId, "Machine")))
            {
                DirectoryEntry child;
                try { child = DirectoryService.Bind(ipsecObj); }
                catch (Exception) { child = parent.Children.Add("CN=ipsec", "ipsecPolicy"); }
                child.Properties["ipsecOwnersReference"].Value = policyDn;
                child.CommitChanges(); child.Dispose();
            }
            GpoWrite.Touch(_config, gpoId, true, false, new[] { GpoWrite.Cse("Machine", GpoCse.IpSecurity) });
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = policyDn; row["name"] = policyDn; row["assigned"] = true;
            return row;
        }

        // ===============================================================
        // INI helpers (scripts.ini, fdeploy1.ini)
        // ===============================================================

        private static Dictionary<string, Dictionary<string, string>> ParseIni(string path)
        {
            return ParseIni(path, null);
        }

        private static Dictionary<string, Dictionary<string, string>> ParseIni(string path, Encoding enc)
        {
            Dictionary<string, Dictionary<string, string>> ini = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
            string text = enc != null ? File.ReadAllText(path, enc) : ReadIniText(path);
            string current = null;
            foreach (string rawLine in text.Replace("\r\n", "\n").Split('\n'))
            {
                string line = rawLine.Trim();
                if (line.Length == 0 || line.StartsWith(";")) { continue; }
                if (line.StartsWith("[") && line.EndsWith("]"))
                {
                    current = line.Substring(1, line.Length - 2);
                    if (!ini.ContainsKey(current)) { ini[current] = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase); }
                    continue;
                }
                if (current == null) { continue; }
                int eq = line.IndexOf('=');
                if (eq < 0) { continue; }
                ini[current][line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
            return ini;
        }

        private static string ReadIniText(string path)
        {
            byte[] bytes = File.ReadAllBytes(path);
            if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE) { return Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2); }
            if (bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF) { return Encoding.UTF8.GetString(bytes, 3, bytes.Length - 3); }
            return Encoding.UTF8.GetString(bytes);
        }

        private void WriteIni(string path, Dictionary<string, Dictionary<string, string>> ini)
        {
            WriteIni(path, ini, Encoding.Unicode);
        }

        private void WriteIni(string path, Dictionary<string, Dictionary<string, string>> ini, Encoding enc)
        {
            StringBuilder sb = new StringBuilder();
            foreach (KeyValuePair<string, Dictionary<string, string>> sect in ini)
            {
                sb.Append("[").Append(sect.Key).Append("]\r\n");
                foreach (KeyValuePair<string, string> kv in sect.Value)
                {
                    sb.Append(kv.Key).Append("=").Append(kv.Value).Append("\r\n");
                }
            }
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            byte[] body = enc.GetBytes(sb.ToString());
            if (ReferenceEquals(enc, Encoding.Unicode))
            {
                byte[] bom = new byte[] { 0xFF, 0xFE };
                byte[] all = new byte[bom.Length + body.Length];
                Buffer.BlockCopy(bom, 0, all, 0, bom.Length);
                Buffer.BlockCopy(body, 0, all, bom.Length, body.Length);
                File.WriteAllBytes(path, all);
            }
            else { File.WriteAllBytes(path, body); }
        }

        // ===============================================================
        // Small helpers
        // ===============================================================

        private static object Get(Dictionary<string, object> d, string key)
        {
            object v;
            return d.TryGetValue(key, out v) ? v : null;
        }

        private static string PropStr(SearchResult sr, string name)
        {
            if (sr.Properties.Contains(name) && sr.Properties[name].Count > 0)
            {
                return Convert.ToString(sr.Properties[name][0], CultureInfo.InvariantCulture);
            }
            return null;
        }

        private static string LastSegment(string key)
        {
            if (string.IsNullOrEmpty(key)) { return null; }
            int slash = key.LastIndexOf('\\');
            return slash >= 0 ? key.Substring(slash + 1) : key;
        }

        private static string ToCsv(object v)
        {
            List<object> list = Json.AsList(v);
            if (list != null)
            {
                List<string> parts = new List<string>();
                foreach (object o in list) { parts.Add(Convert.ToString(o, CultureInfo.InvariantCulture)); }
                return string.Join(",", parts.ToArray());
            }
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        private static string LastUnc(string unc, bool printer)
        {
            if (string.IsNullOrEmpty(unc)) { return unc; }
            string trimmed = unc.TrimStart('\\');
            int slash = trimmed.IndexOf('\\');
            if (slash < 0) { return printer ? trimmed : ""; }
            return printer ? trimmed.Substring(slash + 1) : trimmed.Substring(0, slash);
        }

        private static void MapBody(Dictionary<string, object> row, Dictionary<string, object> body, params string[] fields)
        {
            foreach (string f in fields)
            {
                object v;
                if (body.TryGetValue(f, out v)) { row[f] = v; }
            }
        }
    }
}
