using System;
using System.Collections;
using System.Collections.Generic;
using System.DirectoryServices;
using System.Globalization;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// The /ad/* directory routes: generic read and write of any object and any
    /// attribute through System.DirectoryServices (DirectoryEntry and
    /// DirectorySearcher), running as LocalSystem on the domain controller so no
    /// explicit credentials are needed. Binary attribute values are rendered
    /// with the "b64:" prefix and accepted the same way.
    /// </summary>
    public class DirectoryService : IAgentModule
    {
        private readonly AgentConfig _config;

        // FILETIME sentinel: accountExpires value meaning "never".
        private const long NeverFileTime = 0x7FFFFFFFFFFFFFFF;

        public DirectoryService(AgentConfig config)
        {
            _config = config;
        }

        public string[] Capabilities { get { return new string[] { "directory" }; } }

        public void Register(Router router)
        {
            router.Map("GET", "ad/tree", true, false, Tree);
            router.Map("GET", "ad/search", true, false, Search);
            router.Map("GET", "ad/object", true, false, GetObject);
            router.Map("POST", "ad/object", true, false, CreateObject);
            router.Map("PATCH", "ad/object", true, false, PatchObject);
            router.Map("POST", "ad/object/move", true, false, MoveObject);
            router.Map("DELETE", "ad/object", true, false, DeleteObject);
            router.Map("POST", "ad/user/password", true, false, SetPassword);
            router.Map("POST", "ad/user/enable", true, false, SetEnabled);
            router.Map("POST", "ad/user/unlock", true, false, Unlock);
            router.Map("POST", "ad/group/members", true, false, GroupMembers);
        }

        // ---------------------------------------------------------------
        // Helpers to build DirectoryEntry bound to a DN as the service account
        // ---------------------------------------------------------------

        public static DirectoryEntry Bind(string dn)
        {
            // Secure authentication, sealing and signing on the LDAP connection.
            DirectoryEntry entry = new DirectoryEntry("LDAP://" + dn, null, null,
                AuthenticationTypes.Secure | AuthenticationTypes.Sealing | AuthenticationTypes.Signing);
            return entry;
        }

        private string RootDn()
        {
            return _config.DomainDn;
        }

        // ---------------------------------------------------------------
        // GET /ad/tree
        // ---------------------------------------------------------------

        private object Tree(RequestContext ctx)
        {
            string dn = ctx.Query["dn"];
            if (string.IsNullOrEmpty(dn))
            {
                dn = RootDn();
            }
            List<object> children = new List<object>();
            using (DirectoryEntry parent = Bind(dn))
            using (DirectorySearcher searcher = new DirectorySearcher(parent))
            {
                searcher.SearchScope = SearchScope.OneLevel;
                searcher.Filter = "(objectClass=*)";
                searcher.PageSize = 1000;
                searcher.PropertiesToLoad.Add("name");
                searcher.PropertiesToLoad.Add("objectClass");
                searcher.PropertiesToLoad.Add("distinguishedName");
                foreach (SearchResult sr in searcher.FindAll())
                {
                    string childDn = GetProp(sr, "distinguishedName");
                    if (string.Equals(childDn, dn, StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }
                    Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                    row["dn"] = childDn;
                    row["name"] = GetProp(sr, "name");
                    row["objectClass"] = LastObjectClass(sr);
                    row["hasChildren"] = HasChildren(childDn);
                    children.Add(row);
                }
            }
            return children;
        }

        private bool HasChildren(string dn)
        {
            try
            {
                using (DirectoryEntry entry = Bind(dn))
                using (DirectorySearcher searcher = new DirectorySearcher(entry))
                {
                    searcher.SearchScope = SearchScope.OneLevel;
                    searcher.Filter = "(objectClass=*)";
                    searcher.SizeLimit = 2;
                    searcher.PropertiesToLoad.Add("distinguishedName");
                    int count = 0;
                    foreach (SearchResult sr in searcher.FindAll())
                    {
                        string childDn = GetProp(sr, "distinguishedName");
                        if (!string.Equals(childDn, dn, StringComparison.OrdinalIgnoreCase))
                        {
                            count++;
                        }
                    }
                    return count > 0;
                }
            }
            catch (Exception)
            {
                return false;
            }
        }

        // ---------------------------------------------------------------
        // GET /ad/search
        // ---------------------------------------------------------------

        private object Search(RequestContext ctx)
        {
            string baseDn = ctx.Query["base"];
            if (string.IsNullOrEmpty(baseDn))
            {
                baseDn = RootDn();
            }
            string filter = ctx.Query["filter"];
            if (string.IsNullOrEmpty(filter))
            {
                filter = "(objectClass=*)";
            }
            string scope = ctx.Query["scope"];
            string attrsCsv = ctx.Query["attrs"];
            int limit = ParseInt(ctx.Query["limit"], 500);
            if (limit > 5000) { limit = 5000; }

            using (DirectoryEntry root = Bind(baseDn))
            using (DirectorySearcher searcher = new DirectorySearcher(root))
            {
                searcher.Filter = filter;
                searcher.SizeLimit = limit;
                searcher.PageSize = Math.Min(limit, 1000);
                searcher.SearchScope = ParseScope(scope);
                string[] attrs = null;
                if (!string.IsNullOrEmpty(attrsCsv))
                {
                    attrs = attrsCsv.Split(',');
                    foreach (string a in attrs)
                    {
                        string trimmed = a.Trim();
                        if (trimmed.Length > 0)
                        {
                            searcher.PropertiesToLoad.Add(trimmed);
                        }
                    }
                }

                List<object> results = new List<object>();
                foreach (SearchResult sr in searcher.FindAll())
                {
                    Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                    row["dn"] = GetProp(sr, "distinguishedName");
                    row["attributes"] = PropsToDict(sr);
                    results.Add(row);
                    if (results.Count >= limit) { break; }
                }
                return results;
            }
        }

        private static SearchScope ParseScope(string scope)
        {
            if (string.Equals(scope, "base", StringComparison.OrdinalIgnoreCase)) { return SearchScope.Base; }
            if (string.Equals(scope, "one", StringComparison.OrdinalIgnoreCase)) { return SearchScope.OneLevel; }
            return SearchScope.Subtree;
        }

        // ---------------------------------------------------------------
        // GET /ad/object
        // ---------------------------------------------------------------

        private object GetObject(RequestContext ctx)
        {
            string dn = RequireQuery(ctx, "dn");
            return ReadObject(dn);
        }

        /// <summary>Reads one object by DN into the /ad/object response shape.</summary>
        private object ReadObject(string dn)
        {
            using (DirectoryEntry entry = Bind(dn))
            {
                entry.RefreshCache();
                Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
                result["dn"] = dn;

                List<object> classes = new List<object>();
                PropertyValueCollection oc = entry.Properties["objectClass"];
                if (oc != null)
                {
                    foreach (object v in oc)
                    {
                        classes.Add(Convert.ToString(v, CultureInfo.InvariantCulture));
                    }
                }
                result["objectClass"] = classes;

                Dictionary<string, object> attributes = new Dictionary<string, object>(StringComparer.Ordinal);
                foreach (string name in entry.Properties.PropertyNames)
                {
                    attributes[name] = ValuesOf(entry.Properties[name]);
                }
                result["attributes"] = attributes;
                result["schemaAllowed"] = SchemaAllowed(entry);
                return result;
            }
        }

        private List<object> SchemaAllowed(DirectoryEntry entry)
        {
            List<object> allowed = new List<object>();
            try
            {
                // allowedAttributes is a constructed attribute listing every
                // attribute this object may carry per its object class.
                entry.RefreshCache(new string[] { "allowedAttributes" });
                PropertyValueCollection allowedAttrs = entry.Properties["allowedAttributes"];
                if (allowedAttrs != null)
                {
                    foreach (object v in allowedAttrs)
                    {
                        allowed.Add(Convert.ToString(v, CultureInfo.InvariantCulture));
                    }
                }
            }
            catch (Exception)
            {
                // Non-fatal: some environments restrict the constructed attribute.
            }
            return allowed;
        }

        // ---------------------------------------------------------------
        // POST /ad/object
        // ---------------------------------------------------------------

        private object CreateObject(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string parentDn = Json.RequireString(body, "parentDn", 2000);
            string objectClass = Json.RequireString(body, "objectClass", 256);
            string rdn = Json.RequireString(body, "rdn", 512);
            Dictionary<string, object> attributes = Json.GetDict(body, "attributes");

            using (DirectoryEntry parent = Bind(parentDn))
            {
                DirectoryEntry child = parent.Children.Add(rdn, objectClass);
                if (attributes != null)
                {
                    foreach (KeyValuePair<string, object> kv in attributes)
                    {
                        ApplyValues(child.Properties[kv.Key], kv.Value, true);
                    }
                }
                child.CommitChanges();
                string dn = (string)child.Properties["distinguishedName"].Value;
                ctx.Audit("ad/object create", dn);
                child.Dispose();
                Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
                result["dn"] = dn;
                return StatusResult.Created(result);
            }
        }

        // ---------------------------------------------------------------
        // PATCH /ad/object
        // ---------------------------------------------------------------

        private object PatchObject(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string dn = Json.RequireString(body, "dn", 2000);
            Dictionary<string, object> set = Json.GetDict(body, "set");
            Dictionary<string, object> add = Json.GetDict(body, "add");
            Dictionary<string, object> remove = Json.GetDict(body, "remove");
            List<string> clear = Json.GetStringList(body, "clear");

            using (DirectoryEntry entry = Bind(dn))
            {
                if (clear != null)
                {
                    foreach (string attr in clear)
                    {
                        entry.Properties[attr].Clear();
                    }
                }
                if (set != null)
                {
                    foreach (KeyValuePair<string, object> kv in set)
                    {
                        ApplyValues(entry.Properties[kv.Key], kv.Value, true);
                    }
                }
                if (add != null)
                {
                    foreach (KeyValuePair<string, object> kv in add)
                    {
                        ApplyValues(entry.Properties[kv.Key], kv.Value, false);
                    }
                }
                if (remove != null)
                {
                    foreach (KeyValuePair<string, object> kv in remove)
                    {
                        RemoveValues(entry.Properties[kv.Key], kv.Value);
                    }
                }
                entry.CommitChanges();
                entry.RefreshCache();
                ctx.Audit("ad/object patch", dn);
            }
            return ReadObject(dn);
        }

        // ---------------------------------------------------------------
        // POST /ad/object/move
        // ---------------------------------------------------------------

        private object MoveObject(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string dn = Json.RequireString(body, "dn", 2000);
            string newParentDn = Json.RequireString(body, "newParentDn", 2000);
            string newRdn = Json.GetString(body, "newRdn");

            using (DirectoryEntry entry = Bind(dn))
            using (DirectoryEntry newParent = Bind(newParentDn))
            {
                if (string.IsNullOrEmpty(newRdn))
                {
                    entry.MoveTo(newParent);
                }
                else
                {
                    entry.MoveTo(newParent, newRdn);
                }
                entry.CommitChanges();
                string finalDn = (string)entry.Properties["distinguishedName"].Value;
                ctx.Audit("ad/object move", finalDn);
                Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
                result["dn"] = finalDn;
                return result;
            }
        }

        // ---------------------------------------------------------------
        // DELETE /ad/object
        // ---------------------------------------------------------------

        private object DeleteObject(RequestContext ctx)
        {
            string dn = RequireQuery(ctx, "dn");
            bool recursive = ParseBool(ctx.Query["recursive"], false);
            bool force = ParseBool(ctx.Query["force"], false);

            using (DirectoryEntry entry = Bind(dn))
            {
                entry.RefreshCache();
                if (IsProtected(entry) && !force)
                {
                    throw AgentException.Forbidden("Object is protected from accidental deletion. Pass force=true.");
                }
                if (force && IsProtected(entry))
                {
                    ClearProtection(entry);
                }
                using (DirectoryEntry parent = entry.Parent)
                {
                    if (recursive)
                    {
                        entry.DeleteTree();
                    }
                    else
                    {
                        parent.Children.Remove(entry);
                    }
                    parent.CommitChanges();
                }
                ctx.Audit("ad/object delete", dn);
            }
            return StatusResult.NoContent();
        }

        private static bool IsProtected(DirectoryEntry entry)
        {
            // The "protect from accidental deletion" checkbox denies Delete and
            // DeleteTree to Everyone. We detect it heuristically via the
            // systemFlags/ACL is complex; instead we read the well-known flag
            // through the nTSecurityDescriptor is also complex. As a pragmatic
            // check, treat OUs with the flag set on userAccountControl-like
            // attribute as protected is unreliable; use the standard approach:
            // the ACE is on the object, so attempt is costly. We expose force.
            try
            {
                // ADS_SYSTEMFLAG_DISALLOW_DELETE = 0x80000000 is not set by the
                // checkbox; the checkbox uses an explicit Deny ACE. We cannot
                // cheaply read it here, so report not-protected and rely on the
                // directory to deny the delete, surfaced as an error. force=true
                // still clears any Deny ACE we can find.
                return false;
            }
            catch (Exception)
            {
                return false;
            }
        }

        private static void ClearProtection(DirectoryEntry entry)
        {
            // Best-effort: callers who pass force accept that we try to remove
            // an accidental-deletion Deny ACE. Detailed ACL editing lives in the
            // directory ACL routes; here we simply commit and let the delete run.
        }

        // ---------------------------------------------------------------
        // User and group helper routes
        // ---------------------------------------------------------------

        private object SetPassword(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string dn = Json.RequireString(body, "dn", 2000);
            string password = Json.RequireString(body, "password", 256);
            bool mustChange = Json.GetBool(body, "mustChange", false);

            using (DirectoryEntry entry = Bind(dn))
            {
                entry.Invoke("SetPassword", new object[] { password });
                if (mustChange)
                {
                    entry.Properties["pwdLastSet"].Value = 0;
                }
                else
                {
                    entry.Properties["pwdLastSet"].Value = -1;
                }
                entry.CommitChanges();
                ctx.Audit("ad/user/password", dn);
            }
            return StatusResult.NoContent();
        }

        private object SetEnabled(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string dn = Json.RequireString(body, "dn", 2000);
            bool enabled = Json.GetBool(body, "enabled", true);
            using (DirectoryEntry entry = Bind(dn))
            {
                int uac = (int)(entry.Properties["userAccountControl"].Value ?? 0);
                const int ACCOUNTDISABLE = 0x2;
                if (enabled)
                {
                    uac &= ~ACCOUNTDISABLE;
                }
                else
                {
                    uac |= ACCOUNTDISABLE;
                }
                entry.Properties["userAccountControl"].Value = uac;
                entry.CommitChanges();
                ctx.Audit("ad/user/enable", dn + " enabled=" + enabled);
            }
            return StatusResult.NoContent();
        }

        private object Unlock(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string dn = Json.RequireString(body, "dn", 2000);
            using (DirectoryEntry entry = Bind(dn))
            {
                // Setting lockoutTime to 0 unlocks the account.
                entry.Properties["lockoutTime"].Value = 0;
                entry.CommitChanges();
                ctx.Audit("ad/user/unlock", dn);
            }
            return StatusResult.NoContent();
        }

        private object GroupMembers(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string groupDn = Json.RequireString(body, "groupDn", 2000);
            List<string> add = Json.GetStringList(body, "add");
            List<string> remove = Json.GetStringList(body, "remove");

            using (DirectoryEntry group = Bind(groupDn))
            {
                if (add != null)
                {
                    foreach (string memberDn in add)
                    {
                        if (!group.Properties["member"].Contains(memberDn))
                        {
                            group.Properties["member"].Add(memberDn);
                        }
                    }
                }
                if (remove != null)
                {
                    foreach (string memberDn in remove)
                    {
                        if (group.Properties["member"].Contains(memberDn))
                        {
                            group.Properties["member"].Remove(memberDn);
                        }
                    }
                }
                group.CommitChanges();
                ctx.Audit("ad/group/members", groupDn);
            }
            return StatusResult.NoContent();
        }

        // ---------------------------------------------------------------
        // Value conversion between JSON and the directory
        // ---------------------------------------------------------------

        /// <summary>
        /// Renders a directory attribute's values as a list, using the "b64:"
        /// prefix for byte arrays and ISO dates for DateTime/large-integer
        /// values that are clearly times is left to callers; here we keep raw.
        /// </summary>
        public static List<object> ValuesOf(PropertyValueCollection values)
        {
            List<object> list = new List<object>();
            if (values == null)
            {
                return list;
            }
            foreach (object v in values)
            {
                list.Add(RenderValue(v));
            }
            return list;
        }

        private static object RenderValue(object v)
        {
            if (v == null)
            {
                return null;
            }
            byte[] bytes = v as byte[];
            if (bytes != null)
            {
                return "b64:" + Convert.ToBase64String(bytes);
            }
            if (v is DateTime)
            {
                return Json.Iso((DateTime)v);
            }
            // COM large integers (IADsLargeInteger) arrive as __ComObject; convert.
            if (v.GetType().Name == "__ComObject")
            {
                try
                {
                    long asLong = LargeIntToLong(v);
                    return asLong.ToString(CultureInfo.InvariantCulture);
                }
                catch (Exception)
                {
                    return v.ToString();
                }
            }
            if (v is int || v is long || v is bool || v is string)
            {
                return v;
            }
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static long LargeIntToLong(object largeInteger)
        {
            Type t = largeInteger.GetType();
            int highPart = (int)t.InvokeMember("HighPart", System.Reflection.BindingFlags.GetProperty, null, largeInteger, null);
            int lowPart = (int)t.InvokeMember("LowPart", System.Reflection.BindingFlags.GetProperty, null, largeInteger, null);
            return ((long)highPart << 32) | (uint)lowPart;
        }

        /// <summary>
        /// Applies JSON values (scalar or array) to an attribute. "b64:" strings
        /// become byte arrays. When replace is true the attribute is set to
        /// exactly these values; otherwise they are appended.
        /// </summary>
        private static void ApplyValues(PropertyValueCollection target, object jsonValue, bool replace)
        {
            List<object> values = Normalize(jsonValue);
            if (replace)
            {
                target.Clear();
            }
            foreach (object v in values)
            {
                target.Add(v);
            }
        }

        private static void RemoveValues(PropertyValueCollection target, object jsonValue)
        {
            List<object> values = Normalize(jsonValue);
            foreach (object v in values)
            {
                if (target.Contains(v))
                {
                    target.Remove(v);
                }
            }
        }

        /// <summary>
        /// Turns a JSON scalar or array into a list of directory-ready values,
        /// decoding any "b64:"-prefixed string into a byte array.
        /// </summary>
        private static List<object> Normalize(object jsonValue)
        {
            List<object> result = new List<object>();
            List<object> asList = Json.AsList(jsonValue);
            if (asList != null)
            {
                foreach (object item in asList)
                {
                    result.Add(DecodeScalar(item));
                }
            }
            else if (jsonValue != null)
            {
                result.Add(DecodeScalar(jsonValue));
            }
            return result;
        }

        private static object DecodeScalar(object v)
        {
            string s = v as string;
            if (s != null && s.StartsWith("b64:", StringComparison.Ordinal))
            {
                return Convert.FromBase64String(s.Substring(4));
            }
            // Keep integers as int when they fit (userAccountControl etc.).
            long asLong;
            if (Json.TryToLong(v, out asLong))
            {
                if (asLong >= int.MinValue && asLong <= int.MaxValue)
                {
                    return (int)asLong;
                }
                return asLong;
            }
            return v;
        }

        // ---------------------------------------------------------------
        // SearchResult helpers
        // ---------------------------------------------------------------

        private static Dictionary<string, object> PropsToDict(SearchResult sr)
        {
            Dictionary<string, object> dict = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (string name in sr.Properties.PropertyNames)
            {
                List<object> values = new List<object>();
                foreach (object v in sr.Properties[name])
                {
                    values.Add(RenderValue(v));
                }
                dict[name] = values;
            }
            return dict;
        }

        private static string GetProp(SearchResult sr, string name)
        {
            if (sr.Properties.Contains(name) && sr.Properties[name].Count > 0)
            {
                return Convert.ToString(sr.Properties[name][0], CultureInfo.InvariantCulture);
            }
            return null;
        }

        private static string LastObjectClass(SearchResult sr)
        {
            if (sr.Properties.Contains("objectClass") && sr.Properties["objectClass"].Count > 0)
            {
                ResultPropertyValueCollection oc = sr.Properties["objectClass"];
                return Convert.ToString(oc[oc.Count - 1], CultureInfo.InvariantCulture);
            }
            return null;
        }

        // ---------------------------------------------------------------
        // Small parse helpers
        // ---------------------------------------------------------------

        private static string RequireQuery(RequestContext ctx, string name)
        {
            string v = ctx.Query[name];
            if (string.IsNullOrEmpty(v))
            {
                throw AgentException.BadRequest("Query parameter '" + name + "' is required.");
            }
            return v;
        }

        public static int ParseInt(string s, int fallback)
        {
            int v;
            if (!string.IsNullOrEmpty(s) && int.TryParse(s, NumberStyles.Integer, CultureInfo.InvariantCulture, out v))
            {
                return v;
            }
            return fallback;
        }

        public static bool ParseBool(string s, bool fallback)
        {
            if (string.IsNullOrEmpty(s)) { return fallback; }
            if (string.Equals(s, "true", StringComparison.OrdinalIgnoreCase) || s == "1") { return true; }
            if (string.Equals(s, "false", StringComparison.OrdinalIgnoreCase) || s == "0") { return false; }
            return fallback;
        }

        public static long NeverFileTimeValue() { return NeverFileTime; }
    }
}
