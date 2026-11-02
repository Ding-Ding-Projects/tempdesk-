using System;
using System.Collections.Generic;
using System.DirectoryServices.AccountManagement;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// A validated admin session token: the signed payload plus the parsed
    /// fields the router needs.
    /// </summary>
    public class SessionToken
    {
        public string Sam;
        public string DisplayName;
        public DateTime IssuedAt;
        public DateTime ExpiresAt;
        public string Id; // unique id used for revocation
    }

    /// <summary>
    /// Authentication and authorization: the two static API keys, admin login
    /// against Active Directory, HMAC-signed bearer tokens with an in-memory
    /// revocation set, per-username login lockout, and short-lived elevation
    /// tokens for the most dangerous routes.
    /// </summary>
    public class Auth
    {
        private readonly AgentConfig _config;
        private readonly AuditLog _audit;

        // Revoked token ids (logout) and issued-but-valid is implied by signature + expiry.
        private readonly HashSet<string> _revoked = new HashSet<string>(StringComparer.Ordinal);
        private readonly object _revokedLock = new object();

        // Elevation tokens: id -> (user, expiresAt). Bound to the session user.
        private class Elevation { public string User; public DateTime ExpiresAt; }
        private readonly Dictionary<string, Elevation> _elevations = new Dictionary<string, Elevation>(StringComparer.Ordinal);
        private readonly object _elevationLock = new object();

        // 5 failures per 15 minutes per username.
        private readonly RateLimiter _loginLockout = new RateLimiter(5, TimeSpan.FromMinutes(15));

        public Auth(AgentConfig config, AuditLog audit)
        {
            _config = config;
            _audit = audit;
        }

        // ---------------------------------------------------------------
        // Static API keys
        // ---------------------------------------------------------------

        public bool IsGuestKey(string presented)
        {
            return Passwords.ConstantTimeEquals(presented, _config.GuestKey);
        }

        public bool IsAdminKey(string presented)
        {
            return Passwords.ConstantTimeEquals(presented, _config.AdminKey);
        }

        // ---------------------------------------------------------------
        // Admin login against AD
        // ---------------------------------------------------------------

        /// <summary>
        /// Validates credentials against the domain and checks recursive
        /// membership of the admin group by name. Throws unauthorized on bad
        /// credentials or lockout, forbidden when not an admin.
        /// </summary>
        public SessionToken Login(string username, string password, string adminGroup)
        {
            if (string.IsNullOrEmpty(username) || string.IsNullOrEmpty(password))
            {
                throw AgentException.Unauthorized("Username and password are required.");
            }
            if (_loginLockout.IsBlocked(username))
            {
                throw AgentException.Unauthorized("Too many failed sign-ins. Try again later.");
            }

            bool valid;
            string displayName = username;
            try
            {
                using (PrincipalContext ctx = new PrincipalContext(ContextType.Domain))
                {
                    valid = ctx.ValidateCredentials(username, password);
                    if (valid)
                    {
                        using (UserPrincipal user = UserPrincipal.FindByIdentity(ctx, username))
                        {
                            if (user == null)
                            {
                                valid = false;
                            }
                            else
                            {
                                if (!string.IsNullOrEmpty(user.DisplayName))
                                {
                                    displayName = user.DisplayName;
                                }
                                if (!string.IsNullOrEmpty(user.SamAccountName))
                                {
                                    username = user.SamAccountName;
                                }
                                if (!IsInGroupRecursive(user, adminGroup))
                                {
                                    // Valid credentials but not an admin.
                                    throw AgentException.Forbidden("This account is not a TempDesk administrator.");
                                }
                            }
                        }
                    }
                }
            }
            catch (AgentException)
            {
                throw;
            }
            catch (Exception ex)
            {
                throw AgentException.Internal("Directory sign-in failed: " + ex.Message);
            }

            if (!valid)
            {
                int failures = _loginLockout.RecordFailure(username);
                _audit.Warn("Failed admin sign-in for '" + username + "' (" + failures + " in window).");
                throw AgentException.Unauthorized("Invalid username or password.");
            }

            _loginLockout.Reset(username);
            return Issue(username, displayName);
        }

        private static bool IsInGroupRecursive(UserPrincipal user, string groupName)
        {
            // GetAuthorizationGroups is recursive (transitive) membership.
            PrincipalSearchResult<Principal> groups = user.GetAuthorizationGroups();
            foreach (Principal p in groups)
            {
                if (p == null) { continue; }
                try
                {
                    if (string.Equals(p.SamAccountName, groupName, StringComparison.OrdinalIgnoreCase)
                        || string.Equals(p.Name, groupName, StringComparison.OrdinalIgnoreCase))
                    {
                        return true;
                    }
                }
                catch (Exception)
                {
                    // Some SIDs cannot be resolved; skip them.
                }
            }
            return false;
        }

        // ---------------------------------------------------------------
        // HMAC-signed session tokens: base64url(payload).base64url(sig)
        // ---------------------------------------------------------------

        private SessionToken Issue(string sam, string displayName)
        {
            SessionToken t = new SessionToken();
            t.Sam = sam;
            t.DisplayName = displayName;
            t.IssuedAt = DateTime.UtcNow;
            t.ExpiresAt = t.IssuedAt.AddHours(8);
            t.Id = Convert.ToBase64String(Passwords.RandomBytes(12));
            return t;
        }

        /// <summary>Serializes a session token into the wire format.</summary>
        public string Serialize(SessionToken t)
        {
            Dictionary<string, object> payload = new Dictionary<string, object>(StringComparer.Ordinal);
            payload["id"] = t.Id;
            payload["sam"] = t.Sam;
            payload["dn"] = t.DisplayName;
            payload["iat"] = ToUnix(t.IssuedAt);
            payload["exp"] = ToUnix(t.ExpiresAt);
            string json = Json.Serialize(payload);
            byte[] payloadBytes = Encoding.UTF8.GetBytes(json);
            string p = Base64Url.Encode(payloadBytes);
            byte[] sig = Sign(payloadBytes);
            string s = Base64Url.Encode(sig);
            return p + "." + s;
        }

        /// <summary>
        /// Verifies a bearer token: signature, expiry and revocation. Returns
        /// the session, or null when the token is invalid.
        /// </summary>
        public SessionToken Verify(string token)
        {
            if (string.IsNullOrEmpty(token))
            {
                return null;
            }
            int dot = token.IndexOf('.');
            if (dot <= 0 || dot >= token.Length - 1)
            {
                return null;
            }
            try
            {
                string pPart = token.Substring(0, dot);
                string sPart = token.Substring(dot + 1);
                byte[] payloadBytes = Base64Url.Decode(pPart);
                byte[] presentedSig = Base64Url.Decode(sPart);
                byte[] expectedSig = Sign(payloadBytes);
                if (!Passwords.ConstantTimeEquals(presentedSig, expectedSig))
                {
                    return null;
                }
                Dictionary<string, object> payload = Json.ParseObject(Encoding.UTF8.GetString(payloadBytes));
                SessionToken t = new SessionToken();
                t.Id = Json.GetString(payload, "id");
                t.Sam = Json.GetString(payload, "sam");
                t.DisplayName = Json.GetString(payload, "dn");
                long? iat = Json.GetLong(payload, "iat");
                long? exp = Json.GetLong(payload, "exp");
                t.IssuedAt = iat.HasValue ? FromUnix(iat.Value) : DateTime.MinValue;
                t.ExpiresAt = exp.HasValue ? FromUnix(exp.Value) : DateTime.MinValue;

                if (DateTime.UtcNow >= t.ExpiresAt)
                {
                    return null;
                }
                lock (_revokedLock)
                {
                    if (t.Id != null && _revoked.Contains(t.Id))
                    {
                        return null;
                    }
                }
                return t;
            }
            catch (Exception)
            {
                return null;
            }
        }

        public void Revoke(SessionToken t)
        {
            if (t == null || t.Id == null) { return; }
            lock (_revokedLock)
            {
                _revoked.Add(t.Id);
            }
        }

        private byte[] Sign(byte[] data)
        {
            using (HMACSHA256 h = new HMACSHA256(_config.HmacSecret))
            {
                return h.ComputeHash(data);
            }
        }

        // ---------------------------------------------------------------
        // Elevation tokens (POST /auth/confirm), 10 minutes, bound to the user
        // ---------------------------------------------------------------

        /// <summary>
        /// Re-validates the session user's password and issues a short-lived
        /// elevation token bound to that user.
        /// </summary>
        public Dictionary<string, object> Confirm(SessionToken session, string password)
        {
            if (session == null)
            {
                throw AgentException.Unauthorized("A valid admin session is required.");
            }
            if (string.IsNullOrEmpty(password))
            {
                throw AgentException.BadRequest("Password is required.");
            }
            bool valid;
            try
            {
                using (PrincipalContext ctx = new PrincipalContext(ContextType.Domain))
                {
                    valid = ctx.ValidateCredentials(session.Sam, password);
                }
            }
            catch (Exception ex)
            {
                throw AgentException.Internal("Directory check failed: " + ex.Message);
            }
            if (!valid)
            {
                throw AgentException.Unauthorized("Password confirmation failed.");
            }

            string id = Base64Url.Encode(Passwords.RandomBytes(18));
            DateTime expires = DateTime.UtcNow.AddMinutes(10);
            lock (_elevationLock)
            {
                _elevations[id] = new Elevation { User = session.Sam, ExpiresAt = expires };
            }
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["elevationToken"] = id;
            result["expiresAt"] = Json.Iso(expires);
            return result;
        }

        /// <summary>True when the elevation token is valid and bound to this user.</summary>
        public bool IsElevated(string elevationToken, string user)
        {
            if (string.IsNullOrEmpty(elevationToken) || string.IsNullOrEmpty(user))
            {
                return false;
            }
            lock (_elevationLock)
            {
                Elevation e;
                if (!_elevations.TryGetValue(elevationToken, out e))
                {
                    return false;
                }
                if (DateTime.UtcNow >= e.ExpiresAt)
                {
                    _elevations.Remove(elevationToken);
                    return false;
                }
                return string.Equals(e.User, user, StringComparison.OrdinalIgnoreCase);
            }
        }

        private static long ToUnix(DateTime utc)
        {
            return (long)(utc - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalSeconds;
        }

        private static DateTime FromUnix(long seconds)
        {
            return new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(seconds);
        }
    }

    /// <summary>URL-safe base64 without padding, for token parts.</summary>
    public static class Base64Url
    {
        public static string Encode(byte[] data)
        {
            string s = Convert.ToBase64String(data);
            s = s.Replace('+', '-').Replace('/', '_');
            return s.TrimEnd('=');
        }

        public static byte[] Decode(string s)
        {
            string t = s.Replace('-', '+').Replace('_', '/');
            switch (t.Length % 4)
            {
                case 2: t += "=="; break;
                case 3: t += "="; break;
            }
            return Convert.FromBase64String(t);
        }
    }
}
