using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Management.Automation;
using System.Management.Automation.Runspaces;

namespace TempDesk.Agent
{
    /// <summary>
    /// Metadata for one allowlisted cmdlet, gathered once at startup with
    /// Get-Command so we never have to guess parameter names or build script
    /// text from user input.
    /// </summary>
    public class CmdletInfo
    {
        public string Name;
        public string Module;
        public string Verb;
        public string Noun;
        public List<CmdletParam> Parameters = new List<CmdletParam>();
        public HashSet<string> SwitchParams = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        public HashSet<string> ParamNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    }

    public class CmdletParam
    {
        public string Name;
        public string Type;
        public bool Mandatory;
        public List<string> Sets = new List<string>();
        public bool IsSwitch;
    }

    /// <summary>
    /// A thin wrapper over a RunspacePool that imports the ActiveDirectory and
    /// GroupPolicy modules. This is the PowerShellHost that modules receive on
    /// RequestContext.Ps. Invoke always uses AddCommand/AddParameter; it never
    /// compiles script text, so user input can never be interpreted as code.
    /// </summary>
    public class PowerShellHost : IDisposable
    {
        private readonly RunspacePool _pool;
        private readonly object _lock = new object();
        private readonly Dictionary<string, CmdletInfo> _cmdlets =
            new Dictionary<string, CmdletInfo>(StringComparer.OrdinalIgnoreCase);
        private bool _catalogLoaded;

        // Every installed module's commands, for the elevated scope=all runner.
        // Loaded lazily on first use (it can take several seconds) and cached.
        private readonly Dictionary<string, CmdletInfo> _allCmdlets =
            new Dictionary<string, CmdletInfo>(StringComparer.OrdinalIgnoreCase);
        private bool _allLoaded;
        private readonly object _allLock = new object();

        public PowerShellHost()
        {
            InitialSessionState iss = InitialSessionState.CreateDefault2();
            // Import the two modules every GPO/AD operation relies on.
            iss.ImportPSModule(new string[] { "ActiveDirectory", "GroupPolicy" });
            // Do not let an operator profile or execution policy interfere.
            iss.ExecutionPolicy = Microsoft.PowerShell.ExecutionPolicy.Bypass;

            // The (min, max, state, host) overload rejects a null host ("argument host is null"), which
            // left the agent without PowerShell. Create the pool from the session state and size it.
            _pool = RunspaceFactory.CreateRunspacePool(iss);
            _pool.SetMinRunspaces(1);
            _pool.SetMaxRunspaces(4);
            _pool.Open();
        }

        /// <summary>
        /// Builds the allowlist once: every command whose module is
        /// ActiveDirectory or GroupPolicy, with parameter metadata cached.
        /// </summary>
        public void LoadCatalog()
        {
            lock (_lock)
            {
                if (_catalogLoaded)
                {
                    return;
                }
                using (PowerShell ps = PowerShell.Create())
                {
                    ps.RunspacePool = _pool;
                    ps.AddCommand("Get-Command")
                      .AddParameter("Module", new string[] { "ActiveDirectory", "GroupPolicy" })
                      .AddParameter("CommandType", "Cmdlet,Function");
                    Collection<PSObject> results = ps.Invoke();
                    foreach (PSObject o in results)
                    {
                        CmdletInfo info = BuildInfo(o);
                        if (info != null && !_cmdlets.ContainsKey(info.Name))
                        {
                            _cmdlets[info.Name] = info;
                        }
                    }
                }
                _catalogLoaded = true;
            }
        }

        private static CmdletInfo BuildInfo(PSObject o)
        {
            try
            {
                CommandInfo cmd = o.BaseObject as CommandInfo;
                if (cmd == null)
                {
                    return null;
                }
                CmdletInfo info = new CmdletInfo();
                info.Name = cmd.Name;
                info.Module = cmd.ModuleName;
                string[] parts = cmd.Name.Split('-');
                if (parts.Length == 2)
                {
                    info.Verb = parts[0];
                    info.Noun = parts[1];
                }
                foreach (KeyValuePair<string, ParameterMetadata> kv in cmd.Parameters)
                {
                    ParameterMetadata pm = kv.Value;
                    CmdletParam p = new CmdletParam();
                    p.Name = pm.Name;
                    p.Type = pm.ParameterType != null ? pm.ParameterType.FullName : "System.Object";
                    p.IsSwitch = pm.ParameterType == typeof(SwitchParameter);
                    foreach (KeyValuePair<string, ParameterSetMetadata> set in pm.ParameterSets)
                    {
                        p.Sets.Add(set.Key);
                        if (set.Value.IsMandatory)
                        {
                            p.Mandatory = true;
                        }
                    }
                    info.Parameters.Add(p);
                    info.ParamNames.Add(p.Name);
                    if (p.IsSwitch)
                    {
                        info.SwitchParams.Add(p.Name);
                    }
                }
                return info;
            }
            catch (Exception)
            {
                return null;
            }
        }

        /// <summary>
        /// Builds the scope=all catalog once: every cmdlet and function from
        /// every installed module (module autoloading makes them available).
        /// </summary>
        public void LoadAllCatalog()
        {
            lock (_allLock)
            {
                if (_allLoaded)
                {
                    return;
                }
                using (PowerShell ps = PowerShell.Create())
                {
                    ps.RunspacePool = _pool;
                    ps.AddCommand("Get-Command")
                      .AddParameter("CommandType", "Cmdlet,Function");
                    Collection<PSObject> results = ps.Invoke();
                    foreach (PSObject o in results)
                    {
                        CmdletInfo info = BuildInfo(o);
                        if (info != null && !string.IsNullOrEmpty(info.Name) && !_allCmdlets.ContainsKey(info.Name))
                        {
                            _allCmdlets[info.Name] = info;
                        }
                    }
                }
                _allLoaded = true;
            }
        }

        public bool IsAllowedAll(string name)
        {
            LoadAllCatalog();
            lock (_allLock)
            {
                return _allCmdlets.ContainsKey(name);
            }
        }

        public CmdletInfo LookupAll(string name)
        {
            lock (_allLock)
            {
                CmdletInfo info;
                return _allCmdlets.TryGetValue(name, out info) ? info : null;
            }
        }

        public List<CmdletInfo> CatalogAll()
        {
            LoadAllCatalog();
            lock (_allLock)
            {
                return new List<CmdletInfo>(_allCmdlets.Values);
            }
        }

        /// <summary>Metadata from the allowlist, falling back to the scope=all catalog.</summary>
        private CmdletInfo LookupAny(string name)
        {
            CmdletInfo info = Lookup(name);
            return info != null ? info : LookupAll(name);
        }

        public bool IsAllowed(string name)
        {
            lock (_lock)
            {
                return _cmdlets.ContainsKey(name);
            }
        }

        public CmdletInfo Lookup(string name)
        {
            lock (_lock)
            {
                CmdletInfo info;
                return _cmdlets.TryGetValue(name, out info) ? info : null;
            }
        }

        public List<CmdletInfo> Catalog()
        {
            lock (_lock)
            {
                return new List<CmdletInfo>(_cmdlets.Values);
            }
        }

        /// <summary>
        /// Runs a single allowlisted command with the given parameters and
        /// returns each output object serialized to a dictionary (depth 3).
        /// Throws AgentException on a terminating error or non-empty error stream.
        /// This is the method modules call through RequestContext.Ps.
        /// </summary>
        public List<Dictionary<string, object>> Invoke(string command, IDictionary<string, object> parameters)
        {
            InvokeResult r = InvokeRaw(command, parameters, false);
            if (r.Errors.Count > 0)
            {
                throw AgentException.Internal(command + " failed: " + string.Join("; ", r.Errors.ToArray()));
            }
            List<Dictionary<string, object>> output = new List<Dictionary<string, object>>();
            foreach (object item in r.Output)
            {
                Dictionary<string, object> d = PsSerializer.ToDictionary(item);
                if (d != null)
                {
                    output.Add(d);
                }
            }
            return output;
        }

        public class InvokeResult
        {
            public List<object> Output = new List<object>();
            public List<string> Errors = new List<string>();
            public List<string> Warnings = new List<string>();
        }

        /// <summary>
        /// Runs a command and returns output, errors and warnings without
        /// throwing, for the cmdlet-runner route which reports all three. When
        /// addWhatIf is true a -WhatIf switch is added if the command supports it.
        /// </summary>
        public InvokeResult InvokeRaw(string command, IDictionary<string, object> parameters, bool addWhatIf)
        {
            InvokeResult result = new InvokeResult();
            using (PowerShell ps = PowerShell.Create())
            {
                ps.RunspacePool = _pool;
                ps.AddCommand(command);
                if (parameters != null)
                {
                    foreach (KeyValuePair<string, object> kv in parameters)
                    {
                        AddParameter(ps, command, kv.Key, kv.Value);
                    }
                }
                if (addWhatIf)
                {
                    CmdletInfo info = LookupAny(command);
                    if (info != null && info.ParamNames.Contains("WhatIf"))
                    {
                        ps.AddParameter("WhatIf");
                    }
                }

                Collection<PSObject> raw;
                try
                {
                    raw = ps.Invoke();
                }
                catch (RuntimeException rex)
                {
                    result.Errors.Add(rex.Message);
                    return result;
                }

                foreach (PSObject o in raw)
                {
                    result.Output.Add(o != null ? o.BaseObject : null);
                }
                if (ps.Streams != null)
                {
                    foreach (ErrorRecord e in ps.Streams.Error)
                    {
                        result.Errors.Add(e.ToString());
                    }
                    foreach (WarningRecord w in ps.Streams.Warning)
                    {
                        result.Warnings.Add(w.Message);
                    }
                }
            }
            return result;
        }

        /// <summary>
        /// Adds a parameter, converting a switch to the SwitchParameter form and
        /// letting the PowerShell binder convert everything else. Arrays become
        /// object[]; numbers and bools pass through.
        /// </summary>
        private void AddParameter(PowerShell ps, string command, string name, object value)
        {
            CmdletInfo info = LookupAny(command);
            bool isSwitch = info != null && info.SwitchParams.Contains(name);
            if (isSwitch)
            {
                bool on = value is bool ? (bool)value : true;
                if (on)
                {
                    ps.AddParameter(name);
                }
                return;
            }
            ps.AddParameter(name, CoerceValue(value));
        }

        /// <summary>
        /// Normalizes parsed-JSON values for the binder: lists to object[],
        /// nested dictionaries to hashtables, scalars unchanged.
        /// </summary>
        public static object CoerceValue(object value)
        {
            if (value == null)
            {
                return null;
            }
            List<object> list = Json.AsList(value);
            if (list != null)
            {
                object[] arr = new object[list.Count];
                for (int i = 0; i < list.Count; i++)
                {
                    arr[i] = CoerceValue(list[i]);
                }
                return arr;
            }
            IDictionary dict = value as IDictionary;
            if (dict != null)
            {
                Hashtable ht = new Hashtable();
                foreach (DictionaryEntry e in dict)
                {
                    ht[Convert.ToString(e.Key, CultureInfo.InvariantCulture)] = CoerceValue(e.Value);
                }
                return ht;
            }
            // Numbers: JavaScriptSerializer gives int/long/decimal/double; keep
            // integral values as long and let the binder narrow as needed.
            if (value is decimal)
            {
                decimal m = (decimal)value;
                if (m == decimal.Truncate(m) && m <= long.MaxValue && m >= long.MinValue)
                {
                    return (long)m;
                }
                return (double)m;
            }
            return value;
        }

        public void Dispose()
        {
            try
            {
                if (_pool != null)
                {
                    _pool.Close();
                    _pool.Dispose();
                }
            }
            catch (Exception)
            {
            }
        }
    }

    /// <summary>
    /// Serializes arbitrary PSObject/.NET output to JSON-friendly dictionaries,
    /// capped at depth 3 and 1000 collection items, with DateTime as ISO and
    /// enums as strings, as the API requires.
    /// </summary>
    public static class PsSerializer
    {
        private const int MaxDepth = 3;
        private const int MaxItems = 1000;

        public static Dictionary<string, object> ToDictionary(object value)
        {
            object converted = Convert3(value, 0);
            Dictionary<string, object> dict = converted as Dictionary<string, object>;
            if (dict != null)
            {
                return dict;
            }
            // Wrap scalars so the caller always gets a dictionary.
            Dictionary<string, object> wrapper = new Dictionary<string, object>(StringComparer.Ordinal);
            wrapper["value"] = converted;
            return wrapper;
        }

        public static object Convert3(object value, int depth)
        {
            if (value == null)
            {
                return null;
            }
            PSObject pso = value as PSObject;
            if (pso != null)
            {
                value = pso.BaseObject;
                // For a wrapper around a plain dictionary/primitive, unwrap;
                // otherwise expand its NoteProperties below.
                if (value is PSCustomObject)
                {
                    return ExpandProperties(pso, depth);
                }
            }

            if (value is string || value is bool)
            {
                return value;
            }
            if (value is Enum)
            {
                return value.ToString();
            }
            if (value is DateTime)
            {
                return Json.Iso((DateTime)value);
            }
            if (value is DateTimeOffset)
            {
                return Json.Iso(((DateTimeOffset)value).UtcDateTime);
            }
            if (value is Guid)
            {
                return value.ToString();
            }
            if (IsNumeric(value))
            {
                return value;
            }
            if (value is byte[])
            {
                return "b64:" + System.Convert.ToBase64String((byte[])value);
            }

            if (depth >= MaxDepth)
            {
                return value.ToString();
            }

            IDictionary dict = value as IDictionary;
            if (dict != null)
            {
                Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
                int n = 0;
                foreach (DictionaryEntry e in dict)
                {
                    if (n++ >= MaxItems) { break; }
                    result[System.Convert.ToString(e.Key, CultureInfo.InvariantCulture)] = Convert3(e.Value, depth + 1);
                }
                return result;
            }

            IEnumerable seq = value as IEnumerable;
            if (seq != null)
            {
                List<object> list = new List<object>();
                int n = 0;
                foreach (object item in seq)
                {
                    if (n++ >= MaxItems) { break; }
                    list.Add(Convert3(item, depth + 1));
                }
                return list;
            }

            // A plain object: expose its public properties as a dictionary.
            if (pso != null)
            {
                return ExpandProperties(pso, depth);
            }
            return ExpandProperties(new PSObject(value), depth);
        }

        private static object ExpandProperties(PSObject pso, int depth)
        {
            Dictionary<string, object> result = new Dictionary<string, object>(StringComparer.Ordinal);
            int n = 0;
            foreach (PSPropertyInfo prop in pso.Properties)
            {
                if (n++ >= MaxItems) { break; }
                object pv;
                try
                {
                    pv = prop.Value;
                }
                catch (Exception)
                {
                    pv = null;
                }
                result[prop.Name] = Convert3(pv, depth + 1);
            }
            return result;
        }

        private static bool IsNumeric(object v)
        {
            return v is int || v is long || v is short || v is byte || v is sbyte
                || v is uint || v is ulong || v is ushort
                || v is double || v is float || v is decimal;
        }
    }
}
