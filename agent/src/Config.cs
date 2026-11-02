using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// The agent.json configuration from C:\ProgramData\TempDesk\agent.json.
    /// Loaded once at startup. Not reloaded while running.
    /// </summary>
    public class AgentConfig
    {
        public int Port;
        public bool Tls;
        public string GuestKey;
        public string AdminKey;
        public byte[] HmacSecret;
        public string DomainDn;
        public string SettingsPath;
        public string WifiPath;
        public string ScriptsPath;
        public string BackupPath;

        public const string DefaultConfigPath = @"C:\ProgramData\TempDesk\agent.json";

        public static AgentConfig Load(string path)
        {
            if (!File.Exists(path))
            {
                throw new FileNotFoundException("Agent configuration not found: " + path);
            }
            string text = File.ReadAllText(path, Encoding.UTF8);
            Dictionary<string, object> d = Json.ParseObject(text);

            AgentConfig c = new AgentConfig();
            long? port = Json.GetLong(d, "port");
            c.Tls = Json.GetBool(d, "tls", false);
            c.Port = port.HasValue ? (int)port.Value : (c.Tls ? 8443 : 8080);
            c.GuestKey = Json.GetString(d, "guestKey");
            c.AdminKey = Json.GetString(d, "adminKey");
            string hmac = Json.GetString(d, "hmacSecret");
            c.HmacSecret = !string.IsNullOrEmpty(hmac) ? Convert.FromBase64String(hmac) : new byte[0];
            c.DomainDn = Json.GetString(d, "domainDn");
            c.SettingsPath = Json.GetString(d, "settingsPath");
            c.WifiPath = Json.GetString(d, "wifiPath");
            c.ScriptsPath = Json.GetString(d, "scriptsPath");
            c.BackupPath = Json.GetString(d, "backupPath");

            if (string.IsNullOrEmpty(c.GuestKey) || string.IsNullOrEmpty(c.AdminKey))
            {
                throw new InvalidOperationException("agent.json must define guestKey and adminKey.");
            }
            if (c.HmacSecret.Length < 16)
            {
                throw new InvalidOperationException("agent.json hmacSecret must be at least 16 bytes (base64).");
            }
            if (string.IsNullOrEmpty(c.DomainDn))
            {
                throw new InvalidOperationException("agent.json must define domainDn.");
            }
            if (string.IsNullOrEmpty(c.SettingsPath))
            {
                c.SettingsPath = @"C:\ProgramData\TempDesk\settings.json";
            }
            return c;
        }

        /// <summary>The HttpListener prefix, honoring the tls flag and port.</summary>
        public string ListenerPrefix()
        {
            string scheme = Tls ? "https" : "http";
            return scheme + "://+:" + Port + "/api/v1/";
        }
    }

    /// <summary>
    /// The TempDesk settings document (settings.json, shape of
    /// settings.default.json). Loaded on demand so admin edits take effect
    /// without a service restart. guestOu/computersOu are relative to the
    /// domain DN and are combined into absolute DNs by helper methods.
    /// </summary>
    public class Settings
    {
        public Dictionary<string, object> Raw;
        private readonly string _domainDn;

        private Settings(Dictionary<string, object> raw, string domainDn)
        {
            Raw = raw;
            _domainDn = domainDn;
        }

        public static Settings Load(string path, string domainDn)
        {
            string text = File.ReadAllText(path, Encoding.UTF8);
            Dictionary<string, object> raw = Json.ParseObject(text);
            return new Settings(raw, domainDn);
        }

        public string GetString(string key, string fallback)
        {
            string v = Json.GetString(Raw, key);
            return !string.IsNullOrEmpty(v) ? v : fallback;
        }

        public int GetInt(string key, int fallback)
        {
            long? v = Json.GetLong(Raw, key);
            return v.HasValue ? (int)v.Value : fallback;
        }

        public bool GetBool(string key, bool fallback)
        {
            return Json.GetBool(Raw, key, fallback);
        }

        public string UsernamePrefix { get { return GetString("usernamePrefix", "guest-"); } }
        public string GuestGroup { get { return GetString("guestGroup", "TempDesk Guests"); } }
        public string AdminGroup { get { return GetString("adminGroup", "TempDesk Admins"); } }
        public string GuestGpoName { get { return GetString("guestGpoName", "TempDesk - Guest User Policy"); } }
        public int PasswordLength { get { return GetInt("passwordLength", 14); } }
        public int GuestCreatePerHour { get { return GetInt("guestCreatePerHour", 20); } }
        public int GuestMaxActive { get { return GetInt("guestMaxActive", 200); } }
        public bool AllowPermanent { get { return GetBool("allowPermanent", true); } }
        public bool AllowSelfDelete { get { return GetBool("allowSelfDelete", true); } }

        /// <summary>Absolute DN of the guest OU: relative guestOu + domain DN.</summary>
        public string GuestOuDn()
        {
            return CombineRelative(GetString("guestOu", "OU=Guests,OU=TempDesk"));
        }

        public string ComputersOuDn()
        {
            return CombineRelative(GetString("computersOu", "OU=Computers,OU=TempDesk"));
        }

        private string CombineRelative(string relative)
        {
            if (string.IsNullOrEmpty(relative))
            {
                return _domainDn;
            }
            string trimmed = relative.TrimEnd(',', ' ');
            return trimmed + "," + _domainDn;
        }

        /// <summary>
        /// Resolves a minutes value from an expiryId against expiryChoices.
        /// Returns 0 for permanent. Throws bad_request for an unknown id.
        /// </summary>
        public int MinutesForExpiryId(string expiryId)
        {
            List<object> choices = Json.GetList(Raw, "expiryChoices");
            if (choices != null)
            {
                foreach (object item in choices)
                {
                    Dictionary<string, object> choice = item as Dictionary<string, object>;
                    if (choice == null) { continue; }
                    string id = Json.GetString(choice, "id");
                    if (string.Equals(id, expiryId, StringComparison.Ordinal))
                    {
                        long? minutes = Json.GetLong(choice, "minutes");
                        return minutes.HasValue ? (int)minutes.Value : 0;
                    }
                }
            }
            throw AgentException.BadRequest("Unknown expiryId '" + expiryId + "'.");
        }

        /// <summary>The guest-facing subset for /public/settings.</summary>
        public Dictionary<string, object> PublicView()
        {
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["orgName"] = GetString("orgName", "TempDesk");
            result["welcomeText"] = GetString("welcomeText", "");
            result["expiryChoices"] = Json.GetList(Raw, "expiryChoices");
            result["allowPermanent"] = AllowPermanent;
            result["allowSelfDelete"] = AllowSelfDelete;
            result["usernamePrefix"] = UsernamePrefix;
            return result;
        }
    }
}
