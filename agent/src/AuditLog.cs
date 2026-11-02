using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;

namespace TempDesk.Agent
{
    /// <summary>
    /// Writes to and reads from the Windows Application event log under the
    /// source "TempDesk Agent". Every admin call and every guest create/delete
    /// is recorded. The source must be registered once (install.ps1 does this,
    /// elevated); if it is missing we fall back to the generic source so logging
    /// never throws and never blocks a request.
    /// </summary>
    public class AuditLog
    {
        public const string SourceName = "TempDesk Agent";
        public const string LogName = "Application";

        private readonly bool _canWrite;

        public AuditLog()
        {
            bool ok = false;
            try
            {
                // Creating a source needs admin rights; the installer does it.
                // Here we only check and use it if present.
                ok = EventLog.SourceExists(SourceName);
            }
            catch (Exception)
            {
                ok = false;
            }
            _canWrite = ok;
        }

        private void Write(EventLogEntryType type, int eventId, string message)
        {
            try
            {
                if (_canWrite)
                {
                    EventLog.WriteEntry(SourceName, message, type, eventId);
                }
                else
                {
                    // Last resort so operators still see something in the log.
                    EventLog.WriteEntry("Application", "[TempDesk Agent] " + message, type, eventId);
                }
            }
            catch (Exception)
            {
                // Never let auditing failure break a request.
            }
        }

        /// <summary>Records an admin API call: who, which route, which target.</summary>
        public void Admin(string user, string route, string target)
        {
            string msg = "ADMIN user=" + Safe(user) + " route=" + Safe(route) + " target=" + Safe(target);
            Write(EventLogEntryType.Information, 1000, msg);
        }

        /// <summary>Records a guest account creation.</summary>
        public void GuestCreated(string username, string source)
        {
            Write(EventLogEntryType.Information, 1100,
                "GUEST_CREATE username=" + Safe(username) + " source=" + Safe(source));
        }

        /// <summary>Records a guest account deletion.</summary>
        public void GuestDeleted(string username, string by)
        {
            Write(EventLogEntryType.Information, 1101,
                "GUEST_DELETE username=" + Safe(username) + " by=" + Safe(by));
        }

        public void Warn(string message)
        {
            Write(EventLogEntryType.Warning, 1500, message);
        }

        public void Error(string message)
        {
            Write(EventLogEntryType.Error, 1900, message);
        }

        /// <summary>
        /// Returns recent entries from this source, newest first, for the
        /// /audit route. Reading the Application log requires suitable rights,
        /// which LocalSystem has.
        /// </summary>
        public List<Dictionary<string, object>> Recent(int limit)
        {
            if (limit <= 0) { limit = 200; }
            if (limit > 2000) { limit = 2000; }

            List<Dictionary<string, object>> result = new List<Dictionary<string, object>>();
            try
            {
                using (EventLog log = new EventLog(LogName))
                {
                    EventLogEntryCollection entries = log.Entries;
                    int total = entries.Count;
                    // Walk newest to oldest, keeping only our source.
                    for (int i = total - 1; i >= 0 && result.Count < limit; i--)
                    {
                        EventLogEntry e = entries[i];
                        if (!string.Equals(e.Source, SourceName, StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }
                        Dictionary<string, object> row = new Dictionary<string, object>(StringComparer.Ordinal);
                        row["time"] = Json.Iso(e.TimeGenerated.ToUniversalTime());
                        row["level"] = e.EntryType.ToString();
                        row["eventId"] = e.InstanceId & 0xFFFF;
                        row["message"] = e.Message;
                        result.Add(row);
                    }
                }
            }
            catch (Exception ex)
            {
                throw AgentException.Internal("Could not read the event log: " + ex.Message);
            }
            return result;
        }

        private static string Safe(string s)
        {
            if (string.IsNullOrEmpty(s))
            {
                return "-";
            }
            // Keep entries single-line and bounded.
            string cleaned = s.Replace("\r", " ").Replace("\n", " ");
            if (cleaned.Length > 400)
            {
                cleaned = cleaned.Substring(0, 400);
            }
            return cleaned;
        }
    }
}
