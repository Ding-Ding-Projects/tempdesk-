using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Xml;

namespace TempDesk.Agent
{
    /// <summary>
    /// Administrative Templates (ADMX/ADML) as a GUI. The catalog is parsed once
    /// from the SYSVOL central store, falling back to the local
    /// C:\Windows\PolicyDefinitions, using en-US ADML strings, and cached. The
    /// per-GPO routes read and write the registry values that back each policy
    /// exactly as the ADMX definition describes.
    /// </summary>
    public class AdmxService : IAgentModule
    {
        private readonly AgentConfig _config;
        private readonly object _lock = new object();
        private AdmxCatalog _catalog;

        public AdmxService(AgentConfig config)
        {
            _config = config;
        }

        public string[] Capabilities { get { return new string[] { "admx" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "admx/categories", true, false, Categories);
            router.Map("GET", "admx/policies", true, false, Policies);
            router.Map("GET", "gpo/{id}/admx/{policyId}", true, false, GetPolicyState);
            router.Map("PUT", "gpo/{id}/admx/{policyId}", true, false, PutPolicyState);
        }

        private AdmxCatalog Catalog()
        {
            lock (_lock)
            {
                if (_catalog == null)
                {
                    _catalog = AdmxCatalog.Load(CentralStorePath(), LocalStorePath());
                }
                return _catalog;
            }
        }

        private string CentralStorePath()
        {
            // \\<domain>\SYSVOL\<domain>\Policies\PolicyDefinitions
            string dns = DnsDomain();
            if (string.IsNullOrEmpty(dns))
            {
                return null;
            }
            return @"\\" + dns + @"\SYSVOL\" + dns + @"\Policies\PolicyDefinitions";
        }

        private static string LocalStorePath()
        {
            return @"C:\Windows\PolicyDefinitions";
        }

        private string DnsDomain()
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

        // ---------------------------------------------------------------
        // Routes
        // ---------------------------------------------------------------

        private object Categories(RequestContext ctx)
        {
            List<object> result = new List<object>();
            foreach (AdmxCategory cat in Catalog().Categories.Values)
            {
                Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                row["id"] = cat.Id;
                row["name"] = cat.DisplayName;
                row["parentId"] = cat.ParentId;
                row["explain"] = cat.Explain;
                result.Add(row);
            }
            return result;
        }

        private object Policies(RequestContext ctx)
        {
            string category = ctx.Query["category"];
            string q = ctx.Query["q"];
            string cls = ctx.Query["class"];
            List<object> result = new List<object>();
            foreach (AdmxPolicy policy in Catalog().Policies.Values)
            {
                if (!string.IsNullOrEmpty(category) && !string.Equals(policy.CategoryId, category, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                if (!string.IsNullOrEmpty(cls) && !MatchesClass(policy.Class, cls))
                {
                    continue;
                }
                if (!string.IsNullOrEmpty(q))
                {
                    string hay = (policy.DisplayName + " " + policy.Explain).ToLowerInvariant();
                    if (hay.IndexOf(q.ToLowerInvariant(), StringComparison.Ordinal) < 0)
                    {
                        continue;
                    }
                }
                result.Add(ShapePolicy(policy));
            }
            return result;
        }

        private static bool MatchesClass(string policyClass, string requested)
        {
            if (string.Equals(policyClass, "Both", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            if (string.Equals(requested, "Both", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
            return string.Equals(policyClass, requested, StringComparison.OrdinalIgnoreCase);
        }

        private Dictionary<string, object> ShapePolicy(AdmxPolicy policy)
        {
            Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
            row["id"] = policy.Id;
            row["name"] = policy.DisplayName;
            row["class"] = policy.Class;
            row["categoryId"] = policy.CategoryId;
            row["explain"] = policy.Explain;
            row["supportedOn"] = policy.SupportedOn;
            row["key"] = policy.Key;
            row["valueName"] = policy.ValueName;
            List<object> elements = new List<object>();
            foreach (AdmxElement e in policy.Elements)
            {
                Dictionary<string, object> el = new Dictionary<string, object>(StringComparer.Ordinal);
                el["id"] = e.Id;
                el["type"] = e.Type;
                el["label"] = e.Label;
                el["required"] = e.Required;
                el["min"] = e.Min;
                el["max"] = e.Max;
                el["maxLength"] = e.MaxLength;
                el["key"] = e.Key != null ? e.Key : policy.Key;
                el["valueName"] = e.ValueName;
                if (e.Items != null && e.Items.Count > 0)
                {
                    List<object> items = new List<object>();
                    foreach (AdmxEnumItem item in e.Items)
                    {
                        Dictionary<string, object> it = new Dictionary<string, object>(StringComparer.Ordinal);
                        it["id"] = item.Id;
                        it["label"] = item.Label;
                        items.Add(it);
                    }
                    el["items"] = items;
                }
                elements.Add(el);
            }
            row["elements"] = elements;
            return row;
        }

        private AdmxPolicy RequirePolicy(string policyId)
        {
            AdmxPolicy policy;
            if (!Catalog().Policies.TryGetValue(policyId, out policy))
            {
                throw AgentException.NotFound("No such ADMX policy '" + policyId + "'.");
            }
            return policy;
        }

        // ---------------------------------------------------------------
        // Per-GPO state get/put
        // ---------------------------------------------------------------

        private object GetPolicyState(RequestContext ctx)
        {
            if (ctx.Ps == null) { throw AgentException.Internal("PowerShell host is not available."); }
            string gpoId = ctx.Route("id");
            string policyId = ctx.Route("policyId");
            AdmxPolicy policy = RequirePolicy(policyId);

            // Read the policy's main registry value to decide Enabled/Disabled.
            Dictionary<string, object> values = new Dictionary<string, object>(StringComparer.Ordinal);
            string state = "NotConfigured";

            object main = ReadRegistry(ctx, gpoId, policy.Key, policy.ValueName);
            if (main != null)
            {
                long asLong;
                bool isLong = Json.TryToLong(main, out asLong);
                if (policy.EnabledValue.HasValue && isLong && asLong == policy.EnabledValue.Value)
                {
                    state = "Enabled";
                }
                else if (policy.DisabledValue.HasValue && isLong && asLong == policy.DisabledValue.Value)
                {
                    state = "Disabled";
                }
                else
                {
                    // Value present but not matching the on/off sentinel: treat
                    // a non-zero as enabled, which covers the common 1/0 case.
                    state = (isLong && asLong == 0) ? "Disabled" : "Enabled";
                }
            }

            if (string.Equals(state, "Enabled", StringComparison.Ordinal))
            {
                foreach (AdmxElement e in policy.Elements)
                {
                    object v = ReadRegistry(ctx, gpoId, e.Key != null ? e.Key : policy.Key, e.ValueName);
                    if (v != null)
                    {
                        values[e.Id] = v;
                    }
                }
            }

            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["state"] = state;
            result["values"] = values;
            return result;
        }

        private object PutPolicyState(RequestContext ctx)
        {
            if (ctx.Ps == null) { throw AgentException.Internal("PowerShell host is not available."); }
            string gpoId = ctx.Route("id");
            string policyId = ctx.Route("policyId");
            AdmxPolicy policy = RequirePolicy(policyId);
            Dictionary<string, object> body = ctx.BodyJson();
            string state = Json.RequireString(body, "state", 16);
            Dictionary<string, object> values = Json.GetDict(body, "values");

            if (string.Equals(state, "NotConfigured", StringComparison.Ordinal))
            {
                // Remove the main value and all element values.
                RemoveRegistry(ctx, gpoId, policy.Key, policy.ValueName);
                foreach (AdmxElement e in policy.Elements)
                {
                    RemoveRegistry(ctx, gpoId, e.Key != null ? e.Key : policy.Key, e.ValueName);
                }
            }
            else if (string.Equals(state, "Enabled", StringComparison.Ordinal))
            {
                int enabled = policy.EnabledValue.HasValue ? (int)policy.EnabledValue.Value : 1;
                WriteRegistry(ctx, gpoId, policy.Key, policy.ValueName, "DWord", enabled);
                foreach (AdmxElement e in policy.Elements)
                {
                    object v = null;
                    if (values != null) { values.TryGetValue(e.Id, out v); }
                    WriteElement(ctx, gpoId, policy, e, v);
                }
            }
            else if (string.Equals(state, "Disabled", StringComparison.Ordinal))
            {
                if (policy.DisabledValue.HasValue)
                {
                    WriteRegistry(ctx, gpoId, policy.Key, policy.ValueName, "DWord", (int)policy.DisabledValue.Value);
                }
                else
                {
                    WriteRegistry(ctx, gpoId, policy.Key, policy.ValueName, "DWord", 0);
                }
                // Disabling clears element values.
                foreach (AdmxElement e in policy.Elements)
                {
                    RemoveRegistry(ctx, gpoId, e.Key != null ? e.Key : policy.Key, e.ValueName);
                }
            }
            else
            {
                throw AgentException.BadRequest("state must be NotConfigured, Enabled or Disabled.");
            }

            ctx.Audit("admx put", gpoId + " " + policyId + " " + state);
            return GetPolicyState(ctx);
        }

        private void WriteElement(RequestContext ctx, string gpoId, AdmxPolicy policy, AdmxElement e, object value)
        {
            string key = e.Key != null ? e.Key : policy.Key;
            if (value == null)
            {
                if (e.Required)
                {
                    throw AgentException.BadRequest("Element '" + e.Id + "' is required.");
                }
                return;
            }
            switch (e.Type)
            {
                case "boolean":
                    bool on = value is bool ? (bool)value : false;
                    WriteRegistry(ctx, gpoId, key, e.ValueName, "DWord", on ? 1 : 0);
                    break;
                case "decimal":
                    long num;
                    Json.TryToLong(value, out num);
                    WriteRegistry(ctx, gpoId, key, e.ValueName, "DWord", (int)num);
                    break;
                case "text":
                    WriteRegistry(ctx, gpoId, key, e.ValueName, "String", Convert.ToString(value, CultureInfo.InvariantCulture));
                    break;
                case "multiText":
                    WriteRegistry(ctx, gpoId, key, e.ValueName, "MultiString", PowerShellHost.CoerceValue(value));
                    break;
                case "enum":
                    // The value is an item id; look up its backing value.
                    WriteEnum(ctx, gpoId, key, e, value);
                    break;
                case "list":
                    WriteList(ctx, gpoId, e, value);
                    break;
                default:
                    WriteRegistry(ctx, gpoId, key, e.ValueName, "String", Convert.ToString(value, CultureInfo.InvariantCulture));
                    break;
            }
        }

        private void WriteEnum(RequestContext ctx, string gpoId, string key, AdmxElement e, object value)
        {
            string itemId = Convert.ToString(value, CultureInfo.InvariantCulture);
            foreach (AdmxEnumItem item in e.Items)
            {
                if (string.Equals(item.Id, itemId, StringComparison.Ordinal))
                {
                    if (item.IsStringValue)
                    {
                        WriteRegistry(ctx, gpoId, key, e.ValueName, "String", item.StringValue);
                    }
                    else
                    {
                        WriteRegistry(ctx, gpoId, key, e.ValueName, "DWord", (int)item.DecimalValue);
                    }
                    return;
                }
            }
            throw AgentException.BadRequest("Unknown enum item '" + itemId + "' for element '" + e.Id + "'.");
        }

        private void WriteList(RequestContext ctx, string gpoId, AdmxElement e, object value)
        {
            // A list element stores each entry as its own value under the list
            // key. With valuePrefix, names are prefix1, prefix2, ...; otherwise
            // the entry text is both name and value. explicitValue lists supply
            // name/value pairs. We accept an array of strings or of {name,value}.
            List<object> entries = Json.AsList(value);
            if (entries == null)
            {
                throw AgentException.BadRequest("List element '" + e.Id + "' expects an array.");
            }
            string listKey = e.Key != null ? e.Key : e.ListKey;
            int index = 1;
            foreach (object entry in entries)
            {
                string name;
                string data;
                Dictionary<string, object> pair = entry as Dictionary<string, object>;
                if (pair != null)
                {
                    name = Json.GetString(pair, "name");
                    data = Json.GetString(pair, "value");
                }
                else
                {
                    data = Convert.ToString(entry, CultureInfo.InvariantCulture);
                    name = e.ValuePrefix != null ? e.ValuePrefix + index : data;
                }
                WriteRegistry(ctx, gpoId, listKey, name, "String", data);
                index++;
            }
        }

        // ---------------------------------------------------------------
        // Registry helpers that go through the GroupPolicy cmdlets
        // ---------------------------------------------------------------

        private object ReadRegistry(RequestContext ctx, string gpoId, string key, string valueName)
        {
            try
            {
                Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                p["Guid"] = gpoId;
                p["Key"] = key;
                if (!string.IsNullOrEmpty(valueName)) { p["ValueName"] = valueName; }
                List<Dictionary<string, object>> rows = ctx.Ps.Invoke("Get-GPRegistryValue", p);
                foreach (Dictionary<string, object> row in rows)
                {
                    object v;
                    if (row.TryGetValue("Value", out v) && v != null)
                    {
                        return v;
                    }
                }
            }
            catch (Exception)
            {
                // Value not configured.
            }
            return null;
        }

        private void WriteRegistry(RequestContext ctx, string gpoId, string key, string valueName, string type, object value)
        {
            Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
            p["Guid"] = gpoId;
            p["Key"] = key;
            if (!string.IsNullOrEmpty(valueName)) { p["ValueName"] = valueName; }
            p["Type"] = type;
            p["Value"] = value;
            ctx.Ps.Invoke("Set-GPRegistryValue", p);
        }

        private void RemoveRegistry(RequestContext ctx, string gpoId, string key, string valueName)
        {
            try
            {
                Dictionary<string, object> p = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                p["Guid"] = gpoId;
                p["Key"] = key;
                if (!string.IsNullOrEmpty(valueName)) { p["ValueName"] = valueName; }
                ctx.Ps.Invoke("Remove-GPRegistryValue", p);
            }
            catch (Exception)
            {
                // Already absent.
            }
        }
    }

    // -------------------------------------------------------------------
    // Catalog model and parser
    // -------------------------------------------------------------------

    public class AdmxCategory
    {
        public string Id;
        public string DisplayName;
        public string ParentId;
        public string Explain;
    }

    public class AdmxEnumItem
    {
        public string Id;
        public string Label;
        public bool IsStringValue;
        public string StringValue;
        public long DecimalValue;
    }

    public class AdmxElement
    {
        public string Id;
        public string Type;      // boolean|decimal|text|multiText|enum|list
        public string Label;
        public bool Required;
        public object Min;
        public object Max;
        public object MaxLength;
        public string Key;       // element-specific key, else the policy key
        public string ValueName;
        public string ListKey;
        public string ValuePrefix;
        public bool Additive;
        public List<AdmxEnumItem> Items = new List<AdmxEnumItem>();
    }

    public class AdmxPolicy
    {
        public string Id;        // "<admxFile>:<policyName>"
        public string Name;
        public string DisplayName;
        public string Class;     // Machine|User|Both
        public string CategoryId;
        public string Explain;
        public string SupportedOn;
        public string Key;
        public string ValueName;
        public long? EnabledValue;
        public long? DisabledValue;
        public List<AdmxElement> Elements = new List<AdmxElement>();
    }

    /// <summary>
    /// A parsed ADMX/ADML catalog. Categories and policies are keyed by their
    /// portable ids. Parsing is defensive: a malformed file is skipped rather
    /// than failing the whole catalog.
    /// </summary>
    public class AdmxCatalog
    {
        public Dictionary<string, AdmxCategory> Categories =
            new Dictionary<string, AdmxCategory>(StringComparer.OrdinalIgnoreCase);
        public Dictionary<string, AdmxPolicy> Policies =
            new Dictionary<string, AdmxPolicy>(StringComparer.OrdinalIgnoreCase);

        public static AdmxCatalog Load(string centralStore, string localStore)
        {
            string store = null;
            if (!string.IsNullOrEmpty(centralStore) && Directory.Exists(centralStore))
            {
                store = centralStore;
            }
            else if (!string.IsNullOrEmpty(localStore) && Directory.Exists(localStore))
            {
                store = localStore;
            }

            AdmxCatalog catalog = new AdmxCatalog();
            if (store == null)
            {
                return catalog;
            }

            foreach (string admxPath in Directory.GetFiles(store, "*.admx"))
            {
                try
                {
                    catalog.ParseAdmx(admxPath, store);
                }
                catch (Exception)
                {
                    // Skip a single bad file.
                }
            }
            return catalog;
        }

        private void ParseAdmx(string admxPath, string store)
        {
            string admxName = Path.GetFileNameWithoutExtension(admxPath);
            Dictionary<string, string> strings = LoadAdml(store, admxName);

            XmlDocument doc = new XmlDocument();
            doc.Load(admxPath);
            XmlNamespaceManager ns = new XmlNamespaceManager(doc.NameTable);
            ns.AddNamespace("a", "http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions");

            // Categories.
            XmlNodeList categories = doc.SelectNodes("//a:categories/a:category", ns);
            if (categories != null)
            {
                foreach (XmlNode node in categories)
                {
                    AdmxCategory cat = new AdmxCategory();
                    string name = Attr(node, "name");
                    cat.Id = admxName + ":" + name;
                    cat.DisplayName = Resolve(strings, Attr(node, "displayName"));
                    cat.Explain = Resolve(strings, Attr(node, "explainText"));
                    XmlNode parent = node.SelectSingleNode("a:parentCategory", ns);
                    if (parent != null)
                    {
                        cat.ParentId = QualifyRef(Attr(parent, "ref"), admxName);
                    }
                    Categories[cat.Id] = cat;
                }
            }

            // Policies.
            XmlNodeList policies = doc.SelectNodes("//a:policies/a:policy", ns);
            if (policies != null)
            {
                foreach (XmlNode node in policies)
                {
                    AdmxPolicy policy = ParsePolicy(node, ns, admxName, strings);
                    if (policy != null)
                    {
                        Policies[policy.Id] = policy;
                    }
                }
            }
        }

        private AdmxPolicy ParsePolicy(XmlNode node, XmlNamespaceManager ns, string admxName, Dictionary<string, string> strings)
        {
            AdmxPolicy policy = new AdmxPolicy();
            policy.Name = Attr(node, "name");
            policy.Id = admxName + ":" + policy.Name;
            policy.DisplayName = Resolve(strings, Attr(node, "displayName"));
            policy.Explain = Resolve(strings, Attr(node, "explainText"));
            policy.Key = Attr(node, "key");
            policy.ValueName = Attr(node, "valueName");
            policy.SupportedOn = null;
            XmlNode supported = node.SelectSingleNode("a:supportedOn", ns);
            if (supported != null)
            {
                policy.SupportedOn = Attr(supported, "ref");
            }

            string cls = Attr(node, "class");
            policy.Class = string.IsNullOrEmpty(cls) ? "Both" : cls;

            XmlNode parent = node.SelectSingleNode("a:parentCategory", ns);
            if (parent != null)
            {
                policy.CategoryId = QualifyRef(Attr(parent, "ref"), admxName);
            }

            // enabledValue / disabledValue decimal sentinels.
            policy.EnabledValue = DecimalValueOf(node.SelectSingleNode("a:enabledValue/a:decimal", ns));
            policy.DisabledValue = DecimalValueOf(node.SelectSingleNode("a:disabledValue/a:decimal", ns));

            // Elements.
            XmlNode elements = node.SelectSingleNode("a:elements", ns);
            if (elements != null)
            {
                foreach (XmlNode el in elements.ChildNodes)
                {
                    AdmxElement parsed = ParseElement(el, ns, strings);
                    if (parsed != null)
                    {
                        policy.Elements.Add(parsed);
                    }
                }
            }
            return policy;
        }

        private AdmxElement ParseElement(XmlNode el, XmlNamespaceManager ns, Dictionary<string, string> strings)
        {
            if (el.NodeType != XmlNodeType.Element)
            {
                return null;
            }
            AdmxElement e = new AdmxElement();
            e.Id = Attr(el, "id");
            e.ValueName = Attr(el, "valueName");
            e.Key = Attr(el, "key"); // may be null -> use policy key
            e.Required = ParseBool(Attr(el, "required"));
            e.Label = e.Id;

            switch (el.LocalName)
            {
                case "boolean":
                    e.Type = "boolean";
                    break;
                case "decimal":
                case "longDecimal":
                    e.Type = "decimal";
                    e.Min = ParseNullableLong(Attr(el, "minValue"));
                    e.Max = ParseNullableLong(Attr(el, "maxValue"));
                    break;
                case "text":
                    e.Type = "text";
                    e.MaxLength = ParseNullableLong(Attr(el, "maxLength"));
                    break;
                case "multiText":
                    e.Type = "multiText";
                    break;
                case "enum":
                    e.Type = "enum";
                    ParseEnumItems(el, ns, strings, e);
                    break;
                case "list":
                    e.Type = "list";
                    e.ListKey = Attr(el, "key");
                    e.ValuePrefix = Attr(el, "valuePrefix");
                    e.Additive = ParseBool(Attr(el, "additive"));
                    // explicitValue lists carry name/value pairs; the portal
                    // sends {name,value} objects for those.
                    break;
                default:
                    return null;
            }
            return e;
        }

        private void ParseEnumItems(XmlNode el, XmlNamespaceManager ns, Dictionary<string, string> strings, AdmxElement e)
        {
            XmlNodeList items = el.SelectNodes("a:item", ns);
            if (items == null) { return; }
            int ordinal = 0;
            foreach (XmlNode item in items)
            {
                AdmxEnumItem enumItem = new AdmxEnumItem();
                enumItem.Id = ordinal.ToString(CultureInfo.InvariantCulture);
                enumItem.Label = Resolve(strings, Attr(item, "displayName"));
                XmlNode dec = item.SelectSingleNode("a:value/a:decimal", ns);
                XmlNode str = item.SelectSingleNode("a:value/a:string", ns);
                if (dec != null)
                {
                    enumItem.IsStringValue = false;
                    enumItem.DecimalValue = ParseLong(Attr(dec, "value"));
                }
                else if (str != null)
                {
                    enumItem.IsStringValue = true;
                    enumItem.StringValue = str.InnerText;
                }
                e.Items.Add(enumItem);
                ordinal++;
            }
        }

        // -----------------------------------------------------------
        // ADML string table (en-US) loading with caching per admx file
        // -----------------------------------------------------------

        private readonly Dictionary<string, Dictionary<string, string>> _admlCache =
            new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);

        private Dictionary<string, string> LoadAdml(string store, string admxName)
        {
            if (_admlCache.ContainsKey(admxName))
            {
                return _admlCache[admxName];
            }
            Dictionary<string, string> table = new Dictionary<string, string>(StringComparer.Ordinal);
            string admlPath = Path.Combine(store, Path.Combine("en-US", admxName + ".adml"));
            try
            {
                if (File.Exists(admlPath))
                {
                    XmlDocument doc = new XmlDocument();
                    doc.Load(admlPath);
                    XmlNamespaceManager ns = new XmlNamespaceManager(doc.NameTable);
                    ns.AddNamespace("a", "http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions");
                    XmlNodeList strings = doc.SelectNodes("//a:stringTable/a:string", ns);
                    if (strings != null)
                    {
                        foreach (XmlNode s in strings)
                        {
                            string id = Attr(s, "id");
                            if (id != null)
                            {
                                table[id] = s.InnerText;
                            }
                        }
                    }
                }
            }
            catch (Exception)
            {
                // No localized strings: fall back to ids.
            }
            _admlCache[admxName] = table;
            return table;
        }

        // -----------------------------------------------------------
        // Small parse helpers
        // -----------------------------------------------------------

        private static string Attr(XmlNode node, string name)
        {
            if (node == null || node.Attributes == null) { return null; }
            XmlAttribute a = node.Attributes[name];
            return a != null ? a.Value : null;
        }

        private static string Resolve(Dictionary<string, string> strings, string reference)
        {
            if (string.IsNullOrEmpty(reference))
            {
                return null;
            }
            // References look like "$(string.Id)".
            if (reference.StartsWith("$(string.", StringComparison.Ordinal) && reference.EndsWith(")", StringComparison.Ordinal))
            {
                string id = reference.Substring("$(string.".Length);
                id = id.Substring(0, id.Length - 1);
                string value;
                if (strings != null && strings.TryGetValue(id, out value))
                {
                    return value;
                }
                return id;
            }
            return reference;
        }

        private static string QualifyRef(string reference, string admxName)
        {
            if (string.IsNullOrEmpty(reference))
            {
                return null;
            }
            // A ref may be "name" (same file) or "file:name".
            if (reference.IndexOf(':') >= 0)
            {
                return reference;
            }
            return admxName + ":" + reference;
        }

        private static long? DecimalValueOf(XmlNode node)
        {
            if (node == null) { return null; }
            XmlAttribute a = node.Attributes != null ? node.Attributes["value"] : null;
            if (a == null) { return null; }
            long v;
            if (long.TryParse(a.Value, NumberStyles.Integer, CultureInfo.InvariantCulture, out v))
            {
                return v;
            }
            return null;
        }

        private static bool ParseBool(string s)
        {
            return string.Equals(s, "true", StringComparison.OrdinalIgnoreCase) || s == "1";
        }

        private static long ParseLong(string s)
        {
            long v;
            long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v);
            return v;
        }

        private static object ParseNullableLong(string s)
        {
            if (string.IsNullOrEmpty(s)) { return null; }
            long v;
            if (long.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v))
            {
                return v;
            }
            return null;
        }
    }
}
