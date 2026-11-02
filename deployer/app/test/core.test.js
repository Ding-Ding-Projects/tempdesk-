'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const Core = require('../src/shared/core.js');
const QR = require('../src/shared/qr.js');
const { createLineParser, redactText, EngineRun } = require('../src/main/engine.js');
const school = require('../src/main/school.js');
const { makeZip, readZip } = require('../src/main/zipfile.js');
const { validateSettings, Store } = require('../src/main/store.js');
const { parseCheck } = require('../src/main/updater.js');

const I18N = path.resolve(__dirname, '..', '..', 'i18n');

test('i18n catalogs have identical keys and no empty English strings', () => {
  const en = JSON.parse(fs.readFileSync(path.join(I18N, 'en.json'), 'utf8'));
  const zh = JSON.parse(fs.readFileSync(path.join(I18N, 'zh-HK.json'), 'utf8'));
  const d = Core.catalogKeyDiff(en, zh);
  assert.deepStrictEqual(d, { missingInB: [], missingInA: [] });
  for (const [k, v] of Object.entries(en)) {
    const vals = typeof v === 'string' ? [v] : Object.values(v);
    vals.forEach((x) => assert.ok(x.length > 0, 'empty English string for ' + k));
  }
  // Catalog prose follows the house style: no em dashes.
  assert.ok(!JSON.stringify(en).includes('\u2014'), 'English catalog contains an em dash');
});

test('every t() key used by the renderer exists in the catalog', () => {
  const en = JSON.parse(fs.readFileSync(path.join(I18N, 'en.json'), 'utf8'));
  const dir = path.resolve(__dirname, '..', 'src', 'renderer', 'js');
  const missing = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/\bt\('([A-Za-z0-9_.-]+)'/g)) if (!m[1].endsWith('.') && !(m[1] in en)) missing.push(f + ': ' + m[1]);
  }
  assert.deepStrictEqual(missing, []);
});

test('translator: language modes, funny levels, serious keys and personal wording', () => {
  const catalogs = { en: { 'a.hello': { 0: 'Hello {0}', 2: 'Hiya {0}' }, 'err.bad': { 0: 'Bad computer', 3: 'Oops' }, 'b.c': 'The computer' }, 'zh-HK': { 'a.hello': { 0: '你好 {0}' }, 'err.bad': '錯誤', 'b.c': '電腦' } };
  let t = Core.makeTranslator({ catalogs, mode: 'en', funny: 3 });
  assert.strictEqual(t('a.hello', ['Sam']), 'Hiya Sam');
  assert.strictEqual(t('err.bad'), 'Bad computer', 'errors stay serious whatever the funny level');
  t = Core.makeTranslator({ catalogs, mode: 'zh-HK', funny: 0 });
  assert.strictEqual(t('a.hello', ['Sam']), '你好 Sam');
  t = Core.makeTranslator({ catalogs, mode: 'bilingual', funny: 0 });
  assert.strictEqual(t('b.c'), 'The computer / 電腦');
  // Wording changes the template only, never the data passed in as arguments.
  const W = require('../src/vendor/wording.js');
  const wording = W.buildTranslator(W.validate('{"schemaVersion":1,"entries":{"computer":"machine"}}'));
  t = Core.makeTranslator({ catalogs, mode: 'en', funny: 0, wording });
  assert.strictEqual(t('b.c'), 'The machine');
  assert.strictEqual(t('a.hello', ['computer-01']), 'Hello computer-01');
  assert.strictEqual(t.raw('b.c'), 'The computer');
  assert.strictEqual(t('missing.key'), 'missing.key');
});

test('regex search builder: plain, regex, invalid, counts', () => {
  const plain = Core.buildMatcher('a.b');
  assert.ok(Core.testMatch('xa.by', plain));
  assert.ok(!Core.testMatch('axb', plain));
  const rx = Core.buildMatcher('a.b', { regex: true });
  assert.ok(Core.testMatch('axb', rx));
  const bad = Core.buildMatcher('(', { regex: true });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error, 'invalid');
  assert.deepStrictEqual(Core.countMatches(['aa', 'b', 'a'], Core.buildMatcher('a')), { items: 2, matches: 3 });
  assert.strictEqual(Core.buildMatcher('x*', { regex: true }).matchesEmpty, true);
  assert.deepStrictEqual(Core.countMatches(['abc'], Core.buildMatcher('x*', { regex: true })).items, 1);
});

test('palette ranking prefers prefix and word-start matches', () => {
  const items = [{ title: 'Delete deployment' }, { title: 'Deploy' }, { title: 'Settings: dark theme' }];
  assert.strictEqual(Core.rankItems('dep', items)[0].title, 'Deploy');
  assert.deepStrictEqual(Core.rankItems('dkth', items).map((x) => x.title), ['Settings: dark theme']);
  assert.strictEqual(Core.rankItems('zzz', items).length, 0);
});

test('colour helpers and contrast', () => {
  assert.strictEqual(Core.toHex(Core.parseHex('#7cf3e6')), '#7CF3E6');
  assert.ok(Core.contrast('#000000', '#FFFFFF') > 20.9);
  assert.ok(Core.contrast('#7CF3E6', '#0B1110') > 4.5);
  assert.strictEqual(Core.onColor('#7CF3E6'), '#04201D');
  const hsv = Core.rgbToHsv(Core.parseHex('#FF0000'));
  assert.strictEqual(Math.round(hsv.h), 0);
  assert.strictEqual(Core.toHex(Core.hsvToRgb(120, 1, 1)), '#00FF00');
});

test('exports: CSV escaping and formula guard, HTML escaping, secrets stripped', () => {
  const csv = Core.toCsv([{ a: 'x,y', b: '=SUM(A1)', c: 'q"z' }]);
  assert.strictEqual(csv, 'a,b,c\r\n"x,y",\'=SUM(A1),"q""z"\r\n');
  const html = Core.toHtml('<t>', [{ k: '<script>' }]);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  const s = Core.stripSecrets({ name: 'x', server: { adminPassword: 'p', ipAddress: '1.2.3.4' }, agent: { guestKey: 'g' }, list: [{ password: 'q' }] });
  assert.deepStrictEqual(s, { name: 'x', server: { adminPassword: '', ipAddress: '1.2.3.4' }, agent: { guestKey: '' }, list: [{ password: '' }] });
});

test('deployment and backup validation', () => {
  assert.deepStrictEqual(Core.validateDeployment({ name: 'lab', kind: 'server', server: { ipAddress: '10.0.0.5' } }), {});
  assert.ok(Core.validateDeployment({ name: '../x', kind: 'server', server: { ipAddress: '10.0.0.5' } }).name);
  assert.ok(Core.validateDeployment({ name: 'l', kind: 'lite', ssh: { user: 'Root User', host: 'h' }, lite: { dcIp: '1.1.1.1' } })['ssh.user']);
  assert.deepStrictEqual(Core.validateBackup({ schema: 'tempdesk-backup', version: 1, files: ['settings.json'] }, ['manifest.json', 'settings.json']), { ok: true });
  assert.strictEqual(Core.validateBackup({ schema: 'tempdesk-backup', version: 1, files: ['../evil.json'] }, ['../evil.json']).error, 'backup.path');
  assert.strictEqual(Core.validateBackup({ schema: 'tempdesk-backup', version: 1, files: ['tabs.json'] }, []).error, 'backup.missing');
});

test('markdown and changelog parsing', () => {
  const b = Core.parseMarkdown('# Title\n\nSome **bold** and `code` [link](https://x.y/).\n\n- one\n- two\n\n```\nraw <b>\n```\n| a | b |\n| - | - |\n| 1 | 2 |');
  assert.deepStrictEqual(b.map((x) => x.type), ['h', 'p', 'ul', 'pre', 'table']);
  assert.deepStrictEqual(b[1].inline.map((x) => x.t), ['text', 'bold', 'text', 'code', 'text', 'link', 'text']);
  assert.strictEqual(b[3].text, 'raw <b>');
  const c = Core.parseChangelog('# Changelog\n\n## [1.1.0] - 2026-11-02\n- new\n\n## 1.0.0\n- first\n');
  assert.deepStrictEqual(c.map((r) => r.version), ['1.1.0', '1.0.0']);
  assert.strictEqual(c[0].date, '2026-11-02');
});

test('QR codes match a reference implementation bit for bit', () => {
  const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'qr-vectors.json'), 'utf8')).vectors;
  let n = 0;
  for (const [key, rows] of Object.entries(ref)) {
    const at = key.lastIndexOf('|');
    const q = QR.generate(key.slice(0, at), Number(key.slice(at + 1)));
    assert.deepStrictEqual(q.modules.map((r) => r.map((c) => (c ? '1' : '0')).join('')), rows, key);
    n++;
  }
  assert.ok(n >= 10);
  assert.match(QR.toSvg(QR.generate('http://192.168.10.10:8080/')), /^<svg /);
  assert.throws(() => QR.generate('x'.repeat(400)));
});

test('engine protocol: line parser handles split chunks, junk and bad ids', () => {
  const evs = [];
  const p = createLineParser((e) => evs.push(e));
  p.push('{"type":"step","id":"forest","sta');
  p.push('te":"running"}\r\nplain text line\n{"type":"step","id":"bad id!","state":"done"}\n{"type":"log","level":"info","text":"x"}');
  p.end();
  assert.deepStrictEqual(evs, [{ type: 'step', id: 'forest', state: 'running' }, { type: 'log', level: 'info', text: 'plain text line' }, { type: 'log', level: 'info', text: 'x' }]);
  assert.strictEqual(redactText('pw is Sup3r! ok', ['Sup3r!']), 'pw is [redacted] ok');
});

test('engine run: secrets go to the child environment only, never the command line or config', async (t) => {
  // A fake "powershell" (node) prints its argv, the config file and the secret env var names.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-eng-'));
  const fake = path.join(dir, 'fake.js');
  fs.writeFileSync(fake, [
    "const fs = require('fs'); const a = process.argv; const cfg = a[a.indexOf('-Config') + 1];",
    "console.log(JSON.stringify({ type: 'log', level: 'info', text: 'argv ' + a.slice(2).join(' ') }));",
    "console.log(JSON.stringify({ type: 'log', level: 'info', text: 'config ' + fs.readFileSync(cfg, 'utf8') }));",
    "console.log(JSON.stringify({ type: 'log', level: 'info', text: 'env ' + Object.keys(process.env).filter((k) => k.startsWith('TEMPDESK_SECRET_')).join(',') }));",
    "console.log(JSON.stringify({ type: 'log', level: 'info', text: 'leak ' + process.env.TEMPDESK_SECRET_ADMINPASSWORD }));",
    "console.log(JSON.stringify({ type: 'step', id: 'x', state: 'done' }));",
    "console.log(JSON.stringify({ type: 'result', ok: true, data: {} }));"
  ].join('\n'));
  // A stand-in for powershell.exe: a shell script that runs node on the -File script with the
  // remaining arguments, exactly as PowerShell would receive them.
  if (process.platform === 'win32') return t.skip('uses a POSIX shell stand-in for PowerShell');
  const shim = path.join(dir, 'fake-powershell');
  fs.writeFileSync(shim, '#!/bin/sh\nwhile [ "$1" != "-File" ]; do shift; done\nshift\nexec "' + process.execPath + '" "$@"\n', { mode: 0o755 });
  const run = new EngineRun({ phase: 'Media', script: fake, config: { name: 'lab', server: { ipAddress: '10.0.0.1' } }, secrets: { ADMINPASSWORD: 'Very-Secret-123' }, powershell: shim });
  const events = [];
  run.on((e) => events.push(e));
  run.start();
  const r = await run.done;
  assert.strictEqual(r.ok, true, JSON.stringify(events));
  const text = events.filter((e) => e.type === 'log').map((e) => e.text).join('\n');
  assert.ok(!/Very-Secret-123/.test(text.replace('leak [redacted]', '')), 'secret must not appear anywhere');
  assert.match(text, /leak \[redacted\]/);
  assert.match(text, /env TEMPDESK_SECRET_ADMINPASSWORD/);
  assert.match(text, /-Phase Media/);
  assert.ok(!/Very-Secret/.test(text.split('\n').find((l) => l.startsWith('argv'))));
  assert.ok(!/Very-Secret/.test(text.split('\n').find((l) => l.startsWith('config'))));
  assert.ok(events.some((e) => e.type === 'exit' && e.ok));
});

test('school mode PIN: salted PBKDF2, verify, wrong PIN, lock and unlock', () => {
  const a = school.hashPin('1234'), b = school.hashPin('1234');
  assert.notStrictEqual(a.salt, b.salt);
  assert.notStrictEqual(a.hash, b.hash);
  assert.strictEqual(a.algorithm, 'PBKDF2-SHA256');
  assert.ok(school.verifyPin('1234', a));
  assert.ok(!school.verifyPin('1235', a));
  assert.ok(!school.verifyPin('abc', a));
  assert.throws(() => school.hashPin('12'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-school-'));
  assert.deepStrictEqual(school.enable(dir, '987654', 'Classroom'), { enabled: true, name: 'Classroom' });
  const raw = fs.readFileSync(path.join(dir, 'shared', 'school.json'), 'utf8');
  assert.ok(!raw.includes('987654'), 'the PIN itself is never stored');
  assert.deepStrictEqual(school.disable(dir, '000000'), { ok: false });
  assert.deepStrictEqual(school.disable(dir, '987654'), { ok: true });
  assert.strictEqual(school.load(dir).enabled, false);
});

test('zip writer and strict reader round-trip and reject unsafe archives', () => {
  const big = Buffer.alloc(100000, 65);
  const z = makeZip([{ name: 'a/b.json', data: '{"x":1}' }, { name: 'big.txt', data: big }, { name: '中文.txt', data: '好' }]);
  const r = readZip(z);
  assert.strictEqual(r.get('a/b.json').toString(), '{"x":1}');
  assert.ok(r.get('big.txt').equals(big));
  assert.strictEqual(r.get('中文.txt').toString(), '好');
  assert.throws(() => readZip(makeZip([{ name: '../evil.txt', data: 'x' }])), /Unsafe path/);
  assert.throws(() => readZip(makeZip([{ name: 'C:/evil.txt', data: 'x' }])), /Unsafe path/);
  assert.throws(() => readZip(Buffer.from('not a zip')), /Not a zip/);
  const one = makeZip([{ name: 'a.txt', data: 'hello world' }]);
  const dmg = Buffer.from(one); dmg[30 + 5 + 2] ^= 0xff; // a byte of the stored file data
  assert.throws(() => readZip(dmg));
  assert.throws(() => readZip(makeZip([{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }])), /Duplicate/);
  assert.throws(() => readZip(makeZip([{ name: 'x', data: Buffer.alloc(2000, 1) }]), { maxTotal: 1000 }), /too large/);
  void zlib;
});

test('settings validation rejects unknown keys and bad values; store never saves secrets', () => {
  assert.strictEqual(validateSettings({ theme: 'dark', textScale: 160 }).ok, true);
  assert.strictEqual(validateSettings({ textScale: 200 }).error, 'settings.value');
  assert.strictEqual(validateSettings({ evil: 1 }).error, 'settings.unknown');
  assert.strictEqual(validateSettings({ accent: 'red' }).error, 'settings.value');
  assert.strictEqual(validateSettings({ gitRemote: 'https://user:pass@github.com/x.git' }).error, 'settings.value');
  assert.strictEqual(validateSettings({ appName: '<b>' }).error, 'settings.value');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-store-'));
  const st = new Store(dir);
  st.saveDeployment({ name: 'lab', kind: 'server', server: { ipAddress: '10.0.0.5', adminPassword: 'Leak-Me-123' } });
  assert.ok(!fs.readFileSync(path.join(dir, 'deployments', 'lab.json'), 'utf8').includes('Leak-Me-123'));
  assert.throws(() => st.saveDeployment({ name: '../x', kind: 'server', server: { ipAddress: '10.0.0.5' } }));
  st.saveTabs({ open: ['lab', '../bad', 'x'], active: 'x' });
  assert.deepStrictEqual(st.tabs(), { open: ['lab', 'x'], active: 'x' });
});

test('updater parses Update.exe --checkForUpdate output', () => {
  const out = '0\n33\n66\n{"currentVersion":"1.0.5","futureVersion":"1.0.7","releasesToApply":[{"version":"1.0.6"},{"version":"1.0.7"}]}\n';
  assert.deepStrictEqual(parseCheck(out), { current: '1.0.5', future: '1.0.7', releases: ['1.0.6', '1.0.7'] });
  assert.strictEqual(parseCheck('garbage'), null);
});
