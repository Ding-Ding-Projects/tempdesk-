using System;
using System.Collections.Generic;
using System.DirectoryServices;
using System.Globalization;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// Group Policy routes and the cmdlet runner. Everything here goes through
    /// the GroupPolicy and ActiveDirectory PowerShell modules via the shared
    /// runspace pool, using AddCommand/AddParameter only, never script text.
    /// WMI filters, which the GroupPolicy module cannot create, are built
    /// directly as msWMI-Som directory objects.
    /// </summary>
    public class GpoService : IAgentModule
    {
        private readonly AgentConfig _config;
        private Router _router;

        public GpoService(AgentConfig config)
        {
            _config = config;
        }

        public string[] Capabilities
        {
            get
            {
                return new string[]
                {
                    "gpo", "gpo-registry", "gpo-preferences", "gpo-permissions",
                    "gpo-backup", "wmifilters", "cmdlets", "cmdlets-all"
                };
            }
        }

        public void Register(Router router)
        {
            _router = router;
            router.Map("GET", "gpo", true, false, ListGpos);
            router.Map("POST", "gpo", true, false, CreateGpo);
            router.Map("GET", "gpo/{id}", true, false, GetGpo);
            router.Map("PATCH", "gpo/{id}", true, false, PatchGpo);
            router.Map("DELETE", "gpo/{id}", true, false, DeleteGpo);
            router.Map("GET", "gpo/{id}/report", true, false, Report);

            router.Map("POST", "gpo/{id}/links", true, false, CreateLink);
            router.Map("PATCH", "gpo/{id}/links", true, false, SetLink);
            router.Map("DELETE", "gpo/{id}/links", true, false, RemoveLink);

            router.Map("GET", "gpo/{id}/registry", true, false, GetRegistry);
            router.Map("PUT", "gpo/{id}/registry", true, false, SetRegistry);
            router.Map("DELETE", "gpo/{id}/registry", true, false, RemoveRegistry);

            router.Map("GET", "gpo/{id}/preferences/registry", true, false, GetPrefRegistry);
            router.Map("PUT", "gpo/{id}/preferences/registry", true, false, SetPrefRegistry);
            router.Map("DELETE", "gpo/{id}/preferences/registry", true, false, RemovePrefRegistry);

            router.Map("PUT", "gpo/{id}/permissions", true, false, SetPermission);
            router.Map("PUT", "gpo/inheritance", true, false, SetInheritance);

            router.Map("POST", "gpo/{id}/backup", true, false, Backup);
            router.Map("GET", "gpo/backups", true, false, ListBackups);
            router.Map("POST", "gpo/{id}/restore", true, false, Restore);
            router.Map("POST", "gpo/import", true, false, Import);

            router.Map("GET", "gpo/wmifilters", true, false, ListWmiFilters);
            router.Map("POST", "gpo/wmifilters", true, false, CreateWmiFilter);
            router.Map("PUT", "gpo/{id}/wmifilter", true, false, SetGpoWmiFilter);

            router.Map("GET", "cmdlets", true, false, ListCmdlets);
            router.Map("POST", "cmdlets/invoke", true, false, InvokeCmdlet);
        }

        private PowerShellHost Ps(RequestContext ctx)
        {
            if (ctx.Ps == null)
            {
                throw AgentException.Internal("PowerShell host is not available.");
            }
            return ctx.Ps;
        }

        // ---------------------------------------------------------------
        // GPO CRUD
        // ---------------------------------------------------------------

        private object ListGpos(RequestContext ctx)
        {
            List<Dictionary<string, object>> gpos = Ps(ctx).Invoke("Get-GPO", Params("All", true));
            List<object> result = new List<object>();
            foreach (Dictionary<string, object> gpo in gpos)
            {
                result.Add(ShapeGpo(ctx, gpo));
            }
            return result;
        }

        private object CreateGpo(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string name = Json.RequireString(body, "name", 256);
            string comment = Json.GetString(body, "comment");
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Name"] = name;
            if (!string.IsNullOrEmpty(comment)) { p["Comment"] = comment; }
            List<Dictionary<string, object>> created = Ps(ctx).Invoke("New-GPO", p);
            ctx.Audit("gpo create", name);
            object shaped = created.Count > 0 ? ShapeGpo(ctx, created[0]) : null;
            return StatusResult.Created(shaped);
        }

        private object GetGpo(RequestContext ctx)
        {
            string id = ctx.Route("id");
            List<Dictionary<string, object>> gpos = Ps(ctx).Invoke("Get-GPO", Params("Guid", id));
            if (gpos.Count == 0)
            {
                throw AgentException.NotFound("No such GPO.");
            }
            Dictionary<string, object> shaped = ShapeGpo(ctx, gpos[0]);
            shaped["permissions"] = GetPermissions(ctx, id);
            return shaped;
        }

        private object PatchGpo(RequestContext ctx)
        {
            string id = ctx.Route("id");
            Dictionary<string, object> body = ctx.BodyJson();
            string status = Json.GetString(body, "status");
            string comment = Json.GetString(body, "comment");
            string displayName = Json.GetString(body, "displayName");

            if (!string.IsNullOrEmpty(status))
            {
                // There is no Set-GPO cmdlet. GPO status lives in the "flags"
                // attribute of the groupPolicyContainer object: 0 all enabled,
                // 1 user settings disabled, 2 computer settings disabled, 3 all
                // disabled. We set it directly, which is fully supported.
                SetGpoStatusFlags(id, status);
            }
            if (!string.IsNullOrEmpty(comment) || !string.IsNullOrEmpty(displayName))
            {
                Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                p["Guid"] = id;
                if (!string.IsNullOrEmpty(comment)) { p["Comment"] = comment; }
                if (!string.IsNullOrEmpty(displayName)) { p["NewName"] = displayName; }
                Ps(ctx).Invoke("Rename-GPO", p);
            }
            ctx.Audit("gpo patch", id);
            return GetGpo(ctx);
        }

        private void SetGpoStatusFlags(string id, string status)
        {
            int flags;
            switch (status)
            {
                case "AllSettingsEnabled": flags = 0; break;
                case "UserSettingsDisabled": flags = 1; break;
                case "ComputerSettingsDisabled": flags = 2; break;
                case "AllSettingsDisabled": flags = 3; break;
                default:
                    throw AgentException.BadRequest("Unknown GPO status '" + status + "'.");
            }
            string gpoDn = "CN={" + NormalizeGuid(id) + "},CN=Policies,CN=System," + _config.DomainDn;
            using (DirectoryEntry gpo = DirectoryService.Bind(gpoDn))
            {
                gpo.Properties["flags"].Value = flags;
                gpo.CommitChanges();
            }
        }

        private object DeleteGpo(RequestContext ctx)
        {
            string id = ctx.Route("id");
            Ps(ctx).Invoke("Remove-GPO", Params("Guid", id));
            ctx.Audit("gpo delete", id);
            return StatusResult.NoContent();
        }

        private object Report(RequestContext ctx)
        {
            string id = ctx.Route("id");
            string format = ctx.Query["format"];
            bool xml = string.Equals(format, "xml", StringComparison.OrdinalIgnoreCase);
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["ReportType"] = xml ? "Xml" : "Html";
            List<Dictionary<string, object>> output = Ps(ctx).Invoke("Get-GPOReport", p);
            string body = ExtractScalar(output);
            byte[] bytes = Encoding.UTF8.GetBytes(body != null ? body : "");
            return new RawResult(200, xml ? "application/xml; charset=utf-8" : "text/html; charset=utf-8", bytes);
        }

        // ---------------------------------------------------------------
        // Links
        // ---------------------------------------------------------------

        private object CreateLink(RequestContext ctx)
        {
            return WriteLink(ctx, "New-GPLink");
        }

        private object SetLink(RequestContext ctx)
        {
            return WriteLink(ctx, "Set-GPLink");
        }

        private object WriteLink(RequestContext ctx, string cmdlet)
        {
            string id = ctx.Route("id");
            Dictionary<string, object> body = ctx.BodyJson();
            string target = Json.RequireString(body, "target", 2000);
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["Target"] = target;
            bool? enabled = Json.GetNullableBool(body, "enabled");
            if (enabled.HasValue) { p["LinkEnabled"] = enabled.Value ? "Yes" : "No"; }
            bool? enforced = Json.GetNullableBool(body, "enforced");
            if (enforced.HasValue) { p["Enforced"] = enforced.Value ? "Yes" : "No"; }
            long? order = Json.GetLong(body, "order");
            if (order.HasValue) { p["Order"] = (int)order.Value; }
            Ps(ctx).Invoke(cmdlet, p);
            ctx.Audit("gpo link", id + " -> " + target);
            return ShapeLinks(ctx, id);
        }

        private object RemoveLink(RequestContext ctx)
        {
            string id = ctx.Route("id");
            string target = ctx.Query["target"];
            if (string.IsNullOrEmpty(target))
            {
                throw AgentException.BadRequest("target query parameter is required.");
            }
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["Target"] = target;
            Ps(ctx).Invoke("Remove-GPLink", p);
            ctx.Audit("gpo unlink", id + " -> " + target);
            return StatusResult.NoContent();
        }

        // ---------------------------------------------------------------
        // Registry policy
        // ---------------------------------------------------------------

        private object GetRegistry(RequestContext ctx)
        {
            string id = ctx.Route("id");
            string key = RequireQuery(ctx, "key");
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["Key"] = key;
            List<Dictionary<string, object>> output = Ps(ctx).Invoke("Get-GPRegistryValue", p);
            return output;
        }

        private object SetRegistry(RequestContext ctx)
        {
            string id = ctx.Route("id");
            Dictionary<string, object> body = ctx.BodyJson();
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["Key"] = Json.RequireString(body, "key", 2000);
            string valueName = Json.GetString(body, "valueName");
            if (!string.IsNullOrEmpty(valueName)) { p["ValueName"] = valueName; }
            p["Type"] = Json.RequireString(body, "type", 32);
            object value;
            body.TryGetValue("value", out value);
            p["Value"] = PowerShellHost.CoerceValue(value);
            Ps(ctx).Invoke("Set-GPRegistryValue", p);
            ctx.Audit("gpo registry set", id + " " + p["Key"]);
            return GetRegistry2(ctx, id, (string)p["Key"]);
        }

        private object RemoveRegistry(RequestContext ctx)
        {
            string id = ctx.Route("id");
            string key = RequireQuery(ctx, "key");
            string valueName = ctx.Query["valueName"];
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["Key"] = key;
            if (!string.IsNullOrEmpty(valueName)) { p["ValueName"] = valueName; }
            Ps(ctx).Invoke("Remove-GPRegistryValue", p);
            ctx.Audit("gpo registry remove", id + " " + key);
            return StatusResult.NoContent();
        }

        private object GetRegistry2(RequestContext ctx, string id, string key)
        {
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["Key"] = key;
            try
            {
                return Ps(ctx).Invoke("Get-GPRegistryValue", p);
            }
            catch (Exception)
            {
                return new List<object>();
            }
        }

        // ---------------------------------------------------------------
        // Preference registry
        // ---------------------------------------------------------------

        private object GetPrefRegistry(RequestContext ctx)
        {
            string id = ctx.Route("id");
            string key = RequireQuery(ctx, "key");
            string context = ctx.Query["context"];
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["Key"] = key;
            if (!string.IsNullOrEmpty(context)) { p["Context"] = context; }
            return Ps(ctx).Invoke("Get-GPPrefRegistryValue", p);
        }

        private object SetPrefRegistry(RequestContext ctx)
        {
            string id = ctx.Route("id");
            Dictionary<string, object> body = ctx.BodyJson();
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["Key"] = Json.RequireString(body, "key", 2000);
            p["Context"] = Json.RequireString(body, "context", 16);
            p["Action"] = Json.RequireString(body, "action", 16);
            string valueName = Json.GetString(body, "valueName");
            if (!string.IsNullOrEmpty(valueName)) { p["ValueName"] = valueName; }
            p["Type"] = Json.RequireString(body, "type", 32);
            object value;
            body.TryGetValue("value", out value);
            p["Value"] = PowerShellHost.CoerceValue(value);
            Ps(ctx).Invoke("Set-GPPrefRegistryValue", p);
            ctx.Audit("gpo pref registry set", id + " " + p["Key"]);
            return StatusResult.NoContent();
        }

        private object RemovePrefRegistry(RequestContext ctx)
        {
            string id = ctx.Route("id");
            string key = RequireQuery(ctx, "key");
            string context = RequireQuery(ctx, "context");
            string valueName = ctx.Query["valueName"];
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["Key"] = key;
            p["Context"] = context;
            if (!string.IsNullOrEmpty(valueName)) { p["ValueName"] = valueName; }
            Ps(ctx).Invoke("Remove-GPPrefRegistryValue", p);
            ctx.Audit("gpo pref registry remove", id + " " + key);
            return StatusResult.NoContent();
        }

        // ---------------------------------------------------------------
        // Permissions and inheritance
        // ---------------------------------------------------------------

        private object SetPermission(RequestContext ctx)
        {
            string id = ctx.Route("id");
            Dictionary<string, object> body = ctx.BodyJson();
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["TargetName"] = Json.RequireString(body, "trustee", 256);
            p["TargetType"] = Json.RequireString(body, "trusteeType", 16);
            p["PermissionLevel"] = Json.RequireString(body, "permission", 64);
            if (Json.GetBool(body, "replace", true)) { p["Replace"] = true; }
            Ps(ctx).Invoke("Set-GPPermission", p);
            ctx.Audit("gpo permission", id + " " + p["TargetName"]);
            return GetPermissions(ctx, id);
        }

        private object SetInheritance(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Target"] = Json.RequireString(body, "target", 2000);
            p["IsBlocked"] = Json.GetBool(body, "blocked", false) ? "Yes" : "No";
            Ps(ctx).Invoke("Set-GPInheritance", p);
            ctx.Audit("gpo inheritance", (string)p["Target"]);
            return StatusResult.NoContent();
        }

        private List<object> GetPermissions(RequestContext ctx, string id)
        {
            List<object> result = new List<object>();
            try
            {
                Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                p["Guid"] = id;
                p["All"] = true;
                List<Dictionary<string, object>> perms = Ps(ctx).Invoke("Get-GPPermission", p);
                foreach (Dictionary<string, object> perm in perms)
                {
                    Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                    object trustee;
                    if (perm.TryGetValue("Trustee", out trustee))
                    {
                        Dictionary<string, object> t = trustee as Dictionary<string, object>;
                        row["trustee"] = t != null && t.ContainsKey("Name") ? t["Name"] : trustee;
                    }
                    row["permission"] = perm.ContainsKey("Permission") ? perm["Permission"] : null;
                    row["denied"] = perm.ContainsKey("Denied") ? perm["Denied"] : false;
                    result.Add(row);
                }
            }
            catch (Exception)
            {
            }
            return result;
        }

        // ---------------------------------------------------------------
        // Backup / restore / import
        // ---------------------------------------------------------------

        private object Backup(RequestContext ctx)
        {
            string id = ctx.Route("id");
            EnsureBackupPath();
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["Path"] = _config.BackupPath;
            List<Dictionary<string, object>> output = Ps(ctx).Invoke("Backup-GPO", p);
            ctx.Audit("gpo backup", id);
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            string backupId = null;
            if (output.Count > 0 && output[0].ContainsKey("Id"))
            {
                backupId = Convert.ToString(output[0]["Id"], CultureInfo.InvariantCulture);
            }
            result["backupId"] = backupId;
            result["path"] = _config.BackupPath;
            return result;
        }

        private object ListBackups(RequestContext ctx)
        {
            EnsureBackupPath();
            // A GPO backup folder holds one directory per backup, each named
            // with a backup GUID and containing a Backup.xml manifest. We read
            // the manifests so the portal can list backups with their GPO name
            // and timestamp. Parsing is tolerant: a bad manifest is skipped.
            List<object> result = new List<object>();
            try
            {
                foreach (string dir in System.IO.Directory.GetDirectories(_config.BackupPath))
                {
                    string manifest = System.IO.Path.Combine(dir, "Backup.xml");
                    if (!System.IO.File.Exists(manifest)) { continue; }
                    Dictionary<string, object> row = ReadBackupManifest(dir, manifest);
                    if (row != null) { result.Add(row); }
                }
            }
            catch (Exception ex)
            {
                throw AgentException.Internal("Could not list backups: " + ex.Message);
            }
            return result;
        }

        private static Dictionary<string, object> ReadBackupManifest(string dir, string manifestPath)
        {
            try
            {
                System.Xml.XmlDocument doc = new System.Xml.XmlDocument();
                doc.Load(manifestPath);
                Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                string backupId = System.IO.Path.GetFileName(dir).Trim('{', '}');
                row["backupId"] = backupId;
                row["path"] = dir;
                // The manifest records the GPO guid, display name and time under
                // GroupPolicyBackupHeader elements; we pull them by local name.
                row["gpoGuid"] = InnerTextByLocalName(doc, "ID");
                row["displayName"] = InnerTextByLocalName(doc, "GPODisplayName");
                row["time"] = InnerTextByLocalName(doc, "BackupTime");
                return row;
            }
            catch (Exception)
            {
                return null;
            }
        }

        private static string InnerTextByLocalName(System.Xml.XmlDocument doc, string localName)
        {
            System.Xml.XmlNodeList nodes = doc.GetElementsByTagName(localName);
            if (nodes != null && nodes.Count > 0)
            {
                return nodes[0].InnerText;
            }
            return null;
        }

        private object Restore(RequestContext ctx)
        {
            string id = ctx.Route("id");
            Dictionary<string, object> body = ctx.BodyJson();
            string backupId = Json.GetString(body, "backupId");
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = id;
            p["Path"] = _config.BackupPath;
            if (!string.IsNullOrEmpty(backupId)) { p["BackupId"] = backupId; }
            Ps(ctx).Invoke("Restore-GPO", p);
            ctx.Audit("gpo restore", id);
            return StatusResult.NoContent();
        }

        private object Import(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string backupId = Json.RequireString(body, "backupId", 128);
            string targetName = Json.RequireString(body, "targetName", 256);
            bool createIfNeeded = Json.GetBool(body, "createIfNeeded", true);
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["BackupId"] = backupId;
            p["Path"] = _config.BackupPath;
            p["TargetName"] = targetName;
            if (createIfNeeded) { p["CreateIfNeeded"] = true; }
            List<Dictionary<string, object>> created = Ps(ctx).Invoke("Import-GPO", p);
            ctx.Audit("gpo import", targetName);
            return created.Count > 0 ? ShapeGpo(ctx, created[0]) : null;
        }

        private void EnsureBackupPath()
        {
            try
            {
                if (!string.IsNullOrEmpty(_config.BackupPath) && !System.IO.Directory.Exists(_config.BackupPath))
                {
                    System.IO.Directory.CreateDirectory(_config.BackupPath);
                }
            }
            catch (Exception ex)
            {
                throw AgentException.Internal("Could not create backup path: " + ex.Message);
            }
        }

        // ---------------------------------------------------------------
        // WMI filters (built directly as msWMI-Som objects)
        // ---------------------------------------------------------------

        private string SomFiltersDn()
        {
            return "CN=SOM,CN=WMIPolicy,CN=System," + _config.DomainDn;
        }

        private object ListWmiFilters(RequestContext ctx)
        {
            List<object> result = new List<object>();
            string container = SomFiltersDn();
            using (DirectoryEntry root = DirectoryService.Bind(container))
            using (DirectorySearcher searcher = new DirectorySearcher(root))
            {
                searcher.Filter = "(objectClass=msWMI-Som)";
                searcher.SearchScope = SearchScope.OneLevel;
                searcher.PropertiesToLoad.Add("msWMI-Name");
                searcher.PropertiesToLoad.Add("msWMI-Parm1");
                searcher.PropertiesToLoad.Add("msWMI-Parm2");
                searcher.PropertiesToLoad.Add("msWMI-ID");
                foreach (SearchResult sr in searcher.FindAll())
                {
                    Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                    row["id"] = Prop(sr, "msWMI-ID");
                    row["name"] = Prop(sr, "msWMI-Name");
                    row["description"] = Prop(sr, "msWMI-Parm1");
                    row["query"] = ParseWqlFromParm2(Prop(sr, "msWMI-Parm2"));
                    result.Add(row);
                }
            }
            return result;
        }

        private object CreateWmiFilter(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string name = Json.RequireString(body, "name", 256);
            string description = Json.GetString(body, "description");
            if (description == null) { description = ""; }
            string query = Json.RequireString(body, "query", 4000);

            string guid = "{" + Guid.NewGuid().ToString().ToUpperInvariant() + "}";
            string now = DateTime.UtcNow.ToString("yyyyMMddHHmmss.ffffff", CultureInfo.InvariantCulture) + "-000";
            // msWMI-Parm2 encodes one WQL query: count;flags;namespace len;WQL;
            // namespace;query;. We follow the documented "1;3;10;<len>;WQL;
            // root\CIMv2;<query>;" shape.
            string parm2 = "1;3;10;" + query.Length.ToString(CultureInfo.InvariantCulture)
                + ";WQL;root\\CIMv2;" + query + ";";
            string author = ctx.ActingUser + "@" + DnsDomainFromDn();

            string container = SomFiltersDn();
            using (DirectoryEntry parent = DirectoryService.Bind(container))
            {
                DirectoryEntry child = parent.Children.Add("CN=" + guid, "msWMI-Som");
                child.Properties["msWMI-Name"].Value = name;
                child.Properties["msWMI-Parm1"].Value = description;
                child.Properties["msWMI-Parm2"].Value = parm2;
                child.Properties["msWMI-ID"].Value = guid;
                child.Properties["msWMI-Author"].Value = author;
                child.Properties["msWMI-ChangeDate"].Value = now;
                child.Properties["msWMI-CreationDate"].Value = now;
                child.Properties["instanceType"].Value = 4;
                child.CommitChanges();
                child.Dispose();
            }
            ctx.Audit("wmifilter create", name);
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["id"] = guid;
            result["name"] = name;
            result["description"] = description;
            result["query"] = query;
            return StatusResult.Created(result);
        }

        private object SetGpoWmiFilter(RequestContext ctx)
        {
            string id = ctx.Route("id");
            Dictionary<string, object> body = ctx.BodyJson();
            string name = Json.GetString(body, "name"); // null clears the filter

            // The GPO's gPCWQLFilter is "[<domain>;{GUID};0]" or empty.
            string gpoDn = "CN={" + NormalizeGuid(id) + "},CN=Policies,CN=System," + _config.DomainDn;
            using (DirectoryEntry gpo = DirectoryService.Bind(gpoDn))
            {
                if (string.IsNullOrEmpty(name))
                {
                    gpo.Properties["gPCWQLFilter"].Clear();
                }
                else
                {
                    string filterGuid = ResolveWmiFilterGuidByName(name);
                    if (filterGuid == null)
                    {
                        throw AgentException.NotFound("No WMI filter named '" + name + "'.");
                    }
                    gpo.Properties["gPCWQLFilter"].Value = "[" + DnsDomainFromDn() + ";" + filterGuid + ";0]";
                }
                gpo.CommitChanges();
            }
            ctx.Audit("gpo wmifilter", id + " -> " + (name == null ? "(none)" : name));
            return StatusResult.NoContent();
        }

        private string ResolveWmiFilterGuidByName(string name)
        {
            using (DirectoryEntry root = DirectoryService.Bind(SomFiltersDn()))
            using (DirectorySearcher searcher = new DirectorySearcher(root))
            {
                searcher.Filter = "(&(objectClass=msWMI-Som)(msWMI-Name=" + EscapeFilter(name) + "))";
                searcher.PropertiesToLoad.Add("msWMI-ID");
                SearchResult sr = searcher.FindOne();
                if (sr != null)
                {
                    return Prop(sr, "msWMI-ID");
                }
            }
            return null;
        }

        // ---------------------------------------------------------------
        // Cmdlet runner
        // ---------------------------------------------------------------

        /// <summary>
        /// scope=all (every installed module) is the escape hatch for anything
        /// without its own page. It needs a valid X-TempDesk-Elevation token bound
        /// to the acting user, checked exactly like requiresElevation routes.
        /// </summary>
        private void RequireElevation(RequestContext ctx)
        {
            string token = ctx.Request != null ? ctx.Request.Headers["X-TempDesk-Elevation"] : null;
            if (_router == null || _router.Auth == null || !_router.Auth.IsElevated(token, ctx.ActingUser))
            {
                throw AgentException.Forbidden("This action needs a fresh password confirmation (POST /auth/confirm).");
            }
        }

        private static bool IsScopeAll(string scope)
        {
            return string.Equals(scope, "all", StringComparison.OrdinalIgnoreCase);
        }

        private object ListCmdlets(RequestContext ctx)
        {
            bool all = IsScopeAll(ctx.Query["scope"]);
            if (all)
            {
                RequireElevation(ctx);
            }
            List<object> result = new List<object>();
            foreach (CmdletInfo info in (all ? Ps(ctx).CatalogAll() : Ps(ctx).Catalog()))
            {
                Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                row["name"] = info.Name;
                row["module"] = info.Module;
                row["verb"] = info.Verb;
                row["noun"] = info.Noun;
                List<object> prms = new List<object>();
                foreach (CmdletParam p in info.Parameters)
                {
                    Dictionary<string, object> pr = new Dictionary<string, object>(StringComparer.Ordinal);
                    pr["name"] = p.Name;
                    pr["type"] = p.Type;
                    pr["mandatory"] = p.Mandatory;
                    pr["sets"] = p.Sets;
                    prms.Add(pr);
                }
                row["parameters"] = prms;
                result.Add(row);
            }
            return result;
        }

        private object InvokeCmdlet(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string name = Json.RequireString(body, "name", 128);
            bool all = IsScopeAll(Json.GetString(body, "scope")) || IsScopeAll(ctx.Query["scope"]);
            if (all)
            {
                RequireElevation(ctx);
                if (!Ps(ctx).IsAllowedAll(name))
                {
                    throw AgentException.NotFound("No installed cmdlet or function named '" + name + "'.");
                }
            }
            else if (!Ps(ctx).IsAllowed(name))
            {
                throw AgentException.Forbidden("Cmdlet '" + name + "' is not in the ActiveDirectory or GroupPolicy allowlist.");
            }
            RequireConfirmIfDestructive(name, body);

            Dictionary<string, object> parameters = Json.GetDict(body, "parameters");
            bool whatIf = Json.GetBool(body, "whatIf", false);

            PowerShellHost.InvokeResult raw = Ps(ctx).InvokeRaw(name, parameters, whatIf);
            ctx.Audit(all ? "cmdlet invoke (scope=all)" : "cmdlet invoke", name);

            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            List<object> output = new List<object>();
            foreach (object item in raw.Output)
            {
                output.Add(PsSerializer.Convert3(item, 0));
            }
            result["output"] = output;
            result["errors"] = raw.Errors;
            result["warnings"] = raw.Warnings;
            return result;
        }

        /// <summary>
        /// Destructive verbs require a confirm field equal to the cmdlet name.
        /// </summary>
        public static void RequireConfirmIfDestructive(string name, Dictionary<string, object> body)
        {
            string verb = name.Split('-')[0];
            bool destructive =
                string.Equals(verb, "Remove", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(verb, "Clear", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(verb, "Reset", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(verb, "Restore", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(verb, "Disable", StringComparison.OrdinalIgnoreCase);
            if (!destructive)
            {
                return;
            }
            string confirm = Json.GetString(body, "confirm");
            if (!string.Equals(confirm, name, StringComparison.Ordinal))
            {
                throw AgentException.BadRequest("This cmdlet is destructive; set \"confirm\" to \"" + name + "\".");
            }
        }

        // ---------------------------------------------------------------
        // Shaping helpers
        // ---------------------------------------------------------------

        private Dictionary<string, object> ShapeGpo(RequestContext ctx, Dictionary<string, object> gpo)
        {
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            string id = NormalizeGuid(Convert.ToString(Get(gpo, "Id"), CultureInfo.InvariantCulture));
            row["id"] = id;
            row["displayName"] = Get(gpo, "DisplayName");
            row["status"] = Get(gpo, "GpoStatus");
            row["created"] = Get(gpo, "CreationTime");
            row["modified"] = Get(gpo, "ModificationTime");
            row["wmiFilter"] = ShapeWmiFilterName(gpo);
            row["links"] = ShapeLinks(ctx, id);
            return row;
        }

        private object ShapeWmiFilterName(Dictionary<string, object> gpo)
        {
            object wmi;
            if (gpo.TryGetValue("WmiFilter", out wmi) && wmi != null)
            {
                Dictionary<string, object> w = wmi as Dictionary<string, object>;
                if (w != null && w.ContainsKey("Name"))
                {
                    return w["Name"];
                }
            }
            return null;
        }

        /// <summary>
        /// Lists links by searching for objects whose gPLink references this GPO
        /// guid, which is more reliable than parsing the report XML.
        /// </summary>
        private List<object> ShapeLinks(RequestContext ctx, string id)
        {
            List<object> links = new List<object>();
            string needle = "cn={" + NormalizeGuid(id) + "},cn=policies,cn=system";
            try
            {
                using (DirectoryEntry root = DirectoryService.Bind(_config.DomainDn))
                using (DirectorySearcher searcher = new DirectorySearcher(root))
                {
                    searcher.Filter = "(gPLink=*" + "{" + NormalizeGuid(id) + "}" + "*)";
                    searcher.SearchScope = SearchScope.Subtree;
                    searcher.PageSize = 1000;
                    searcher.PropertiesToLoad.Add("gPLink");
                    searcher.PropertiesToLoad.Add("distinguishedName");
                    foreach (SearchResult sr in searcher.FindAll())
                    {
                        string targetDn = Prop(sr, "distinguishedName");
                        string gpLink = Prop(sr, "gPLink");
                        ParseGpLink(gpLink, id, targetDn, links);
                    }
                }
            }
            catch (Exception)
            {
            }
            return links;
        }

        /// <summary>
        /// Parses a gPLink value "[LDAP://cn={GUID},...;flags][...]" and adds any
        /// entry matching this GPO, with order derived from position and the
        /// enabled/enforced flags (bit 1 = disabled, bit 2 = enforced).
        /// </summary>
        private static void ParseGpLink(string gpLink, string id, string targetDn, List<object> links)
        {
            if (string.IsNullOrEmpty(gpLink))
            {
                return;
            }
            string normId = NormalizeGuid(id);
            string[] parts = gpLink.Split(new char[] { '[' }, StringSplitOptions.RemoveEmptyEntries);
            int order = 0;
            foreach (string raw in parts)
            {
                string entry = raw.TrimEnd(']');
                if (entry.Length == 0) { continue; }
                order++;
                int semi = entry.LastIndexOf(';');
                if (semi < 0) { continue; }
                string dnPart = entry.Substring(0, semi);
                string flagPart = entry.Substring(semi + 1);
                if (dnPart.IndexOf("{" + normId + "}", StringComparison.OrdinalIgnoreCase) < 0)
                {
                    continue;
                }
                int flags;
                int.TryParse(flagPart, out flags);
                Dictionary<string, object> link = new Dictionary<string, object>(StringComparer.Ordinal);
                link["target"] = targetDn;
                link["enabled"] = (flags & 1) == 0;
                link["enforced"] = (flags & 2) != 0;
                link["order"] = order;
                links.Add(link);
            }
        }

        // ---------------------------------------------------------------
        // Small helpers
        // ---------------------------------------------------------------

        private static Dictionary<string, object> Params(string key, object value)
        {
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p[key] = value;
            return p;
        }

        private static object Get(Dictionary<string, object> d, string key)
        {
            object v;
            return d.TryGetValue(key, out v) ? v : null;
        }

        private static string Prop(SearchResult sr, string name)
        {
            if (sr.Properties.Contains(name) && sr.Properties[name].Count > 0)
            {
                return Convert.ToString(sr.Properties[name][0], CultureInfo.InvariantCulture);
            }
            return null;
        }

        public static string NormalizeGuid(string id)
        {
            if (string.IsNullOrEmpty(id))
            {
                return id;
            }
            return id.Trim().Trim('{', '}').ToUpperInvariant();
        }

        private string DnsDomainFromDn()
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

        private static string ParseWqlFromParm2(string parm2)
        {
            if (string.IsNullOrEmpty(parm2))
            {
                return null;
            }
            // Fields are semicolon separated; the WQL text is the field after
            // the "WQL" marker and the namespace.
            string[] fields = parm2.Split(';');
            for (int i = 0; i < fields.Length - 2; i++)
            {
                if (string.Equals(fields[i], "WQL", StringComparison.OrdinalIgnoreCase))
                {
                    // fields[i+1] is the namespace, fields[i+2] is the query.
                    return fields[i + 2];
                }
            }
            return null;
        }

        private static string EscapeFilter(string value)
        {
            StringBuilder sb = new StringBuilder();
            foreach (char c in value)
            {
                switch (c)
                {
                    case '\\': sb.Append("\\5c"); break;
                    case '*': sb.Append("\\2a"); break;
                    case '(': sb.Append("\\28"); break;
                    case ')': sb.Append("\\29"); break;
                    case '\0': sb.Append("\\00"); break;
                    default: sb.Append(c); break;
                }
            }
            return sb.ToString();
        }

        private static string RequireQuery(RequestContext ctx, string name)
        {
            string v = ctx.Query[name];
            if (string.IsNullOrEmpty(v))
            {
                throw AgentException.BadRequest("Query parameter '" + name + "' is required.");
            }
            return v;
        }

        private static string ExtractScalar(List<Dictionary<string, object>> output)
        {
            if (output.Count == 0)
            {
                return null;
            }
            Dictionary<string, object> first = output[0];
            object v;
            if (first.TryGetValue("value", out v))
            {
                return Convert.ToString(v, CultureInfo.InvariantCulture);
            }
            return Json.Serialize(first);
        }
    }
}
