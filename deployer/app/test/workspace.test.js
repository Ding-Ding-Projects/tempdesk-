'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openWorkspace, findGit, redact, containsSecret, safeRel } = require('../src/main/workspace.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'td-ws-')); }

// Manual timers so coalescing is deterministic.
function fakeTimers() {
  const t = { list: [], set(fn, ms) { const h = { fn, ms }; t.list.push(h); return h; }, clear(h) { t.list = t.list.filter((x) => x !== h); }, fire() { const l = t.list; t.list = []; l.forEach((h) => h.fn()); } };
  return t;
}

async function backends() {
  const out = [{ name: 'jsonl', opts: { forceJsonl: true } }];
  const git = await findGit(['git']);
  if (git) out.push({ name: 'git', opts: { git } });
  return out;
}

test('redact removes secrets and containsSecret detects them', () => {
  const doc = { server: { adminPassword: 'Secret-1', computerName: 'DC01', accounts: [{ name: 'a', password: 'p' }] } };
  const r = redact(doc);
  assert.strictEqual(r.server.adminPassword, '');
  assert.strictEqual(r.server.accounts[0].password, '');
  assert.strictEqual(r.server.computerName, 'DC01');
  assert.ok(containsSecret(doc));
  assert.ok(!containsSecret(r));
  assert.throws(() => safeRel('../x.json'));
  assert.throws(() => safeRel('a/.git/config.json'));
  assert.throws(() => safeRel('a.txt'));
  assert.strictEqual(safeRel('answers\\lab.json'), 'answers/lab.json');
});

test('workspace history on every backend', async (t) => {
  for (const b of await backends()) {
    await t.test(b.name + ': each action is one commit, undo and redo are new commits', async () => {
      const dir = tmp();
      const ws = await openWorkspace(dir, b.opts);
      assert.strictEqual(ws.kind, b.name);
      await ws.save('settings.json', { theme: 'dark' }, 'Set theme to dark');
      await ws.save('settings.json', { theme: 'light' }, 'Set theme to light');
      let log = await ws.log();
      assert.deepStrictEqual(log.map((e) => e.message), ['Set theme to light', 'Set theme to dark', 'Start workspace history']);
      const u = await ws.undo();
      assert.strictEqual(u.title, 'Undo: Set theme to light');
      assert.deepStrictEqual(ws.get('settings.json'), { theme: 'dark' });
      await ws.undo();
      assert.strictEqual(ws.get('settings.json'), undefined);
      assert.strictEqual(await ws.canUndo(), false);
      await ws.redo();
      assert.deepStrictEqual(ws.get('settings.json'), { theme: 'dark' });
      log = await ws.log();
      assert.strictEqual(log.length, 6, 'nothing is ever lost: undo and redo are commits');
      assert.strictEqual(log[0].kind, 'redo');
    });

    await t.test(b.name + ': undo and redo survive a restart', async () => {
      const dir = tmp();
      let ws = await openWorkspace(dir, b.opts);
      await ws.save('a.json', { v: 1 }, 'Set v to 1');
      await ws.save('a.json', { v: 2 }, 'Set v to 2');
      await ws.save('a.json', { v: 3 }, 'Set v to 3');
      await ws.undo();
      await ws.settle();
      ws = await openWorkspace(dir, b.opts); // "restart"
      assert.deepStrictEqual(ws.get('a.json'), { v: 2 });
      assert.strictEqual(await ws.canRedo(), true);
      await ws.redo();
      assert.deepStrictEqual(ws.get('a.json'), { v: 3 });
      await ws.undo(); await ws.undo(); await ws.undo();
      assert.strictEqual(ws.get('a.json'), undefined);
      ws = await openWorkspace(dir, b.opts);
      await ws.redo(); await ws.redo();
      assert.deepStrictEqual(ws.get('a.json'), { v: 2 });
      // A new change after undo discards the redo branch (but keeps it in the log).
      await ws.save('a.json', { v: 9 }, 'Set v to 9');
      assert.strictEqual(await ws.canRedo(), false);
      await ws.undo();
      assert.deepStrictEqual(ws.get('a.json'), { v: 2 });
    });

    await t.test(b.name + ': typing coalesces into one commit per field', async () => {
      const dir = tmp();
      const timers = fakeTimers();
      const ws = await openWorkspace(dir, Object.assign({ setTimer: timers.set, clearTimer: timers.clear, coalesceMs: 1000 }, b.opts));
      ws.save('answer.json', { computerName: 'D' }, 'Set computer name to D', 'server.computerName');
      ws.save('answer.json', { computerName: 'DC' }, 'Set computer name to DC', 'server.computerName');
      ws.save('answer.json', { computerName: 'DC01' }, 'Set computer name to DC01', 'server.computerName');
      assert.strictEqual((await ws.log()).length, 1, 'nothing committed while typing');
      timers.fire(); // 1 s idle
      await ws.settle();
      let log = await ws.log();
      assert.strictEqual(log.length, 2);
      assert.strictEqual(log[0].message, 'Set computer name to DC01');
      assert.strictEqual(log[0].field, 'server.computerName');
      // Switching to another field flushes the first one (blur).
      ws.save('answer.json', { computerName: 'DC01', domainName: 'l' }, 'Set domain to l', 'server.domainName');
      ws.save('answer.json', { computerName: 'DC02', domainName: 'l' }, 'Set computer name to DC02', 'server.computerName');
      await ws.flush();
      log = await ws.log();
      assert.deepStrictEqual(log.slice(0, 2).map((e) => e.message), ['Set computer name to DC02', 'Set domain to l']);
      await ws.undo();
      assert.deepStrictEqual(ws.get('answer.json'), { computerName: 'DC01', domainName: 'l' });
    });

    await t.test(b.name + ': jump to any commit is a new restore commit with a diff', async () => {
      const dir = tmp();
      const ws = await openWorkspace(dir, b.opts);
      const c1 = await ws.save('p.json', { n: 'one' }, 'Set n to one');
      await ws.save('p.json', { n: 'two' }, 'Set n to two');
      await ws.save('q.json', { x: true }, 'Add q');
      const r = await ws.restore(c1.id, '10:00');
      assert.strictEqual(r.title, 'Restore to 10:00');
      assert.deepStrictEqual(ws.snapshot(), { 'p.json': { n: 'one' } });
      const log = await ws.log();
      assert.strictEqual(log[0].kind, 'restore');
      assert.strictEqual(log.length, 5);
      const d = await ws.diff(log[1].id, log[0].id);
      assert.match(d, /-\s+"n": "two"/);
      assert.match(d, /\+\s+"n": "one"/);
      await ws.undo();
      assert.deepStrictEqual(ws.get('q.json'), { x: true });
    });

    await t.test(b.name + ': secrets never reach the history', async () => {
      const dir = tmp();
      const ws = await openWorkspace(dir, b.opts);
      await ws.save('answers/lab.json', { server: { adminPassword: 'Example-Pass-123', dsrmPassword: 'Example-Dsrm-456', computerName: 'DC01' }, custom: { accounts: [{ name: 'x', password: 'Acct-Pass-222' }] } }, 'Save lab');
      await ws.settle();
      const all = [];
      (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else all.push(p); } })(dir);
      let blob = all.map((p) => fs.readFileSync(p).toString('latin1')).join('\n');
      if (b.name === 'git') {
        const { execFileSync } = require('child_process');
        blob += execFileSync('git', ['log', '-p', '--all'], { cwd: dir }).toString();
      }
      for (const s of ['Example-Pass-123', 'Example-Dsrm-456', 'Acct-Pass-222']) assert.ok(!blob.includes(s), s + ' must not be stored');
      assert.ok(blob.includes('DC01') || b.name === 'git');
    });
  }
});

test('git backend uses the TempDesk author when no git identity is configured', async (t) => {
  const git = await findGit(['git']);
  if (!git) return t.skip('git not installed');
  const dir = tmp();
  const home = tmp();
  const env = { HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1' };
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    const ws = await openWorkspace(dir, { git });
    await ws.save('s.json', { a: 1 }, 'Set a to 1');
    const log = await ws.log();
    assert.strictEqual(log[0].author, 'TempDesk Deployer');
  } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
});
