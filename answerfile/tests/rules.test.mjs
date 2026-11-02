import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateModel, RULES, describeRules } from '../rules.mjs';

const catalog = JSON.parse(readFileSync(new URL('../unattend-catalog.json', import.meta.url), 'utf8'));

const SETUP = 'Microsoft-Windows-Setup';
const SHELL = 'Microsoft-Windows-Shell-Setup';
const JOIN = 'Microsoft-Windows-UnattendedJoin';

const pe = (values, extra = {}) => ({ passes: { windowsPE: { [SETUP]: values, ...extra } } });
const spec = (comp, values) => ({ passes: { specialize: { [comp]: values } } });
const oobe = (values) => ({ passes: { oobeSystem: { [SHELL]: values } } });
const disk = (creates, modifies, more = {}) => pe({
  'DiskConfiguration/Disk': [{ DiskID: 0, WillWipeDisk: true, 'CreatePartitions/CreatePartition': creates, ...(modifies ? { 'ModifyPartitions/ModifyPartition': modifies } : {}) }],
  ...more,
});
const uefiCreates = [
  { Order: 1, Type: 'EFI', Size: 100 },
  { Order: 2, Type: 'MSR', Size: 16 },
  { Order: 3, Type: 'Primary', Extend: true },
];
const uefiModifies = [
  { Order: 1, PartitionID: 1, Format: 'FAT32', Label: 'System' },
  { Order: 2, PartitionID: 3, Format: 'NTFS', Letter: 'C', Label: 'Windows' },
];
const goodUefi = disk(uefiCreates, uefiModifies, { 'ImageInstall/OSImage/InstallTo/DiskID': 0, 'ImageInstall/OSImage/InstallTo/PartitionID': 3 });
const goodBios = disk(
  [{ Order: 1, Type: 'Primary', Size: 500 }, { Order: 2, Type: 'Primary', Extend: true }],
  [{ Order: 1, PartitionID: 1, Active: true, Format: 'NTFS' }, { Order: 2, PartitionID: 2, Format: 'NTFS', Letter: 'C' }],
  { 'ImageInstall/OSImage/InstallTo/DiskID': 0, 'ImageInstall/OSImage/InstallTo/PartitionID': 2 },
);
const pkg = (p) => ({ servicing: [{ action: 'configure', identity: { name: 'Microsoft-Windows-Foundation-Package', version: '10.0.26100.1', processorArchitecture: 'amd64', publicKeyToken: '31bf3856ad364e35', language: '' }, ...p }], passes: {} });

/** [ruleId, model that must trigger it, model that must not trigger it, options] */
const CASES = [
  ['pass.unknown', { passes: { lunch: {} } }, oobe({})],
  ['component.unknown', spec('Contoso-Nothing', {}), spec(SHELL, { ComputerName: 'A1' })],
  ['component.passNotAllowed', { passes: { windowsPE: { [JOIN]: {} } } }, spec(JOIN, {})],
  ['setting.unknown', spec(SHELL, { NoSuchThing: 1 }), spec(SHELL, { ComputerName: 'A1' })],
  ['setting.passNotAllowed', { passes: { windowsPE: { [SHELL]: { ComputerName: 'A1' } } } }, spec(SHELL, { ComputerName: 'A1' })],
  ['setting.deprecated', oobe({ 'OOBE/NetworkLocation': 'Work' }), oobe({ 'OOBE/HideEULAPage': true })],
  ['value.list', oobe({ 'FirstLogonCommands/SynchronousCommand': { Order: 1 } }), oobe({ 'FirstLogonCommands/SynchronousCommand': [{ Order: 1, CommandLine: 'x' }] })],
  ['value.boolean', oobe({ 'OOBE/HideEULAPage': 'yes' }), oobe({ 'OOBE/HideEULAPage': 'TRUE' })],
  ['value.enum', pe({ 'DynamicUpdate/WillShowUI': 'Sometimes' }), pe({ 'DynamicUpdate/WillShowUI': 'Never' })],
  ['value.integer', oobe({ 'AutoLogon/LogonCount': 'two' }), oobe({ 'AutoLogon/LogonCount': '2' })],
  ['value.range', spec(JOIN, { 'Identification/TimeoutPeriodInMinutes': 90 }), spec(JOIN, { 'Identification/TimeoutPeriodInMinutes': 60 })],
  ['value.maxLength', pe({ 'UserData/FullName': 'x'.repeat(64) }), pe({ 'UserData/FullName': 'x'.repeat(63) })],
  ['list.keyMissing', spec('Microsoft-Windows-TCPIP', { 'Interfaces/Interface': [{ Identifier: 'Ethernet', 'UnicastIpAddresses/IpAddress': [{ Value: '10.0.0.1/24' }] }] }),
    spec('Microsoft-Windows-TCPIP', { 'Interfaces/Interface': [{ Identifier: 'Ethernet', 'UnicastIpAddresses/IpAddress': [{ Key: '1', Value: '10.0.0.1/24' }] }] })],
  ['list.keyDuplicate', oobe({ 'UserAccounts/LocalAccounts/LocalAccount': [{ Name: 'a' }, { Name: 'A' }] }), oobe({ 'UserAccounts/LocalAccounts/LocalAccount': [{ Name: 'a' }, { Name: 'b' }] })],
  ['list.orderUnique', spec('Microsoft-Windows-Deployment', { 'RunSynchronous/RunSynchronousCommand': [{ Order: 1, Path: 'a' }, { Order: '1', Path: 'b' }] }),
    spec('Microsoft-Windows-Deployment', { 'RunSynchronous/RunSynchronousCommand': [{ Order: 1, Path: 'a' }, { Order: 2, Path: 'b' }] })],
  ['join.exclusive', spec(JOIN, { 'Identification/JoinDomain': 'corp', 'Identification/JoinWorkgroup': 'WG', 'Identification/UnsecureJoin': true }), spec(JOIN, { 'Identification/JoinWorkgroup': 'WG' })],
  ['join.credentials', spec(JOIN, { 'Identification/JoinDomain': 'corp' }), spec(JOIN, { 'Identification/JoinDomain': 'corp', 'Identification/Provisioning/AccountData': 'blob' })],
  ['join.credentialsIncomplete', spec(JOIN, { 'Identification/JoinDomain': 'corp', 'Identification/Credentials/Username': 'u', 'Identification/Credentials/Password': 'p' }),
    spec(JOIN, { 'Identification/JoinDomain': 'corp', 'Identification/Credentials/Domain': 'CORP', 'Identification/Credentials/Username': 'u', 'Identification/Credentials/Password': 'p' })],
  ['join.ouWithoutDomain', spec(JOIN, { 'Identification/JoinWorkgroup': 'WG', 'Identification/MachineObjectOU': 'OU=x' }), spec(JOIN, { 'Identification/JoinWorkgroup': 'WG' })],
  ['computerName.length', spec(SHELL, { ComputerName: 'ÄÄÄÄÄÄÄÄ' }), spec(SHELL, { ComputerName: 'ABCDEFGHIJKLMNO' })],
  ['computerName.digits', spec(SHELL, { ComputerName: '12345' }), spec(SHELL, { ComputerName: '12345A' })],
  ['computerName.chars', spec(SHELL, { ComputerName: 'my pc' }), spec(SHELL, { ComputerName: '*' })],
  ['autologon.password', oobe({ 'AutoLogon/Enabled': true, 'AutoLogon/LogonCount': 1, 'AutoLogon/Username': 'a' }),
    oobe({ 'AutoLogon/Enabled': true, 'AutoLogon/LogonCount': 1, 'AutoLogon/Username': 'a', 'AutoLogon/Password/Value': '' })],
  ['autologon.logonCount', oobe({ 'AutoLogon/Enabled': 'true', 'AutoLogon/Username': 'a', 'AutoLogon/Password/Value': 'p' }),
    oobe({ 'AutoLogon/Enabled': false, 'AutoLogon/Username': 'a' })],
  ['autologon.username', oobe({ 'AutoLogon/Enabled': true, 'AutoLogon/LogonCount': 1, 'AutoLogon/Password/Value': 'p' }),
    oobe({ 'AutoLogon/Enabled': true, 'AutoLogon/LogonCount': 1, 'AutoLogon/Username': 'a', 'AutoLogon/Password/Value': 'p' })],
  ['password.blankAdministrator', oobe({ 'UserAccounts/AdministratorPassword/Value': '' }), oobe({ 'UserAccounts/AdministratorPassword/Value': 'x' })],
  ['command.willReboot', spec('Microsoft-Windows-Deployment', { 'RunSynchronous/RunSynchronousCommand': [{ Order: 1, Path: 'a', WillReboot: 'Maybe' }] }),
    spec('Microsoft-Windows-Deployment', { 'RunSynchronous/RunSynchronousCommand': [{ Order: 1, Path: 'a', WillReboot: 'OnRequest' }] })],
  ['command.missing', oobe({ 'FirstLogonCommands/SynchronousCommand': [{ Order: 1 }] }), oobe({ 'FirstLogonCommands/SynchronousCommand': [{ Order: 1, CommandLine: 'x' }] })],
  ['productKey.format', pe({ 'UserData/ProductKey/Key': 'ABCDE-FGHIJ' }), pe({ 'UserData/ProductKey/Key': 'VK7JG-NPHTM-C97JM-9MPGT-3V66T' })],
  ['productKey.alphabet', spec(SHELL, { ProductKey: 'OOOOO-11111-AAAAA-EEEEE-LLLLL' }), spec(SHELL, { ProductKey: 'W269N-WFGWX-YVC9B-4J6C9-T83GX' })],
  ['disk.extendCount', disk([{ Order: 1, Type: 'Primary', Extend: true }, { Order: 2, Type: 'Primary', Extend: true }], [{ Order: 1, PartitionID: 1, Active: true }]), goodBios],
  ['disk.extendLast', disk([{ Order: 1, Type: 'Primary', Extend: true }, { Order: 2, Type: 'Primary', Size: 500 }], [{ Order: 1, PartitionID: 1, Active: true }]), goodBios],
  ['disk.extendWithSize', disk([{ Order: 1, Type: 'Primary', Size: 500, Extend: true }], [{ Order: 1, PartitionID: 1, Active: true }]), goodBios],
  ['disk.sizeRequired', disk([{ Order: 1, Type: 'Primary' }], [{ Order: 1, PartitionID: 1, Active: true }]), goodBios],
  ['disk.efiSize', disk([{ Order: 1, Type: 'EFI', Size: 99 }, ...uefiCreates.slice(1)], uefiModifies), goodUefi],
  ['disk.efiFormat', disk(uefiCreates, [{ Order: 1, PartitionID: 1, Format: 'NTFS' }]), goodUefi],
  ['disk.msrCount', disk([uefiCreates[0], uefiCreates[2]], [{ Order: 1, PartitionID: 1, Format: 'FAT32' }]), goodUefi],
  ['disk.gptNoExtended', disk([...uefiCreates.slice(0, 2), { Order: 3, Type: 'Extended', Size: 1000 }, { Order: 4, Type: 'Logical', Extend: true }], uefiModifies), goodUefi],
  ['disk.mbrActive', disk([{ Order: 1, Type: 'Primary', Extend: true }], [{ Order: 1, PartitionID: 1, Format: 'NTFS' }]), goodBios],
  ['disk.activeOnGpt', disk(uefiCreates, [{ Order: 1, PartitionID: 1, Format: 'FAT32', Active: true }]), goodUefi],
  ['disk.mbrPrimaryLimit', disk([1, 2, 3, 4].map((o) => ({ Order: o, Type: 'Primary', Size: 100 })).concat([{ Order: 5, Type: 'Primary', Extend: true }]), [{ Order: 1, PartitionID: 1, Active: true }]), goodBios],
  ['disk.modifyTarget', disk(uefiCreates, [...uefiModifies, { Order: 3, PartitionID: 4, Format: 'NTFS' }]), goodUefi],
  ['disk.letterDuplicate', disk(uefiCreates, [{ Order: 1, PartitionID: 1, Format: 'FAT32', Letter: 'S' }, { Order: 2, PartitionID: 3, Letter: 's' }]), goodUefi],
  ['disk.fit', disk([{ Order: 1, Type: 'EFI', Size: 100 }, { Order: 2, Type: 'MSR', Size: 16 }, { Order: 3, Type: 'Primary', Size: 40000 }], [{ Order: 1, PartitionID: 1, Format: 'FAT32' }]), goodUefi, { diskSizesMB: { 0: 30000 } }],
  ['install.target', disk(uefiCreates, uefiModifies, { 'ImageInstall/OSImage/InstallTo/DiskID': 0, 'ImageInstall/OSImage/InstallTo/PartitionID': 2 }), goodUefi],
  ['install.toAndAvailable', pe({ 'ImageInstall/OSImage/InstallToAvailablePartition': true, 'ImageInstall/OSImage/InstallTo/DiskID': 0 }), pe({ 'ImageInstall/OSImage/InstallToAvailablePartition': true })],
  ['servicing.action', pkg({ action: 'enable' }), pkg({})],
  ['servicing.identity', pkg({ identity: { name: 'x', version: '1.0.0.0' } }), pkg({})],
  ['servicing.version', pkg({ identity: { name: 'x', version: '10.0', processorArchitecture: 'amd64', publicKeyToken: '31bf3856ad364e35', language: '' } }), pkg({})],
  ['servicing.publicKeyToken', pkg({ identity: { name: 'x', version: '1.0.0.0', processorArchitecture: 'amd64', publicKeyToken: 'xyz', language: '' } }), pkg({})],
  ['servicing.permanence', pkg({ permanence: 'forever' }), pkg({ permanence: 'permanent' })],
  ['servicing.sourceLocation', pkg({ action: 'install', sources: [{}] }), pkg({ action: 'install', sources: [{ location: 'D:\\pkg.cab' }] })],
  ['servicing.installNeedsSource', pkg({ action: 'install' }), pkg({ action: 'install', sources: [{ location: 'D:\\pkg.cab' }] })],
  ['servicing.selection', pkg({ selections: [{ name: 'IIS-WebServer', state: 'on' }] }), pkg({ selections: [{ name: 'IIS-WebServer', state: true }] })],
  ['servicing.selectionDuplicate', pkg({ selections: [{ name: 'A', state: true }, { name: 'a', state: false }] }), pkg({ selections: [{ name: 'A', state: true }, { name: 'B', state: false }] })],
  ['servicing.selectionWithoutConfigure', pkg({ action: 'remove', selections: [{ name: 'A', state: true }] }), pkg({ selections: [{ name: 'A', state: true }] })],
];

test('rule table: unique ids, severities, titles, and at least 25 rules', () => {
  assert.ok(RULES.length >= 25, `only ${RULES.length} rules`);
  const ids = RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of RULES) {
    assert.match(r.id, /^[a-z][A-Za-z]*\.[A-Za-z]+$/);
    assert.ok(['error', 'warning', 'info'].includes(r.severity), r.id);
    assert.ok(r.title.length > 5 && !/\u2014/.test(r.title), r.id);
    assert.equal(typeof r.check, 'function');
  }
  assert.deepEqual(describeRules().map((r) => r.id), ids);
});

test('every rule has a test case', () => {
  const tested = new Set(CASES.map((c) => c[0]));
  assert.deepEqual(RULES.map((r) => r.id).filter((id) => !tested.has(id)), []);
});

for (const [id, bad, good, options] of CASES) {
  test(`rule ${id}`, () => {
    const rule = RULES.find((r) => r.id === id);
    assert.ok(rule, `no rule ${id}`);
    const hits = validateModel(bad, catalog, options).filter((i) => i.id === id);
    assert.ok(hits.length > 0, `${id} did not fire`);
    for (const h of hits) {
      assert.ok(h.where && h.message, id);
      assert.ok(['error', 'warning', 'info'].includes(h.level));
    }
    assert.equal(hits[0].level === rule.severity || rule.id === 'list.keyMissing', true);
    const quiet = validateModel(good, catalog, options).filter((i) => i.id === id);
    assert.deepEqual(quiet, [], `${id} fired on the passing model`);
  });
}

test('clean layouts produce no errors', () => {
  for (const m of [goodUefi, goodBios]) assert.deepEqual(validateModel(m, catalog, { diskSizesMB: { 0: 61440 } }).filter((i) => i.level === 'error'), []);
});

test('options: disable and severity overrides; errors sort first', () => {
  const m = spec(SHELL, { ComputerName: '12345', NoSuchThing: 1 });
  assert.ok(validateModel(m, catalog).some((i) => i.id === 'computerName.digits'));
  assert.ok(!validateModel(m, catalog, { disable: ['computerName.digits'] }).some((i) => i.id === 'computerName.digits'));
  const sev = validateModel(m, catalog, { severity: { 'computerName.digits': 'info' } });
  assert.equal(sev.find((i) => i.id === 'computerName.digits').level, 'info');
  const mixed = validateModel(oobe({ 'OOBE/NetworkLocation': 'Work', 'OOBE/HideEULAPage': 'nope' }), catalog);
  assert.equal(mixed[0].level, 'error');
  assert.equal(mixed[mixed.length - 1].level, 'warning');
});

// ---------------------------------------------------------------------------
// automatic fixes: each fix makes its rule pass and changes nothing else
// ---------------------------------------------------------------------------
import { fixesFor, applyFix, NO_FIX } from '../rules.mjs';

/** [ruleId, model that triggers it, exact expected model after the fix, options] */
const FIX_CASES = [
  ['component.unknown', { passes: { specialize: { 'Contoso-Nothing': { A: 1 }, [SHELL]: { ComputerName: 'A1' } } } }, spec(SHELL, { ComputerName: 'A1' })],
  ['component.passNotAllowed', { passes: { windowsPE: { [JOIN]: { 'Identification/JoinWorkgroup': 'WG' } } } }, { passes: { windowsPE: {}, specialize: { [JOIN]: { 'Identification/JoinWorkgroup': 'WG' } } } }],
  ['setting.unknown', spec(SHELL, { NoSuchThing: 1, ComputerName: 'A1' }), spec(SHELL, { ComputerName: 'A1' })],
  ['setting.passNotAllowed', { passes: { windowsPE: { [SHELL]: { ComputerName: 'A1' } } } }, { passes: { windowsPE: {}, specialize: { [SHELL]: { ComputerName: 'A1' } } } }],
  ['setting.deprecated', oobe({ 'OOBE/NetworkLocation': 'Work', 'OOBE/HideEULAPage': true }), oobe({ 'OOBE/HideEULAPage': true })],
  ['value.list', oobe({ 'FirstLogonCommands/SynchronousCommand': { Order: 1, CommandLine: 'x' } }), oobe({ 'FirstLogonCommands/SynchronousCommand': [{ Order: 1, CommandLine: 'x' }] })],
  ['value.boolean', oobe({ 'OOBE/HideEULAPage': 'yes', 'OOBE/HideWirelessSetupInOOBE': 'nah' }), oobe({ 'OOBE/HideEULAPage': true, 'OOBE/HideWirelessSetupInOOBE': false })],
  ['value.range', spec(JOIN, { 'Identification/TimeoutPeriodInMinutes': 90, 'Identification/JoinWorkgroup': 'WG' }), spec(JOIN, { 'Identification/TimeoutPeriodInMinutes': 60, 'Identification/JoinWorkgroup': 'WG' })],
  ['value.maxLength', pe({ 'UserData/FullName': 'x'.repeat(70) }), pe({ 'UserData/FullName': 'x'.repeat(63) })],
  ['list.orderUnique', spec('Microsoft-Windows-Deployment', { 'RunSynchronous/RunSynchronousCommand': [{ Order: 1, Path: 'a' }, { Order: '1', Path: 'b' }] }),
    spec('Microsoft-Windows-Deployment', { 'RunSynchronous/RunSynchronousCommand': [{ Order: 1, Path: 'a' }, { Order: 2, Path: 'b' }] })],
  ['join.exclusive', spec(JOIN, { 'Identification/JoinDomain': 'corp', 'Identification/JoinWorkgroup': 'WG', 'Identification/UnsecureJoin': true }), spec(JOIN, { 'Identification/JoinDomain': 'corp', 'Identification/UnsecureJoin': true })],
  ['join.ouWithoutDomain', spec(JOIN, { 'Identification/JoinWorkgroup': 'WG', 'Identification/MachineObjectOU': 'OU=x' }), spec(JOIN, { 'Identification/JoinWorkgroup': 'WG' })],
  ['computerName.length', spec(SHELL, { ComputerName: 'ClassroomComputer01' }), spec(SHELL, { ComputerName: 'ClassroomComput' })],
  ['computerName.digits', spec(SHELL, { ComputerName: '12345' }), spec(SHELL, { ComputerName: 'PC-12345' })],
  ['computerName.chars', spec(SHELL, { ComputerName: 'my pc' }), spec(SHELL, { ComputerName: 'my-pc' })],
  ['autologon.logonCount', oobe({ 'AutoLogon/Enabled': 'true', 'AutoLogon/Username': 'a', 'AutoLogon/Password/Value': 'p' }), oobe({ 'AutoLogon/Enabled': 'true', 'AutoLogon/Username': 'a', 'AutoLogon/Password/Value': 'p', 'AutoLogon/LogonCount': 1 })],
  ['command.willReboot', spec('Microsoft-Windows-Deployment', { 'RunSynchronous/RunSynchronousCommand': [{ Order: 1, Path: 'a', WillReboot: 'always' }] }),
    spec('Microsoft-Windows-Deployment', { 'RunSynchronous/RunSynchronousCommand': [{ Order: 1, Path: 'a', WillReboot: 'Always' }] })],
  ['productKey.format', pe({ 'UserData/ProductKey/Key': 'vk7jg nphtm c97jm 9mpgt 3v66t' }), pe({ 'UserData/ProductKey/Key': 'VK7JG-NPHTM-C97JM-9MPGT-3V66T' })],
  ['disk.extendWithSize', disk([{ Order: 1, Type: 'Primary', Size: 500, Extend: true }], [{ Order: 1, PartitionID: 1, Active: true }]), disk([{ Order: 1, Type: 'Primary', Extend: true }], [{ Order: 1, PartitionID: 1, Active: true }])],
  ['disk.extendLast', disk([{ Order: 1, Type: 'Primary', Extend: true }, { Order: 2, Type: 'Primary', Size: 500 }], [{ Order: 1, PartitionID: 1, Format: 'NTFS', Letter: 'C' }, { Order: 2, PartitionID: 2, Active: true }]),
    disk([{ Order: 2, Type: 'Primary', Extend: true }, { Order: 1, Type: 'Primary', Size: 500 }], [{ Order: 1, PartitionID: 2, Format: 'NTFS', Letter: 'C' }, { Order: 2, PartitionID: 1, Active: true }])],
  ['disk.efiSize', disk([{ Order: 1, Type: 'EFI', Size: 99 }, ...uefiCreates.slice(1)], uefiModifies), disk([{ Order: 1, Type: 'EFI', Size: 260 }, ...uefiCreates.slice(1)], uefiModifies)],
  ['disk.efiFormat', disk(uefiCreates, [{ Order: 1, PartitionID: 1, Format: 'NTFS' }]), disk(uefiCreates, [{ Order: 1, PartitionID: 1, Format: 'FAT32' }])],
  ['disk.activeOnGpt', disk(uefiCreates, [{ Order: 1, PartitionID: 1, Format: 'FAT32', Active: true }]), disk(uefiCreates, [{ Order: 1, PartitionID: 1, Format: 'FAT32' }])],
  ['install.toAndAvailable', pe({ 'ImageInstall/OSImage/InstallToAvailablePartition': true, 'ImageInstall/OSImage/InstallTo/DiskID': 0 }), pe({ 'ImageInstall/OSImage/InstallTo/DiskID': 0 })],
  ['servicing.publicKeyToken', pkg({ identity: { name: 'x', version: '1.0.0.0', processorArchitecture: 'amd64', publicKeyToken: 'xyz', language: '' } }), pkg({ identity: { name: 'x', version: '1.0.0.0', processorArchitecture: 'amd64', publicKeyToken: '31bf3856ad364e35', language: '' } })],
  ['servicing.selection', pkg({ selections: [{ name: 'IIS-WebServer', state: 'on' }] }), pkg({ selections: [{ name: 'IIS-WebServer', state: true }] })],
  ['servicing.selectionDuplicate', pkg({ selections: [{ name: 'A', state: true }, { name: 'a', state: false }] }), pkg({ selections: [{ name: 'A', state: true }] })],
  ['servicing.selectionWithoutConfigure', pkg({ action: 'remove', selections: [{ name: 'A', state: true }] }), pkg({ action: 'remove' })],
];

test('every rule either has a fix with a test case, or is listed in NO_FIX with a reason', () => {
  const withFix = RULES.filter((r) => r.fix).map((r) => r.id);
  assert.deepEqual(withFix.filter((id) => !FIX_CASES.some((c) => c[0] === id)), [], 'fix without a test');
  for (const r of RULES) {
    if (r.fix) { assert.equal(typeof r.fixLabel, 'string', r.id); assert.ok(!NO_FIX[r.id], r.id + ' has a fix and a NO_FIX reason'); }
    else assert.ok(NO_FIX[r.id] && NO_FIX[r.id].length > 10, r.id + ' needs a fix or a NO_FIX reason');
  }
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  for (const id of Object.keys(NO_FIX)) assert.ok(readme.includes('`' + id + '`'), 'README lists ' + id);
});

for (const [id, bad, expected, options] of FIX_CASES) {
  test(`fix ${id}`, () => {
    assert.ok(validateModel(bad, catalog, options).some((i) => i.id === id), `${id} did not fire before the fix`);
    assert.ok(fixesFor(validateModel(bad, catalog, options)).some((f) => f.id === id), 'offered as a fix');
    const before = JSON.stringify(bad);
    const fixed = applyFix(bad, catalog, id);
    assert.equal(JSON.stringify(bad), before, 'input model not mutated');
    assert.deepEqual(validateModel(fixed, catalog, options).filter((i) => i.id === id), [], `${id} still fires after the fix`);
    assert.deepEqual(fixed, expected, 'the fix changes only what it must');
    const otherBefore = new Set(validateModel(bad, catalog, options).filter((i) => i.id !== id).map((i) => i.id + ' ' + i.where));
    const introduced = validateModel(fixed, catalog, options).filter((i) => i.id !== id && !otherBefore.has(i.id + ' ' + i.where));
    assert.deepEqual(introduced, [], 'no new issues');
  });
}
test('applyFix returns null for rules without a fix', () => {
  assert.equal(applyFix(spec(JOIN, { 'Identification/JoinDomain': 'corp' }), catalog, 'join.credentials'), null);
});
