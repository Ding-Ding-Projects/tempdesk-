using System;
using System.Collections.Generic;

namespace TempDesk.Agent
{
    /// <summary>
    /// The static description of every node of the Group Policy Management
    /// Editor tree, plus the item schemas the portal uses to render rich
    /// controls. This is pure data: GpoEditorService turns a node's kind and
    /// backing format into the real read/write against the GPO's SYSVOL folder
    /// or AD objects. The tree mirrors gpedit/GPMC: Computer and User, each
    /// with Policies (Software Settings, Windows Settings, Administrative
    /// Templates) and Preferences (Windows Settings, Control Panel Settings).
    ///
    /// Node kinds:
    ///   container        a grouping node with children, no settings of its own
    ///   form             a single object edited as a field form (GET/PUT)
    ///   table            a list of rows edited with item CRUD
    ///   admx             the Administrative Templates subtree (served by AdmxService)
    ///   preference-items GPP items (served through GppXml)
    ///   script-list      scripts.ini / psscripts.ini entries
    /// </summary>
    public class GpoNode
    {
        public string Id;
        public string Name;
        public string Kind;
        public string Class;        // Machine | User
        public string Capability;   // capability flag; null => always available
        public string ItemSchema;   // schema id for table/preference-items/form nodes
        public string Unavailable;  // reason string when a node cannot be served by this backend
        public List<string> Children = new List<string>();
    }

    public static class GpoNodes
    {
        private static readonly Dictionary<string, GpoNode> _nodes =
            new Dictionary<string, GpoNode>(StringComparer.OrdinalIgnoreCase);
        private static readonly List<string> _roots = new List<string>();

        public static IDictionary<string, GpoNode> All { get { return _nodes; } }
        public static List<string> Roots { get { return _roots; } }

        public static GpoNode Get(string id)
        {
            GpoNode n;
            return _nodes.TryGetValue(id, out n) ? n : null;
        }

        private static GpoNode N(string id, string name, string kind, string cls, string parent, string schema)
        {
            GpoNode n = new GpoNode();
            n.Id = id; n.Name = name; n.Kind = kind; n.Class = cls; n.ItemSchema = schema;
            _nodes[id] = n;
            if (parent == null) { _roots.Add(id); }
            else { _nodes[parent].Children.Add(id); }
            return n;
        }

        static GpoNodes()
        {
            foreach (string cls in new string[] { "Machine", "User" })
            {
                string p = cls.ToLowerInvariant();            // "machine" / "user"
                string label = cls == "Machine" ? "Computer Configuration" : "User Configuration";
                N(p, label, "container", cls, null, null);

                // ---- Policies ----
                N(p + "/pol", "Policies", "container", cls, p, null);

                // Software Settings > Software installation
                N(p + "/pol/sw", "Software Settings", "container", cls, p + "/pol", null);
                N(p + "/pol/sw/install", "Software installation", "table", cls, p + "/pol/sw", "software-installation")
                    .Capability = "gpo-software-installation";

                // Windows Settings
                N(p + "/pol/win", "Windows Settings", "container", cls, p + "/pol", null);

                // Scripts
                if (cls == "Machine")
                {
                    N(p + "/pol/win/scripts", "Scripts (Startup/Shutdown)", "container", cls, p + "/pol/win", null);
                    N(p + "/pol/win/scripts/startup", "Startup", "script-list", cls, p + "/pol/win/scripts", "script-entry");
                    N(p + "/pol/win/scripts/shutdown", "Shutdown", "script-list", cls, p + "/pol/win/scripts", "script-entry");
                }
                else
                {
                    N(p + "/pol/win/scripts", "Scripts (Logon/Logoff)", "container", cls, p + "/pol/win", null);
                    N(p + "/pol/win/scripts/logon", "Logon", "script-list", cls, p + "/pol/win/scripts", "script-entry");
                    N(p + "/pol/win/scripts/logoff", "Logoff", "script-list", cls, p + "/pol/win/scripts", "script-entry");
                }

                if (cls == "Machine")
                {
                    AddMachineSecurity(p);
                    // Policy-based QoS
                    N(p + "/pol/win/qos", "Policy-based QoS", "table", cls, p + "/pol/win", "qos-policy");
                    // Deployed Printers
                    N(p + "/pol/win/printers", "Deployed Printers", "table", cls, p + "/pol/win", "deployed-printer")
                        .Capability = "gpo-deployed-printers";
                }
                else
                {
                    // User Security Settings is a small subset (Public Key, SRP).
                    N(p + "/pol/win/sec", "Security Settings", "container", cls, p + "/pol/win", null);
                    N(p + "/pol/win/sec/pki", "Public Key Policies", "table", cls, p + "/pol/win/sec", "pki-trusted-cert");
                    N(p + "/pol/win/sec/srp", "Software Restriction Policies", "table", cls, p + "/pol/win/sec", "srp-rule");
                    // Policy-based QoS
                    N(p + "/pol/win/qos", "Policy-based QoS", "table", cls, p + "/pol/win", "qos-policy");
                    // Deployed Printers
                    N(p + "/pol/win/printers", "Deployed Printers", "table", cls, p + "/pol/win", "deployed-printer")
                        .Capability = "gpo-deployed-printers";
                    // Folder Redirection (user only)
                    N(p + "/pol/win/folderredir", "Folder Redirection", "table", cls, p + "/pol/win", "folder-redirection");
                }

                // Name Resolution Policy (machine) and Administrative Templates both classes.
                if (cls == "Machine")
                {
                    N(p + "/pol/nrpt", "Name Resolution Policy", "table", cls, p + "/pol", "nrpt-rule");
                }
                N(p + "/pol/admx", "Administrative Templates", "admx", cls, p + "/pol", null);

                // ---- Preferences ----
                AddPreferences(p, cls);
            }
        }

        private static void AddMachineSecurity(string p)
        {
            string sec = p + "/pol/win/sec";
            N(sec, "Security Settings", "container", "Machine", p + "/pol/win", null);

            // Account Policies
            N(sec + "/account", "Account Policies", "container", "Machine", sec, null);
            N(sec + "/account/password", "Password Policy", "form", "Machine", sec + "/account", "sec-password");
            N(sec + "/account/lockout", "Account Lockout Policy", "form", "Machine", sec + "/account", "sec-lockout");
            N(sec + "/account/kerberos", "Kerberos Policy", "form", "Machine", sec + "/account", "sec-kerberos");

            // Local Policies
            N(sec + "/local", "Local Policies", "container", "Machine", sec, null);
            N(sec + "/local/audit", "Audit Policy", "form", "Machine", sec + "/local", "sec-audit");
            N(sec + "/local/rights", "User Rights Assignment", "table", "Machine", sec + "/local", "sec-user-right");
            N(sec + "/local/options", "Security Options", "table", "Machine", sec + "/local", "sec-option");

            N(sec + "/eventlog", "Event Log", "form", "Machine", sec, "sec-eventlog");
            N(sec + "/restrictedgroups", "Restricted Groups", "table", "Machine", sec, "sec-restricted-group");
            N(sec + "/services", "System Services", "table", "Machine", sec, "sec-system-service");
            N(sec + "/registry", "Registry", "table", "Machine", sec, "sec-registry-perm");
            N(sec + "/filesystem", "File System", "table", "Machine", sec, "sec-file-perm");

            N(sec + "/wired", "Wired Network (IEEE 802.3) Policies", "table", "Machine", sec, "wired-policy")
                .Capability = "gpo-wired";
            N(sec + "/firewall", "Windows Defender Firewall with Advanced Security", "container", "Machine", sec, null);
            N(sec + "/firewall/profiles", "Firewall Profiles", "form", "Machine", sec + "/firewall", "firewall-profiles");
            N(sec + "/firewall/inbound", "Inbound Rules", "table", "Machine", sec + "/firewall", "firewall-rule");
            N(sec + "/firewall/outbound", "Outbound Rules", "table", "Machine", sec + "/firewall", "firewall-rule");
            N(sec + "/firewall/csr", "Connection Security Rules", "table", "Machine", sec + "/firewall", "firewall-csr");
            N(sec + "/netlist", "Network List Manager Policies", "table", "Machine", sec, "netlist-policy");
            N(sec + "/wireless", "Wireless Network (IEEE 802.11) Policies", "table", "Machine", sec, "wireless-policy")
                .Capability = "gpo-wireless";
            N(sec + "/pki", "Public Key Policies", "table", "Machine", sec, "pki-trusted-cert");
            N(sec + "/srp", "Software Restriction Policies", "table", "Machine", sec, "srp-rule");
            N(sec + "/applocker", "Application Control Policies (AppLocker)", "table", "Machine", sec, "applocker-rule");
            N(sec + "/ipsec", "IP Security Policies", "table", "Machine", sec, "ipsec-policy")
                .Capability = "gpo-ipsec";
            N(sec + "/advaudit", "Advanced Audit Policy Configuration", "table", "Machine", sec, "advanced-audit");
        }

        // Preference areas, Windows Settings vs Control Panel Settings.
        private static readonly string[][] _prefWindows = new string[][]
        {
            new[] { "Applications", "Applications" },
            new[] { "Drives", "Drive Maps" },          // user only; filtered below
            new[] { "EnvironmentVariables", "Environment" },
            new[] { "Files", "Files" },
            new[] { "Folders", "Folders" },
            new[] { "IniFiles", "Ini Files" },
            new[] { "NetworkShares", "Network Shares" },  // computer only
            new[] { "Registry", "Registry" },
            new[] { "Shortcuts", "Shortcuts" },
        };

        private static readonly string[][] _prefControlPanel = new string[][]
        {
            new[] { "DataSources", "Data Sources" },
            new[] { "Devices", "Devices" },
            new[] { "FolderOptions", "Folder Options" },
            new[] { "InternetSettings", "Internet Settings" },     // user only
            new[] { "LocalUsersAndGroups", "Local Users and Groups" },
            new[] { "NetworkOptions", "Network Options" },
            new[] { "PowerOptions", "Power Options" },
            new[] { "Printers", "Printers" },
            new[] { "RegionalOptions", "Regional Options" },       // user only
            new[] { "ScheduledTasks", "Scheduled Tasks" },
            new[] { "Services", "Services" },                      // computer only
            new[] { "StartMenu", "Start Menu" },                   // user only
        };

        private static void AddPreferences(string p, string cls)
        {
            N(p + "/pref", "Preferences", "container", cls, p, null).Capability = "gpo-preferences";
            N(p + "/pref/win", "Windows Settings", "container", cls, p + "/pref", null);
            N(p + "/pref/cp", "Control Panel Settings", "container", cls, p + "/pref", null);

            foreach (string[] a in _prefWindows)
            {
                AddPref(p + "/pref/win", p, cls, a[0], a[1]);
            }
            foreach (string[] a in _prefControlPanel)
            {
                AddPref(p + "/pref/cp", p, cls, a[0], a[1]);
            }
        }

        private static void AddPref(string parent, string p, string cls, string area, string label)
        {
            GppXml.Area def = GppXml.Get(area);
            if (def == null) { return; }
            bool available = cls == "Machine" ? def.Computer : def.User;
            if (!available) { return; }
            GpoNode n = N(parent + "/" + area.ToLowerInvariant(), label, "preference-items", cls, parent, "pref-" + area);
            n.Capability = "gpo-preferences";
        }
    }
}
