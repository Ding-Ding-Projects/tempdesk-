'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execute = promisify(execFile);
const supported = /\.(?:iso|a?vhdx?|vhds)$/i;
const extensions = ['vhd', 'vhdx', 'vhds', 'avhd', 'avhdx', 'iso'];
const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand'];
const encode = (source) => Buffer.from(source, 'utf16le').toString('base64');
const encodeData = (value) => Buffer.from(value, 'utf8').toString('base64');
const decodeData = (data) => "[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + data + "'))";
const source = fs.readFileSync(path.join(__dirname, 'virtual-disk-operation.ps1'), 'utf8');
const native = fs.readFileSync(path.join(__dirname, 'virtual-disk-native.cs'), 'utf8');

function shell() {
  if (process.platform !== 'win32') throw new Error('Windows virtual disk services are required.');
  return path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

function script(q) {
  // All request data is decoded as JSON. No path or label becomes PowerShell source.
  const setup = '$ErrorActionPreference="Stop"; $q=' + decodeData(encodeData(JSON.stringify(q))) + ' | ConvertFrom-Json;';
  return setup + (['inspect', 'discover'].includes(q.action) ? '' : 'Add-Type -TypeDefinition (' + decodeData(encodeData(native)) + ');') + source;
}

async function run(q) {
  try {
    const { stdout } = await execute(shell(), [...args, encode(script(q))], { windowsHide: true, maxBuffer: 262144 });
    return JSON.parse(stdout.trim());
  } catch (err) {
    throw new Error(String(err.stderr || err.code || 'Image operation did not return a result.').slice(0, 1500));
  }
}

// The broker runs without elevation. Native consent is requested only for a VHD attachment.
// Its worker holds a nonpermanent read-only attachment until the broker process exits.
const broker = [
  '$ErrorActionPreference="Stop"',
  '$eventName="Local\\TempDeskDisk"+[Guid]::NewGuid().ToString("N")',
  '$event=New-Object Threading.EventWaitHandle($false,[Threading.EventResetMode]::ManualReset,$eventName)',
  '$mode=[Console]::ReadLine()',
  '$body=[Text.Encoding]::Unicode.GetString([Convert]::FromBase64String([Console]::ReadLine()))',
  '$ticks=(Get-Process -Id $PID).StartTime.ToUniversalTime().Ticks',
  '$body=$body.Replace("__BROKER_PID__", [string]$PID).Replace("__BROKER_TICKS__", [string]$ticks).Replace("__READY_EVENT__", $eventName)',
  '$encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($body))',
  '$launch=@{FilePath=(Join-Path $PSHOME "powershell.exe");ArgumentList=@("-NoProfile","-NonInteractive","-EncodedCommand",$encoded);WindowStyle="Hidden";WorkingDirectory=[Environment]::SystemDirectory;PassThru=$true}',
  'if ($mode -eq "consent") { $launch.Verb="RunAs" }',
  '$worker=Start-Process @launch',
  'while (!$event.WaitOne(200)) { if ($worker.HasExited) { throw ("The attachment worker exited with code "+$worker.ExitCode) } }',
  '[Console]::WriteLine("READY"); [Console]::Out.Flush(); $release=[Console]::In.ReadLineAsync(); while (!$release.Wait(200)) { if ($worker.HasExited) { break } }'
].join('\n');

function attach(file) {
  const body = script({ action: 'attach', path: file })
    .replace('$ownerProcess = Get-Process -Id $q.owner', '$ownerProcess = Get-Process -Id __BROKER_PID__')
    .replace('$q.ownerStart', "'__BROKER_TICKS__'").replace('$q.ready', "'__READY_EVENT__'");
  const child = spawn(shell(), [...args, encode(broker)], { windowsHide: true, stdio: 'pipe' });
  child.stdin.on('error', () => {});
  child.stdin.write((/\.iso$/i.test(file) ? 'normal' : 'consent') + '\n' + encode(body) + '\n');
  const ready = new Promise((resolve, reject) => {
    let output = '', reason = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Attachment was not verified before the consent timeout.')); }, 120000);
    child.once('error', (e) => { clearTimeout(timeout); reject(e); });
    child.stderr.on('data', (c) => { reason = (reason + c).slice(-2048); });
    child.stdout.on('data', (c) => {
      output = (output + c).slice(-64);
      if (output.trim() === 'READY') { clearTimeout(timeout); resolve(); }
    });
    child.once('close', (code) => { clearTimeout(timeout); reject(new Error(reason || 'Attachment ended with code ' + code)); });
  });
  return { child, ready };
}

function registerVirtualDisks(handle, dialog, getWindow) {
  const files = new Map(), leases = new Map(), busy = new Set();
  const remember = (file) => {
    if (!path.isAbsolute(file) || !supported.test(file)) throw new Error('Unsupported image file.');
    const id = crypto.createHash('sha256').update(file.toLowerCase()).digest('hex');
    files.set(id, file);
    return id;
  };
  handle('vd:list', () => ({ available: process.platform === 'win32', files: [...files].map(([id, file]) => ({ id, file, owned: leases.has(id) })) }));
  handle('vd:discover', async () => {
    const result = await run({ action: 'discover' });
    for (const file of result.files) if (typeof file === 'string' && supported.test(file)) remember(file);
    return result.files.length;
  });
  handle('vd:pick', async () => {
    const selected = await dialog.showOpenDialog(getWindow(), { properties: ['openFile','multiSelections'], filters: [{ name: 'VHD / VHDX / VHD Set / ISO', extensions }] });
    return selected.filePaths.map(remember);
  });
  handle('vd:inspect', (id) => {
    if (!files.has(id)) throw new Error('Select an image first.');
    return run({ action: 'inspect', path: files.get(id) });
  });
  handle('vd:create', async (format, mib, fixed) => {
    if (!['vhd','vhdx','vhds'].includes(format) || !Number.isSafeInteger(mib) || mib < 3 || mib > (format === 'vhd' ? 2040 * 1024 : 64 * 1024 * 1024)) throw new Error('Invalid disk format or size.');
    const choice = await dialog.showSaveDialog(getWindow(), { defaultPath: 'disk.' + format, filters: [{ name: format.toUpperCase(), extensions: [format] }] });
    if (choice.canceled) return null;
    const file = choice.filePath;
    if (path.extname(file).toLowerCase() !== '.' + format || fs.existsSync(file)) throw new Error('Choose a new file with the selected extension.');
    await run({ action: 'create', path: file, mib, fixed: fixed === true });
    return remember(file);
  });
  handle('vd:mount', async (id, action, confirmedPath) => {
    const file = files.get(id);
    if (!file || file !== confirmedPath || busy.has(id)) throw new Error('Select and confirm an idle image.');
    busy.add(id);
    try {
      if (action === 'attach') {
        if (leases.has(id)) throw new Error('This session already owns an attachment.');
        const confirmation = await dialog.showMessageBox(getWindow(), {
          type: 'question', message: file, detail: 'Attach this image read-only for this session?',
          buttons: ['Cancel', 'Attach read-only'], defaultId: 0, cancelId: 0, noLink: true
        });
        if (confirmation.response !== 1) throw new Error('Attachment cancelled.');
        const mount = attach(file);
        await mount.ready;
        leases.set(id, mount.child);
        mount.child.once('close', () => leases.delete(id));
      } else if (action === 'detach') {
        const child = leases.get(id);
        if (!child) throw new Error('Only attachments opened by this session can be released.');
        const closed = new Promise((resolve) => child.once('close', resolve));
        child.stdin.end('\n');
        await closed;
        for (let i = 0; i < 8; i++) {
          const state = await run({ path: file, action: 'inspect' });
          if (state.attached === false) return state;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error('The session handle closed, but detachment could not be verified.');
      } else throw new Error('Unsupported mount action.');
      return await run({ path: file, action: 'inspect' });
    } finally { busy.delete(id); }
  });
}
module.exports = { registerVirtualDisks };
