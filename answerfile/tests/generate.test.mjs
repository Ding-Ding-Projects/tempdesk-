import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildXml, parseXml, parseXmlTree, encodePassword, decodePassword, validateModel, XmlError,
  UNATTEND_NS, WCM_NS, PUBLIC_KEY_TOKEN,
} from '../generate.mjs';

const catalog = JSON.parse(readFileSync(new URL('../unattend-catalog.json', import.meta.url), 'utf8'));

// Server Core host, TempDesk style: workgroup, static IP, RDP on, firewall group, first logon bootstrap.
const serverCore = {
  architecture: 'amd64',
  passes: {
    windowsPE: {
      'Microsoft-Windows-International-Core-WinPE': {
        'SetupUILanguage/UILanguage': 'en-US', InputLocale: 'en-US', SystemLocale: 'en-US', UILanguage: 'en-US', UserLocale: 'en-US',
      },
      'Microsoft-Windows-Setup': {
        'UserData/AcceptEula': true,
        'UserData/ProductKey/Key': 'VDYBN-27WPP-V4HQT-9VMD4-VMK7H',
        'UserData/ProductKey/WillShowUI': 'OnError',
        'ImageInstall/OSImage/InstallFrom/MetaData': [{ Key: '/IMAGE/NAME', Value: 'Windows Server 2025 SERVERSTANDARDCORE' }],
        'ImageInstall/OSImage/InstallTo/DiskID': 0,
        'ImageInstall/OSImage/InstallTo/PartitionID': 3,
        'ImageInstall/OSImage/WillShowUI': 'OnError',
      },
    },
    specialize: {
      'Microsoft-Windows-Shell-Setup': { ComputerName: 'TD-HOST-01', TimeZone: 'UTC', RegisteredOwner: 'TempDesk' },
      'Microsoft-Windows-TerminalServices-LocalSessionManager': { fDenyTSConnections: false },
      'Microsoft-Windows-TerminalServices-RDP-WinStationExtensions': { UserAuthentication: '1', SecurityLayer: '2' },
      'Networking-MPSSVC-Svc': {
        'FirewallGroups/FirewallGroup': [{ Key: 'RemoteDesktop', Active: true, Group: 'Remote Desktop', Profile: 'all' }],
      },
      'Microsoft-Windows-TCPIP': {
        'Interfaces/Interface': [{
          Identifier: 'Ethernet',
          'Ipv4Settings/DhcpEnabled': false,
          'Ipv4Settings/Metric': 10,
          'UnicastIpAddresses/IpAddress': [{ Key: '1', Value: '10.20.0.15/24' }],
          'Routes/Route': [{ Identifier: '0', Prefix: '0.0.0.0/0', NextHopAddress: '10.20.0.1', Metric: 10 }],
        }],
      },
      'Microsoft-Windows-DNS-Client': {
        'Interfaces/Interface': [{ Identifier: 'Ethernet', 'DNSServerSearchOrder/IpAddress': [{ Key: '1', Value: '10.20.0.2' }, { Key: '2', Value: '1.1.1.1' }] }],
      },
      'Microsoft-Windows-IE-ESC': { IEHardenAdmin: false, IEHardenUser: false },
      'Microsoft-Windows-ServerManager-SvrMgrNc': { DoNotOpenServerManagerAtLogon: true },
    },
    oobeSystem: {
      'Microsoft-Windows-Shell-Setup': {
        'UserAccounts/AdministratorPassword/Value': 'Td!Adm1n<&>"pw',
        'UserAccounts/AdministratorPassword/PlainText': false,
        'AutoLogon/Enabled': true,
        'AutoLogon/LogonCount': 1,
        'AutoLogon/Username': 'Administrator',
        'AutoLogon/Password/Value': 'Td!Adm1n<&>"pw',
        'AutoLogon/Password/PlainText': false,
        'FirstLogonCommands/SynchronousCommand': [
          { Order: 1, CommandLine: 'powershell -NoProfile -ExecutionPolicy Bypass -File C:\\TempDesk\\bootstrap.ps1', Description: 'TempDesk bootstrap', RequiresUserInput: false },
        ],
        'OOBE/HideEULAPage': true,
      },
    },
  },
};

// Windows 11 domain join with UnattendedJoin.
const domainJoin = {
  architecture: 'amd64',
  passes: {
    windowsPE: {
      'Microsoft-Windows-Setup': { 'UserData/AcceptEula': true, 'UserData/ProductKey/Key': 'NPPR9-FWDCX-D2C8J-H872K-2YT43' },
    },
    specialize: {
      'Microsoft-Windows-Shell-Setup': { ComputerName: '*', TimeZone: 'Pacific Standard Time' },
      'Microsoft-Windows-UnattendedJoin': {
        'Identification/JoinDomain': 'corp.example.com',
        'Identification/MachineObjectOU': 'OU=Workstations,DC=corp,DC=example,DC=com',
        'Identification/Credentials/Domain': 'CORP',
        'Identification/Credentials/Username': 'svc-join',
        'Identification/Credentials/Password': 'J0in&Secret',
        'Identification/TimeoutPeriodInMinutes': 15,
      },
      'Microsoft-Windows-Deployment': {
        'RunSynchronous/RunSynchronousCommand': [
          { Order: 1, Path: 'reg add HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\OOBE /v DisablePrivacyExperience /t REG_DWORD /d 1 /f', Description: 'Skip privacy page' },
        ],
      },
    },
    oobeSystem: {
      'Microsoft-Windows-International-Core': { InputLocale: '0409:00000409', SystemLocale: 'en-US', UILanguage: 'en-US', UserLocale: 'en-US' },
      'Microsoft-Windows-Shell-Setup': {
        'OOBE/HideEULAPage': true,
        'OOBE/HideOnlineAccountScreens': true,
        'OOBE/HideWirelessSetupInOOBE': true,
        'OOBE/ProtectYourPC': '3',
        'UserAccounts/DomainAccounts/DomainAccountList': [
          { Domain: 'CORP', DomainAccount: [{ Name: 'Desktop Admins', Group: 'Administrators' }, { Name: 'Helpdesk', Group: 'Remote Desktop Users' }] },
        ],
      },
    },
  },
};

// Custom: UEFI disk layout, local accounts, RunSynchronous with credentials, drivers.
const custom = {
  architecture: 'amd64',
  passes: {
    windowsPE: {
      'Microsoft-Windows-Setup': {
        'DiskConfiguration/WillShowUI': 'OnError',
        'DiskConfiguration/Disk': [{
          DiskID: 0,
          WillWipeDisk: true,
          'CreatePartitions/CreatePartition': [
            { Order: 1, Type: 'Primary', Size: 750 },
            { Order: 2, Type: 'EFI', Size: 100 },
            { Order: 3, Type: 'MSR', Size: 16 },
            { Order: 4, Type: 'Primary', Extend: true },
          ],
          'ModifyPartitions/ModifyPartition': [
            { Order: 1, PartitionID: 1, Label: 'WINRE', Format: 'NTFS', TypeID: 'DE94BBA4-06D1-4D40-A16A-BFD50179D6AC' },
            { Order: 2, PartitionID: 2, Label: 'System', Format: 'FAT32' },
            { Order: 3, PartitionID: 3 },
            { Order: 4, PartitionID: 4, Label: 'Windows', Letter: 'C', Format: 'NTFS' },
          ],
        }],
        'ImageInstall/OSImage/InstallTo/DiskID': 0,
        'ImageInstall/OSImage/InstallTo/PartitionID': 4,
        'RunSynchronous/RunSynchronousCommand': [
          { Order: 1, Path: 'cmd /c echo windowsPE > X:\\marker.txt', Description: 'Marker' },
          { Order: 2, Path: '\\\\deploy\\share\\prep.cmd', 'Credentials/Domain': 'DEPLOY', 'Credentials/UserName': 'reader', 'Credentials/Password': 'R3ad!' },
        ],
      },
      'Microsoft-Windows-PnpCustomizationsWinPE': {
        'DriverPaths/PathAndCredentials': [
          { Key: '1', Path: 'D:\\Drivers\\Storage' },
          { Key: '2', Path: '\\\\deploy\\drivers', 'Credentials/Domain': 'DEPLOY', 'Credentials/Username': 'reader', 'Credentials/Password': 'R3ad!' },
        ],
      },
    },
    oobeSystem: {
      'Microsoft-Windows-Shell-Setup': {
        'UserAccounts/LocalAccounts/LocalAccount': [
          { Name: 'tdadmin', DisplayName: 'TempDesk Admin', Group: 'Administrators', 'Password/Value': 'pässwörd ✓', 'Password/PlainText': false },
          { Name: 'kiosk', Group: 'Users', Description: 'Kiosk user', 'Password/Value': '', 'Password/PlainText': true },
        ],
        'UserAccounts/AdministratorPassword/Value': 'Adm&n',
        'UserAccounts/AdministratorPassword/PlainText': true,
        'FirstLogonCommands/SynchronousCommand': [
          { Order: 1, CommandLine: 'cmd /c "echo first & echo second"', RequiresUserInput: false },
          { Order: 2, CommandLine: 'shutdown /r /t 0' },
        ],
      },
    },
  },
};

const models = { serverCore, domainJoin, custom };

// Normalize a model the way parseXml returns it: passwords containers get an explicit PlainText.
function normalize(model) {
  const m = structuredClone(model);
  const fill = (values) => {
    for (const v of Object.values(values)) {
      if (Array.isArray(v)) v.forEach((item) => fill(item));
    }
    for (const k of Object.keys(values)) {
      const mm = k.match(/^(.*\/)?(AdministratorPassword|OfflineAdministratorPassword|Password)\/Value$/);
      if (mm) {
        const pk = k.replace(/Value$/, 'PlainText');
        if (!(pk in values)) values[pk] = false; // buildXml default hidePasswords
      }
    }
  };
  for (const comps of Object.values(m.passes)) for (const values of Object.values(comps)) fill(values);
  return m;
}

for (const [name, model] of Object.entries(models)) {
  test(`round trip: ${name}`, () => {
    assert.deepEqual(validateModel(model, catalog).filter((i) => i.level === 'error'), []);
    const xml = buildXml(model, catalog);
    parseXmlTree(xml); // well-formed
    const { model: back, unknown, warnings } = parseXml(xml, catalog);
    assert.deepEqual(unknown, []);
    assert.deepEqual(warnings, []);
    assert.deepEqual(back, normalize(model));
    // stable: building again gives identical XML
    assert.equal(buildXml(back, catalog), xml);
  });
}

test('component attributes and namespaces', () => {
  const xml = buildXml(serverCore, catalog);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>\n<unattend xmlns="urn:schemas-microsoft-com:unattend">'));
  const tree = parseXmlTree(xml);
  assert.equal(tree.attrs.xmlns, UNATTEND_NS);
  const passes = tree.children.map((c) => c.attrs.pass);
  assert.deepEqual(passes, ['windowsPE', 'specialize', 'oobeSystem']);
  for (const settings of tree.children) {
    for (const comp of settings.children) {
      assert.equal(comp.name, 'component');
      assert.equal(comp.attrs.processorArchitecture, 'amd64');
      assert.equal(comp.attrs.publicKeyToken, PUBLIC_KEY_TOKEN);
      assert.equal(comp.attrs.language, 'neutral');
      assert.equal(comp.attrs.versionScope, 'nonSxS');
      assert.equal(comp.attrs['xmlns:wcm'], WCM_NS);
    }
  }
  assert.match(xml, /<FirewallGroup wcm:action="add" wcm:keyValue="RemoteDesktop">/);
  assert.match(xml, /<IpAddress wcm:action="add" wcm:keyValue="1">10\.20\.0\.15\/24<\/IpAddress>/);
  assert.match(xml, /<SynchronousCommand wcm:action="add">\s*<CommandLine>/);
  assert.match(xml, /<MetaData wcm:action="add">\s*<Key>\/IMAGE\/NAME<\/Key>/);
});

test('settings are written in catalog order with nested containers', () => {
  const xml = buildXml(custom, catalog);
  const i1 = xml.indexOf('<DiskConfiguration>');
  const i2 = xml.indexOf('<ImageInstall>');
  assert.ok(i1 > 0 && i2 > i1);
  assert.match(xml, /<Disk wcm:action="add">\s*<CreatePartitions>\s*<CreatePartition wcm:action="add">\s*<Extend>|<Disk wcm:action="add">\s*<CreatePartitions>\s*<CreatePartition wcm:action="add">\s*<Order>1<\/Order>/);
  assert.match(xml, /<Letter>C<\/Letter>/);
});

test('password encoding matches the Windows rule and documented examples', () => {
  // Examples published in the reference (Shell-Setup UserAccounts and OfflineAdministratorPassword pages).
  assert.equal(encodePassword('pw', 'AdministratorPassword'), 'cAB3AEEAZABtAGkAbgBpAHMAdAByAGEAdABvAHIAUABhAHMAcwB3AG8AcgBkAA==');
  assert.equal(encodePassword('password', 'Password'), 'cABhAHMAcwB3AG8AcgBkAFAAYQBzAHMAdwBvAHIAZAA=');
  assert.equal(encodePassword('complex_password', 'Password'), 'YwBvAG0AcABsAGUAeABfAHAAYQBzAHMAdwBvAHIAZABQAGEAcwBzAHcAbwByAGQA');
  // Reference example omits padding; decoding must accept that.
  assert.equal(decodePassword('cAB3AFAAYQBzAHMAdwBvAHIAZAA', 'Password'), 'pw');
  // Independent check against Node's Buffer.
  for (const pw of ['', 'a', 'P@ss w0rd!', 'pässwörd ✓', '😀x']) {
    for (const suffix of ['Password', 'AdministratorPassword']) {
      const expected = Buffer.from(pw + suffix, 'utf16le').toString('base64');
      assert.equal(encodePassword(pw, suffix), expected);
      assert.equal(decodePassword(expected, suffix), pw);
    }
  }
  assert.equal(decodePassword('not base64!', 'Password'), null);
  assert.equal(decodePassword(encodePassword('x', 'Password'), 'AdministratorPassword'), null);

  const xml = buildXml(serverCore, catalog);
  const admin = Buffer.from('Td!Adm1n<&>"pw' + 'AdministratorPassword', 'utf16le').toString('base64');
  const auto = Buffer.from('Td!Adm1n<&>"pw' + 'Password', 'utf16le').toString('base64');
  assert.ok(xml.includes(`<AdministratorPassword>\n                    <Value>${admin}</Value>\n                    <PlainText>false</PlainText>`));
  assert.ok(xml.includes(`<Value>${auto}</Value>`));
  assert.ok(!xml.includes('Td!Adm1n'));
  const xml2 = buildXml(custom, catalog);
  assert.ok(xml2.includes(`<Value>${Buffer.from('pässwörd ✓Password', 'utf16le').toString('base64')}</Value>`));
  assert.ok(xml2.includes('<Value>Adm&amp;n</Value>\n                    <PlainText>true</PlainText>'));
  // Credentials/Password elements (domain join, RunSynchronous, driver paths) are never encoded.
  assert.ok(buildXml(domainJoin, catalog).includes('<Password>J0in&amp;Secret</Password>'));
});

test('hidePasswords option controls the default PlainText', () => {
  const m = { passes: { oobeSystem: { 'Microsoft-Windows-Shell-Setup': { 'UserAccounts/AdministratorPassword/Value': 'x' } } } };
  assert.match(buildXml(m, catalog), /<PlainText>false<\/PlainText>/);
  assert.match(buildXml(m, catalog, { hidePasswords: false }), /<Value>x<\/Value>\s*<PlainText>true<\/PlainText>/);
});

test('XML escaping and well-formedness', () => {
  const m = { passes: { specialize: { 'Microsoft-Windows-Shell-Setup': { RegisteredOrganization: `A & B <"Co"> 'x' ]]>` } } } };
  const xml = buildXml(m, catalog);
  assert.ok(xml.includes('<RegisteredOrganization>A &amp; B &lt;"Co"&gt; \'x\' ]]&gt;</RegisteredOrganization>'));
  const back = parseXml(xml, catalog).model;
  assert.equal(back.passes.specialize['Microsoft-Windows-Shell-Setup'].RegisteredOrganization, `A & B <"Co"> 'x' ]]>`);
  assert.throws(() => buildXml({ passes: { specialize: { 'Microsoft-Windows-Shell-Setup': { RegisteredOwner: 'bad\u0001' } } } }, catalog));
  for (const bad of ['<a>', '<a></b>', '<a><b></a></b>', '<a x="1" x="2"/>', '<a>&bogus;</a>', '<a>&</a>', 'text<a/>', '<a/><b/>',
    '<a><!-- x -- y --></a>', '<a x=1/>', '<?xml version="1.0"?><?xml version="1.0"?><a/>', '<!DOCTYPE a><a/>', '<a>&#1;</a>']) {
    assert.throws(() => parseXmlTree(bad), XmlError, bad);
  }
  const t = parseXmlTree('\uFEFF<?xml version="1.0"?>\n<!-- c --><a q=\'1 &amp; 2\'><b><![CDATA[<raw>]]>&#x41;&#66;</b><c/></a>\n');
  assert.equal(t.attrs.q, '1 & 2');
  assert.equal(t.children[0].text, '<raw>AB');
  assert.equal(t.children[1].name, 'c');
});

test('strict mode rejects unknown components and settings; validateModel reports issues', () => {
  assert.throws(() => buildXml({ passes: { specialize: { 'Microsoft-Windows-Nope': { A: 1 } } } }, catalog), /unknown component/);
  assert.throws(() => buildXml({ passes: { specialize: { 'Microsoft-Windows-Shell-Setup': { NoSuch: 1 } } } }, catalog), /unknown settings/);
  assert.throws(() => buildXml({ passes: { lunch: {} } }, catalog), /unknown configuration pass/);
  const issues = validateModel({
    passes: {
      windowsPE: { 'Microsoft-Windows-Shell-Setup': { ComputerName: 'THIS-NAME-IS-TOO-LONG' } },
      oobeSystem: { 'Microsoft-Windows-Shell-Setup': { 'OOBE/HideEULAPage': 'maybe', 'FirstLogonCommands/SynchronousCommand': [{ Order: 1, CommandLine: 'a' }, { Order: 1, CommandLine: 'b' }] } },
    },
  }, catalog);
  const text = issues.map((i) => `${i.level} ${i.where} ${i.message}`).join('\n');
  assert.match(text, /error .*ComputerName not valid in the windowsPE pass/);
  assert.match(text, /error .*ComputerName ComputerName is 21 bytes/);
  assert.match(text, /error .*HideEULAPage value maybe is not true or false/);
  assert.match(text, /error .*SynchronousCommand\[1\] Order 1 is already used/);
});

test('parseXml maps an existing file and reports unknown elements', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS">
      <ComputerName>ARM-01</ComputerName>
      <MadeUpSetting>1</MadeUpSetting>
      <OOBE><HideEULAPage>TRUE</HideEULAPage><Bogus/></OOBE>
    </component>
    <component name="Contoso-Custom-Component" processorArchitecture="arm64"><X>1</X></component>
  </settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="arm64">
      <UserAccounts>
        <AdministratorPassword><Value>${encodePassword('Secret1', 'AdministratorPassword')}</Value><PlainText>false</PlainText></AdministratorPassword>
        <LocalAccounts>
          <LocalAccount wcm:action="add"><Name>u1</Name><Password><Value>broken==</Value><PlainText>false</PlainText></Password></LocalAccount>
        </LocalAccounts>
      </UserAccounts>
    </component>
  </settings>
  <settings pass="dinner"/>
</unattend>`;
  const { model, unknown, warnings } = parseXml(xml, catalog);
  assert.equal(model.architecture, 'arm64');
  const ss = model.passes.specialize['Microsoft-Windows-Shell-Setup'];
  assert.equal(ss.ComputerName, 'ARM-01');
  assert.equal(ss['OOBE/HideEULAPage'], true);
  assert.deepEqual(unknown, [
    "/unattend/settings[@pass='specialize']/component[@name='Microsoft-Windows-Shell-Setup']/MadeUpSetting",
    "/unattend/settings[@pass='specialize']/component[@name='Microsoft-Windows-Shell-Setup']/OOBE/Bogus",
    "/unattend/settings[@pass='specialize']/component[@name='Contoso-Custom-Component']",
    "/unattend/settings[@pass='dinner']",
  ]);
  const oobe = model.passes.oobeSystem['Microsoft-Windows-Shell-Setup'];
  assert.equal(oobe['UserAccounts/AdministratorPassword/Value'], 'Secret1');
  assert.equal(oobe['UserAccounts/AdministratorPassword/PlainText'], false);
  assert.equal(oobe['UserAccounts/LocalAccounts/LocalAccount'][0]['Password/Value'], 'broken==');
  assert.equal(warnings.length, 1);
  assert.throws(() => parseXml('<notunattend/>', catalog), /root element/);
});

test('offline image reference survives a round trip', () => {
  const m = { architecture: 'x86', passes: { specialize: { 'Microsoft-Windows-Shell-Setup': { ComputerName: 'A' } } }, offlineImage: { source: 'wim:c:/install.wim#Windows 11 Pro' } };
  const xml = buildXml(m, catalog);
  assert.match(xml, /<cpi:offlineImage cpi:source="wim:c:\/install\.wim#Windows 11 Pro" xmlns:cpi="urn:schemas-microsoft-com:cpi" \/>/);
  assert.deepEqual(parseXml(xml, catalog).model, m);
});

test('servicing packages round trip and no longer land in unknown', () => {
  const m = structuredClone(serverCore);
  m.servicing = [
    {
      action: 'configure',
      identity: { name: 'Microsoft-Windows-Foundation-Package', version: '10.0.26100.1', processorArchitecture: 'amd64', publicKeyToken: '31bf3856ad364e35', language: '', versionScope: 'nonSxS' },
      selections: [{ name: 'IIS-WebServerRole', state: true }, { name: 'SMB1Protocol', state: false }],
    },
    {
      action: 'install',
      permanence: 'permanent',
      identity: { name: 'Package_for_KB5000001', version: '10.0.1.0', processorArchitecture: 'amd64', publicKeyToken: '31bf3856ad364e35', language: 'neutral' },
      sources: [{ location: 'D:\\Updates\\KB5000001 & co.cab', permanence: 'permanent' }],
    },
    { action: 'remove', identity: { name: 'Microsoft-Windows-InternetExplorer-Optional-Package', version: '11.0.26100.1', processorArchitecture: 'amd64', publicKeyToken: '31bf3856ad364e35', language: '' } },
  ];
  assert.deepEqual(validateModel(m, catalog).filter((i) => i.level === 'error'), []);
  const xml = buildXml(m, catalog);
  assert.ok(xml.indexOf('<servicing>') < xml.indexOf('<settings pass="windowsPE">'), 'servicing must come before settings');
  assert.match(xml, /<package action="configure">\s*<assemblyIdentity name="Microsoft-Windows-Foundation-Package" version="10\.0\.26100\.1" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="" versionScope="nonSxS" \/>\s*<selection name="IIS-WebServerRole" state="true" \/>\s*<selection name="SMB1Protocol" state="false" \/>/);
  assert.match(xml, /<package action="install" permanence="permanent">[\s\S]*<source location="D:\\Updates\\KB5000001 &amp; co\.cab" permanence="permanent" \/>/);
  parseXmlTree(xml);
  const { model: back, unknown } = parseXml(xml, catalog);
  assert.deepEqual(unknown, []);
  assert.deepEqual(back.servicing, m.servicing);
  assert.equal(buildXml(back, catalog), xml);
});

test('servicing defaults identity fields and rejects bad actions', () => {
  const xml = buildXml({ architecture: 'arm64', servicing: [{ action: 'configure', identity: { name: 'Microsoft-Windows-Foundation-Package', version: '10.0.26100.1' }, selections: [{ name: 'X', state: 'true' }] }], passes: {} }, catalog);
  assert.match(xml, /processorArchitecture="arm64" publicKeyToken="31bf3856ad364e35" language="neutral"/);
  assert.match(xml, /<selection name="X" state="true" \/>/);
  assert.throws(() => buildXml({ servicing: [{ action: 'enable', identity: { name: 'a', version: '1.0.0.0' } }], passes: {} }, catalog), /action must be one of/);
  assert.throws(() => buildXml({ servicing: [{ action: 'install', identity: { name: 'a' } }], passes: {} }, catalog), /identity needs name and version/);
  const parsed = parseXml('<unattend xmlns="urn:schemas-microsoft-com:unattend"><servicing><package action="stage"><assemblyIdentity name="a" version="1.0.0.0" processorArchitecture="x86" publicKeyToken="31bf3856ad364e35" language="en-US"/><extra/></package><oops/></servicing></unattend>', catalog);
  assert.deepEqual(parsed.model.servicing, [{ action: 'stage', identity: { name: 'a', version: '1.0.0.0', processorArchitecture: 'x86', publicKeyToken: '31bf3856ad364e35', language: 'en-US' } }]);
  assert.deepEqual(parsed.unknown, ['/unattend/servicing/package[1]/extra', '/unattend/servicing/oops']);
});
