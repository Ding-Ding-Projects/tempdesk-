using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// A Windows Defender Firewall rule as stored in Registry.pol under
    /// SOFTWARE\Policies\Microsoft\WindowsFirewall\FirewallRules: one REG_SZ
    /// value per rule, value name a GUID, data a "v2.x|Token=Value|..." string
    /// in the MS-GPFAS firewall rule grammar. This maps the documented tokens
    /// to and from the flat fields the portal edits. Unknown tokens on read are
    /// preserved so a round trip does not lose them.
    /// </summary>
    public class FirewallRule
    {
        public string Version = "2.30";
        public string Name;
        public string Description;
        public string Action;        // Allow | Block
        public string Direction;     // In | Out
        public bool Active = true;
        public string Protocol;
        public string LocalPorts;
        public string RemotePorts;
        public List<string> LocalAddresses = new List<string>();
        public List<string> RemoteAddresses = new List<string>();
        public string Application;
        public string Service;
        public string Profiles;      // "", Domain, Private, Public (comma-joined)
        public bool Edge;
        private readonly List<string> _extra = new List<string>();

        public static FirewallRule Parse(string id, string data)
        {
            FirewallRule r = new FirewallRule();
            string[] fields = data.Split('|');
            for (int i = 0; i < fields.Length; i++)
            {
                string f = fields[i];
                if (f.Length == 0) { continue; }
                if (i == 0 && f.StartsWith("v", StringComparison.OrdinalIgnoreCase)) { r.Version = f.Substring(1); continue; }
                int eq = f.IndexOf('=');
                if (eq < 0) { continue; }
                string k = f.Substring(0, eq);
                string v = f.Substring(eq + 1);
                switch (k)
                {
                    case "Action": r.Action = v; break;
                    case "Dir": r.Direction = v; break;
                    case "Active": r.Active = string.Equals(v, "TRUE", StringComparison.OrdinalIgnoreCase); break;
                    case "Protocol": r.Protocol = v; break;
                    case "LPort": r.LocalPorts = Append(r.LocalPorts, v); break;
                    case "RPort": r.RemotePorts = Append(r.RemotePorts, v); break;
                    case "LA4": case "LA6": r.LocalAddresses.Add(v); break;
                    case "RA4": case "RA6": r.RemoteAddresses.Add(v); break;
                    case "App": r.Application = v; break;
                    case "Svc": r.Service = v; break;
                    case "Profile": r.Profiles = Append(r.Profiles, v); break;
                    case "Edge": r.Edge = string.Equals(v, "TRUE", StringComparison.OrdinalIgnoreCase); break;
                    case "Name": r.Name = v; break;
                    case "Desc": r.Description = v; break;
                    default: r._extra.Add(f); break;
                }
            }
            return r;
        }

        public static FirewallRule FromBody(Dictionary<string, object> body)
        {
            FirewallRule r = new FirewallRule();
            r.Name = Json.GetString(body, "name");
            r.Description = Json.GetString(body, "description");
            r.Action = Json.GetString(body, "action") ?? "Allow";
            r.Direction = Json.GetString(body, "direction");
            r.Active = Json.GetBool(body, "active", true);
            r.Protocol = Json.GetString(body, "protocol");
            r.LocalPorts = Json.GetString(body, "localPorts");
            r.RemotePorts = Json.GetString(body, "remotePorts");
            SplitInto(Json.GetString(body, "localAddresses"), r.LocalAddresses);
            SplitInto(Json.GetString(body, "remoteAddresses"), r.RemoteAddresses);
            r.Application = Json.GetString(body, "application");
            r.Service = Json.GetString(body, "service");
            r.Profiles = Json.GetString(body, "profiles");
            r.Edge = Json.GetBool(body, "edge", false);
            return r;
        }

        public string ToRuleString()
        {
            StringBuilder sb = new StringBuilder();
            sb.Append("v").Append(Version).Append("|");
            Append(sb, "Action", Action);
            Append(sb, "Active", Active ? "TRUE" : "FALSE");
            Append(sb, "Dir", Direction);
            Append(sb, "Protocol", Protocol);
            Append(sb, "LPort", LocalPorts);
            Append(sb, "RPort", RemotePorts);
            foreach (string a in LocalAddresses) { Append(sb, IsV6(a) ? "LA6" : "LA4", a); }
            foreach (string a in RemoteAddresses) { Append(sb, IsV6(a) ? "RA6" : "RA4", a); }
            Append(sb, "App", Application);
            Append(sb, "Svc", Service);
            if (!string.IsNullOrEmpty(Profiles))
            {
                foreach (string p in Profiles.Split(',')) { Append(sb, "Profile", p.Trim()); }
            }
            if (Edge) { Append(sb, "Edge", "TRUE"); }
            Append(sb, "Name", Name);
            Append(sb, "Desc", Description);
            foreach (string e in _extra) { sb.Append(e).Append("|"); }
            return sb.ToString();
        }

        public Dictionary<string, object> ToRow()
        {
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["name"] = Name;
            row["description"] = Description;
            row["action"] = Action;
            row["direction"] = Direction;
            row["active"] = Active;
            row["protocol"] = Protocol;
            row["localPorts"] = LocalPorts;
            row["remotePorts"] = RemotePorts;
            row["localAddresses"] = string.Join(",", LocalAddresses.ToArray());
            row["remoteAddresses"] = string.Join(",", RemoteAddresses.ToArray());
            row["application"] = Application;
            row["service"] = Service;
            row["profiles"] = Profiles;
            row["edge"] = Edge;
            return row;
        }

        private static void Append(StringBuilder sb, string key, string value)
        {
            if (string.IsNullOrEmpty(value)) { return; }
            sb.Append(key).Append("=").Append(value).Append("|");
        }

        private static string Append(string existing, string v)
        {
            return string.IsNullOrEmpty(existing) ? v : existing + "," + v;
        }

        private static void SplitInto(string csv, List<string> target)
        {
            if (string.IsNullOrEmpty(csv)) { return; }
            foreach (string p in csv.Split(','))
            {
                string t = p.Trim();
                if (t.Length > 0) { target.Add(t); }
            }
        }

        private static bool IsV6(string addr)
        {
            return addr != null && addr.IndexOf(':') >= 0;
        }
    }
}
