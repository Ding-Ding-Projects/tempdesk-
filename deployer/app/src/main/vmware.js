// Lists and manages the VMware Workstation virtual machines that TempDesk created (the engine's
// Vm phase marks them in the .vmx file). Machines made by anything else are never listed, started,
// stopped or deleted here. Uses VMware's own tools: vmrun.exe, vmcli.exe and vmware.exe.
'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MARKER = /^\s*tempdesk\.managed\s*=\s*"TRUE"\s*$/im;
const NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,62}$/;

// Reads the settings TempDesk shows from .vmx text. Returns null when it is not a TempDesk machine.
function parseVmx(text) {
  if (typeof text !== 'string' || !MARKER.test(text)) return null;
  const get = (key) => {
    const m = new RegExp('^\\s*' + key.replace(/[.:]/g, '\\$&') + '\\s*=\\s*"([^"]*)"\\s*$', 'im').exec(text);
    return m ? m[1] : '';
  };
  return {
    name: get('displayName'), firmware: get('firmware') === 'bios' ? 'bios' : 'uefi', cpus: Number(get('numvcpus')) || 0,
    memoryMb: Number(get('memsize')) || 0, network: get('ethernet0.connectionType'), windowsIso: get('sata0:0.fileName'), answerIso: get('sata0:1.fileName')
  };
}

// True when file is inside dir (after resolving), so a crafted name cannot reach outside the folder.
function isInside(dir, file) {
  const d = path.resolve(dir), f = path.resolve(file);
  const rel = path.relative(d, f);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function toolPaths() {
  if (process.platform !== 'win32') return null;
  const roots = [];
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) if (base) roots.push(path.join(base, 'VMware', 'VMware Workstation'));
  for (const r of roots) {
    const vmrun = path.join(r, 'vmrun.exe');
    if (fs.existsSync(vmrun)) {
      const cli = path.join(r, 'vmcli.exe'), gui = path.join(r, 'vmware.exe');
      return { root: r, vmrun, vmcli: fs.existsSync(cli) ? cli : '', gui: fs.existsSync(gui) ? gui : '' };
    }
  }
  return null;
}

function run(exe, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs || 60000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err && typeof err.code === 'number' ? err.code : (err ? -1 : 0), out: String(stdout || '') + String(stderr || '') });
    });
  });
}

// The folders TempDesk looks in: the default "Virtual Machines" folder plus any folder a deployment names.
function searchFolders(extra, documents) {
  const out = [path.join(documents, 'Virtual Machines')];
  for (const f of extra || []) if (typeof f === 'string' && f.trim() && path.isAbsolute(f.trim())) out.push(f.trim());
  return [...new Set(out.map((f) => path.resolve(f)))];
}

function findMachines(folders) {
  const found = [];
  for (const dir of folders) {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const ent of entries) {
      if (!ent.isDirectory() || !NAME.test(ent.name)) continue;
      const vmx = path.join(dir, ent.name, ent.name + '.vmx');
      let text = '';
      try { if (fs.statSync(vmx).size > 262144) continue; text = fs.readFileSync(vmx, 'utf8'); } catch (e) { continue; }
      const info = parseVmx(text);
      if (info) found.push(Object.assign({ vmx, folder: path.join(dir, ent.name) }, info, { name: info.name || ent.name }));
    }
  }
  return found;
}

async function list(folders) {
  const tools = toolPaths();
  if (!tools) return { installed: false, machines: [] };
  const machines = findMachines(folders);
  const r = await run(tools.vmrun, ['-T', 'ws', 'list']);
  const running = new Set(r.out.split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter((l) => l.endsWith('.vmx')));
  for (const m of machines) m.running = running.has(m.vmx.toLowerCase());
  return { installed: true, canScreenshot: !!tools.vmcli, machines };
}

// Every action first checks that the .vmx is one TempDesk made and lies in a folder TempDesk searches.
function managed(folders, vmx) {
  if (typeof vmx !== 'string' || !/\.vmx$/i.test(vmx)) return null;
  const m = findMachines(folders).find((x) => x.vmx.toLowerCase() === path.resolve(vmx).toLowerCase());
  return m && folders.some((d) => isInside(d, m.vmx)) ? m : null;
}

async function action(folders, vmx, what, opts) {
  const tools = toolPaths();
  if (!tools) return { ok: false, error: 'vmware' };
  const m = managed(folders, vmx);
  if (!m) return { ok: false, error: 'notManaged' };
  if (what === 'start') { const r = await run(tools.vmrun, ['-T', 'ws', 'start', m.vmx, opts && opts.show ? 'gui' : 'nogui'], 180000); return { ok: r.ok, error: r.ok ? '' : r.out.trim() }; }
  if (what === 'stop') { const r = await run(tools.vmrun, ['-T', 'ws', 'stop', m.vmx, 'hard'], 120000); return { ok: r.ok, error: r.ok ? '' : r.out.trim() }; }
  if (what === 'open') {
    if (!tools.gui) return { ok: false, error: 'vmware' };
    spawn(tools.gui, [m.vmx], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true };
  }
  if (what === 'screenshot') {
    if (!tools.vmcli) return { ok: false, error: 'noScreenshot' };
    const file = path.join(os.tmpdir(), 'tempdesk-vm-' + process.pid + '-' + Date.now() + '.png');
    const r = await run(tools.vmcli, [m.vmx, 'MKS', 'captureScreenshot', file], 30000);
    let data = '';
    try { if (r.ok && fs.statSync(file).size <= 8 * 1024 * 1024) data = fs.readFileSync(file).toString('base64'); } catch (e) { /* no picture */ }
    try { fs.rmSync(file, { force: true }); } catch (e) { /* ignore */ }
    return data ? { ok: true, png: data } : { ok: false, error: 'noScreenshot' };
  }
  if (what === 'delete') {
    if (!opts || opts.confirm !== m.name) return { ok: false, error: 'confirm' };
    const l = await run(tools.vmrun, ['-T', 'ws', 'list']);
    if (l.out.toLowerCase().includes(m.vmx.toLowerCase())) return { ok: false, error: 'running' };
    const r = await run(tools.vmrun, ['-T', 'ws', 'deleteVM', m.vmx], 120000);
    return { ok: r.ok && !fs.existsSync(m.vmx), error: r.ok ? '' : r.out.trim() };
  }
  return { ok: false, error: 'action' };
}

module.exports = { parseVmx, isInside, searchFolders, findMachines, list, action, toolPaths };
