using System;
using System.Collections.Generic;
using System.DirectoryServices.ActiveDirectory;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// The always-present core routes: health, public settings, the admin auth
    /// lifecycle (login, logout, confirm), the settings document, the guest GPO
    /// application allowlist, and the audit log reader.
    /// </summary>
    public class CoreService : IAgentModule
    {
        private readonly AgentConfig _config;
        private readonly Auth _auth;
        private readonly AuditLog _audit;
        private readonly Router _router; // for reading the merged capability list

        public const string Version = "1.0.0";

        public CoreService(AgentConfig config, Auth auth, AuditLog audit, Router router)
        {
            _config = config;
            _auth = auth;
            _audit = audit;
            _router = router;
        }

        // Core contributes no feature capability of its own; health reports the
        // union gathered from every other module.
        public string[] Capabilities { get { return new string[0]; } }

        public void Register(Router router)
        {
            router.Map("GET", "health", RouteAuth.Open, false, Health);
            router.Map("GET", "public/settings", RouteAuth.Open, false, PublicSettings);

            router.Map("POST", "auth/login", RouteAuth.Open, false, Login);
            // Logout and confirm need a valid admin key and bearer token, so they
            // are admin routes. The router resolves the session for us, but it
            // does not hand it to the handler, so we re-verify here to act on it.
            router.Map("POST", "auth/logout", true, false, Logout);
            router.Map("POST", "auth/confirm", true, false, Confirm);

            router.Map("GET", "settings", true, false, GetSettings);
            router.Map("PUT", "settings", true, false, PutSettings);

            router.Map("GET", "allowlist", true, false, GetAllowlist);
            router.Map("PUT", "allowlist", true, false, PutAllowlist);

            router.Map("GET", "audit", true, false, Audit);
        }

        // ---------------------------------------------------------------
        // Health and public settings
        // ---------------------------------------------------------------

        private object Health(RequestContext ctx)
        {
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["status"] = "ok";
            result["version"] = Version;
            result["backend"] = "windows";

            string domain = null;
            string dc = null;
            try
            {
                Domain d = Domain.GetCurrentDomain();
                domain = d.Name;
                DomainController controller = d.FindDomainController();
                dc = controller != null ? controller.Name : null;
            }
            catch (Exception)
            {
                // The agent may be queried before AD is reachable; report nulls.
                try { dc = Dns.GetHostName(); } catch (Exception) { }
            }
            result["domain"] = domain;
            result["dc"] = dc;
            result["time"] = Json.Iso(DateTime.UtcNow);
            // The Windows backend reports every capability except samba-tool.
            result["capabilities"] = _router.Capabilities;
            return result;
        }

        private object PublicSettings(RequestContext ctx)
        {
            Settings settings = Settings.Load(_config.SettingsPath, _config.DomainDn);
            return settings.PublicView();
        }

        // ---------------------------------------------------------------
        // Auth
        // ---------------------------------------------------------------

        private object Login(RequestContext ctx)
        {
            // Login is an open route but still requires the admin API key, since
            // only the admin portal may attempt sign-ins.
            string key = ctx.Request.Headers["X-TempDesk-Key"];
            if (!_auth.IsAdminKey(key))
            {
                throw AgentException.Unauthorized("The admin API key is required.");
            }
            Dictionary<string, object> body = ctx.BodyJson();
            string username = Json.GetString(body, "username");
            string password = Json.GetString(body, "password");
            Settings settings = Settings.Load(_config.SettingsPath, _config.DomainDn);

            SessionToken token = _auth.Login(username, password, settings.AdminGroup);
            _audit.Admin(token.Sam, "auth/login", "-");

            Dictionary<string, object> user = new Dictionary<string, object>(StringComparer.Ordinal);
            user["sam"] = token.Sam;
            user["displayName"] = token.DisplayName;

            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["token"] = _auth.Serialize(token);
            result["expiresAt"] = Json.Iso(token.ExpiresAt);
            result["user"] = user;
            return result;
        }

        private object Logout(RequestContext ctx)
        {
            SessionToken session = SessionFrom(ctx);
            if (session != null)
            {
                _auth.Revoke(session);
                ctx.Audit("auth/logout", session.Sam);
            }
            return StatusResult.NoContent();
        }

        private object Confirm(RequestContext ctx)
        {
            SessionToken session = SessionFrom(ctx);
            Dictionary<string, object> body = ctx.BodyJson();
            string password = Json.GetString(body, "password");
            Dictionary<string, object> result = _auth.Confirm(session, password);
            ctx.Audit("auth/confirm", ctx.ActingUser);
            return result;
        }

        /// <summary>
        /// Re-reads and verifies the bearer token so logout/confirm can act on
        /// the specific session. The router has already proven it is valid.
        /// </summary>
        private SessionToken SessionFrom(RequestContext ctx)
        {
            string header = ctx.Request.Headers["Authorization"];
            if (!string.IsNullOrEmpty(header) && header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            {
                return _auth.Verify(header.Substring(7).Trim());
            }
            return null;
        }

        // ---------------------------------------------------------------
        // Settings document
        // ---------------------------------------------------------------

        private object GetSettings(RequestContext ctx)
        {
            string text = File.ReadAllText(_config.SettingsPath, Encoding.UTF8);
            return Json.ParseObject(text);
        }

        private object PutSettings(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            if (body.Count == 0)
            {
                throw AgentException.BadRequest("Settings body is empty.");
            }
            // Write atomically: temp file then replace, so a crash cannot leave a
            // truncated settings document.
            string json = Json.Serialize(body);
            string dir = Path.GetDirectoryName(_config.SettingsPath);
            string temp = Path.Combine(dir, "settings.json.tmp");
            File.WriteAllText(temp, json, new UTF8Encoding(false));
            if (File.Exists(_config.SettingsPath))
            {
                File.Delete(_config.SettingsPath);
            }
            File.Move(temp, _config.SettingsPath);
            ctx.Audit("settings put", "-");
            return body;
        }

        // ---------------------------------------------------------------
        // Allowlist: the guest GPO RestrictRun user policy
        // ---------------------------------------------------------------
        //
        // HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer
        //   RestrictRun = DWORD 1 (enabled) or removed (disabled)
        // HKCU\...\Policies\Explorer\RestrictRun
        //   "1","2",... = app names
        //
        // We read and write these through the GroupPolicy cmdlets so the change
        // lands in the guest GPO exactly like the GUI would write it.

        private const string ExplorerKey =
            @"HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer";
        private const string RestrictRunKey = ExplorerKey + @"\RestrictRun";

        private object GetAllowlist(RequestContext ctx)
        {
            PowerShellHost ps = ctx.Ps;
            if (ps == null)
            {
                throw AgentException.Internal("PowerShell host is not available.");
            }
            Settings settings = Settings.Load(_config.SettingsPath, _config.DomainDn);
            string gpoName = settings.GuestGpoName;

            bool enabled = false;
            try
            {
                Dictionary<string, object> p = GpoParams(gpoName, ExplorerKey);
                p["ValueName"] = "RestrictRun";
                List<Dictionary<string, object>> flag = ps.Invoke("Get-GPRegistryValue", p);
                foreach (Dictionary<string, object> row in flag)
                {
                    object v;
                    if (row.TryGetValue("Value", out v) && v != null)
                    {
                        long asLong;
                        if (Json.TryToLong(v, out asLong) && asLong == 1) { enabled = true; }
                    }
                }
            }
            catch (Exception)
            {
                enabled = false;
            }

            List<object> apps = new List<object>();
            try
            {
                Dictionary<string, object> p = GpoParams(gpoName, RestrictRunKey);
                List<Dictionary<string, object>> values = ps.Invoke("Get-GPRegistryValue", p);
                foreach (Dictionary<string, object> row in values)
                {
                    object v;
                    if (row.TryGetValue("Value", out v) && v != null)
                    {
                        apps.Add(Convert.ToString(v, CultureInfo.InvariantCulture));
                    }
                }
            }
            catch (Exception)
            {
                // Key absent: no apps listed.
            }

            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["enabled"] = enabled;
            result["apps"] = apps;
            return result;
        }

        private object PutAllowlist(RequestContext ctx)
        {
            PowerShellHost ps = ctx.Ps;
            if (ps == null)
            {
                throw AgentException.Internal("PowerShell host is not available.");
            }
            Dictionary<string, object> body = ctx.BodyJson();
            bool enabled = Json.GetBool(body, "enabled", false);
            List<string> apps = Json.GetStringList(body, "apps");
            if (apps == null) { apps = new List<string>(); }

            Settings settings = Settings.Load(_config.SettingsPath, _config.DomainDn);
            string gpoName = settings.GuestGpoName;

            // Clear the existing numbered values so removed apps do not linger.
            try
            {
                Dictionary<string, object> clear = GpoParams(gpoName, RestrictRunKey);
                ps.Invoke("Remove-GPRegistryValue", clear);
            }
            catch (Exception)
            {
                // Nothing to clear yet.
            }

            if (enabled)
            {
                // Turn RestrictRun on.
                Dictionary<string, object> flag = GpoParams(gpoName, ExplorerKey);
                flag["ValueName"] = "RestrictRun";
                flag["Type"] = "DWord";
                flag["Value"] = 1;
                ps.Invoke("Set-GPRegistryValue", flag);

                // Write the numbered app list "1","2",...
                int index = 1;
                foreach (string app in apps)
                {
                    Dictionary<string, object> item = GpoParams(gpoName, RestrictRunKey);
                    item["ValueName"] = index.ToString(CultureInfo.InvariantCulture);
                    item["Type"] = "String";
                    item["Value"] = app;
                    ps.Invoke("Set-GPRegistryValue", item);
                    index++;
                }
            }
            else
            {
                // Remove the RestrictRun flag so the allowlist is off.
                try
                {
                    Dictionary<string, object> flag = GpoParams(gpoName, ExplorerKey);
                    flag["ValueName"] = "RestrictRun";
                    ps.Invoke("Remove-GPRegistryValue", flag);
                }
                catch (Exception)
                {
                }
            }

            ctx.Audit("allowlist put", "enabled=" + enabled + " count=" + apps.Count);
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["enabled"] = enabled;
            result["apps"] = apps;
            return result;
        }

        private static Dictionary<string, object> GpoParams(string gpoName, string key)
        {
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Name"] = gpoName;
            p["Key"] = key;
            return p;
        }

        // ---------------------------------------------------------------
        // Audit
        // ---------------------------------------------------------------

        private object Audit(RequestContext ctx)
        {
            int limit = DirectoryService.ParseInt(ctx.Query["limit"], 200);
            return _audit.Recent(limit);
        }
    }
}
