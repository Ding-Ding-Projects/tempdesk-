// Runs the PowerShell engine (deployer/engine/Invoke-TempDeskDeploy.ps1) as a child process and
// parses its JSON-lines progress protocol. Secrets go into the child's environment only, as
// TEMPDESK_SECRET_<NAME>; they never appear on a command line, in a file or in a log.
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SECRET_NAME = /^[A-Z][A-Z0-9_]{1,40}$/;
const PHASES = new Set(['Media', 'Server', 'Lite', 'Portals', 'Health', 'Trust', 'Uninstall']);

// Splits a stream of chunks into lines and parses each one. Non-JSON lines become log events.
function createLineParser(onEvent) {
  let buf = '';
  function line(l) {
    const s = l.replace(/\r$/, '');
    if (!s.trim()) return;
    let ev = null;
    if (s[0] === '{') { try { ev = JSON.parse(s); } catch (e) { ev = null; } }
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') ev = { type: 'log', level: 'info', text: s };
    if (ev.type === 'step' && (typeof ev.id !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/.test(ev.id))) return;
    onEvent(ev);
  }
  return {
    push(chunk) {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
    },
    end() { if (buf) line(buf); buf = ''; }
  };
}

// Removes every secret value from a text (defence in depth on top of the engine's own redaction).
function redactText(text, secrets) {
  let t = String(text);
  for (const s of secrets) if (s && s.length >= 3) t = t.split(s).join('[redacted]');
  return t;
}

function powershellPath() {
  if (process.platform !== 'win32') return 'pwsh';
  const sys = process.env.SystemRoot || 'C:\\Windows';
  return path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

// Writes the non-secret config to a private temp file for the engine. Returns its path.
function writeConfigFile(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tempdesk-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(config), { mode: 0o600 });
  return file;
}

class EngineRun {
  constructor(opts) {
    if (!PHASES.has(opts.phase)) throw new Error('Unknown phase ' + opts.phase);
    this.opts = opts;
    this.secrets = [];
    this.listeners = [];
    this.result = null;
  }
  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }
  start() {
    const o = this.opts;
    const env = Object.assign({}, process.env);
    for (const k of Object.keys(env)) if (/^TEMPDESK_SECRET_/.test(k)) delete env[k];
    for (const [name, value] of Object.entries(o.secrets || {})) {
      if (!SECRET_NAME.test(name)) throw new Error('Bad secret name');
      if (typeof value !== 'string' || !value) continue;
      env['TEMPDESK_SECRET_' + name] = value;
      this.secrets.push(value);
    }
    this.configFile = writeConfigFile(o.config);
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', o.script, '-Config', this.configFile, '-Phase', o.phase];
    if (o.payloadRoot) args.push('-PayloadRoot', o.payloadRoot);
    if (o.outDir) args.push('-OutDir', o.outDir);
    if (o.reset) args.push('-Reset');
    if (o.noIso) args.push('-NoIso');
    this.child = spawn(o.powershell || powershellPath(), args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const parser = createLineParser((ev) => {
      if (ev.type === 'log') ev.text = redactText(ev.text, this.secrets);
      if (ev.type === 'step' && ev.hint) ev.hint = redactText(ev.hint, this.secrets);
      if (ev.type === 'result') this.result = ev;
      this.emit(ev);
    });
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (d) => parser.push(d));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (d) => this.emit({ type: 'log', level: 'warn', text: redactText(d.trimEnd(), this.secrets) }));
    this.done = new Promise((resolve) => {
      this.child.on('error', (e) => { this.emit({ type: 'log', level: 'error', text: 'Could not start PowerShell: ' + e.message }); resolve({ ok: false, code: -1 }); });
      this.child.on('close', (code, signal) => {
        parser.end();
        try { fs.rmSync(path.dirname(this.configFile), { recursive: true, force: true }); } catch (e) { /* ignore */ }
        this.secrets = [];
        const cancelled = !!this.cancelled;
        const ok = !cancelled && code === 0 && !!(this.result && this.result.ok);
        this.emit({ type: 'exit', code, cancelled, ok });
        resolve({ ok, code, cancelled, result: this.result });
      });
    });
    return this;
  }
  cancel() {
    if (!this.child || this.child.exitCode !== null) return;
    this.cancelled = true;
    if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true });
    else this.child.kill('SIGTERM');
  }
}

// Elevated helper: runs the Trust phase through the normal Windows consent prompt (Verb RunAs).
// Start-Process -Verb RunAs shows UAC; if the user cancels, PowerShell reports error 1223 and the
// step is reported as incomplete. Nothing here bypasses or auto-approves elevation.
function runElevatedTrust(script, address) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, cancelled: false, error: 'Elevation is only available on Windows.' });
    if (!/^[A-Za-z0-9.-]{1,253}$/.test(address)) return resolve({ ok: false, error: 'Bad address' });
    const cfg = writeConfigFile({ name: 'trust-' + crypto.randomBytes(4).toString('hex'), server: { ipAddress: address } });
    const inner = "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\" -Config \"" + cfg + "\" -Phase Trust";
    const outer = "try { $p = Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList '" + inner.replace(/'/g, "''") + "'; exit $p.ExitCode } catch { if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.HResult -eq -2147023673) { exit 1223 } else { exit 2 } }";
    const p = spawn(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', outer], { windowsHide: true });
    p.on('close', (code) => {
      try { fs.rmSync(path.dirname(cfg), { recursive: true, force: true }); } catch (e) { /* ignore */ }
      if (code === 0) resolve({ ok: true });
      else if (code === 1223) resolve({ ok: false, cancelled: true });
      else resolve({ ok: false, error: 'The elevated helper exited with code ' + code + '.' });
    });
    p.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

module.exports = { EngineRun, createLineParser, redactText, powershellPath, runElevatedTrust, PHASES };
