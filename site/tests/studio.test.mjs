// Answer File Studio helpers: two-way XML sync, quick fixes, compare, simulate, snippets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const A = require('../assets/answer.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const catPath = path.join(REPO, 'answerfile', 'unattend-catalog.json');
const genPath = path.join(REPO, 'answerfile', 'generate.mjs');
const haveShared = existsSync(catPath) && existsSync(genPath);
const rawCatalog = haveShared ? JSON.parse(readFileSync(catPath, 'utf8')) : null;
const known = (n) => !!rawCatalog && rawCatalog.components.some((c) => c.name === n);

function model(mode) {
  const m = A.applySnippet(A.applySnippet(A.defaultModel(), 'rdp'), 'staticIp');
  m.mode = mode;
  m.server.adminPassword = 'Admin#Pass12345'; m.server.dsrmPassword = 'Dsrm#Pass12345';
  m.guest.joinPassword = 'join'; m.custom.accounts[0].password = 'pw';
  m.commands.firstLogon = [{ command: 'cmd /c echo on', description: 'On', willReboot: 'Never', disabled: false }, { command: 'cmd /c off', description: '', willReboot: 'Never', disabled: true }];
  return m;
}

test('XML two-way sync: editing the XML updates the model, and the model regenerates the same XML', () => {
  for (const mode of A.MODES) {
    const m = model(mode);
    const xml = A.buildXml(m);
    const edited = xml.replace('<TimeZone>Eastern Standard Time</TimeZone>', '<TimeZone>UTC</TimeZone>').replace('<fDenyTSConnections>false</fDenyTSConnections>', '<fDenyTSConnections>true</fDenyTSConnections>');
    assert.notEqual(edited, xml);
    const r = A.syncFromXml(m, edited, { knownComponent: known });
    assert.equal(r.model[mode].timeZone, 'UTC', mode + ': friendly field updated');
    assert.equal(r.model.all['specialize|Microsoft-Windows-TerminalServices-LocalSessionManager'].fDenyTSConnections, 'true', mode + ': catalog setting updated');
    assert.equal(A.buildXml(r.model), edited, mode + ': model to XML gives the edited text back');
    assert.ok(r.model.commands.firstLogon.some((c) => c.disabled), 'turned-off commands are kept');
    if (mode === 'server') assert.equal(r.model.server.dsrmPassword, 'Dsrm#Pass12345', 'firstboot-only fields are kept');
  }
});

test('XML two-way sync: invalid XML throws and nothing is applied; unknown parts go to the raw block', () => {
  const m = model('custom');
  const before = JSON.stringify(m);
  assert.throws(() => A.syncFromXml(m, '<unattend><settings pass="specialize"></unattend>'));
  assert.equal(JSON.stringify(m), before, 'input model untouched');
  const xml = A.buildXml(m).replace('</unattend>', '  <settings pass="specialize"><component name="Contoso-Thing"><X>1</X></component></settings>\r\n</unattend>');
  const r = A.syncFromXml(m, xml, { knownComponent: known });
  assert.deepEqual(r.unknown, ['specialize / Contoso-Thing / X']);
  assert.match(r.model.raw, /Contoso-Thing/);
});

test('quick fixes come from the rules engine and round-trip through the studio model', async (t) => {
  if (!haveShared) { t.skip('answerfile/ not present'); return; }
  const g = await import(pathToFileURL(genPath).href);
  const m = A.defaultModel();
  m.mode = 'custom'; m.custom.computerName = ''; m.custom.accounts[0].password = 'pw';
  m.all = {
    'specialize|Microsoft-Windows-Shell-Setup': { ComputerName: '12345' },
    'oobeSystem|Microsoft-Windows-UnattendedJoin': { Identification: { JoinDomain: 'lab.example.org', Credentials: { Domain: 'lab', Username: 'j', Password: 'p' } } }
  };
  let current = m;
  const issues = (mm) => g.validateModel(g.parseXml(A.buildXml(mm), rawCatalog).model, rawCatalog);
  for (const id of ['computerName.digits', 'setting.passNotAllowed']) {
    const before = issues(current);
    assert.ok(before.some((i) => i.id === id), id + ' fires');
    assert.ok(g.fixesFor(before).some((f) => f.id === id), id + ' is offered as a fix');
    const fixed = g.applyFix(g.parseXml(A.buildXml(current), rawCatalog).model, rawCatalog, id);
    const xml = g.buildXml(fixed, rawCatalog);
    assert.ok(A.isWellFormed(xml));
    current = A.syncFromXml(current, xml, { knownComponent: known }).model;
    assert.ok(!issues(current).some((i) => i.id === id), id + ' resolved in the studio model');
  }
  assert.equal(current.custom.computerName, 'PC-12345', 'the fixed name lands in the form field that owns it');
  assert.ok(current.all['specialize|Microsoft-Windows-UnattendedJoin'], 'join moved to specialize');
  assert.equal(g.applyFix({ passes: {} }, rawCatalog, 'join.credentials'), null, 'rules without a safe fix offer none');
  assert.equal(typeof A.applyFix, 'undefined', 'no private fix table in the studio');
});

test('compare reports added, removed and changed settings by path', () => {
  const a = model('custom');
  const b = JSON.parse(JSON.stringify(a));
  b.custom.timeZone = 'UTC';
  b.custom.rdp = true;
  delete b.all['specialize|Microsoft-Windows-DNS-Client'];
  const c = A.compareXml(A.buildXml(a), A.buildXml(b));
  assert.ok(c.changed.some((x) => x.path === 'specialize/Microsoft-Windows-Shell-Setup/TimeZone' && x.from === 'Eastern Standard Time' && x.to === 'UTC'));
  assert.ok(c.removed.some((x) => x.path.startsWith('specialize/Microsoft-Windows-DNS-Client/')));
  assert.equal(A.compareXml(A.buildXml(a), A.buildXml(a)).changed.length, 0);
  const pw = JSON.parse(JSON.stringify(a)); pw.custom.accounts[0].password = 'other';
  const cp = A.compareXml(A.buildXml(a), A.buildXml(pw));
  assert.ok(cp.changed.some((x) => /LocalAccount\[admin\]\/Password/.test(x.path) && x.to === '(password changed)'), 'password changes are reported without showing them');
  assert.ok(!JSON.stringify(cp).includes('other'));
});

test('simulate plays the passes in order with restarts and commands', () => {
  const m = model('guest');
  const steps = A.simulate(A.buildXml(m));
  assert.deepEqual(steps.map((s) => s.pass), A.PASS_ORDER);
  assert.equal(steps.find((s) => s.pass === 'windowsPE').reboot, true);
  assert.equal(steps.find((s) => s.pass === 'specialize').reboot, true);
  assert.equal(steps.find((s) => s.pass === 'generalize').skipped, true);
  const spec = steps.find((s) => s.pass === 'specialize');
  assert.ok(spec.applies.some((a) => a.comp === 'Microsoft-Windows-UnattendedJoin'));
  assert.ok(spec.commands.length >= 1, 'the DNS command runs in specialize');
  assert.deepEqual(steps.find((s) => s.pass === 'oobeSystem').commands.map((c) => c.text), ['On']);
});

test('every snippet produces XML the shared catalog accepts', async (t) => {
  for (const id of Object.keys(A.SNIPPETS)) assert.ok(A.isWellFormed(A.buildXml(A.applySnippet(A.defaultModel(), id))), id);
  if (!haveShared) { t.skip('answerfile/ not present'); return; }
  const g = await import(pathToFileURL(genPath).href);
  for (const id of Object.keys(A.SNIPPETS)) {
    const r = g.parseXml(A.buildXml(A.applySnippet(A.defaultModel(), id)), rawCatalog);
    assert.deepEqual(r.unknown, [], id);
    assert.deepEqual(g.validateModel(r.model, rawCatalog).filter((i) => i.level === 'error'), [], id);
  }
});
