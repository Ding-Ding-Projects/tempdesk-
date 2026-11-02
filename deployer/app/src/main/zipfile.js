// Minimal ZIP writer (deflate) and reader for backup bundles, answer file kits and bulk exports.
// The reader enforces limits (entry count, total size, path safety) before returning anything,
// so an import can be fully validated before it is applied.
'use strict';

const zlib = require('zlib');

const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dos(d) { return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() }; }

// files: [{ name, data: Buffer|string }]
function makeZip(files, when) {
  const now = dos(when || new Date());
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data), 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = comp.length < data.length;
    const body = useDeflate ? comp : data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(now.time, 10); local.writeUInt16LE(now.date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    parts.push(local, name, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(0x0800, 8); cd.writeUInt16LE(useDeflate ? 8 : 0, 10);
    cd.writeUInt16LE(now.time, 12); cd.writeUInt16LE(now.date, 14); cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(body.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += 30 + name.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat(parts.concat([cdBuf, end]));
}

function readZip(buf, limits) {
  limits = Object.assign({ maxEntries: 2000, maxTotal: 64 * 1024 * 1024 }, limits || {});
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw Object.assign(new Error('Not a zip file.'), { code: 'zip.format' });
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  if (count > limits.maxEntries) throw Object.assign(new Error('Too many files in the zip.'), { code: 'zip.count' });
  const out = new Map();
  let p = cdOff, total = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw Object.assign(new Error('Damaged zip directory.'), { code: 'zip.format' });
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const crc = buf.readUInt32LE(p + 16);
    const name = buf.slice(p + 46, p + 46 + nlen).toString('utf8');
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (/^[\\/]|^[A-Za-z]:|(^|[\\/])\.\.([\\/]|$)/.test(name) || /[\x00-\x1f]/.test(name)) throw Object.assign(new Error('Unsafe path in zip: ' + name), { code: 'zip.path' });
    total += usize;
    if (total > limits.maxTotal) throw Object.assign(new Error('The zip is too large.'), { code: 'zip.size' });
    const lnlen = buf.readUInt16LE(lho + 26), lxlen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lxlen;
    const raw = buf.slice(start, start + csize);
    let data;
    if (method === 0) data = raw; else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: usize + 1 }); else throw Object.assign(new Error('Unsupported zip compression.'), { code: 'zip.method' });
    if (data.length !== usize || crc32(data) !== crc) throw Object.assign(new Error('Zip entry is damaged: ' + name), { code: 'zip.crc' });
    if (out.has(name)) throw Object.assign(new Error('Duplicate file in zip: ' + name), { code: 'zip.duplicate' });
    out.set(name, data);
  }
  return out;
}

module.exports = { makeZip, readZip, crc32 };
