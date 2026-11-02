using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace TempDesk.Agent
{
    /// <summary>
    /// Shared helpers for every server-management module. All PowerShell goes
    /// through RequestContext.Ps with AddCommand/AddParameter dictionaries, so
    /// user input is never compiled as script text. External tools (wevtutil,
    /// reg, netsh) run through RunProcess with each argument validated and quoted.
    /// </summary>
    internal static class Srv
    {
        internal static readonly Regex ServiceName = new Regex("^[A-Za-z0-9 ._()-]{1,256}$");
        internal static readonly Regex ComputerName = new Regex("^[A-Za-z0-9-]{1,15}$");
        internal static readonly Regex LogName = new Regex("^[A-Za-z0-9 ._/-]{1,255}$");
        internal static readonly Regex SimpleName = new Regex("^[A-Za-z0-9 ._-]{1,128}$");
        internal static readonly Regex Thumbprint = new Regex("^[A-Fa-f0-9]{40}$");

        // ----------------------------------------------------------- PowerShell

        /// <summary>Runs a cmdlet and returns every output object as a dictionary.</summary>
        internal static List<Dictionary<string, object>> Ps(RequestContext ctx, string command, IDictionary<string, object> parameters)
        {
            if (ctx.Ps == null)
            {
                throw AgentException.Internal("PowerShell is not available on this agent.");
            }
            return ctx.Ps.Invoke(command, parameters);
        }

        internal static Dictionary<string, object> P()
        {
            return new Dictionary<string, object>(StringComparer.Ordinal);
        }

        /// <summary>First output row, or null.</summary>
        internal static Dictionary<string, object> PsOne(RequestContext ctx, string command, IDictionary<string, object> parameters)
        {
            List<Dictionary<string, object>> rows = Ps(ctx, command, parameters);
            return rows.Count > 0 ? rows[0] : null;
        }

        // ----------------------------------------------------------- reading dicts

        internal static object Get(Dictionary<string, object> d, string key)
        {
            object v;
            if (d != null && d.TryGetValue(key, out v)) { return v; }
            return null;
        }

        internal static string Str(Dictionary<string, object> d, string key)
        {
            object v = Get(d, key);
            return v == null ? null : Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        internal static double Num(Dictionary<string, object> d, string key)
        {
            object v = Get(d, key);
            if (v == null) { return 0; }
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); }
            catch (Exception) { return 0; }
        }

        internal static long Long(Dictionary<string, object> d, string key)
        {
            object v = Get(d, key);
            if (v == null) { return 0; }
            try { return Convert.ToInt64(v, CultureInfo.InvariantCulture); }
            catch (Exception) { return 0; }
        }

        // ----------------------------------------------------------- input validation

        internal static string RequireAbsolutePath(string path)
        {
            if (string.IsNullOrEmpty(path))
            {
                throw AgentException.BadRequest("A path is required.");
            }
            // Must be a rooted local path: a drive (C:\...) or a UNC (\\server\share).
            bool drive = path.Length >= 3 && IsLetter(path[0]) && path[1] == ':' && (path[2] == '\\' || path[2] == '/');
            bool unc = path.StartsWith("\\\\", StringComparison.Ordinal);
            if (!drive && !unc)
            {
                throw AgentException.BadRequest("Path must be absolute, for example C:\\folder or \\\\server\\share.");
            }
            if (path.IndexOf("..", StringComparison.Ordinal) >= 0)
            {
                throw AgentException.BadRequest("Path may not contain '..'.");
            }
            foreach (char c in path)
            {
                if (c < 32)
                {
                    throw AgentException.BadRequest("Path contains a control character.");
                }
            }
            return path;
        }

        private static bool IsLetter(char c)
        {
            return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
        }

        internal static string LeafName(string path)
        {
            string p = path.TrimEnd('\\', '/');
            int i = p.LastIndexOfAny(new char[] { '\\', '/' });
            return i >= 0 ? p.Substring(i + 1) : p;
        }

        /// <summary>
        /// Throws unless the body field "confirm" equals <paramref name="expected"/>.
        /// </summary>
        internal static void RequireConfirm(Dictionary<string, object> body, string expected)
        {
            string confirm = Json.GetString(body, "confirm");
            if (!string.Equals(confirm, expected, StringComparison.Ordinal))
            {
                throw AgentException.BadRequest("This action is destructive; set \"confirm\" to \"" + expected + "\".");
            }
        }

        internal static void RequireConfirmQuery(RequestContext ctx, string expected)
        {
            string confirm = ctx.Query["confirm"];
            if (!string.Equals(confirm, expected, StringComparison.Ordinal))
            {
                throw AgentException.BadRequest("This action is destructive; set the \"confirm\" query value to \"" + expected + "\".");
            }
        }

        // ----------------------------------------------------------- external tools

        /// <summary>
        /// Runs a console tool with an argv list. Every argument is quoted with
        /// the Windows command-line rules; callers validate inputs first so a
        /// value can never break out into another argument.
        /// </summary>
        internal static ProcessResult RunProcess(string exe, string[] args, int timeoutMs)
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = exe;
            psi.Arguments = JoinArgs(args);
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;

            using (Process p = new Process())
            {
                p.StartInfo = psi;
                StringBuilder outBuf = new StringBuilder();
                StringBuilder errBuf = new StringBuilder();
                p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e)
                {
                    if (e.Data != null) { outBuf.AppendLine(e.Data); }
                };
                p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e)
                {
                    if (e.Data != null) { errBuf.AppendLine(e.Data); }
                };
                try
                {
                    p.Start();
                }
                catch (Exception ex)
                {
                    throw AgentException.Internal("Could not start " + exe + ": " + ex.Message);
                }
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
                if (!p.WaitForExit(timeoutMs))
                {
                    try { p.Kill(); } catch (Exception) { }
                    throw AgentException.Internal(exe + " did not finish within the time limit.");
                }
                p.WaitForExit();
                ProcessResult r = new ProcessResult();
                r.ExitCode = p.ExitCode;
                r.StdOut = outBuf.ToString();
                r.StdErr = errBuf.ToString();
                return r;
            }
        }

        private static string JoinArgs(string[] args)
        {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < args.Length; i++)
            {
                if (i > 0) { sb.Append(' '); }
                sb.Append(QuoteArg(args[i]));
            }
            return sb.ToString();
        }

        // Standard CommandLineToArgvW-compatible quoting.
        private static string QuoteArg(string arg)
        {
            if (arg == null) { arg = string.Empty; }
            if (arg.Length > 0 && arg.IndexOfAny(new char[] { ' ', '\t', '\n', '\v', '"' }) < 0)
            {
                return arg;
            }
            StringBuilder sb = new StringBuilder();
            sb.Append('"');
            int backslashes = 0;
            foreach (char c in arg)
            {
                if (c == '\\')
                {
                    backslashes++;
                }
                else if (c == '"')
                {
                    sb.Append('\\', backslashes * 2 + 1);
                    backslashes = 0;
                    sb.Append('"');
                }
                else
                {
                    sb.Append('\\', backslashes);
                    backslashes = 0;
                    sb.Append(c);
                }
            }
            sb.Append('\\', backslashes * 2);
            sb.Append('"');
            return sb.ToString();
        }

        internal static string NewTempFile(string extension)
        {
            string dir = Path.Combine(Path.GetTempPath(), "TempDeskSrv");
            Directory.CreateDirectory(dir);
            string name = Guid.NewGuid().ToString("N") + extension;
            return Path.Combine(dir, name);
        }

        internal static RawResult FileDownload(string path, string contentType, string downloadName)
        {
            byte[] bytes;
            try
            {
                bytes = File.ReadAllBytes(path);
            }
            catch (FileNotFoundException)
            {
                throw AgentException.NotFound("The file was not found.");
            }
            catch (DirectoryNotFoundException)
            {
                throw AgentException.NotFound("The file was not found.");
            }
            catch (UnauthorizedAccessException)
            {
                throw AgentException.Forbidden("Access to the file was denied.");
            }
            RawResult r = new RawResult(200, contentType, bytes);
            r.FileName = downloadName;
            return r;
        }
    }

    internal class ProcessResult
    {
        public int ExitCode;
        public string StdOut;
        public string StdErr;
    }

    /// <summary>
    /// Server overview, live metrics, power control, identity, services,
    /// processes and the Windows event logs.
    /// </summary>
    public class ServerOverviewModule : IAgentModule
    {
        public string[] Capabilities
        {
            get { return new string[] { "server", "services", "processes", "events" }; }
        }

        public void Register(Router router)
        {
            router.Map("GET", "server/overview", true, false, Overview);
            router.Map("GET", "server/metrics", true, false, Metrics);
            router.Map("POST", "server/power", true, false, Power);
            router.Map("PUT", "server/identity", true, false, Identity);

            router.Map("GET", "server/services", true, false, Services);
            router.Map("POST", "server/services/{name}/{op}", true, false, ServiceOp);
            router.Map("PATCH", "server/services/{name}", true, false, ServiceStartup);

            router.Map("GET", "server/processes", true, false, Processes);
            router.Map("DELETE", "server/processes/{pid}", true, false, KillProcess);

            router.Map("GET", "server/eventlogs", true, false, EventLogs);
            router.Map("GET", "server/events", true, false, Events);
            router.Map("POST", "server/eventlogs/{name}/clear", true, false, ClearLog);
            router.Map("GET", "server/eventlogs/{name}/export", true, false, ExportLog);
        }

        // ------------------------------------------------------------- overview

        private object Overview(RequestContext ctx)
        {
            Dictionary<string, object> os = Srv.PsOne(ctx, "Get-CimInstance",
                Params("ClassName", "Win32_OperatingSystem"));
            Dictionary<string, object> cs = Srv.PsOne(ctx, "Get-CimInstance",
                Params("ClassName", "Win32_ComputerSystem"));

            Dictionary<string, object> result = Srv.P();
            result["computerName"] = Srv.Str(cs, "Name");
            result["domain"] = Srv.Str(cs, "Domain");
            result["os"] = Srv.Str(os, "Caption");
            result["version"] = Srv.Str(os, "Version");
            result["edition"] = InstallationType(ctx);
            result["domainRole"] = DomainRoleName(Srv.Long(cs, "DomainRole"));

            object boot = Srv.Get(os, "LastBootUpTime");
            result["lastBoot"] = boot;
            result["uptimeSeconds"] = UptimeSeconds(boot);

            double totalMem = Srv.Num(os, "TotalVisibleMemorySize") * 1024.0;
            double freeMem = Srv.Num(os, "FreePhysicalMemory") * 1024.0;
            result["memoryTotalBytes"] = (long)totalMem;
            result["memoryUsedBytes"] = (long)(totalMem - freeMem);

            result["cpu"] = ProcessorSummary(ctx);
            result["disks"] = DiskSummary(ctx);
            result["network"] = AdapterSummary(ctx);
            return result;
        }

        private string InstallationType(RequestContext ctx)
        {
            try
            {
                Dictionary<string, object> row = Srv.PsOne(ctx, "Get-ItemProperty",
                    Params("Path", "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion"));
                string t = Srv.Str(row, "InstallationType");
                if (!string.IsNullOrEmpty(t))
                {
                    return string.Equals(t, "Server Core", StringComparison.OrdinalIgnoreCase) ? "Core" : "Desktop";
                }
            }
            catch (AgentException) { }
            return "Unknown";
        }

        private object ProcessorSummary(RequestContext ctx)
        {
            Dictionary<string, object> cpu = Srv.PsOne(ctx, "Get-CimInstance",
                Params("ClassName", "Win32_Processor"));
            Dictionary<string, object> d = Srv.P();
            d["name"] = Srv.Str(cpu, "Name");
            d["cores"] = Srv.Long(cpu, "NumberOfCores");
            d["logical"] = Srv.Long(cpu, "NumberOfLogicalProcessors");
            return d;
        }

        private object DiskSummary(RequestContext ctx)
        {
            List<object> list = new List<object>();
            List<Dictionary<string, object>> vols = Srv.Ps(ctx, "Get-CimInstance",
                Params("ClassName", "Win32_LogicalDisk"));
            foreach (Dictionary<string, object> v in vols)
            {
                if (Srv.Long(v, "DriveType") != 3) { continue; }
                Dictionary<string, object> d = Srv.P();
                d["drive"] = Srv.Str(v, "DeviceID");
                d["sizeBytes"] = Srv.Long(v, "Size");
                d["freeBytes"] = Srv.Long(v, "FreeSpace");
                list.Add(d);
            }
            return list;
        }

        private object AdapterSummary(RequestContext ctx)
        {
            List<object> list = new List<object>();
            try
            {
                List<Dictionary<string, object>> nics = Srv.Ps(ctx, "Get-NetAdapter", Srv.P());
                foreach (Dictionary<string, object> n in nics)
                {
                    Dictionary<string, object> d = Srv.P();
                    d["name"] = Srv.Str(n, "Name");
                    d["status"] = Srv.Str(n, "Status");
                    d["linkSpeed"] = Srv.Str(n, "LinkSpeed");
                    list.Add(d);
                }
            }
            catch (AgentException) { }
            return list;
        }

        // ------------------------------------------------------------- metrics

        private object Metrics(RequestContext ctx)
        {
            Dictionary<string, object> result = Srv.P();
            result["time"] = Json.Iso(DateTime.UtcNow);

            // CPU %
            double cpu = 0;
            List<Dictionary<string, object>> procs = Srv.Ps(ctx, "Get-CimInstance",
                Params("ClassName", "Win32_PerfFormattedData_PerfOS_Processor"));
            foreach (Dictionary<string, object> p in procs)
            {
                if (string.Equals(Srv.Str(p, "Name"), "_Total", StringComparison.OrdinalIgnoreCase))
                {
                    cpu = Srv.Num(p, "PercentProcessorTime");
                }
            }
            result["cpuPercent"] = cpu;

            // Memory
            Dictionary<string, object> os = Srv.PsOne(ctx, "Get-CimInstance",
                Params("ClassName", "Win32_OperatingSystem"));
            double totalMem = Srv.Num(os, "TotalVisibleMemorySize") * 1024.0;
            double freeMem = Srv.Num(os, "FreePhysicalMemory") * 1024.0;
            result["memoryTotalBytes"] = (long)totalMem;
            result["memoryUsedBytes"] = (long)(totalMem - freeMem);

            // Per-disk read/write bytes per second
            List<object> disks = new List<object>();
            List<Dictionary<string, object>> disk = Srv.Ps(ctx, "Get-CimInstance",
                Params("ClassName", "Win32_PerfFormattedData_PerfDisk_PhysicalDisk"));
            foreach (Dictionary<string, object> dd in disk)
            {
                string name = Srv.Str(dd, "Name");
                if (string.Equals(name, "_Total", StringComparison.OrdinalIgnoreCase)) { continue; }
                Dictionary<string, object> row = Srv.P();
                row["name"] = name;
                row["readBytesPerSec"] = Srv.Long(dd, "DiskReadBytesPersec");
                row["writeBytesPerSec"] = Srv.Long(dd, "DiskWriteBytesPersec");
                disks.Add(row);
            }
            result["disks"] = disks;

            // Per-NIC send/receive bytes per second
            List<object> nics = new List<object>();
            List<Dictionary<string, object>> net = Srv.Ps(ctx, "Get-CimInstance",
                Params("ClassName", "Win32_PerfFormattedData_Tcpip_NetworkInterface"));
            foreach (Dictionary<string, object> nn in net)
            {
                Dictionary<string, object> row = Srv.P();
                row["name"] = Srv.Str(nn, "Name");
                row["receiveBytesPerSec"] = Srv.Long(nn, "BytesReceivedPersec");
                row["sendBytesPerSec"] = Srv.Long(nn, "BytesSentPersec");
                nics.Add(row);
            }
            result["network"] = nics;
            return result;
        }

        // ------------------------------------------------------------- power

        private object Power(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string action = Json.RequireString(body, "action", 16);
            if (!string.Equals(action, "restart", StringComparison.Ordinal) &&
                !string.Equals(action, "shutdown", StringComparison.Ordinal))
            {
                throw AgentException.BadRequest("action must be 'restart' or 'shutdown'.");
            }
            Srv.RequireConfirm(body, action);
            long delay = 30;
            long? d = Json.GetLong(body, "delaySeconds");
            if (d.HasValue) { delay = d.Value; }
            if (delay < 0 || delay > 86400)
            {
                throw AgentException.BadRequest("delaySeconds must be between 0 and 86400.");
            }
            string flag = string.Equals(action, "restart", StringComparison.Ordinal) ? "/r" : "/s";
            ctx.Audit("server power " + action, delay.ToString(CultureInfo.InvariantCulture) + "s");
            Srv.RunProcess("shutdown.exe",
                new string[] { flag, "/t", delay.ToString(CultureInfo.InvariantCulture), "/c", "TempDesk admin console: " + action },
                15000);
            Dictionary<string, object> result = Srv.P();
            result["action"] = action;
            result["delaySeconds"] = delay;
            result["scheduled"] = true;
            return result;
        }

        private object Identity(RequestContext ctx)
        {
            Dictionary<string, object> body = ctx.BodyJson();
            string name = Json.RequireString(body, "computerName", 15);
            if (!Srv.ComputerName.IsMatch(name))
            {
                throw AgentException.BadRequest("computerName must be 1 to 15 letters, digits or hyphens.");
            }
            ctx.Audit("server rename", name);
            Srv.Ps(ctx, "Rename-Computer", Params("NewName", name, "Force", true));
            Dictionary<string, object> result = Srv.P();
            result["computerName"] = name;
            result["restartRequired"] = true;
            return result;
        }

        // ------------------------------------------------------------- services

        private object Services(RequestContext ctx)
        {
            List<object> list = new List<object>();
            List<Dictionary<string, object>> rows = Srv.Ps(ctx, "Get-CimInstance",
                Params("ClassName", "Win32_Service"));
            foreach (Dictionary<string, object> s in rows)
            {
                Dictionary<string, object> d = Srv.P();
                d["name"] = Srv.Str(s, "Name");
                d["displayName"] = Srv.Str(s, "DisplayName");
                d["status"] = Srv.Str(s, "State");
                d["startupType"] = NormalizeStartMode(Srv.Str(s, "StartMode"), Srv.Str(s, "DelayedAutoStart"));
                d["account"] = Srv.Str(s, "StartName");
                d["description"] = Srv.Str(s, "Description");
                list.Add(d);
            }
            return list;
        }

        private object ServiceOp(RequestContext ctx)
        {
            string name = ctx.Route("name");
            string op = ctx.Route("op");
            if (!Srv.ServiceName.IsMatch(name))
            {
                throw AgentException.BadRequest("Invalid service name.");
            }
            string command;
            switch (op.ToLowerInvariant())
            {
                case "start": command = "Start-Service"; break;
                case "stop": command = "Stop-Service"; break;
                case "restart": command = "Restart-Service"; break;
                case "pause": command = "Suspend-Service"; break;
                case "resume": command = "Resume-Service"; break;
                default:
                    throw AgentException.BadRequest("Unknown service operation '" + op + "'.");
            }
            ctx.Audit("service " + op, name);
            IDictionary<string, object> p = Params("Name", name);
            if (command == "Stop-Service" || command == "Restart-Service") { p["Force"] = true; }
            Srv.Ps(ctx, command, p);
            return StatusResult.NoContent();
        }

        private object ServiceStartup(RequestContext ctx)
        {
            string name = ctx.Route("name");
            if (!Srv.ServiceName.IsMatch(name))
            {
                throw AgentException.BadRequest("Invalid service name.");
            }
            Dictionary<string, object> body = ctx.BodyJson();
            string type = Json.RequireString(body, "startupType", 32);
            ctx.Audit("service startup " + type, name);

            if (string.Equals(type, "AutomaticDelayed", StringComparison.OrdinalIgnoreCase))
            {
                // Set-Service has no delayed-auto option, so use sc.exe config.
                ProcessResult r = Srv.RunProcess("sc.exe", new string[] { "config", name, "start=", "delayed-auto" }, 15000);
                if (r.ExitCode != 0)
                {
                    throw AgentException.Internal("sc.exe config failed: " + r.StdErr + r.StdOut);
                }
                return StatusResult.NoContent();
            }
            string ps;
            switch (type)
            {
                case "Automatic": ps = "Automatic"; break;
                case "Manual": ps = "Manual"; break;
                case "Disabled": ps = "Disabled"; break;
                default:
                    throw AgentException.BadRequest("startupType must be Automatic, AutomaticDelayed, Manual or Disabled.");
            }
            Srv.Ps(ctx, "Set-Service", Params("Name", name, "StartupType", ps));
            return StatusResult.NoContent();
        }

        private static string NormalizeStartMode(string mode, string delayed)
        {
            if (string.IsNullOrEmpty(mode)) { return null; }
            if (string.Equals(mode, "Auto", StringComparison.OrdinalIgnoreCase))
            {
                bool isDelayed = string.Equals(delayed, "True", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(delayed, "1", StringComparison.OrdinalIgnoreCase);
                return isDelayed ? "AutomaticDelayed" : "Automatic";
            }
            return mode;
        }

        // ------------------------------------------------------------- processes

        private object Processes(RequestContext ctx)
        {
            List<object> list = new List<object>();
            List<Dictionary<string, object>> rows = Srv.Ps(ctx, "Get-Process", Srv.P());
            foreach (Dictionary<string, object> p in rows)
            {
                Dictionary<string, object> d = Srv.P();
                d["pid"] = Srv.Long(p, "Id");
                d["name"] = Srv.Str(p, "ProcessName");
                d["cpu"] = Srv.Num(p, "CPU");
                d["memoryBytes"] = Srv.Long(p, "WorkingSet64");
                d["path"] = Srv.Str(p, "Path");
                d["startTime"] = Srv.Get(p, "StartTime");
                list.Add(d);
            }
            return list;
        }

        private object KillProcess(RequestContext ctx)
        {
            string pidText = ctx.Route("pid");
            long pid;
            if (!long.TryParse(pidText, NumberStyles.Integer, CultureInfo.InvariantCulture, out pid) || pid < 0)
            {
                throw AgentException.BadRequest("pid must be a non-negative integer.");
            }
            Dictionary<string, object> proc = null;
            try
            {
                proc = Srv.PsOne(ctx, "Get-Process", Params("Id", pid));
            }
            catch (AgentException)
            {
                throw AgentException.NotFound("No process with that id.");
            }
            string name = Srv.Str(proc, "ProcessName");
            Srv.RequireConfirmQuery(ctx, name);
            ctx.Audit("process kill", name + " (" + pid + ")");
            Srv.Ps(ctx, "Stop-Process", Params("Id", pid, "Force", true));
            return StatusResult.NoContent();
        }

        // ------------------------------------------------------------- events

        private object EventLogs(RequestContext ctx)
        {
            List<object> list = new List<object>();
            List<Dictionary<string, object>> rows = Srv.Ps(ctx, "Get-WinEvent",
                Params("ListLog", "*"));
            foreach (Dictionary<string, object> l in rows)
            {
                Dictionary<string, object> d = Srv.P();
                d["name"] = Srv.Str(l, "LogName");
                d["recordCount"] = Srv.Long(l, "RecordCount");
                d["isEnabled"] = Srv.Get(l, "IsEnabled");
                d["logMode"] = Srv.Str(l, "LogMode");
                list.Add(d);
            }
            return list;
        }

        private object Events(RequestContext ctx)
        {
            string log = ctx.Query["log"];
            if (string.IsNullOrEmpty(log)) { log = "System"; }
            if (!Srv.LogName.IsMatch(log))
            {
                throw AgentException.BadRequest("Invalid log name.");
            }
            long limit = 200;
            string limitText = ctx.Query["limit"];
            if (!string.IsNullOrEmpty(limitText))
            {
                long.TryParse(limitText, NumberStyles.Integer, CultureInfo.InvariantCulture, out limit);
            }
            if (limit < 1) { limit = 1; }
            if (limit > 1000) { limit = 1000; }

            // Build a FilterHashtable so values are passed as data, not script.
            Hashtable filter = new Hashtable();
            filter["LogName"] = log;
            string levels = ctx.Query["level"];
            if (!string.IsNullOrEmpty(levels))
            {
                List<object> levelList = new List<object>();
                foreach (string piece in levels.Split(','))
                {
                    int lv;
                    if (int.TryParse(piece.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out lv))
                    {
                        levelList.Add(lv);
                    }
                }
                if (levelList.Count > 0) { filter["Level"] = levelList.ToArray(); }
            }
            string since = ctx.Query["since"];
            if (!string.IsNullOrEmpty(since))
            {
                DateTime dt;
                if (DateTime.TryParse(since, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out dt))
                {
                    filter["StartTime"] = dt;
                }
            }

            IDictionary<string, object> p = Params("FilterHashtable", filter, "MaxEvents", limit, "ErrorAction", "SilentlyContinue");
            List<Dictionary<string, object>> rows;
            try
            {
                rows = ctx.Ps.Invoke("Get-WinEvent", p);
            }
            catch (AgentException)
            {
                // No matching events is reported by Get-WinEvent as an error; treat as empty.
                return new List<object>();
            }

            string q = ctx.Query["q"];
            List<object> list = new List<object>();
            foreach (Dictionary<string, object> e in rows)
            {
                string message = Srv.Str(e, "Message");
                if (!string.IsNullOrEmpty(q) && (message == null || message.IndexOf(q, StringComparison.OrdinalIgnoreCase) < 0))
                {
                    continue;
                }
                Dictionary<string, object> d = Srv.P();
                d["id"] = Srv.Long(e, "Id");
                d["level"] = Srv.Long(e, "Level");
                d["levelName"] = Srv.Str(e, "LevelDisplayName");
                d["provider"] = Srv.Str(e, "ProviderName");
                d["timeCreated"] = Srv.Get(e, "TimeCreated");
                d["recordId"] = Srv.Long(e, "RecordId");
                d["message"] = message;
                list.Add(d);
            }
            return list;
        }

        private object ClearLog(RequestContext ctx)
        {
            string name = ctx.Route("name");
            if (!Srv.LogName.IsMatch(name))
            {
                throw AgentException.BadRequest("Invalid log name.");
            }
            Srv.RequireConfirm(ctx.BodyJson(), name);
            ctx.Audit("eventlog clear", name);
            ProcessResult r = Srv.RunProcess("wevtutil.exe", new string[] { "cl", name }, 30000);
            if (r.ExitCode != 0)
            {
                throw AgentException.Internal("wevtutil could not clear the log: " + r.StdErr + r.StdOut);
            }
            return StatusResult.NoContent();
        }

        private object ExportLog(RequestContext ctx)
        {
            string name = ctx.Route("name");
            if (!Srv.LogName.IsMatch(name))
            {
                throw AgentException.BadRequest("Invalid log name.");
            }
            string temp = Srv.NewTempFile(".evtx");
            ctx.Audit("eventlog export", name);
            ProcessResult r = Srv.RunProcess("wevtutil.exe", new string[] { "epl", name, temp }, 120000);
            if (r.ExitCode != 0)
            {
                throw AgentException.Internal("wevtutil could not export the log: " + r.StdErr + r.StdOut);
            }
            try
            {
                string leaf = name.Replace('/', '-').Replace('\\', '-').Replace(' ', '-');
                return Srv.FileDownload(temp, "application/octet-stream", leaf + ".evtx");
            }
            finally
            {
                try { File.Delete(temp); } catch (Exception) { }
            }
        }

        // ------------------------------------------------------------- shaping helpers

        private static IDictionary<string, object> Params(params object[] kv)
        {
            Dictionary<string, object> d = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int i = 0; i + 1 < kv.Length; i += 2)
            {
                d[Convert.ToString(kv[i], CultureInfo.InvariantCulture)] = kv[i + 1];
            }
            return d;
        }

        private static long UptimeSeconds(object boot)
        {
            DateTime dt;
            string s = boot as string;
            if (s != null && DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out dt))
            {
                return (long)(DateTime.UtcNow - dt).TotalSeconds;
            }
            if (boot is DateTime)
            {
                return (long)(DateTime.UtcNow - ((DateTime)boot).ToUniversalTime()).TotalSeconds;
            }
            return 0;
        }

        private static string DomainRoleName(long role)
        {
            switch (role)
            {
                case 0: return "Standalone Workstation";
                case 1: return "Member Workstation";
                case 2: return "Standalone Server";
                case 3: return "Member Server";
                case 4: return "Backup Domain Controller";
                case 5: return "Primary Domain Controller";
                default: return "Unknown";
            }
        }
    }
}
