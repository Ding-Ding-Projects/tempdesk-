using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace TempDesk.Agent
{
    /// <summary>
    /// Wi-Fi profiles: WLANProfile v1 XML written to the SYSVOL wifi path, plus
    /// a sibling JSON metadata file that never contains the key. The GET list
    /// reads the metadata only, so keys are never returned. The actual XML is
    /// consumed by client machines, not this API.
    /// </summary>
    public class WifiService : IAgentModule
    {
        private readonly AgentConfig _config;
        private static readonly Regex IdPattern = new Regex("^[a-z0-9-]{1,40}$", RegexOptions.Compiled);

        public WifiService(AgentConfig config)
        {
            _config = config;
        }

        public string[] Capabilities { get { return new string[] { "wifi" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "wifi", true, false, List);
            router.Map("PUT", "wifi/{id}", true, false, Put);
            router.Map("DELETE", "wifi/{id}", true, false, Delete);
        }

        private string WifiDir()
        {
            if (string.IsNullOrEmpty(_config.WifiPath))
            {
                throw AgentException.Internal("wifiPath is not configured.");
            }
            return _config.WifiPath;
        }

        private object List(RequestContext ctx)
        {
            string dir = WifiDir();
            List<object> result = new List<object>();
            if (!Directory.Exists(dir))
            {
                return result;
            }
            foreach (string file in Directory.GetFiles(dir, "*.json"))
            {
                try
                {
                    Dictionary<string, object> meta = Json.ParseObject(File.ReadAllText(file, Encoding.UTF8));
                    Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                    row["id"] = Path.GetFileNameWithoutExtension(file);
                    row["ssid"] = Json.GetString(meta, "ssid");
                    row["auth"] = Json.GetString(meta, "auth");
                    row["hidden"] = Json.GetBool(meta, "hidden", false);
                    row["autoConnect"] = Json.GetBool(meta, "autoConnect", true);
                    result.Add(row);
                }
                catch (Exception)
                {
                    // Skip unreadable metadata files.
                }
            }
            return result;
        }

        private object Put(RequestContext ctx)
        {
            string id = ctx.Route("id");
            if (!IdPattern.IsMatch(id))
            {
                throw AgentException.BadRequest("Wi-Fi id must match ^[a-z0-9-]{1,40}$.");
            }
            Dictionary<string, object> body = ctx.BodyJson();
            string ssid = Json.RequireString(body, "ssid", 64);
            string auth = Json.RequireString(body, "auth", 16);
            string key = Json.GetString(body, "key");
            bool hidden = Json.GetBool(body, "hidden", false);
            bool autoConnect = Json.GetBool(body, "autoConnect", true);

            if (!IsKnownAuth(auth))
            {
                throw AgentException.BadRequest("auth must be WPA2PSK, WPA3SAE or open.");
            }
            bool needsKey = !string.Equals(auth, "open", StringComparison.OrdinalIgnoreCase);
            if (needsKey && string.IsNullOrEmpty(key))
            {
                throw AgentException.BadRequest("A key is required for " + auth + ".");
            }

            string dir = WifiDir();
            Directory.CreateDirectory(dir);

            string xml = BuildProfileXml(ssid, auth, key, hidden, autoConnect);
            // WLAN profile XML is UTF-8; write without a BOM to match the schema.
            File.WriteAllText(Path.Combine(dir, id + ".xml"), xml, new UTF8Encoding(false));

            // Metadata holds everything except the key.
            Dictionary<string, object> meta = new Dictionary<string, object>(StringComparer.Ordinal);
            meta["id"] = id;
            meta["ssid"] = ssid;
            meta["auth"] = auth;
            meta["hidden"] = hidden;
            meta["autoConnect"] = autoConnect;
            File.WriteAllText(Path.Combine(dir, id + ".json"), Json.Serialize(meta), new UTF8Encoding(false));

            ctx.Audit("wifi put", id);
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["id"] = id;
            result["ssid"] = ssid;
            result["auth"] = auth;
            result["hidden"] = hidden;
            result["autoConnect"] = autoConnect;
            return result;
        }

        private object Delete(RequestContext ctx)
        {
            string id = ctx.Route("id");
            if (!IdPattern.IsMatch(id))
            {
                throw AgentException.BadRequest("Wi-Fi id must match ^[a-z0-9-]{1,40}$.");
            }
            string dir = WifiDir();
            TryDelete(Path.Combine(dir, id + ".xml"));
            TryDelete(Path.Combine(dir, id + ".json"));
            ctx.Audit("wifi delete", id);
            return StatusResult.NoContent();
        }

        private static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path)) { File.Delete(path); }
            }
            catch (Exception)
            {
            }
        }

        private static bool IsKnownAuth(string auth)
        {
            return string.Equals(auth, "WPA2PSK", StringComparison.OrdinalIgnoreCase)
                || string.Equals(auth, "WPA3SAE", StringComparison.OrdinalIgnoreCase)
                || string.Equals(auth, "open", StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Builds a WLANProfile v1 document. PSK uses sharedKey with
        /// keyMaterial, protected false. WPA3 SAE and WPA2 PSK map to the
        /// matching authentication element; open uses no security.
        /// </summary>
        private static string BuildProfileXml(string ssid, string auth, string key, bool hidden, bool autoConnect)
        {
            string ssidHex = ToHex(ssid);
            StringBuilder sb = new StringBuilder();
            sb.Append("<?xml version=\"1.0\"?>\r\n");
            sb.Append("<WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\">\r\n");
            sb.Append("  <name>").Append(Xml(ssid)).Append("</name>\r\n");
            sb.Append("  <SSIDConfig>\r\n");
            sb.Append("    <SSID>\r\n");
            sb.Append("      <hex>").Append(ssidHex).Append("</hex>\r\n");
            sb.Append("      <name>").Append(Xml(ssid)).Append("</name>\r\n");
            sb.Append("    </SSID>\r\n");
            if (hidden)
            {
                sb.Append("    <nonBroadcast>true</nonBroadcast>\r\n");
            }
            sb.Append("  </SSIDConfig>\r\n");
            sb.Append("  <connectionType>ESS</connectionType>\r\n");
            sb.Append("  <connectionMode>").Append(autoConnect ? "auto" : "manual").Append("</connectionMode>\r\n");
            sb.Append("  <MSM>\r\n");
            sb.Append("    <security>\r\n");
            sb.Append("      <authEncryption>\r\n");

            bool open = string.Equals(auth, "open", StringComparison.OrdinalIgnoreCase);
            if (open)
            {
                sb.Append("        <authentication>open</authentication>\r\n");
                sb.Append("        <encryption>none</encryption>\r\n");
                sb.Append("        <useOneX>false</useOneX>\r\n");
                sb.Append("      </authEncryption>\r\n");
            }
            else
            {
                bool sae = string.Equals(auth, "WPA3SAE", StringComparison.OrdinalIgnoreCase);
                sb.Append("        <authentication>").Append(sae ? "WPA3SAE" : "WPA2PSK").Append("</authentication>\r\n");
                sb.Append("        <encryption>AES</encryption>\r\n");
                sb.Append("        <useOneX>false</useOneX>\r\n");
                if (sae)
                {
                    sb.Append("        <transitionMode xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v4\">false</transitionMode>\r\n");
                }
                sb.Append("      </authEncryption>\r\n");
                sb.Append("      <sharedKey>\r\n");
                sb.Append("        <keyType>passPhrase</keyType>\r\n");
                sb.Append("        <protected>false</protected>\r\n");
                sb.Append("        <keyMaterial>").Append(Xml(key)).Append("</keyMaterial>\r\n");
                sb.Append("      </sharedKey>\r\n");
            }
            sb.Append("    </security>\r\n");
            sb.Append("  </MSM>\r\n");
            sb.Append("</WLANProfile>\r\n");
            return sb.ToString();
        }

        private static string ToHex(string s)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(s);
            StringBuilder sb = new StringBuilder(bytes.Length * 2);
            foreach (byte b in bytes)
            {
                sb.Append(b.ToString("X2", CultureInfo.InvariantCulture));
            }
            return sb.ToString();
        }

        private static string Xml(string s)
        {
            if (s == null) { return ""; }
            return s.Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;")
                    .Replace("\"", "&quot;").Replace("'", "&apos;");
        }
    }
}
