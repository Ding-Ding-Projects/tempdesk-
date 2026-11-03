using System;
using System.Collections.Generic;

namespace TempDesk.Agent
{
    /// <summary>
    /// The table of Group Policy client-side-extension (CSE) GUIDs and their
    /// matching administrative-tool extension GUIDs. When the agent writes any
    /// area of a GPO it must merge the right [CSE][tool] pair into
    /// gPCMachineExtensionNames or gPCUserExtensionNames so that clients re-run
    /// that extension, and bump the GPO version. These are the documented,
    /// well-known values; the dedicated area services (security, registry,
    /// admx) keep their own copies for their narrow use, and everything the
    /// full Group Policy editor adds goes through this one table.
    ///
    /// Sources (Microsoft Open Specifications "Standards Assignments" sections
    /// and [MS-GPOD] / [MS-GPPREF] 1.9):
    ///   Registry policy     [MS-GPREG] 1.9
    ///   Security            [MS-GPSB]  1.9
    ///   Scripts             [MS-GPSCR] 1.9
    ///   Folder Redirection  [MS-GPFR]  1.9
    ///   Software Install    [MS-GPSI]  1.9
    ///   Advanced Audit      [MS-GPAC]  1.9
    ///   Firewall (FAS)      [MS-GPFAS] 1.9 (registry based, tool GUID only)
    ///   Wireless / Wired    [MS-GPWL]  1.9 (AD object based)
    ///   Deployed Printers   [MS-GPDPC] 1.9 (AD object based)
    ///   IP Security         [MS-GPIPSEC] 1.9 (AD object based)
    ///   Preferences (all)   [MS-GPPREF] 1.9
    /// Registry-stored areas that have no CSE of their own (NRPT, QoS,
    /// Software Restriction, AppLocker) ride on the Registry CSE because their
    /// settings live in Registry.pol.
    /// </summary>
    public static class GpoCse
    {
        /// <summary>A CSE GUID paired with its machine and user tool GUIDs.</summary>
        public class Pair
        {
            public readonly string Cse;
            public readonly string ToolMachine;
            public readonly string ToolUser;

            public Pair(string cse, string toolMachine, string toolUser)
            {
                Cse = cse;
                ToolMachine = toolMachine;
                ToolUser = toolUser;
            }
        }

        // ---- Core settings extensions ----------------------------------
        public static readonly Pair Registry =
            new Pair("{35378EAA-683F-11D2-A89A-00C04FBBCFA2}",
                     "{D02B1F72-3407-48AE-BA88-E8213C6761F1}",
                     "{D02B1F73-3407-48AE-BA88-E8213C6761F1}");

        public static readonly Pair Security =
            new Pair("{827D319E-6EAC-11D2-A4EA-00C04F79F83A}",
                     "{803E14A0-B4FB-11D0-A0D0-00A0C90F574B}", null);

        public static readonly Pair Scripts =
            new Pair("{42B5FAAE-6536-11D2-AE5A-0000F87571E3}",
                     "{40B6664F-4972-11D1-A7CA-0000F87571E3}",
                     "{40B66650-4972-11D1-A7CA-0000F87571E3}");

        public static readonly Pair FolderRedirection =
            new Pair("{25537BA6-77A8-11D2-9B6C-0000F8080861}", null,
                     "{88E729D6-BDC1-11D1-BD2A-00C04FB9603F}");

        public static readonly Pair SoftwareInstallation =
            new Pair("{C6DC5466-785A-11D2-84D0-00C04FB169F7}",
                     "{942A8E4F-A261-11D1-A760-00C04FB9603F}",
                     "{BACF5C8A-A3C7-11D1-A760-00C04FB9603F}");

        public static readonly Pair AdvancedAudit =
            new Pair("{F3CCC681-B74C-4060-9F26-CD84525DCA2A}",
                     "{0F3F3735-573D-9804-99E4-AB2A69BA5FD4}", null);

        // Firewall rules live in Registry.pol, so the Registry CSE applies, but
        // the Windows Firewall admin tool also stamps its own tool GUID.
        public static readonly Pair FirewallTool =
            new Pair(Registry.Cse, "{B05566AC-FE9C-4368-BE01-7A4CBB6CBA11}", null);

        // ---- AD-object based extensions (Windows backend only) ---------
        public static readonly Pair WirelessXml =
            new Pair("{0ACDD40C-75AC-47AB-BAA0-BF6DE7E7FE63}",
                     "{2DA6AA7F-8C88-4194-A558-0D36E7FD3E64}", null);

        public static readonly Pair WiredXml =
            new Pair("{B587E2B1-4D59-4E7E-AED9-22B9DF11D053}",
                     "{06993B16-A5C7-47EB-B61C-B1CB7EE600AC}", null);

        public static readonly Pair DeployedPrinters =
            new Pair("{8A28E2C5-8D06-49A4-A08C-632DAA493E17}",
                     "{180F39F3-CF17-4C68-8410-94B71452A22D}",
                     "{180F39F3-CF17-4C68-8410-94B71452A22D}");

        public static readonly Pair IpSecurity =
            new Pair("{E437BC1C-AA7D-11D2-A382-00C04F991E27}",
                     "{DEA8AFA0-CC85-11D0-9CE2-0080C7221EBD}", null);

        // ---- Preferences (GPP) — [MS-GPPREF] 1.9 -----------------------
        // Keyed by the GPP area name used in the node tree.
        private static readonly Dictionary<string, Pair> _pref =
            new Dictionary<string, Pair>(StringComparer.OrdinalIgnoreCase);

        static GpoCse()
        {
            AddPref("Applications", "{F9C77450-3A41-477E-9310-9ACD617BD9E3}", "{0DA274B5-EB93-47A7-AAFB-65BA532D3FE6}");
            AddPref("DataSources", "{728EE579-943C-4519-9EF7-AB56765798ED}", "{1612B55C-243C-48DD-A449-FFC097B19776}");
            AddPref("Devices", "{1A6364EB-776B-4120-ADE1-B63A406A76B5}", "{1B767E9A-7BE4-4D35-85C1-2E174A7BA951}");
            AddPref("Drives", "{5794DAFD-BE60-433F-88A2-1A31939AC01F}", "{2EA1A81B-48E5-45E9-8BB7-A6E3AC170006}");
            AddPref("EnvironmentVariables", "{0E28E245-9368-4853-AD84-6DA3BA35BB75}", "{35141B6B-498A-4CC7-AD59-CEF93D89B2CE}");
            AddPref("Files", "{7150F9BF-48AD-4DA4-A49C-29EF4A8369BA}", "{3BAE7E51-E3F4-41D0-853D-9BB9FD47605F}");
            AddPref("FolderOptions", "{A3F3E39B-5D83-4940-B954-28315B82F0A8}", "{3BFAE46A-7F3A-467B-8CEA-6AA34DC71F53}");
            AddPref("Folders", "{6232C319-91AC-4931-9385-E70C2B099F0E}", "{3EC4E9D3-714D-471F-88DC-4DD4471AAB47}");
            AddPref("IniFiles", "{74EE6C03-5363-4554-B161-627540339CAB}", "{516FC620-5D34-4B08-8165-6A06B623EDEB}");
            AddPref("InternetSettings", "{E47248BA-94CC-49C4-BBB5-9EB7F05183D0}", "{5C935941-A954-4F7C-B507-885941ECE5C4}");
            AddPref("LocalUsersAndGroups", "{17D89FEC-5C44-4972-B12D-241CAEF74509}", "{79F92669-4224-476C-9C5C-6EFB4D87DF4A}");
            AddPref("NetworkOptions", "{3A0DBA37-F8B2-4356-83DE-3E90BD5C261F}", "{949FB894-E883-42C6-88C1-29169720E8CA}");
            AddPref("NetworkShares", "{6A4C88C6-C502-4F74-8F60-2CB23EDC24E2}", "{BFCBBEB0-9DF4-4C0C-A728-434EA66A0373}");
            AddPref("PowerOptions", "{E62688F0-25FD-4C90-BFF5-F508B9D2E31F}", "{9AD2BAFE-63B4-4883-A08C-C3C6196BCAFD}");
            AddPref("Printers", "{BC75B1ED-5833-4858-9BB8-CBF0B166DF9D}", "{A8C42CEA-CDB8-4388-97F4-5831F933DA84}");
            AddPref("RegionalOptions", "{E5094040-C46C-4115-B030-04FB2E545B00}", "{B9CCA4DE-E2B9-4CBD-BF7D-11B6EBFBDDF7}");
            AddPref("Registry", "{B087BE9D-ED37-454F-AF9C-04291E351182}", "{BEE07A6A-EC9F-4659-B8C9-0B1937907C83}");
            AddPref("ScheduledTasks", "{AADCED64-746C-4633-A97C-D61349046527}", "{CAB54552-DEEA-4691-817E-ED4A4D1AFC72}");
            AddPref("Services", "{91FBB303-0CD5-4055-BF42-E512A681B325}", "{CC5746A9-9B74-4BE5-AE2E-64379C86E0E4}");
            AddPref("Shortcuts", "{C418DD9D-0D14-4EFB-8FBF-CFE535C8FAC7}", "{CEFFA6E2-E3BD-421B-852C-6F6A79A59BC1}");
            AddPref("StartMenu", "{E4F48E54-F38D-4884-BFB9-D4D2E5729C18}", "{CF848D48-888D-4F45-B530-6A201E62A605}");
        }

        private static void AddPref(string area, string cse, string tool)
        {
            _pref[area] = new Pair(cse, tool, tool);
        }

        /// <summary>The GPP CSE/tool pair for a preference area, or null.</summary>
        public static Pair Preference(string area)
        {
            Pair p;
            return _pref.TryGetValue(area, out p) ? p : null;
        }
    }
}
