using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Text;
using System.Threading;

namespace TempDesk.Agent
{
    /// <summary>
    /// A dedicated PowerShell Runspace bound to one console session id. The
    /// command text IS the operator's input by design: the console is gated by
    /// admin membership plus a fresh elevation token and every command is
    /// audited. Each session has its own runspace so variables and state persist
    /// across commands, and it expires after 20 minutes idle.
    /// </summary>
    internal class ConsoleSession
    {
        private readonly object _lock = new object();
        private readonly Runspace _runspace;
        private readonly string _owner;
        private DateTime _lastUsed;

        public ConsoleSession(string owner)
        {
            _owner = owner;
            InitialSessionState iss = InitialSessionState.CreateDefault2();
            iss.ExecutionPolicy = Microsoft.PowerShell.ExecutionPolicy.Bypass;
            _runspace = RunspaceFactory.CreateRunspace(iss);
            _runspace.Open();
            _lastUsed = DateTime.UtcNow;
        }

        public string Owner { get { return _owner; } }

        public bool IsIdleExpired(TimeSpan ttl)
        {
            lock (_lock)
            {
                return DateTime.UtcNow - _lastUsed > ttl;
            }
        }

        /// <summary>
        /// Runs the raw command text in this session's runspace and returns the
        /// output rendered as text (Out-String -Width 200), plus any error text.
        /// </summary>
        public Dictionary<string, object> Run(string commandText)
        {
            lock (_lock)
            {
                _lastUsed = DateTime.UtcNow;
                StringBuilder output = new StringBuilder();
                List<string> errors = new List<string>();
                using (PowerShell ps = PowerShell.Create())
                {
                    ps.Runspace = _runspace;
                    // The operator's text is the script; pipe it through
                    // Out-String so every object renders the way the console
                    // would show it. This is intentional full control.
                    ps.AddScript(commandText);
                    ps.AddCommand("Out-String").AddParameter("Width", 200);
                    Collection<PSObject> results;
                    try
                    {
                        results = ps.Invoke();
                    }
                    catch (RuntimeException rex)
                    {
                        errors.Add(rex.Message);
                        results = new Collection<PSObject>();
                    }
                    foreach (PSObject o in results)
                    {
                        if (o != null) { output.Append(o.ToString()); }
                    }
                    if (ps.Streams != null)
                    {
                        foreach (ErrorRecord e in ps.Streams.Error)
                        {
                            errors.Add(e.ToString());
                        }
                    }
                }
                Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
                result["output"] = output.ToString();
                result["errors"] = errors;
                result["prompt"] = "PS " + CurrentLocation() + "> ";
                return result;
            }
        }

        private string CurrentLocation()
        {
            try
            {
                return _runspace.SessionStateProxy.Path.CurrentLocation.Path;
            }
            catch (Exception)
            {
                return "";
            }
        }

        public void Close()
        {
            lock (_lock)
            {
                try { _runspace.Close(); _runspace.Dispose(); } catch (Exception) { }
            }
        }
    }

    /// <summary>
    /// The PowerShell console and the generic module runner (scope=all). Both
    /// require a fresh elevation token because they are full control of the
    /// domain controller.
    /// </summary>
    public class ServerConsoleModule : IAgentModule
    {
        private static readonly object _lock = new object();
        private static readonly Dictionary<string, ConsoleSession> _sessions =
            new Dictionary<string, ConsoleSession>(StringComparer.Ordinal);
        private static readonly TimeSpan IdleTtl = TimeSpan.FromMinutes(20);

        // Only "console" is registered here. The generic module runner
        // (cmdlets-all) rides on the existing /cmdlets and /cmdlets/invoke routes
        // owned by the cmdlet-runner module; this module does not re-register
        // those paths (the router is first-match), so it does not advertise that
        // capability. See docs/SERVER.md.
        public string[] Capabilities { get { return new string[] { "console" }; } }

        public void Register(Router router)
        {
            router.Map("POST", "server/console/sessions", true, true, NewSession);
            router.Map("POST", "server/console/sessions/{id}/run", true, true, Run);
            router.Map("DELETE", "server/console/sessions/{id}", true, true, Close);
        }

        private void Sweep()
        {
            lock (_lock)
            {
                List<string> expired = new List<string>();
                foreach (KeyValuePair<string, ConsoleSession> kv in _sessions)
                {
                    if (kv.Value.IsIdleExpired(IdleTtl)) { expired.Add(kv.Key); }
                }
                foreach (string id in expired)
                {
                    _sessions[id].Close();
                    _sessions.Remove(id);
                }
            }
        }

        private object NewSession(RequestContext ctx)
        {
            Sweep();
            string id = Guid.NewGuid().ToString("N");
            ConsoleSession session = new ConsoleSession(ctx.ActingUser);
            lock (_lock)
            {
                if (_sessions.Count >= 50)
                {
                    throw AgentException.Conflict("Too many open console sessions.");
                }
                _sessions[id] = session;
            }
            ctx.Audit("console session open", id);
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            result["sessionId"] = id;
            return StatusResult.Created(result);
        }

        private object Run(RequestContext ctx)
        {
            Sweep();
            string id = ctx.Route("id");
            ConsoleSession session;
            lock (_lock)
            {
                if (!_sessions.TryGetValue(id, out session))
                {
                    throw AgentException.NotFound("No such console session, or it expired after 20 minutes idle.");
                }
            }
            if (!string.Equals(session.Owner, ctx.ActingUser, StringComparison.OrdinalIgnoreCase))
            {
                throw AgentException.Forbidden("This console session belongs to another administrator.");
            }
            Dictionary<string, object> body = ctx.BodyJson();
            string command = Json.GetString(body, "command");
            if (command == null) { command = string.Empty; }
            // Every command is audited with the acting user and the full text.
            ctx.Audit("console command", command);
            return session.Run(command);
        }

        private object Close(RequestContext ctx)
        {
            string id = ctx.Route("id");
            lock (_lock)
            {
                ConsoleSession session;
                if (_sessions.TryGetValue(id, out session))
                {
                    session.Close();
                    _sessions.Remove(id);
                }
            }
            ctx.Audit("console session close", id);
            return StatusResult.NoContent();
        }
    }
}
