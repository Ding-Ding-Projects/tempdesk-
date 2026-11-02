// Background update check through Squirrel.Windows' Update.exe, only when the app was installed
// by Setup.exe (Update.exe sits one folder above the app). The feed is the GitHub releases
// "latest/download" folder, which serves RELEASES and the .nupkg files. Packages are NOT signed
// (owner decision), and the banner says so. A restart is never forced.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FEED = 'https://github.com/Ding-Ding-Projects/tempdesk-/releases/latest/download';

function updateExePath(execPath) {
  const p = path.resolve(path.dirname(execPath || process.execPath), '..', 'Update.exe');
  return fs.existsSync(p) ? p : null;
}
function run(exe, args) {
  return new Promise((resolve) => {
    let out = '', err = '';
    const p = spawn(exe, args, { windowsHide: true, detached: false });
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve({ code: -1, out, err: e.message }));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}
// Update.exe --checkForUpdate prints progress numbers and a final JSON line.
function parseCheck(out) {
  const lines = String(out).split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  if (!lines.length) return null;
  try {
    const j = JSON.parse(lines[lines.length - 1]);
    const rel = (j.releasesToApply || []).map((r) => r.version || r.Version).filter(Boolean);
    return { current: j.currentVersion || null, future: j.futureVersion || (rel.length ? rel[rel.length - 1] : null), releases: rel };
  } catch (e) { return null; }
}

class Updater {
  constructor(opts) { this.opts = opts || {}; this.state = { state: 'idle' }; this.listeners = []; }
  on(fn) { this.listeners.push(fn); }
  set(s) { this.state = s; for (const f of this.listeners) f(s); }
  available() { return process.platform === 'win32' && !!updateExePath(this.opts.execPath); }
  async check() {
    const exe = updateExePath(this.opts.execPath);
    if (!exe) { this.set({ state: 'unavailable', reason: 'notInstalled' }); return this.state; }
    this.set({ state: 'checking' });
    const c = await run(exe, ['--checkForUpdate=' + FEED]);
    const info = parseCheck(c.out);
    if (c.code !== 0 || !info) { this.set({ state: 'error', message: (c.err || 'Update check failed').slice(0, 300) }); return this.state; }
    if (!info.future || info.future === info.current || !info.releases.length) { this.set({ state: 'current', version: info.current }); return this.state; }
    this.set({ state: 'downloading', version: info.future });
    const d = await run(exe, ['--download=' + FEED]);
    if (d.code !== 0) { this.set({ state: 'error', message: (d.err || 'Download failed').slice(0, 300) }); return this.state; }
    const u = await run(exe, ['--update=' + FEED]);
    if (u.code !== 0) { this.set({ state: 'error', message: (u.err || 'Update failed').slice(0, 300) }); return this.state; }
    this.set({ state: 'ready', version: info.future, unsigned: true });
    return this.state;
  }
  // Starts the new version and quits this one, only when the user chooses to.
  restart(exeName) {
    const exe = updateExePath(this.opts.execPath);
    if (!exe) return false;
    spawn(exe, ['--processStartAndWait', exeName || path.basename(process.execPath)], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
}

module.exports = { Updater, parseCheck, updateExePath, FEED };
