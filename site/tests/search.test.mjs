// Builder search and canvas helper tests: node --test site/tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { normalizeCatalog, CORE_CATALOG, countSet, orderLike } from '../assets/canvas/catalog.js';
import { buildIndex, search, compileQuery, problemKeys, filterList } from '../assets/canvas/search.js';
import { moveInAll, canMove } from '../assets/canvas/flow.js';
import { layoutMath, validateLayout, PRESETS } from '../assets/canvas/disk.js';
import { moveCommand } from '../assets/canvas/commands.js';
import { applyMapEdit, mapWarnings, cidrFrom, inCidr } from '../assets/canvas/deploy.js';

const require = createRequire(import.meta.url);
const A = require('../assets/answer.js');
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fullPath = path.join(REPO, 'answerfile', 'unattend-catalog.json');
const catalog = existsSync(fullPath) ? normalizeCatalog(JSON.parse(readFileSync(fullPath, 'utf8')), 'full') : normalizeCatalog(CORE_CATALOG, 'core');

test('global search finds a catalog-only setting', () => {
  const model = A.defaultModel();
  const idx = buildIndex({ model, catalog, friendly: [], problems: new Set() });
  const r = search(idx, 'SkipAutoActivation');
  assert.equal(r.ok, true);
  const hit = r.results.find((x) => x.entry.kind === 'catalog' && x.entry.label === 'SkipAutoActivation');
  assert.ok(hit, 'catalog setting found');
  assert.equal(hit.entry.comp, 'Microsoft-Windows-Security-SPP-UX');
  assert.ok(r.sections.size >= 1);
  // nested paths and help text are searchable too
  assert.ok(search(idx, 'HideEULAPage').results.some((x) => x.entry.path === 'OOBE/HideEULAPage'));
  assert.ok(search(idx, 'join domain', {}).total > 0);
});

test('global search covers friendly fields, values and the Only set filter', () => {
  const model = A.defaultModel();
  model.all = { 'specialize|Microsoft-Windows-Shell-Setup': { RegisteredOwner: 'Facilities team' } };
  const friendly = [{ id: 'computerName', mode: 'server', section: 'identity', sectionLabel: 'TempDesk server / Computer identity', label: 'Computer name', help: '', value: 'TD-DC01', isSet: false, problem: false },
    { id: 'adminPassword', mode: 'server', section: 'accounts', sectionLabel: 'x', label: 'Administrator password', value: 'secret-value', sensitive: true, isSet: true, problem: true }];
  const idx = buildIndex({ model, catalog, friendly, problems: new Set() });
  assert.equal(search(idx, 'TD-DC01').results[0].entry.id, 'computerName', 'values are searchable');
  assert.equal(search(idx, 'secret-value').total, 0, 'passwords are never indexed');
  const set = search(idx, 'Facilities', { filter: 'set' });
  assert.equal(set.total, 1);
  assert.equal(set.results[0].entry.path, 'RegisteredOwner');
  assert.equal(search(idx, 'Computer name', { filter: 'set' }).total, 0);
  assert.ok(search(idx, '', { filter: 'set' }).total >= 2, 'an empty query lists everything that is set');
});

test('regex search: valid patterns match, an invalid pattern reports a message', () => {
  const idx = buildIndex({ model: A.defaultModel(), catalog, friendly: [], problems: new Set() });
  const ok = search(idx, '^Microsoft-Windows-Shell-Setup .*TimeZone', { regex: true });
  assert.equal(ok.ok, true);
  assert.ok(ok.total >= 1);
  const bad = search(idx, 'Time(Zone', { regex: true });
  assert.equal(bad.ok, false);
  assert.ok(bad.error && bad.error.length > 0, 'error message present');
  assert.equal(bad.results.length, 0);
  assert.equal(compileQuery('[a-', true).ok, false);
  assert.equal(compileQuery('[a-', false).ok, true, 'plain text never fails');
});

test('Only with problems filter uses the rules engine issue locations', () => {
  const model = A.defaultModel();
  model.all = { 'specialize|Microsoft-Windows-Shell-Setup': { ComputerName: '12345' } };
  const issues = [{ id: 'computerName.digits', level: 'error', where: 'specialize/Microsoft-Windows-Shell-Setup/ComputerName', message: 'only digits' },
    { id: 'list.keyDuplicate', level: 'error', where: 'oobeSystem/Microsoft-Windows-Shell-Setup/UserAccounts/LocalAccounts/LocalAccount[1]/Name', message: 'dup' }];
  const problems = problemKeys(issues);
  assert.ok(problems.has('specialize|Microsoft-Windows-Shell-Setup|ComputerName'));
  assert.ok(problems.has('oobeSystem|Microsoft-Windows-Shell-Setup|UserAccounts/LocalAccounts/LocalAccount/Name'));
  const friendly = [{ id: 'domainName', mode: 'server', section: 'domain', sectionLabel: 'd', label: 'Domain DNS name', value: 'bad', isSet: true, problem: true },
    { id: 'gateway', mode: 'server', section: 'network', sectionLabel: 'n', label: 'Default gateway', value: '10.0.0.1', isSet: true, problem: false }];
  const idx = buildIndex({ model, catalog, friendly, problems });
  const r = search(idx, '', { filter: 'problems' });
  const ids = r.results.map((x) => x.entry.id);
  assert.ok(ids.includes('domainName'));
  assert.ok(ids.includes('Microsoft-Windows-Shell-Setup/ComputerName'));
  assert.ok(!ids.includes('gateway'));
  assert.equal(search(idx, 'gateway', { filter: 'problems' }).total, 0);
});

test('real rules engine marks a problem that the Only with problems filter finds', async (t) => {
  const gen = path.join(REPO, 'answerfile', 'generate.mjs');
  if (!existsSync(gen) || catalog.origin !== 'full') { t.skip('answerfile/ not present'); return; }
  const g = await import(gen);
  const raw = JSON.parse(readFileSync(fullPath, 'utf8'));
  const m = A.defaultModel();
  m.mode = 'custom'; m.custom.computerName = '';
  m.all = { 'specialize|Microsoft-Windows-Shell-Setup': { ComputerName: '1234' } };
  const issues = g.validateModel(g.parseXml(A.buildXml(m), raw).model, raw);
  const r = search(buildIndex({ model: m, catalog, friendly: [], problems: problemKeys(issues) }), 'ComputerName', { filter: 'problems' });
  assert.ok(r.results.some((x) => x.entry.comp === 'Microsoft-Windows-Shell-Setup' && x.entry.path === 'ComputerName'));
});

test('list filter used by list editors, history and presets', () => {
  const items = ['Lab server', 'Guest PCs room 2', 'Kiosk'];
  assert.deepEqual(filterList(items, 'room', (x) => x).items.map((x) => x.i), [1]);
  assert.deepEqual(filterList(items, '^(Lab|Kiosk)', (x) => x, true).items.map((x) => x.it), ['Lab server', 'Kiosk']);
  assert.equal(filterList(items, '(', (x) => x, true).ok, false);
  assert.equal(filterList(items, '', (x) => x).items.length, 3);
});

test('catalog normalizer reads the shared catalog shape', () => {
  const sh = catalog.byName.get('Microsoft-Windows-Shell-Setup');
  assert.ok(sh);
  const ua = sh.settings.find((s) => s.name === 'UserAccounts');
  assert.equal(ua.children.find((s) => s.name === 'AdministratorPassword').type, 'password');
  const la = ua.children.find((s) => s.name === 'LocalAccounts').children.find((s) => s.name === 'LocalAccount');
  assert.equal(la.type, 'list');
  assert.ok(la.children.some((s) => s.name === 'Name'));
  assert.equal(countSet({ a: '1', b: { c: '', d: [{ e: 'x' }] } }), 2);
  assert.deepEqual(Object.keys(orderLike(sh.settings, { TimeZone: 'UTC', ComputerName: 'A' })), sh.settings.map((s) => s.name).filter((n) => ['TimeZone', 'ComputerName'].includes(n)));
});

test('setup flow: moves respect the passes the catalog allows', () => {
  assert.equal(canMove(catalog, 'Microsoft-Windows-UnattendedJoin', null, 'oobeSystem').ok, false);
  assert.equal(canMove(catalog, 'Microsoft-Windows-Shell-Setup', null, 'oobeSystem').ok, true);
  const all = { 'specialize|Microsoft-Windows-Shell-Setup': { TimeZone: 'UTC', ComputerName: 'A' } };
  const moved = moveInAll(all, 'specialize|Microsoft-Windows-Shell-Setup', 'oobeSystem', 'TimeZone');
  assert.deepEqual(moved, { 'specialize|Microsoft-Windows-Shell-Setup': { ComputerName: 'A' }, 'oobeSystem|Microsoft-Windows-Shell-Setup': { TimeZone: 'UTC' } });
  assert.deepEqual(all['specialize|Microsoft-Windows-Shell-Setup'].TimeZone, 'UTC', 'input not mutated');
});

test('disk canvas math and checks', () => {
  const l = PRESETS.uefi();
  const m = layoutMath(l.disks[0]);
  assert.equal(m.sizes[2], 128000 - 316);
  assert.equal(m.free, 0);
  assert.deepEqual(validateLayout(l), []);
  l.disks[0].partitions.push({ type: 'EFI', sizeMB: '100' });
  const codes = validateLayout(l).map((e) => e.code);
  assert.ok(codes.includes('disk.errTwoEfi'));
  assert.ok(codes.includes('disk.errExtendLast'));
  l.target.partitionId = '1';
  assert.ok(validateLayout(l).some((e) => e.code === 'disk.errTargetType'));
});

test('command timeline moves drop fields the target list does not allow', () => {
  const c = { runSync: [{ command: 'a', willReboot: 'Always', credentials: { username: 'u' } }], firstLogon: [] };
  const r = moveCommand(c, 'runSync', 0, 'firstLogon', 0);
  assert.deepEqual(r.firstLogon, [{ command: 'a' }]);
  assert.equal(c.runSync.length, 1, 'input not mutated');
});

test('deployment map writes back server, firstboot and guest join fields', () => {
  const m = A.defaultModel();
  const m2 = applyMapEdit(m, 'dc.ip', '10.20.0.5');
  assert.equal(m2.server.ipAddress, '10.20.0.5');
  assert.equal(m2.guest.dnsServer, '10.20.0.5', 'guest DNS follows the DC');
  assert.equal(m2.deploy.network.cidr, '10.20.0.0/24');
  assert.equal(JSON.parse(A.buildFirstboot(m2.server)).ipAddress, '10.20.0.5');
  const m3 = applyMapEdit(m2, 'dc.domain', 'school.example.net');
  assert.equal(m3.server.netbiosName, 'SCHOOL');
  assert.equal(m3.guest.domainName, 'school.example.net');
  assert.ok(mapWarnings(m3).includes('map.warnGateway'));
  assert.equal(cidrFrom('192.168.1.77', 24), '192.168.1.0/24');
  assert.equal(inCidr('192.168.1.200', '192.168.1.0/24'), true);
  assert.equal(inCidr('192.168.2.1', '192.168.1.0/24'), false);
});
