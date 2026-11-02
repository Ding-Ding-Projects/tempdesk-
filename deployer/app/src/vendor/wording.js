// Personal wording: optional local replacements for interface copy (elements marked data-i18n).
// Same rules as portal/app/vocab.py. Never applied to generated XML, code or user data.
// Validation errors name positions (entry numbers), never the file content.
// Browser: window.TempDeskWording. Node: module.exports.
(function (root) {
  'use strict';
  var MAX_BYTES = 256 * 1024, MAX_DEPTH = 8, MAX_KEY = 160, MAX_VALUE = 1000;
  var FORBIDDEN = ['__proto__', 'prototype', 'constructor'];

  function fail(code, n) { var e = new Error(code); e.code = code; if (n) e.entry = n; return e; }

  // Strict JSON tokenizer/parser: rejects duplicate keys, tracks depth, keeps key order.
  // Objects come back as arrays of [key, value] pairs wrapped in {__pairs: [...]} so nothing is
  // ever assigned onto a real object with a dangerous name during parsing.
  function strictParse(text) {
    var i = 0, n = text.length;
    function ws() { while (i < n && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++; }
    function value(depth) {
      if (depth > MAX_DEPTH) throw fail('depth');
      ws();
      var c = text[i];
      if (c === '{') return object(depth + 1);
      if (c === '[') return array(depth + 1);
      if (c === '"') return string();
      if (c === 't' && text.substr(i, 4) === 'true') { i += 4; return true; }
      if (c === 'f' && text.substr(i, 5) === 'false') { i += 5; return false; }
      if (c === 'n' && text.substr(i, 4) === 'null') { i += 4; return null; }
      var m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 400));
      if (m) { i += m[0].length; return Number(m[0]); }
      throw fail('json');
    }
    function string() {
      i++;
      var out = '';
      while (i < n) {
        var c = text[i];
        if (c === '"') { i++; return out; }
        if (c === '\\') {
          var e = text[i + 1];
          var map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
          if (e in map) { out += map[e]; i += 2; continue; }
          if (e === 'u' && /^[0-9A-Fa-f]{4}$/.test(text.substr(i + 2, 4))) { out += String.fromCharCode(parseInt(text.substr(i + 2, 4), 16)); i += 6; continue; }
          throw fail('json');
        }
        if (c.charCodeAt(0) < 0x20) throw fail('json');
        out += c; i++;
      }
      throw fail('json');
    }
    function object(depth) {
      i++;
      var pairs = [], seen = Object.create(null);
      ws();
      if (text[i] === '}') { i++; return { __pairs: pairs }; }
      for (;;) {
        ws();
        if (text[i] !== '"') throw fail('json');
        var k = string();
        if (Object.prototype.hasOwnProperty.call(seen, k)) throw fail('duplicate');
        seen[k] = true;
        ws();
        if (text[i] !== ':') throw fail('json');
        i++;
        pairs.push([k, value(depth)]);
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === '}') { i++; return { __pairs: pairs }; }
        throw fail('json');
      }
    }
    function array(depth) {
      i++;
      var out = [];
      ws();
      if (text[i] === ']') { i++; return out; }
      for (;;) {
        out.push(value(depth));
        ws();
        if (text[i] === ',') { i++; continue; }
        if (text[i] === ']') { i++; return out; }
        throw fail('json');
      }
    }
    var v = value(0);
    ws();
    if (i !== n) throw fail('json');
    return v;
  }

  function hasControl(s, allowWs) {
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) {
        if (allowWs && (c === 9 || c === 10 || c === 13)) continue;
        return true;
      }
    }
    return false;
  }

  // input: string or Uint8Array/ArrayBuffer. Returns a Map of phrase -> replacement, or throws {code, entry}.
  function validate(input) {
    var text;
    if (typeof input === 'string') {
      var bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(input).length : Buffer.byteLength(input);
      if (bytes > MAX_BYTES) throw fail('size');
      text = input;
    } else {
      var b = input instanceof ArrayBuffer ? new Uint8Array(input) : input;
      if (!b || !b.length) throw fail('empty');
      if (b.length > MAX_BYTES) throw fail('size');
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(b); } catch (e) { throw fail('utf8'); }
    }
    if (!text.length) throw fail('empty');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    var doc = strictParse(text);
    if (!doc || !doc.__pairs) throw fail('topObject');
    var top = {};
    doc.__pairs.forEach(function (p) {
      if (p[0] !== 'schemaVersion' && p[0] !== 'entries') throw fail('topKeys');
      top[p[0]] = p[1];
    });
    if (top.schemaVersion !== 1) throw fail('schemaVersion');
    if (!top.entries || !top.entries.__pairs) throw fail('entries');
    var out = new Map();
    top.entries.__pairs.forEach(function (p, idx) {
      var k = p[0], v = p[1], num = idx + 1;
      if (k.length < 1 || k.length > MAX_KEY) throw fail('keyLength', num);
      if (!k.trim()) throw fail('keyBlank', num);
      if (FORBIDDEN.indexOf(k) >= 0) throw fail('keyReserved', num);
      if (hasControl(k, false)) throw fail('keyControl', num);
      if (typeof v !== 'string') throw fail('valueType', num);
      if (v.length > MAX_VALUE) throw fail('valueLength', num);
      if (hasControl(v, true)) throw fail('valueControl', num);
      out.set(k, v);
    });
    return out;
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function matchCase(src, rep) {
    if (!rep) return rep;
    if (src.length > 1 && src === src.toUpperCase() && /[A-Za-z]/.test(src)) return rep.toUpperCase();
    if (src[0] !== src[0].toLowerCase() && rep[0] === rep[0].toLowerCase()) return rep[0].toUpperCase() + rep.slice(1);
    if (src[0] !== src[0].toUpperCase() && rep[0] !== rep[0].toLowerCase()) return rep[0].toLowerCase() + rep.slice(1);
    return rep;
  }
  // Returns translate(text) applying whole-word, longest-first, case-aware replacement in one pass.
  function buildTranslator(entries) {
    if (!entries || !entries.size) return function (t) { return t; };
    var keys = Array.from(entries.keys()).sort(function (a, b) { return b.length - a.length; });
    var folded = new Map();
    keys.forEach(function (k) { if (!folded.has(k.toLowerCase())) folded.set(k.toLowerCase(), entries.get(k)); });
    var re = new RegExp('(?<![\\p{L}\\p{N}_])(?:' + keys.map(escapeRe).join('|') + ')(?![\\p{L}\\p{N}_])', 'giu');
    return function (text) {
      return String(text).replace(re, function (m) {
        if (entries.has(m)) return entries.get(m);
        var r = folded.get(m.toLowerCase());
        return r === undefined ? m : matchCase(m, r);
      });
    };
  }

  var api = { validate: validate, strictParse: strictParse, buildTranslator: buildTranslator, MAX_BYTES: MAX_BYTES, MAX_DEPTH: MAX_DEPTH, MAX_KEY: MAX_KEY, MAX_VALUE: MAX_VALUE };
  root.TempDeskWording = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
