using System;
using System.Collections.Generic;
using System.DirectoryServices;
using System.DirectoryServices.AccountManagement;
using System.Globalization;

namespace TempDesk.Agent
{
    /// <summary>
    /// Guest account lifecycle: the guest-key routes under /guest/* and the
    /// admin /guests routes. Creation uses UserPrincipal in the guest OU with a
    /// random username and password, membership in the guest group, an expiry,
    /// and the info JSON tag. Deletes and status changes verify the target DN
    /// is inside the guest OU so these routes can never touch other accounts.
    /// </summary>
    public class GuestService : IAgentModule
    {
        private readonly AgentConfig _config;
        private readonly AuditLog _audit;
        private readonly RateLimiter _createLimiter;

        public GuestService(AgentConfig config, AuditLog audit)
        {
            _config = config;
            _audit = audit;
            // Per source-IP window is one hour; the max comes from settings at
            // call time, so we build a limiter lazily with the configured max.
            _createLimiter = null;
        }

        // The per-hour limiter is rebuilt when settings change the cap; keep a
        // small cache keyed by the cap value so we honor live settings edits.
        private readonly object _limiterLock = new object();
        private RateLimiter _cachedLimiter;
        private int _cachedCap = -1;

        private RateLimiter PerHourLimiter(int cap)
        {
            lock (_limiterLock)
            {
                if (_cachedLimiter == null || _cachedCap != cap)
                {
                    _cachedLimiter = new RateLimiter(cap, TimeSpan.FromHours(1));
                    _cachedCap = cap;
                }
                return _cachedLimiter;
            }
        }

        public string[] Capabilities { get { return new string[] { "guest" }; } }

        public void Register(Router router)
        {
            // Guest-key routes.
            router.Map("POST", "guest/users", false, false, GuestCreate);
            router.Map("POST", "guest/users/{username}/delete", false, false, GuestDelete);
            router.Map("POST", "guest/users/{username}/status", false, false, GuestStatus);

            // Admin routes.
            router.Map("GET", "guests", true, false, AdminList);
            router.Map("POST", "guests", true, false, AdminCreate);
            router.Map("DELETE", "guests/{username}", true, false, AdminDelete);
            router.Map("POST", "guests/{username}/extend", true, false, AdminExtend);
        }

        private Settings LoadSettings()
        {
            return Settings.Load(_config.SettingsPath, _config.DomainDn);
        }

        private string DnsDomain()
        {
            // Derive the DNS domain from the domain DN: DC=corp,DC=example -> corp.example.
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
        // Creation
        // ---------------------------------------------------------------

        private object GuestCreate(RequestContext ctx)
        {
            Settings settings = LoadSettings();
            Dictionary<string, object> body = ctx.BodyJson();
            string displayName = Json.GetString(body, "displayName");
            string expiryId = Json.GetString(body, "expiryId");
            if (string.IsNullOrEmpty(expiryId))
            {
                throw AgentException.BadRequest("expiryId is required.");
            }
            int minutes = settings.MinutesForExpiryId(expiryId);
            if (minutes == 0 && !settings.AllowPermanent)
            {
                throw AgentException.Forbidden("Permanent accounts are not allowed.");
            }

            // Rate limit per X-Forwarded-For value supplied by the portal.
            string sourceIp = ctx.Request.Headers["X-Forwarded-For"];
            if (string.IsNullOrEmpty(sourceIp))
            {
                sourceIp = "(none)";
            }
            else
            {
                // Take the first hop when a list is supplied.
                int comma = sourceIp.IndexOf(',');
                if (comma > 0) { sourceIp = sourceIp.Substring(0, comma).Trim(); }
            }
            if (!PerHourLimiter(settings.GuestCreatePerHour).TryHit(sourceIp))
            {
                throw AgentException.RateLimited("Too many accounts created from this address this hour.");
            }

            EnforceGlobalCap(settings);
            return StatusResult.Created(CreateGuest(settings, displayName, minutes, "guest-portal"));
        }

        private object AdminCreate(RequestContext ctx)
        {
            Settings settings = LoadSettings();
            Dictionary<string, object> body = ctx.BodyJson();
            string displayName = Json.GetString(body, "displayName");
            int minutes;
            long? m = Json.GetLong(body, "minutes");
            if (m.HasValue)
            {
                minutes = (int)m.Value;
            }
            else
            {
                string expiryId = Json.GetString(body, "expiryId");
                if (string.IsNullOrEmpty(expiryId))
                {
                    throw AgentException.BadRequest("Provide minutes or expiryId.");
                }
                minutes = settings.MinutesForExpiryId(expiryId);
            }
            EnforceGlobalCap(settings);
            Dictionary<string, object> created = CreateGuest(settings, displayName, minutes, ctx.ActingUser);
            ctx.Audit("guests create", (string)created["username"]);
            return StatusResult.Created(created);
        }

        private void EnforceGlobalCap(Settings settings)
        {
            int active = CountGuests(settings);
            if (active >= settings.GuestMaxActive)
            {
                throw AgentException.RateLimited("The maximum number of active guest accounts has been reached.");
            }
        }

        private Dictionary<string, object> CreateGuest(Settings settings, string displayName, int minutes, string createdBy)
        {
            string guestOu = settings.GuestOuDn();
            string dnsDomain = DnsDomain();
            string prefix = settings.UsernamePrefix;
            int pwLength = settings.PasswordLength;

            DateTime? expiresAt = minutes > 0 ? (DateTime?)DateTime.UtcNow.AddMinutes(minutes) : null;
            string password = Passwords.NewPassword(pwLength);

            using (PrincipalContext ctx = new PrincipalContext(ContextType.Domain, null, guestOu))
            {
                // Retry on username collision.
                string username = null;
                UserPrincipal user = null;
                for (int attempt = 0; attempt < 20 && user == null; attempt++)
                {
                    string candidate = Passwords.NewUsername(prefix);
                    if (UserPrincipal.FindByIdentity(ctx, IdentityType.SamAccountName, candidate) != null)
                    {
                        continue;
                    }
                    username = candidate;
                    user = new UserPrincipal(ctx);
                    user.SamAccountName = username;
                    user.UserPrincipalName = username + "@" + dnsDomain;
                    user.DisplayName = string.IsNullOrEmpty(displayName) ? username : displayName;
                    user.Description = "TempDesk guest";
                    user.Enabled = true;
                    user.PasswordNeverExpires = true;
                    user.UserCannotChangePassword = true;
                    if (expiresAt.HasValue)
                    {
                        user.AccountExpirationDate = expiresAt.Value; // stored in UTC
                    }
                    try
                    {
                        user.SetPassword(password);
                        user.Save();
                    }
                    catch (PrincipalExistsException)
                    {
                        // Lost a race; try another name.
                        try { user.Dispose(); } catch (Exception) { }
                        user = null;
                        username = null;
                    }
                }
                if (user == null)
                {
                    throw AgentException.Conflict("Could not allocate a unique guest username. Try again.");
                }

                using (user)
                {
                    // info attribute carries provenance JSON.
                    SetInfoAttribute(user, createdBy, expiresAt);

                    // Add to the guest group by name.
                    AddToGuestGroup(ctx, user, settings.GuestGroup);

                    _audit.GuestCreated(username, createdBy);

                    Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
                    result["username"] = username;
                    result["upn"] = user.UserPrincipalName;
                    result["password"] = password;
                    result["expiresAt"] = Json.IsoOrNull(expiresAt);
                    result["domain"] = dnsDomain;
                    return result;
                }
            }
        }

        private static void SetInfoAttribute(UserPrincipal user, string createdBy, DateTime? expiresAt)
        {
            Dictionary<string, object> info = new Dictionary<string, object>(StringComparer.Ordinal);
            info["createdBy"] = createdBy;
            info["createdAt"] = Json.Iso(DateTime.UtcNow);
            info["expiresAt"] = Json.IsoOrNull(expiresAt);
            string json = Json.Serialize(info);

            DirectoryEntry de = user.GetUnderlyingObject() as DirectoryEntry;
            if (de != null)
            {
                de.Properties["info"].Value = json;
                de.CommitChanges();
            }
        }

        private static void AddToGuestGroup(PrincipalContext ctx, UserPrincipal user, string groupName)
        {
            // The guest group may live outside the guest OU, so search the whole
            // domain for it by name.
            using (PrincipalContext domainCtx = new PrincipalContext(ContextType.Domain))
            using (GroupPrincipal group = GroupPrincipal.FindByIdentity(domainCtx, groupName))
            {
                if (group == null)
                {
                    throw AgentException.Internal("Guest group '" + groupName + "' was not found.");
                }
                group.Members.Add(user);
                group.Save();
            }
        }

        // ---------------------------------------------------------------
        // Delete and status (guest key: password-verified, OU-constrained)
        // ---------------------------------------------------------------

        private object GuestDelete(RequestContext ctx)
        {
            Settings settings = LoadSettings();
            if (!settings.AllowSelfDelete)
            {
                throw AgentException.Forbidden("Self-service deletion is disabled.");
            }
            string username = ctx.Route("username");
            Dictionary<string, object> body = ctx.BodyJson();
            string password = Json.RequireString(body, "password", 256);

            UserPrincipal user = FindGuest(settings, username);
            using (user)
            {
                VerifyGuestPassword(username, password);
                user.Delete();
                _audit.GuestDeleted(username, "self");
            }
            return StatusResult.NoContent();
        }

        private object GuestStatus(RequestContext ctx)
        {
            Settings settings = LoadSettings();
            string username = ctx.Route("username");
            Dictionary<string, object> body = ctx.BodyJson();
            string password = Json.RequireString(body, "password", 256);

            using (UserPrincipal user = FindGuest(settings, username))
            {
                VerifyGuestPassword(username, password);
                Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
                result["username"] = username;
                result["expiresAt"] = Json.IsoOrNull(ExpiryOf(user));
                result["enabled"] = user.Enabled.HasValue ? user.Enabled.Value : false;
                return result;
            }
        }

        private void VerifyGuestPassword(string username, string password)
        {
            using (PrincipalContext ctx = new PrincipalContext(ContextType.Domain))
            {
                if (!ctx.ValidateCredentials(username, password))
                {
                    throw AgentException.Unauthorized("Incorrect password.");
                }
            }
        }

        /// <summary>
        /// Finds a guest by sam account name and verifies its DN ends with the
        /// guest OU DN, so guest routes can only act within the guest OU.
        /// </summary>
        private UserPrincipal FindGuest(Settings settings, string username)
        {
            string guestOu = settings.GuestOuDn();
            PrincipalContext ctx = new PrincipalContext(ContextType.Domain, null, guestOu);
            UserPrincipal user = UserPrincipal.FindByIdentity(ctx, IdentityType.SamAccountName, username);
            if (user == null)
            {
                ctx.Dispose();
                throw AgentException.NotFound("No such guest account.");
            }
            if (!DnEndsWith(user.DistinguishedName, guestOu))
            {
                string dn = user.DistinguishedName;
                user.Dispose();
                ctx.Dispose();
                throw AgentException.Forbidden("Account is not inside the guest OU.");
            }
            return user;
        }

        public static bool DnEndsWith(string dn, string suffixDn)
        {
            if (string.IsNullOrEmpty(dn) || string.IsNullOrEmpty(suffixDn))
            {
                return false;
            }
            return dn.EndsWith(suffixDn, StringComparison.OrdinalIgnoreCase);
        }

        // ---------------------------------------------------------------
        // Admin list / delete / extend
        // ---------------------------------------------------------------

        private object AdminList(RequestContext ctx)
        {
            Settings settings = LoadSettings();
            string guestOu = settings.GuestOuDn();
            List<object> rows = new List<object>();
            using (DirectoryEntry root = DirectoryService.Bind(guestOu))
            using (DirectorySearcher searcher = new DirectorySearcher(root))
            {
                searcher.Filter = "(&(objectClass=user)(objectCategory=person))";
                searcher.SearchScope = SearchScope.Subtree;
                searcher.PageSize = 1000;
                searcher.PropertiesToLoad.Add("sAMAccountName");
                searcher.PropertiesToLoad.Add("displayName");
                searcher.PropertiesToLoad.Add("whenCreated");
                searcher.PropertiesToLoad.Add("accountExpires");
                searcher.PropertiesToLoad.Add("userAccountControl");
                searcher.PropertiesToLoad.Add("lastLogonTimestamp");
                foreach (SearchResult sr in searcher.FindAll())
                {
                    Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                    row["username"] = First(sr, "sAMAccountName");
                    row["displayName"] = First(sr, "displayName");
                    row["created"] = FirstDate(sr, "whenCreated");
                    row["expiresAt"] = FileTimeToIso(FirstLong(sr, "accountExpires"));
                    int uac = (int)FirstLongValue(sr, "userAccountControl", 0);
                    row["enabled"] = (uac & 0x2) == 0;
                    row["lastLogon"] = FileTimeToIso(FirstLong(sr, "lastLogonTimestamp"));
                    rows.Add(row);
                }
            }
            return rows;
        }

        private int CountGuests(Settings settings)
        {
            string guestOu = settings.GuestOuDn();
            int count = 0;
            try
            {
                using (DirectoryEntry root = DirectoryService.Bind(guestOu))
                using (DirectorySearcher searcher = new DirectorySearcher(root))
                {
                    searcher.Filter = "(&(objectClass=user)(objectCategory=person))";
                    searcher.SearchScope = SearchScope.Subtree;
                    searcher.PageSize = 1000;
                    searcher.PropertiesToLoad.Add("distinguishedName");
                    foreach (SearchResult sr in searcher.FindAll())
                    {
                        count++;
                    }
                }
            }
            catch (Exception)
            {
                // If the OU does not exist yet, treat as zero active guests.
                return 0;
            }
            return count;
        }

        private object AdminDelete(RequestContext ctx)
        {
            Settings settings = LoadSettings();
            string username = ctx.Route("username");
            using (UserPrincipal user = FindGuest(settings, username))
            {
                user.Delete();
                _audit.GuestDeleted(username, ctx.ActingUser);
                ctx.Audit("guests delete", username);
            }
            return StatusResult.NoContent();
        }

        private object AdminExtend(RequestContext ctx)
        {
            Settings settings = LoadSettings();
            string username = ctx.Route("username");
            Dictionary<string, object> body = ctx.BodyJson();
            long? minutes = Json.GetLong(body, "minutes");
            if (!minutes.HasValue)
            {
                throw AgentException.BadRequest("minutes is required (0 for permanent).");
            }
            using (UserPrincipal user = FindGuest(settings, username))
            {
                if (minutes.Value == 0)
                {
                    user.AccountExpirationDate = null;
                }
                else
                {
                    user.AccountExpirationDate = DateTime.UtcNow.AddMinutes(minutes.Value);
                }
                user.Save();
                ctx.Audit("guests extend", username + " minutes=" + minutes.Value);
                Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
                result["username"] = username;
                result["expiresAt"] = Json.IsoOrNull(ExpiryOf(user));
                return result;
            }
        }

        // ---------------------------------------------------------------
        // Helpers
        // ---------------------------------------------------------------

        private static DateTime? ExpiryOf(UserPrincipal user)
        {
            DateTime? exp = user.AccountExpirationDate;
            if (!exp.HasValue)
            {
                return null;
            }
            // AccountManagement returns local time; normalize to UTC.
            DateTime v = exp.Value;
            if (v.Kind == DateTimeKind.Unspecified)
            {
                v = DateTime.SpecifyKind(v, DateTimeKind.Utc);
            }
            return v.ToUniversalTime();
        }

        private static string First(SearchResult sr, string name)
        {
            if (sr.Properties.Contains(name) && sr.Properties[name].Count > 0)
            {
                return Convert.ToString(sr.Properties[name][0], CultureInfo.InvariantCulture);
            }
            return null;
        }

        private static object FirstDate(SearchResult sr, string name)
        {
            if (sr.Properties.Contains(name) && sr.Properties[name].Count > 0)
            {
                object v = sr.Properties[name][0];
                if (v is DateTime)
                {
                    return Json.Iso(((DateTime)v).ToUniversalTime());
                }
            }
            return null;
        }

        private static long FirstLong(SearchResult sr, string name)
        {
            return FirstLongValue(sr, name, 0);
        }

        private static long FirstLongValue(SearchResult sr, string name, long fallback)
        {
            if (sr.Properties.Contains(name) && sr.Properties[name].Count > 0)
            {
                object v = sr.Properties[name][0];
                if (v is long) { return (long)v; }
                if (v is int) { return (int)v; }
                long parsed;
                if (long.TryParse(Convert.ToString(v, CultureInfo.InvariantCulture), out parsed))
                {
                    return parsed;
                }
            }
            return fallback;
        }

        /// <summary>
        /// Converts an accountExpires/lastLogon FILETIME to ISO, treating 0 and
        /// the 0x7FFF... sentinel as "never" (null).
        /// </summary>
        private static object FileTimeToIso(long fileTime)
        {
            if (fileTime == 0 || fileTime == DirectoryService.NeverFileTimeValue())
            {
                return null;
            }
            try
            {
                DateTime dt = DateTime.FromFileTimeUtc(fileTime);
                return Json.Iso(dt);
            }
            catch (Exception)
            {
                return null;
            }
        }
    }
}
