// Workspace history: every state-changing action is one commit, with unlimited undo and redo
// derived from the log (so it survives restarts). Two backends with the same behaviour:
//   git   a real Git repository at %LOCALAPPDATA%\TempDesk\workspace (git.exe spawned, never a shell)
//   jsonl an append-only JSON lines store (workspace\history.jsonl) when git is not available
// Each record carries a machine-readable trailer so undo/redo can be computed from the log:
//   TempDesk-Kind: change|undo|redo|restore|start
//   TempDesk-Back: <id of the state "undo" goes to, or none>
//   TempDesk-Fwd:  <id of the state "redo" goes to, or none>
// Secrets never reach the workspace: every document passes through redact() before it is written,
// and save() refuses documents that still contain values of known secret fields.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const SECRET_KEYS = new Set(['adminPassword', 'dsrmPassword', 'joinPassword', 'password', 'sshPassword', 'pin', 'guestKey', 'adminKey', 'hmacSecret', '@password']);

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      out[k] = SECRET_KEYS.has(k) ? '' : redact(value[k]);
    }
    return out;
  }
  return value;
}
function containsSecret(value) {
  if (Array.isArray(value)) return value.some(containsSecret);
  if (value && typeof value === 'object') {
    return Object.keys(value).some((k) => (SECRET_KEYS.has(k) && typeof value[k] === 'string' && value[k] !== '') || containsSecret(value[k]));
  }
  return false;
}
function stableStringify(v) { return JSON.stringify(v, null, 2) + '\n'; }

function safeRel(rel) {
  const norm = String(rel).replace(/\\/g, '/');
  if (!/^[A-Za-z0-9][A-Za-z0-9._ /-]{0,200}$/.test(norm) || norm.split('/').some((p) => p === '..' || p === '' || p === '.git') || !/\.json$/.test(norm)) {
    throw new Error('Invalid workspace path: ' + rel);
  }
  return norm;
}

function parseTrailers(body) {
  const t = {};
  String(body).split(/\r?\n/).forEach((line) => {
    const m = /^TempDesk-(Kind|Back|Fwd|Field|Target): (.*)$/.exec(line);
    if (m) t[m[1].toLowerCase()] = m[2].trim();
  });
  return t;
}
function norm(id) { return id && id !== 'none' ? id : null; }

// ---------------------------------------------------------------------------------------------
// Backend: git
// ---------------------------------------------------------------------------------------------
function runGit(gitPath, cwd, args, input, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(gitPath, args, { cwd, windowsHide: true, env: Object.assign({}, process.env, { GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }, env || {}) });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => code === 0 ? resolve(out) : reject(Object.assign(new Error('git ' + args[0] + ' failed: ' + err.trim()), { code, stderr: err })));
    if (input !== undefined) p.stdin.end(input); else p.stdin.end();
  });
}

class GitBackend {
  constructor(dir, gitPath) { this.dir = dir; this.git = gitPath; this.kind = 'git'; }
  run(args, input, env) { return runGit(this.git, this.dir, args, input, env); }
  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(path.join(this.dir, '.git'))) {
      await this.run(['init', '-q']);
      await this.run(['config', 'commit.gpgsign', 'false']);
      fs.writeFileSync(path.join(this.dir, '.gitignore'), '# TempDesk workspace: no secrets are stored here.\n*.secret\n.env*\n');
    }
    const name = (await this.run(['config', 'user.name']).catch(() => '')).trim();
    const email = (await this.run(['config', 'user.email']).catch(() => '')).trim();
    this.author = name && email ? null : { GIT_AUTHOR_NAME: 'TempDesk Deployer', GIT_AUTHOR_EMAIL: 'deployer@localhost', GIT_COMMITTER_NAME: 'TempDesk Deployer', GIT_COMMITTER_EMAIL: 'deployer@localhost' };
  }
  async log(limit) {
    let raw;
    try { raw = await this.run(['log', '--format=%H%x1f%ct%x1f%an%x1f%B%x1e', '-n', String(limit || 100000)]); } catch (e) { return []; }
    return raw.split('\x1e').map((s) => s.replace(/^\s+/, '')).filter(Boolean).map((rec) => {
      const [id, t, author, body] = rec.split('\x1f');
      const tr = parseTrailers(body);
      return { id, t: Number(t) * 1000, author, message: body.split(/\r?\n/)[0], kind: tr.kind || 'change', back: norm(tr.back), fwd: norm(tr.fwd), field: tr.field || null };
    });
  }
  async readAll(id) {
    const files = {};
    let list;
    try { list = await this.run(['ls-tree', '-r', '--name-only', id]); } catch (e) { return files; }
    for (const f of list.split('\n').filter((x) => x.endsWith('.json'))) {
      files[f] = JSON.parse(await this.run(['show', id + ':' + f]));
    }
    return files;
  }
  async writeAll(files) {
    const existing = await this.listFiles();
    for (const f of existing) if (!(f in files)) fs.rmSync(path.join(this.dir, f), { force: true });
    for (const [rel, doc] of Object.entries(files)) {
      const abs = path.join(this.dir, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, stableStringify(doc));
    }
  }
  async listFiles() {
    const out = [];
    (function walk(d, base) {
      if (!fs.existsSync(d)) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        const rel = base ? base + '/' + e.name : e.name;
        if (e.isDirectory()) walk(path.join(d, e.name), rel); else if (e.name.endsWith('.json')) out.push(rel);
      }
    })(this.dir, '');
    return out;
  }
  async commit(message) {
    await this.run(['add', '-A']);
    await this.run(['commit', '-q', '--allow-empty', '--no-verify', '-F', '-'], message, this.author || undefined);
    return (await this.run(['rev-parse', 'HEAD'])).trim();
  }
  async diff(a, b, file) {
    const args = ['diff', '--no-color', '--unified=3', a || '4b825dc642cb6eb9a060e54bf8d69288fbee4904', b];
    if (file) args.push('--', file);
    return this.run(args);
  }
  async branches() {
    const cur = (await this.run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    const list = (await this.run(['branch', '--format=%(refname:short)'])).split('\n').map((x) => x.trim()).filter(Boolean);
    return { current: cur, list };
  }
  async switchBranch(name, create) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,60}$/.test(name) || name.includes('..') || name.endsWith('.lock') || name.endsWith('/')) throw new Error('Use letters, numbers, dot, dash, underscore or slash for the branch name.');
    await this.run(create ? ['checkout', '-q', '-b', name] : ['checkout', '-q', name]);
  }
  async setRemote(url) {
    const remotes = (await this.run(['remote'])).split('\n').map((s) => s.trim());
    if (!url) { if (remotes.includes('origin')) await this.run(['remote', 'remove', 'origin']); return; }
    if (!/^(https:\/\/|ssh:\/\/|git@)[^\s]+$/.test(url) || /\/\/[^/]*@/.test(url.replace(/^ssh:\/\/git@/, 'ssh://'))) throw new Error('Use an https:// or ssh URL without a user name or password in it.');
    await this.run(remotes.includes('origin') ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
  }
  async push() {
    const branch = (await this.run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    return this.run(['push', '-u', 'origin', branch]);
  }
}

// ---------------------------------------------------------------------------------------------
// Backend: append-only JSON lines (no git)
// ---------------------------------------------------------------------------------------------
class JsonlBackend {
  constructor(dir) { this.dir = dir; this.file = path.join(dir, 'history.jsonl'); this.kind = 'jsonl'; this.cache = null; }
  async init() { fs.mkdirSync(this.dir, { recursive: true }); }
  load() {
    if (this.cache) return this.cache;
    this.cache = [];
    if (fs.existsSync(this.file)) {
      for (const line of fs.readFileSync(this.file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { this.cache.push(JSON.parse(line)); } catch (e) { /* a torn last line after a crash is skipped */ }
      }
    }
    return this.cache;
  }
  async log(limit) {
    const all = this.load().slice().reverse();
    return all.slice(0, limit || all.length).map((r) => ({ id: r.id, t: r.t, author: r.author, message: r.message.split('\n')[0], kind: r.kind, back: r.back, fwd: r.fwd, field: r.field || null }));
  }
  async readAll(id) { const r = this.load().find((x) => x.id === id); return r ? JSON.parse(JSON.stringify(r.files)) : {}; }
  async writeAll(files) { this.pendingFiles = files; }
  async commit(message) {
    const tr = parseTrailers(message), list = this.load();
    const id = 'h' + String(list.length + 1).padStart(6, '0');
    const rec = { id, t: Date.now(), author: 'TempDesk Deployer', message, kind: tr.kind || 'change', back: norm(tr.back), fwd: norm(tr.fwd), field: tr.field || null, files: this.pendingFiles || {} };
    fs.appendFileSync(this.file, JSON.stringify(rec) + '\n');
    list.push(rec);
    return id;
  }
  async diff(a, b, file) {
    const fa = a ? await this.readAll(a) : {}, fb = await this.readAll(b);
    const names = Array.from(new Set(Object.keys(fa).concat(Object.keys(fb)))).filter((n) => !file || n === file).sort();
    let out = '';
    for (const n of names) {
      const x = n in fa ? stableStringify(fa[n]) : '', y = n in fb ? stableStringify(fb[n]) : '';
      if (x === y) continue;
      out += 'diff --history a/' + n + ' b/' + n + '\n--- a/' + n + '\n+++ b/' + n + '\n' + unifiedLines(x, y);
    }
    return out;
  }
  async branches() { return { current: 'main', list: ['main'], unsupported: true }; }
  async switchBranch() { throw new Error('Branches need Git. Install Git for Windows to use them.'); }
  async setRemote() { throw new Error('Pushing to a remote needs Git. Install Git for Windows to use it.'); }
  async push() { throw new Error('Pushing to a remote needs Git.'); }
}

function unifiedLines(a, b) {
  const x = a ? a.replace(/\n$/, '').split('\n') : [], y = b ? b.replace(/\n$/, '').split('\n') : [];
  const n = x.length, m = y.length, dp = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  let i = 0, j = 0, out = '';
  while (i < n && j < m) {
    if (x[i] === y[j]) { out += ' ' + x[i] + '\n'; i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) out += '-' + x[i++] + '\n'; else out += '+' + y[j++] + '\n';
  }
  while (i < n) out += '-' + x[i++] + '\n';
  while (j < m) out += '+' + y[j++] + '\n';
  return out;
}

// ---------------------------------------------------------------------------------------------
// Workspace: the history engine over either backend
// ---------------------------------------------------------------------------------------------
class Workspace {
  constructor(backend, opts) {
    this.b = backend;
    this.coalesceMs = opts && opts.coalesceMs !== undefined ? opts.coalesceMs : 1000;
    this.setTimer = (opts && opts.setTimer) || setTimeout;
    this.clearTimer = (opts && opts.clearTimer) || clearTimeout;
    this.files = {};
    this.pending = null;
    this.queue = Promise.resolve();
  }
  get kind() { return this.b.kind; }
  async open() {
    await this.b.init();
    const head = (await this.b.log(1))[0];
    if (!head) {
      await this.b.writeAll({});
      await this.b.commit(this.message('Start workspace history', 'start', null, null));
      this.files = {};
    } else {
      this.files = await this.b.readAll(head.id);
    }
    return this;
  }
  message(title, kind, back, fwd, extra) {
    let m = String(title).replace(/[\r\n]+/g, ' ').slice(0, 200) + '\n\nTempDesk-Kind: ' + kind + '\nTempDesk-Back: ' + (back || 'none') + '\nTempDesk-Fwd: ' + (fwd || 'none') + '\n';
    if (extra && extra.field) m += 'TempDesk-Field: ' + String(extra.field).replace(/[\r\n]/g, '') + '\n';
    if (extra && extra.target) m += 'TempDesk-Target: ' + extra.target + '\n';
    return m;
  }
  serial(fn) { const p = this.queue.then(fn); this.queue = p.catch(() => {}); return p; }
  async head() { return (await this.b.log(1))[0]; }
  snapshot() { return JSON.parse(JSON.stringify(this.files)); }
  get(rel) { const f = this.files[safeRel(rel)]; return f === undefined ? undefined : JSON.parse(JSON.stringify(f)); }

  // Records one action. Typing passes a coalesceKey: changes to the same key merge into one commit
  // that is written after coalesceMs idle, on flush() (blur) or when another action arrives.
  save(rel, doc, title, coalesceKey) {
    rel = safeRel(rel);
    const clean = doc === null ? null : redact(doc);
    if (clean !== null && containsSecret(clean)) throw new Error('Refusing to store a secret in the workspace history.');
    if (coalesceKey && this.coalesceMs > 0) {
      if (this.pending && this.pending.key !== coalesceKey) this.flush();
      this.pending = { key: coalesceKey, rel, doc: clean, title };
      if (this.timer) this.clearTimer(this.timer);
      this.timer = this.setTimer(() => { this.flush(); }, this.coalesceMs);
      this.applyLocal(rel, clean);
      return Promise.resolve(null);
    }
    this.flush();
    this.applyLocal(rel, clean);
    const files = this.snapshot();
    return this.serial(async () => this.commitState(files, title, 'change', null, null));
  }
  applyLocal(rel, doc) { if (doc === null) delete this.files[rel]; else this.files[rel] = JSON.parse(JSON.stringify(doc)); }
  flush() {
    if (this.timer) { this.clearTimer(this.timer); this.timer = null; }
    const p = this.pending;
    this.pending = null;
    if (!p) return Promise.resolve(null);
    const files = this.snapshot();
    return this.serial(async () => {
      const head = await this.head();
      const prev = head ? await this.b.readAll(head.id) : {};
      if (JSON.stringify(prev) === JSON.stringify(files)) return null;
      return this.commitState(files, p.title, 'change', null, null, { field: p.key });
    });
  }
  async commitState(files, title, kind, back, fwd, extra) {
    const head = await this.head();
    if (kind === 'change') { back = head ? head.id : null; fwd = null; }
    await this.b.writeAll(files);
    const id = await this.b.commit(this.message(title, kind, back, fwd, extra));
    this.files = JSON.parse(JSON.stringify(files));
    return { id, kind, title };
  }
  async canUndo() { await this.queue; const h = await this.head(); return !!(this.pending || (h && h.back)); }
  async canRedo() { await this.queue; const h = await this.head(); return !this.pending && !!(h && h.fwd); }
  async byId(id) { return (await this.b.log()).find((e) => e.id === id) || null; }
  // Undo: restore the state the head says to go back to, recorded as a new commit.
  async undo() {
    await this.flush();
    return this.serial(async () => {
      const cur = await this.head();
      if (!cur || !cur.back) return null;
      const target = await this.byId(cur.back);
      const files = await this.b.readAll(target.id);
      const label = cur.kind === 'change' ? cur.message : cur.message.replace(/^(Undo|Redo): /, '');
      return this.commitState(files, 'Undo: ' + label, 'undo', target.back, cur.id);
    });
  }
  async redo() {
    await this.flush();
    return this.serial(async () => {
      const cur = await this.head();
      if (!cur || !cur.fwd) return null;
      const f = await this.byId(cur.fwd);
      const files = await this.b.readAll(f.id);
      return this.commitState(files, 'Redo: ' + f.message.replace(/^(Undo|Redo): /, ''), 'redo', f.back, f.fwd);
    });
  }
  // Jump to any earlier state, as a new "Restore to <time>" commit (itself undoable).
  async restore(id, when) {
    await this.flush();
    return this.serial(async () => {
      const x = await this.byId(id);
      if (!x) throw new Error('Unknown history entry.');
      const files = await this.b.readAll(x.id);
      const head = await this.head();
      return this.commitState(files, 'Restore to ' + (when || new Date(x.t).toISOString()), 'restore', head.id, null, { target: x.id });
    });
  }
  async log(limit) { await this.queue; return this.b.log(limit); }
  async diff(a, b, file) { await this.queue; return this.b.diff(a, b, file); }
  async filesAt(id) { await this.queue; return this.b.readAll(id); }
  async branches() { await this.flush(); await this.queue; return this.b.branches(); }
  // Switching branch replaces the working state with that branch's head (one variant per branch).
  async switchBranch(name, create) {
    await this.flush();
    return this.serial(async () => {
      await this.b.switchBranch(name, create);
      const head = (await this.b.log(1))[0];
      this.files = head ? await this.b.readAll(head.id) : {};
      return { branch: name };
    });
  }
  setRemote(url) { return this.b.setRemote(url); }
  push() { return this.b.push(); }
  settle() { return this.queue; }
}

async function findGit(candidates) {
  const list = candidates || (process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'cmd', 'git.exe'), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Git', 'cmd', 'git.exe'), 'git.exe']
    : ['git']);
  for (const g of list) {
    try { const v = await runGit(g, process.cwd(), ['--version']); if (/git version/.test(v)) return { path: g, version: v.trim() }; } catch (e) { /* next */ }
  }
  return null;
}

async function openWorkspace(dir, opts) {
  opts = opts || {};
  const git = opts.forceJsonl ? null : (opts.git !== undefined ? opts.git : await findGit());
  const backend = git ? new GitBackend(dir, git.path || git) : new JsonlBackend(dir);
  const ws = new Workspace(backend, opts);
  try { await ws.open(); } catch (e) {
    if (!git) throw e;
    const fb = new Workspace(new JsonlBackend(dir), opts);
    await fb.open();
    fb.gitError = e.message;
    return fb;
  }
  return ws;
}

module.exports = { openWorkspace, Workspace, GitBackend, JsonlBackend, findGit, redact, containsSecret, safeRel, parseTrailers, unifiedLines };
