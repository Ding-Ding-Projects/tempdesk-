// Pure helpers shared by the renderer and tests: colour maths, regex search builder, palette
// scoring, i18n resolution (language modes, funny level, personal wording), exports and a small
// Markdown renderer. No DOM access and no network.
// Browser: window.TempDeskCore. Node: module.exports.
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // Colour
  // ---------------------------------------------------------------------------------------------
  function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
  function parseHex(hex) {
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
    if (!m) return null;
    var s = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
    return { r: parseInt(s.slice(0, 2), 16), g: parseInt(s.slice(2, 4), 16), b: parseInt(s.slice(4, 6), 16) };
  }
  function toHex(c) { return '#' + [c.r, c.g, c.b].map(function (v) { return ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2); }).join('').toUpperCase(); }
  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); v = clamp(v, 0, 1);
    var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
  }
  function rgbToHsv(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
    if (d) { if (max === r) h = 60 * (((g - b) / d) % 6); else if (max === g) h = 60 * ((b - r) / d + 2); else h = 60 * ((r - g) / d + 4); }
    return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
  }
  function luminance(c) {
    var f = function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function contrast(a, b) {
    var x = typeof a === 'string' ? parseHex(a) : a, y = typeof b === 'string' ? parseHex(b) : b;
    if (!x || !y) return 0;
    var l1 = luminance(x), l2 = luminance(y);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  // Picks a readable "on accent" colour: near-black or white, whichever contrasts more.
  function onColor(hex) { return contrast(hex, '#04201D') >= contrast(hex, '#FFFFFF') ? '#04201D' : '#FFFFFF'; }
  function mix(a, b, t) { var x = parseHex(a), y = parseHex(b); return toHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t }); }

  // ---------------------------------------------------------------------------------------------
  // Search boxes: plain text (default) or regular expression, with live match count
  // ---------------------------------------------------------------------------------------------
  function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // Returns { ok, re, error } for the query. Plain mode matches literally, case-insensitive.
  function buildMatcher(query, opts) {
    opts = opts || {};
    var q = String(query || '');
    if (!q) return { ok: true, re: null, empty: true };
    if (q.length > 500) return { ok: false, error: 'tooLong' };
    var flags = (opts.caseSensitive ? '' : 'i') + 'gu';
    try {
      var re = new RegExp(opts.regex ? q : escapeRegex(q), flags);
      if (opts.regex && re.test('')) return { ok: true, re: re, matchesEmpty: true };
      return { ok: true, re: re };
    } catch (e) { return { ok: false, error: 'invalid', message: String(e.message).replace(/^Invalid regular expression: /, '') }; }
  }
  function countMatches(texts, matcher) {
    if (!matcher || !matcher.ok || !matcher.re) return { items: texts.length, matches: 0 };
    var items = 0, matches = 0;
    texts.forEach(function (t) {
      matcher.re.lastIndex = 0;
      var s = String(t), n = 0, m, guard = 0;
      while ((m = matcher.re.exec(s)) && guard++ < 10000) { n++; if (m[0] === '') matcher.re.lastIndex++; }
      if (n) { items++; matches += n; }
    });
    matcher.re.lastIndex = 0;
    return { items: items, matches: matches };
  }
  function testMatch(text, matcher) {
    if (!matcher || !matcher.ok || !matcher.re) return true;
    matcher.re.lastIndex = 0;
    var r = matcher.re.test(String(text));
    matcher.re.lastIndex = 0;
    return r;
  }
  var REGEX_TOKENS = [
    ['.', 'any'], ['\\d', 'digit'], ['\\w', 'word'], ['\\s', 'space'], ['^', 'start'], ['$', 'end'],
    ['*', 'zeroOrMore'], ['+', 'oneOrMore'], ['?', 'optional'], ['{2,4}', 'range'], ['[abc]', 'set'], ['[^abc]', 'notSet'],
    ['(a|b)', 'either'], ['\\b', 'boundary'], ['(?:x)', 'group'], ['\\.', 'literalDot']
  ];

  // ---------------------------------------------------------------------------------------------
  // Command palette scoring (subsequence fuzzy match with word-start bonus)
  // ---------------------------------------------------------------------------------------------
  function fuzzyScore(query, text) {
    var q = String(query).toLowerCase().trim(), t = String(text).toLowerCase();
    if (!q) return 1;
    var idx = t.indexOf(q);
    if (idx >= 0) return 1000 - idx + (idx === 0 || /\W/.test(t[idx - 1]) ? 200 : 0);
    var score = 0, ti = 0, last = -2;
    for (var qi = 0; qi < q.length; qi++) {
      var c = q[qi];
      if (c === ' ') continue;
      var found = t.indexOf(c, ti);
      if (found < 0) return 0;
      score += found === last + 1 ? 15 : 5;
      if (found === 0 || /\W/.test(t[found - 1])) score += 10;
      last = found; ti = found + 1;
    }
    return score;
  }
  function rankItems(query, items, limit) {
    return items.map(function (it) {
      var s = Math.max(fuzzyScore(query, it.title), fuzzyScore(query, (it.keywords || '') + ' ' + (it.group || '')) * 0.6);
      return { it: it, s: s };
    }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, limit || 50).map(function (x) { return x.it; });
  }

  // ---------------------------------------------------------------------------------------------
  // i18n: language modes, funny levels, personal wording
  // ---------------------------------------------------------------------------------------------
  // Keys whose copy must stay serious whatever the funny level is.
  var SERIOUS = /^(err|sec|warn|confirm|danger|update)\./;
  function pickVariant(value, level, key) {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string') return value;
    if (typeof value !== 'object') return String(value);
    var lv = SERIOUS.test(key || '') ? 0 : clamp(parseInt(level, 10) || 0, 0, 3);
    for (var l = lv; l >= 0; l--) if (typeof value[String(l)] === 'string') return value[String(l)];
    return value['0'];
  }
  function format(s, args) {
    return String(s).replace(/\{(\d+)\}/g, function (m, i) { return args && args[i] !== undefined ? String(args[i]) : m; });
  }
  // opts: { catalogs: {en, 'zh-HK'}, mode: 'en'|'zh-HK'|'bilingual', funny: 0..3, wording: translate fn|null }
  function makeTranslator(opts) {
    var cats = opts.catalogs || {};
    var mode = opts.mode || 'en';
    var funny = opts.funny || 0;
    var wording = opts.wording || null;
    function one(lang, key, args) {
      var v = pickVariant(cats[lang] && cats[lang][key], funny, key);
      if (v === undefined) v = pickVariant(cats.en && cats.en[key], funny, key);
      if (v === undefined) return key;
      return format(v, args);
    }
    function t(key, args) {
      var text;
      if (mode === 'bilingual') {
        var a = one('en', key, args), b = one('zh-HK', key, args);
        text = a === b ? a : a + ' / ' + b;
      } else text = one(mode === 'zh-HK' ? 'zh-HK' : 'en', key, args);
      return wording ? wording(text) : text;
    }
    t.raw = function (key, args) { return one(mode === 'zh-HK' ? 'zh-HK' : 'en', key, args); };
    t.mode = mode;
    return t;
  }
  function catalogKeyDiff(a, b) {
    var ka = Object.keys(a), kb = Object.keys(b);
    return { missingInB: ka.filter(function (k) { return !(k in b); }), missingInA: kb.filter(function (k) { return !(k in a); }) };
  }

  // ---------------------------------------------------------------------------------------------
  // Exports: JSON, CSV, HTML (no secrets: callers pass already-redacted data)
  // ---------------------------------------------------------------------------------------------
  function csvCell(v) {
    var s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula injection guard
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function toCsv(rows, columns) {
    var cols = columns || Array.from(rows.reduce(function (set, r) { Object.keys(r).forEach(function (k) { set.add(k); }); return set; }, new Set()));
    return [cols.map(csvCell).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return csvCell(r[c]); }).join(','); })).join('\r\n') + '\r\n';
  }
  function escapeHtml(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function toHtml(title, rows, columns) {
    var cols = columns || (rows[0] ? Object.keys(rows[0]) : []);
    var body = rows.map(function (r) { return '<tr>' + cols.map(function (c) { var v = r[c]; return '<td>' + escapeHtml(typeof v === 'object' && v !== null ? JSON.stringify(v) : v) + '</td>'; }).join('') + '</tr>'; }).join('\n');
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>' + escapeHtml(title) +
      '</title><style>body{font-family:Segoe UI,system-ui,sans-serif;background:#0B1110;color:#E8F1EF;padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #22322F;padding:6px 10px;text-align:left;vertical-align:top}th{background:#16211F}</style></head><body><h1>' +
      escapeHtml(title) + '</h1><table><thead><tr>' + cols.map(function (c) { return '<th>' + escapeHtml(c) + '</th>'; }).join('') + '</tr></thead><tbody>\n' + body + '\n</tbody></table></body></html>\n';
  }
  function flatten(obj, prefix, out) {
    out = out || {};
    Object.keys(obj || {}).forEach(function (k) {
      var v = obj[k], key = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out); else out[key] = Array.isArray(v) ? v.join(' ') : v;
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Markdown (subset) to a block list the renderer turns into DOM with textContent (never innerHTML)
  // ---------------------------------------------------------------------------------------------
  function parseInline(s) {
    var out = [], re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))/g, last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
      if (m[1]) out.push({ t: 'code', v: m[1].slice(1, -1) });
      else if (m[2]) out.push({ t: 'bold', v: m[2].slice(2, -2) });
      else { var mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(m[3]); out.push({ t: 'link', v: mm[1], href: mm[2] }); }
      last = re.lastIndex;
    }
    if (last < s.length) out.push({ t: 'text', v: s.slice(last) });
    return out;
  }
  function parseMarkdown(md) {
    var lines = String(md).replace(/\r\n/g, '\n').split('\n'), blocks = [], i = 0;
    while (i < lines.length) {
      var l = lines[i];
      if (/^```/.test(l)) { var code = []; i++; while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]); i++; blocks.push({ type: 'pre', text: code.join('\n') }); continue; }
      var hm = /^(#{1,4})\s+(.*)$/.exec(l);
      if (hm) { blocks.push({ type: 'h', level: hm[1].length, inline: parseInline(hm[2]), text: hm[2] }); i++; continue; }
      if (/^\|/.test(l)) {
        var rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) { if (!/^\|[\s:|-]+\|?\s*$/.test(lines[i])) rows.push(lines[i].replace(/^\||\|\s*$/g, '').split('|').map(function (c) { return parseInline(c.trim()); })); i++; }
        blocks.push({ type: 'table', rows: rows });
        continue;
      }
      if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
        var items = [], ordered = /^\s*\d+\./.test(l);
        while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(parseInline(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))); i++; }
        blocks.push({ type: ordered ? 'ol' : 'ul', items: items });
        continue;
      }
      if (/^>\s?/.test(l)) { var q = []; while (i < lines.length && /^>\s?/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, '')); blocks.push({ type: 'quote', inline: parseInline(q.join(' ')) }); continue; }
      if (!l.trim()) { i++; continue; }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\||\s*([-*]|\d+\.)\s|>)/.test(lines[i])) para.push(lines[i++].trim());
      blocks.push({ type: 'p', inline: parseInline(para.join(' ')) });
    }
    return blocks;
  }
  function parseChangelog(md) {
    var out = [], cur = null;
    String(md).replace(/\r\n/g, '\n').split('\n').forEach(function (l) {
      var m = /^##\s+\[?([^\]\s]+)\]?(?:\s*-\s*(.*))?$/.exec(l);
      if (m) { cur = { version: m[1], date: (m[2] || '').trim(), lines: [] }; out.push(cur); }
      else if (cur) cur.lines.push(l);
    });
    out.forEach(function (r) { r.body = r.lines.join('\n').trim(); delete r.lines; });
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Deployment configs: secrets excluded unless explicitly included
  // ---------------------------------------------------------------------------------------------
  var SECRET_KEYS = ['adminPassword', 'dsrmPassword', 'joinPassword', 'password', 'sshPassword', 'pin', 'guestKey', 'adminKey', 'hmacSecret'];
  function stripSecrets(obj) {
    if (Array.isArray(obj)) return obj.map(stripSecrets);
    if (obj && typeof obj === 'object') {
      var out = {};
      Object.keys(obj).forEach(function (k) { if (k === '__proto__' || k === 'constructor' || k === 'prototype') return; out[k] = SECRET_KEYS.indexOf(k) >= 0 ? '' : stripSecrets(obj[k]); });
      return out;
    }
    return obj;
  }
  var NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/;
  function validateDeployment(d) {
    var e = {};
    if (!d || typeof d !== 'object') return { _: 'shape' };
    if (!NAME_RE.test(String(d.name || '')) || /\.\./.test(d.name)) e.name = 'name';
    if (['server', 'lite'].indexOf(d.kind) < 0) e.kind = 'kind';
    var ip = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
    if (d.kind === 'server' && (!d.server || !ip.test(d.server.ipAddress || ''))) e['server.ipAddress'] = 'ip';
    if (d.kind === 'lite') {
      if (!d.ssh || !/^[a-z_][a-z0-9_.-]{0,31}$/.test(d.ssh.user || '')) e['ssh.user'] = 'user';
      if (!d.ssh || !/^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(d.ssh.host || '')) e['ssh.host'] = 'host';
      if (!d.lite || !ip.test(d.lite.dcIp || '')) e['lite.dcIp'] = 'ip';
    }
    return e;
  }

  // ---------------------------------------------------------------------------------------------
  // Backup bundle manifest validation (full validation before anything is applied)
  // ---------------------------------------------------------------------------------------------
  var BACKUP_FILES = /^(settings\.json|vocabulary\.json|tabs\.json|deployments\/[A-Za-z0-9][A-Za-z0-9._ -]{0,63}\.json|workspace\/[A-Za-z0-9][A-Za-z0-9._ /-]{0,200}\.json)$/;
  function validateBackup(manifest, names) {
    if (!manifest || manifest.schema !== 'tempdesk-backup' || manifest.version !== 1) return { ok: false, error: 'backup.schema' };
    if (!Array.isArray(manifest.files)) return { ok: false, error: 'backup.files' };
    for (var i = 0; i < manifest.files.length; i++) {
      var f = manifest.files[i];
      if (typeof f !== 'string' || !BACKUP_FILES.test(f) || /\.\./.test(f)) return { ok: false, error: 'backup.path', index: i + 1 };
      if (names.indexOf(f) < 0) return { ok: false, error: 'backup.missing', index: i + 1 };
    }
    return { ok: true };
  }

  var api = {
    parseHex: parseHex, toHex: toHex, hsvToRgb: hsvToRgb, rgbToHsv: rgbToHsv, contrast: contrast, onColor: onColor, mix: mix,
    escapeRegex: escapeRegex, buildMatcher: buildMatcher, countMatches: countMatches, testMatch: testMatch, REGEX_TOKENS: REGEX_TOKENS,
    fuzzyScore: fuzzyScore, rankItems: rankItems,
    pickVariant: pickVariant, format: format, makeTranslator: makeTranslator, catalogKeyDiff: catalogKeyDiff, SERIOUS: SERIOUS,
    csvCell: csvCell, toCsv: toCsv, toHtml: toHtml, escapeHtml: escapeHtml, flatten: flatten,
    parseMarkdown: parseMarkdown, parseInline: parseInline, parseChangelog: parseChangelog,
    stripSecrets: stripSecrets, validateDeployment: validateDeployment, validateBackup: validateBackup, SECRET_KEYS: SECRET_KEYS
  };
  root.TempDeskCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
