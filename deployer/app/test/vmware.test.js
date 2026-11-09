'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vmware = require('../src/main/vmware.js');

const VMX = ['.encoding = "UTF-8"', 'displayName = "TempDesk TD-DC01"', 'tempdesk.managed = "TRUE"', 'firmware = "efi"', 'numvcpus = "4"', 'memsize = "8192"',
  'sata0:0.fileName = "D:\\iso\\server.iso"', 'sata0:1.fileName = "D:\\kit\\TempDesk-answer.iso"', 'ethernet0.connectionType = "nat"', ''].join('\r\n');

test('reads the settings of a machine TempDesk made', () => {
  const m = vmware.parseVmx(VMX);
  assert.deepStrictEqual(m, { name: 'TempDesk TD-DC01', firmware: 'uefi', cpus: 4, memoryMb: 8192, network: 'nat', windowsIso: 'D:\\iso\\server.iso', answerIso: 'D:\\kit\\TempDesk-answer.iso' });
});

test('ignores machines without the TempDesk marker', () => {
  assert.strictEqual(vmware.parseVmx(VMX.replace('tempdesk.managed = "TRUE"', 'tempdesk.managed = "FALSE"')), null);
  assert.strictEqual(vmware.parseVmx('displayName = "Someone else"\r\n'), null);
  assert.strictEqual(vmware.parseVmx('displayName = "x tempdesk.managed = \\"TRUE\\""\r\n'), null);
  assert.strictEqual(vmware.parseVmx(null), null);
});

test('only finds marked machines whose .vmx matches its folder name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-vm-'));
  try {
    const mk = (folder, file, text) => { fs.mkdirSync(path.join(dir, folder)); fs.writeFileSync(path.join(dir, folder, file), text); };
    mk('TempDesk TD-DC01', 'TempDesk TD-DC01.vmx', VMX);
    mk('Other machine', 'Other machine.vmx', 'displayName = "Other machine"\r\n');
    mk('Mismatch', 'elsewhere.vmx', VMX);
    const found = vmware.findMachines([dir, path.join(dir, 'missing')]);
    assert.deepStrictEqual(found.map((m) => m.name), ['TempDesk TD-DC01']);
    assert.strictEqual(found[0].vmx, path.join(dir, 'TempDesk TD-DC01', 'TempDesk TD-DC01.vmx'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('keeps actions inside the searched folders', () => {
  const base = path.join(os.tmpdir(), 'vms');
  assert.strictEqual(vmware.isInside(base, path.join(base, 'a', 'a.vmx')), true);
  assert.strictEqual(vmware.isInside(base, path.join(base, '..', 'a.vmx')), false);
  assert.strictEqual(vmware.isInside(base, base), false);
  const folders = vmware.searchFolders(['relative\\path', '', path.join(base, 'x'), path.join(base, 'x')], path.join(os.tmpdir(), 'docs'));
  assert.deepStrictEqual(folders, [path.resolve(os.tmpdir(), 'docs', 'Virtual Machines'), path.resolve(base, 'x')]);
});

test('refuses actions on machines it does not manage', async () => {
  const r = await vmware.action([os.tmpdir()], path.join(os.tmpdir(), 'nope', 'nope.vmx'), 'delete', { confirm: 'nope' });
  assert.strictEqual(r.ok, false);
  assert.ok(['notManaged', 'vmware'].includes(r.error));
});
