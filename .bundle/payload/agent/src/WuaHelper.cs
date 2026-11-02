// Windows Update Agent (WUA) client for the server Updates tool.
// Uses the documented WUA COM API (Microsoft.Update.Session) through late binding,
// so no interop assembly is needed. Every COM call runs on a dedicated STA thread.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Threading;

namespace TempDesk.Agent
{
    public static class WuaHelper
    {
        // OperationResultCode values from the WUA API.
        private static string ResultName(int code)
        {
            switch (code)
            {
                case 0: return "NotStarted";
                case 1: return "InProgress";
                case 2: return "Succeeded";
                case 3: return "SucceededWithErrors";
                case 4: return "Failed";
                case 5: return "Aborted";
                default: return "Unknown";
            }
        }

        private static object Create(string progId)
        {
            Type t = Type.GetTypeFromProgID(progId, true);
            return Activator.CreateInstance(t);
        }

        private static object Get(object target, string name)
        {
            return target.GetType().InvokeMember(name, BindingFlags.GetProperty, null, target, null, CultureInfo.InvariantCulture);
        }

        private static object Item(object collection, int index)
        {
            return collection.GetType().InvokeMember("Item", BindingFlags.GetProperty, null, collection, new object[] { index }, CultureInfo.InvariantCulture);
        }

        private static object Call(object target, string name, params object[] args)
        {
            return target.GetType().InvokeMember(name, BindingFlags.InvokeMethod, null, target, args, CultureInfo.InvariantCulture);
        }

        private static void Set(object target, string name, object value)
        {
            target.GetType().InvokeMember(name, BindingFlags.SetProperty, null, target, new object[] { value }, CultureInfo.InvariantCulture);
        }

        private static int Count(object collection)
        {
            return Convert.ToInt32(Get(collection, "Count"), CultureInfo.InvariantCulture);
        }

        /// <summary>Runs work on a new STA thread and rethrows its exception on the caller.</summary>
        public static T RunSta<T>(Func<T> work)
        {
            T result = default(T);
            Exception error = null;
            Thread thread = new Thread(delegate()
            {
                try { result = work(); }
                catch (Exception ex) { error = ex; }
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.IsBackground = true;
            thread.Start();
            thread.Join();
            if (error != null)
            {
                TargetInvocationException tie = error as TargetInvocationException;
                if (tie != null && tie.InnerException != null) { error = tie.InnerException; }
                throw new AgentException(502, "windows_update", "Windows Update: " + error.Message);
            }
            return result;
        }

        private static List<string> Strings(object stringCollection)
        {
            List<string> list = new List<string>();
            if (stringCollection == null) { return list; }
            int n = Count(stringCollection);
            for (int i = 0; i < n; i++) { list.Add(Convert.ToString(Item(stringCollection, i), CultureInfo.InvariantCulture)); }
            return list;
        }

        private static Dictionary<string, object> Shape(object update)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            object identity = Get(update, "Identity");
            d["id"] = Convert.ToString(Get(identity, "UpdateID"), CultureInfo.InvariantCulture);
            d["revision"] = Convert.ToInt32(Get(identity, "RevisionNumber"), CultureInfo.InvariantCulture);
            d["title"] = Convert.ToString(Get(update, "Title"), CultureInfo.InvariantCulture);
            d["description"] = Convert.ToString(Get(update, "Description"), CultureInfo.InvariantCulture);
            List<string> kbs = Strings(Get(update, "KBArticleIDs"));
            List<object> kbList = new List<object>();
            foreach (string kb in kbs) { kbList.Add("KB" + kb); }
            d["kb"] = kbList;
            object severity = Get(update, "MsrcSeverity");
            d["severity"] = severity == null ? "" : Convert.ToString(severity, CultureInfo.InvariantCulture);
            d["sizeBytes"] = Convert.ToInt64(Convert.ToDecimal(Get(update, "MaxDownloadSize"), CultureInfo.InvariantCulture));
            d["isDownloaded"] = Convert.ToBoolean(Get(update, "IsDownloaded"), CultureInfo.InvariantCulture);
            // InstallationBehavior.RebootBehavior: 0 never, 1 always, 2 can request.
            int reboot = Convert.ToInt32(Get(Get(update, "InstallationBehavior"), "RebootBehavior"), CultureInfo.InvariantCulture);
            d["rebootRequired"] = reboot != 0;
            List<object> cats = new List<object>();
            object categories = Get(update, "Categories");
            int cn = Count(categories);
            for (int i = 0; i < cn; i++) { cats.Add(Convert.ToString(Get(Item(categories, i), "Name"), CultureInfo.InvariantCulture)); }
            d["categories"] = cats;
            return d;
        }

        /// <summary>Searches with a fixed criterion chosen by the caller (never user input).</summary>
        public static List<object> Search(bool installed)
        {
            string criterion = installed ? "IsInstalled=1" : "IsInstalled=0 and IsHidden=0";
            return RunSta<List<object>>(delegate()
            {
                object session = Create("Microsoft.Update.Session");
                object searcher = Call(session, "CreateUpdateSearcher");
                object result = Call(searcher, "Search", criterion);
                object updates = Get(result, "Updates");
                List<object> list = new List<object>();
                int n = Count(updates);
                for (int i = 0; i < n; i++) { list.Add(Shape(Item(updates, i))); }
                return list;
            });
        }

        /// <summary>Downloads and installs the available updates whose UpdateID is in ids, reporting to the job.</summary>
        public static void Install(string[] ids, Job job)
        {
            HashSet<string> wanted = new HashSet<string>(ids, StringComparer.OrdinalIgnoreCase);
            RunSta<object>(delegate()
            {
                object session = Create("Microsoft.Update.Session");
                job.AddOutput("Searching for the selected updates");
                job.SetProgress(5);
                object result = Call(Call(session, "CreateUpdateSearcher"), "Search", "IsInstalled=0 and IsHidden=0");
                object updates = Get(result, "Updates");
                object selection = Create("Microsoft.Update.UpdateColl");
                List<string> titles = new List<string>();
                int n = Count(updates);
                for (int i = 0; i < n; i++)
                {
                    object u = Item(updates, i);
                    string id = Convert.ToString(Get(Get(u, "Identity"), "UpdateID"), CultureInfo.InvariantCulture);
                    if (!wanted.Contains(id)) { continue; }
                    if (!Convert.ToBoolean(Get(u, "EulaAccepted"), CultureInfo.InvariantCulture)) { Call(u, "AcceptEula"); }
                    Call(selection, "Add", u);
                    titles.Add(Convert.ToString(Get(u, "Title"), CultureInfo.InvariantCulture));
                }
                int selected = Count(selection);
                if (selected == 0)
                {
                    throw new AgentException(404, "not_found", "None of the selected updates are available any more. Scan again.");
                }
                if (selected < wanted.Count) { job.AddError((wanted.Count - selected) + " selected update(s) are no longer available and were skipped."); }

                job.AddOutput("Downloading " + selected + " update(s)");
                job.SetProgress(15);
                object downloader = Call(session, "CreateUpdateDownloader");
                Set(downloader, "Updates", selection);
                object dres = Call(downloader, "Download");
                int dcode = Convert.ToInt32(Get(dres, "ResultCode"), CultureInfo.InvariantCulture);
                job.AddOutput("Download result: " + ResultName(dcode));
                if (dcode == 4 || dcode == 5) { throw new AgentException(502, "windows_update", "Download " + ResultName(dcode).ToLowerInvariant() + "."); }
                job.SetProgress(55);

                job.AddOutput("Installing");
                object installer = Call(session, "CreateUpdateInstaller");
                Set(installer, "Updates", selection);
                object ires = Call(installer, "Install");
                int icode = Convert.ToInt32(Get(ires, "ResultCode"), CultureInfo.InvariantCulture);
                bool reboot = Convert.ToBoolean(Get(ires, "RebootRequired"), CultureInfo.InvariantCulture);
                for (int i = 0; i < selected; i++)
                {
                    object ur = Call(ires, "GetUpdateResult", i);
                    int code = Convert.ToInt32(Get(ur, "ResultCode"), CultureInfo.InvariantCulture);
                    int hr = Convert.ToInt32(Get(ur, "HResult"), CultureInfo.InvariantCulture);
                    string line = titles[i] + ": " + ResultName(code) + (hr != 0 ? " (0x" + hr.ToString("X8", CultureInfo.InvariantCulture) + ")" : "");
                    if (code == 2) { job.AddOutput(line); } else { job.AddError(line); }
                }
                job.AddOutput("Install result: " + ResultName(icode) + (reboot ? ". A restart is required." : "."));
                if (icode == 4 || icode == 5) { throw new AgentException(502, "windows_update", "Install " + ResultName(icode).ToLowerInvariant() + "."); }
                job.SetProgress(100);
                return null;
            });
        }
    }
}
