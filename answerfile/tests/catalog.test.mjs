import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate } from './schema-validator.mjs';

const here = new URL('..', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('unattend-catalog.json', here), 'utf8'));
const schema = JSON.parse(readFileSync(new URL('catalog.schema.json', here), 'utf8'));

function* walk(settings) {
  for (const s of settings) {
    yield s;
    if (s.children) yield* walk(s.children);
    if (s.listItem) yield* walk(s.listItem.settings);
  }
}

test('catalog validates against catalog.schema.json', () => {
  const errors = validate(schema, catalog);
  assert.deepEqual(errors.slice(0, 20), []);
});

test('validator rejects bad data', () => {
  const bad = structuredClone(catalog);
  bad.components[0].settings[0].type = 'float';
  delete bad.components[1].passes;
  bad.components[2].settings[0].extra = 1;
  const errors = validate(schema, bad);
  assert.ok(errors.some((e) => e.includes('not in enum')));
  assert.ok(errors.some((e) => e.includes('missing passes')));
  assert.ok(errors.some((e) => e.includes('unexpected property extra')));
});

test('coverage: many components, every one with passes and settings', () => {
  assert.ok(catalog.components.length >= 95, `only ${catalog.components.length} components`);
  for (const c of catalog.components) {
    assert.ok(c.passes.length > 0, `${c.name} has no passes`);
    assert.ok(c.settings.length > 0, `${c.name} has no settings`);
    for (const s of walk(c.settings)) {
      assert.ok(s.passes.length > 0, `${c.name}/${s.path} has no passes`);
      assert.ok(s.help && s.help.length > 3, `${c.name}/${s.path} has no help`);
      for (const p of s.passes) assert.ok(c.passes.includes(p), `${c.name}/${s.path} pass ${p} missing on component`);
    }
  }
  const total = catalog.components.reduce((n, c) => n + [...walk(c.settings)].length, 0);
  assert.ok(total > 1200, `only ${total} settings`);
  const popular = catalog.components.filter((c) => c.popular);
  assert.equal(popular.length, 40);
  for (const c of popular) assert.equal(c.detail, 'full', `${c.name} is not fully detailed`);
});

test('well-known components are present', () => {
  const names = new Set(catalog.components.map((c) => c.name));
  for (const n of ['Microsoft-Windows-Setup', 'Microsoft-Windows-Shell-Setup', 'Microsoft-Windows-International-Core',
    'Microsoft-Windows-International-Core-WinPE', 'Microsoft-Windows-UnattendedJoin', 'Microsoft-Windows-TCPIP',
    'Microsoft-Windows-DNS-Client', 'Microsoft-Windows-TerminalServices-LocalSessionManager', 'Microsoft-Windows-Deployment',
    'Microsoft-Windows-PnpCustomizationsWinPE', 'Microsoft-Windows-PnpCustomizationsNonWinPE', 'Microsoft-Windows-Security-SPP',
    'Microsoft-Windows-Security-SPP-UX', 'Microsoft-Windows-IE-InternetExplorer', 'Microsoft-Windows-MicrosoftEdgeBrowser',
    'Networking-MPSSVC-Svc', 'Microsoft-Windows-Printing-Spooler-Core', 'Microsoft-Windows-Sidebar', 'Microsoft-Windows-SystemRestore-Main']) {
    assert.ok(names.has(n), n);
  }
});

test('no duplicate paths within a component and no duplicate component names', () => {
  const seenNames = new Set();
  for (const c of catalog.components) {
    assert.ok(!seenNames.has(c.name.toLowerCase()), `duplicate component ${c.name}`);
    seenNames.add(c.name.toLowerCase());
    const paths = new Set();
    for (const s of walk(c.settings)) {
      assert.ok(!paths.has(s.path), `${c.name}: duplicate path ${s.path}`);
      paths.add(s.path);
      assert.equal(s.path.split('/').pop(), s.name, `${c.name}: ${s.path} name mismatch`);
    }
  }
});

test('setting shapes are consistent', () => {
  for (const c of catalog.components) {
    for (const s of walk(c.settings)) {
      const where = `${c.name}/${s.path}`;
      if (s.type === 'boolean') assert.ok(s.values && s.values.every((v) => v.value === 'true' || v.value === 'false'), where);
      if (s.type === 'enum') assert.ok(s.values.length > 0, where);
      if ((s.type === 'enum' || s.type === 'boolean') && s.default !== undefined) {
        assert.ok(s.values.some((v) => v.value === s.default), `${where} default ${s.default} not in values`);
      }
      if (s.type === 'integer' && s.default !== undefined) assert.match(s.default, /^-?\d+$/, where);
      if (s.min !== undefined && s.max !== undefined) assert.ok(s.min <= s.max, where);
      if (s.type === 'password') assert.equal(s.sensitive, true, where);
      if (s.encodedPassword) {
        const names = s.children.map((x) => x.name).sort();
        assert.deepEqual(names, ['PlainText', 'Value'], where);
      }
      if (s.listItem) {
        const li = s.listItem;
        const names = li.settings.map((x) => x.name);
        if (li.key) assert.ok(names.includes(li.key), `${where} key ${li.key} not a child`);
        if (li.keyStyle === 'keyValue') assert.ok(names.includes('Key'), where);
        // children up to (and including) a nested list are relative to this list item
        const scope = function* (list) {
          for (const x of list) {
            yield x;
            if (x.children) yield* scope(x.children);
          }
        };
        for (const x of scope(li.settings)) assert.ok(x.itemPath && s.path + '/' + x.itemPath === x.path, `${where} itemPath of ${x.path}`);
      }
      assert.ok(!/—/.test(s.help), `${where} help contains an em dash`);
    }
  }
});

test('key settings are typed as documented', () => {
  const find = (comp, path) => {
    const c = catalog.components.find((x) => x.name === comp);
    return [...walk(c.settings)].find((s) => s.path === path);
  };
  assert.equal(find('Microsoft-Windows-Shell-Setup', 'OOBE/HideEULAPage').type, 'boolean');
  assert.equal(find('Microsoft-Windows-Shell-Setup', 'ComputerName').maxLength, 15);
  assert.equal(find('Microsoft-Windows-Shell-Setup', 'UserAccounts/AdministratorPassword').passwordSuffix, 'AdministratorPassword');
  assert.equal(find('Microsoft-Windows-Shell-Setup', 'UserAccounts/LocalAccounts/LocalAccount/Password').passwordSuffix, 'Password');
  assert.equal(find('Microsoft-Windows-Shell-Setup', 'AutoLogon/Password').passwordSuffix, 'Password');
  const cp = find('Microsoft-Windows-Setup', 'DiskConfiguration/Disk/CreatePartitions/CreatePartition/Type');
  assert.deepEqual(cp.values.map((v) => v.value).sort(), ['EFI', 'Extended', 'Logical', 'MSR', 'Primary']);
  const run = find('Microsoft-Windows-Deployment', 'RunSynchronous/RunSynchronousCommand');
  assert.equal(run.type, 'list');
  assert.equal(run.listItem.key, 'Order');
  const ip = find('Microsoft-Windows-TCPIP', 'Interfaces/Interface/UnicastIpAddresses/IpAddress');
  assert.equal(ip.listItem.keyStyle, 'keyValue');
  assert.equal(ip.listItem.valueStyle, 'text');
  assert.equal(find('Microsoft-Windows-UnattendedJoin', 'Identification/Credentials/Password').sensitive, true);
  assert.equal(find('Microsoft-Windows-Setup', 'UserData/ProductKey/Key').sensitive, true);
  assert.deepEqual(find('Microsoft-Windows-TerminalServices-LocalSessionManager', 'fDenyTSConnections').passes.includes('specialize'), true);
});

test('unverified components carry reasons', () => {
  assert.ok(Array.isArray(catalog.unverifiedComponents));
  for (const u of catalog.unverifiedComponents) assert.ok(u.reason.length > 10, u.name);
});
