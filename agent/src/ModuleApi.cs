using System;
using System.Collections.Generic;
using System.Collections.Specialized;
using System.Net;

namespace TempDesk.Agent
{
    /// <summary>
    /// A module contributes routes to the agent. Modules are discovered by
    /// reflection at startup: every non-abstract type that implements this
    /// interface and has a public parameterless constructor is instantiated and
    /// its Register method is called once with the shared router.
    ///
    /// This is the stable contract that separate source files (for example the
    /// server-management module in Server*.cs) code against. Keep it stable.
    /// </summary>
    public interface IAgentModule
    {
        void Register(Router router);

        /// <summary>
        /// Capability ids this module contributes to the /health capabilities
        /// list. The health route reports the union of every module's
        /// capabilities (plus the built-in ones).
        /// </summary>
        string[] Capabilities { get; }
    }

    /// <summary>
    /// The error type handlers throw to return a specific HTTP status and error
    /// code. The router turns it into the documented error body
    /// {"error":"&lt;code&gt;","message":"&lt;text&gt;"}.
    /// </summary>
    public class AgentException : Exception
    {
        private readonly int _status;
        private readonly string _code;

        public AgentException(int status, string code, string message)
            : base(message)
        {
            _status = status;
            _code = code;
        }

        public int Status { get { return _status; } }
        public string Code { get { return _code; } }

        // Convenience factories for the documented error codes.
        public static AgentException BadRequest(string message)
        {
            return new AgentException(400, "bad_request", message);
        }

        public static AgentException Unauthorized(string message)
        {
            return new AgentException(401, "unauthorized", message);
        }

        public static AgentException Forbidden(string message)
        {
            return new AgentException(403, "forbidden", message);
        }

        public static AgentException NotFound(string message)
        {
            return new AgentException(404, "not_found", message);
        }

        public static AgentException Conflict(string message)
        {
            return new AgentException(409, "conflict", message);
        }

        public static AgentException RateLimited(string message)
        {
            return new AgentException(429, "rate_limited", message);
        }

        public static AgentException Internal(string message)
        {
            return new AgentException(500, "internal", message);
        }
    }

    /// <summary>
    /// Returned by a handler instead of a plain object when the response is not
    /// JSON: file downloads, reports, exports. The router writes the bytes with
    /// the given status, content type and optional Content-Disposition filename.
    /// </summary>
    public class RawResult
    {
        public int Status;
        public string ContentType;
        public byte[] Body;
        public string FileName;

        public RawResult()
        {
            Status = 200;
            ContentType = "application/octet-stream";
            Body = new byte[0];
        }

        public RawResult(int status, string contentType, byte[] body)
        {
            Status = status;
            ContentType = contentType;
            Body = body != null ? body : new byte[0];
        }
    }

    /// <summary>
    /// Everything a handler is given about one request. The router builds it
    /// after authentication and route matching. Body access is lazy and cached:
    /// the body is read from the request stream at most once, capped at 1 MB.
    /// </summary>
    public class RequestContext
    {
        private readonly HttpListenerRequest _request;
        private readonly Dictionary<string, string> _routeValues;
        private readonly NameValueCollection _query;
        private readonly string _actingUser;
        private readonly PowerShellHost _ps;
        private readonly Func<byte[]> _bodyReader;
        private readonly Action<string, string> _auditSink;

        private bool _bodyRead;
        private byte[] _bodyBytes;
        private bool _jsonParsed;
        private Dictionary<string, object> _bodyJson;

        public RequestContext(
            HttpListenerRequest request,
            Dictionary<string, string> routeValues,
            NameValueCollection query,
            string actingUser,
            PowerShellHost ps,
            Func<byte[]> bodyReader,
            Action<string, string> auditSink)
        {
            _request = request;
            _routeValues = routeValues != null ? routeValues : new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            _query = query != null ? query : new NameValueCollection();
            _actingUser = actingUser;
            _ps = ps;
            _bodyReader = bodyReader;
            _auditSink = auditSink;
        }

        public HttpListenerRequest Request { get { return _request; } }

        /// <summary>Values captured from {name} segments in the path pattern.</summary>
        public Dictionary<string, string> RouteValues { get { return _routeValues; } }

        public NameValueCollection Query { get { return _query; } }

        /// <summary>
        /// The authenticated admin's sam account name, or a synthetic name such
        /// as "guest-portal" for guest-key routes. Never null on admin routes.
        /// </summary>
        public string ActingUser { get { return _actingUser; } }

        /// <summary>The shared runspace-pool wrapper. May be null if PowerShell failed to start.</summary>
        public PowerShellHost Ps { get { return _ps; } }

        /// <summary>Raw request body, capped at 1 MB, read at most once.</summary>
        public byte[] BodyBytes()
        {
            if (!_bodyRead)
            {
                _bodyBytes = _bodyReader != null ? _bodyReader() : new byte[0];
                _bodyRead = true;
            }
            return _bodyBytes;
        }

        /// <summary>Request body parsed as a JSON object, or an empty dictionary when absent.</summary>
        public Dictionary<string, object> BodyJson()
        {
            if (!_jsonParsed)
            {
                byte[] bytes = BodyBytes();
                string text = bytes != null && bytes.Length > 0
                    ? new System.Text.UTF8Encoding(false).GetString(bytes)
                    : null;
                _bodyJson = Json.ParseObject(text);
                _jsonParsed = true;
            }
            return _bodyJson;
        }

        /// <summary>Convenience: a required route value.</summary>
        public string Route(string name)
        {
            string v;
            if (!_routeValues.TryGetValue(name, out v) || string.IsNullOrEmpty(v))
            {
                throw AgentException.BadRequest("Missing path segment '" + name + "'.");
            }
            return v;
        }

        /// <summary>Writes an audit event-log entry for this call.</summary>
        public void Audit(string action, string target)
        {
            if (_auditSink != null)
            {
                _auditSink(action, target);
            }
        }
    }
}
