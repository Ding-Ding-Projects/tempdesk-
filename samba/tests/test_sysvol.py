"""GPO file editing through the shared SysvolMixin code using FakeBackend."""

import os
import textwrap

import pytest

from conftest import ADMIN_KEY
from tempdesk_agent import gpt, preg, sddl


@pytest.fixture
def admin(client):
    client.login()
    return client


def _gpo(admin, name="Test GPO"):
    st, g = admin.call("POST", "/gpo", {"name": name}, key=ADMIN_KEY)
    assert st == 201
    return g


def test_registry_put_get_delete_bumps_versions_and_cse(admin, app):
    g = _gpo(admin)
    gid = g["id"]
    st, v = admin.call("PUT", f"/gpo/{gid}/registry", {"key": r"HKLM\Software\Policies\T", "valueName": "A",
                                                        "type": "DWord", "value": 7}, key=ADMIN_KEY)
    assert st == 200 and v["value"] == 7
    admin.call("PUT", f"/gpo/{gid}/registry", {"key": r"HKCU\Software\Policies\T", "valueName": "B",
                                                "type": "String", "value": "x"}, key=ADMIN_KEY)
    guid = "{" + gid.upper() + "}"
    meta = app.backend.gpos[guid]
    assert gpt.split_version(meta["versionNumber"]) == (1, 1)
    assert meta["machineExt"] == f"[{gpt.REGISTRY_CSE}{gpt.REGISTRY_TOOL_MACHINE}]"
    assert meta["userExt"] == f"[{gpt.REGISTRY_CSE}{gpt.REGISTRY_TOOL_USER}]"
    with open(os.path.join(app.backend.gpo_dir(guid), "GPT.INI")) as f:
        assert gpt.read_gpt_ini_version(f.read()) == meta["versionNumber"]
    pol = preg.PolFile.load(os.path.join(app.backend.gpo_dir(guid), "Machine", "Registry.pol"))
    assert pol.find(r"Software\Policies\T", "A").decoded() == 7

    st, vals = admin.call("GET", f"/gpo/{gid}/registry", key=ADMIN_KEY)
    assert {(x["key"], x["valueName"], x["value"]) for x in vals} == {
        (r"HKLM\Software\Policies\T", "A", 7), (r"HKCU\Software\Policies\T", "B", "x")}
    st, vals = admin.call("GET", f"/gpo/{gid}/registry?key=HKLM\\Software", key=ADMIN_KEY)
    assert len(vals) == 1
    assert admin.call("DELETE", f"/gpo/{gid}/registry?key=HKLM\\Software\\Policies\\T&valueName=A",
                      key=ADMIN_KEY)[0] == 204
    assert gpt.split_version(meta["versionNumber"]) == (1, 2)
    assert admin.call("DELETE", f"/gpo/{gid}/registry?key=HKLM\\Software\\Policies\\T&valueName=A",
                      key=ADMIN_KEY)[0] == 404
    assert admin.call("PUT", f"/gpo/{gid}/registry", {"key": r"HKCR\x", "valueName": "A", "type": "DWord",
                                                       "value": 1}, key=ADMIN_KEY)[0] == 400


def test_allowlist_writes_restrictrun(admin, app):
    _gpo(admin, "TempDesk - Guest User Policy")
    st, a = admin.call("PUT", "/allowlist", {"enabled": True, "apps": ["msedge.exe", "WINWORD.EXE", "msedge.exe"]},
                       key=ADMIN_KEY)
    assert st == 200 and a == {"enabled": True, "apps": ["msedge.exe", "WINWORD.EXE"]}
    guid = app.backend.find_gpo_by_name("TempDesk - Guest User Policy")
    pol = app.backend.load_pol(guid, "User")
    key = r"Software\Microsoft\Windows\CurrentVersion\Policies\Explorer"
    assert pol.find(key, "RestrictRun").decoded() == 1
    assert pol.find(key + r"\RestrictRun", "**delvals.") is not None
    assert pol.find(key + r"\RestrictRun", "2").decoded() == "WINWORD.EXE"
    st, a = admin.call("PUT", "/allowlist", {"enabled": False, "apps": ["notepad.exe"]}, key=ADMIN_KEY)
    assert a == {"enabled": False, "apps": ["notepad.exe"]}
    assert admin.call("PUT", "/allowlist", {"apps": ["..\\evil.exe"]}, key=ADMIN_KEY)[0] == 400


def test_security_template(admin, app):
    g = _gpo(admin)
    st, s = admin.call("PUT", f"/gpo/{g['id']}/security",
                       {"sections": {"System Access": {"MinimumPasswordLength": "12"}}}, key=ADMIN_KEY)
    assert st == 200 and s["sections"]["System Access"]["MinimumPasswordLength"] == "12"
    guid = "{" + g["id"].upper() + "}"
    path = os.path.join(app.backend.gpo_dir(guid), "Machine", "Microsoft", "Windows NT", "SecEdit", "GptTmpl.inf")
    raw = open(path, "rb").read()
    assert raw[:2] == b"\xff\xfe"
    text = raw[2:].decode("utf-16-le")
    assert text.startswith("[Unicode]\r\nUnicode=yes\r\n[Version]")
    assert gpt.SECURITY_CSE in app.backend.gpos[guid]["machineExt"]


def test_report_html_and_xml(admin):
    g = _gpo(admin, "Report <me>")
    admin.call("PUT", f"/gpo/{g['id']}/registry", {"key": r"HKLM\Software\P", "valueName": "V",
                                                    "type": "DWord", "value": 1}, key=ADMIN_KEY)
    st, html = admin.call("GET", f"/gpo/{g['id']}/report", key=ADMIN_KEY)
    assert st == 200 and "Report &lt;me&gt;" in html and "HKLM\\Software\\P" in html
    st, xml = admin.call("GET", f"/gpo/{g['id']}/report?format=xml", key=ADMIN_KEY)
    import xml.etree.ElementTree as ET
    root = ET.fromstring(xml)
    assert root.get("displayName") == "Report <me>"


def test_wifi_profiles(admin, app):
    st, w = admin.call("PUT", "/wifi/office", {"ssid": "Office & Co", "auth": "WPA2PSK", "key": "supersecret"},
                       key=ADMIN_KEY)
    assert st == 200 and w == {"id": "office", "ssid": "Office & Co", "auth": "WPA2PSK", "hidden": False,
                               "autoConnect": True}
    st, lst = admin.call("GET", "/wifi", key=ADMIN_KEY)
    assert lst == [w] and "key" not in lst[0]
    p = os.path.join(app.backend.tempdesk_dir("wifi"), "office.xml")
    assert oct(os.stat(p).st_mode & 0o777) == "0o600"
    # update without key keeps the key
    assert admin.call("PUT", "/wifi/office", {"ssid": "Office", "auth": "WPA2PSK"}, key=ADMIN_KEY)[0] == 200
    assert "supersecret" in open(p).read()
    assert admin.call("PUT", "/wifi/..", {"ssid": "x", "auth": "open"}, key=ADMIN_KEY)[0] == 400
    assert admin.call("PUT", "/wifi/x", {"ssid": "x", "auth": "WPA2PSK", "key": "short"}, key=ADMIN_KEY)[0] == 400
    assert admin.call("DELETE", "/wifi/office", key=ADMIN_KEY)[0] == 204


def test_scripts(admin):
    assert admin.call("PUT", "/scripts/logon/hello.ps1", {"content": "Write-Host hi\n"}, key=ADMIN_KEY)[0] == 200
    st, lst = admin.call("GET", "/scripts?kind=logon", key=ADMIN_KEY)
    assert [x["name"] for x in lst] == ["hello.ps1"]
    st, c = admin.call("GET", "/scripts/logon/hello.ps1", key=ADMIN_KEY)
    assert c["content"] == "Write-Host hi\r\n"
    for bad in ("/scripts/logon/hello.bat", "/scripts/other/x.ps1", "/scripts/logon/..%2fx.ps1"):
        assert admin.call("PUT", bad, {"content": ""}, key=ADMIN_KEY)[0] == 400
    assert admin.call("DELETE", "/scripts/logon/hello.ps1", key=ADMIN_KEY)[0] == 204


ADMX = textwrap.dedent("""\
    <?xml version="1.0" encoding="utf-8"?>
    <policyDefinitions xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions" revision="1.0" schemaVersion="1.0">
      <policyNamespaces><target prefix="t" namespace="Test.Policies"/><using prefix="windows" namespace="Microsoft.Policies.Windows"/></policyNamespaces>
      <resources minRequiredRevision="1.0"/>
      <categories><category name="Cat" displayName="$(string.Cat)"><parentCategory ref="windows:System"/></category></categories>
      <policies>
        <policy name="Simple" class="Machine" displayName="$(string.Simple)" explainText="$(string.Simple_Help)" key="Software\\Policies\\Test" valueName="Simple">
          <parentCategory ref="Cat"/><supportedOn ref="windows:SUPPORTED_Win7"/>
        </policy>
        <policy name="WithEls" class="Both" displayName="$(string.WithEls)" key="Software\\Policies\\Test" presentation="$(presentation.WithEls)">
          <parentCategory ref="Cat"/>
          <elements>
            <decimal id="Num" valueName="Num" minValue="1" maxValue="10"/>
            <enum id="Mode" valueName="Mode"><item displayName="$(string.A)"><value><decimal value="1"/></value></item><item displayName="$(string.B)"><value><string>b</string></value></item></enum>
            <list id="Apps" key="Software\\Policies\\Test\\Apps" valuePrefix=""/>
          </elements>
        </policy>
      </policies>
    </policyDefinitions>
    """)
ADML = textwrap.dedent("""\
    <?xml version="1.0" encoding="utf-8"?>
    <policyDefinitionResources xmlns="http://schemas.microsoft.com/GroupPolicy/2006/07/PolicyDefinitions" revision="1.0" schemaVersion="1.0">
      <resources>
        <stringTable><string id="Cat">Test category</string><string id="Simple">Simple policy</string>
        <string id="Simple_Help">Help text</string><string id="WithEls">Policy with elements</string>
        <string id="A">Choice A</string><string id="B">Choice B</string></stringTable>
        <presentationTable><presentation id="WithEls"><decimalTextBox refId="Num">Number</decimalTextBox><dropdownList refId="Mode">Mode</dropdownList><listBox refId="Apps">Apps</listBox></presentation></presentationTable>
      </resources>
    </policyDefinitionResources>
    """)


def test_admx_parse_and_apply(admin, app):
    # Empty store: empty lists, not an error
    assert admin.call("GET", "/admx/categories", key=ADMIN_KEY) == (200, [])
    pd = os.path.join(app.backend.sysvol_domain_dir, "Policies", "PolicyDefinitions")
    os.makedirs(os.path.join(pd, "en-US"))
    open(os.path.join(pd, "test.admx"), "w").write(ADMX)
    open(os.path.join(pd, "en-US", "test.adml"), "w").write(ADML)
    st, cats = admin.call("GET", "/admx/categories", key=ADMIN_KEY)
    assert cats == [{"id": "Test.Policies:Cat", "name": "Test category",
                     "parentId": "Microsoft.Policies.Windows:System", "explain": ""}]
    st, pols = admin.call("GET", "/admx/policies?category=Test.Policies:Cat&class=Machine", key=ADMIN_KEY)
    assert [p["name"] for p in pols] == ["Policy with elements", "Simple policy"]
    we = next(p for p in pols if p["id"] == "Test.Policies:WithEls")
    assert [e["label"] for e in we["elements"]] == ["Number", "Mode", "Apps"]
    assert we["elements"][1]["items"][1]["label"] == "Choice B"

    g = _gpo(admin)
    url = f"/gpo/{g['id']}/admx/Test.Policies:Simple"
    assert admin.call("GET", url, key=ADMIN_KEY)[1] == {"state": "NotConfigured", "values": {}}
    assert admin.call("PUT", url, {"state": "Enabled"}, key=ADMIN_KEY)[1]["state"] == "Enabled"
    assert admin.call("PUT", url, {"state": "Disabled"}, key=ADMIN_KEY)[1]["state"] == "Disabled"
    guid = "{" + g["id"].upper() + "}"
    assert app.backend.load_pol(guid, "Machine").find(r"Software\Policies\Test", "Simple").decoded() == 0

    url2 = f"/gpo/{g['id']}/admx/Test.Policies:WithEls"
    assert admin.call("PUT", url2, {"state": "Enabled", "values": {}}, key=ADMIN_KEY)[0] == 400  # class required
    st, r = admin.call("PUT", url2, {"class": "User", "state": "Enabled",
                                     "values": {"Num": 5, "Mode": "1", "Apps": ["a.exe", "b.exe"]}}, key=ADMIN_KEY)
    assert st == 200 and r == {"state": "Enabled", "values": {"Num": 5, "Mode": "1", "Apps": ["a.exe", "b.exe"]}}
    pol = app.backend.load_pol(guid, "User")
    assert pol.find(r"Software\Policies\Test\Apps", "**delvals.") is not None
    assert pol.find(r"Software\Policies\Test\Apps", "1").decoded() == "a.exe"
    assert admin.call("PUT", url2, {"class": "User", "state": "Enabled", "values": {"Num": 50}},
                      key=ADMIN_KEY)[0] == 400
    st, r = admin.call("PUT", url2, {"class": "User", "state": "Disabled"}, key=ADMIN_KEY)
    assert r["state"] == "Disabled"
    pol = app.backend.load_pol(guid, "User")
    assert pol.find(r"Software\Policies\Test", "**del.Num") is not None
    admin.call("PUT", url2, {"class": "User", "state": "NotConfigured"}, key=ADMIN_KEY)
    assert app.backend.load_pol(guid, "User").entries == []


def test_sddl_helpers():
    base = "O:DAG:DAD:(A;;RPWPCRCCDCLCLORCWOWDSDDTSW;;;SY)(A;;RPLCLORC;;;AU)"
    s = sddl.cannot_change_password(base)
    assert s.startswith(f"O:DAG:DAD:(OD;;CR;{sddl.USER_CHANGE_PASSWORD};;PS)(OD;;CR;{sddl.USER_CHANGE_PASSWORD};;WD)")
    assert sddl.cannot_change_password(s) == s
    assert not sddl.is_protected_from_deletion(base)
    prot = "O:DAG:DAD:(D;;DTSD;;;WD)(A;;RPLCLORC;;;AU)"
    assert sddl.is_protected_from_deletion(prot)
    assert not sddl.is_protected_from_deletion(sddl.remove_deletion_protection(prot))

    gpo = ("O:DAG:DAD:PAI(OA;CI;CR;edacfd8f-ffb3-11d1-b41d-00a0c968f939;;AU)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;DA)"
           "(A;CI;LCRPLORC;;;AU)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;SY)")
    perms = {p["sid"]: p["permission"] for p in sddl.gpo_permissions(gpo, "S-1-5-21-1-2-3")}
    assert perms["S-1-5-11"] == "GpoApply"
    assert perms["S-1-5-21-1-2-3-512"] == "GpoEditDeleteModifySecurity"
    new = sddl.set_gpo_permission(gpo, "S-1-5-11", "GpoRead", True, "S-1-5-21-1-2-3")
    perms = {p["sid"]: p["permission"] for p in sddl.gpo_permissions(new, "S-1-5-21-1-2-3")}
    assert perms["S-1-5-11"] == "GpoRead"
    new = sddl.set_gpo_permission(new, "S-1-5-21-1-2-3-1105", "GpoEdit", True)
    perms = {p["sid"]: p["permission"] for p in sddl.gpo_permissions(new, "S-1-5-21-1-2-3")}
    assert perms["S-1-5-21-1-2-3-1105"] == "GpoEdit"


def test_inherit_sddl():
    parent = "O:BAG:SYD:PAI(A;OICI;FA;;;SY)(A;OICIIO;FA;;;CO)(A;CI;0x1200a9;;;AU)(A;OI;FR;;;DC)"
    f = sddl.inherit_sddl(parent, is_dir=False)
    assert f == "O:BAG:SYD:AI(A;ID;FA;;;SY)(A;ID;FA;;;BA)(A;ID;FR;;;DC)"
    d = sddl.inherit_sddl(parent, is_dir=True)
    assert "(A;OICIID;FA;;;SY)" in d and "(A;CIID;0x1200a9;;;AU)" in d and "(A;OIIOID;FR;;;DC)" in d
