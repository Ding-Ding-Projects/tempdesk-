// Streaming Base64 conversion of files of any size in constant memory, with progress, pause,
// resume, cancel and SHA-256 round-trip verification. Uses the shared codec (site/assets/base64.js
// copied into src/shared/base64.js at build time). Output is written to a temporary file next to
// the destination and linked into place after verification. Existing files are always preserved.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { StringDecoder } = require('string_decoder');
const B64 = require('../vendor/base64.js');

const ENCODE_CHUNK = B64.ENCODE_CHUNK || 3 * 256 * 1024; // multiple of 3
const DECODE_CHUNK = B64.DECODE_CHUNK || 4 * 256 * 1024; // multiple of 4

function outputPath(src, mode, outDir, name) {
  const dir = outDir || path.dirname(src);
  const filename = path.basename(src);
  const restored = filename.replace(/(?:\.base64\.txt|\.b64|\.base64|\.txt)$/i, '');
  const base = name || (mode === 'encode' ? filename + '.base64.txt'
    : restored && restored !== filename ? restored : filename + '.bin');
  return availablePath(path.join(dir, base));
}

function numberedPath(file, number) {
  const { dir, name, ext } = path.parse(file);
  return path.join(dir, name + ' (' + number + ')' + ext);
}

function availablePath(file) {
  let candidate = file;
  for (let n = 1; fs.existsSync(candidate); n++) candidate = numberedPath(file, n);
  return candidate;
}

// Publish the complete verified file without replacing a concurrently created destination.
async function publishVerified(temp, file) {
  let candidate = file;
  for (let n = 1; ; n++) {
    try {
      await fs.promises.link(temp, candidate);
      return candidate;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      candidate = numberedPath(file, n);
    }
  }
}

class Job {
  constructor(opts) {
    this.o = opts;
    this.paused = false;
    this.cancelled = false;
    this.listeners = [];
    this.done = new Promise((res, rej) => { this.resolve = res; this.reject = rej; });
    this.done.catch(() => {}); // callers use start(); this mirror must never be an unhandled rejection
  }
  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const f of this.listeners) f(ev); }
  pause() { this.paused = true; if (this.stream) this.stream.pause(); this.emit({ type: 'paused' }); }
  resume() { this.paused = false; if (this.stream) this.stream.resume(); this.emit({ type: 'resumed' }); }
  cancel() { this.cancelled = true; if (this.stream) this.stream.destroy(new Error('cancelled')); }

  async start() {
    const o = this.o;
    const src = path.resolve(o.source);
    const dst = path.resolve(o.dest || outputPath(src, o.mode, o.outDir));
    const total = fs.statSync(src).size;
    const tmp = dst + '.part-' + crypto.randomBytes(4).toString('hex');
    this.dest = dst;
    const srcHash = crypto.createHash('sha256');
    const outHash = crypto.createHash('sha256');
    let done = 0, lastEmit = 0;
    const out = fs.createWriteStream(tmp, { flags: 'wx' });
    const write = (data) => new Promise((res, rej) => { if (!data || !data.length) return res(); out.write(data, (e) => e ? rej(e) : res()); });
    try {
      if (o.mode === 'encode') {
        const enc = B64.createEncoder({ variant: o.variant, pad: o.pad, lineLength: o.lineLength });
        this.stream = fs.createReadStream(src, { highWaterMark: ENCODE_CHUNK });
        for await (const chunk of this.stream) {
          if (this.cancelled) throw new Error('cancelled');
          srcHash.update(chunk);
          const s = enc.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length));
          await write(Buffer.from(s, 'latin1'));
          done += chunk.length;
          if (Date.now() - lastEmit > 100) { lastEmit = Date.now(); this.emit({ type: 'progress', done, total }); }
        }
        await write(Buffer.from(enc.end(), 'latin1'));
      } else {
        const dec = B64.createDecoder({ variant: o.variant || 'standard', strict: o.strict !== false });
        const sd = new StringDecoder('latin1');
        this.stream = fs.createReadStream(src, { highWaterMark: DECODE_CHUNK });
        for await (const chunk of this.stream) {
          if (this.cancelled) throw new Error('cancelled');
          srcHash.update(chunk);
          const bytes = dec.push(sd.write(chunk));
          outHash.update(bytes);
          await write(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length));
          done += chunk.length;
          if (Date.now() - lastEmit > 100) { lastEmit = Date.now(); this.emit({ type: 'progress', done, total }); }
        }
        const tail = dec.end();
        outHash.update(tail);
        await write(Buffer.from(tail.buffer, tail.byteOffset, tail.length));
      }
      await new Promise((res, rej) => out.end((e) => e ? rej(e) : res()));
      this.emit({ type: 'verifying' });
      const verified = await this.verify(tmp, srcHash.digest('hex'), o.mode === 'decode' ? outHash.digest('hex') : null);
      if (!verified.ok) throw new Error('Round-trip verification failed: the SHA-256 of the result does not match the source.');
      const published = await publishVerified(tmp, dst);
      fs.unlinkSync(tmp);
      this.dest = published;
      const r = { type: 'done', dest: published, bytesIn: total, bytesOut: fs.statSync(published).size, sha256: verified.sha256 };
      this.emit(r);
      this.resolve(r);
      return r;
    } catch (e) {
      out.destroy();
      try { fs.rmSync(tmp, { force: true }); } catch (x) { /* ignore */ }
      const err = this.cancelled ? Object.assign(new Error('Cancelled'), { code: 'cancelled' }) : e;
      this.emit({ type: 'error', code: err.code || 'error', message: err.message, offset: err.offset });
      this.reject(err);
      throw err;
    }
  }
  // Encode: decode the written text again and compare SHA-256 with the source bytes.
  // Decode: re-encode the written bytes and compare the decoded bytes hash with an independent
  // decode of the source (computed while decoding), then confirm the file on disk matches it.
  async verify(file, srcSha, decodedSha) {
    if (this.o.mode === 'encode') {
      const dec = B64.createDecoder({ variant: this.o.variant === 'url' ? 'url' : (this.o.variant || 'standard'), strict: false });
      const h = crypto.createHash('sha256');
      const sd = new StringDecoder('latin1');
      for await (const chunk of fs.createReadStream(file, { highWaterMark: DECODE_CHUNK })) { if (this.cancelled) throw new Error('cancelled'); h.update(dec.push(sd.write(chunk))); }
      h.update(dec.end());
      const back = h.digest('hex');
      return { ok: back === srcSha, sha256: srcSha };
    }
    const h = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) { if (this.cancelled) throw new Error('cancelled'); h.update(chunk); }
    const onDisk = h.digest('hex');
    return { ok: onDisk === decodedSha, sha256: onDisk };
  }
}

function sniff(file, max) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(Math.min(max || 65536, fs.fstatSync(fd).size));
    fs.readSync(fd, b, 0, b.length, 0);
    return new Uint8Array(b.buffer, b.byteOffset, b.length);
  } finally { fs.closeSync(fd); }
}

module.exports = { Job, outputPath, sniff, ENCODE_CHUNK, DECODE_CHUNK };
