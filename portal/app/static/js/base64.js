// TempDesk Base64 codec (vendored copy for the portal; the website keeps its
// own at site/assets/base64.js when it exists). Pure functions, no DOM.
//   TDBase64.encode(bytes, {alphabet:'standard'|'url', pad:true, lineLength:0, eol:'\r\n'}) -> string
//   TDBase64.decode(text, {strict:true}) -> Uint8Array   (throws Base64Error with .offset)
//   TDBase64.createEncoder(opts) -> {push(bytes) -> string, finish() -> string}  for streaming
//   TDBase64.textToBytes(text, charset), bytesToText(bytes, charset)
//   TDBase64.buildDataUrl(mime, b64), parseDataUrl(url)
(function (global) {
  'use strict';
  var STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var URL_ = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var REV = new Int16Array(256).fill(-1);
  for (var i = 0; i < 64; i++) { REV[STD.charCodeAt(i)] = i; REV[URL_.charCodeAt(i)] = i; }

  function Base64Error(message, offset) { this.name = 'Base64Error'; this.message = message; this.offset = offset; }
  Base64Error.prototype = Object.create(Error.prototype);

  function encodeRaw(bytes, alpha, pad) {
    var out = [], n = bytes.length, i = 0, chunk = [];
    for (; i + 2 < n; i += 3) {
      var v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      chunk.push(alpha[v >> 18 & 63], alpha[v >> 12 & 63], alpha[v >> 6 & 63], alpha[v & 63]);
      if (chunk.length >= 8192) { out.push(chunk.join('')); chunk = []; }
    }
    if (i < n) {
      var a = bytes[i], b = i + 1 < n ? bytes[i + 1] : 0, w = (a << 16) | (b << 8);
      chunk.push(alpha[w >> 18 & 63], alpha[w >> 12 & 63]);
      if (i + 1 < n) chunk.push(alpha[w >> 6 & 63]); else if (pad) chunk.push('=');
      if (pad) chunk.push('=');
    }
    out.push(chunk.join(''));
    return out.join('');
  }
  function wrap(s, len, eol) {
    if (!len) return s;
    var parts = [];
    for (var i = 0; i < s.length; i += len) parts.push(s.slice(i, i + len));
    return parts.join(eol || '\r\n');
  }
  function encode(bytes, opts) {
    opts = opts || {};
    var alpha = opts.alphabet === 'url' ? URL_ : STD;
    return wrap(encodeRaw(bytes, alpha, opts.pad !== false), opts.lineLength || 0, opts.eol);
  }
  function createEncoder(opts) {
    opts = opts || {};
    var alpha = opts.alphabet === 'url' ? URL_ : STD, carry = new Uint8Array(0), col = 0, len = opts.lineLength || 0, eol = opts.eol || '\r\n';
    function emit(s) {
      if (!len) return s;
      var out = '';
      for (var i = 0; i < s.length; i++) { if (col === len) { out += eol; col = 0; } out += s[i]; col++; }
      return out;
    }
    return {
      push: function (bytes) {
        var all = new Uint8Array(carry.length + bytes.length); all.set(carry); all.set(bytes, carry.length);
        var usable = all.length - (all.length % 3);
        carry = all.slice(usable);
        return emit(encodeRaw(all.subarray(0, usable), alpha, true));
      },
      finish: function () { var s = encodeRaw(carry, alpha, opts.pad !== false); carry = new Uint8Array(0); return emit(s); }
    };
  }
  function decode(text, opts) {
    opts = opts || {};
    var strict = opts.strict !== false;
    var vals = [], padAt = -1, i, c, sawStd = false, sawUrl = false;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c === 61) { if (padAt < 0) padAt = vals.length; continue; }
      if (c === 32 || c === 9 || c === 10 || c === 13) continue;
      var v = c < 256 ? REV[c] : -1;
      if (v < 0) { if (strict) throw new Base64Error('Invalid character ' + JSON.stringify(text[i]) + ' at offset ' + i, i); continue; }
      if (padAt >= 0 && strict) throw new Base64Error('Data after padding at offset ' + i, i);
      if (c === 43 || c === 47) sawStd = true; if (c === 45 || c === 95) sawUrl = true;
      if (sawStd && sawUrl && strict) throw new Base64Error('Mixed standard and URL-safe alphabets at offset ' + i, i);
      vals.push(v);
    }
    var rem = vals.length % 4;
    if (rem === 1) { if (strict) throw new Base64Error('Truncated input: one character too many at the end (offset ' + (text.length - 1) + ')', text.length - 1); vals.pop(); rem = 0; }
    if (strict && padAt >= 0) {
      var padCount = (text.replace(/[\s]/g, '').match(/=+$/) || [''])[0].length;
      if ((vals.length + padCount) % 4 !== 0) throw new Base64Error('Wrong amount of padding at the end', text.length - 1);
    }
    var outLen = Math.floor(vals.length / 4) * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
    var out = new Uint8Array(outLen), o = 0;
    for (i = 0; i + 3 < vals.length; i += 4) {
      var n = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6) | vals[i + 3];
      out[o++] = n >> 16 & 255; out[o++] = n >> 8 & 255; out[o++] = n & 255;
    }
    if (rem === 2) { out[o++] = ((vals[i] << 18) | (vals[i + 1] << 12)) >> 16 & 255; }
    else if (rem === 3) { var m = (vals[i] << 18) | (vals[i + 1] << 12) | (vals[i + 2] << 6); out[o++] = m >> 16 & 255; out[o++] = m >> 8 & 255; }
    return out;
  }
  function textToBytes(text, cs) {
    cs = (cs || 'utf-8').toLowerCase();
    if (cs === 'utf-8') return new TextEncoder().encode(text);
    if (cs === 'latin1') {
      var b = new Uint8Array(text.length);
      for (var i = 0; i < text.length; i++) { var c = text.charCodeAt(i); if (c > 255) throw new Base64Error('Character at offset ' + i + ' does not exist in Latin-1', i); b[i] = c; }
      return b;
    }
    var le = cs === 'utf-16le', out = new Uint8Array(text.length * 2);
    for (var j = 0; j < text.length; j++) { var u = text.charCodeAt(j); out[j * 2 + (le ? 0 : 1)] = u & 255; out[j * 2 + (le ? 1 : 0)] = u >> 8; }
    return out;
  }
  function bytesToText(bytes, cs) {
    cs = (cs || 'utf-8').toLowerCase();
    if (cs === 'latin1') { var s = ''; for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return s; }
    return new TextDecoder(cs === 'utf-8' ? 'utf-8' : cs, { fatal: false }).decode(bytes);
  }
  function buildDataUrl(mime, b64) { return 'data:' + (mime || 'application/octet-stream') + ';base64,' + b64.replace(/\s+/g, ''); }
  function parseDataUrl(url) {
    var m = /^data:([^,;]*)((?:;[^,;]+)*),(.*)$/s.exec((url || '').trim());
    if (!m) throw new Base64Error('Not a data: URL', 0);
    var isB64 = /;base64/i.test(m[2]);
    var bytes = isB64 ? decode(m[3]) : textToBytes(decodeURIComponent(m[3]));
    return { mime: m[1] || 'text/plain', params: m[2], base64: isB64, bytes: bytes };
  }
  var SIGS = [
    [[0x89, 0x50, 0x4e, 0x47], 'image/png', 'PNG image'], [[0xff, 0xd8, 0xff], 'image/jpeg', 'JPEG image'],
    [[0x47, 0x49, 0x46, 0x38], 'image/gif', 'GIF image'], [[0x25, 0x50, 0x44, 0x46], 'application/pdf', 'PDF document'],
    [[0x50, 0x4b, 0x03, 0x04], 'application/zip', 'ZIP archive (also docx, xlsx, pptx)'], [[0x1f, 0x8b], 'application/gzip', 'gzip data'],
    [[0x4d, 0x5a], 'application/vnd.microsoft.portable-executable', 'Windows executable'], [[0x7f, 0x45, 0x4c, 0x46], 'application/x-elf', 'ELF executable'],
    [[0x52, 0x49, 0x46, 0x46], 'image/webp', 'RIFF container (WebP, WAV, AVI)'], [[0x30, 0x82], 'application/pkix-cert', 'DER certificate or key']
  ];
  function detect(bytes) {
    for (var i = 0; i < SIGS.length; i++) {
      var s = SIGS[i][0], ok = bytes.length >= s.length;
      for (var j = 0; ok && j < s.length; j++) ok = bytes[j] === s[j];
      if (ok) return { mime: SIGS[i][1], label: SIGS[i][2], text: false };
    }
    var sample = bytes.subarray(0, 4096), bad = 0;
    for (var k = 0; k < sample.length; k++) { var c = sample[k]; if (c < 9 || (c > 13 && c < 32)) bad++; }
    var text = sample.length === 0 || bad / sample.length < 0.02;
    if (text) {
      var head = bytesToText(sample.subarray(0, 256)).trim();
      if (/^[{\[]/.test(head)) return { mime: 'application/json', label: 'JSON or text', text: true };
      if (/^<\?xml|^<[A-Za-z]/.test(head)) return { mime: 'application/xml', label: 'XML or HTML (shown as text only)', text: true };
      if (/^-----BEGIN /.test(head)) return { mime: 'application/x-pem-file', label: 'PEM data', text: true };
      return { mime: 'text/plain', label: 'Text', text: true };
    }
    return { mime: 'application/octet-stream', label: 'Binary data', text: false };
  }
  global.TDBase64 = { encode: encode, decode: decode, createEncoder: createEncoder, textToBytes: textToBytes, bytesToText: bytesToText,
    buildDataUrl: buildDataUrl, parseDataUrl: parseDataUrl, detect: detect, Base64Error: Base64Error };
})(typeof window !== 'undefined' ? window : globalThis);
