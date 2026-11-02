// QR code generator (ISO/IEC 18004), byte mode, error correction M, versions 1-10, mask chosen by
// penalty score. Pure function, no network. Returns { size, modules: boolean[][] }.
// Browser: window.TempDeskQr. Node: module.exports.
(function (root) {
  'use strict';

  // Error correction level M: [ecCodewordsPerBlock, [blocksGroup1, dataPerBlock1], [blocksGroup2, dataPerBlock2]]
  var EC_M = [null,
    [10, [1, 16], [0, 0]], [16, [1, 28], [0, 0]], [26, [1, 44], [0, 0]], [18, [2, 32], [0, 0]], [24, [2, 43], [0, 0]],
    [16, [4, 27], [0, 0]], [18, [4, 31], [0, 0]], [22, [2, 38], [2, 39]], [22, [3, 36], [2, 37]], [26, [4, 43], [1, 44]]];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // GF(256) with polynomial 0x11d
  var EXP = new Array(512), LOG = new Array(256);
  (function () { var x = 1; for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  function gmul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function rsGenerator(n) { var g = [1]; for (var i = 0; i < n; i++) { var next = new Array(g.length + 1).fill(0); for (var j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]); } g = next; } return g; }
  function rsEncode(data, n) {
    var gen = rsGenerator(n), res = new Array(n).fill(0);
    for (var i = 0; i < data.length; i++) {
      var f = data[i] ^ res[0];
      res.shift(); res.push(0);
      for (var j = 0; j < n; j++) res[j] ^= gmul(gen[j + 1], f);
    }
    return res;
  }
  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(s));
    return Array.from(Buffer.from(s, 'utf8'));
  }
  function dataCapacity(v) { var e = EC_M[v]; return e[1][0] * e[1][1] + e[2][0] * e[2][1]; }

  function encodeData(bytes, v) {
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    put(4, 4);
    put(bytes.length, v < 10 ? 8 : 16);
    bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCapacity(v) * 8;
    for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    var out = [];
    for (var i = 0; i < bits.length; i += 8) { var b = 0; for (var k = 0; k < 8; k++) b = (b << 1) | bits[i + k]; out.push(b); }
    for (var p = 0; out.length < dataCapacity(v); p++) out.push(p % 2 ? 0x11 : 0xec);
    return out;
  }
  function interleave(data, v) {
    var e = EC_M[v], blocks = [], ecs = [], at = 0;
    [e[1], e[2]].forEach(function (g) { for (var i = 0; i < g[0]; i++) { var blk = data.slice(at, at + g[1]); at += g[1]; blocks.push(blk); ecs.push(rsEncode(blk, e[0])); } });
    var out = [], max = Math.max.apply(null, blocks.map(function (b) { return b.length; }));
    for (var i = 0; i < max; i++) blocks.forEach(function (b) { if (i < b.length) out.push(b[i]); });
    for (i = 0; i < e[0]; i++) ecs.forEach(function (c) { out.push(c[i]); });
    return out;
  }
  function bchFormat(mask) {
    var data = (0 << 3) | mask; // EC level M = 00
    var v = data << 10;
    for (var i = 14; i >= 10; i--) if (v & (1 << i)) v ^= 0x537 << (i - 10);
    return ((data << 10) | v) ^ 0x5412;
  }
  function bchVersion(ver) {
    var v = ver << 12;
    for (var i = 17; i >= 12; i--) if (v & (1 << i)) v ^= 0x1f25 << (i - 12);
    return (ver << 12) | v;
  }
  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; }, function (r) { return r % 2 === 0; }, function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; }, function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return (r * c) % 2 + (r * c) % 3 === 0; }, function (r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; },
    function (r, c) { return ((r + c) % 2 + (r * c) % 3) % 2 === 0; }];

  function build(v, codewords, mask) {
    var n = 17 + 4 * v, m = [], fn = [];
    for (var i = 0; i < n; i++) { m.push(new Array(n).fill(false)); fn.push(new Array(n).fill(false)); }
    function set(r, c, val) { m[r][c] = val; fn[r][c] = true; }
    function finder(r, c) {
      for (var dr = -1; dr <= 7; dr++) for (var dc = -1; dc <= 7; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
        var on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        set(rr, cc, on);
      }
    }
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    var al = ALIGN[v];
    al.forEach(function (r) { al.forEach(function (c) {
      if ((r === 6 && c === 6) || (r === 6 && c === n - 7) || (r === n - 7 && c === 6)) return;
      for (var dr = -2; dr <= 2; dr++) for (var dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }); });
    set(n - 8, 8, true);
    var f = bchFormat(mask);
    for (i = 0; i < 15; i++) {
      var bit = ((f >> i) & 1) === 1;
      if (i < 6) set(i, 8, bit); else if (i < 8) set(i + 1, 8, bit); else set(n - 15 + i, 8, bit);
      if (i < 8) set(8, n - i - 1, bit); else if (i < 9) set(8, 15 - i - 1 + 1, bit); else set(8, 15 - i - 1, bit);
    }
    if (v >= 7) {
      var vb = bchVersion(v);
      for (i = 0; i < 18; i++) { var b2 = ((vb >> i) & 1) === 1; set(n - 11 + (i % 3), Math.floor(i / 3), b2); set(Math.floor(i / 3), n - 11 + (i % 3), b2); }
    }
    var bitIdx = 0, total = codewords.length * 8, up = true;
    for (var col = n - 1; col > 0; col -= 2) {
      if (col === 6) col = 5;
      for (var k = 0; k < n; k++) {
        var row = up ? n - 1 - k : k;
        for (var j = 0; j < 2; j++) {
          var cc = col - j;
          if (fn[row][cc]) continue;
          var val = false;
          if (bitIdx < total) { val = ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) === 1; bitIdx++; }
          if (MASKS[mask](row, cc)) val = !val;
          m[row][cc] = val;
        }
      }
      up = !up;
    }
    return m;
  }
  function penalty(m) {
    var n = m.length, p = 0, r, c, run, k;
    for (var pass = 0; pass < 2; pass++) for (r = 0; r < n; r++) {
      run = 1;
      for (c = 1; c < n; c++) {
        var a = pass ? m[c][r] : m[r][c], b = pass ? m[c - 1][r] : m[r][c - 1];
        if (a === b) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
      }
    }
    for (r = 0; r < n - 1; r++) for (c = 0; c < n - 1; c++) if (m[r][c] === m[r + 1][c] && m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c + 1]) p += 3;
    var pat = [true, false, true, true, true, false, true, false, false, false, false];
    for (r = 0; r < n; r++) for (c = 0; c + 11 <= n; c++) {
      var h1 = true, h2 = true, v1 = true, v2 = true;
      for (k = 0; k < 11; k++) {
        if (m[r][c + k] !== pat[k]) h1 = false; if (m[r][c + k] !== pat[10 - k]) h2 = false;
        if (m[c + k][r] !== pat[k]) v1 = false; if (m[c + k][r] !== pat[10 - k]) v2 = false;
      }
      p += 40 * ((h1 ? 1 : 0) + (h2 ? 1 : 0) + (v1 ? 1 : 0) + (v2 ? 1 : 0));
    }
    var dark = 0; for (r = 0; r < n; r++) for (c = 0; c < n; c++) if (m[r][c]) dark++;
    p += Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
    return p;
  }
  function generate(text, forceMask) {
    var bytes = utf8(String(text)), v;
    for (v = 1; v <= 10; v++) if (bytes.length + 2 + (v < 10 ? 0 : 1) <= dataCapacity(v)) break;
    if (v > 10) throw new Error('Text too long for a QR code (max about 213 bytes here).');
    var cw = interleave(encodeData(bytes, v), v), best = null, bestP = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      if (forceMask !== undefined && mask !== forceMask) continue;
      var m = build(v, cw, mask), p = penalty(m);
      if (p < bestP) { bestP = p; best = { version: v, mask: mask, size: m.length, modules: m }; }
    }
    return best;
  }
  function toSvg(qr, opts) {
    opts = opts || {};
    var q = opts.quiet === undefined ? 4 : opts.quiet, n = qr.size + q * 2, d = '';
    for (var r = 0; r < qr.size; r++) for (var c = 0; c < qr.size; c++) if (qr.modules[r][c]) d += 'M' + (c + q) + ' ' + (r + q) + 'h1v1h-1z';
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + ' ' + n + '" shape-rendering="crispEdges" role="img" aria-label="' +
      String(opts.label || 'QR code').replace(/[<>&"]/g, '') + '"><rect width="100%" height="100%" fill="' + (opts.light || '#ffffff') + '"/><path fill="' + (opts.dark || '#000000') + '" d="' + d + '"/></svg>';
  }
  var api = { generate: generate, toSvg: toSvg, rsEncode: rsEncode, bchFormat: bchFormat };
  root.TempDeskQr = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
