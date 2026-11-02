using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// Scheduled tasks: list, detail, structured create, run/end/enable/disable
    /// and delete. Triggers support daily, weekly, at startup, at logon and once.
    /// </summary>
    public class ServerTasksModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "tasks" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "server/tasks", true, false, ListTasks);
            router.Map("GET", "server/tasks/{path}/{name}", true, false, GetTask);
            router.Map("POST", "server/tasks", true, false, CreateTask);
            router.Map("POST", "server/tasks/{path}/{name}/{op}", true, false, TaskOp);
            router.Map("DELETE", "server/tasks/{path}/{name}", true, false, DeleteTask);
        }

        private static string DecodePath(string segment)
        {
            string p = segment;
            if (string.IsNullOrEmpty(p) || p == "root" || p == "-") { return "\\"; }
            if (!p.StartsWith("\\", StringComparison.Ordinal)) { p = "\\" + p; }
            if (!p.EndsWith("\\", StringComparison.Ordinal)) { p = p + "\\"; }
            return p;
        }

        private object ListTasks(RequestContext ctx)
        {
            string path = ctx.Query["path"];
            IDictionary<string, object> p = Srv.P();
            if (!string.IsNullOrEmpty(path)) { p["TaskPath"] = path; }
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> t in Srv.Ps(ctx, "Get-ScheduledTask", p))
            {
                Dictionary<string, object> row = Srv.P();
                row["name"] = Srv.Str(t, "TaskName");
                row["path"] = Srv.Str(t, "TaskPath");
                row["state"] = Srv.Str(t, "State");
                row["description"] = Srv.Str(t, "Description");
                list.Add(row);
            }
            return list;
        }

        private object GetTask(RequestContext ctx)
        {
            string path = DecodePath(ctx.Route("path"));
            string name = ctx.Route("name");
            Dictionary<string, object> t = Srv.PsOne(ctx, "Get-ScheduledTask", SrvP.Of("TaskPath", path, "TaskName", name));
            if (t == null)
            {
                throw AgentException.NotFound("No such scheduled task.");
            }
            Dictionary<string, object> row = Srv.P();
            row["name"] = Srv.Str(t, "TaskName");
            row["path"] = Srv.Str(t, "TaskPath");
            row["state"] = Srv.Str(t, "State");
            row["description"] = Srv.Str(t, "Description");
            row["actions"] = Srv.Get(t, "Actions");
            row["triggers"] = Srv.Get(t, "Triggers");
            row["settings"] = Srv.Get(t, "Settings");
            row["principal"] = Srv.Get(t, "Principal");
            try
            {
                Dictionary<string, object> info = Srv.PsOne(ctx, "Get-ScheduledTaskInfo", SrvP.Of("TaskPath", path, "TaskName", name));
                row["lastRunTime"] = Srv.Get(info, "LastRunTime");
                row["lastTaskResult"] = Srv.Get(info, "LastTaskResult");
                row["nextRunTime"] = Srv.Get(info, "NextRunTime");
            }
            catch (AgentException) { }
            return row;
        }

        private object CreateTask(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string name = Json.RequireString(body, "name", 200);
            string taskPath = Json.GetString(body, "path");
            if (string.IsNullOrEmpty(taskPath)) { taskPath = "\\"; }

            // Build action objects via New-ScheduledTaskAction (parameters only).
            List<object> actionObjects = new List<object>();
            List<object> actions = Json.GetList(body, "actions");
            if (actions == null || actions.Count == 0)
            {
                throw AgentException.BadRequest("At least one action is required.");
            }
            foreach (object ao in actions)
            {
                Dictionary<string, object> a = ao as Dictionary<string, object>;
                if (a == null) { continue; }
                string execute = Json.RequireString(a, "execute", 4096);
                IDictionary<string, object> ap = SrvP.Of("Execute", execute);
                string args = Json.GetString(a, "arguments");
                if (!string.IsNullOrEmpty(args)) { ap["Argument"] = args; }
                string workdir = Json.GetString(a, "workingDirectory");
                if (!string.IsNullOrEmpty(workdir)) { ap["WorkingDirectory"] = workdir; }
                Dictionary<string, object> actionObj = Srv.PsOne(ctx, "New-ScheduledTaskAction", ap);
                actionObjects.Add(Unwrap(actionObj));
            }

            // Build trigger objects.
            List<object> triggerObjects = new List<object>();
            List<object> triggers = Json.GetList(body, "triggers");
            if (triggers != null)
            {
                foreach (object to in triggers)
                {
                    Dictionary<string, object> trg = to as Dictionary<string, object>;
                    if (trg == null) { continue; }
                    triggerObjects.Add(Unwrap(BuildTrigger(ctx, trg)));
                }
            }

            // Principal.
            Dictionary<string, object> principal = Json.GetDict(body, "principal");
            string userId = principal != null ? Json.GetString(principal, "userId") : null;
            string logonType = principal != null ? Json.GetString(principal, "logonType") : null;
            string runLevel = principal != null ? Json.GetString(principal, "runLevel") : null;
            IDictionary<string, object> pp = Srv.P();
            if (string.IsNullOrEmpty(userId)) { userId = "SYSTEM"; }
            pp["UserId"] = userId;
            if (string.Equals(userId, "SYSTEM", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(userId, "LOCALSERVICE", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(userId, "NETWORKSERVICE", StringComparison.OrdinalIgnoreCase))
            {
                pp["LogonType"] = "ServiceAccount";
            }
            else if (!string.IsNullOrEmpty(logonType))
            {
                pp["LogonType"] = logonType;
            }
            if (!string.IsNullOrEmpty(runLevel)) { pp["RunLevel"] = runLevel; }
            Dictionary<string, object> principalObj = Srv.PsOne(ctx, "New-ScheduledTaskPrincipal", pp);

            // Settings.
            Dictionary<string, object> settingsObj = Srv.PsOne(ctx, "New-ScheduledTaskSettingsSet", Srv.P());

            // Register.
            IDictionary<string, object> reg = SrvP.Of(
                "TaskName", name, "TaskPath", taskPath,
                "Action", actionObjects.ToArray(),
                "Principal", Unwrap(principalObj),
                "Settings", Unwrap(settingsObj),
                "Force", true);
            if (triggerObjects.Count > 0) { reg["Trigger"] = triggerObjects.ToArray(); }
            string description = Json.GetString(body, "description");
            if (!string.IsNullOrEmpty(description)) { reg["Description"] = description; }

            ctx.Audit("task create", taskPath + name);
            Srv.Ps(ctx, "Register-ScheduledTask", reg);
            Dictionary<string, object> result = Srv.P();
            result["name"] = name;
            result["path"] = taskPath;
            return StatusResult.Created(result);
        }

        private Dictionary<string, object> BuildTrigger(RequestContext ctx, Dictionary<string, object> trg)
        {
            string type = Json.GetString(trg, "type");
            if (string.IsNullOrEmpty(type))
            {
                throw AgentException.BadRequest("Each trigger needs a type.");
            }
            switch (type.ToLowerInvariant())
            {
                case "daily":
                {
                    IDictionary<string, object> p = SrvP.Of("Daily", true);
                    string at = Json.GetString(trg, "at");
                    if (!string.IsNullOrEmpty(at)) { p["At"] = at; }
                    long? interval = Json.GetLong(trg, "daysInterval");
                    if (interval.HasValue) { p["DaysInterval"] = interval.Value; }
                    return Srv.PsOne(ctx, "New-ScheduledTaskTrigger", p);
                }
                case "weekly":
                {
                    IDictionary<string, object> p = SrvP.Of("Weekly", true);
                    string at = Json.GetString(trg, "at");
                    if (!string.IsNullOrEmpty(at)) { p["At"] = at; }
                    List<string> days = Json.GetStringList(trg, "daysOfWeek");
                    if (days != null && days.Count > 0) { p["DaysOfWeek"] = days.ToArray(); }
                    return Srv.PsOne(ctx, "New-ScheduledTaskTrigger", p);
                }
                case "atstartup":
                    return Srv.PsOne(ctx, "New-ScheduledTaskTrigger", SrvP.Of("AtStartup", true));
                case "atlogon":
                {
                    IDictionary<string, object> p = SrvP.Of("AtLogOn", true);
                    string user = Json.GetString(trg, "user");
                    if (!string.IsNullOrEmpty(user)) { p["User"] = user; }
                    return Srv.PsOne(ctx, "New-ScheduledTaskTrigger", p);
                }
                case "once":
                {
                    string at = Json.GetString(trg, "at");
                    if (string.IsNullOrEmpty(at))
                    {
                        throw AgentException.BadRequest("A 'once' trigger needs an 'at' time.");
                    }
                    return Srv.PsOne(ctx, "New-ScheduledTaskTrigger", SrvP.Of("Once", true, "At", at));
                }
                default:
                    throw AgentException.BadRequest("Unknown trigger type '" + type + "'.");
            }
        }

        private static object Unwrap(Dictionary<string, object> psoWrapper)
        {
            // New-ScheduledTask* returns a live object; our serializer wraps it as
            // a dictionary, but Register-ScheduledTask needs the live object. The
            // host's binder accepts the dictionary and rehydrates where it can; we
            // pass it through unchanged.
            return psoWrapper;
        }

        private object TaskOp(RequestContext ctx)
        {
            string path = DecodePath(ctx.Route("path"));
            string name = ctx.Route("name");
            string op = ctx.Route("op");
            string command;
            switch (op.ToLowerInvariant())
            {
                case "run": command = "Start-ScheduledTask"; break;
                case "end": command = "Stop-ScheduledTask"; break;
                case "enable": command = "Enable-ScheduledTask"; break;
                case "disable": command = "Disable-ScheduledTask"; break;
                default:
                    throw AgentException.BadRequest("Unknown task operation '" + op + "'.");
            }
            ctx.Audit("task " + op, path + name);
            Srv.Ps(ctx, command, SrvP.Of("TaskPath", path, "TaskName", name));
            return StatusResult.NoContent();
        }

        private object DeleteTask(RequestContext ctx)
        {
            string path = DecodePath(ctx.Route("path"));
            string name = ctx.Route("name");
            Srv.RequireConfirmQuery(ctx, name);
            ctx.Audit("task delete", path + name);
            Srv.Ps(ctx, "Unregister-ScheduledTask", SrvP.Of("TaskPath", path, "TaskName", name, "Confirm", false));
            return StatusResult.NoContent();
        }
    }

    /// <summary>Certificates: list, import, export, delete, self-signed.</summary>
    public class ServerCertificatesModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "certificates" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "server/certificates", true, false, ListCerts);
            router.Map("POST", "server/certificates/import", true, false, Import);
            router.Map("GET", "server/certificates/{thumbprint}/export", true, false, Export);
            router.Map("DELETE", "server/certificates/{thumbprint}", true, false, Delete);
            router.Map("POST", "server/certificates/selfsigned", true, false, SelfSigned);
        }

        private static string StorePath(string store)
        {
            if (string.IsNullOrEmpty(store)) { store = "LocalMachine\\My"; }
            if (store.IndexOfAny(new char[] { '/', '.', ' ' }) >= 0 || store.IndexOf("..", StringComparison.Ordinal) >= 0)
            {
                throw AgentException.BadRequest("Invalid store name.");
            }
            return "Cert:\\" + store.Replace("/", "\\");
        }

        private object ListCerts(RequestContext ctx)
        {
            string path = StorePath(ctx.Query["store"]);
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> c in Srv.Ps(ctx, "Get-ChildItem", SrvP.Of("Path", path)))
            {
                Dictionary<string, object> row = Srv.P();
                row["thumbprint"] = Srv.Str(c, "Thumbprint");
                row["subject"] = Srv.Str(c, "Subject");
                row["issuer"] = Srv.Str(c, "Issuer");
                row["notBefore"] = Srv.Get(c, "NotBefore");
                row["notAfter"] = Srv.Get(c, "NotAfter");
                row["hasPrivateKey"] = Srv.Get(c, "HasPrivateKey");
                list.Add(row);
            }
            return list;
        }

        private object Import(RequestContext ctx)
        {
            // Body: base64 file content and optional password and store. (The
            // portal reads the uploaded file and posts it as JSON here; the 1 MB
            // router cap is ample for a certificate.)
            Dictionary<string, object> body = ctx.BodyJson();
            string b64 = Json.RequireString(body, "content", 2 * 1024 * 1024);
            string store = ctx.Query["store"];
            if (string.IsNullOrEmpty(store)) { store = Json.GetString(body, "store"); }
            string password = Json.GetString(body, "password");
            bool isPfx = Json.GetBool(body, "pfx", password != null);

            byte[] bytes;
            try { bytes = Convert.FromBase64String(b64.StartsWith("b64:", StringComparison.Ordinal) ? b64.Substring(4) : b64); }
            catch (FormatException) { throw AgentException.BadRequest("content must be base64."); }

            string temp = Srv.NewTempFile(isPfx ? ".pfx" : ".cer");
            File.WriteAllBytes(temp, bytes);
            ctx.Audit("certificate import", store);
            try
            {
                IDictionary<string, object> p = SrvP.Of("FilePath", temp, "CertStoreLocation", StorePath(store));
                string command;
                if (isPfx)
                {
                    command = "Import-PfxCertificate";
                    if (!string.IsNullOrEmpty(password))
                    {
                        // Convert to a SecureString through the allowlisted helper.
                        Dictionary<string, object> sec = Srv.PsOne(ctx, "ConvertTo-SecureString",
                            SrvP.Of("String", password, "AsPlainText", true, "Force", true));
                        p["Password"] = Unwrap(sec);
                    }
                }
                else
                {
                    command = "Import-Certificate";
                }
                Dictionary<string, object> row = Srv.PsOne(ctx, command, p);
                Dictionary<string, object> result = Srv.P();
                result["thumbprint"] = Srv.Str(row, "Thumbprint");
                return StatusResult.Created(result);
            }
            finally
            {
                try { File.Delete(temp); } catch (Exception) { }
            }
        }

        private static object Unwrap(Dictionary<string, object> d) { return d; }

        private object Export(RequestContext ctx)
        {
            string thumb = ctx.Route("thumbprint");
            if (!Srv.Thumbprint.IsMatch(thumb))
            {
                throw AgentException.BadRequest("Invalid thumbprint.");
            }
            string store = ctx.Query["store"];
            string path = StorePath(store) + "\\" + thumb;
            string temp = Srv.NewTempFile(".cer");
            ctx.Audit("certificate export", thumb);
            try
            {
                Srv.Ps(ctx, "Export-Certificate", SrvP.Of("Cert", path, "FilePath", temp, "Type", "CERT"));
                return Srv.FileDownload(temp, "application/x-x509-ca-cert", thumb + ".cer");
            }
            finally
            {
                try { File.Delete(temp); } catch (Exception) { }
            }
        }

        private object Delete(RequestContext ctx)
        {
            string thumb = ctx.Route("thumbprint");
            if (!Srv.Thumbprint.IsMatch(thumb))
            {
                throw AgentException.BadRequest("Invalid thumbprint.");
            }
            Srv.RequireConfirmQuery(ctx, thumb);
            string store = ctx.Query["store"];
            string path = StorePath(store) + "\\" + thumb;
            ctx.Audit("certificate delete", thumb);
            Srv.Ps(ctx, "Remove-Item", SrvP.Of("Path", path, "Force", true, "DeleteKey", true));
            return StatusResult.NoContent();
        }

        private object SelfSigned(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            List<string> dnsNames = Json.GetStringList(body, "dnsNames");
            if (dnsNames == null || dnsNames.Count == 0)
            {
                throw AgentException.BadRequest("dnsNames must be a non-empty array.");
            }
            long years = 5;
            long? y = Json.GetLong(body, "years");
            if (y.HasValue) { years = y.Value; }
            if (years < 1 || years > 30) { throw AgentException.BadRequest("years must be 1 to 30."); }
            string store = ctx.Query["store"];
            ctx.Audit("certificate selfsigned", string.Join(",", dnsNames.ToArray()));

            // New-SelfSignedCertificate with -NotAfter computed as data.
            IDictionary<string, object> p = SrvP.Of(
                "DnsName", dnsNames.ToArray(),
                "CertStoreLocation", StorePath(string.IsNullOrEmpty(store) ? "LocalMachine\\My" : store),
                "NotAfter", DateTime.UtcNow.AddYears((int)years));
            Dictionary<string, object> row = Srv.PsOne(ctx, "New-SelfSignedCertificate", p);
            Dictionary<string, object> result = Srv.P();
            result["thumbprint"] = Srv.Str(row, "Thumbprint");
            result["subject"] = Srv.Str(row, "Subject");
            return StatusResult.Created(result);
        }
    }

    /// <summary>DNS server management through the DnsServer module.</summary>
    public class ServerDnsModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "dns" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "dns/zones", true, false, Zones);
            router.Map("POST", "dns/zones", true, false, CreateZone);
            router.Map("DELETE", "dns/zones", true, false, DeleteZone);
            router.Map("GET", "dns/zones/{zone}/records", true, false, Records);
            router.Map("POST", "dns/zones/{zone}/records", true, false, CreateRecord);
            router.Map("DELETE", "dns/zones/{zone}/records", true, false, DeleteRecord);
            router.Map("GET", "dns/forwarders", true, false, GetForwarders);
            router.Map("PUT", "dns/forwarders", true, false, SetForwarders);
            router.Map("POST", "dns/cache/clear", true, false, ClearCache);
        }

        private object Zones(RequestContext ctx)
        {
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> z in Srv.Ps(ctx, "Get-DnsServerZone", Srv.P()))
            {
                Dictionary<string, object> row = Srv.P();
                row["zoneName"] = Srv.Str(z, "ZoneName");
                row["zoneType"] = Srv.Str(z, "ZoneType");
                row["isDsIntegrated"] = Srv.Get(z, "IsDsIntegrated");
                row["isReverseLookupZone"] = Srv.Get(z, "IsReverseLookupZone");
                list.Add(row);
            }
            return list;
        }

        private object CreateZone(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string zone = Json.RequireString(body, "zoneName", 256);
            bool reverse = Json.GetBool(body, "reverse", false);
            ctx.Audit("dns zone create", zone);
            IDictionary<string, object> p = SrvP.Of("ReplicationScope", "Domain");
            if (reverse) { p["NetworkId"] = zone; }
            else { p["Name"] = zone; }
            Srv.Ps(ctx, "Add-DnsServerPrimaryZone", p);
            Dictionary<string, object> result = Srv.P();
            result["zoneName"] = zone;
            return StatusResult.Created(result);
        }

        private object DeleteZone(RequestContext ctx)
        {
            string zone = ctx.Query["zoneName"];
            if (string.IsNullOrEmpty(zone)) { throw AgentException.BadRequest("zoneName is required."); }
            Srv.RequireConfirmQuery(ctx, zone);
            ctx.Audit("dns zone delete", zone);
            Srv.Ps(ctx, "Remove-DnsServerZone", SrvP.Of("Name", zone, "Force", true));
            return StatusResult.NoContent();
        }

        private object Records(RequestContext ctx)
        {
            string zone = ctx.Route("zone");
            string type = ctx.Query["type"];
            IDictionary<string, object> p = SrvP.Of("ZoneName", zone);
            if (!string.IsNullOrEmpty(type)) { p["RRType"] = type; }
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> r in Srv.Ps(ctx, "Get-DnsServerResourceRecord", p))
            {
                Dictionary<string, object> row = Srv.P();
                row["hostName"] = Srv.Str(r, "HostName");
                row["recordType"] = Srv.Str(r, "RecordType");
                row["timeToLive"] = Srv.Get(r, "TimeToLive");
                row["recordData"] = Srv.Get(r, "RecordData");
                list.Add(row);
            }
            return list;
        }

        private static readonly string[] RecordTypes = new string[] { "A", "AAAA", "CNAME", "MX", "TXT", "PTR", "SRV" };

        private object CreateRecord(RequestContext ctx)
        {
            string zone = ctx.Route("zone");
            Dictionary<string, object> body = ctx.BodyJson();
            string type = Json.RequireString(body, "recordType", 8).ToUpperInvariant();
            if (Array.IndexOf(RecordTypes, type) < 0)
            {
                throw AgentException.BadRequest("recordType must be one of A, AAAA, CNAME, MX, TXT, PTR, SRV.");
            }
            string name = Json.RequireString(body, "name", 256);
            ctx.Audit("dns record create", zone + "/" + name + " " + type);
            IDictionary<string, object> p = SrvP.Of("ZoneName", zone, "Name", name);
            long? ttl = Json.GetLong(body, "ttlSeconds");
            if (ttl.HasValue) { p["TimeToLive"] = TimeSpan.FromSeconds(ttl.Value); }
            switch (type)
            {
                case "A": p["A"] = true; p["IPv4Address"] = Json.RequireString(body, "data", 64); break;
                case "AAAA": p["AAAA"] = true; p["IPv6Address"] = Json.RequireString(body, "data", 64); break;
                case "CNAME": p["CName"] = true; p["HostNameAlias"] = Json.RequireString(body, "data", 256); break;
                case "PTR": p["PTR"] = true; p["PtrDomainName"] = Json.RequireString(body, "data", 256); break;
                case "TXT": p["Txt"] = true; p["DescriptiveText"] = Json.RequireString(body, "data", 1024); break;
                case "MX":
                    p["MX"] = true;
                    p["MailExchange"] = Json.RequireString(body, "data", 256);
                    p["Preference"] = Json.GetLong(body, "preference").GetValueOrDefault(10);
                    break;
                case "SRV":
                    p["Srv"] = true;
                    p["DomainName"] = Json.RequireString(body, "data", 256);
                    p["Priority"] = Json.GetLong(body, "priority").GetValueOrDefault(0);
                    p["Weight"] = Json.GetLong(body, "weight").GetValueOrDefault(0);
                    p["Port"] = Json.GetLong(body, "port").GetValueOrDefault(0);
                    break;
            }
            Srv.Ps(ctx, "Add-DnsServerResourceRecord", p);
            return StatusResult.Created(Srv.P());
        }

        private object DeleteRecord(RequestContext ctx)
        {
            string zone = ctx.Route("zone");
            string name = ctx.Query["name"];
            string type = ctx.Query["recordType"];
            if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(type))
            {
                throw AgentException.BadRequest("name and recordType query values are required.");
            }
            Srv.RequireConfirmQuery(ctx, name);
            ctx.Audit("dns record delete", zone + "/" + name);
            IDictionary<string, object> p = SrvP.Of("ZoneName", zone, "Name", name, "RRType", type.ToUpperInvariant(), "Force", true);
            string data = ctx.Query["data"];
            if (!string.IsNullOrEmpty(data)) { p["RecordData"] = data; }
            Srv.Ps(ctx, "Remove-DnsServerResourceRecord", p);
            return StatusResult.NoContent();
        }

        private object GetForwarders(RequestContext ctx)
        {
            Dictionary<string, object> f = Srv.PsOne(ctx, "Get-DnsServerForwarder", Srv.P());
            Dictionary<string, object> result = Srv.P();
            result["ipAddresses"] = Srv.Get(f, "IPAddress");
            result["useRootHint"] = Srv.Get(f, "UseRootHint");
            return result;
        }

        private object SetForwarders(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            List<string> ips = Json.GetStringList(body, "ipAddresses");
            if (ips == null) { ips = new List<string>(); }
            ctx.Audit("dns forwarders", string.Join(",", ips.ToArray()));
            Srv.Ps(ctx, "Set-DnsServerForwarder", SrvP.Of("IPAddress", ips.ToArray()));
            return StatusResult.NoContent();
        }

        private object ClearCache(RequestContext ctx)
        {
            ctx.Audit("dns cache clear", "-");
            Srv.Ps(ctx, "Clear-DnsServerCache", SrvP.Of("Force", true));
            return StatusResult.NoContent();
        }
    }

    /// <summary>DHCP server management (only registered when the DHCP role is present).</summary>
    public class ServerDhcpModule : IAgentModule
    {
        public string[] Capabilities { get { return new string[] { "dhcp" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "dhcp/scopes", true, false, Scopes);
            router.Map("POST", "dhcp/scopes", true, false, CreateScope);
            router.Map("DELETE", "dhcp/scopes/{scopeId}", true, false, DeleteScope);
            router.Map("GET", "dhcp/scopes/{scopeId}/leases", true, false, Leases);
            router.Map("GET", "dhcp/scopes/{scopeId}/reservations", true, false, Reservations);
            router.Map("POST", "dhcp/scopes/{scopeId}/reservations", true, false, CreateReservation);
            router.Map("DELETE", "dhcp/scopes/{scopeId}/reservations/{ip}", true, false, DeleteReservation);
            router.Map("GET", "dhcp/scopes/{scopeId}/options", true, false, Options);
        }

        private object Scopes(RequestContext ctx)
        {
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> s in Srv.Ps(ctx, "Get-DhcpServerv4Scope", Srv.P()))
            {
                Dictionary<string, object> row = Srv.P();
                row["scopeId"] = Srv.Str(s, "ScopeId");
                row["name"] = Srv.Str(s, "Name");
                row["startRange"] = Srv.Str(s, "StartRange");
                row["endRange"] = Srv.Str(s, "EndRange");
                row["subnetMask"] = Srv.Str(s, "SubnetMask");
                row["state"] = Srv.Str(s, "State");
                list.Add(row);
            }
            return list;
        }

        private object CreateScope(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string name = Json.RequireString(body, "name", 200);
            string start = Json.RequireString(body, "startRange", 64);
            string end = Json.RequireString(body, "endRange", 64);
            string mask = Json.RequireString(body, "subnetMask", 64);
            ctx.Audit("dhcp scope create", name);
            Srv.Ps(ctx, "Add-DhcpServerv4Scope", SrvP.Of("Name", name, "StartRange", start, "EndRange", end, "SubnetMask", mask));
            return StatusResult.Created(Srv.P());
        }

        private object DeleteScope(RequestContext ctx)
        {
            string scopeId = ctx.Route("scopeId");
            Srv.RequireConfirmQuery(ctx, scopeId);
            ctx.Audit("dhcp scope delete", scopeId);
            Srv.Ps(ctx, "Remove-DhcpServerv4Scope", SrvP.Of("ScopeId", scopeId, "Force", true));
            return StatusResult.NoContent();
        }

        private object Leases(RequestContext ctx)
        {
            string scopeId = ctx.Route("scopeId");
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> l in Srv.Ps(ctx, "Get-DhcpServerv4Lease", SrvP.Of("ScopeId", scopeId)))
            {
                Dictionary<string, object> row = Srv.P();
                row["ipAddress"] = Srv.Str(l, "IPAddress");
                row["clientId"] = Srv.Str(l, "ClientId");
                row["hostName"] = Srv.Str(l, "HostName");
                row["addressState"] = Srv.Str(l, "AddressState");
                row["leaseExpiryTime"] = Srv.Get(l, "LeaseExpiryTime");
                list.Add(row);
            }
            return list;
        }

        private object Reservations(RequestContext ctx)
        {
            string scopeId = ctx.Route("scopeId");
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> r in Srv.Ps(ctx, "Get-DhcpServerv4Reservation", SrvP.Of("ScopeId", scopeId)))
            {
                Dictionary<string, object> row = Srv.P();
                row["ipAddress"] = Srv.Str(r, "IPAddress");
                row["clientId"] = Srv.Str(r, "ClientId");
                row["name"] = Srv.Str(r, "Name");
                list.Add(row);
            }
            return list;
        }

        private object CreateReservation(RequestContext ctx)
        {
            string scopeId = ctx.Route("scopeId");
            Dictionary<string, object> body = ctx.BodyJson();
            string ip = Json.RequireString(body, "ipAddress", 64);
            string clientId = Json.RequireString(body, "clientId", 64);
            ctx.Audit("dhcp reservation create", scopeId + " " + ip);
            IDictionary<string, object> p = SrvP.Of("ScopeId", scopeId, "IPAddress", ip, "ClientId", clientId);
            string name = Json.GetString(body, "name");
            if (!string.IsNullOrEmpty(name)) { p["Name"] = name; }
            Srv.Ps(ctx, "Add-DhcpServerv4Reservation", p);
            return StatusResult.Created(Srv.P());
        }

        private object DeleteReservation(RequestContext ctx)
        {
            string ip = ctx.Route("ip");
            Srv.RequireConfirmQuery(ctx, ip);
            ctx.Audit("dhcp reservation delete", ip);
            Srv.Ps(ctx, "Remove-DhcpServerv4Reservation", SrvP.Of("IPAddress", ip));
            return StatusResult.NoContent();
        }

        private object Options(RequestContext ctx)
        {
            string scopeId = ctx.Route("scopeId");
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> o in Srv.Ps(ctx, "Get-DhcpServerv4OptionValue", SrvP.Of("ScopeId", scopeId)))
            {
                Dictionary<string, object> row = Srv.P();
                row["optionId"] = Srv.Long(o, "OptionId");
                row["name"] = Srv.Str(o, "Name");
                row["value"] = Srv.Get(o, "Value");
                list.Add(row);
            }
            return list;
        }
    }
}
