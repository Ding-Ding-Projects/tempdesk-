// Widget hints (answerfile/widgets.json): every leaf setting gets a widget, a 2 to 4 sentence
// description and a meaning for every enum and boolean value.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileWidgets, resolveHint, allHints, leafSettings, validateWidgets, sentenceCount, cleanHelp, boolMeaning, WIDGET_KINDS } from '../widgets.mjs';

const here = new URL('..', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('unattend-catalog.json', here), 'utf8'));
const json = JSON.parse(readFileSync(new URL('widgets.json', here), 'utf8'));
const W = compileWidgets(json);
const hints = allHints(W, catalog);
const leaves = leafSettings(catalog);

test('widgets.json validates against the catalog with no problems', () => {
  assert.deepEqual(validateWidgets(json, catalog).slice(0, 20), []);
});

test('every one of the 1,029 leaf settings has a known widget and a description', () => {
  assert.equal(leaves.length, 1029);
  assert.equal(hints.size, 1029);
  for (const { comp, setting } of leaves) {
    const h = hints.get(comp + '|' + setting.path);
    assert.ok(WIDGET_KINDS.includes(h.widget), comp + '|' + setting.path + ' widget ' + h.widget);
    const n = sentenceCount(h.description);
    assert.ok(n >= 2 && n <= 4, `${comp}|${setting.path}: ${n} sentences: ${h.description}`);
    assert.ok(!/\.\.\.|—/.test(h.description), comp + '|' + setting.path + ' has an ellipsis or em dash');
  }
});

test('every enum and boolean value has a meaning (valueHelp)', () => {
  let n = 0;
  for (const { comp, setting } of leaves) {
    if (setting.type !== 'enum' && setting.type !== 'boolean') continue;
    const h = hints.get(comp + '|' + setting.path);
    const vals = setting.type === 'boolean' ? ['true', 'false'] : setting.values.map((v) => v.value);
    for (const v of vals) { assert.ok(h.valueHelp[v], `${comp}|${setting.path} = ${v} has no valueHelp`); n++; }
  }
  assert.ok(n > 700, 'checked ' + n + ' values');
});

test('the checker fails when a leaf has no widget, no description or a value without meaning', () => {
  const broken = structuredClone(json);
  broken.rules = broken.rules.filter((r) => r.id !== 'boolean');
  broken.typeDefaults = {};
  broken.rules.push({ id: 'bogus', when: { name: '^ComputerName$' }, widget: 'slider3d' });
  const ss = broken.settings['Microsoft-Windows-Shell-Setup'];
  ss.ComputerName.description = 'Too short.';
  // a boolean whose name gives no meaning and whose catalog labels are bare values
  const cat = structuredClone(catalog);
  const tbp = cat.components.find((c) => c.name === 'Microsoft-Windows-ehome-reg-inf').settings.find((s) => s.name === 'TBP');
  tbp.values = [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }];
  delete broken.settings['Microsoft-Windows-ehome-reg-inf'];
  const p = validateWidgets(broken, cat);
  assert.ok(p.some((x) => /unknown widget slider3d/.test(x)), 'unknown widget');
  assert.ok(p.some((x) => /ComputerName: description has 1 sentences/.test(x)), 'short description');
  assert.ok(p.some((x) => /ehome-reg-inf\|TBP: no valueHelp for true/.test(x)), 'missing value meaning');
  assert.ok(p.some((x) => /ehome-reg-inf\|TBP: no valueHelp for false/.test(x)), 'missing value meaning');
  const typo = structuredClone(json);
  typo.settings['Microsoft-Windows-Shell-Setup']['OOBE/HideEULA'] = { widget: 'toggle' };
  assert.ok(validateWidgets(typo, catalog).some((x) => /OOBE\/HideEULA: not a leaf/.test(x)), 'explicit entry for a missing setting');
});

test('inverted names say what true and false mean, with the risk on the dangerous value', () => {
  const rdp = hints.get('Microsoft-Windows-TerminalServices-LocalSessionManager|fDenyTSConnections');
  assert.equal(rdp.widget, 'toggle');
  assert.match(rdp.valueHelp.false, /allowed/i);
  assert.match(rdp.valueHelp.true, /blocked/i);
  assert.match(rdp.description, /inverted/i);
  const uac = hints.get('Microsoft-Windows-LUA-Settings|EnableLUA');
  assert.equal(uac.risk.level, 'danger');
  assert.equal(uac.risk.when, 'false');
  const dyn = hints.get('Microsoft-Windows-DNS-Client|Interfaces/Interface/DisableDynamicUpdate');
  assert.match(dyn.valueHelp.true, /OFF/);
});

test('widgets are assigned by type, name and values, with explicit overrides', () => {
  const w = (k) => hints.get(k).widget;
  assert.equal(w('Microsoft-Windows-Shell-Setup|TimeZone'), 'combobox-search');
  assert.equal(hints.get('Microsoft-Windows-Shell-Setup|TimeZone').source, 'timezones');
  assert.equal(w('Microsoft-Windows-International-Core|InputLocale'), 'combobox-search');
  assert.equal(w('Microsoft-Windows-Shell-Setup|UserAccounts/AdministratorPassword/Value'), 'password');
  assert.equal(w('Microsoft-Windows-Setup|UserData/ProductKey/Key'), 'product-key');
  assert.equal(w('Microsoft-Windows-Shell-Setup|ProductKey'), 'product-key');
  assert.equal(w('Microsoft-Windows-TCPIP|Interfaces/Interface/UnicastIpAddresses/IpAddress/Value'), 'cidr');
  assert.equal(w('Microsoft-Windows-TCPIP|Interfaces/Interface/Routes/Route/NextHopAddress'), 'ipv4');
  assert.equal(w('Microsoft-Windows-Setup|DiskConfiguration/Disk/CreatePartitions/CreatePartition/Size'), 'size');
  assert.equal(w('Microsoft-Windows-Deployment|RunSynchronous/RunSynchronousCommand/Path'), 'command-line');
  assert.equal(w('Microsoft-Windows-Shell-Setup|OEMInformation/Logo'), 'file');
  assert.equal(w('Microsoft-Windows-Shell-Setup|Themes/WindowColor'), 'color');
  assert.equal(w('Microsoft-Windows-PowerCPL|PreferredPlan'), 'guid');
  assert.equal(w('Microsoft-Windows-Embedded-EmbeddedLogon|BrandingNeutral'), 'enum-flags');
  assert.equal(w('Security-Malware-Windows-Defender|Scan/ScheduleTime'), 'time');
  assert.equal(w('Microsoft-Windows-UnattendedJoin|Identification/TimeoutPeriodInMinutes'), 'duration');
  assert.equal(w('Microsoft-Windows-Shell-Setup|OOBE/ProtectYourPC'), 'cards');
  assert.equal(w('Microsoft-Windows-Setup|Restart'), 'segmented');
  assert.equal(w('Microsoft-Windows-Embedded-KeyboardFilterService|AltF4'), 'segmented');
  assert.deepEqual(hints.get('Microsoft-Windows-Embedded-KeyboardFilterService|AltF4').values.map((v) => v.value), ['Allowed', 'Blocked']);
  assert.equal(w('Microsoft-Windows-Shell-Setup|UserAccounts/LocalAccounts/LocalAccount/Group'), 'account-picker');
  assert.equal(w('Security-Malware-Windows-Defender|FallbackOrder'), 'string-list');
  assert.equal(w('Microsoft-Windows-Devices-Lights-Configuration|BacklightAutobrightnessBucketMapping'), 'key-value');
  assert.equal(w('Microsoft-Windows-NetworkLoadBalancing-Core|Clusters/Cluster/ClusterMacAddress'), 'mac');
  assert.equal(w('Microsoft-Windows-Fax-Service|Receipts/SmtpSenderAddress'), 'email');
});

test('hints carry defaults, limits, related settings and documentation links', () => {
  const h = hints.get('Microsoft-Windows-UnattendedJoin|Identification/JoinDomain');
  assert.ok(h.related.includes('Microsoft-Windows-UnattendedJoin|Identification/MachineObjectOU'));
  assert.match(h.docUrl, /^https:\/\/learn\.microsoft\.com\//);
  const t = hints.get('Microsoft-Windows-UnattendedJoin|Identification/TimeoutPeriodInMinutes');
  assert.equal(t.min, 5); assert.equal(t.max, 60); assert.equal(t.default, '15');
  for (const [k, x] of hints) for (const r of x.related) assert.ok(hints.has(r), k + ' related ' + r);
});

test('text helpers', () => {
  assert.equal(sentenceCount('One. Two. Three.'), 3);
  assert.equal(sentenceCount('Uses 1.5 GB. Then stops.'), 2);
  assert.equal(cleanHelp('R2, Windows Vista FooBar specifies whether to show the bar.'), 'Sets whether to show the bar.');
  assert.equal(cleanHelp('Existing information in this topic is provided for reference only.'), '');
  assert.deepEqual(boolMeaning('HideEULAPage'), { true: 'EULA page: hidden.', false: 'EULA page: shown.' });
  const one = resolveHint(W, catalog, 'Microsoft-Windows-Shell-Setup', { path: 'X', name: 'X', type: 'boolean', help: 'Whether to do X.', values: [] });
  assert.ok(one.valueHelp.true === undefined || typeof one.valueHelp.true === 'string');
});
