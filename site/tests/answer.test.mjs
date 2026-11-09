// Tests for the website scripts: node --test site/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { promises as fs, readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SITE = path.resolve(HERE, '..');
const REPO = path.resolve(SITE, '..');
const A = require('../assets/answer.js');
const Z = require('../assets/zip.js');
const W = require('../assets/wording.js');
const B64 = require('../assets/base64.js');
const H = require('../assets/history.js');

function filledModel() {
  const m = A.defaultModel();
  Object.assign(m.server, { adminPassword: 'Admin#Pass12345', dsrmPassword: 'Dsrm#Pass12345', productKey: '', functionalLevel: 'Win2025', portalsMode: 'native', agentTls: true });
  Object.assign(m.guest, { adminPassword: 'Local#Pass12345', joinPassword: 'Join pass & <x>', computerName: 'TD-PC01' });
  Object.assign(m.custom, { computerName: 'WS01', organization: 'Lab & Co', owner: 'IT', rdp: true, features: 'TelnetClient, Microsoft-Hyper-V-All', driversPE: 'D:\\Drivers\n\\\\srv\\share\\drv', driversOffline: 'E:\\More', autoLogonCount: '2', protectYourPC: '3' });
  m.custom.accounts = [{ name: 'admin', displayName: 'Admin', group: 'Administrators', password: 'P@ss one' }, { name: 'kiosk', displayName: '', group: 'Users', password: 'two' }];
  m.commands.runSync = [{ command: 'cmd /c echo one', description: 'One', willReboot: 'Always', disabled: false, credentials: { domain: 'LAB', username: 'svc', password: 'pw' } }];
  m.commands.runAsync = [{ command: 'cmd /c echo async', description: '', willReboot: 'Never', disabled: false }];
  m.commands.firstLogon = [{ command: 'cmd /c echo two', description: 'Two', willReboot: 'Never', disabled: false }, { command: 'cmd /c skipped', description: '', disabled: true }];
  m.commands.logon = [{ command: 'cmd /c echo three', description: '', willReboot: 'Never', disabled: false }];
  m.extras = Object.assign(A.extraDefaults(), { uacOff: true, oemManufacturer: 'Lab', updates: 'notify', telemetry: '1', powerPlan: 'high', ntpServer: 'time.windows.com', sshServer: true, apps: 'chrome, git' });
  return m;
}

// ---------------------------------------------------------------------------------------------
// XML well-formedness
// ---------------------------------------------------------------------------------------------
test('autounattend output is well-formed XML for all three modes', () => {
  const m = filledModel();
  for (const mode of A.MODES) {
    m.mode = mode;
    const xml = A.buildXml(m);
    const root = A.parseXml(xml);
    assert.equal(root.n, 'unattend');
    assert.equal(root.a.xmlns, 'urn:schemas-microsoft-com:unattend');
    const passes = root.c.map((s) => s.a.pass);
    assert.deepEqual(passes, A.PASS_ORDER.filter((p) => passes.includes(p)), 'passes are in Windows order');
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>'));
  }
});

test('the checker rejects malformed XML', () => {
  for (const bad of ['<a><b></a>', '<a>&bogus;</a>', '<a x="1" x="2"/>', '<a></a><b></b>', '<!DOCTYPE a><a/>', '<a>x & y</a>', '<a', '']) {
    assert.equal(A.isWellFormed(bad), false, bad);
  }
  assert.equal(A.isWellFormed('<?xml version="1.0"?><!-- c --><a b="&amp;"><![CDATA[<x>]]>&#x41;</a>'), true);
});

test('generated XML is accepted by the shared answerfile catalog and rules when present', async (t) => {
  const genPath = path.join(REPO, 'answerfile', 'generate.mjs');
  const catPath = path.join(REPO, 'answerfile', 'unattend-catalog.json');
  if (!existsSync(genPath) || !existsSync(catPath)) { t.skip('answerfile/ not present'); return; }
  const g = await import(pathToFileURL(genPath).href);
  const catalog = JSON.parse(readFileSync(catPath, 'utf8'));
  const m = filledModel();
  for (const mode of A.MODES) {
    m.mode = mode;
    const r = g.parseXml(A.buildXml(m), catalog);
    assert.deepEqual(r.unknown, [], mode + ': every element is in the catalog');
    const errors = g.validateModel(r.model, catalog).filter((i) => i.level === 'error');
    assert.deepEqual(errors, [], mode + ': no rule errors');
  }
});

// ---------------------------------------------------------------------------------------------
// Passwords
// ---------------------------------------------------------------------------------------------
test('passwords use the Windows unattend encoding: base64 of UTF-16LE(password + suffix)', () => {
  const expected = Buffer.from('P@ssw0rd!AdministratorPassword', 'utf16le').toString('base64');
  assert.equal(A.unattendPassword('P@ssw0rd!', 'AdministratorPassword'), expected);
  assert.equal(A.unattendPassword('P@ssw0rd!', 'Password'), Buffer.from('P@ssw0rd!Password', 'utf16le').toString('base64'));
  assert.equal(A.unattendPassword('pw', 'AdministratorPassword'), 'cAB3AEEAZABtAGkAbgBpAHMAdAByAGEAdABvAHIAUABhAHMAcwB3AG8AcgBkAA==');
  assert.equal(A.decodeUnattendPassword(expected, 'AdministratorPassword'), 'P@ssw0rd!');
  assert.equal(A.unattendPassword('\u5bc6\u78bc', 'Password'), Buffer.from('\u5bc6\u78bcPassword', 'utf16le').toString('base64'));
  const xml = A.buildAutounattend({ computerName: 'DC1', adminPassword: 'P@ssw0rd!', firmware: 'uefi', imageIndex: 1 });
  assert.ok(xml.includes('<Value>' + expected + '</Value>'));
  assert.ok(xml.includes('<PlainText>false</PlainText>'));
  assert.ok(!xml.includes('P@ssw0rd!<'), 'no plain text administrator password');
});

// ---------------------------------------------------------------------------------------------
// Disk layouts
// ---------------------------------------------------------------------------------------------
function setupComp(xml) {
  const root = A.parseXml(xml);
  return root.c.find((s) => s.a.pass === 'windowsPE').c.find((c) => c.a.name === 'Microsoft-Windows-Setup');
}
const kids = (e, n) => e.c.filter((x) => x.n === n);
const txt = (e, p) => p.split('/').reduce((cur, n) => cur && cur.c.find((x) => x.n === n), e).t;

test('UEFI and BIOS layouts use the right partition types and install partition', () => {
  const uefi = setupComp(A.buildAutounattend({ computerName: 'A', adminPassword: 'x', firmware: 'uefi', imageIndex: 1 }));
  const disk = uefi.c.find((x) => x.n === 'DiskConfiguration').c[0];
  const types = kids(disk.c.find((x) => x.n === 'CreatePartitions'), 'CreatePartition').map((p) => txt(p, 'Type'));
  assert.deepEqual(types, ['EFI', 'MSR', 'Primary']);
  assert.equal(txt(uefi, 'ImageInstall/OSImage/InstallTo/PartitionID'), '3');
  const mods = kids(disk.c.find((x) => x.n === 'ModifyPartitions'), 'ModifyPartition');
  assert.equal(txt(mods[0], 'Format'), 'FAT32');

  const bios = setupComp(A.buildAutounattend({ computerName: 'A', adminPassword: 'x', firmware: 'bios', imageIndex: 3 }));
  const bdisk = bios.c.find((x) => x.n === 'DiskConfiguration').c[0];
  assert.deepEqual(kids(bdisk.c.find((x) => x.n === 'CreatePartitions'), 'CreatePartition').map((p) => txt(p, 'Type')), ['Primary', 'Primary']);
  assert.equal(txt(kids(bdisk.c.find((x) => x.n === 'ModifyPartitions'), 'ModifyPartition')[0], 'Active'), 'true');
  assert.equal(txt(bios, 'ImageInstall/OSImage/InstallTo/PartitionID'), '2');
  assert.equal(txt(bios, 'ImageInstall/OSImage/InstallFrom/MetaData/Value'), '3');
});

test('custom mode can install to an existing partition without wiping', () => {
  const m = filledModel();
  m.mode = 'custom'; m.custom.diskLayout = 'existing'; m.custom.partitionId = '4';
  const setup = setupComp(A.buildXml(m));
  assert.equal(setup.c.find((x) => x.n === 'DiskConfiguration'), undefined);
  assert.equal(txt(setup, 'ImageInstall/OSImage/InstallTo/PartitionID'), '4');
});

test('disk canvas layout writes DiskConfiguration and InstallTo, including recovery TypeID', () => {
  const m = filledModel();
  m.mode = 'custom';
  m.disks = { disks: [{ diskId: '1', sizeMB: '100000', wipe: true, partitions: [{ type: 'EFI', sizeMB: '260' }, { type: 'MSR', sizeMB: '16' }, { type: 'Primary', sizeMB: '90000', format: 'NTFS', label: 'Windows', letter: 'C' }, { type: 'Recovery', sizeMB: '1000', format: 'NTFS', label: 'Recovery' }] }], target: { diskId: '1', partitionId: '3' } };
  const setup = setupComp(A.buildXml(m));
  const disk = setup.c.find((x) => x.n === 'DiskConfiguration').c[0];
  assert.equal(txt(disk, 'DiskID'), '1');
  const mods = kids(disk.c.find((x) => x.n === 'ModifyPartitions'), 'ModifyPartition');
  assert.equal(txt(mods[3], 'TypeID'), 'de94bba4-06d1-4d40-a16a-bfd50179d6ac');
  assert.equal(txt(setup, 'ImageInstall/OSImage/InstallTo/DiskID'), '1');
});

// ---------------------------------------------------------------------------------------------
// Guest PC: UnattendedJoin
// ---------------------------------------------------------------------------------------------
test('guest mode writes UnattendedJoin in specialize with credentials, OU and DNS first', () => {
  const m = filledModel();
  m.mode = 'guest';
  m.guest.domainName = 'corp.example.org';
  const root = A.parseXml(A.buildXml(m));
  const spec = root.c.find((s) => s.a.pass === 'specialize');
  const names = spec.c.map((c) => c.a.name);
  const join = spec.c.find((c) => c.a.name === 'Microsoft-Windows-UnattendedJoin');
  assert.ok(join, 'join component present');
  assert.ok(names.indexOf('Microsoft-Windows-Deployment') < names.indexOf('Microsoft-Windows-UnattendedJoin'), 'DNS command component comes before the join');
  assert.equal(txt(join, 'Identification/JoinDomain'), 'corp.example.org');
  assert.equal(txt(join, 'Identification/Credentials/Domain'), 'corp.example.org');
  assert.equal(txt(join, 'Identification/Credentials/Username'), 'td-join');
  assert.equal(txt(join, 'Identification/Credentials/Password'), 'Join pass & <x>');
  assert.equal(txt(join, 'Identification/MachineObjectOU'), 'OU=Computers,OU=TempDesk,DC=corp,DC=example,DC=org');
  const dep = spec.c.find((c) => c.a.name === 'Microsoft-Windows-Deployment');
  assert.match(txt(dep, 'RunSynchronous/RunSynchronousCommand/Path'), /Set-DnsClientServerAddress -ServerAddresses '192\.168\.10\.10'/);
  const oobe = root.c.find((s) => s.a.pass === 'oobeSystem').c.find((c) => c.a.name === 'Microsoft-Windows-Shell-Setup');
  assert.equal(txt(oobe, 'OOBE/HideOnlineAccountScreens'), 'true');
  assert.equal(txt(oobe, 'OOBE/ProtectYourPC'), '3');
  m.guest.dnsMode = 'dhcp';
  const root2 = A.parseXml(A.buildXml(m));
  assert.equal(root2.c.find((s) => s.a.pass === 'specialize').c.find((c) => c.a.name === 'Microsoft-Windows-Deployment' && JSON.stringify(c).includes('Set-DnsClient')), undefined);
});

// ---------------------------------------------------------------------------------------------
// firstboot.json matches what server/firstboot/*.ps1 read
// ---------------------------------------------------------------------------------------------
test('firstboot.json has exactly the fields the firstboot scripts read', () => {
  const m = filledModel();
  const fb = JSON.parse(A.buildFirstboot(m.server));
  const required = ['computerName', 'ipAddress', 'prefixLength', 'gateway', 'dnsServers', 'domainName', 'netbiosName', 'functionalLevel', 'dsrmPassword', 'initialAdminUser', 'agent', 'portals'];
  assert.deepEqual(Object.keys(fb).sort(), required.slice().sort());
  assert.equal(typeof fb.prefixLength, 'number');
  assert.ok(Array.isArray(fb.dnsServers));
  assert.equal(fb.netbiosName, 'LAB');
  assert.equal(fb.functionalLevel, 'Win2025');
  assert.equal(fb.agent.tls, true);
  assert.equal(fb.portals.mode, 'native');
  assert.equal(fb.initialAdminUser, 'Administrator');
  // every $cfg.<name> the scripts use is present
  const scripts = ['FirstLogon.ps1', 'Continue-Setup.ps1'].map((f) => readFileSync(path.join(REPO, 'server', 'firstboot', f), 'utf8')).join('\n');
  const used = new Set([...scripts.matchAll(/\$cfg\.([A-Za-z]+)(?:\.([A-Za-z]+))?/g)].map((x) => x[1] + (x[2] ? '.' + x[2] : '')));
  for (const u of used) {
    const [a, b] = u.split('.');
    assert.ok(a in fb, 'firstboot.json has ' + a);
    if (b) assert.ok(b in fb[a], 'firstboot.json has ' + u);
  }
  // round trip back into the form
  const back = A.importFirstboot(JSON.stringify(fb), {});
  assert.equal(back.dnsServers, '127.0.0.1');
  assert.equal(back.portalsMode, 'native');
});

test('the FirstLogon command looks for TempDesk\\FirstLogon.ps1 on every drive', () => {
  const xml = A.buildAutounattend({ computerName: 'A', adminPassword: 'x', firmware: 'uefi', imageIndex: 1 });
  assert.ok(xml.includes("Join-Path $_.Root 'TempDesk\\FirstLogon.ps1'"));
  assert.ok(xml.includes('&amp; $f'));
});

// ---------------------------------------------------------------------------------------------
// Kit layout and zip
// ---------------------------------------------------------------------------------------------
test('kit layout: firstboot scripts directly in TempDesk/, payload folders under TempDesk/, portal only when native', () => {
  const manifest = { files: ['server/firstboot/FirstLogon.ps1', 'server/firstboot/Continue-Setup.ps1', 'server/firstboot/SetupStatus.ps1', 'server/Install-Forest.ps1', 'agent/src/Auth.cs', 'client/TempDesk-Logon.ps1', 'portal/app/main.py'].map((p) => ({ path: p, sha256: 'x' })) };
  const none = A.kitLayout(manifest, 'none').map((x) => x.dest);
  assert.deepEqual(none, ['TempDesk/FirstLogon.ps1', 'TempDesk/Continue-Setup.ps1', 'TempDesk/SetupStatus.ps1', 'TempDesk/server/Install-Forest.ps1', 'TempDesk/agent/src/Auth.cs', 'TempDesk/client/TempDesk-Logon.ps1']);
  assert.ok(A.kitLayout(manifest, 'native').some((x) => x.dest === 'TempDesk/portal/app/main.py'));
});

test('zip.js produces a valid zip (python3 -m zipfile -t)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tdzip-'));
  const big = new Uint8Array(200000); for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 255;
  const bytes = Z.makeZipBytes([{ name: 'autounattend.xml', data: A.buildXml(filledModel()) }, { name: 'TempDesk/firstboot.json', data: '{}' }, { name: 'TempDesk/\u4e2d\u6587.txt', data: '\u4f60\u597d' }, { name: 'TempDesk/bin.dat', data: big }]);
  const f = path.join(dir, 'kit.zip');
  writeFileSync(f, bytes);
  const out = execFileSync('python3', ['-I', '-m', 'zipfile', '-t', f], { encoding: 'utf8' });
  assert.match(out, /Done testing/);
  const list = execFileSync('python3', ['-I', '-X', 'utf8', '-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);print("\\n".join(z.namelist()));assert z.read("TempDesk/bin.dat")==bytes((i*31)&255 for i in range(200000))', f], { encoding: 'utf8' });
  assert.deepEqual(list.trim().split(/\r?\n/), ['autounattend.xml', 'TempDesk/firstboot.json', 'TempDesk/\u4e2d\u6587.txt', 'TempDesk/bin.dat']);
  assert.throws(() => Z.makeZipBytes([{ name: '../evil', data: 'x' }]));
  assert.throws(() => Z.makeZipBytes([{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }]));
});

// ---------------------------------------------------------------------------------------------
// Import round trip
// ---------------------------------------------------------------------------------------------
test('import round trip: generate then import gives the same form values for every mode', () => {
  const m = filledModel();
  for (const mode of A.MODES) {
    m.mode = mode;
    const xml = A.buildXml(m);
    const r = A.importXml(xml, {});
    assert.equal(r.mode, mode);
    for (const k of Object.keys(r.form)) {
      if (mode === 'server' && !['imageIndex', 'computerName', 'adminPassword', 'productKey', 'firmware', 'locale', 'keyboard', 'timeZone'].includes(k)) continue;
      assert.deepEqual(r.form[k], m[mode][k], mode + '.' + k);
    }
    const commands = mode === 'server' ? m.commands : m.commands;
    assert.deepEqual(r.commands.runSync.map((c) => c.command), commands.runSync.map((c) => c.command));
    assert.deepEqual(r.commands.firstLogon.map((c) => c.command), ['cmd /c echo two']);
    assert.deepEqual(r.extras, m.extras);
    assert.deepEqual(r.unknown, []);
    const m2 = A.defaultModel();
    m2.mode = mode; Object.assign(m2[mode], r.form); m2.commands = r.commands; m2.disks = r.disks; m2.extras = r.extras; m2.all = r.all; m2.raw = r.raw;
    const disabledDropped = JSON.parse(JSON.stringify(m)); disabledDropped.commands.firstLogon = disabledDropped.commands.firstLogon.filter((c) => !c.disabled);
    assert.equal(A.buildXml(m2), A.buildXml(disabledDropped), mode + ': regenerated XML is identical');
  }
});

test('import keeps unknown components in the raw block and reports them', () => {
  const m = filledModel();
  m.mode = 'custom';
  m.raw = '<settings pass="specialize"><component name="Contoso-Made-Up"><Thing>1</Thing></component></settings>';
  m.all = { 'specialize|Microsoft-Windows-TCPIP': { Interfaces: { Interface: [{ Identifier: 'Ethernet' }] } } };
  const xml = A.buildXml(m);
  const r = A.importXml(xml, { knownComponent: (n) => n === 'Microsoft-Windows-TCPIP' });
  assert.deepEqual(r.unknown, ['specialize / Contoso-Made-Up / Thing']);
  assert.match(r.raw, /Contoso-Made-Up/);
  assert.deepEqual(r.all['specialize|Microsoft-Windows-TCPIP'], m.all['specialize|Microsoft-Windows-TCPIP']);
  assert.throws(() => A.importXml('<notunattend/>'));
  assert.throws(() => A.importXml('<unattend><settings></unattend>'));
});

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------
test('validate() keeps its original API and messages', () => {
  const ok = { computerName: 'DC01', domainName: 'lab.example.org', netbiosName: 'LAB', ipAddress: '10.0.0.2', gateway: '10.0.0.1', prefixLength: '24', dnsServers: '127.0.0.1', adminPassword: 'Aa1!aaaaaaaaaa', dsrmPassword: 'Bb2@bbbbbbbbbb', productKey: '' };
  assert.deepEqual(A.validate(ok), {});
  const bad = A.validate(Object.assign({}, ok, { computerName: '1234', ipAddress: '300.1.1.1', adminPassword: 'short', productKey: 'nope' }));
  assert.deepEqual(Object.keys(bad).sort(), ['adminPassword', 'computerName', 'ipAddress', 'productKey']);
  assert.match(bad.computerName, /15 letters/);
  assert.equal(A.validateMode('guest', Object.assign(A.defaultModel().guest, { joinPassword: '' })).joinPassword, 'passwordReq');
  assert.equal(A.validateMode('server', Object.assign(A.defaultModel().server, { timeZone: 'Mars Time' })).timeZone, 'timeZone');
});

test('model and preset imports are validated before anything is applied', () => {
  assert.equal(A.normalizeModel({ schema: 'x' }).ok, false);
  assert.equal(A.normalizeModel({ schema: 'tempdesk-answer-model', version: 1, mode: 'server', server: { computerName: {} } }).ok, false);
  assert.equal(A.normalizeModel({ schema: 'tempdesk-answer-model', version: 1, mode: 'server', raw: '<oops' }).ok, false);
  assert.equal(A.normalizeModel(JSON.parse('{"schema":"tempdesk-answer-model","version":1,"mode":"server","all":{"__proto__":{}}}')).ok, false);
  const good = A.normalizeModel(JSON.parse(JSON.stringify(filledModel())));
  assert.equal(good.ok, true);
  const stripped = A.stripSecrets(filledModel());
  assert.equal(stripped.server.adminPassword, '');
  assert.equal(stripped.commands.runSync[0].credentials.password, '');
  assert.equal(A.normalizePresetBundle({ schema: 'tempdesk-presets', version: 1, presets: { ok: filledModel(), bad: { schema: 'no' } } }).ok, false);
});

test('password generator and strength meter', () => {
  const pw = A.generatePassword(20);
  assert.equal(pw.length, 20);
  assert.ok(A.strongPassword(pw));
  assert.equal(A.passwordStrength('').code, 'empty');
  assert.ok(A.passwordStrength('password1').score <= 1);
  assert.ok(A.passwordStrength(pw).score >= 3);
});

// ---------------------------------------------------------------------------------------------
// Personal wording validator
// ---------------------------------------------------------------------------------------------
test('personal wording: accepts a good file and rejects duplicates, oversize and bad keys', () => {
  const ok = W.validate('{"schemaVersion":1,"entries":{"Guest":"Visitor","sign-in":"login"}}');
  assert.equal(ok.get('Guest'), 'Visitor');
  const code = (input) => { try { W.validate(input); return 'ok'; } catch (e) { return e.code; } };
  assert.equal(code('{"schemaVersion":1,"entries":{"a":"1","a":"2"}}'), 'duplicate');
  assert.equal(code('{"schemaVersion":1,"schemaVersion":1,"entries":{}}'), 'duplicate');
  assert.equal(code('{"schemaVersion":1,"entries":{"__proto__":"x"}}'), 'keyReserved');
  assert.equal(code('{"schemaVersion":1,"entries":{"constructor":"x"}}'), 'keyReserved');
  assert.equal(code('{"schemaVersion":1,"entries":{"":"x"}}'), 'keyLength');
  assert.equal(code(JSON.stringify({ schemaVersion: 1, entries: { ['k'.repeat(161)]: 'x' } })), 'keyLength');
  assert.equal(code(JSON.stringify({ schemaVersion: 1, entries: { k: 'v'.repeat(1001) } })), 'valueLength');
  assert.equal(code('{"schemaVersion":1,"entries":{"k":"bad\\u0007"}}'), 'valueControl');
  assert.equal(code('{"schemaVersion":1,"entries":{"k":1}}'), 'valueType');
  assert.equal(code('{"schemaVersion":2,"entries":{}}'), 'schemaVersion');
  assert.equal(code('{"schemaVersion":1,"entries":{},"x":1}'), 'topKeys');
  assert.equal(code('{"schemaVersion":1,"entries":{"a":[[[[[[[[[1]]]]]]]]]}}'), 'depth');
  assert.equal(code(new Uint8Array(256 * 1024 + 1).fill(32)), 'size');
  assert.equal(code('{"schemaVersion":1,"entries":{"a":"b"},}'), 'json');
  const tr = W.buildTranslator(ok);
  assert.equal(tr('Guest sign-in for GUESTS'), 'Visitor login for GUESTS');
  assert.equal(tr('guest'), 'visitor');
});

// ---------------------------------------------------------------------------------------------
// i18n catalogs
// ---------------------------------------------------------------------------------------------
test('en.json and zh-HK.json have identical keys and placeholders', () => {
  const en = JSON.parse(readFileSync(path.join(SITE, 'i18n', 'en.json'), 'utf8'));
  const zh = JSON.parse(readFileSync(path.join(SITE, 'i18n', 'zh-HK.json'), 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const k of Object.keys(en)) {
    const ph = (s) => [...new Set(String(s).match(/\{\d\}/g) || [])].sort();
    assert.deepEqual(ph(zh[k]), ph(en[k]), k);
  }
  for (const v of Object.values(en)) assert.ok(!v.includes('\u2014'), 'no em dash in English copy');
});

// ---------------------------------------------------------------------------------------------
// History engine
// ---------------------------------------------------------------------------------------------
function fakeClock() {
  let now = 1000; const timers = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => { const tm = { fn, at: now + ms }; timers.push(tm); return tm; },
    clearTimer: (tm) => { const i = timers.indexOf(tm); if (i >= 0) timers.splice(i, 1); },
    advance(ms) { now += ms; timers.filter((x) => x.at <= now).forEach((x) => { timers.splice(timers.indexOf(x), 1); x.fn(); }); }
  };
}
test('history: typing coalesces per field after 1 s idle', async () => {
  const c = fakeClock();
  const h = new H.History({ store: H.memoryStore(), initial: { name: '' }, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  await h.load();
  h.change({ name: 'D' }, 'type', 'name'); c.advance(300);
  h.change({ name: 'DC' }, 'type', 'name'); c.advance(300);
  h.change({ name: 'DC0' }, 'type', 'name');
  assert.equal(h.entries.length, 1, 'nothing recorded while typing');
  c.advance(1000);
  assert.equal(h.entries.length, 2);
  assert.deepEqual(h.head().state, { name: 'DC0' });
  h.change({ name: 'DC0', ip: '1' }, 'type', 'ip');
  h.change({ name: 'DC01', ip: '1' }, 'type', 'name');
  assert.equal(h.entries.length, 3, 'switching field flushes the previous one');
  h.flush();
  assert.equal(h.entries.length, 4, 'blur flushes');
});
test('history: undo and redo are recorded, survive a reload, and jump-to restores', async () => {
  const box = { entries: [] };
  const h = new H.History({ store: H.memoryStore(box), initial: { v: 0 }, coalesceMs: 0 });
  await h.load();
  h.change({ v: 1 }, 'one'); h.change({ v: 2 }, 'two'); h.change({ v: 3 }, 'three');
  assert.deepEqual(h.undo().state, { v: 2 });
  assert.deepEqual(h.undo().state, { v: 1 });
  assert.equal(h.entries.length, 6, 'undo entries are appended, not removed');
  await h.settle();
  const h2 = new H.History({ store: H.memoryStore(box), initial: { v: 0 }, coalesceMs: 0 });
  await h2.load();
  assert.deepEqual(h2.state, { v: 1 }, 'state survives reload');
  assert.ok(h2.canRedo());
  assert.deepEqual(h2.redo().state, { v: 2 });
  assert.deepEqual(h2.redo().state, { v: 3 });
  assert.equal(h2.redo(), null);
  assert.deepEqual(h2.undo().state, { v: 2 });
  const first = h2.entries.find((e) => e.msg === 'one');
  const r = h2.restore(first.id);
  assert.equal(r.kind, 'restore');
  assert.deepEqual(r.state, { v: 1 });
  assert.equal(r.msg.key, 'hist.restore');
  assert.deepEqual(h2.undo().state, { v: 2 }, 'a restore can itself be undone');
  const all = JSON.parse(h2.exportJson());
  assert.equal(all.entries.length, h2.entries.length);
});
test('history: redaction keeps passwords out unless allowed', async () => {
  const box = { entries: [] };
  const h = new H.History({ store: H.memoryStore(box), initial: A.defaultModel(), coalesceMs: 0, redact: (s) => A.stripSecrets(s) });
  await h.load();
  const m = filledModel();
  h.change(m, 'x');
  await h.settle();
  assert.ok(!box.entries.join('').includes('Admin#Pass12345'));
});

// ---------------------------------------------------------------------------------------------
// Base64 codec
// ---------------------------------------------------------------------------------------------
const rnd = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 73 + 41) & 255; return b; };
test('base64: all variants and options round trip and match Node', () => {
  for (const n of [0, 1, 2, 3, 4, 5, 57, 58, 59, 1000]) {
    const b = rnd(n);
    assert.equal(B64.encode(b), Buffer.from(b).toString('base64'));
    assert.equal(B64.encode(b, { variant: 'url' }), Buffer.from(b).toString('base64url'));
    for (const opts of [{}, { variant: 'url' }, { variant: 'url', pad: true }, { pad: false }, { variant: 'mime' }, { lineLength: 8, eol: '\n' }]) {
      const e = B64.encode(b, opts);
      const dv = opts.variant === 'url' ? 'url' : opts.variant === 'mime' ? 'mime' : 'standard';
      const strict = !(opts.pad === false) && !opts.lineLength;
      assert.deepEqual(B64.decode(e, { variant: dv, strict }), b, JSON.stringify(opts) + ' n=' + n);
      assert.deepEqual(B64.decode(e, { variant: dv, strict: false }), b);
    }
  }
  const mime = B64.encode(rnd(200), { variant: 'mime' });
  assert.ok(mime.split('\r\n').every((l) => l.length <= 76));
  assert.equal(mime.split('\r\n')[0].length, 76);
  assert.equal(B64.encodedLength(200, { variant: 'mime' }), mime.length);
});
test('base64: padding edge cases for 0, 1 and 2 remainder bytes', () => {
  assert.equal(B64.encode(new Uint8Array([102, 111, 111])), 'Zm9v');
  assert.equal(B64.encode(new Uint8Array([102])), 'Zg==');
  assert.equal(B64.encode(new Uint8Array([102, 111])), 'Zm8=');
  assert.equal(B64.encode(new Uint8Array([102]), { pad: false }), 'Zg');
  assert.deepEqual(B64.decode('Zg', { strict: false }), new Uint8Array([102]));
  assert.throws(() => B64.decode('Zg', { strict: true }), (e) => e.code === 'padding');
  assert.deepEqual(B64.decode('Zg', { variant: 'url', strict: true }), new Uint8Array([102]));
  assert.throws(() => B64.decode('Z', { strict: false }), (e) => e.code === 'length');
  assert.throws(() => B64.decode('Zh==', { strict: true }), (e) => e.code === 'bits');
  assert.throws(() => B64.decode('Zg==Zg==', { strict: true }), (e) => e.code === 'afterPad' && e.offset === 4);
  assert.throws(() => B64.decode('Z===', { strict: true }), (e) => e.code === 'padding');
});
test('base64: strict decoder reports the exact offset of a bad character', () => {
  assert.throws(() => B64.decode('Zm9v!Zm9v', { strict: true }), (e) => e.code === 'char' && e.offset === 4 && e.char === '!');
  assert.throws(() => B64.decode('Zm9v Zm9v', { strict: true }), (e) => e.code === 'char' && e.offset === 4);
  assert.throws(() => B64.decode('Zm9v-_', { strict: true }), (e) => e.code === 'char' && e.offset === 4);
  assert.deepEqual(B64.decode('Zm9v\r\nZm9v', { variant: 'mime', strict: true }), new TextEncoder().encode('foofoo'));
  assert.deepEqual(B64.decode(' Zm 9v\n', { strict: false }), new TextEncoder().encode('foo'));
  const d = B64.createDecoder({ strict: true });
  d.push('Zm9v');
  assert.throws(() => d.push('Zm*v'), (e) => e.offset === 6);
});
test('base64: chunked streaming equals one-shot', () => {
  const b = rnd(10007);
  const one = B64.encode(b, { variant: 'mime' });
  for (const size of [1, 2, 3, 4, 7, 300, 4096]) {
    const e = B64.createEncoder({ variant: 'mime' });
    let out = '';
    for (let i = 0; i < b.length; i += size) out += e.push(b.subarray(i, i + size));
    out += e.end();
    assert.equal(out, one, 'encode chunk ' + size);
    const d = B64.createDecoder({ variant: 'mime' });
    const parts = [];
    for (let i = 0; i < one.length; i += size) parts.push(d.push(one.slice(i, i + size)));
    parts.push(d.end());
    assert.deepEqual(B64.concat(parts), b, 'decode chunk ' + size);
  }
  const s = B64.createSha256();
  for (let i = 0; i < b.length; i += 333) s.update(b.subarray(i, i + 333));
  assert.equal(s.hex(), require('node:crypto').createHash('sha256').update(b).digest('hex'));
});
test('base64: text encodings, data URLs and type detection', () => {
  assert.deepEqual([...B64.textToBytes('A\u00e9', 'utf-16le')], [65, 0, 233, 0]);
  assert.deepEqual([...B64.textToBytes('A\u00e9', 'utf-16be')], [0, 65, 0, 233]);
  assert.deepEqual([...B64.textToBytes('A\u00e9', 'latin1')], [65, 233]);
  assert.throws(() => B64.textToBytes('\u4e2d', 'latin1'), (e) => e.code === 'latin1' && e.offset === 0);
  assert.equal(B64.bytesToText(B64.textToBytes('\u4f60\u597d', 'utf-8'), 'utf-8'), '\u4f60\u597d');
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const url = B64.buildDataUrl(png, 'image/png');
  assert.equal(url, 'data:image/png;base64,' + Buffer.from(png).toString('base64'));
  const p = B64.parseDataUrl(url);
  assert.equal(p.mime, 'image/png'); assert.equal(p.base64, true); assert.deepEqual(p.bytes, png);
  const t = B64.parseDataUrl('data:text/plain;charset=UTF-8,hello%20world');
  assert.equal(t.params.charset, 'UTF-8'); assert.equal(new TextDecoder().decode(t.bytes), 'hello world');
  const d = B64.parseDataUrl('data:,A');
  assert.equal(d.mime, 'text/plain'); assert.equal(d.params.charset, 'US-ASCII');
  assert.throws(() => B64.parseDataUrl('http://x'), (e) => e.code === 'notData');
  assert.throws(() => B64.parseDataUrl('data:text/plain'), (e) => e.code === 'noComma');
  assert.equal(B64.detectType(png).ext, 'png');
  assert.equal(B64.detectType(new TextEncoder().encode('%PDF-1.7')).ext, 'pdf');
  assert.equal(B64.detectType(new TextEncoder().encode('{"a":1}')).ext, 'json');
  assert.equal(B64.detectType(new TextEncoder().encode('<?xml version="1.0"?><a/>')).ext, 'xml');
  assert.equal(B64.detectType(new TextEncoder().encode('hello')).ext, 'txt');
  assert.equal(B64.detectType(new Uint8Array([0x1f, 0x8b, 8])).ext, 'gz');
  assert.equal(B64.detectType(new Uint8Array([0, 1, 2, 3, 0xff])).ext, 'bin');
  assert.equal(B64.suggestName('photo.b64', { ext: 'png' }), 'photo.png');
});

// ---------------------------------------------------------------------------------------------
// Build script and markdown
// ---------------------------------------------------------------------------------------------
test('markdown renderer handles headings, lists, code, tables and escapes HTML', async () => {
  const { renderMarkdown } = await import('../build.mjs');
  const r = renderMarkdown('# Title\n\nText with `code` and **bold** <script>x</script>.\n\n- a\n- b\n  - c\n\n1. one\n2. two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```ps1\nGet-Item <x>\n```\n\n[link](javascript:alert(1)) [ok](API.md#x)');
  assert.match(r.html, /<h1 id="title">Title<\/h1>/);
  assert.match(r.html, /&lt;script&gt;/);
  assert.match(r.html, /<code>code<\/code>/);
  assert.match(r.html, /<ul><li>a<\/li><li>b<ul><li>c<\/li><\/ul><\/li><\/ul>/);
  assert.match(r.html, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
  assert.match(r.html, /<table>/);
  assert.match(r.html, /Get-Item &lt;x&gt;/);
  assert.match(r.html, /href="#"/);
  assert.ok(!r.html.includes('javascript:'));
});
test('payload exclusions drop tests, caches, env files and node_modules', async () => {
  const { payloadAllowed } = await import('../build.mjs');
  assert.equal(payloadAllowed('server/Install-Forest.ps1', false), true);
  for (const p of ['portal/tests/test_x.py', 'portal/app/__pycache__/a.pyc', 'portal/.env', 'portal/.env.local', 'agent/node_modules/x.js', 'portal/app/test_y.py']) assert.equal(payloadAllowed(p, false), false, p);
});
