using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.IO;
using System.Net;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// Describes how a single route authenticates. Guest routes accept the guest
    /// key (or the admin key). Admin routes require the admin key plus a valid
    /// bearer token. Open routes need no key at all.
    /// </summary>
    public enum RouteAuth
    {
        Open,       // /health, /public/settings, /auth/login
        Guest,      // guest key or admin key
        Admin       // admin key + bearer token
    }

    /// <summary>
    /// The shared route table and request dispatcher. Modules register routes
    /// with Map(...). The HTTP server calls Dispatch for each request. This
    /// class owns authentication enforcement, route matching, body reading
    /// (1 MB cap), audit of admin calls, and error-to-JSON translation.
    /// </summary>
    public class Router
    {
        private class Route
        {
            public string Method;
            public string[] Segments;   // literal or "{name}"
            public RouteAuth Auth;
            public bool RequiresElevation;
            public Func<RequestContext, object> Handler;
        }

        private const long MaxBody = 1024 * 1024; // 1 MB

        private readonly List<Route> _routes = new List<Route>();
        private readonly AgentConfig _config;
        private readonly Auth _auth;
        private readonly AuditLog _audit;
        private readonly PowerShellHost _ps;
        private readonly List<string> _capabilities = new List<string>();

        public Router(AgentConfig config, Auth auth, AuditLog audit, PowerShellHost ps)
        {
            _config = config;
            _auth = auth;
            _audit = audit;
            _ps = ps;
        }

        public AgentConfig Config { get { return _config; } }
        public Auth Auth { get { return _auth; } }
        public AuditLog Audit { get { return _audit; } }
        public PowerShellHost Ps { get { return _ps; } }

        public List<string> Capabilities { get { return _capabilities; } }

        public void AddCapabilities(string[] caps)
        {
            if (caps == null) { return; }
            foreach (string c in caps)
            {
                if (!string.IsNullOrEmpty(c) && !_capabilities.Contains(c))
                {
                    _capabilities.Add(c);
                }
            }
        }

        // ---------------------------------------------------------------
        // Registration API used by modules. The module-facing overload uses
        // adminOnly/requiresElevation booleans exactly as the contract states.
        // ---------------------------------------------------------------

        /// <summary>
        /// Module-facing registration. adminOnly true means an admin key and a
        /// bearer token are required; false means the route is reachable with
        /// the guest key. requiresElevation additionally demands a valid
        /// X-TempDesk-Elevation token bound to the acting user.
        /// </summary>
        public void Map(string method, string pathPattern, bool adminOnly, bool requiresElevation, Func<RequestContext, object> handler)
        {
            Map(method, pathPattern, adminOnly ? RouteAuth.Admin : RouteAuth.Guest, requiresElevation, handler);
        }

        /// <summary>Full registration with an explicit auth mode (used for Open routes).</summary>
        public void Map(string method, string pathPattern, RouteAuth auth, bool requiresElevation, Func<RequestContext, object> handler)
        {
            Route r = new Route();
            r.Method = method.ToUpperInvariant();
            r.Segments = SplitPath(pathPattern);
            r.Auth = auth;
            r.RequiresElevation = requiresElevation;
            r.Handler = handler;
            _routes.Add(r);
        }

        private static string[] SplitPath(string path)
        {
            return path.Trim('/').Split(new char[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
        }

        // ---------------------------------------------------------------
        // Dispatch
        // ---------------------------------------------------------------

        public void Dispatch(HttpListenerContext context)
        {
            HttpListenerRequest request = context.Request;
            HttpListenerResponse response = context.Response;
            try
            {
                // The listener prefix is /api/v1/; strip it to the route path.
                string path = request.Url.AbsolutePath;
                const string prefix = "/api/v1";
                if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    path = path.Substring(prefix.Length);
                }
                string[] segments = SplitPath(path);
                string method = request.HttpMethod.ToUpperInvariant();

                Dictionary<string, string> routeValues;
                Route route = Match(method, segments, out routeValues);
                if (route == null)
                {
                    // Distinguish method-not-allowed from not-found for clarity.
                    if (PathExistsForOtherMethod(segments))
                    {
                        WriteError(response, 405, "bad_request", "Method not allowed for this path.");
                    }
                    else
                    {
                        WriteError(response, 404, "not_found", "No such route.");
                    }
                    return;
                }

                string presentedKey = request.Headers["X-TempDesk-Key"];
                SessionToken session = null;
                string actingUser = "guest-portal";

                if (route.Auth == RouteAuth.Guest)
                {
                    if (!_auth.IsGuestKey(presentedKey) && !_auth.IsAdminKey(presentedKey))
                    {
                        WriteError(response, 401, "unauthorized", "A valid API key is required.");
                        return;
                    }
                }
                else if (route.Auth == RouteAuth.Admin)
                {
                    // The guest key never reaches admin routes, even with a bearer token.
                    if (!_auth.IsAdminKey(presentedKey))
                    {
                        WriteError(response, 401, "unauthorized", "The admin API key is required.");
                        return;
                    }
                    string bearer = ExtractBearer(request.Headers["Authorization"]);
                    session = _auth.Verify(bearer);
                    if (session == null)
                    {
                        WriteError(response, 401, "unauthorized", "A valid admin session token is required.");
                        return;
                    }
                    actingUser = session.Sam;

                    if (route.RequiresElevation)
                    {
                        string elevation = request.Headers["X-TempDesk-Elevation"];
                        if (!_auth.IsElevated(elevation, actingUser))
                        {
                            WriteError(response, 403, "forbidden",
                                "This action needs a fresh password confirmation (POST /auth/confirm).");
                            return;
                        }
                    }
                }

                // Build the request context with lazy, capped body reading.
                string capturedUser = actingUser;
                string routeDescription = method + " " + request.Url.AbsolutePath;
                RequestContext ctx = new RequestContext(
                    request,
                    routeValues,
                    request.QueryString,
                    actingUser,
                    _ps,
                    delegate { return ReadBody(request); },
                    delegate(string action, string target)
                    {
                        _audit.Admin(capturedUser, action != null ? action : routeDescription, target);
                    });

                // Every admin call is audited. Handlers may add a more specific
                // entry with a target via ctx.Audit; this is the baseline.
                if (route.Auth == RouteAuth.Admin)
                {
                    _audit.Admin(actingUser, routeDescription, "-");
                }

                object result = route.Handler(ctx);
                WriteResult(response, result);
            }
            catch (AgentException ax)
            {
                WriteError(response, ax.Status, ax.Code, ax.Message);
            }
            catch (Exception ex)
            {
                try { _audit.Error("Unhandled: " + ex); } catch (Exception) { }
                WriteError(response, 500, "internal", "Internal error: " + ex.Message);
            }
            finally
            {
                try { response.OutputStream.Close(); } catch (Exception) { }
            }
        }

        private Route Match(string method, string[] segments, out Dictionary<string, string> routeValues)
        {
            routeValues = null;
            foreach (Route r in _routes)
            {
                if (!string.Equals(r.Method, method, StringComparison.Ordinal))
                {
                    continue;
                }
                Dictionary<string, string> values;
                if (TryMatchSegments(r.Segments, segments, out values))
                {
                    routeValues = values;
                    return r;
                }
            }
            return null;
        }

        private bool PathExistsForOtherMethod(string[] segments)
        {
            foreach (Route r in _routes)
            {
                Dictionary<string, string> values;
                if (TryMatchSegments(r.Segments, segments, out values))
                {
                    return true;
                }
            }
            return false;
        }

        private static bool TryMatchSegments(string[] pattern, string[] actual, out Dictionary<string, string> values)
        {
            values = null;
            if (pattern.Length != actual.Length)
            {
                return false;
            }
            Dictionary<string, string> captured = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < pattern.Length; i++)
            {
                string p = pattern[i];
                if (p.Length >= 2 && p[0] == '{' && p[p.Length - 1] == '}')
                {
                    string name = p.Substring(1, p.Length - 2);
                    captured[name] = Uri.UnescapeDataString(actual[i]);
                }
                else if (!string.Equals(p, actual[i], StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
            }
            values = captured;
            return true;
        }

        private static string ExtractBearer(string header)
        {
            if (string.IsNullOrEmpty(header))
            {
                return null;
            }
            const string scheme = "Bearer ";
            if (header.StartsWith(scheme, StringComparison.OrdinalIgnoreCase))
            {
                return header.Substring(scheme.Length).Trim();
            }
            return null;
        }

        private static byte[] ReadBody(HttpListenerRequest request)
        {
            if (!request.HasEntityBody)
            {
                return new byte[0];
            }
            using (Stream input = request.InputStream)
            using (MemoryStream ms = new MemoryStream())
            {
                byte[] buffer = new byte[8192];
                long total = 0;
                int read;
                while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                {
                    total += read;
                    if (total > MaxBody)
                    {
                        throw new AgentException(413, "bad_request", "Request body exceeds the 1 MB limit.");
                    }
                    ms.Write(buffer, 0, read);
                }
                return ms.ToArray();
            }
        }

        // ---------------------------------------------------------------
        // Response writing
        // ---------------------------------------------------------------

        private void WriteResult(HttpListenerResponse response, object result)
        {
            RawResult raw = result as RawResult;
            if (raw != null)
            {
                response.StatusCode = raw.Status;
                response.ContentType = raw.ContentType;
                if (!string.IsNullOrEmpty(raw.FileName))
                {
                    response.AddHeader("Content-Disposition", "attachment; filename=\"" + raw.FileName + "\"");
                }
                response.ContentLength64 = raw.Body.Length;
                response.OutputStream.Write(raw.Body, 0, raw.Body.Length);
                return;
            }

            StatusResult sr = result as StatusResult;
            int status = 200;
            object payload = result;
            if (sr != null)
            {
                status = sr.Status;
                payload = sr.Body;
            }

            if (payload == null && (status == 204 || sr != null))
            {
                response.StatusCode = status == 200 ? 204 : status;
                response.ContentLength64 = 0;
                return;
            }

            byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(payload));
            response.StatusCode = status;
            response.ContentType = "application/json; charset=utf-8";
            response.ContentLength64 = bytes.Length;
            response.OutputStream.Write(bytes, 0, bytes.Length);
        }

        private void WriteError(HttpListenerResponse response, int status, string code, string message)
        {
            try
            {
                Dictionary<string, object> body = new Dictionary<string, object>(StringComparer.Ordinal);
                body["error"] = code;
                body["message"] = message;
                byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(body));
                response.StatusCode = status;
                response.ContentType = "application/json; charset=utf-8";
                response.ContentLength64 = bytes.Length;
                response.OutputStream.Write(bytes, 0, bytes.Length);
            }
            catch (Exception)
            {
            }
        }
    }

    /// <summary>
    /// A handler may return this to set a specific status (for example 201 on
    /// create or 204 on delete) around a JSON body or null.
    /// </summary>
    public class StatusResult
    {
        public int Status;
        public object Body;

        public StatusResult(int status, object body)
        {
            Status = status;
            Body = body;
        }

        public static StatusResult Created(object body) { return new StatusResult(201, body); }
        public static StatusResult NoContent() { return new StatusResult(204, null); }
    }
}
