// Direct mode: the answer file is the catalog model, built and read only by answerfile/generate.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const A = require('../assets/answer.js');
const H = require('../assets/history.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const catPath = path.join(REPO, 'answerfile', 'unattend-catalog.json');
const genPath = path.join(REPO, 'answerfile', 'generate.mjs');
const ok = existsSync(catPath) && existsSync(genPath);
const cat = ok ? JSON.parse(readFileSync(catPath, 'utf8')) : null;
const gen = ok ? await import(genPath) : null;
const D = await import('../assets/canvas/direct.js');
const opts = { skip: ok ? false : 'answerfile/ not present' };

test('blank, add components, set values: XML equals the expected document', opts, () => {
  let d = D.blankDirect();
  d = D.addComponent(d, 'specialize', 'Microsoft-Windows-Shell-Setup');
  d = D.addComponent(d, 'specialize', 'Microsoft-Windows-TCPIP');
  d.all['specialize|Microsoft-Windows-Shell-Setup'] = { ComputerName: 'LAB-01', TimeZone: 'UTC' };
  d.all['specialize|Microsoft-Windows-TCPIP'] = { Interfaces: { Interface: [{ Identifier: 'Ethernet', UnicastIpAddresses: { IpAddress: [{ '@keyValue': '1', '#text': '10.0.0.5/24' }] } }] } };
  const expected = gen.buildXml({ architecture: 'amd64', passes: { specialize: {
    'Microsoft-Windows-Shell-Setup': { ComputerName: 'LAB-01', TimeZone: 'UTC' },
    'Microsoft-Windows-TCPIP': { 'Interfaces/Interface': [{ Identifier: 'Ethernet', 'UnicastIpAddresses/IpAddress': [{ Key: '1', Value: '10.0.0.5/24' }] }] } } } }, cat);
  const xml = D.buildDirectXml(d, cat, gen);
  assert.equal(xml, expected);
  assert.match(xml, /<IpAddress wcm:action="add" wcm:keyValue="1">10\.0\.0\.5\/24<\/IpAddress>/);
  assert.ok(!/TempDesk|FirstLogon/.test(xml), 'no template content in Direct mode');
  assert.equal(D.buildDirectXml(D.blankDirect(), cat, gen), '<?xml version="1.0" encoding="utf-8"?>\n<unattend xmlns="urn:schemas-microsoft-com:unattend">\n</unattend>\n');
});

const COMPLEX = `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
    <servicing>
        <package action="configure">
            <assemblyIdentity name="Microsoft-Windows-Foundation-Package" version="10.0.26100.1" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="" />
            <selection name="TelnetClient" state="true" />
        </package>
    </servicing>
    <settings pass="windowsPE">
        <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <DiskConfiguration>
                <Disk wcm:action="add">
                    <CreatePartitions>
                        <CreatePartition wcm:action="add"><Order>1</Order><Size>300</Size><Type>EFI</Type></CreatePartition>
                        <CreatePartition wcm:action="add"><Extend>true</Extend><Order>2</Order><Type>Primary</Type></CreatePartition>
                    </CreatePartitions>
                    <DiskID>0</DiskID>
                    <WillWipeDisk>true</WillWipeDisk>
                </Disk>
            </DiskConfiguration>
            <UserData><AcceptEula>true</AcceptEula><ProductKey><Key>VK7JG-NPHTM-C97JM-9MPGT-3V66T</Key></ProductKey></UserData>
        </component>
    </settings>
    <settings pass="specialize">
        <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <ComputerName>LAB-01</ComputerName>
            <ContosoTweak>on</ContosoTweak>
        </component>
        <component name="Contoso-Agent" processorArchitecture="amd64"><Server>agent.lab</Server></component>
        <component name="Microsoft-Windows-Deployment" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
            <RunSynchronous>
                <RunSynchronousCommand wcm:action="add"><Order>1</Order><Path>cmd /c echo one</Path><WillReboot>Always</WillReboot></RunSynchronousCommand>
            </RunSynchronous>
        </component>
    </settings>
    <settings pass="oobeSystem">
        <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
            <UserAccounts>
                <AdministratorPassword><Value>cAB3AEEAZABtAGkAbgBpAHMAdAByAGEAdABvAHIAUABhAHMAcwB3AG8AcgBkAA==</Value><PlainText>false</PlainText></AdministratorPassword>
                <LocalAccounts><LocalAccount wcm:action="add"><Name>kiosk</Name><Group>Users</Group><Password><Value>x</Value><PlainText>true</PlainText></Password></LocalAccount></LocalAccounts>
            </UserAccounts>
        </component>
    </settings>
    <ContosoFooter version="2" />
</unattend>
`;

test('importing a complex file maps every known element to the model, keeps unknown parts as raw blocks, and round-trips identically', opts, () => {
  const r = D.importDirect(COMPLEX, cat, gen);
  assert.equal(r.unknown.length, 3);
  assert.deepEqual(r.direct.rawBlocks.map((b) => b.scope).sort(), ['inside', 'pass', 'top']);
  assert.equal(r.direct.all['specialize|Microsoft-Windows-Shell-Setup'].ComputerName, 'LAB-01');
  assert.deepEqual(r.direct.all['oobeSystem|Microsoft-Windows-Shell-Setup'].UserAccounts.AdministratorPassword, { '@password': 'pw' });
  assert.equal(r.direct.servicing[0].selections[0].name, 'TelnetClient');
  const xml1 = D.buildDirectXml(r.direct, cat, gen);
  const r2 = D.importDirect(xml1, cat, gen);
  const xml2 = D.buildDirectXml(r2.direct, cat, gen);
  assert.equal(xml2, xml1, 'the second round trip is byte-identical');
  assert.deepEqual(r2.direct, r.direct, 'and the model is identical');
  assert.deepEqual(A.compareXml(COMPLEX.replace(/<ContosoTweak>on<\/ContosoTweak>|<component name="Contoso-Agent"[^]*?<\/component>|<ContosoFooter version="2" \/>/g, ''),
    xml1.replace(/<ContosoTweak>on<\/ContosoTweak>|<component name="Contoso-Agent"[^]*?<\/component>|<ContosoFooter version="2"><\/ContosoFooter>/g, '')).changed, [], 'no known setting changes value');
  assert.match(xml1, /<ContosoTweak>on<\/ContosoTweak>/);
  assert.match(xml1, /<component name="Contoso-Agent"/);
  assert.match(xml1, /<ContosoFooter version="2">/);
  assert.equal(gen.parseXml(xml1, cat).unknown.length, 3, 'the unknown parts are still there, still unknown');
});

test('Guided to Direct loses nothing', opts, () => {
  for (const mode of A.MODES) {
    const m = A.applySnippet(A.applySnippet(A.defaultModel(), 'rdp'), 'staticIp');
    m.mode = mode;
    m.server.adminPassword = 'Admin#Pass12345'; m.guest.joinPassword = 'join'; m.custom.accounts[0].password = 'pw';
    m.commands.runSync = [{ command: 'cmd /c a', description: 'A', willReboot: 'Always', disabled: false }];
    m.extras = Object.assign(A.extraDefaults(), { uacOff: true, oemManufacturer: 'Lab' });
    m.raw = '<settings pass="specialize"><component name="Contoso-Made-Up"><X>1</X></component></settings>';
    const g = D.guidedToDirect(m, A, cat, gen);
    const before = A.buildXml(m), after = D.buildDirectXml(g.direct, cat, gen);
    const c = A.compareXml(before, after);
    assert.deepEqual([c.added, c.removed, c.changed], [[], [], []], mode + ': every setting carried over');
    assert.equal(g.direct.rawBlocks.length, 1, mode + ': the raw component is kept');
    assert.ok(!('server' in g.direct) && !('commands' in g.direct), 'no template fields in the direct model');
  }
});

test('Direct to Guided is refused unless the file matches a template', opts, () => {
  const plain = D.guidedToDirect(A.defaultModel(), A, cat, gen).direct;
  const back = D.directToGuided(plain, A, cat, gen);
  assert.equal(back.ok, true, 'an unchanged template file converts back');
  assert.equal(back.mode, 'server');
  assert.deepEqual(A.compareXml(D.buildDirectXml(plain, cat, gen), A.buildXml(back.model)).changed, []);
  const blank = D.directToGuided(D.blankDirect(), A, cat, gen);
  assert.equal(blank.ok, false);
  const edited = JSON.parse(JSON.stringify(plain));
  edited.all['specialize|Microsoft-Windows-TCPIP'] = { Interfaces: { Interface: [{ Identifier: 'Ethernet' }] } };
  const r = D.directToGuided(edited, A, cat, gen);
  assert.equal(r.ok, false);
  assert.ok(r.reasons.some((x) => /Microsoft-Windows-TCPIP/.test(x)), 'the reason names the extra component');
  const withRaw = D.importDirect(COMPLEX, cat, gen).direct;
  assert.ok(D.directToGuided(withRaw, A, cat, gen).reasons.some((x) => /^raw:/.test(x)));
});

test('rules engine and quick fixes work on the direct model', opts, () => {
  let d = D.blankDirect();
  d.all['specialize|Microsoft-Windows-Shell-Setup'] = { ComputerName: '12345' };
  assert.ok(D.directIssues(d, cat, gen).some((i) => i.id === 'computerName.digits'));
  d = D.directFix(d, cat, gen, 'computerName.digits');
  assert.equal(d.all['specialize|Microsoft-Windows-Shell-Setup'].ComputerName, 'PC-12345');
  assert.ok(!D.directIssues(d, cat, gen).some((i) => i.id === 'computerName.digits'));
});

test('component move and duplicate keep only settings the target pass allows', opts, () => {
  const d = D.blankDirect();
  d.all['specialize|Microsoft-Windows-Shell-Setup'] = { ComputerName: 'A1', TimeZone: 'UTC' };
  const dup = D.copyComponent(d, 'specialize|Microsoft-Windows-Shell-Setup', 'oobeSystem', cat, false);
  assert.deepEqual(dup.dropped, ['ComputerName']);
  assert.deepEqual(dup.direct.all['oobeSystem|Microsoft-Windows-Shell-Setup'], { TimeZone: 'UTC' });
  assert.ok(dup.direct.all['specialize|Microsoft-Windows-Shell-Setup']);
  const mv = D.copyComponent(d, 'specialize|Microsoft-Windows-Shell-Setup', 'oobeSystem', cat, true);
  assert.deepEqual(mv.direct.all['specialize|Microsoft-Windows-Shell-Setup'], { ComputerName: 'A1' }, 'what cannot move stays');
  assert.equal(D.removeComponent(d, 'specialize|Microsoft-Windows-Shell-Setup').all['specialize|Microsoft-Windows-Shell-Setup'], undefined);
});

test('disk and command canvases operate on the direct model without changing anything else', opts, () => {
  const d = D.guidedToDirect(A.defaultModel(), A, cat, gen).direct;
  const x = D.buildDirectXml(d, cat, gen);
  assert.equal(D.buildDirectXml(D.setDirectDisks(d, D.directDisks(d, A), A), cat, gen), x);
  assert.equal(D.buildDirectXml(D.setDirectCommands(d, D.directCommands(d)), cat, gen), x);
  const c = D.directCommands(d);
  c.runSync.push({ command: 'cmd /c two', description: '', willReboot: 'Never', disabled: false });
  assert.match(D.buildDirectXml(D.setDirectCommands(d, c), cat, gen), /<Path>cmd \/c two<\/Path>/);
});

test('undo and redo work across a Guided to Direct switch', opts, async () => {
  const box = { entries: [] };
  const h = new H.History({ store: H.memoryStore(box), initial: A.defaultModel(), coalesceMs: 0 });
  await h.load();
  const g = A.defaultModel(); g.server.computerName = 'DC-A';
  h.change(g, 'edit guided');
  const dm = A.defaultModel(); dm.mode = 'direct'; dm.direct = D.guidedToDirect(g, A, cat, gen).direct;
  h.change(dm, 'switch to direct');
  const dm2 = JSON.parse(JSON.stringify(dm)); dm2.direct.all['specialize|Microsoft-Windows-Shell-Setup'].ComputerName = 'DC-B';
  h.change(dm2, 'edit direct');
  assert.equal(h.undo().state.direct.all['specialize|Microsoft-Windows-Shell-Setup'].ComputerName, 'DC-A');
  const back = h.undo().state;
  assert.equal(back.mode, 'server', 'undo returns to Guided');
  assert.equal(back.server.computerName, 'DC-A');
  assert.equal(h.redo().state.mode, 'direct');
  assert.equal(h.redo().state.direct.all['specialize|Microsoft-Windows-Shell-Setup'].ComputerName, 'DC-B');
  for (const e of h.entries) { const n = A.normalizeModel(e.state); assert.ok(n.ok, 'every history state is a valid model: ' + (n.error || '')); }
});
