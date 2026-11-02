'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Job } = require('../src/main/base64files.js');
const B = require('../src/vendor/base64.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'td-b64-')); }

test('streams a multi-chunk file through encode and decode with SHA-256 round trip', async () => {
  const dir = tmp();
  const src = path.join(dir, 'data.bin');
  // Not a multiple of the 3-byte or chunk size, to cover carries between chunks.
  const data = crypto.randomBytes(3 * 1024 * 1024 + 7);
  fs.writeFileSync(src, data);
  const events = [];
  const enc = new Job({ source: src, mode: 'encode', variant: 'standard', lineLength: 76 });
  enc.on((e) => events.push(e.type));
  const r1 = await enc.start();
  assert.strictEqual(r1.dest, src + '.b64');
  const text = fs.readFileSync(r1.dest, 'latin1');
  assert.strictEqual(text, B.encode(new Uint8Array(data), { lineLength: 76 }));
  assert.ok(events.includes('verifying') && events.includes('done'));
  const dec = new Job({ source: r1.dest, mode: 'decode', variant: 'mime', strict: true, dest: path.join(dir, 'back.bin') });
  const r2 = await dec.start();
  assert.ok(fs.readFileSync(r2.dest).equals(data));
  assert.strictEqual(r2.sha256, crypto.createHash('sha256').update(data).digest('hex'));
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.includes('.part-')), [], 'no partial files are left behind');
});

test('never overwrites the source, refuses to replace an existing file unless confirmed', async () => {
  const dir = tmp();
  const src = path.join(dir, 'a.txt');
  fs.writeFileSync(src, 'hello');
  await assert.rejects(new Job({ source: src, mode: 'encode', dest: src }).start(), /overwrite the source/);
  fs.writeFileSync(src + '.b64', 'old');
  await assert.rejects(new Job({ source: src, mode: 'encode' }).start(), /already exists/);
  await new Job({ source: src, mode: 'encode', overwrite: true }).start();
  assert.strictEqual(fs.readFileSync(src + '.b64', 'latin1'), 'aGVsbG8=');
});

test('strict decoding reports the exact offset and leaves no output', async () => {
  const dir = tmp();
  const src = path.join(dir, 'bad.b64');
  fs.writeFileSync(src, 'aGVs*G8=');
  const job = new Job({ source: src, mode: 'decode', strict: true, dest: path.join(dir, 'out.bin') });
  const errs = [];
  job.on((e) => { if (e.type === 'error') errs.push(e); });
  await assert.rejects(job.start());
  assert.strictEqual(errs[0].code, 'char');
  assert.strictEqual(errs[0].offset, 4);
  assert.ok(!fs.existsSync(path.join(dir, 'out.bin')));
});

test('cancel stops the job and removes the temporary file', async () => {
  const dir = tmp();
  const src = path.join(dir, 'big.bin');
  fs.writeFileSync(src, crypto.randomBytes(8 * 1024 * 1024));
  const job = new Job({ source: src, mode: 'encode' });
  job.on((e) => { if (e.type === 'progress') job.cancel(); });
  await assert.rejects(job.start(), /Cancelled/);
  assert.deepStrictEqual(fs.readdirSync(dir), ['big.bin']);
});
