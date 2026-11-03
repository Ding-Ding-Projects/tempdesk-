"""Full Group Policy editor: tree, node CRUD, and the on-disk formats, run
through FakeBackend against a real temporary SYSVOL."""

import os

import pytest

from conftest import ADMIN_KEY
from tempdesk_agent import gppxml, gpt, preg, secinf


@pytest.fixture
def admin(client):
    client.login()
    return client


def _gpo(admin, name="Editor GPO"):
    st, g = admin.call("POST", "/gpo", {"name": name}, key=ADMIN_KEY)
    assert st == 201, g
    return g["id"]


def _guid(gid):
    return "{" + gid.upper() + "}"


# ---------------------------------------------------------------------------
# Tree and schema
# ---------------------------------------------------------------------------

def test_tree_has_every_major_node(admin):
    gid = _gpo(admin)
    st, body = admin.call("GET", f"/gpo/{gid}/tree", key=ADMIN_KEY)
    assert st == 200
    ids = set()

    def walk(nodes):
        for n in nodes:
            ids.add(n["id"])
            walk(n.get("children", []))

    walk(body["nodes"])
    for expect in [
        "machine.pol.sw.install", "machine.pol.win.scripts.startup",
        "machine.pol.win.sec.account.password", "machine.pol.win.sec.local.rights",
        "machine.pol.win.sec.local.options", "machine.pol.win.sec.eventlog",
        "machine.pol.win.sec.restrictedgroups", "machine.pol.win.sec.services",
        "machine.pol.win.sec.registry", "machine.pol.win.sec.filesystem",
        "machine.pol.win.sec.firewall.inbound", "machine.pol.win.sec.firewall.profiles",
        "machine.pol.win.sec.wireless", "machine.pol.win.sec.wired",
        "machine.pol.win.sec.applocker", "machine.pol.win.sec.srp",
        "machine.pol.win.sec.advaudit", "machine.pol.nrpt", "machine.pol.admx",
        "machine.pol.win.qos", "machine.pol.win.printers",
        "user.pol.win.folderredir", "user.pref.win.drives", "machine.pref.cp.scheduledtasks",
    ]:
        assert expect in ids, expect


def test_ad_object_nodes_marked_unavailable(admin):
    gid = _gpo(admin)
    st, body = admin.call("GET", f"/gpo/{gid}/tree", key=ADMIN_KEY)
    found = {}

    def walk(nodes):
        for n in nodes:
            found[n["id"]] = n
            walk(n.get("children", []))

    walk(body["nodes"])
    for nid in ["machine.pol.win.sec.wireless", "machine.pol.win.sec.wired",
                "machine.pol.win.printers", "machine.pol.sw.install",
                "machine.pol.win.sec.ipsec"]:
        assert found[nid]["available"] is False
        assert found[nid]["unavailableReason"]


def test_schema_published(admin):
    st, body = admin.call("GET", "/gpo/nodes/schema", key=ADMIN_KEY)
    assert st == 200
    ids = {s["id"] for s in body["schemas"]}
    for expect in ["sec-password", "firewall-rule", "advanced-audit", "pref-Drives",
                   "folder-redirection", "nrpt-rule", "srp-rule", "applocker-rule"]:
        assert expect in ids
    drives = next(s for s in body["schemas"] if s["id"] == "pref-Drives")
    assert "common" in drives and "targeting" in drives["common"]
    # Action enum carries per-value descriptions.
    action = next(f for f in drives["fields"] if f["id"] == "action")
    assert all("description" in v for v in action["values"])


# ---------------------------------------------------------------------------
# Form nodes (GptTmpl.inf)
# ---------------------------------------------------------------------------

def test_password_policy_form_writes_inf_and_bumps_version(admin, app):
    gid = _gpo(admin)
    st, _ = admin.call("PUT", f"/gpo/{gid}/node/machine.pol.win.sec.account.password",
                       {"values": {"MinimumPasswordLength": 14, "PasswordComplexity": True}}, key=ADMIN_KEY)
    assert st == 200
    guid = _guid(gid)
    path = os.path.join(app.backend.gpo_dir(guid), "Machine", "Microsoft", "Windows NT", "SecEdit", "GptTmpl.inf")
    assert os.path.exists(path)
    with open(path, "rb") as f:
        sections = secinf.parse(secinf.decode(f.read()))
    assert sections["System Access"]["MinimumPasswordLength"] == "14"
    assert sections["System Access"]["PasswordComplexity"] == "1"
    meta = app.backend.gpos[guid]
    # Machine half bumped, Security CSE merged.
    assert gpt.split_version(meta["versionNumber"])[1] >= 1
    assert gpt.SECURITY_CSE in (meta["machineExt"] or "")

    st, body = admin.call("GET", f"/gpo/{gid}/node/machine.pol.win.sec.account.password", key=ADMIN_KEY)
    assert body["values"]["MinimumPasswordLength"] == "14"


# ---------------------------------------------------------------------------
# User Rights (table over GptTmpl.inf)
# ---------------------------------------------------------------------------

def test_user_rights_crud(admin):
    gid = _gpo(admin)
    base = f"/gpo/{gid}/node/machine.pol.win.sec.local.rights/items"
    st, row = admin.call("POST", base, {"right": "SeDenyNetworkLogonRight", "accounts": "*S-1-1-0"}, key=ADMIN_KEY)
    assert st == 201 and row["right"] == "SeDenyNetworkLogonRight"
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert any(i["right"] == "SeDenyNetworkLogonRight" for i in body["items"])
    st, _ = admin.call("PATCH", base + "/SeDenyNetworkLogonRight", {"accounts": "*S-1-5-7"}, key=ADMIN_KEY)
    assert st == 200
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert body["items"][0]["accounts"] == "*S-1-5-7"
    assert admin.call("DELETE", base + "/SeDenyNetworkLogonRight", key=ADMIN_KEY)[0] == 204
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert body["items"] == []


# ---------------------------------------------------------------------------
# Advanced audit (audit.csv)
# ---------------------------------------------------------------------------

def test_advanced_audit_csv(admin, app):
    gid = _gpo(admin)
    base = f"/gpo/{gid}/node/machine.pol.win.sec.advaudit/items"
    gu = "{0CCE921D-69AE-11D9-BED3-505054503030}"
    st, row = admin.call("POST", base, {"subcategoryGuid": gu, "subcategory": "File System",
                                        "policyTarget": "System", "settingValue": "3"}, key=ADMIN_KEY)
    assert st == 201
    guid = _guid(gid)
    path = os.path.join(app.backend.gpo_dir(guid), "Machine", "Microsoft", "Windows NT", "Audit", "audit.csv")
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    assert text.splitlines()[0].startswith("Machine Name,Policy Target,Subcategory")
    assert "File System" in text and gu in text and "Success and Failure" in text
    # Round trip through the API.
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert body["items"][0]["settingValue"] == "3"
    # Advanced Audit CSE registered.
    assert "{F3CCC681-B74C-4060-9F26-CD84525DCA2A}" in (app.backend.gpos[guid]["machineExt"] or "")
    assert admin.call("DELETE", base + "/" + gu.strip("{}"), key=ADMIN_KEY)[0] == 204


# ---------------------------------------------------------------------------
# Firewall rules (Registry.pol, MS-GPFAS rule string)
# ---------------------------------------------------------------------------

def test_firewall_rule_round_trip(admin, app):
    gid = _gpo(admin)
    base = f"/gpo/{gid}/node/machine.pol.win.sec.firewall.inbound/items"
    body = {"name": "Allow RPC", "action": "Allow", "protocol": "6", "localPorts": "RPC",
            "remoteAddresses": "LocalSubnet", "application": r"c:\app.exe"}
    st, row = admin.call("POST", base, body, key=ADMIN_KEY)
    assert st == 201
    rid = row["id"]
    guid = _guid(gid)
    pol = preg.PolFile.load(os.path.join(app.backend.gpo_dir(guid), "Machine", "Registry.pol"))
    e = pol.find(r"Software\Policies\Microsoft\WindowsFirewall\FirewallRules", rid)
    assert e is not None
    data = e.decoded()
    assert data.startswith("v") and "Action=Allow" in data and "Dir=In" in data and "LPort=RPC" in data
    # Listed back and parsed into fields.
    st, listing = admin.call("GET", base, key=ADMIN_KEY)
    assert any(i["name"] == "Allow RPC" and i["action"] == "Allow" for i in listing["items"])
    # Outbound list does not include an inbound rule.
    st, out = admin.call("GET", f"/gpo/{gid}/node/machine.pol.win.sec.firewall.outbound/items", key=ADMIN_KEY)
    assert all(i["name"] != "Allow RPC" for i in out["items"])
    assert admin.call("DELETE", base + "/" + rid, key=ADMIN_KEY)[0] == 204


def test_firewall_profiles_form(admin, app):
    gid = _gpo(admin)
    node = f"/gpo/{gid}/node/machine.pol.win.sec.firewall.profiles"
    st, _ = admin.call("PUT", node, {"values": {"DomainState": "1", "DomainInbound": "1", "PublicState": "1"}},
                       key=ADMIN_KEY)
    assert st == 200
    st, body = admin.call("GET", node, key=ADMIN_KEY)
    assert body["values"]["DomainState"] == "1"
    assert body["values"]["PublicState"] == "1"


# ---------------------------------------------------------------------------
# GPP preference items (XML round trips with exact CLSIDs)
# ---------------------------------------------------------------------------

def test_gpp_drive_map_round_trip_and_clsid(admin, app):
    gid = _gpo(admin)
    base = f"/gpo/{gid}/node/user.pref.win.drives/items"
    item = {"name": "S:", "properties": {"action": "U", "path": r"\\files\scratch", "letter": "S", "persistent": "1"}}
    st, row = admin.call("POST", base, item, key=ADMIN_KEY)
    assert st == 201
    uid = row["id"]
    guid = _guid(gid)
    path = os.path.join(app.backend.gpo_dir(guid), "User", "Preferences", "Drives", "Drives.xml")
    xml = open(path, encoding="utf-8").read()
    # Exact outer and inner CLSIDs from MS-GPPREF.
    assert "{8FDDCC1A-0C3C-43cd-A6B4-71A6DF20DA8C}" in xml
    assert "{935D1B74-9CB8-4e3c-9914-7DD559B7A417}" in xml
    assert 'path="\\\\files\\scratch"' in xml
    # Read back.
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert body["items"][0]["properties"]["letter"] == "S"
    # Drive Maps CSE on the user side.
    assert "{5794DAFD-BE60-433F-88A2-1A31939AC01F}" in (app.backend.gpos[guid]["userExt"] or "")
    # Update then delete.
    st, _ = admin.call("PATCH", base + "/" + uid, {"id": uid, "name": "S:",
                       "properties": {"action": "U", "path": r"\\files\other", "letter": "S"}}, key=ADMIN_KEY)
    assert st == 200
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert body["items"][0]["properties"]["path"] == r"\\files\other"
    assert admin.call("DELETE", base + "/" + uid, key=ADMIN_KEY)[0] == 204
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert body["items"] == []


def test_gpp_item_level_targeting_preserved(admin, app):
    gid = _gpo(admin)
    base = f"/gpo/{gid}/node/user.pref.win.drives/items"
    filters = ('<Filters><FilterGroup bool="AND" not="0" name="CORP\\Sales" '
               'sid="" userContext="1" primaryGroup="0" localGroup="0"/></Filters>')
    st, row = admin.call("POST", base, {"name": "T:", "filters": filters,
                                        "properties": {"action": "C", "path": r"\\files\sales", "letter": "T"}},
                         key=ADMIN_KEY)
    assert st == 201
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert body["items"][0]["filters"] is not None
    assert "FilterGroup" in body["items"][0]["filters"]


def test_gpp_registry_collection_clsid(admin):
    gid = _gpo(admin)
    base = f"/gpo/{gid}/node/machine.pref.win.registry/items"
    st, row = admin.call("POST", base, {"elementType": "Registry", "name": "Disallowed",
                                        "properties": {"action": "U", "hive": "HKEY_LOCAL_MACHINE",
                                                       "key": r"Software\MP3", "name": "Disallowed",
                                                       "type": "REG_DWORD", "value": "00000001"}}, key=ADMIN_KEY)
    assert st == 201 and row["elementType"] == "Registry"


# ---------------------------------------------------------------------------
# Scripts (scripts.ini / psscripts.ini)
# ---------------------------------------------------------------------------

def test_scripts_ini_and_psscripts(admin, app):
    gid = _gpo(admin)
    base = f"/gpo/{gid}/node/machine.pol.win.scripts.startup/items"
    st, _ = admin.call("POST", base, {"script": "setup.cmd", "parameters": "/q"}, key=ADMIN_KEY)
    assert st == 201
    st, _ = admin.call("POST", base, {"script": "init.ps1", "parameters": "", "powershell": True}, key=ADMIN_KEY)
    assert st == 201
    guid = _guid(gid)
    scripts = open(os.path.join(app.backend.gpo_dir(guid), "Machine", "Scripts", "scripts.ini"),
                   encoding="utf-8", errors="replace").read()
    assert "[Startup]" in scripts and "0CmdLine=setup.cmd" in scripts and "0Parameters=/q" in scripts
    ps = open(os.path.join(app.backend.gpo_dir(guid), "Machine", "Scripts", "psscripts.ini"),
              encoding="utf-8", errors="replace").read()
    assert "init.ps1" in ps
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert {i["script"] for i in body["items"]} == {"setup.cmd", "init.ps1"}
    assert "{42B5FAAE-6536-11D2-AE5A-0000F87571E3}" in (app.backend.gpos[guid]["machineExt"] or "")


# ---------------------------------------------------------------------------
# Folder redirection (fdeploy1.ini, user)
# ---------------------------------------------------------------------------

def test_folder_redirection_fdeploy(admin, app):
    gid = _gpo(admin)
    base = f"/gpo/{gid}/node/user.pol.win.folderredir/items"
    docs = "{FDD39AD0-238F-46AF-ADB4-6C85480369C7}"
    st, row = admin.call("POST", base, {"folder": docs, "securityGroup": "S-1-1-0",
                                        "fullPath": r"\\fs\home\%USERNAME%\Documents", "flags": "1001"}, key=ADMIN_KEY)
    assert st == 201
    guid = _guid(gid)
    path = os.path.join(app.backend.gpo_dir(guid), "User", "Documents & Settings", "fdeploy1.ini")
    assert os.path.exists(path)
    raw = open(path, "rb").read()
    assert raw[:2] == b"\xff\xfe"  # UTF-16 LE BOM
    text = raw[2:].decode("utf-16-le")
    assert "[Folder_Redirection]" in text and docs in text
    assert "FullPath=\\\\fs\\home\\%USERNAME%\\Documents" in text
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert body["items"][0]["fullPath"] == r"\\fs\home\%USERNAME%\Documents"
    assert "{25537BA6-77A8-11D2-9B6C-0000F8080861}" in (app.backend.gpos[guid]["userExt"] or "")


# ---------------------------------------------------------------------------
# NRPT, SRP, AppLocker (Registry.pol subkeys)
# ---------------------------------------------------------------------------

def test_nrpt_rule(admin, app):
    gid = _gpo(admin)
    base = f"/gpo/{gid}/node/machine.pol.nrpt/items"
    st, row = admin.call("POST", base, {"ruleName": "corp", "name": ".example.com",
                                        "genericDnsServers": "10.1.1.1;10.2.2.2", "configOptions": "8"}, key=ADMIN_KEY)
    assert st == 201
    guid = _guid(gid)
    pol = preg.PolFile.load(os.path.join(app.backend.gpo_dir(guid), "Machine", "Registry.pol"))
    key = r"Software\Policies\Microsoft\Windows NT\DNSClient\DnsPolicyConfig\corp"
    assert pol.find(key, "GenericDNSServers").decoded() == "10.1.1.1;10.2.2.2"
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert body["items"][0]["name"] == ".example.com"


def test_applocker_rule(admin, app):
    gid = _gpo(admin)
    base = f"/gpo/{gid}/node/machine.pol.win.sec.applocker/items"
    rule = '<FilePathRule Id="x" Name="All" Action="Allow"><Conditions><FilePathCondition Path="*"/></Conditions></FilePathRule>'
    st, row = admin.call("POST", base, {"collection": "Exe", "enforcementMode": "Enabled", "ruleXml": rule},
                         key=ADMIN_KEY)
    assert st == 201
    guid = _guid(gid)
    pol = preg.PolFile.load(os.path.join(app.backend.gpo_dir(guid), "Machine", "Registry.pol"))
    assert pol.find(r"Software\Policies\Microsoft\Windows\SrpV2\Exe", "EnforcementMode").decoded() == 1
    st, body = admin.call("GET", base, key=ADMIN_KEY)
    assert any("FilePathRule" in (i.get("ruleXml") or "") for i in body["items"])


# ---------------------------------------------------------------------------
# AD-object nodes refuse on the Samba backend with a reason
# ---------------------------------------------------------------------------

def test_wireless_node_unavailable(admin):
    gid = _gpo(admin)
    st, body = admin.call("GET", f"/gpo/{gid}/node/machine.pol.win.sec.wireless/items", key=ADMIN_KEY)
    assert st == 404
    assert "Samba" in body["message"]


def test_software_installation_unavailable(admin):
    gid = _gpo(admin)
    st, body = admin.call("GET", f"/gpo/{gid}/node/machine.pol.sw.install/items", key=ADMIN_KEY)
    assert st == 404


# ---------------------------------------------------------------------------
# admx stats
# ---------------------------------------------------------------------------

def test_admx_stats(admin, app, tmp_path):
    # Seed a tiny central store so stats are non-trivial.
    store = os.path.join(app.backend.sysvol_domain_dir, "Policies", "PolicyDefinitions")
    os.makedirs(os.path.join(store, "en-US"), exist_ok=True)
    admx = '''<?xml version="1.0" encoding="utf-8"?>
<policyDefinitions revision="1.0" schemaVersion="1.0"
 xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions">
  <policyNamespaces><target prefix="t" namespace="TempDesk.Test"/></policyNamespaces>
  <resources minRequiredRevision="1.0"/>
  <categories><category name="Cat" displayName="$(string.Cat)"/></categories>
  <policies>
    <policy name="P1" class="Machine" displayName="$(string.P1)" key="Software\\T" valueName="V">
      <parentCategory ref="Cat"/><supportedOn ref="t:SUPPORTED"/>
      <enabledValue><decimal value="1"/></enabledValue>
      <disabledValue><decimal value="0"/></disabledValue>
    </policy>
  </policies>
</policyDefinitions>'''
    adml = '''<?xml version="1.0" encoding="utf-8"?>
<policyDefinitionResources revision="1.0" schemaVersion="1.0"
 xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions">
  <resources><stringTable>
    <string id="Cat">Category</string><string id="P1">Policy One</string>
  </stringTable><presentationTable/></resources>
</policyDefinitionResources>'''
    with open(os.path.join(store, "Test.admx"), "w", encoding="utf-8") as f:
        f.write(admx)
    with open(os.path.join(store, "en-US", "Test.adml"), "w", encoding="utf-8") as f:
        f.write(adml)
    st, body = admin.call("GET", "/admx/stats", key=ADMIN_KEY)
    assert st == 200
    assert body["files"] >= 1
    assert body["policies"] >= 1
    assert body["languages"] >= 1
