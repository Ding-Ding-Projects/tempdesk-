using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Xml;

namespace TempDesk.Agent
{
    /// <summary>
    /// Group Policy Preferences (GPP) read/write for the per-area XML files in
    /// {Machine,User}\Preferences\&lt;Area&gt;\&lt;Area&gt;.xml. The exact outer and
    /// inner element names and CLSIDs are those Windows uses, from
    /// [MS-GPPREF] 2.2.1.1.2 "Outer and Inner Element Names and CLSIDs". Each
    /// preference item is exposed to the portal as a flat object: the common
    /// GPP options (name, status, disabled, the item-level-targeting Filters,
    /// and the &lt;Properties&gt; attributes with the action verb) become fields,
    /// so the generic node CRUD can list, add, patch and delete items while the
    /// XML on disk keeps its documented shape.
    /// </summary>
    public static class GppXml
    {
        /// <summary>One preference area's element names and CLSIDs.</summary>
        public class Area
        {
            public string Name;         // node/area name, e.g. "Drives"
            public string Outer;        // outer element, e.g. "Drives"
            public string OuterClsid;
            public string Inner;        // primary inner element, e.g. "Drive"
            public string InnerClsid;
            public bool Computer;       // available under Machine
            public bool User;           // available under User
            // Additional inner element variants keyed by their element name
            // (for areas such as Printers with Shared/Port/Local printer).
            public Dictionary<string, string> Variants = new Dictionary<string, string>(StringComparer.Ordinal);
        }

        private static readonly Dictionary<string, Area> _areas =
            new Dictionary<string, Area>(StringComparer.OrdinalIgnoreCase);

        private static Area A(string name, string outer, string oc, string inner, string ic, bool comp, bool user)
        {
            Area a = new Area();
            a.Name = name; a.Outer = outer; a.OuterClsid = oc; a.Inner = inner; a.InnerClsid = ic;
            a.Computer = comp; a.User = user;
            a.Variants[inner] = ic;
            _areas[name] = a;
            return a;
        }

        static GppXml()
        {
            // Windows Settings preferences.
            A("Applications", "Applications", "{16DB8EC4-EBFC-4958-98EE-712E9DD3A966}", "Application", "{C8535E2E-148D-494d-8E9A-71FC46649B5E}", true, true);
            A("Drives", "Drives", "{8FDDCC1A-0C3C-43cd-A6B4-71A6DF20DA8C}", "Drive", "{935D1B74-9CB8-4e3c-9914-7DD559B7A417}", false, true);
            A("EnvironmentVariables", "EnvironmentVariables", "{BF141A63-327B-438a-B9BF-2C188F13B7AD}", "EnvironmentVariable", "{78570023-8373-4a19-BA80-2F150738EA19}", true, true);
            A("Files", "Files", "{215B2E53-57CE-475c-80FE-9EEC14635851}", "File", "{50BE44C8-567A-4ed1-B1D0-9234FE1F38AF}", true, true);
            A("Folders", "Folders", "{77CC39E7-3D16-4f8f-AF86-EC0BBEE2C861}", "Folder", "{07DA02F5-F9CD-4397-A550-4AE21B6B4BD3}", true, true);
            A("IniFiles", "IniFiles", "{694C651A-08F2-47fa-A427-34C4F62BA207}", "Ini", "{EEFACE84-D3D8-4680-8D4B-BF103E759448}", true, true);
            A("NetworkShares", "NetworkShareSettings", "{520870D8-A6E7-47e8-A8D8-E6A4E76EAEC2}", "NetShare", "{2888C5E7-94FC-4739-90AA-2C1536D68BC0}", true, false);
            A("Registry", "RegistrySettings", "{A3CCFC41-DFDB-43a5-8D26-0FE8B954DA51}", "Registry", "{9CD4B2F4-923D-47f5-A062-E897DD1DAD50}", true, true);
            A("Shortcuts", "Shortcuts", "{872ECB34-B2EC-401b-A585-D32574AA90EE}", "Shortcut", "{4F2F7C55-2790-433e-8127-0739D1CFA327}", true, true);

            // Control Panel Settings preferences.
            Area ds = A("DataSources", "DataSources", "{380F820F-F21B-41ac-A3CC-24D4F80F067B}", "DataSource", "{5C209626-D820-4d69-8D50-1FACD6214488}", true, true);
            ds.ToString();
            A("Devices", "Devices", "{4DD26924-3F32-47aa-BF33-36D51BD1E54E}", "Device", "{2E1C95D0-85FB-403a-A57C-A508854FB7C8}", true, true);
            A("NetworkOptions", "NetworkOptions", "{09686AD1-5D80-48ee-A940-690A6DF02A90}", "VPN", "{0532F359-3205-4d32-ADB7-9AEC6402BECF}", true, true)
                .Variants["DUN"] = "{9B0D030D-9396-49c1-8DEF-08B35B5BB79E}";
            A("Printers", "Printers", "{1F577D12-3D1B-471e-A1B7-060317597B9C}", "SharedPrinter", "{9A5E9697-9095-436d-A0EE-4D128FDFBCE5}", true, true)
                .Variants["PortPrinter"] = "{C3A739D2-4A44-401e-9F9D-88E5E77DFB3E}";
            _areas["Printers"].Variants["LocalPrinter"] = "{F08996D5-568B-45f5-BB7A-D3FB1E370B0A}";
            A("ScheduledTasks", "ScheduledTasks", "{CC63F200-7309-4ba0-B154-A71CD118DBCC}", "Task", "{2DEECB1C-261F-4e13-9B21-16FB83BC03BD}", true, true)
                .Variants["ImmediateTask"] = "{9F030D12-DDA3-4C26-8548-B7CE9151166A}";
            _areas["ScheduledTasks"].Variants["TaskV2"] = "{D8896631-B747-47a7-84A6-C155337F3BC8}";
            _areas["ScheduledTasks"].Variants["ImmediateTaskV2"] = "{9756B581-76EC-4169-9AFC-0CA8D43ADB5F}";
            A("Services", "NTServices", "{2CFB484A-4E96-4b5d-A0B6-093D2F91E6AE}", "NTService", "{AB6F0B67-341F-4e51-92F9-005FBFBA1A43}", true, false);
            A("FolderOptions", "FolderOptions", "{8AB5F5D7-F676-48ab-A94E-1186E120EFDC}", "GlobalFolderOptionsVista", "{DBF1E3CD-4CA2-407c-BE84-5F67D3BE754D}", true, true)
                .Variants["GlobalFolderOptions"] = "{E7632293-E3FC-4fee-9CD3-584C95D8D2A0}";
            _areas["FolderOptions"].Variants["OpenWith"] = "{100B9C09-906A-4f5a-9C41-1BD98B6CA022}";
            _areas["FolderOptions"].Variants["FileType"] = "{580C4D3B-7A89-44d0-92D2-C105702C7BD0}";
            A("InternetSettings", "InternetSettings", "{B611EB48-F531-42cd-A1F6-5E0D015377BA}", "Internet", "{8C0FE68F-E8A2-4f17-99E7-C6EFED208917}", false, true)
                .Variants["IE7"] = "{683F7AD7-E782-4232-8A6D-F22431F12DB5}";
            A("LocalUsersAndGroups", "Groups", "{3125E937-EB16-4b4c-9934-544FC6D24D26}", "Group", "{6D4A79E4-529C-4481-ABD0-F5BD7EA93BA7}", true, true)
                .Variants["User"] = "{DF5F1855-51E5-4d24-8B1A-D9BDE98BA1D1}";
            A("PowerOptions", "PowerOptions", "{7B0F9381-C3B8-4525-8167-87349B671D94}", "GlobalPowerOptionsV2", "{2B130A62-fc14-4572-91C3-5435C6A0C3FC}", true, true)
                .Variants["GlobalPowerOptions"] = "{46D0DCC4-FC14-48fb-829B-854868C7DC16}";
            _areas["PowerOptions"].Variants["PowerScheme"] = "{DE828AFA-7E71-480e-8081-5447CBE87754}";
            A("RegionalOptions", "Regional", "{BDBA23C2-DE02-434e-8D89-13E53CB6710B}", "RegionalOptions", "{C126A328-BECF-4acc-BA8D-C9C7F6B84E49}", false, true);
            A("StartMenu", "StartMenuTaskbar", "{4C4059E4-2F6E-4630-9CB8-5D9A89252C3B}", "StartMenuVista", "{8B03851A-1210-4621-80B6-C334A4F1C941}", false, true)
                .Variants["StartMenu"] = "{F722CC65-E38A-496b-BA76-49EBF9571415}";
        }

        public static Area Get(string name)
        {
            Area a;
            return _areas.TryGetValue(name, out a) ? a : null;
        }

        public static ICollection<string> AreaNames { get { return _areas.Keys; } }

        // ---------------------------------------------------------------
        // Read: parse the area XML into a list of item dictionaries.
        // ---------------------------------------------------------------

        /// <summary>
        /// Reads the preference items in an area XML file. Each returned item
        /// has: id (uid), elementType (inner element name), name, status,
        /// disabled, the Properties attributes under "properties", and the raw
        /// item-level-targeting XML under "filters" (null when absent).
        /// </summary>
        public static List<Dictionary<string, object>> ReadItems(string path)
        {
            List<Dictionary<string, object>> items = new List<Dictionary<string, object>>();
            if (!File.Exists(path))
            {
                return items;
            }
            XmlDocument doc = new XmlDocument();
            doc.Load(path);
            if (doc.DocumentElement == null)
            {
                return items;
            }
            foreach (XmlNode node in doc.DocumentElement.ChildNodes)
            {
                XmlElement el = node as XmlElement;
                if (el == null) { continue; }
                items.Add(ShapeItem(el));
            }
            return items;
        }

        private static Dictionary<string, object> ShapeItem(XmlElement el)
        {
            Dictionary<string, object> item = new Dictionary<string, object>(StringComparer.Ordinal);
            item["elementType"] = el.LocalName;
            item["id"] = GetAttr(el, "uid");
            item["name"] = GetAttr(el, "name");
            item["status"] = GetAttr(el, "status");
            item["disabled"] = string.Equals(GetAttr(el, "disabled"), "1", StringComparison.Ordinal);
            item["changed"] = GetAttr(el, "changed");
            item["userContext"] = string.Equals(GetAttr(el, "userContext"), "1", StringComparison.Ordinal);
            item["removePolicy"] = string.Equals(GetAttr(el, "removePolicy"), "1", StringComparison.Ordinal);
            item["bypassErrors"] = string.Equals(GetAttr(el, "bypassErrors"), "1", StringComparison.Ordinal);

            Dictionary<string, object> props = new Dictionary<string, object>(StringComparer.Ordinal);
            XmlElement propsEl = FirstChild(el, "Properties");
            if (propsEl != null)
            {
                foreach (XmlAttribute a in propsEl.Attributes)
                {
                    props[a.Name] = a.Value;
                }
            }
            item["properties"] = props;

            XmlElement filters = FirstChild(el, "Filters");
            item["filters"] = filters != null ? filters.OuterXml : null;
            return item;
        }

        // ---------------------------------------------------------------
        // Write: serialize a list of item dictionaries back to area XML.
        // ---------------------------------------------------------------

        public static void WriteItems(string path, Area area, List<Dictionary<string, object>> items)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            XmlDocument doc = new XmlDocument();
            doc.AppendChild(doc.CreateXmlDeclaration("1.0", "utf-8", null));
            XmlElement root = doc.CreateElement(area.Outer);
            root.SetAttribute("clsid", area.OuterClsid);
            doc.AppendChild(root);
            foreach (Dictionary<string, object> item in items)
            {
                root.AppendChild(BuildItem(doc, area, item));
            }
            string tmp = path + ".tdtmp";
            using (XmlTextWriter w = new XmlTextWriter(tmp, new UTF8Encoding(false)))
            {
                w.Formatting = Formatting.Indented;
                doc.Save(w);
            }
            if (File.Exists(path)) { File.Delete(path); }
            File.Move(tmp, path);
        }

        private static XmlElement BuildItem(XmlDocument doc, Area area, Dictionary<string, object> item)
        {
            string elementType = Json.GetString(item, "elementType");
            if (string.IsNullOrEmpty(elementType)) { elementType = area.Inner; }
            string clsid;
            if (!area.Variants.TryGetValue(elementType, out clsid))
            {
                elementType = area.Inner;
                clsid = area.InnerClsid;
            }
            XmlElement el = doc.CreateElement(elementType);
            el.SetAttribute("clsid", clsid);
            string name = Json.GetString(item, "name");
            if (!string.IsNullOrEmpty(name)) { el.SetAttribute("name", name); }
            string status = Json.GetString(item, "status");
            if (!string.IsNullOrEmpty(status)) { el.SetAttribute("status", status); }
            string uid = Json.GetString(item, "id");
            if (string.IsNullOrEmpty(uid)) { uid = "{" + Guid.NewGuid().ToString().ToUpperInvariant() + "}"; }
            el.SetAttribute("uid", uid);
            el.SetAttribute("changed", DateTime.UtcNow.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture));
            if (Json.GetBool(item, "disabled", false)) { el.SetAttribute("disabled", "1"); }
            if (Json.GetBool(item, "userContext", false)) { el.SetAttribute("userContext", "1"); }
            if (Json.GetBool(item, "removePolicy", false)) { el.SetAttribute("removePolicy", "1"); }
            if (Json.GetBool(item, "bypassErrors", false)) { el.SetAttribute("bypassErrors", "1"); }
            el.SetAttribute("image", "0");

            // Filters (item-level targeting) raw XML, if provided.
            string filters = Json.GetString(item, "filters");
            if (!string.IsNullOrEmpty(filters))
            {
                try
                {
                    XmlDocument fd = new XmlDocument();
                    fd.LoadXml(filters);
                    el.AppendChild(doc.ImportNode(fd.DocumentElement, true));
                }
                catch (XmlException)
                {
                    throw AgentException.BadRequest("The 'filters' field is not valid XML.");
                }
            }

            XmlElement props = doc.CreateElement("Properties");
            Dictionary<string, object> p = Json.GetDict(item, "properties");
            if (p != null)
            {
                foreach (KeyValuePair<string, object> kv in p)
                {
                    props.SetAttribute(kv.Key, Convert.ToString(kv.Value, CultureInfo.InvariantCulture));
                }
            }
            el.AppendChild(props);
            return el;
        }

        private static string GetAttr(XmlElement el, string name)
        {
            XmlAttribute a = el.Attributes[name];
            return a != null ? a.Value : null;
        }

        private static XmlElement FirstChild(XmlElement el, string name)
        {
            foreach (XmlNode n in el.ChildNodes)
            {
                XmlElement c = n as XmlElement;
                if (c != null && string.Equals(c.LocalName, name, StringComparison.Ordinal))
                {
                    return c;
                }
            }
            return null;
        }
    }
}
