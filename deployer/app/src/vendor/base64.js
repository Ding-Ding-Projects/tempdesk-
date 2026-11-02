// TempDesk Base64 toolkit codec. Pure functions, no DOM and no network.
// Browser: window.TempDeskBase64. Node: module.exports.
(function (root) {
  'use strict';

  var STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function alphabet(variant) { return variant === 'url' ? URL : STD; }
  function revTable(chars) { var t = new Int16Array(128).fill(-1); for (var i = 0; i < 64; i++) t[chars.charCodeAt(i)] = i; return t; }
  var REV = { std: revTable(STD), url: revTable(URL) };

  // opts: { variant: 'standard'|'url'|'mime', pad: bool (default true; url default false), lineLength: n (0 = none), eol: '\r\n' }
  function normEncodeOpts(o) {
    o = o || {};
    var variant = o.variant || 'standard';
    var pad = o.pad !== undefined ? !!o.pad : variant !== 'url';
    var lineLength = o.lineLength !== undefined ? Math.max(0, parseInt(o.lineLength, 10) || 0) : (variant === 'mime' ? 76 : 0);
    if (lineLength % 4 && variant === 'mime' && o.lineLength === undefined) lineLength = 76;
    return { variant: variant, pad: pad, lineLength: lineLength, eol: o.eol !== undefined ? o.eol : '\r\n' };
  }

  function encodeRaw(bytes, chars, pad, final) {
    var out = '', i = 0, n = bytes.length, full = n - (n % 3);
    for (; i < full; i += 3) {
      var v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += chars[v >> 18] + chars[(v >> 12) & 63] + chars[(v >> 6) & 63] + chars[v & 63];
    }
    if (final && n - full === 1) {
      var a = bytes[full] << 16;
      out += chars[a >> 18] + chars[(a >> 12) & 63] + (pad ? '==' : '');
    } else if (final && n - full === 2) {
      var b = (bytes[full] << 16) | (bytes[full + 1] << 8);
      out += chars[b >> 18] + chars[(b >> 12) & 63] + chars[(b >> 6) & 63] + (pad ? '=' : '');
    }
    return out;
  }

  // Streaming encoder: push(Uint8Array) -> string, end() -> string. Keeps <= 2 bytes and the column.
  function createEncoder(opts) {
    var o = normEncodeOpts(opts), chars = alphabet(o.variant), carry = new Uint8Array(0), col = 0, total = 0;
    function wrap(s) {
      if (!o.lineLength || !s) return s;
      var out = '';
      for (var i = 0; i < s.length;) {
        if (col === o.lineLength) { out += o.eol; col = 0; }
        var take = Math.min(o.lineLength - col, s.length - i);
        out += s.substr(i, take); i += take; col += take;
      }
      return out;
    }
    return {
      push: function (chunk) {
        var data;
        if (carry.length) { data = new Uint8Array(carry.length + chunk.length); data.set(carry); data.set(chunk, carry.length); }
        else data = chunk;
        var usable = data.length - (data.length % 3);
        carry = data.slice(usable);
        total += chunk.length;
        return wrap(encodeRaw(data.subarray(0, usable), chars, o.pad, false));
      },
      end: function () { var s = wrap(encodeRaw(carry, chars, o.pad, true)); carry = new Uint8Array(0); return s; },
      get bytesIn() { return total; }
    };
  }
  function encode(bytes, opts) { var e = createEncoder(opts); return e.push(bytes) + e.end(); }

  function decodeError(code, offset, ch) {
    var e = new Error(code === 'char' ? 'Invalid character ' + JSON.stringify(ch) + ' at offset ' + offset
      : code === 'padding' ? 'Invalid padding at offset ' + offset
      : code === 'length' ? 'Input length is not valid Base64 (a final group of 1 character at offset ' + offset + ')'
      : code === 'afterPad' ? 'Data after padding at offset ' + offset
      : code === 'bits' ? 'Non-zero unused bits in the final group at offset ' + offset
      : 'Decode error at offset ' + offset);
    e.code = code; e.offset = offset; e.char = ch;
    return e;
  }

  // Streaming decoder. opts: { variant: 'standard'|'url'|'mime'|'auto', strict: bool }
  // strict: only the variant's alphabet; '=' padding required on the final group (unless variant url,
  //   where padding is optional but must be correct if present); mime also allows CR LF.
  // lenient: ignores ASCII whitespace, accepts both alphabets, accepts missing padding.
  function createDecoder(opts) {
    opts = opts || {};
    var variant = opts.variant || 'standard', strict = opts.strict !== false;
    var rev = variant === 'url' ? REV.url : REV.std;
    var quad = [0, 0, 0, 0], qn = 0, offset = 0, padSeen = 0, padStart = -1, done = false, lastGroupStart = 0;
    var out = [], outLen = 0;
    function lookup(c) {
      if (c >= 128) return -1;
      var v = rev[c];
      if (v < 0 && !strict) v = (variant === 'url' ? REV.std : REV.url)[c];
      return v;
    }
    function flushQuad(buf, pos) {
      buf[pos] = (quad[0] << 2) | (quad[1] >> 4);
      buf[pos + 1] = ((quad[1] & 15) << 4) | (quad[2] >> 2);
      buf[pos + 2] = ((quad[2] & 3) << 6) | quad[3];
    }
    function push(text) {
      var s = String(text), buf = new Uint8Array(Math.ceil((s.length + 4) / 4) * 3), pos = 0;
      for (var i = 0; i < s.length; i++, offset++) {
        var c = s.charCodeAt(i), ch = s[i];
        if (c === 61) { // '='
          if (qn < 2) throw decodeError('padding', offset);
          if (padSeen === 0) padStart = offset;
          padSeen++;
          if (qn + padSeen > 4) throw decodeError('padding', offset);
          if (qn + padSeen === 4) done = true;
          continue;
        }
        var ws = c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
        if (ws) {
          if (strict && !(variant === 'mime' && (c === 10 || c === 13))) throw decodeError('char', offset, ch);
          continue;
        }
        if (padSeen) throw decodeError('afterPad', offset);
        var v = lookup(c);
        if (v < 0) throw decodeError('char', offset, ch);
        if (qn === 0) lastGroupStart = offset;
        quad[qn++] = v;
        if (qn === 4) { flushQuad(buf, pos); pos += 3; qn = 0; }
      }
      var chunk = buf.subarray(0, pos);
      outLen += chunk.length;
      return chunk;
    }
    function end() {
      var buf = new Uint8Array(2), n = 0;
      if (padSeen && !done) {
        if (strict) throw decodeError('padding', padStart);
      }
      if (qn === 1) throw decodeError('length', lastGroupStart);
      if (qn === 2 || qn === 3) {
        if (strict && variant !== 'url' && !padSeen) throw decodeError('padding', offset);
        if (strict && variant === 'url' && padSeen && !done) throw decodeError('padding', padStart);
        if (qn === 2) {
          if (strict && (quad[1] & 15)) throw decodeError('bits', lastGroupStart + 1);
          buf[0] = (quad[0] << 2) | (quad[1] >> 4); n = 1;
        } else {
          if (strict && (quad[2] & 3)) throw decodeError('bits', lastGroupStart + 2);
          buf[0] = (quad[0] << 2) | (quad[1] >> 4); buf[1] = ((quad[1] & 15) << 4) | (quad[2] >> 2); n = 2;
        }
      } else if (padSeen) {
        throw decodeError('padding', padStart);
      }
      qn = 0;
      outLen += n;
      return buf.subarray(0, n);
    }
    return { push: push, end: end, get bytesOut() { return outLen; } };
  }
  function concat(parts) {
    var len = 0; parts.forEach(function (p) { len += p.length; });
    var out = new Uint8Array(len), at = 0;
    parts.forEach(function (p) { out.set(p, at); at += p.length; });
    return out;
  }
  function decode(text, opts) { var d = createDecoder(opts); return concat([d.push(text), d.end()]); }

  // Text encodings
  function textToBytes(text, enc) {
    text = String(text);
    if (enc === 'utf-16le' || enc === 'utf-16be') {
      var b = new Uint8Array(text.length * 2);
      for (var i = 0; i < text.length; i++) {
        var c = text.charCodeAt(i);
        if (enc === 'utf-16le') { b[i * 2] = c & 255; b[i * 2 + 1] = c >> 8; } else { b[i * 2] = c >> 8; b[i * 2 + 1] = c & 255; }
      }
      return b;
    }
    if (enc === 'latin1') {
      var l = new Uint8Array(text.length);
      for (var j = 0; j < text.length; j++) {
        var cc = text.charCodeAt(j);
        if (cc > 255) { var e = new Error('Character at offset ' + j + ' cannot be written in Latin-1'); e.code = 'latin1'; e.offset = j; throw e; }
        l[j] = cc;
      }
      return l;
    }
    return new TextEncoder().encode(text);
  }
  function bytesToText(bytes, enc, fatal) {
    if (enc === 'utf-16le' || enc === 'utf-16be') {
      if (bytes.length % 2 && fatal) { var e = new Error('Odd number of bytes for UTF-16'); e.code = 'utf16'; throw e; }
      var s = '';
      for (var i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(enc === 'utf-16le' ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
      return s;
    }
    if (enc === 'latin1') { var t = ''; for (var j = 0; j < bytes.length; j++) t += String.fromCharCode(bytes[j]); return t; }
    return new TextDecoder('utf-8', { fatal: !!fatal }).decode(bytes);
  }

  // Type detection by magic bytes
  function startsWith(b, sig, at) { at = at || 0; for (var i = 0; i < sig.length; i++) if (b[at + i] !== sig[i]) return false; return b.length >= at + sig.length; }
  function ascii(b, at, len) { var s = ''; for (var i = at; i < at + len && i < b.length; i++) s += String.fromCharCode(b[i]); return s; }
  function detectType(b) {
    if (!b || !b.length) return { mime: 'application/octet-stream', ext: 'bin', kind: 'binary' };
    if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png', kind: 'image' };
    if (startsWith(b, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
    if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { mime: 'image/gif', ext: 'gif', kind: 'image' };
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { mime: 'image/webp', ext: 'webp', kind: 'image' };
    if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return { mime: 'audio/wav', ext: 'wav', kind: 'audio' };
    if (ascii(b, 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf', kind: 'binary' };
    if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06])) return { mime: 'application/zip', ext: 'zip', kind: 'binary' };
    if (startsWith(b, [0x1f, 0x8b])) return { mime: 'application/gzip', ext: 'gz', kind: 'binary' };
    if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && b.length > 2)) return { mime: 'audio/mpeg', ext: 'mp3', kind: 'audio' };
    if (ascii(b, 4, 4) === 'ftyp') return { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
    if (ascii(b, 0, 4) === 'OggS') return { mime: 'audio/ogg', ext: 'ogg', kind: 'audio' };
    var text = null;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, Math.min(b.length, 65536))); } catch (e) {
      // a multi-byte sequence may be cut at 64 KiB; retry trimming up to 3 bytes
      for (var cut = 1; cut <= 3 && text === null; cut++) {
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, Math.max(0, Math.min(b.length, 65536) - cut))); } catch (e2) { text = null; }
      }
    }
    if (text !== null && !/[\x00-\x08\x0e-\x1f]/.test(text)) {
      var t = text.replace(/^﻿/, '').trim();
      if (/^[{[]/.test(t)) { try { JSON.parse(bytesToText(b, 'utf-8')); return { mime: 'application/json', ext: 'json', kind: 'text' }; } catch (e3) { /* not json */ } }
      if (/^<(\?xml|[A-Za-z])/.test(t) && !/^<!doctype html|^<html/i.test(t)) return { mime: 'application/xml', ext: 'xml', kind: 'text' };
      return { mime: 'text/plain', ext: 'txt', kind: 'text' };
    }
    return { mime: 'application/octet-stream', ext: 'bin', kind: 'binary' };
  }
  function suggestName(base, type) {
    var b = String(base || 'decoded').replace(/\.(b64|base64|txt)$/i, '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'decoded';
    if (new RegExp('\\.' + type.ext + '$', 'i').test(b)) return b;
    return b + '.' + type.ext;
  }

  // data: URLs (RFC 2397)
  function buildDataUrl(bytes, mime, params) {
    var m = mime || 'application/octet-stream', p = '';
    Object.keys(params || {}).forEach(function (k) { p += ';' + k + '=' + params[k]; });
    return 'data:' + m + p + ';base64,' + encode(bytes, { variant: 'standard', pad: true });
  }
  function parseDataUrl(url, opts) {
    var s = String(url).trim();
    if (!/^data:/i.test(s)) { var e = new Error('Not a data: URL'); e.code = 'notData'; throw e; }
    var comma = s.indexOf(',');
    if (comma < 0) { var e2 = new Error('A data: URL needs a comma before the data'); e2.code = 'noComma'; throw e2; }
    var meta = s.slice(5, comma), data = s.slice(comma + 1);
    var parts = meta.split(';'), isB64 = false, mime = parts[0].trim().toLowerCase() || 'text/plain', params = {};
    if (!parts[0].trim()) params.charset = 'US-ASCII';
    for (var i = 1; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.toLowerCase() === 'base64' && i === parts.length - 1) { isB64 = true; continue; }
      var eq = p.indexOf('=');
      if (eq > 0) params[p.slice(0, eq).trim().toLowerCase()] = decodeURIComponentSafe(p.slice(eq + 1).trim());
    }
    var bytes;
    if (isB64) bytes = decode(decodeURIComponentSafe(data), { variant: 'standard', strict: !!(opts && opts.strict) });
    else bytes = percentDecodeBytes(data);
    return { mime: mime, params: params, base64: isB64, bytes: bytes };
  }
  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
  function percentDecodeBytes(s) {
    var out = [];
    for (var i = 0; i < s.length; i++) {
      if (s[i] === '%' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else { var enc = new TextEncoder().encode(s[i]); for (var j = 0; j < enc.length; j++) out.push(enc[j]); }
    }
    return new Uint8Array(out);
  }

  function hexDump(bytes, max) {
    max = Math.min(bytes.length, max || 4096);
    var lines = [];
    for (var i = 0; i < max; i += 16) {
      var hex = '', asc = '';
      for (var j = 0; j < 16; j++) {
        if (i + j < max) { var b = bytes[i + j]; hex += (b < 16 ? '0' : '') + b.toString(16) + ' '; asc += b >= 32 && b < 127 ? String.fromCharCode(b) : '.'; }
        else hex += '   ';
        if (j === 7) hex += ' ';
      }
      lines.push(('00000000' + i.toString(16)).slice(-8) + '  ' + hex + ' ' + asc);
    }
    return lines.join('\n');
  }
  function toHex(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
  // Encoded length for n input bytes with the given options (without line breaks counted by caller).
  function encodedLength(n, opts) {
    var o = normEncodeOpts(opts);
    var len = o.pad ? Math.ceil(n / 3) * 4 : Math.floor(n / 3) * 4 + [0, 2, 3][n % 3];
    if (o.lineLength && len > 0) len += (Math.ceil(len / o.lineLength) - 1) * o.eol.length;
    return len;
  }

  // Incremental SHA-256 (crypto.subtle has no streaming API), so memory stays constant for any size.
  function createSha256() {
    var K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    var H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    var buf = new Uint8Array(64), bl = 0, total = 0, W = new Uint32Array(64);
    function block(b, o) {
      for (var i = 0; i < 16; i++) W[i] = (b[o + i * 4] << 24) | (b[o + i * 4 + 1] << 16) | (b[o + i * 4 + 2] << 8) | b[o + i * 4 + 3];
      for (i = 16; i < 64; i++) {
        var x = W[i - 15], y = W[i - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3), s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], hh = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7)), ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[i] + W[i]) | 0, S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var t2 = (S0 + ((a & bb) ^ (a & c) ^ (bb & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = bb; bb = a; a = (t1 + t2) | 0;
      }
      H[0] += a; H[1] += bb; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += hh;
    }
    return {
      update: function (data) {
        var i = 0; total += data.length;
        if (bl) { while (bl < 64 && i < data.length) buf[bl++] = data[i++]; if (bl === 64) { block(buf, 0); bl = 0; } }
        for (; i + 64 <= data.length; i += 64) block(data, i);
        while (i < data.length) buf[bl++] = data[i++];
      },
      hex: function () {
        var bits = total * 8, pad = new Uint8Array(((bl < 56) ? 56 : 120) - bl + 8);
        pad[0] = 0x80;
        var hi = Math.floor(bits / 0x100000000), lo = bits >>> 0, L = pad.length;
        pad[L - 8] = hi >>> 24; pad[L - 7] = hi >>> 16; pad[L - 6] = hi >>> 8; pad[L - 5] = hi; pad[L - 4] = lo >>> 24; pad[L - 3] = lo >>> 16; pad[L - 2] = lo >>> 8; pad[L - 1] = lo;
        total -= pad.length; this.update(pad);
        return Array.from(H).map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
      }
    };
  }

  var api = {
    createSha256: createSha256,
    encode: encode, decode: decode, createEncoder: createEncoder, createDecoder: createDecoder,
    textToBytes: textToBytes, bytesToText: bytesToText, detectType: detectType, suggestName: suggestName,
    buildDataUrl: buildDataUrl, parseDataUrl: parseDataUrl, hexDump: hexDump, toHex: toHex, encodedLength: encodedLength, concat: concat,
    ENCODE_CHUNK: 3 * 256 * 1024, DECODE_CHUNK: 4 * 256 * 1024
  };
  root.TempDeskBase64 = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
