using System;
using System.Collections.Generic;
using System.DirectoryServices;
using System.Globalization;
using System.IO;
using System.Text;

namespace TempDesk.Agent
{
    /// <summary>
    /// Shared write-side plumbing for every Group Policy editor node: the
    /// SYSVOL path of a GPO, the client-side-extension registration into
    /// gPCMachineExtensionNames / gPCUserExtensionNames, and the GPO version
    /// bump in both AD (versionNumber) and GPT.INI. Any node that changes a
    /// GPO calls Touch() with the CSE pairs it needs so clients re-apply the
    /// settings. The extension-list merge is sorted the way Windows sorts it,
    /// reusing SecurityService.MergeExtension.
    /// </summary>
    public static class GpoWrite
    {
        public static string DnsDomain(AgentConfig config)
        {
            List<string> parts = new List<string>();
            foreach (string piece in config.DomainDn.Split(','))
            {
                string t = piece.Trim();
                if (t.StartsWith("DC=", StringComparison.OrdinalIgnoreCase))
                {
                    parts.Add(t.Substring(3));
                }
            }
            return string.Join(".", parts.ToArray());
        }

        public static string SysvolPath(AgentConfig config, string gpoId)
        {
            string guid = "{" + GpoService.NormalizeGuid(gpoId) + "}";
            string dns = DnsDomain(config);
            return @"\\" + dns + @"\SYSVOL\" + dns + @"\Policies\" + guid;
        }

        public static string GpoDn(AgentConfig config, string gpoId)
        {
            return "CN={" + GpoService.NormalizeGuid(gpoId) + "},CN=Policies,CN=System," + config.DomainDn;
        }

        /// <summary>
        /// Registers the given CSE pairs (null pair entries skipped; null tool
        /// within a pair means that side is not applicable) and bumps the
        /// matching half of the version. Pass machine/user to say which halves
        /// of the version to bump even when no CSE applies (rare).
        /// </summary>
        public static void Touch(AgentConfig config, string gpoId, bool machine, bool user,
            IEnumerable<KeyValuePair<string, GpoCse.Pair>> csePairs)
        {
            using (DirectoryEntry gpo = DirectoryService.Bind(GpoDn(config, gpoId)))
            {
                if (csePairs != null)
                {
                    string curMachine = (string)(gpo.Properties["gPCMachineExtensionNames"].Value ?? "");
                    string curUser = (string)(gpo.Properties["gPCUserExtensionNames"].Value ?? "");
                    bool mChanged = false, uChanged = false;
                    foreach (KeyValuePair<string, GpoCse.Pair> kv in csePairs)
                    {
                        GpoCse.Pair pair = kv.Value;
                        if (pair == null) { continue; }
                        bool side = string.Equals(kv.Key, "Machine", StringComparison.OrdinalIgnoreCase);
                        if (side && pair.ToolMachine != null)
                        {
                            curMachine = SecurityService.MergeExtension(curMachine, pair.Cse, pair.ToolMachine);
                            mChanged = true;
                        }
                        else if (!side && pair.ToolUser != null)
                        {
                            curUser = SecurityService.MergeExtension(curUser, pair.Cse, pair.ToolUser);
                            uChanged = true;
                        }
                    }
                    if (mChanged) { gpo.Properties["gPCMachineExtensionNames"].Value = curMachine; }
                    if (uChanged) { gpo.Properties["gPCUserExtensionNames"].Value = curUser; }
                }

                int current = 0;
                object raw = gpo.Properties["versionNumber"].Value;
                if (raw != null)
                {
                    current = Convert.ToInt32(raw, CultureInfo.InvariantCulture);
                }
                int userVer = current & 0xFFFF;
                int computerVer = (current >> 16) & 0xFFFF;
                if (machine) { computerVer = (computerVer + 1) & 0xFFFF; }
                if (user) { userVer = (userVer + 1) & 0xFFFF; }
                int combined = (computerVer << 16) | userVer;
                gpo.Properties["versionNumber"].Value = combined;
                gpo.CommitChanges();
                UpdateGptIni(config, gpoId, combined);
            }
        }

        private static void UpdateGptIni(AgentConfig config, string gpoId, int version)
        {
            string path = Path.Combine(SysvolPath(config, gpoId), "GPT.INI");
            List<string> lines = new List<string>();
            bool hasGeneral = false, wroteVersion = false;
            if (File.Exists(path))
            {
                foreach (string line in File.ReadAllLines(path))
                {
                    string t = line.Trim();
                    if (t.StartsWith("[General]", StringComparison.OrdinalIgnoreCase))
                    {
                        hasGeneral = true; lines.Add(line);
                    }
                    else if (t.StartsWith("Version=", StringComparison.OrdinalIgnoreCase))
                    {
                        lines.Add("Version=" + version.ToString(CultureInfo.InvariantCulture)); wroteVersion = true;
                    }
                    else { lines.Add(line); }
                }
            }
            if (!hasGeneral) { lines.Insert(0, "[General]"); }
            if (!wroteVersion) { lines.Add("Version=" + version.ToString(CultureInfo.InvariantCulture)); }
            try { File.WriteAllLines(path, lines.ToArray(), Encoding.ASCII); }
            catch (DirectoryNotFoundException)
            {
                Directory.CreateDirectory(SysvolPath(config, gpoId));
                File.WriteAllLines(path, lines.ToArray(), Encoding.ASCII);
            }
        }

        public static KeyValuePair<string, GpoCse.Pair> Cse(string side, GpoCse.Pair pair)
        {
            return new KeyValuePair<string, GpoCse.Pair>(side, pair);
        }
    }
}
