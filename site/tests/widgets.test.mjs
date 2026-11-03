// Setting widgets: value parsing and formatting per widget, and a field card that edits a catalog
// setting (a toggle) and updates both the generated XML and the live meaning line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDom } from './mini-dom.mjs';
import * as F from '../assets/canvas/widgets/format.js';
import { zoneNow, PRODUCT_KEYS, productKeyPreset, inputLocaleOptions } from '../assets/canvas/widgets/data.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const catPath = path.join(REPO, 'answerfile', 'unattend-catalog.json');
const shared = existsSync(catPath) && existsSync(path.join(REPO, 'answerfile', 'widgets.json'));

test('ipv4: parsing, classes and masks', () => {
  assert.deepEqual(F.parseIpv4('192.168.10.20').octets, [192, 168, 10, 20]);
  for (const bad of ['256.1.1.1', '1.2.3', '01.2.3.4', '1.2.3.4.5', 'a.b.c.d', '']) assert.equal(F.parseIpv4(bad).ok, false, bad);
  assert.equal(F.classifyIpv4('10.0.0.1'), 'private');
  assert.equal(F.classifyIpv4('172.31.255.1'), 'private');
  assert.equal(F.classifyIpv4('172.32.0.1'), 'public');
  assert.equal(F.classifyIpv4('169.254.3.4'), 'link-local');
  assert.equal(F.classifyIpv4('127.0.0.1'), 'loopback');
  assert.equal(F.maskFromPrefix(24), '255.255.255.0');
  assert.equal(F.maskFromPrefix(0), '0.0.0.0');
  assert.equal(F.maskFromPrefix(32), '255.255.255.255');
  assert.equal(F.prefixFromMask('255.255.240.0'), 20);
  assert.equal(F.prefixFromMask('255.0.255.0'), -1);
});

test('ipv6: expand and compress', () => {
  assert.equal(F.normalizeIpv6('2001:0db8:0000:0000:0000:0000:0000:0010'), '2001:db8::10');
  assert.equal(F.normalizeIpv6('::1'), '::1');
  assert.equal(F.normalizeIpv6('fe80::1:0:0:5'), 'fe80::1:0:0:5');
  assert.equal(F.normalizeIpv6('::ffff:192.168.1.1'), '::ffff:c0a8:101');
  assert.equal(F.normalizeIpv6('1::2::3'), null);
  assert.equal(F.normalizeIpv6('12345::'), null);
});

test('cidr: network, mask both ways, host range', () => {
  const r = F.parseCidr('192.168.10.20/24');
  assert.equal(r.ok, true);
  assert.equal(r.mask, '255.255.255.0');
  assert.equal(r.wildcard, '0.0.0.255');
  assert.equal(r.network, '192.168.10.0');
  assert.equal(r.broadcast, '192.168.10.255');
  assert.equal(r.first, '192.168.10.1');
  assert.equal(r.last, '192.168.10.254');
  assert.equal(r.hosts, 254);
  assert.equal(F.parseCidr('10.0.0.0/8').isNetwork, true);
  assert.equal(F.parseCidr('10.1.1.1/31').hosts, 2);
  assert.equal(F.parseCidr('10.1.1.1/33').error, 'prefix4');
  assert.equal(F.parseCidr('2001:db8::20/64').family, 6);
  assert.equal(F.parseCidr('2001:db8::20/64', { allowIpv6: false }).ok, false);
  assert.equal(F.parseCidr('192.168.1.1').ok, false);
});

test('size: units, parsing and formatting', () => {
  assert.equal(F.parseSize('300', 'MB'), 300);
  assert.equal(F.parseSize('1.5 GB', 'MB'), 1536);
  assert.equal(F.parseSize('2TB', 'MB'), 2097152);
  assert.equal(F.parseSize('512 KB', 'B'), 524288);
  assert.equal(F.parseSize('10 GB', 'MB', 'MB'), 10240);
  assert.equal(F.parseSize('abc', 'MB'), null);
  assert.equal(F.formatSize(300, 'MB').text, '300 MB');
  assert.equal(F.formatSize(10240, 'MB').text, '10 GB');
  assert.equal(F.formatSize(4096, 'KB').text, '4 MB');
  assert.equal(F.formatSize(524288, 'B').text, '512 KB');
  assert.equal(F.convertSize(1, 'GB', 'MB'), 1024);
});

test('product key: paste-aware groups and generic presets', () => {
  assert.deepEqual(F.splitProductKey('w269n wfgwx-yvc9b 4j6c9 t83gx'), ['W269N', 'WFGWX', 'YVC9B', '4J6C9', 'T83GX']);
  assert.equal(F.formatProductKey('W269NWFGWXYVC9B4J6C9T83GX'), 'W269N-WFGWX-YVC9B-4J6C9-T83GX');
  assert.equal(F.formatProductKey('W269N-WF'), 'W269N-WF');
  assert.equal(F.isProductKey('W269N-WFGWX-YVC9B-4J6C9-T83GX'), true);
  assert.equal(F.isProductKey('W269N-WFGWX-YVC9B-4J6C9'), false);
  for (const p of PRODUCT_KEYS) assert.ok(F.isProductKey(p.key), p.edition);
  assert.equal(new Set(PRODUCT_KEYS.map((p) => p.key)).size, PRODUCT_KEYS.length, 'keys are unique');
  assert.equal(productKeyPreset('w269n-wfgwx-yvc9b-4j6c9-t83gx').kind, 'KMS');
  assert.equal(productKeyPreset('AAAAA-BBBBB-CCCCC-DDDDD-EEEEE'), null);
});

test('duration: parse many forms and describe in words', () => {
  assert.equal(F.parseDuration('90', 's'), 90);
  assert.equal(F.parseDuration('2m 30s', 's'), 150);
  assert.equal(F.parseDuration('1h', 'min'), 60);
  assert.equal(F.parseDuration('1:30', 's'), 90);
  assert.equal(F.parseDuration('1:00:00', 'min'), 60);
  assert.equal(F.parseDuration('5 seconds', 'ms'), 5000);
  assert.equal(F.parseDuration('soon', 's'), null);
  assert.equal(F.humanDuration(150, 's'), '2 minutes 30 seconds');
  assert.equal(F.humanDuration(60000, 'ms'), '1 minute');
  assert.equal(F.humanDuration(15, 'min'), '15 minutes');
  assert.equal(F.humanDuration(0, 's'), '0 seconds');
  assert.equal(F.minutesToClock(120), '02:00');
  assert.equal(F.clockToMinutes('23:59'), 1439);
  assert.equal(F.clockToMinutes('24:00'), null);
});

test('flags: decode and encode bitmasks', () => {
  const flags = [1, 2, 4, 8, 16];
  assert.deepEqual(F.decodeFlags(17, flags), { set: [1, 16], unknown: 0 });
  assert.deepEqual(F.decodeFlags(33, flags), { set: [1], unknown: 32 });
  assert.equal(F.encodeFlags(['1', '4', 16]), 21);
  assert.equal(F.encodeFlags([]), 0);
});

test('guid: parse, normalize and generate version 4', () => {
  assert.equal(F.parseGuid('{8C5E7FDA-E8BF-4A96-9A85-A6E23A8C635C}').value, '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c');
  assert.equal(F.parseGuid('{8C5E7FDA-E8BF-4A96-9A85-A6E23A8C635C}').braces, true);
  assert.equal(F.parseGuid('8c5e7fdae8bf4a969a85a6e23a8c635c').ok, true);
  assert.equal(F.parseGuid('8c5e7fda-e8bf-4a96-9a85').ok, false);
  for (let i = 0; i < 20; i++) {
    const g = F.newGuid();
    assert.match(g, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  }
});

test('mac, port, colours, paths, commands, lists', () => {
  assert.equal(F.parseMac('00:15:5d:01:02:03').value, '00-15-5D-01-02-03');
  assert.equal(F.parseMac('02155D010203').local, true);
  assert.equal(F.parseMac('00-15-5D-01-02').ok, false);
  assert.equal(F.parsePort('3389').name, 'Remote Desktop');
  assert.equal(F.parsePort('70000').ok, false);
  assert.deepEqual(F.parseColor('0xff0078d7', 'argb-hex'), { a: 255, r: 0, g: 120, b: 215 });
  assert.equal(F.formatColor({ a: 255, r: 0, g: 120, b: 215 }, 'abgr-hex'), '0xffd77800');
  assert.equal(F.formatColor({ r: 255, g: 0, b: 0 }, 'rgb-int'), '255');
  assert.deepEqual(F.parseColor('65280', 'rgb-int'), { r: 0, g: 255, b: 0, a: 255 });
  assert.equal(F.checkPath('C:\\Windows\\Setup'), '');
  assert.equal(F.checkPath('%WINDIR%\\Temp'), '');
  assert.equal(F.checkPath('C:Windows'), 'pathDrive');
  assert.equal(F.checkPath('C:\\bad|name'), 'pathChars');
  assert.equal(F.expandVars('%SystemDrive%\\Logs'), 'C:\\Logs');
  const toks = F.tokenizeCommand('powershell -File "C:\\My Scripts\\a.ps1" -Name x');
  assert.deepEqual(toks.map((x) => x.text), ['powershell', '-File', 'C:\\My Scripts\\a.ps1', '-Name', 'x']);
  assert.equal(F.tokenizeCommand('cmd /c "echo').pop().unclosed, true);
  assert.equal(F.quoteArg('C:\\My Scripts\\a.ps1'), '"C:\\My Scripts\\a.ps1"');
  assert.equal(F.quoteArg('plain'), 'plain');
  assert.deepEqual(F.commandTokens('reg add HKLM\\X /v Y').map((x) => x.kind), ['exe', 'arg', 'path', 'flag', 'arg']);
  assert.deepEqual(F.splitList('a; b;;c', ';'), ['a', 'b', 'c']);
  assert.equal(F.joinList(['a', ' b ', ''], '|'), 'a|b');
  assert.deepEqual(F.splitRows('0:10:5,10:100:50', ',', ':'), [['0', '10', '5'], ['10', '100', '50']]);
  assert.equal(F.checkFormat('computername', '12345'), 'cnDigits');
  assert.equal(F.checkFormat('computername', 'LAB-PC-01'), '');
  assert.equal(F.checkFormat('computername', '*'), '');
  assert.equal(F.checkFormat('fqdn', 'corp.example.com'), '');
  assert.equal(F.checkFormat('fqdn', 'bad_name.com'), 'fqdn');
  assert.equal(F.checkRegistryPath('HKLM\\SOFTWARE\\Contoso'), '');
  assert.equal(F.checkRegistryPath('SOFTWARE\\Contoso'), 'regHive');
  assert.equal(F.checkUrl('https://support.example.com'), '');
  assert.equal(F.checkUrl('support.example.com'), 'url');
  assert.equal(F.checkEmail('fax@example.com'), '');
  const bmp = new ArrayBuffer(30); const v = new DataView(bmp);
  v.setUint8(0, 0x42); v.setUint8(1, 0x4d); v.setUint32(14, 40, true); v.setInt32(18, 120, true); v.setInt32(22, -120, true); v.setUint16(28, 24, true);
  assert.deepEqual(F.bmpSize(bmp), { width: 120, height: 120, bits: 24 });
});

test('time zones show the live offset and local time; locales have names and keyboard ids', () => {
  const z = zoneNow('China Standard Time', new Date('2026-01-15T00:00:00Z'));
  assert.equal(z.offset, '+08:00');
  assert.equal(z.time, '08:00');
  const ny = zoneNow('Eastern Standard Time', new Date('2026-07-01T12:00:00Z'));
  assert.equal(ny.offset, '-04:00', 'daylight saving time is applied');
  assert.equal(ny.dst, true);
  const il = inputLocaleOptions('en');
  const hk = il.find((o) => o.value === '0c04:00000409');
  assert.ok(hk && /Hong Kong/.test(hk.label + hk.keywords), 'zh-HK input locale is named');
});

test('studio: a toggle edit updates the XML and the live meaning text', { skip: shared ? false : 'answerfile/ not present' }, async () => {
  const dom = installDom();
  try {
    const W = await import('../../answerfile/widgets.mjs');
    const raw = JSON.parse(readFileSync(catPath, 'utf8'));
    const json = JSON.parse(readFileSync(path.join(REPO, 'answerfile', 'widgets.json'), 'utf8'));
    const gen = await import('../../answerfile/generate.mjs');
    const D = await import('../assets/canvas/direct.js');
    const widgets = await import('../assets/canvas/widgets/index.js');
    const C = await import('../assets/canvas/catalog.js');
    widgets.registerHints(W.allHints(W.compileWidgets(json), raw));
    const cat = C.normalizeCatalog(raw, 'full');
    const comp = cat.byName.get('Microsoft-Windows-TerminalServices-LocalSessionManager');
    let direct = D.addComponent(D.blankDirect(), 'specialize', comp.name);
    const key = 'specialize|' + comp.name;
    const msgs = [];
    const t = (k, args, fb) => String(fb || k).replace(/\{(\d+)\}/g, (m, i) => (args ? args[i] : m));
    const root = C.renderSettings(comp, direct.all[key], (v, msg) => { direct.all[key] = v || {}; msgs.push(msg); }, { t, pass: 'specialize', idPrefix: 'tst' });
    dom.document.body.appendChild(root);
    const card = root.querySelector('[data-setting-path="Microsoft-Windows-TerminalServices-LocalSessionManager/fDenyTSConnections"] .wf');
    assert.ok(card, 'field card rendered');
    const sw = card.querySelector('[role="switch"]');
    const meaning = card.querySelector('.wf-meaning');
    assert.match(meaning.textContent, /Not set/);
    assert.equal(sw.getAttribute('aria-checked'), 'true', 'unset shows the default (true: connections denied)');
    assert.ok(card.querySelector('.wf-dot').hidden, 'no Changed dot before an edit');
    sw.click();
    assert.equal(direct.all[key].fDenyTSConnections, 'false');
    assert.equal(meaning.textContent, 'Remote Desktop connections are allowed.');
    assert.equal(sw.getAttribute('aria-checked'), 'false');
    assert.ok(!card.querySelector('.wf-dot').hidden, 'Changed dot after the edit');
    assert.match(card.querySelector('.wf-risk').textContent, /caution/);
    assert.match(D.buildDirectXml(direct, raw, gen), /<fDenyTSConnections>false<\/fDenyTSConnections>/);
    assert.equal(msgs.at(-1).key, 'hist.set');
    sw.click();
    assert.equal(meaning.textContent, 'Remote Desktop connections are blocked.');
    assert.match(D.buildDirectXml(direct, raw, gen), /<fDenyTSConnections>true<\/fDenyTSConnections>/);
    card.querySelector('.wf-unset').click();
    assert.equal(direct.all[key].fDenyTSConnections, undefined, 'Unset removes the element');
    assert.ok(!/fDenyTSConnections/.test(D.buildDirectXml(direct, raw, gen)));
    assert.equal(msgs.at(-1).key, 'hist.unset');
    // the More panel has the full description, the risk and the documentation link
    const more = card.querySelector('.wf-more-b');
    more.click();
    assert.equal(more.getAttribute('aria-expanded'), 'true');
    assert.match(card.querySelector('.wf-desc').textContent, /inverted/);
    assert.match(card.querySelector('.wf-doc').getAttribute('href'), /learn\.microsoft\.com/);
    // the switch is described by the meaning line and the description
    assert.ok(sw.getAttribute('aria-describedby').includes(meaning.id));
    // search text includes descriptions and value meanings
    assert.match(C.searchText(comp), /Remote Desktop connections are allowed/);
  } finally { dom.restore(); }
});

test('studio: password edits never put the secret in a history message', { skip: shared ? false : 'answerfile/ not present' }, async () => {
  const dom = installDom();
  try {
    const W = await import('../../answerfile/widgets.mjs');
    const raw = JSON.parse(readFileSync(catPath, 'utf8'));
    const json = JSON.parse(readFileSync(path.join(REPO, 'answerfile', 'widgets.json'), 'utf8'));
    const widgets = await import('../assets/canvas/widgets/index.js');
    const C = await import('../assets/canvas/catalog.js');
    widgets.registerHints(W.allHints(W.compileWidgets(json), raw));
    const cat = C.normalizeCatalog(raw, 'full');
    const comp = cat.byName.get('Microsoft-Windows-UnattendedJoin');
    let v = {};
    const msgs = [];
    const t = (k, args, fb) => String(fb || k);
    const root = C.renderSettings(comp, v, (nv, msg) => { v = nv; msgs.push(msg); }, { t, pass: 'specialize', idPrefix: 'pw', expandPath: 'Identification/Credentials/Password' });
    dom.document.body.appendChild(root);
    assert.ok(root.querySelector('details.cat-group[open]'), 'expandPath opens the container that holds the setting');
    const inp = root.querySelector('[data-setting-path="Microsoft-Windows-UnattendedJoin/Identification/Credentials/Password"] input');
    assert.ok(inp, 'password input rendered');
    assert.equal(inp.getAttribute('type'), 'password');
    inp.value = 'S3cret!Join';
    inp.dispatchEvent(new dom.window.Event('input'));
    assert.equal(v.Identification.Credentials.Password, 'S3cret!Join');
    assert.equal(msgs.at(-1).key, 'hist.setSecret');
    assert.ok(!JSON.stringify(msgs).includes('S3cret'), 'secret not in history messages');
  } finally { dom.restore(); }
});
