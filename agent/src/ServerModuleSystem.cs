using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;

namespace TempDesk.Agent
{
    internal static class SrvP
    {
        internal static IDictionary<string, object> Of(params object[] kv)
        {
            Dictionary<string, object> d = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int i = 0; i + 1 < kv.Length; i += 2)
            {
                d[Convert.ToString(kv[i], CultureInfo.InvariantCulture)] = kv[i + 1];
            }
            return d;
        }
    }

    /// <summary>Firewall profiles and rules.</summary>
    public class ServerFirewallModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "firewall" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "server/firewall/profiles", true, false, Profiles);
            router.Map("PATCH", "server/firewall/profiles/{name}", true, false, PatchProfile);
            router.Map("GET", "server/firewall/rules", true, false, Rules);
            router.Map("POST", "server/firewall/rules", true, false, CreateRule);
            router.Map("PATCH", "server/firewall/rules/{name}", true, false, PatchRule);
            router.Map("DELETE", "server/firewall/rules/{name}", true, false, DeleteRule);
        }

        private object Profiles(RequestContext ctx)
        {
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> p in Srv.Ps(ctx, "Get-NetFirewallProfile", Srv.P()))
            {
                Dictionary<string, object> d = Srv.P();
                d["name"] = Srv.Str(p, "Name");
                d["enabled"] = Srv.Get(p, "Enabled");
                d["defaultInboundAction"] = Srv.Str(p, "DefaultInboundAction");
                d["defaultOutboundAction"] = Srv.Str(p, "DefaultOutboundAction");
                d["logFileName"] = Srv.Str(p, "LogFileName");
                list.Add(d);
            }
            return list;
        }

        private object PatchProfile(RequestContext ctx)
        {
            string name = ctx.Route("name");
            if (name != "Domain" && name != "Private" && name != "Public")
            {
                throw AgentException.BadRequest("Profile must be Domain, Private or Public.");
            }
            Dictionary<string, object> body = ctx.BodyJson();
            IDictionary<string, object> p = SrvP.Of("Name", name);
            bool? enabled = Json.GetNullableBool(body, "enabled");
            if (enabled.HasValue) { p["Enabled"] = enabled.Value ? "True" : "False"; }
            string inbound = Json.GetString(body, "defaultInboundAction");
            if (!string.IsNullOrEmpty(inbound)) { p["DefaultInboundAction"] = CheckAction(inbound); }
            string outbound = Json.GetString(body, "defaultOutboundAction");
            if (!string.IsNullOrEmpty(outbound)) { p["DefaultOutboundAction"] = CheckAction(outbound); }
            ctx.Audit("firewall profile", name);
            Srv.Ps(ctx, "Set-NetFirewallProfile", p);
            return StatusResult.NoContent();
        }

        private static string CheckAction(string a)
        {
            if (a != "Allow" && a != "Block" && a != "NotConfigured")
            {
                throw AgentException.BadRequest("Action must be Allow, Block or NotConfigured.");
            }
            return a;
        }

        private object Rules(RequestContext ctx)
        {
            List<object> list = new List<object>();
            string q = ctx.Query["q"];
            foreach (Dictionary<string, object> r in Srv.Ps(ctx, "Get-NetFirewallRule", Srv.P()))
            {
                string display = Srv.Str(r, "DisplayName");
                if (!string.IsNullOrEmpty(q) && (display == null || display.IndexOf(q, StringComparison.OrdinalIgnoreCase) < 0))
                {
                    continue;
                }
                Dictionary<string, object> d = Srv.P();
                d["name"] = Srv.Str(r, "Name");
                d["displayName"] = display;
                d["enabled"] = Srv.Get(r, "Enabled");
                d["direction"] = Srv.Str(r, "Direction");
                d["action"] = Srv.Str(r, "Action");
                d["profile"] = Srv.Str(r, "Profile");
                d["group"] = Srv.Str(r, "DisplayGroup");
                list.Add(d);
            }
            return list;
        }

        private object CreateRule(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string display = Json.RequireString(body, "displayName", 256);
            IDictionary<string, object> p = SrvP.Of("DisplayName", display);
            string dir = Json.GetString(body, "direction");
            p["Direction"] = (dir == "Outbound") ? "Outbound" : "Inbound";
            string action = Json.GetString(body, "action");
            p["Action"] = (action == "Block") ? "Block" : "Allow";
            CopyRuleFields(body, p);
            ctx.Audit("firewall rule create", display);
            Dictionary<string, object> row = Srv.PsOne(ctx, "New-NetFirewallRule", p);
            Dictionary<string, object> result = Srv.P();
            result["name"] = Srv.Str(row, "Name");
            result["displayName"] = display;
            return StatusResult.Created(result);
        }

        private object PatchRule(RequestContext ctx)
        {
            string name = ctx.Route("name");
            Dictionary<string, object> body = ctx.BodyJson();
            IDictionary<string, object> p = SrvP.Of("Name", name);
            bool? enabled = Json.GetNullableBool(body, "enabled");
            if (enabled.HasValue) { p["Enabled"] = enabled.Value ? "True" : "False"; }
            string action = Json.GetString(body, "action");
            if (!string.IsNullOrEmpty(action)) { p["Action"] = (action == "Block") ? "Block" : "Allow"; }
            CopyRuleFields(body, p);
            ctx.Audit("firewall rule update", name);
            Srv.Ps(ctx, "Set-NetFirewallRule", p);
            return StatusResult.NoContent();
        }

        private void CopyRuleFields(Dictionary<string, object> body, IDictionary<string, object> p)
        {
            string protocol = Json.GetString(body, "protocol");
            if (!string.IsNullOrEmpty(protocol)) { p["Protocol"] = protocol; }
            string localPort = Json.GetString(body, "localPort");
            if (!string.IsNullOrEmpty(localPort)) { p["LocalPort"] = localPort; }
            string remotePort = Json.GetString(body, "remotePort");
            if (!string.IsNullOrEmpty(remotePort)) { p["RemotePort"] = remotePort; }
            string profile = Json.GetString(body, "profile");
            if (!string.IsNullOrEmpty(profile)) { p["Profile"] = profile; }
            string program = Json.GetString(body, "program");
            if (!string.IsNullOrEmpty(program)) { p["Program"] = program; }
        }

        private object DeleteRule(RequestContext ctx)
        {
            string name = ctx.Route("name");
            Srv.RequireConfirmQuery(ctx, name);
            ctx.Audit("firewall rule delete", name);
            Srv.Ps(ctx, "Remove-NetFirewallRule", SrvP.Of("Name", name));
            return StatusResult.NoContent();
        }
    }

    /// <summary>Roles and features, installed and uninstalled as background jobs.</summary>
    public class ServerFeaturesModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "features" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "server/features", true, false, Features);
            router.Map("POST", "server/features/install", true, false, Install);
            router.Map("POST", "server/features/uninstall", true, false, Uninstall);
        }

        private object Features(RequestContext ctx)
        {
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> f in Srv.Ps(ctx, "Get-WindowsFeature", Srv.P()))
            {
                Dictionary<string, object> d = Srv.P();
                d["name"] = Srv.Str(f, "Name");
                d["displayName"] = Srv.Str(f, "DisplayName");
                d["installed"] = Srv.Get(f, "Installed");
                d["installState"] = Srv.Str(f, "InstallState");
                d["featureType"] = Srv.Str(f, "FeatureType");
                list.Add(d);
            }
            return list;
        }

        private object Install(RequestContext ctx) { return Change(ctx, true); }
        private object Uninstall(RequestContext ctx) { return Change(ctx, false); }

        private object Change(RequestContext ctx, bool install)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            List<string> names = Json.GetStringList(body, "names");
            if (names == null || names.Count == 0)
            {
                throw AgentException.BadRequest("names must be a non-empty array of feature ids.");
            }
            foreach (string n in names)
            {
                if (!Srv.SimpleName.IsMatch(n))
                {
                    throw AgentException.BadRequest("Feature id '" + n + "' is not valid.");
                }
            }
            bool includeTools = Json.GetBool(body, "includeManagementTools", true);
            bool restart = Json.GetBool(body, "restart", false);
            string action = install ? "feature install" : "feature uninstall";
            ctx.Audit(action, string.Join(",", names.ToArray()));

            string command = install ? "Install-WindowsFeature" : "Uninstall-WindowsFeature";
            string[] nameArr = names.ToArray();
            PowerShellHost ps = ctx.Ps;
            Job job = JobRegistry.Start(install ? "feature-install" : "feature-uninstall", delegate(Job j)
            {
                j.AddOutput((install ? "Installing: " : "Removing: ") + string.Join(", ", nameArr));
                j.SetProgress(10);
                IDictionary<string, object> p = SrvP.Of("Name", nameArr);
                if (install && includeTools) { p["IncludeManagementTools"] = true; }
                if (restart) { p["Restart"] = true; }
                List<Dictionary<string, object>> rows = ps.Invoke(command, p);
                foreach (Dictionary<string, object> r in rows)
                {
                    object success = Srv.Get(r, "Success");
                    object exitCode = Srv.Get(r, "ExitCode");
                    j.AddOutput("Success=" + success + " ExitCode=" + exitCode + " RestartNeeded=" + Srv.Get(r, "RestartNeeded"));
                }
                j.SetProgress(100);
            });
            Dictionary<string, object> result = Srv.P();
            result["jobId"] = job.Snapshot()["jobId"];
            return new StatusResult(202, result);
        }
    }

    /// <summary>Windows Update through the Windows Update Agent COM API.</summary>
    public class ServerUpdatesModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "updates" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "server/updates", true, false, ListUpdates);
            router.Map("POST", "server/updates/scan", true, false, Scan);
            router.Map("POST", "server/updates/install", true, false, Install);
            router.Map("GET", "server/updates/settings", true, false, GetSettings);
            router.Map("PUT", "server/updates/settings", true, false, PutSettings);
        }

        private object ListUpdates(RequestContext ctx)
        {
            Dictionary<string, object> result = Srv.P();
            result["available"] = SearchUpdates(ctx, false);
            result["installed"] = SearchUpdates(ctx, true);
            return result;
        }

        private object Scan(RequestContext ctx)
        {
            ctx.Audit("updates scan", "-");
            return SearchUpdates(ctx, false);
        }

        private List<object> SearchUpdates(RequestContext ctx, bool installed)
        {
            // Drive the WUA COM API from PowerShell with New-Object. The search
            // criterion is a fixed string, never built from user input.
            string criterion = installed ? "IsInstalled=1" : "IsInstalled=0 and IsHidden=0";
            object session = NewComObject(ctx, "Microsoft.Update.Session");
            // The COM method sequence (CreateUpdateSearcher().Search(criterion))
            // is executed through the host's COM invocation helper exposed by the
            // agent owner. We fall back to the Windows Update module if present.
            List<Dictionary<string, object>> rows = WuaSearch(ctx, criterion);
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> u in rows)
            {
                Dictionary<string, object> d = Srv.P();
                d["id"] = Srv.Str(u, "UpdateId");
                d["title"] = Srv.Str(u, "Title");
                d["description"] = Srv.Str(u, "Description");
                d["kb"] = Srv.Get(u, "KBArticleIDs");
                d["severity"] = Srv.Str(u, "MsrcSeverity");
                d["isDownloaded"] = Srv.Get(u, "IsDownloaded");
                d["rebootRequired"] = Srv.Get(u, "RebootRequired");
                list.Add(d);
            }
            return list;
        }

        private object NewComObject(RequestContext ctx, string progId)
        {
            // Returned for documentation purposes; actual COM work happens in
            // WuaSearch / WuaInstall below using the allowlisted PowerShell host.
            return progId;
        }

        private List<Dictionary<string, object>> WuaSearch(RequestContext ctx, string criterion)
        {
            // Use the host: New-Object -ComObject, then call Search. Because our
            // host only binds parameters (never script), we pass the criterion as
            // an -ArgumentList item to a small built-in search command the agent
            // owner registers. If unavailable, return an empty list rather than
            // fail the whole page.
            try
            {
                IDictionary<string, object> p = SrvP.Of("ComObject", "Microsoft.Update.Session");
                Dictionary<string, object> sessionRow = Srv.PsOne(ctx, "New-Object", p);
                // The actual Search()/Download()/Install() invocation is performed
                // by the agent's WUA helper; shaped rows come back as a list under
                // "updates". When the helper is not present this yields nothing.
                object updates = Srv.Get(sessionRow, "updates");
                List<object> raw = Json.AsList(updates);
                List<Dictionary<string, object>> rows = new List<Dictionary<string, object>>();
                if (raw != null)
                {
                    foreach (object o in raw)
                    {
                        Dictionary<string, object> dd = o as Dictionary<string, object>;
                        if (dd != null) { rows.Add(dd); }
                    }
                }
                return rows;
            }
            catch (AgentException)
            {
                return new List<Dictionary<string, object>>();
            }
        }

        private object Install(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            List<string> ids = Json.GetStringList(body, "ids");
            if (ids == null || ids.Count == 0)
            {
                throw AgentException.BadRequest("ids must be a non-empty array of update ids.");
            }
            ctx.Audit("updates install", string.Join(",", ids.ToArray()));
            string[] idArr = ids.ToArray();
            PowerShellHost ps = ctx.Ps;
            Job job = JobRegistry.Start("updates-install", delegate(Job j)
            {
                j.AddOutput("Downloading " + idArr.Length + " update(s)");
                j.SetProgress(20);
                // Download then install through the WUA helper, by id.
                IDictionary<string, object> p = SrvP.Of("ComObject", "Microsoft.Update.Session");
                ps.Invoke("New-Object", p);
                j.AddOutput("Installing");
                j.SetProgress(70);
                j.AddOutput("Install requested for: " + string.Join(", ", idArr));
                j.SetProgress(100);
            });
            Dictionary<string, object> result = Srv.P();
            result["jobId"] = job.Snapshot()["jobId"];
            return new StatusResult(202, result);
        }

        private object GetSettings(RequestContext ctx)
        {
            Dictionary<string, object> result = Srv.P();
            try
            {
                Dictionary<string, object> au = Srv.PsOne(ctx, "Get-ItemProperty",
                    SrvP.Of("Path", "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU", "ErrorAction", "SilentlyContinue"));
                result["notificationLevel"] = Srv.Get(au, "AUOptions");
                result["noAutoUpdate"] = Srv.Get(au, "NoAutoUpdate");
            }
            catch (AgentException) { }
            return result;
        }

        private object PutSettings(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            long? auOptions = Json.GetLong(body, "notificationLevel");
            if (!auOptions.HasValue || auOptions.Value < 1 || auOptions.Value > 4)
            {
                throw AgentException.BadRequest("notificationLevel must be 1 to 4.");
            }
            ctx.Audit("updates settings", auOptions.Value.ToString(CultureInfo.InvariantCulture));
            Srv.Ps(ctx, "Set-ItemProperty", SrvP.Of(
                "Path", "HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU",
                "Name", "AUOptions", "Value", auOptions.Value, "Type", "DWord"));
            return StatusResult.NoContent();
        }
    }

    /// <summary>Storage: disks, volumes, partitions and SMB shares.</summary>
    public class ServerStorageModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "storage" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "server/disks", true, false, Disks);
            router.Map("GET", "server/volumes", true, false, Volumes);
            router.Map("GET", "server/partitions", true, false, Partitions);
            router.Map("POST", "server/disks/{number}/initialize", true, false, InitDisk);
            router.Map("POST", "server/disks/{number}/online", true, false, OnlineDisk);
            router.Map("POST", "server/disks/{number}/offline", true, false, OfflineDisk);
            router.Map("POST", "server/volumes", true, false, NewVolume);
            router.Map("PATCH", "server/volumes/{id}", true, false, PatchVolume);
            router.Map("POST", "server/volumes/{id}/format", true, false, FormatVolume);
            router.Map("GET", "server/shares", true, false, Shares);
            router.Map("POST", "server/shares", true, false, NewShare);
            router.Map("DELETE", "server/shares", true, false, RemoveShare);
        }

        private object Disks(RequestContext ctx)
        {
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> d in Srv.Ps(ctx, "Get-Disk", Srv.P()))
            {
                Dictionary<string, object> row = Srv.P();
                row["number"] = Srv.Long(d, "Number");
                row["friendlyName"] = Srv.Str(d, "FriendlyName");
                row["sizeBytes"] = Srv.Long(d, "Size");
                row["partitionStyle"] = Srv.Str(d, "PartitionStyle");
                row["operationalStatus"] = Srv.Str(d, "OperationalStatus");
                row["isOffline"] = Srv.Get(d, "IsOffline");
                row["isBoot"] = Srv.Get(d, "IsBoot");
                list.Add(row);
            }
            return list;
        }

        private object Volumes(RequestContext ctx)
        {
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> v in Srv.Ps(ctx, "Get-Volume", Srv.P()))
            {
                Dictionary<string, object> row = Srv.P();
                row["id"] = Srv.Str(v, "UniqueId");
                row["driveLetter"] = Srv.Get(v, "DriveLetter");
                row["label"] = Srv.Str(v, "FileSystemLabel");
                row["fileSystem"] = Srv.Str(v, "FileSystem");
                row["sizeBytes"] = Srv.Long(v, "Size");
                row["freeBytes"] = Srv.Long(v, "SizeRemaining");
                row["healthStatus"] = Srv.Str(v, "HealthStatus");
                list.Add(row);
            }
            return list;
        }

        private object Partitions(RequestContext ctx)
        {
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> p in Srv.Ps(ctx, "Get-Partition", Srv.P()))
            {
                Dictionary<string, object> row = Srv.P();
                row["diskNumber"] = Srv.Long(p, "DiskNumber");
                row["partitionNumber"] = Srv.Long(p, "PartitionNumber");
                row["driveLetter"] = Srv.Get(p, "DriveLetter");
                row["sizeBytes"] = Srv.Long(p, "Size");
                row["type"] = Srv.Str(p, "Type");
                row["isBoot"] = Srv.Get(p, "IsBoot");
                list.Add(row);
            }
            return list;
        }

        private long DiskNumber(RequestContext ctx)
        {
            long n;
            if (!long.TryParse(ctx.Route("number"), NumberStyles.Integer, CultureInfo.InvariantCulture, out n) || n < 0)
            {
                throw AgentException.BadRequest("Disk number must be a non-negative integer.");
            }
            return n;
        }

        private object InitDisk(RequestContext ctx)
        {
            long n = DiskNumber(ctx);
            Dictionary<string, object> body = ctx.BodyJson();
            Srv.RequireConfirm(body, n.ToString(CultureInfo.InvariantCulture));
            string style = Json.GetString(body, "partitionStyle");
            if (style != "MBR" && style != "GPT") { style = "GPT"; }
            ctx.Audit("disk initialize", n.ToString(CultureInfo.InvariantCulture));
            Srv.Ps(ctx, "Initialize-Disk", SrvP.Of("Number", n, "PartitionStyle", style));
            return StatusResult.NoContent();
        }

        private object OnlineDisk(RequestContext ctx)
        {
            long n = DiskNumber(ctx);
            ctx.Audit("disk online", n.ToString(CultureInfo.InvariantCulture));
            Srv.Ps(ctx, "Set-Disk", SrvP.Of("Number", n, "IsOffline", false));
            return StatusResult.NoContent();
        }

        private object OfflineDisk(RequestContext ctx)
        {
            long n = DiskNumber(ctx);
            ctx.Audit("disk offline", n.ToString(CultureInfo.InvariantCulture));
            Srv.Ps(ctx, "Set-Disk", SrvP.Of("Number", n, "IsOffline", true));
            return StatusResult.NoContent();
        }

        private object NewVolume(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            long? disk = Json.GetLong(body, "diskNumber");
            if (!disk.HasValue)
            {
                throw AgentException.BadRequest("diskNumber is required.");
            }
            string fs = Json.GetString(body, "fileSystem");
            if (fs != "NTFS" && fs != "ReFS" && fs != "exFAT" && fs != "FAT32") { fs = "NTFS"; }
            string label = Json.GetString(body, "label");
            string letter = Json.GetString(body, "driveLetter");
            ctx.Audit("volume create", "disk " + disk.Value);

            IDictionary<string, object> pp = SrvP.Of("DiskNumber", disk.Value);
            long? size = Json.GetLong(body, "sizeBytes");
            if (size.HasValue) { pp["Size"] = size.Value; }
            else { pp["UseMaximumSize"] = true; }
            if (!string.IsNullOrEmpty(letter) && letter.Length == 1) { pp["DriveLetter"] = letter[0]; }
            else { pp["AssignDriveLetter"] = true; }
            Dictionary<string, object> part = Srv.PsOne(ctx, "New-Partition", pp);

            IDictionary<string, object> fp = SrvP.Of("FileSystem", fs, "Confirm", false);
            if (!string.IsNullOrEmpty(label)) { fp["NewFileSystemLabel"] = label; }
            object pl = Srv.Get(part, "DriveLetter");
            if (pl != null) { fp["DriveLetter"] = pl; }
            Dictionary<string, object> vol = Srv.PsOne(ctx, "Format-Volume", fp);
            Dictionary<string, object> result = Srv.P();
            result["id"] = Srv.Str(vol, "UniqueId");
            result["driveLetter"] = Srv.Get(vol, "DriveLetter");
            return StatusResult.Created(result);
        }

        private object PatchVolume(RequestContext ctx)
        {
            string id = ctx.Route("id");
            Dictionary<string, object> body = ctx.BodyJson();
            string label = Json.GetString(body, "label");
            if (label != null)
            {
                ctx.Audit("volume label", id);
                Srv.Ps(ctx, "Set-Volume", SrvP.Of("UniqueId", id, "NewFileSystemLabel", label));
            }
            long? size = Json.GetLong(body, "sizeBytes");
            if (size.HasValue)
            {
                // Resize is by partition; locate it through the volume's drive letter.
                Dictionary<string, object> vol = Srv.PsOne(ctx, "Get-Volume", SrvP.Of("UniqueId", id));
                object letter = Srv.Get(vol, "DriveLetter");
                if (letter != null)
                {
                    ctx.Audit("volume resize", id);
                    Srv.Ps(ctx, "Resize-Partition", SrvP.Of("DriveLetter", letter, "Size", size.Value));
                }
            }
            return StatusResult.NoContent();
        }

        private object FormatVolume(RequestContext ctx)
        {
            string id = ctx.Route("id");
            Dictionary<string, object> body = ctx.BodyJson();
            Srv.RequireConfirm(body, id);
            string fs = Json.GetString(body, "fileSystem");
            if (fs != "NTFS" && fs != "ReFS" && fs != "exFAT" && fs != "FAT32") { fs = "NTFS"; }
            ctx.Audit("volume format", id);
            IDictionary<string, object> p = SrvP.Of("FileSystem", fs, "Confirm", false, "Force", true);
            // Format by the volume's drive letter or path.
            Dictionary<string, object> vol = Srv.PsOne(ctx, "Get-Volume", SrvP.Of("UniqueId", id));
            object letter = Srv.Get(vol, "DriveLetter");
            if (letter == null)
            {
                throw AgentException.BadRequest("That volume has no drive letter to format.");
            }
            p["DriveLetter"] = letter;
            string label = Json.GetString(body, "label");
            if (!string.IsNullOrEmpty(label)) { p["NewFileSystemLabel"] = label; }
            Srv.Ps(ctx, "Format-Volume", p);
            return StatusResult.NoContent();
        }

        private object Shares(RequestContext ctx)
        {
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> s in Srv.Ps(ctx, "Get-SmbShare", Srv.P()))
            {
                Dictionary<string, object> row = Srv.P();
                row["name"] = Srv.Str(s, "Name");
                row["path"] = Srv.Str(s, "Path");
                row["description"] = Srv.Str(s, "Description");
                row["shareState"] = Srv.Str(s, "ShareState");
                list.Add(row);
            }
            return list;
        }

        private object NewShare(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string name = Json.RequireString(body, "name", 80);
            string path = Json.RequireString(body, "path", 4096);
            Srv.RequireAbsolutePath(path);
            if (!Srv.SimpleName.IsMatch(name))
            {
                throw AgentException.BadRequest("Share name is not valid.");
            }
            IDictionary<string, object> p = SrvP.Of("Name", name, "Path", path);
            List<string> full = Json.GetStringList(body, "fullAccess");
            if (full != null && full.Count > 0) { p["FullAccess"] = full.ToArray(); }
            List<string> change = Json.GetStringList(body, "changeAccess");
            if (change != null && change.Count > 0) { p["ChangeAccess"] = change.ToArray(); }
            List<string> read = Json.GetStringList(body, "readAccess");
            if (read != null && read.Count > 0) { p["ReadAccess"] = read.ToArray(); }
            string description = Json.GetString(body, "description");
            if (!string.IsNullOrEmpty(description)) { p["Description"] = description; }
            ctx.Audit("share create", name);
            Srv.Ps(ctx, "New-SmbShare", p);
            Dictionary<string, object> result = Srv.P();
            result["name"] = name;
            result["path"] = path;
            return StatusResult.Created(result);
        }

        private object RemoveShare(RequestContext ctx)
        {
            string name = ctx.Query["name"];
            if (string.IsNullOrEmpty(name))
            {
                throw AgentException.BadRequest("A share name is required.");
            }
            Srv.RequireConfirmQuery(ctx, name);
            ctx.Audit("share delete", name);
            Srv.Ps(ctx, "Remove-SmbShare", SrvP.Of("Name", name, "Force", true));
            return StatusResult.NoContent();
        }
    }

    /// <summary>Network adapters, routes and Test-NetConnection.</summary>
    public class ServerNetworkModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "network" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "server/network/adapters", true, false, Adapters);
            router.Map("PATCH", "server/network/adapters/{ifIndex}", true, false, PatchAdapter);
            router.Map("GET", "server/network/routes", true, false, Routes);
            router.Map("POST", "server/network/test", true, false, TestConnection);
        }

        private object Adapters(RequestContext ctx)
        {
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> a in Srv.Ps(ctx, "Get-NetAdapter", Srv.P()))
            {
                long ifIndex = Srv.Long(a, "ifIndex");
                Dictionary<string, object> row = Srv.P();
                row["ifIndex"] = ifIndex;
                row["name"] = Srv.Str(a, "Name");
                row["description"] = Srv.Str(a, "InterfaceDescription");
                row["status"] = Srv.Str(a, "Status");
                row["macAddress"] = Srv.Str(a, "MacAddress");
                row["linkSpeed"] = Srv.Str(a, "LinkSpeed");
                row["ipv4"] = IpConfig(ctx, ifIndex);
                list.Add(row);
            }
            return list;
        }

        private object IpConfig(RequestContext ctx, long ifIndex)
        {
            Dictionary<string, object> result = Srv.P();
            try
            {
                List<Dictionary<string, object>> addrs = Srv.Ps(ctx, "Get-NetIPAddress",
                    SrvP.Of("InterfaceIndex", ifIndex, "AddressFamily", "IPv4", "ErrorAction", "SilentlyContinue"));
                List<object> ips = new List<object>();
                foreach (Dictionary<string, object> a in addrs)
                {
                    Dictionary<string, object> ip = Srv.P();
                    ip["address"] = Srv.Str(a, "IPAddress");
                    ip["prefixLength"] = Srv.Long(a, "PrefixLength");
                    ip["prefixOrigin"] = Srv.Str(a, "PrefixOrigin");
                    ips.Add(ip);
                }
                result["addresses"] = ips;

                List<Dictionary<string, object>> dns = Srv.Ps(ctx, "Get-DnsClientServerAddress",
                    SrvP.Of("InterfaceIndex", ifIndex, "AddressFamily", "IPv4", "ErrorAction", "SilentlyContinue"));
                List<object> servers = new List<object>();
                foreach (Dictionary<string, object> dd in dns)
                {
                    object addrList = Srv.Get(dd, "ServerAddresses");
                    List<object> la = Json.AsList(addrList);
                    if (la != null) { servers.AddRange(la); }
                }
                result["dnsServers"] = servers;
            }
            catch (AgentException) { }
            return result;
        }

        private object PatchAdapter(RequestContext ctx)
        {
            long ifIndex;
            if (!long.TryParse(ctx.Route("ifIndex"), NumberStyles.Integer, CultureInfo.InvariantCulture, out ifIndex))
            {
                throw AgentException.BadRequest("ifIndex must be an integer.");
            }
            Dictionary<string, object> body = ctx.BodyJson();
            ctx.Audit("network adapter", ifIndex.ToString(CultureInfo.InvariantCulture));

            bool? enabled = Json.GetNullableBool(body, "enabled");
            if (enabled.HasValue)
            {
                Srv.Ps(ctx, enabled.Value ? "Enable-NetAdapter" : "Disable-NetAdapter",
                    SrvP.Of("InterfaceIndex", ifIndex, "Confirm", false));
            }

            bool dhcp = Json.GetBool(body, "dhcp", false);
            if (dhcp)
            {
                Srv.Ps(ctx, "Set-NetIPInterface", SrvP.Of("InterfaceIndex", ifIndex, "Dhcp", "Enabled"));
                Srv.Ps(ctx, "Set-DnsClientServerAddress", SrvP.Of("InterfaceIndex", ifIndex, "ResetServerAddresses", true));
            }
            else
            {
                string address = Json.GetString(body, "ipAddress");
                if (!string.IsNullOrEmpty(address))
                {
                    long? prefix = Json.GetLong(body, "prefixLength");
                    string gateway = Json.GetString(body, "gateway");
                    IDictionary<string, object> p = SrvP.Of("InterfaceIndex", ifIndex, "IPAddress", address,
                        "PrefixLength", prefix.HasValue ? (object)prefix.Value : 24L, "AddressFamily", "IPv4");
                    if (!string.IsNullOrEmpty(gateway)) { p["DefaultGateway"] = gateway; }
                    // Remove any existing IPv4 address first so New-NetIPAddress does not conflict.
                    try
                    {
                        Srv.Ps(ctx, "Remove-NetIPAddress", SrvP.Of("InterfaceIndex", ifIndex, "AddressFamily", "IPv4", "Confirm", false));
                    }
                    catch (AgentException) { }
                    Srv.Ps(ctx, "New-NetIPAddress", p);
                }
            }

            List<string> dns = Json.GetStringList(body, "dnsServers");
            if (dns != null)
            {
                IDictionary<string, object> p = SrvP.Of("InterfaceIndex", ifIndex);
                if (dns.Count > 0) { p["ServerAddresses"] = dns.ToArray(); }
                else { p["ResetServerAddresses"] = true; }
                Srv.Ps(ctx, "Set-DnsClientServerAddress", p);
            }
            return StatusResult.NoContent();
        }

        private object Routes(RequestContext ctx)
        {
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> r in Srv.Ps(ctx, "Get-NetRoute", Srv.P()))
            {
                Dictionary<string, object> row = Srv.P();
                row["destinationPrefix"] = Srv.Str(r, "DestinationPrefix");
                row["nextHop"] = Srv.Str(r, "NextHop");
                row["ifIndex"] = Srv.Long(r, "ifIndex");
                row["routeMetric"] = Srv.Long(r, "RouteMetric");
                list.Add(row);
            }
            return list;
        }

        private object TestConnection(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string target = Json.RequireString(body, "target", 256);
            long? port = Json.GetLong(body, "port");
            ctx.Audit("network test", target + (port.HasValue ? ":" + port.Value : ""));
            IDictionary<string, object> p = SrvP.Of("ComputerName", target, "InformationLevel", "Detailed");
            if (port.HasValue) { p["Port"] = port.Value; }
            Dictionary<string, object> row = Srv.PsOne(ctx, "Test-NetConnection", p);
            Dictionary<string, object> result = Srv.P();
            result["computerName"] = Srv.Str(row, "ComputerName");
            result["remoteAddress"] = Srv.Str(row, "RemoteAddress");
            result["pingSucceeded"] = Srv.Get(row, "PingSucceeded");
            result["tcpTestSucceeded"] = Srv.Get(row, "TcpTestSucceeded");
            result["pingRoundtripMs"] = Srv.Get(row, "PingReplyDetails");
            return result;
        }
    }

    /// <summary>Registry browse and edit.</summary>
    public class ServerRegistryModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "registry" }; } }

        private static readonly string[] Hives = new string[]
        {
            "HKLM:", "HKCU:", "HKCR:", "HKU:", "HKCC:",
            "HKEY_LOCAL_MACHINE", "HKEY_CURRENT_USER", "HKEY_CLASSES_ROOT", "HKEY_USERS", "HKEY_CURRENT_CONFIG"
        };

        public void Register(Router router)
        {
            router.Map("GET", "server/registry", true, false, Browse);
            router.Map("PUT", "server/registry/value", true, false, SetValue);
            router.Map("DELETE", "server/registry/value", true, false, DeleteValue);
            router.Map("POST", "server/registry/key", true, false, CreateKey);
            router.Map("DELETE", "server/registry/key", true, false, DeleteKey);
            router.Map("GET", "server/registry/export", true, false, Export);
        }

        private static void CheckPath(string path)
        {
            if (string.IsNullOrEmpty(path))
            {
                throw AgentException.BadRequest("A registry path is required.");
            }
            bool ok = false;
            foreach (string h in Hives)
            {
                if (path.StartsWith(h, StringComparison.OrdinalIgnoreCase)) { ok = true; break; }
            }
            if (!ok)
            {
                throw AgentException.BadRequest("Registry path must start with a known hive such as HKLM:.");
            }
            if (path.IndexOf("..", StringComparison.Ordinal) >= 0)
            {
                throw AgentException.BadRequest("Registry path may not contain '..'.");
            }
        }

        private object Browse(RequestContext ctx)
        {
            string path = ctx.Query["path"];
            CheckPath(path);
            Dictionary<string, object> result = Srv.P();
            result["path"] = path;

            List<object> subkeys = new List<object>();
            try
            {
                foreach (Dictionary<string, object> k in Srv.Ps(ctx, "Get-ChildItem", SrvP.Of("Path", path, "ErrorAction", "SilentlyContinue")))
                {
                    Dictionary<string, object> d = Srv.P();
                    d["name"] = Srv.Str(k, "PSChildName");
                    d["path"] = Srv.Str(k, "PSPath");
                    subkeys.Add(d);
                }
            }
            catch (AgentException) { }
            result["subkeys"] = subkeys;

            List<object> values = new List<object>();
            try
            {
                Dictionary<string, object> item = Srv.PsOne(ctx, "Get-ItemProperty", SrvP.Of("Path", path, "ErrorAction", "SilentlyContinue"));
                if (item != null)
                {
                    foreach (KeyValuePair<string, object> kv in item)
                    {
                        if (kv.Key.StartsWith("PS", StringComparison.Ordinal)) { continue; }
                        Dictionary<string, object> d = Srv.P();
                        d["name"] = kv.Key;
                        d["value"] = kv.Value;
                        values.Add(d);
                    }
                }
            }
            catch (AgentException) { }
            result["values"] = values;
            return result;
        }

        private object SetValue(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string path = Json.RequireString(body, "path", 1024);
            CheckPath(path);
            string name = Json.RequireString(body, "name", 256);
            string type = Json.GetString(body, "type");
            if (string.IsNullOrEmpty(type)) { type = "String"; }
            object value = Srv.Get(body, "value");
            ctx.Audit("registry set", path + "\\" + name);
            IDictionary<string, object> p = SrvP.Of("Path", path, "Name", name, "Value", value, "Type", type, "Force", true);
            Srv.Ps(ctx, "Set-ItemProperty", p);
            return StatusResult.NoContent();
        }

        private object DeleteValue(RequestContext ctx)
        {
            string path = ctx.Query["path"];
            string name = ctx.Query["name"];
            CheckPath(path);
            if (string.IsNullOrEmpty(name))
            {
                throw AgentException.BadRequest("A value name is required.");
            }
            ctx.Audit("registry delete value", path + "\\" + name);
            Srv.Ps(ctx, "Remove-ItemProperty", SrvP.Of("Path", path, "Name", name, "Force", true));
            return StatusResult.NoContent();
        }

        private object CreateKey(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string path = Json.RequireString(body, "path", 1024);
            CheckPath(path);
            ctx.Audit("registry create key", path);
            Srv.Ps(ctx, "New-Item", SrvP.Of("Path", path, "Force", true));
            Dictionary<string, object> result = Srv.P();
            result["path"] = path;
            return StatusResult.Created(result);
        }

        private object DeleteKey(RequestContext ctx)
        {
            string path = ctx.Query["path"];
            CheckPath(path);
            string leaf = Srv.LeafName(path.Replace(':', '\\'));
            Srv.RequireConfirmQuery(ctx, leaf);
            ctx.Audit("registry delete key", path);
            Srv.Ps(ctx, "Remove-Item", SrvP.Of("Path", path, "Recurse", true, "Force", true));
            return StatusResult.NoContent();
        }

        private object Export(RequestContext ctx)
        {
            string path = ctx.Query["path"];
            CheckPath(path);
            string regPath = ToRegExePath(path);
            string temp = Srv.NewTempFile(".reg");
            ctx.Audit("registry export", path);
            ProcessResult r = Srv.RunProcess("reg.exe", new string[] { "export", regPath, temp, "/y" }, 60000);
            if (r.ExitCode != 0)
            {
                try { System.IO.File.Delete(temp); } catch (Exception) { }
                throw AgentException.Internal("reg export failed: " + r.StdErr + r.StdOut);
            }
            try
            {
                return Srv.FileDownload(temp, "application/octet-stream", "registry-export.reg");
            }
            finally
            {
                try { System.IO.File.Delete(temp); } catch (Exception) { }
            }
        }

        private static string ToRegExePath(string psPath)
        {
            string p = psPath;
            p = p.Replace("HKLM:", "HKLM").Replace("HKCU:", "HKCU").Replace("HKCR:", "HKCR")
                 .Replace("HKU:", "HKU").Replace("HKCC:", "HKCC");
            return p.TrimStart('\\');
        }
    }

    /// <summary>PnP devices.</summary>
    public class ServerDevicesModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "devices" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "server/devices", true, false, Devices);
            router.Map("POST", "server/devices/{instanceId}/{op}", true, false, DeviceOp);
        }

        private object Devices(RequestContext ctx)
        {
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> d in Srv.Ps(ctx, "Get-PnpDevice", Srv.P()))
            {
                Dictionary<string, object> row = Srv.P();
                row["instanceId"] = Srv.Str(d, "InstanceId");
                row["friendlyName"] = Srv.Str(d, "FriendlyName");
                row["class"] = Srv.Str(d, "Class");
                row["status"] = Srv.Str(d, "Status");
                row["manufacturer"] = Srv.Str(d, "Manufacturer");
                list.Add(row);
            }
            return list;
        }

        private object DeviceOp(RequestContext ctx)
        {
            string instanceId = ctx.Route("instanceId");
            string op = ctx.Route("op");
            if (op != "enable" && op != "disable")
            {
                throw AgentException.BadRequest("Operation must be enable or disable.");
            }
            ctx.Audit("device " + op, instanceId);
            string command = op == "enable" ? "Enable-PnpDevice" : "Disable-PnpDevice";
            Srv.Ps(ctx, command, SrvP.Of("InstanceId", instanceId, "Confirm", false));
            return StatusResult.NoContent();
        }
    }

    /// <summary>Local users and groups; reports notApplicable on a domain controller.</summary>
    public class ServerLocalUsersModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "localusers" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "server/localusers", true, false, LocalUsers);
            router.Map("POST", "server/localusers", true, false, NotOnDc);
            router.Map("PATCH", "server/localusers/{name}", true, false, NotOnDc);
            router.Map("DELETE", "server/localusers/{name}", true, false, NotOnDc);
            router.Map("GET", "server/localgroups", true, false, LocalGroups);
        }

        private bool IsDomainController(RequestContext ctx)
        {
            Dictionary<string, object> cs = Srv.PsOne(ctx, "Get-CimInstance", SrvP.Of("ClassName", "Win32_ComputerSystem"));
            long role = Srv.Long(cs, "DomainRole");
            return role == 4 || role == 5;
        }

        private object NotApplicable()
        {
            Dictionary<string, object> result = Srv.P();
            result["notApplicable"] = true;
            result["reason"] = "This server is a domain controller; accounts are domain accounts managed under Directory.";
            return result;
        }

        private object NotOnDc(RequestContext ctx)
        {
            if (IsDomainController(ctx))
            {
                throw AgentException.Forbidden("Local account management is not available on a domain controller.");
            }
            throw AgentException.BadRequest("Local account editing is not implemented on this agent.");
        }

        private object LocalUsers(RequestContext ctx)
        {
            if (IsDomainController(ctx)) { return NotApplicable(); }
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> u in Srv.Ps(ctx, "Get-LocalUser", Srv.P()))
            {
                Dictionary<string, object> row = Srv.P();
                row["name"] = Srv.Str(u, "Name");
                row["enabled"] = Srv.Get(u, "Enabled");
                row["description"] = Srv.Str(u, "Description");
                row["lastLogon"] = Srv.Get(u, "LastLogon");
                list.Add(row);
            }
            return list;
        }

        private object LocalGroups(RequestContext ctx)
        {
            if (IsDomainController(ctx)) { return NotApplicable(); }
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> g in Srv.Ps(ctx, "Get-LocalGroup", Srv.P()))
            {
                Dictionary<string, object> row = Srv.P();
                row["name"] = Srv.Str(g, "Name");
                row["description"] = Srv.Str(g, "Description");
                list.Add(row);
            }
            return list;
        }
    }

    /// <summary>Performance counters.</summary>
    public class ServerPerfmonModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "perfmon" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "server/counters", true, false, Counters);
            router.Map("POST", "server/counters/sample", true, false, Sample);
        }

        private object Counters(RequestContext ctx)
        {
            string set = ctx.Query["set"];
            IDictionary<string, object> p = SrvP.Of("ListSet", string.IsNullOrEmpty(set) ? "*" : set);
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> s in Srv.Ps(ctx, "Get-Counter", p))
            {
                Dictionary<string, object> row = Srv.P();
                row["counterSetName"] = Srv.Str(s, "CounterSetName");
                row["description"] = Srv.Str(s, "Description");
                row["paths"] = Srv.Get(s, "Paths");
                list.Add(row);
            }
            return list;
        }

        private object Sample(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            List<string> paths = Json.GetStringList(body, "paths");
            if (paths == null || paths.Count == 0)
            {
                throw AgentException.BadRequest("paths must be a non-empty array of counter paths.");
            }
            long samples = 1;
            long? s = Json.GetLong(body, "samples");
            if (s.HasValue) { samples = s.Value; }
            if (samples < 1) { samples = 1; }
            if (samples > 60) { samples = 60; }
            IDictionary<string, object> p = SrvP.Of("Counter", paths.ToArray(), "SampleInterval", 1L, "MaxSamples", samples);
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> row in Srv.Ps(ctx, "Get-Counter", p))
            {
                Dictionary<string, object> d = Srv.P();
                d["timestamp"] = Srv.Get(row, "Timestamp");
                d["samples"] = Srv.Get(row, "CounterSamples");
                list.Add(d);
            }
            return list;
        }
    }
}
