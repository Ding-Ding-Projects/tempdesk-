/*
 * TempDesk regex builder: a dependency-free search field companion with plain text matching by
 * default, an explicit regular expression opt-in and a guided, anchored pattern builder.
 *
 * Loading
 *   Classic script:  <script src="regex-builder.js"></script>  ->  window.TempDeskRegex
 *   ES module:       import { attachRegexBuilder, compile } from './regex-builder.mjs';
 *   Node / CommonJS: const R = require('./regex-builder.js');
 *   Web Worker:      the same file doubles as the evaluation worker (it detects the worker scope).
 *
 * API (window.TempDeskRegex, module.exports and the .mjs named exports are the same object)
 *   attachRegexBuilder(inputEl, {
 *       onChange(state, compiled),     // called after typing (debounced), toggles and builder edits
 *       label,                         // accessible name of the search, used in button names
 *       sampleProvider() -> string,    // optional; prefills the sample text (bounded to 20,000 chars)
 *       dialect: 'javascript',         // only JavaScript RegExp (ECMAScript) is supported
 *       t(key, ...args) -> string,     // optional translate function; missing keys use English
 *       state,                         // optional initial state
 *       escapeClears,                  // default true: Escape in the field clears it
 *       persistKey,                    // optional; only when set is state kept (sessionStorage)
 *       workerUrl,                     // optional URL of this file for the evaluation worker
 *       container                      // optional element to receive the buttons (default: after input)
 *   }) -> { open(), close(), get state(), set(state), compiled(), destroy(), el, toggle, builderButton }
 *   compile(query, { regex, flags, wholeWord, caseSensitive, allowSlow })
 *       -> { ok, empty, test(text) -> bool, find(text) -> {index,length}|null,
 *            matches(text, limit?) -> [{index, length, groups}], error, errorIndex, slow, warning, source }
 *   filterItems(items, toText, state|compiled, { budgetMs = 50 }) -> { ok, items, indexes, slow, error }
 *       Applies a per-keystroke time budget; when exceeded it falls back to plain text and sets slow.
 *   attachListFilter(listEl, { label, t, items(listEl), text(el), tree, mount, place, onFilter, state, onState })
 *       -> { el, input, builder, refresh(), destroy(), shown, total }   Search in front of any list.
 *   attachTabCloser(stripEl, { label, t, tabs() -> [{id, text, el, pinned, dirty}], close(ids), confirmUnsaved(tabs) })
 *       -> { el, input, builder, preview(), closeContaining(), closeNotContaining(), destroy() }
 *   evaluate(state, text, { timeoutMs = 250, workerUrl }) -> Promise<{ ok, matches, count, timedOut, error }>
 *   explain(pattern, flags, t?) -> string        Plain words, token by token.
 *   tokenize(pattern) -> { tokens: [{type, start, end, text}], error, errorIndex }
 *   isCatastrophic(pattern) -> bool              Nested quantifier heuristic, for example (a+)+
 *   escapeRegex(text) -> string
 *   defaultState() -> { query:'', regex:false, pattern:'', flags:'', caseSensitive:false, wholeWord:false }
 *   GALLERY, LIMITS
 *
 * state = { query, regex: boolean, pattern, flags: '' (subset of i, m, s, u), caseSensitive, wholeWord }
 *   In regex mode the field text is the pattern (query === pattern). Ignore case follows
 *   caseSensitive (the "Ignore case" flag and "Case sensitive" option are kept in step).
 *   Plain text mode matches when every space separated word occurs (all words, any order).
 *
 * Nothing is persisted (no localStorage) unless the consumer passes persistKey.
 */
(function (root, factory) {
  'use strict';
  // One shared instance per realm, even when loaded both as a classic script and as a module.
  var api = root && root.TempDeskRegex && root.TempDeskRegex.version ? root.TempDeskRegex : factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  if (root) root.TempDeskRegex = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function (root) {
  'use strict';

  var LIMITS = { pattern: 2000, sample: 20000, timeoutMs: 250, syncInput: 2000, budgetMs: 50, maxMatches: 5000, groupRows: 50 };

  // ------------------------------------------------------------------------------------------
  // Strings (English defaults; consumers pass t() backed by i18n/en.json and zh-HK.json, keys rx.*)
  // ------------------------------------------------------------------------------------------
  var EN = {
    'rx.toggle': 'Regular expression', 'rx.builder': 'Builder', 'rx.builderFor': 'Regex builder for {0}',
    'rx.title': 'Regex builder', 'rx.close': 'Close builder', 'rx.pattern': 'Pattern',
    'rx.tokens': 'Insert token', 'rx.literal': 'Literal text', 'rx.literalPh': 'Text to match exactly',
    'rx.insert': 'Insert', 'rx.any': 'Any character', 'rx.digit': 'Digit', 'rx.letter': 'Letter',
    'rx.space': 'Whitespace', 'rx.word': 'Word character', 'rx.class': 'Custom class',
    'rx.classPh': 'Characters or ranges, for example a-z0-9_', 'rx.negate': 'Not these characters',
    'rx.start': 'Start of text', 'rx.end': 'End of text', 'rx.boundary': 'Word boundary',
    'rx.group': 'Group', 'rx.ncgroup': 'Non-capturing group', 'rx.named': 'Named group', 'rx.namePh': 'Group name',
    'rx.alt': 'A or B', 'rx.quant': 'Repeat the previous token', 'rx.optional': 'Optional',
    'rx.zeroMore': 'Zero or more', 'rx.oneMore': 'One or more', 'rx.exactly': 'Exactly n', 'rx.between': 'Between n and m',
    'rx.n': 'n', 'rx.m': 'm', 'rx.lazy': 'Lazy (as few as possible)',
    'rx.lookahead': 'Followed by', 'rx.nlookahead': 'Not followed by', 'rx.lookbehind': 'Preceded by', 'rx.nlookbehind': 'Not preceded by',
    'rx.flags': 'Flags', 'rx.flagI': 'Ignore case', 'rx.flagIHelp': 'A matches a.',
    'rx.flagM': 'Multiline', 'rx.flagMHelp': 'Start and end of text also match at each line.',
    'rx.flagS': 'Dot matches newline', 'rx.flagSHelp': 'Any character also matches line breaks.',
    'rx.flagU': 'Unicode', 'rx.flagUHelp': 'Full Unicode: emoji and \\p{...} classes work.',
    'rx.options': 'Options', 'rx.wholeWord': 'Whole word', 'rx.caseSensitive': 'Case sensitive', 'rx.useRegex': 'Use regular expression',
    'rx.sample': 'Sample text', 'rx.samplePh': 'Paste text to test the pattern against',
    'rx.preview': 'Matches in the sample', 'rx.count': '{0} matches', 'rx.count1': '1 match', 'rx.count0': 'No matches',
    'rx.groups': 'Capture groups', 'rx.match': 'Match', 'rx.groupN': 'Group {0}',
    'rx.copy': 'Copy pattern', 'rx.copyJs': 'Copy as JavaScript', 'rx.export': 'Export JSON', 'rx.copied': 'Copied.',
    'rx.gallery': 'Common patterns', 'rx.use': 'Use',
    'rx.g.ipv4': 'IPv4 address', 'rx.g.email': 'Email address', 'rx.g.guid': 'GUID', 'rx.g.date': 'Date (YYYY-MM-DD)',
    'rx.g.winpath': 'Windows path', 'rx.g.guest': 'Guest user name (guest-xxxxxx)', 'rx.g.sid': 'Windows SID', 'rx.g.mac': 'MAC address',
    'rx.explain': 'Plain explanation', 'rx.explainEmpty': 'Empty pattern: everything matches.',
    'rx.dialect': 'Dialect: JavaScript RegExp (ECMAScript). The u flag is added when Unicode is on. Patterns are not saved.',
    'rx.bad': 'That regular expression is not valid: {0}', 'rx.tooLong': 'Patterns are limited to {0} characters.',
    'rx.slowWarn': 'This pattern has nested repeats, for example (a+)+, which can freeze the search.',
    'rx.slowAllow': 'Use it anyway', 'rx.slow': 'Pattern too slow, simplified search used.',
    'rx.timeout': 'The pattern took longer than {0} ms on the sample and was stopped.',
    'rx.sampleCut': 'Sample shortened to {0} characters.',
    'rx.ex.any': 'any character', 'rx.ex.digit': 'a digit', 'rx.ex.ndigit': 'a non-digit', 'rx.ex.space': 'whitespace',
    'rx.ex.nspace': 'non-whitespace', 'rx.ex.word': 'a word character', 'rx.ex.nword': 'a non-word character',
    'rx.ex.start': 'start of text', 'rx.ex.end': 'end of text', 'rx.ex.startLine': 'start of a line', 'rx.ex.endLine': 'end of a line',
    'rx.ex.boundary': 'a word boundary', 'rx.ex.nboundary': 'not a word boundary', 'rx.ex.text': 'the text "{0}"',
    'rx.ex.class': 'one of [{0}]', 'rx.ex.nclass': 'any character except [{0}]', 'rx.ex.group': 'group {0} (',
    'rx.ex.ncgroup': 'a group (', 'rx.ex.named': 'group "{0}" (', 'rx.ex.close': ')', 'rx.ex.or': 'or',
    'rx.ex.look': 'followed by (', 'rx.ex.nlook': 'not followed by (', 'rx.ex.lookb': 'preceded by (', 'rx.ex.nlookb': 'not preceded by (',
    'rx.ex.opt': 'optional', 'rx.ex.star': 'zero or more times', 'rx.ex.plus': 'one or more times', 'rx.ex.exact': 'exactly {0} times',
    'rx.ex.range': 'between {0} and {1} times', 'rx.ex.min': '{0} or more times', 'rx.ex.lazy': '(as few as possible)',
    'rx.ex.backref': 'the same text as group {0}', 'rx.ex.escape': 'the character {0}', 'rx.ex.prop': 'a character with property {0}',
    'rx.ex.then': 'then', 'rx.slowList': 'Pattern too slow, simplified search used.', 'rx.filterFor': 'Filter {0}', 'rx.shown': 'Showing {0} of {1}',
    'tabs.closeContaining': 'Close tabs containing text', 'tabs.closeNotContaining': 'Close tabs not containing text', 'tabs.closePreview': '{0} tabs would close',
    'tabs.closeEmpty': 'Type search text first.', 'tabs.closeUnsaved': '{0} tabs have unsaved changes and are kept.', 'tabs.search': 'Search tabs', 'tabs.closeDone': 'Closed {0} tabs.', 'tabs.pinnedKept': 'Pinned tabs are never closed.'
  };
  function fmt(s, args) { return String(s).replace(/\{(\d+)\}/g, function (m, i) { return args[+i] === undefined ? m : String(args[+i]); }); }
  function makeT(t) {
    return function (key) {
      var args = Array.prototype.slice.call(arguments, 1);
      if (typeof t === 'function') {
        try { var v = t.apply(null, [key].concat(args)); if (v && v !== key) return fmt(v, args); } catch (e) { /* fall back */ }
      }
      return fmt(EN[key] !== undefined ? EN[key] : key, args);
    };
  }

  // ------------------------------------------------------------------------------------------
  // Pure helpers: escape, tokenize, explain, heuristic, compile
  // ------------------------------------------------------------------------------------------
  function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function defaultState() { return { query: '', regex: false, pattern: '', flags: '', caseSensitive: false, wholeWord: false }; }
  function normFlags(f) { var out = ''; 'imsu'.split('').forEach(function (c) { if (String(f || '').indexOf(c) >= 0) out += c; }); return out; }

  // Tokenizer for highlighting, explanation and error positions. Types: literal, escape, class,
  // any, anchor, groupOpen, groupClose, alt, quant, backref.
  function tokenize(p) {
    p = String(p || '');
    var tokens = [], stack = [], i = 0, err = null, errAt = -1, groupN = 0;
    function fail(msg, at) { if (err === null) { err = msg; errAt = at; } }
    var lastAtom = false;
    while (i < p.length) {
      var c = p[i], s = i;
      if (c === '\\') {
        if (i + 1 >= p.length) { fail('Trailing backslash', i); tokens.push({ type: 'escape', start: i, end: i + 1, text: c }); i++; break; }
        var n = p[i + 1], len = 2;
        if (/[pP]/.test(n) && p[i + 2] === '{') { var cl = p.indexOf('}', i + 3); len = cl > 0 ? cl - i + 1 : 2; }
        else if (n === 'x') len = 4; else if (n === 'u') len = p[i + 2] === '{' ? Math.max(2, p.indexOf('}', i) - i + 1) : 6;
        else if (n === 'c') len = 3; else if (n === 'k' && p[i + 2] === '<') { var kc = p.indexOf('>', i); len = kc > 0 ? kc - i + 1 : 2; }
        else if (/[1-9]/.test(n)) { var mm = /^[1-9]\d*/.exec(p.slice(i + 1)); len = 1 + mm[0].length; }
        var tx = p.slice(i, i + len);
        var ty = /^\\[bB]$/.test(tx) ? 'anchor' : (/^\\(?:[1-9]|k<)/.test(tx) ? 'backref' : 'escape');
        tokens.push({ type: ty, start: i, end: i + len, text: tx }); i += len; lastAtom = ty !== 'anchor'; continue;
      }
      if (c === '[') {
        var j = i + 1; if (p[j] === '^') j++; if (p[j] === ']') j++;
        while (j < p.length && p[j] !== ']') { if (p[j] === '\\') j++; j++; }
        if (j >= p.length) { fail('Unterminated character class', i); tokens.push({ type: 'class', start: i, end: p.length, text: p.slice(i) }); i = p.length; break; }
        tokens.push({ type: 'class', start: i, end: j + 1, text: p.slice(i, j + 1) }); i = j + 1; lastAtom = true; continue;
      }
      if (c === '(') {
        var kind = 'group', m2, glen = 1;
        if (p.slice(i, i + 3) === '(?:') { kind = 'ncgroup'; glen = 3; }
        else if (p.slice(i, i + 3) === '(?=') { kind = 'look'; glen = 3; }
        else if (p.slice(i, i + 3) === '(?!') { kind = 'nlook'; glen = 3; }
        else if (p.slice(i, i + 4) === '(?<=') { kind = 'lookb'; glen = 4; }
        else if (p.slice(i, i + 4) === '(?<!') { kind = 'nlookb'; glen = 4; }
        else if ((m2 = /^\(\?<([A-Za-z_$][\w$]*)>/.exec(p.slice(i)))) { kind = 'named'; glen = m2[0].length; groupN++; }
        else if (p[i + 1] === '?') { fail('Invalid group', i); glen = 2; }
        else groupN++;
        var tok = { type: 'groupOpen', kind: kind, start: i, end: i + glen, text: p.slice(i, i + glen), n: (kind === 'group' || kind === 'named') ? groupN : 0, name: m2 && kind === 'named' ? m2[1] : '' };
        tokens.push(tok); stack.push(tok); i += glen; lastAtom = false; continue;
      }
      if (c === ')') {
        if (!stack.length) fail('Unmatched )', i); else stack.pop();
        tokens.push({ type: 'groupClose', start: i, end: i + 1, text: c }); i++; lastAtom = true; continue;
      }
      if (c === '|') { tokens.push({ type: 'alt', start: i, end: i + 1, text: c }); i++; lastAtom = false; continue; }
      if (c === '^' || c === '$') { tokens.push({ type: 'anchor', start: i, end: i + 1, text: c }); i++; lastAtom = false; continue; }
      if (c === '*' || c === '+' || c === '?' || (c === '{' && /^\{\d+(,\d*)?\}/.test(p.slice(i)))) {
        var q = c === '{' ? /^\{\d+(,\d*)?\}/.exec(p.slice(i))[0] : c;
        if (p[i + q.length] === '?') q += '?';
        if (!lastAtom) fail('Nothing to repeat', i);
        if (c === '{') { var nm = /\{(\d+)(?:,(\d*))?\}/.exec(q); if (nm[2] && +nm[2] < +nm[1]) fail('Numbers out of order in {} quantifier', i); }
        tokens.push({ type: 'quant', start: i, end: i + q.length, text: q }); i += q.length; lastAtom = false; continue;
      }
      if (c === '.') { tokens.push({ type: 'any', start: i, end: i + 1, text: c }); i++; lastAtom = true; continue; }
      // literal run (merged later for explanation)
      var cp = p.codePointAt(i), cl2 = cp > 0xffff ? 2 : 1;
      tokens.push({ type: 'literal', start: s, end: s + cl2, text: p.slice(s, s + cl2) }); i += cl2; lastAtom = true;
    }
    if (stack.length) fail('Unterminated group', stack[stack.length - 1].start);
    return { tokens: tokens, error: err, errorIndex: errAt, groups: groupN };
  }

  // Nested quantifier heuristic: a group whose body contains an unbounded quantifier, itself
  // followed by a quantifier, for example (a+)+, (\w*)*, (a|b+){2,}.
  function isCatastrophic(p) {
    // A group is risky when it contains an unbounded repeat and no mandatory fixed token (every
    // atom inside repeats or is optional), and the group itself repeats without an upper bound.
    var tk = tokenize(p).tokens, stack = [{ unb: false, fixed: false }];
    var atom = { literal: 1, escape: 1, class: 1, any: 1, backref: 1 };
    function quantAfter(i) { var n = tk[i + 1]; return n && n.type === 'quant' ? (n.text.length > 1 ? n.text.replace(/\?$/, '') : n.text) : ''; }
    function unbounded(q) { return q === '*' || q === '+' || /^\{\d+,\}$/.test(q); }
    for (var i = 0; i < tk.length; i++) {
      var t = tk[i], top = stack[stack.length - 1];
      if (t.type === 'groupOpen') { stack.push({ unb: false, fixed: false, look: /look/.test(t.kind) }); continue; }
      if (atom[t.type]) { var q = quantAfter(i); if (!q || /^\{[1-9]\d*\}$/.test(q)) top.fixed = true; if (unbounded(q)) top.unb = true; continue; }
      if (t.type === 'groupClose' && stack.length > 1) {
        var g = stack.pop(), q2 = quantAfter(i), parent = stack[stack.length - 1];
        if (g.look) continue;
        if (g.unb && !g.fixed && unbounded(q2)) return true;
        if (g.unb) parent.unb = true;
        if (!q2 && g.fixed) parent.fixed = true;
        if (unbounded(q2)) parent.unb = true;
      }
    }
    return false;
  }

  function explain(p, flags, t) {
    var T = makeT(t);
    var r = tokenize(p);
    if (!String(p || '')) return T('rx.explainEmpty');
    var parts = [], lit = '';
    function flush() { if (lit) { parts.push(T('rx.ex.text', lit)); lit = ''; } }
    var esc = { '\\d': 'rx.ex.digit', '\\D': 'rx.ex.ndigit', '\\s': 'rx.ex.space', '\\S': 'rx.ex.nspace', '\\w': 'rx.ex.word', '\\W': 'rx.ex.nword', '\\b': 'rx.ex.boundary', '\\B': 'rx.ex.nboundary' };
    var ml = String(flags || '').indexOf('m') >= 0;
    r.tokens.forEach(function (tk, idx) {
      var next = r.tokens[idx + 1];
      if (tk.type === 'literal' && !(next && next.type === 'quant')) { lit += tk.text; return; }
      if (tk.type === 'escape' && /^\\[^\w]$/.test(tk.text) && !(next && next.type === 'quant')) { lit += tk.text.slice(1); return; }
      flush();
      switch (tk.type) {
        case 'literal': parts.push(T('rx.ex.text', tk.text)); break;
        case 'any': parts.push(T('rx.ex.any')); break;
        case 'escape':
          if (esc[tk.text]) parts.push(T(esc[tk.text]));
          else if (/^\\[pP]\{/.test(tk.text)) parts.push(T('rx.ex.prop', tk.text.slice(3, -1)));
          else parts.push(T('rx.ex.escape', tk.text)); break;
        case 'anchor':
          if (tk.text === '^') parts.push(T(ml ? 'rx.ex.startLine' : 'rx.ex.start'));
          else if (tk.text === '$') parts.push(T(ml ? 'rx.ex.endLine' : 'rx.ex.end'));
          else parts.push(T(esc[tk.text])); break;
        case 'class': {
          var neg = tk.text[1] === '^', body = tk.text.slice(neg ? 2 : 1, -1);
          parts.push(T(neg ? 'rx.ex.nclass' : 'rx.ex.class', body)); break; }
        case 'groupOpen':
          parts.push(tk.kind === 'group' ? T('rx.ex.group', tk.n) : tk.kind === 'named' ? T('rx.ex.named', tk.name) : T('rx.ex.' + tk.kind)); break;
        case 'groupClose': parts.push(T('rx.ex.close')); break;
        case 'alt': parts.push(T('rx.ex.or')); break;
        case 'backref': parts.push(T('rx.ex.backref', tk.text.replace(/^\\k?<?|>$/g, ''))); break;
        case 'quant': {
          var q = tk.text, lazy = q.length > 1 && q[q.length - 1] === '?' && q !== '?', s;
          var base = lazy ? q.slice(0, -1) : q, m = /^\{(\d+)(?:(,)(\d*))?\}$/.exec(base);
          if (base === '?') s = T('rx.ex.opt'); else if (base === '*') s = T('rx.ex.star'); else if (base === '+') s = T('rx.ex.plus');
          else if (m && !m[2]) s = T('rx.ex.exact', m[1]); else if (m && m[3]) s = T('rx.ex.range', m[1], m[3]); else if (m) s = T('rx.ex.min', m[1]); else s = q;
          var prev = parts.pop() || ''; parts.push(prev + ', ' + s + (lazy ? ' ' + T('rx.ex.lazy') : '')); break; }
      }
    });
    flush();
    var out = '', then = ', ' + T('rx.ex.then') + ' ';
    parts.forEach(function (x, i) {
      if (i === 0) { out = x; return; }
      var prevOpen = /\($/.test(parts[i - 1]), isClose = x === T('rx.ex.close'), isOr = x === T('rx.ex.or') || parts[i - 1] === T('rx.ex.or');
      out += (prevOpen || isClose) ? (isClose ? x : x) : (isOr ? ' ' + x : then + x);
    });
    return out.charAt(0).toUpperCase() + out.slice(1) + '.';
  }

  function nowMs() { return (root && root.performance && root.performance.now) ? root.performance.now() : Date.now(); }

  function compile(query, opts) {
    opts = opts || {};
    var q = String(query == null ? '' : query);
    var base = { ok: true, empty: false, error: '', errorIndex: -1, slow: false, warning: '', source: '' };
    function done(o) { for (var k in base) if (!(k in o)) o[k] = base[k]; return o; }
    if (!q.trim()) return done({ empty: true, test: function () { return true; }, find: function () { return { index: 0, length: 0 }; }, matches: function () { return []; } });
    var ci = opts.caseSensitive !== true; // ignore case unless caseSensitive is true
    if (!opts.regex) {
      var words = q.trim().split(/\s+/).filter(Boolean);
      var flags = 'g' + (ci ? 'i' : '') + 'u';
      var wb = '(?<![\\p{L}\\p{N}_])', we = '(?![\\p{L}\\p{N}_])';
      var res = words.map(function (w) { var e = escapeRegex(w); return new RegExp(opts.wholeWord ? wb + e + we : e, flags); });
      var any = new RegExp(words.map(function (w) { var e = escapeRegex(w); return opts.wholeWord ? wb + e + we : e; }).join('|'), flags);
      var testFn = function (s) { s = String(s); return res.every(function (r) { r.lastIndex = 0; return r.test(s); }); };
      return done({
        source: any.source, plain: true, test: testFn,
        find: function (s) { s = String(s); if (!testFn(s)) return null; res[0].lastIndex = 0; var m = res[0].exec(s); return m ? { index: m.index, length: m[0].length } : null; },
        matches: function (s, limit) { return runAll(any, String(s), limit); }
      });
    }
    if (q.length > LIMITS.pattern) return done({ ok: false, error: 'tooLong', message: 'Patterns are limited to ' + LIMITS.pattern + ' characters.', errorIndex: LIMITS.pattern, test: no, find: nul, matches: none });
    var fl = normFlags(opts.flags).replace('i', '') + (ci ? 'i' : '');
    fl = normFlags(fl);
    var src = opts.wholeWord ? '\\b(?:' + q + ')\\b' : q;
    var re;
    try { re = new RegExp(src, fl); } catch (e) {
      var tk = tokenize(q);
      return done({ ok: false, error: e.message, errorIndex: tk.errorIndex >= 0 ? tk.errorIndex : Math.max(0, q.length - 1), test: no, find: nul, matches: none });
    }
    if (!opts.allowSlow && isCatastrophic(q)) {
      return done({ ok: false, slow: true, error: 'catastrophic', warning: 'Nested quantifiers can freeze the search.', errorIndex: 0, test: no, find: nul, matches: none });
    }
    var g = new RegExp(src, fl + 'g');
    return done({
      source: src, flags: fl, regex: re,
      test: function (s) { re.lastIndex = 0; return re.test(String(s)); },
      find: function (s) { var m = re.exec(String(s)); return m ? { index: m.index, length: m[0].length } : null; },
      matches: function (s, limit) { return runAll(g, String(s), limit); }
    });
  }
  function no() { return false; } function nul() { return null; } function none() { return []; }

  // Global match loop with zero-width protection and a step guard.
  function runAll(g, s, limit) {
    var out = [], max = Math.min(limit || LIMITS.maxMatches, LIMITS.maxMatches), uni = g.unicode, m, steps = 0;
    g.lastIndex = 0;
    while ((m = g.exec(s)) !== null) {
      out.push({ index: m.index, length: m[0].length, groups: Array.prototype.slice.call(m, 1), named: m.groups ? Object.assign({}, m.groups) : null });
      if (m[0].length === 0) { var cp = uni ? s.codePointAt(g.lastIndex) : 0; g.lastIndex += (uni && cp > 0xffff) ? 2 : 1; }
      if (out.length >= max || ++steps > LIMITS.maxMatches * 2 || g.lastIndex > s.length) break;
    }
    return out;
  }

  function toCompiled(x) {
    if (x && typeof x.test === 'function' && 'ok' in x) return x;
    var st = x || {};
    return compile(st.regex ? (st.pattern || st.query) : st.query, st);
  }

  // Filter a list with a per-keystroke budget. When the budget is exceeded the remaining items
  // use plain text matching of the same query and slow is set so the UI can say so.
  function filterItems(items, toText, stateOrCompiled, o) {
    o = o || {};
    var budget = o.budgetMs == null ? LIMITS.budgetMs : o.budgetMs;
    var c = toCompiled(stateOrCompiled);
    var list = Array.prototype.slice.call(items || []);
    toText = toText || String;
    if (!c.ok) return { ok: false, error: c.error, errorIndex: c.errorIndex, slow: !!c.slow, items: [], indexes: [] };
    if (c.empty) return { ok: true, slow: false, items: list, indexes: list.map(function (_, i) { return i; }) };
    var t0 = nowMs(), slow = false, simple = null, outI = [], st = stateOrCompiled || {};
    for (var i = 0; i < list.length; i++) {
      var txt = String(toText(list[i], i));
      var hit;
      if (!slow && nowMs() - t0 > budget) { slow = true; simple = compile(String(st.query || st.pattern || c.source || ''), { regex: false, caseSensitive: false }); }
      hit = slow ? simple.test(txt) : c.test(txt);
      if (hit) outI.push(i);
    }
    return { ok: true, slow: slow, items: outI.map(function (i) { return list[i]; }), indexes: outI };
  }

  // ------------------------------------------------------------------------------------------
  // Worker evaluation (the same file runs inside the worker)
  // ------------------------------------------------------------------------------------------
  var isWorkerScope = typeof document === 'undefined' && typeof self !== 'undefined' && typeof self.postMessage === 'function' && typeof importScripts === 'function';
  if (isWorkerScope) {
    self.onmessage = function (e) {
      var d = e.data || {};
      try {
        var c = compile(d.pattern, d.opts);
        if (!c.ok) { self.postMessage({ id: d.id, ok: false, error: c.error }); return; }
        var m = c.matches(String(d.text || '').slice(0, LIMITS.sample));
        self.postMessage({ id: d.id, ok: true, matches: m, count: m.length });
      } catch (err) { self.postMessage({ id: d.id, ok: false, error: String(err && err.message || err) }); }
    };
  }
  var scriptUrl = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  var worker = null, workerBroken = false, seq = 0;
  function getWorker(url) {
    if (workerBroken || typeof Worker === 'undefined') return null;
    var u = url || scriptUrl || (root && root.TempDeskRegexWorkerUrl) || '';
    if (!u) return null;
    if (!worker) { try { worker = new Worker(u); worker.onerror = function () { workerBroken = true; worker = null; }; } catch (e) { workerBroken = true; return null; } }
    return worker;
  }
  function evaluate(state, text, o) {
    o = o || {};
    var st = state || {}, timeout = o.timeoutMs || LIMITS.timeoutMs;
    var pattern = st.regex ? (st.pattern || st.query) : st.query;
    var opts = { regex: !!st.regex, flags: st.flags, wholeWord: !!st.wholeWord, caseSensitive: !!st.caseSensitive, allowSlow: !!(st.allowSlow || o.allowSlow) };
    text = String(text || '').slice(0, LIMITS.sample);
    var pre = compile(pattern, opts);
    if (!pre.ok) return Promise.resolve({ ok: false, error: pre.error, errorIndex: pre.errorIndex, slow: pre.slow, matches: [], count: 0 });
    if (pre.empty) return Promise.resolve({ ok: true, empty: true, matches: [], count: 0 });
    var w = st.regex ? getWorker(o.workerUrl) : null;
    if (!w) {
      // Synchronous fallback only for short inputs; the match loop has its own step guard.
      // A single exec cannot be interrupted, so overridden nested-repeat patterns never run here.
      if (st.regex && opts.allowSlow && (text.length >= LIMITS.syncInput || isCatastrophic(pattern))) return Promise.resolve({ ok: false, timedOut: true, matches: [], count: 0, error: 'timeout' });
      var src = st.regex && text.length >= LIMITS.syncInput ? text.slice(0, LIMITS.syncInput) : text;
      var mm = pre.matches(src);
      return Promise.resolve({ ok: true, matches: mm, count: mm.length, truncated: src.length < text.length });
    }
    var id = ++seq;
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        try { w.terminate(); } catch (e) { /* ignore */ }
        worker = null; resolve({ ok: false, timedOut: true, error: 'timeout', matches: [], count: 0 });
      }, timeout);
      var handler = function (e) {
        if (!e.data || e.data.id !== id) return;
        clearTimeout(timer); w.removeEventListener('message', handler); resolve(e.data);
      };
      w.addEventListener('message', handler);
      w.postMessage({ id: id, pattern: pattern, opts: opts, text: text });
    });
  }

  var GALLERY = [
    { id: 'ipv4', key: 'rx.g.ipv4', pattern: '\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b', sample: '10.0.0.1 and 192.168.1.254 but not 999.1.1.1' },
    { id: 'email', key: 'rx.g.email', pattern: '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+', sample: 'admin@tempdesk.local, ops+alerts@example.org' },
    { id: 'guid', key: 'rx.g.guid', pattern: '\\b[0-9a-fA-F]{8}-(?:[0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}\\b', sample: '{3F2504E0-4F89-11D3-9A0C-0305E82C3301}' },
    { id: 'date', key: 'rx.g.date', pattern: '\\b(\\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])\\b', sample: 'Created 2026-11-03, expires 2026-12-31' },
    { id: 'winpath', key: 'rx.g.winpath', pattern: '[A-Za-z]:\\\\(?:[^\\\\/:*?"<>|\\r\\n]+\\\\)*[^\\\\/:*?"<>|\\r\\n]*', sample: 'C:\\Windows\\System32\\drivers\\etc\\hosts' },
    { id: 'guest', key: 'rx.g.guest', pattern: '\\bguest-[a-z0-9]{6}\\b', sample: 'guest-a1b2c3 signed in; guest-zz9 is too short' },
    { id: 'sid', key: 'rx.g.sid', pattern: '\\bS-1-\\d+(?:-\\d+)+\\b', sample: 'S-1-5-21-3623811015-3361044348-30300820-1013' },
    { id: 'mac', key: 'rx.g.mac', pattern: '\\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\\b', sample: '00:1A:2B:3C:4D:5E or 00-1a-2b-3c-4d-5e' }
  ];

  // ------------------------------------------------------------------------------------------
  // DOM: attachRegexBuilder
  // ------------------------------------------------------------------------------------------
  var CSS = [
    '.rxb-pop :focus-visible{outline:3px solid var(--primary,#3b6bd6);outline-offset:2px}',
    '.rxb-host{display:flex;gap:6px;align-items:center;flex-wrap:nowrap;min-width:0}',
    '.rxb-field{display:flex;align-items:center;flex:1 1 auto;min-width:0;width:100%;box-sizing:border-box;min-height:40px;padding:0 2px 0 10px;gap:2px;border:1px solid var(--outline2,var(--outline,#8a8a8a));border-radius:var(--radius,10px);background:var(--s1,var(--ground,Field));color:var(--text,FieldText)}',
    '.rxb-field:focus-within{border-color:var(--primary,#3b6bd6);box-shadow:0 0 0 2px var(--primary-soft,rgba(80,120,255,.3))}',
    '.rxb-field .rxb-icon{display:inline-flex;flex:0 0 auto;color:var(--muted,GrayText);margin-right:4px}',
    '.rxb-field input.rxb-input,.rxb-field .rxb-input{flex:1 1 auto!important;min-width:0!important;width:auto!important;max-width:none!important;margin:0!important;padding:8px 2px!important;border:0!important;outline:none!important;box-shadow:none!important;background:transparent!important;color:inherit!important;font:inherit;min-height:0!important;height:auto!important;border-radius:0!important}',
    '.rxb-field .rxb-input::-webkit-search-cancel-button{margin-right:2px}',
    '.rxb-tools{display:inline-flex;flex:0 0 auto;flex-wrap:nowrap;gap:0;align-items:center}',
    '.rxb-ib{position:relative;flex:0 0 auto;width:32px;height:32px;padding:0;margin:0 2px;display:inline-flex;align-items:center;justify-content:center;border:0;border-radius:8px;background:transparent;color:var(--muted,inherit);font:600 13px/1 var(--mono,ui-monospace,Consolas,monospace);cursor:pointer}',
    '.rxb-ib::before{content:"";position:absolute;inset:-6px -2px}',
    '.rxb-ib:hover{background:var(--primary-soft,rgba(80,120,255,.12));color:var(--text,inherit)}',
    '.rxb-ib:focus-visible{outline:2px solid var(--primary,#3b6bd6);outline-offset:0}',
    '.rxb-ib[aria-pressed="true"],.rxb-ib[aria-expanded="true"]{background:var(--primary-soft,rgba(80,120,255,.2));color:var(--primary,#3b6bd6)}',
    '.rxb-field[data-regex="true"] .rxb-open{color:var(--primary,#3b6bd6)}',
    '.rxb-field.rxb-narrow .rxb-tog,.rxb-field.rxb-narrow .rxb-icon{display:none!important}',
    '.rxb-tools[hidden]{display:none!important}',
    '.rxb-host>input{flex:1 1 auto;min-width:0}',
    '.rxb-pop{position:fixed;z-index:2147483000;box-sizing:border-box;width:min(640px,calc(100vw - 16px));max-height:min(78vh,720px);overflow:auto;padding:14px 16px 12px;border:1px solid var(--outline2,var(--outline,#8a8a8a));border-radius:14px;background:var(--surface,var(--ground,Canvas));color:var(--text,CanvasText);box-shadow:var(--shadow,0 12px 40px rgba(0,0,0,.28));font:inherit;font-size:14px;line-height:1.4;overscroll-behavior:contain}',
    '.rxb-pop[hidden]{display:none}',
    '.rxb-pop *{box-sizing:border-box}',
    '.rxb-pop h2{font-size:1.05rem;margin:0}',
    '.rxb-pop h3{font-size:.85rem;margin:12px 0 6px;text-transform:none;color:var(--muted,inherit)}',
    '.rxb-head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.rxb-x{min-width:44px;min-height:44px;border:0;background:transparent;color:inherit;font-size:20px;cursor:pointer;border-radius:10px}',
    '.rxb-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
    '.rxb-chip{min-height:44px;padding:0 12px;border:1px solid var(--outline2,var(--outline,#8a8a8a));border-radius:22px;background:transparent;color:inherit;font:inherit;cursor:pointer}',
    '.rxb-chip:hover{background:var(--primary-soft,rgba(80,120,255,.12))}',
    '.rxb-in{min-height:44px;padding:6px 10px;border:1px solid var(--outline2,var(--outline,#8a8a8a));border-radius:10px;background:transparent;color:inherit;font:inherit;min-width:0}',
    '.rxb-num{width:5.5em}',
    '.rxb-ed{position:relative;font-family:var(--mono,ui-monospace,Consolas,monospace);font-size:14px}',
    '.rxb-ed pre,.rxb-ed textarea{margin:0;padding:10px 12px;min-height:48px;white-space:pre-wrap;word-break:break-all;overflow-wrap:anywhere;font:inherit;line-height:1.5;border-radius:10px}',
    '.rxb-ed pre{position:absolute;inset:0;pointer-events:none;border:1px solid transparent;overflow:hidden}',
    '.rxb-ed textarea{position:relative;display:block;width:100%;resize:vertical;background:transparent;color:transparent;caret-color:var(--text,CanvasText);border:1px solid var(--outline2,var(--outline,#8a8a8a))}',
    '.rxb-ed textarea::selection{background:rgba(80,120,255,.35);color:transparent}',
    '.rxb-t-class{color:var(--x-attr,#b35c00)}.rxb-t-escape,.rxb-t-any{color:var(--x-tag,#1565c0)}.rxb-t-quant{color:var(--coral,#c2185b);font-weight:600}',
    '.rxb-t-groupOpen,.rxb-t-groupClose{color:var(--ok,#2e7d32);font-weight:600}.rxb-t-alt,.rxb-t-anchor{color:var(--x-val,#6a1b9a);font-weight:600}.rxb-t-backref{color:var(--warn,#8d6e00)}',
    '.rxb-err{text-decoration:underline wavy var(--danger,#c62828);text-decoration-thickness:2px;text-underline-offset:3px;background:rgba(198,40,40,.12)}',
    '.rxb-msg{min-height:1.4em;margin:6px 0 0;color:var(--muted,inherit)}.rxb-msg.bad{color:var(--danger,#c62828)}',
    '.rxb-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:4px 12px}',
    '.rxb-check{display:flex;gap:8px;align-items:flex-start;min-height:44px;padding:6px 0}.rxb-check input{width:20px;height:20px;margin:2px 0 0;flex:0 0 auto}',
    '.rxb-check small{display:block;color:var(--muted,inherit)}',
    '.rxb-sample{width:100%;min-height:80px;font-family:var(--mono,ui-monospace,Consolas,monospace);resize:vertical}',
    '.rxb-prev{max-height:120px;overflow:auto;padding:8px 10px;border:1px dashed var(--outline2,var(--outline,#8a8a8a));border-radius:10px;font-family:var(--mono,ui-monospace,Consolas,monospace);white-space:pre-wrap;overflow-wrap:anywhere}',
    '.rxb-prev mark{background:var(--primary-soft,#ffe08a);color:inherit;border-bottom:2px solid var(--primary,#3b6bd6);border-radius:2px}',
    '.rxb-tbl{width:100%;border-collapse:collapse;font-size:13px}.rxb-tbl th,.rxb-tbl td{border-bottom:1px solid var(--outline,#ccc);padding:4px 6px;text-align:left;font-family:var(--mono,ui-monospace,monospace);overflow-wrap:anywhere}',
    '.rxb-tblbox{max-height:160px;overflow:auto}',
    '.rxb-gal{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px}',
    '.rxb-gal li{min-height:44px;padding:8px 10px;border:1px solid var(--outline2,var(--outline,#8a8a8a));border-radius:10px;cursor:pointer}',
    '.rxb-gal li[aria-selected="true"],.rxb-gal li:hover{background:var(--primary-soft,rgba(80,120,255,.12))}',
    '.rxb-gal code{display:block;font-size:11px;opacity:.75;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rxb-foot{margin-top:12px;font-size:12px;color:var(--muted,inherit)}',
    '.rxb-warn{padding:8px 10px;border-radius:10px;background:rgba(255,170,0,.15);margin-top:6px}',
    '.rxb-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '.rxb-filter{display:flex;flex-direction:column;gap:2px;margin:0 0 6px}.rxb-frow{display:flex;gap:6px;align-items:center}.rxb-fin{flex:1 1 auto;width:100%;min-width:0}.rxb-fst:empty{display:none}',
    '.rxb-tab-miss{opacity:.45}',
    '.rxb-pop details>summary{min-height:44px;display:flex;align-items:center;cursor:pointer;font-weight:600}',
    '@media (max-width:599px){.rxb-pop{left:0!important;right:0!important;top:auto!important;bottom:0!important;width:100vw;max-height:85vh;border-radius:16px 16px 0 0}}',
    '@media (prefers-reduced-motion:no-preference){.rxb-pop{animation:rxb-in .14s ease-out}@keyframes rxb-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}}',
    'html[data-motion="off"] .rxb-pop,html[data-motion="reduce"] .rxb-pop{animation:none}'
  ].join('\n');
  function ensureStyles(doc) {
    if (!doc || doc.__rxbStyled) return; doc.__rxbStyled = true;
    try {
      if (doc.adoptedStyleSheets && typeof CSSStyleSheet === 'function') {
        var sh = new CSSStyleSheet(); sh.replaceSync(CSS); doc.adoptedStyleSheets = doc.adoptedStyleSheets.concat([sh]); return;
      }
    } catch (e) { /* fall back */ }
    var st = doc.createElement('style'); st.setAttribute('data-rxb', ''); st.textContent = CSS; (doc.head || doc.documentElement).appendChild(st);
  }

  var uid = 0;
  var active = null; // only one popover open at a time
  function el(doc, tag, attrs, kids) {
    var e = doc.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k]; if (v === null || v === undefined || v === false) continue;
      if (k === 'text') e.textContent = v; else if (k === 'class') e.className = v; else e.setAttribute(k, v === true ? '' : String(v));
    }
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); });
    return e;
  }

  function attachRegexBuilder(input, o) {
    o = o || {};
    if (!input || !input.ownerDocument) throw new Error('attachRegexBuilder needs an input element');
    if (o.dialect && o.dialect !== 'javascript') throw new Error('Only the javascript dialect is supported');
    var doc = input.ownerDocument, win = doc.defaultView || root, T = makeT(o.t), id = 'rxb' + (++uid);
    ensureStyles(doc);
    var state = Object.assign(defaultState(), o.state || {});
    if (o.persistKey) { try { var saved = JSON.parse(win.sessionStorage.getItem('rxb:' + o.persistKey) || 'null'); if (saved) state = Object.assign(state, saved); } catch (e) { /* storage unavailable */ } }
    if (!state.query && input.value) state.query = input.value;
    if (state.regex && !state.pattern) state.pattern = state.query;
    input.value = state.query;
    // Without an explicit label the field's own (translated) aria-label is used and followed live.
    var labelNow = function () { return o.label || input.getAttribute('aria-label') || T('rx.title'); };
    var label = labelNow();
    input.setAttribute('data-rxb', id);
    input.setAttribute('autocomplete', 'off'); input.setAttribute('spellcheck', 'false');

    // The controls live inside the field as a compact trailing segment: search icon, the input,
    // then a ".*" toggle and a builder icon button (32 px visual, 44 px hit area). Under 220 px
    // the toggle collapses and the builder (which has the same switch) remains.
    var toggle = el(doc, 'button', { type: 'button', class: 'rxb-ib rxb-tog', 'aria-pressed': String(!!state.regex), 'aria-label': T('rx.toggle') + ': ' + label, title: T('rx.toggle'), text: '.*' });
    var bbtn = el(doc, 'button', { type: 'button', class: 'rxb-ib rxb-open', 'aria-expanded': 'false', 'aria-haspopup': 'dialog', 'aria-controls': id + '-pop', 'aria-label': T('rx.builderFor', label), title: T('rx.builderFor', label) });
    bbtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 4H6a2 2 0 0 0-2 2v4l-2 2 2 2v4a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v4l2 2-2 2v4a2 2 0 0 1-2 2h-2"/><path d="M9.5 12h5M12 9.5v5"/></svg>';
    var tools = el(doc, 'span', { class: 'rxb-tools', 'data-rxb-for': id }, [toggle, bbtn]);
    var field = null;
    function setPressed(on) { toggle.setAttribute('aria-pressed', String(!!on)); if (field) field.setAttribute('data-regex', String(!!on)); }
    function relabel() {
      label = labelNow();
      toggle.setAttribute('aria-label', T('rx.toggle') + ': ' + label);
      bbtn.setAttribute('aria-label', T('rx.builderFor', label)); bbtn.setAttribute('title', T('rx.builderFor', label));
      if (pop) { var hh = pop.querySelector('h2'); if (hh) hh.textContent = T('rx.title') + ': ' + label; }
    }
    var labelObs = null;
    if (!o.label && typeof MutationObserver === 'function') { labelObs = new MutationObserver(relabel); labelObs.observe(input, { attributes: true, attributeFilter: ['aria-label'] }); }
    if (o.container) o.container.appendChild(tools);
    else {
      field = el(doc, 'span', { class: 'rxb-field', 'data-regex': String(!!state.regex) });
      var icon = el(doc, 'span', { class: 'rxb-icon', 'aria-hidden': 'true' }); icon.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
      if (input.parentNode) input.parentNode.insertBefore(field, input);
      field.appendChild(icon); field.appendChild(input); field.appendChild(tools);
      input.classList.add('rxb-input');
      // Narrow fields (under 220 px) keep only the builder button, which also holds the switch.
      if (typeof ResizeObserver === 'function') new ResizeObserver(function (en) { var w = en[0] && en[0].contentRect ? en[0].contentRect.width : 999; field.classList.toggle('rxb-narrow', w > 0 && w < 220); }).observe(field);
      field.addEventListener('mousedown', function (e) { if (e.target === field || e.target === icon || icon.contains(e.target)) { e.preventDefault(); input.focus(); } });
    }

    // ---- popover ----
    var pop = null, parts = {}, lastFocus = null, allowSlow = false, evalSeq = 0, sampleTouched = false;
    function compiledNow() { return compile(state.regex ? state.pattern : state.query, { regex: state.regex, flags: state.flags, wholeWord: state.wholeWord, caseSensitive: state.caseSensitive, allowSlow: allowSlow }); }
    function emit() {
      if (o.persistKey) { try { win.sessionStorage.setItem('rxb:' + o.persistKey, JSON.stringify(state)); } catch (e) { /* ignore */ } }
      var c = compiledNow();
      input.setAttribute('aria-invalid', String(!c.ok));
      if (typeof o.onChange === 'function') o.onChange(publicState(), c);
    }
    function publicState() { return { query: state.query, regex: !!state.regex, pattern: state.pattern, flags: normFlags(state.flags), caseSensitive: !!state.caseSensitive, wholeWord: !!state.wholeWord }; }
    var tm = null;
    function onInput() {
      state.query = input.value;
      if (state.regex) state.pattern = input.value;
      if (pop && !pop.hidden) syncPopover(false);
      clearTimeout(tm); tm = setTimeout(emit, 120);
    }
    function onKey(e) { if (o.escapeClears !== false && e.key === 'Escape' && input.value && !(pop && !pop.hidden)) { e.stopPropagation(); input.value = ''; onInput(); clearTimeout(tm); emit(); } }
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    toggle.addEventListener('click', function () { setRegex(!state.regex); input.focus(); });
    bbtn.addEventListener('click', function () { if (pop && !pop.hidden) close(); else open(); });

    function setRegex(on) {
      state.regex = !!on;
      setPressed(state.regex);
      if (state.regex) { state.pattern = state.query; }
      if (pop && !pop.hidden) syncPopover(true);
      emit();
    }

    function build() {
      pop = el(doc, 'div', { class: 'rxb-pop', id: id + '-pop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id + '-h', hidden: true });
      var x = el(doc, 'button', { type: 'button', class: 'rxb-x', 'aria-label': T('rx.close'), text: '\u00d7' });
      x.addEventListener('click', function () { close(); });
      pop.appendChild(el(doc, 'div', { class: 'rxb-head' }, [el(doc, 'h2', { id: id + '-h', text: T('rx.title') + ': ' + label }), x]));
      // mode and options
      var useRx = checkbox(T('rx.useRegex'), '', function (v) { setRegex(v); });
      var ww = checkbox(T('rx.wholeWord'), '', function (v) { state.wholeWord = v; syncPopover(true); emit(); });
      var cs = checkbox(T('rx.caseSensitive'), '', function (v) { state.caseSensitive = v; syncFlagsFromCase(); syncPopover(true); emit(); });
      parts.useRx = useRx.input; parts.ww = ww.input; parts.cs = cs.input;
      var optionsSec = [el(doc, 'h3', { text: T('rx.options') }), el(doc, 'div', { class: 'rxb-grid' }, [useRx.el, ww.el, cs.el])];
      // raw editor
      pop.appendChild(el(doc, 'h3', { text: T('rx.pattern') }));
      var pre = el(doc, 'pre', { 'aria-hidden': 'true' });
      var ta = el(doc, 'textarea', { id: id + '-pat', rows: '2', spellcheck: 'false', autocomplete: 'off', 'aria-label': T('rx.pattern'), maxlength: String(LIMITS.pattern), 'aria-describedby': id + '-msg ' + id + '-ex' });
      ta.addEventListener('input', function () {
        state.pattern = ta.value; if (!state.regex) { state.regex = true; setPressed(true); }
        state.query = ta.value; input.value = ta.value; allowSlow = false; syncPopover(false); emit();
      });
      ta.addEventListener('scroll', function () { pre.scrollTop = ta.scrollTop; });
      parts.pre = pre; parts.ta = ta;
      pop.appendChild(el(doc, 'div', { class: 'rxb-ed' }, [pre, ta]));
      parts.msg = el(doc, 'p', { class: 'rxb-msg', id: id + '-msg', role: 'status', 'aria-live': 'polite' });
      parts.warn = el(doc, 'div', { class: 'rxb-warn', hidden: true });
      var allow = el(doc, 'button', { type: 'button', class: 'rxb-chip', text: T('rx.slowAllow') });
      allow.addEventListener('click', function () { allowSlow = true; syncPopover(false); emit(); });
      parts.warn.appendChild(el(doc, 'p', { text: T('rx.slowWarn'), style: null })); parts.warn.appendChild(allow);
      parts.ex = el(doc, 'p', { class: 'rxb-msg', id: id + '-ex' });
      pop.appendChild(parts.msg); pop.appendChild(parts.warn);
      pop.appendChild(el(doc, 'div', {}, [el(doc, 'strong', { text: T('rx.explain') + ': ' }), parts.ex]));
      // tokens
      var tokDet = el(doc, 'details', { open: true }, [el(doc, 'summary', { text: T('rx.tokens') })]);
      var lit = el(doc, 'input', { type: 'text', class: 'rxb-in', 'aria-label': T('rx.literal'), placeholder: T('rx.literalPh') });
      var litBtn = chip(T('rx.insert') + ': ' + T('rx.literal'), function () { if (lit.value) { insert(escapeRegex(lit.value)); lit.value = ''; } });
      tokDet.appendChild(el(doc, 'div', { class: 'rxb-row' }, [lit, litBtn]));
      tokDet.appendChild(el(doc, 'div', { class: 'rxb-row', role: 'group', 'aria-label': T('rx.tokens') }, [
        chip(T('rx.any'), function () { insert('.'); }), chip(T('rx.digit'), function () { insert('\\d'); }),
        chip(T('rx.letter'), function () { insert(state.flags.indexOf('u') >= 0 ? '\\p{L}' : '[A-Za-z]'); }),
        chip(T('rx.space'), function () { insert('\\s'); }), chip(T('rx.word'), function () { insert('\\w'); }),
        chip(T('rx.start'), function () { insert('^'); }), chip(T('rx.end'), function () { insert('$'); }),
        chip(T('rx.boundary'), function () { insert('\\b'); }), chip(T('rx.alt'), function () { insert('|'); })
      ]));
      var cls = el(doc, 'input', { type: 'text', class: 'rxb-in', 'aria-label': T('rx.class'), placeholder: T('rx.classPh') });
      var neg = checkbox(T('rx.negate'), '', function () {});
      tokDet.appendChild(el(doc, 'div', { class: 'rxb-row' }, [cls, neg.el, chip(T('rx.insert') + ': ' + T('rx.class'), function () {
        var body = cls.value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]').replace(/\^/g, '\\^').replace(/\\\\-/g, '\\-');
        if (body) insert('[' + (neg.input.checked ? '^' : '') + body + ']');
      })]));
      var gname = el(doc, 'input', { type: 'text', class: 'rxb-in', 'aria-label': T('rx.namePh'), placeholder: T('rx.namePh'), size: '10' });
      tokDet.appendChild(el(doc, 'div', { class: 'rxb-row' }, [
        chip(T('rx.group'), function () { wrap('(', ')'); }), chip(T('rx.ncgroup'), function () { wrap('(?:', ')'); }),
        gname, chip(T('rx.named'), function () { var n = (gname.value || 'name').replace(/[^\w$]/g, '') || 'name'; if (/^\d/.test(n)) n = '_' + n; wrap('(?<' + n + '>', ')'); }),
        chip(T('rx.lookahead'), function () { wrap('(?=', ')'); }), chip(T('rx.nlookahead'), function () { wrap('(?!', ')'); }),
        chip(T('rx.lookbehind'), function () { wrap('(?<=', ')'); }), chip(T('rx.nlookbehind'), function () { wrap('(?<!', ')'); })
      ]));
      var lazy = checkbox(T('rx.lazy'), '', function () {});
      var nIn = el(doc, 'input', { type: 'number', min: '0', max: '9999', value: '2', class: 'rxb-in rxb-num', 'aria-label': T('rx.n') });
      var mIn = el(doc, 'input', { type: 'number', min: '0', max: '9999', value: '4', class: 'rxb-in rxb-num', 'aria-label': T('rx.m') });
      function q(s) { insert(s + (lazy.input.checked ? '?' : '')); }
      tokDet.appendChild(el(doc, 'p', { class: 'rxb-msg', text: T('rx.quant') }));
      tokDet.appendChild(el(doc, 'div', { class: 'rxb-row' }, [
        chip(T('rx.optional'), function () { q('?'); }), chip(T('rx.zeroMore'), function () { q('*'); }), chip(T('rx.oneMore'), function () { q('+'); }),
        nIn, chip(T('rx.exactly'), function () { insert('{' + (parseInt(nIn.value, 10) || 0) + '}'); }),
        mIn, chip(T('rx.between'), function () { var a = parseInt(nIn.value, 10) || 0, b = parseInt(mIn.value, 10) || 0; q('{' + Math.min(a, b) + ',' + Math.max(a, b) + '}'); }),
        lazy.el
      ]));
      pop.appendChild(tokDet);
      // flags
      pop.appendChild(el(doc, 'h3', { text: T('rx.flags') }));
      parts.flags = {};
      var fg = el(doc, 'div', { class: 'rxb-grid' });
      [['i', 'rx.flagI'], ['m', 'rx.flagM'], ['s', 'rx.flagS'], ['u', 'rx.flagU']].forEach(function (f) {
        var cb = checkbox(T(f[1]), T(f[1] + 'Help'), function (v) {
          var fl = normFlags(state.flags).replace(f[0], ''); if (v) fl += f[0]; state.flags = normFlags(fl);
          if (f[0] === 'i') state.caseSensitive = !v;
          syncPopover(true); emit();
        });
        parts.flags[f[0]] = cb.input; fg.appendChild(cb.el);
      });
      pop.appendChild(fg);
      optionsSec.forEach(function (n) { pop.appendChild(n); });
      // sample
      // Sample and live matches sit right under the pattern so tokens show their effect at once.
      var sampleSec = el(doc, 'div', { class: 'rxb-samplesec' }, [el(doc, 'h3', { text: T('rx.sample') })]);
      var sample = el(doc, 'textarea', { class: 'rxb-in rxb-sample', rows: '2', 'aria-label': T('rx.sample'), placeholder: T('rx.samplePh'), maxlength: String(LIMITS.sample), spellcheck: 'false' });
      sample.addEventListener('input', function () { sampleTouched = true; runSample(); });
      parts.sample = sample; sampleSec.appendChild(sample);
      parts.count = el(doc, 'p', { class: 'rxb-msg', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
      parts.prev = el(doc, 'div', { class: 'rxb-prev', 'aria-label': T('rx.preview'), role: 'region', tabindex: '0' });
      parts.groups = el(doc, 'div', { class: 'rxb-tblbox', tabindex: '0', role: 'region', 'aria-label': T('rx.groups') });
      sampleSec.appendChild(parts.count); sampleSec.appendChild(parts.prev); sampleSec.appendChild(parts.groups);
      pop.insertBefore(sampleSec, tokDet);
      // copy / export
      parts.copyMsg = el(doc, 'span', { class: 'rxb-msg', role: 'status', 'aria-live': 'polite' });
      pop.appendChild(el(doc, 'div', { class: 'rxb-row', style: null }, [
        chip(T('rx.copy'), function () { copy(state.pattern || state.query); }),
        chip(T('rx.copyJs'), function () { copy(jsLiteral()); }),
        chip(T('rx.export'), function () { exportJson(); }), parts.copyMsg
      ]));
      // gallery
      var galDet = el(doc, 'details', {}, [el(doc, 'summary', { text: T('rx.gallery') })]);
      // search-exempt: the eight fixed patterns of the builder's own gallery
      var ul = el(doc, 'ul', { class: 'rxb-gal', role: 'listbox', 'aria-label': T('rx.gallery'), tabindex: '0' });
      var gi = 0;
      GALLERY.forEach(function (g, i) {
        var li = el(doc, 'li', { role: 'option', id: id + '-g' + i, 'aria-selected': 'false' }, [el(doc, 'span', { text: T(g.key) }), el(doc, 'code', { text: g.pattern })]);
        li.addEventListener('click', function () { useGallery(i); });
        ul.appendChild(li);
      });
      function markG() { Array.prototype.forEach.call(ul.children, function (li, i) { li.setAttribute('aria-selected', String(i === gi)); }); ul.setAttribute('aria-activedescendant', id + '-g' + gi); }
      ul.addEventListener('focus', markG);
      ul.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); gi = Math.min(GALLERY.length - 1, gi + 1); markG(); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); gi = Math.max(0, gi - 1); markG(); }
        else if (e.key === 'Home') { e.preventDefault(); gi = 0; markG(); } else if (e.key === 'End') { e.preventDefault(); gi = GALLERY.length - 1; markG(); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); useGallery(gi); }
      });
      function useGallery(i) {
        var g = GALLERY[i]; gi = i; markG();
        state.regex = true; state.pattern = g.pattern; state.query = g.pattern; input.value = g.pattern; setPressed(true);
        if (!sampleTouched && !parts.sample.value) parts.sample.value = g.sample;
        syncPopover(true); emit();
      }
      galDet.appendChild(ul); pop.appendChild(galDet);
      pop.appendChild(el(doc, 'p', { class: 'rxb-foot', text: T('rx.dialect') }));
      pop.addEventListener('keydown', trap);
      doc.body.appendChild(pop);
    }
    function chip(text, fn) { var b = el(doc, 'button', { type: 'button', class: 'rxb-chip', text: text }); b.addEventListener('click', fn); return b; }
    function checkbox(text, help, fn) {
      var cid = id + '-c' + (++uid);
      var inp = el(doc, 'input', { type: 'checkbox', id: cid });
      inp.addEventListener('change', function () { fn(inp.checked); });
      var lab = el(doc, 'label', { class: 'rxb-check', for: cid }, [inp, el(doc, 'span', {}, [text, help ? el(doc, 'small', { text: help }) : null])]);
      return { el: lab, input: inp };
    }
    function syncFlagsFromCase() { var fl = normFlags(state.flags).replace('i', ''); if (!state.caseSensitive) fl += 'i'; state.flags = normFlags(fl); }
    function insert(text, after) {
      var ta = parts.ta, s = ta.selectionStart == null ? ta.value.length : ta.selectionStart, e = ta.selectionEnd == null ? s : ta.selectionEnd;
      if (!state.regex) { state.regex = true; setPressed(true); if (!state.pattern) { state.pattern = state.query ? escapeRegex(state.query) : ''; ta.value = state.pattern; s = e = ta.value.length; } }
      var v = ta.value.slice(0, s) + text + (after || '') + ta.value.slice(e);
      if (v.length > LIMITS.pattern) { parts.msg.textContent = T('rx.tooLong', LIMITS.pattern); parts.msg.classList.add('bad'); return; }
      ta.value = v; state.pattern = v; state.query = v; input.value = v;
      var caret = s + text.length; try { ta.focus(); ta.setSelectionRange(caret, caret); } catch (er) { /* ignore */ }
      syncPopover(false); emit();
    }
    function wrap(a, b) {
      var ta = parts.ta, s = ta.selectionStart || 0, e = ta.selectionEnd || s;
      if (e > s) { var sel = ta.value.slice(s, e); ta.setSelectionRange(s, e); insert(a + sel, b); try { ta.setSelectionRange(s + a.length + sel.length, s + a.length + sel.length); } catch (er) { /* ignore */ } }
      else { insert(a, b); }
    }
    function jsLiteral() {
      var p = state.regex ? state.pattern : escapeRegex(state.query);
      var c = compiledNow();
      return '/' + (p || '(?:)').replace(/(^|[^\\])\//g, '$1\\/') + '/' + (c.flags || normFlags((state.caseSensitive ? '' : 'i') + state.flags));
    }
    function exportJson() {
      var data = JSON.stringify({ dialect: 'javascript', pattern: state.regex ? state.pattern : escapeRegex(state.query), flags: normFlags((state.caseSensitive ? '' : 'i') + state.flags.replace('i', '')), regex: !!state.regex, wholeWord: !!state.wholeWord, caseSensitive: !!state.caseSensitive }, null, 2);
      try {
        var blob = new win.Blob([data], { type: 'application/json' }), a = doc.createElement('a');
        a.href = win.URL.createObjectURL(blob); a.download = 'pattern.json'; doc.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { win.URL.revokeObjectURL(a.href); }, 1000);
      } catch (e) { copy(data); }
    }
    function copy(text) {
      var ok = function () { parts.copyMsg.textContent = T('rx.copied'); };
      try { if (win.navigator && win.navigator.clipboard) { win.navigator.clipboard.writeText(text).then(ok, ok); return; } } catch (e) { /* fall through */ }
      ok();
    }
    function highlight(p, errAt) {
      var r = tokenize(p), html = '', pos = 0;
      function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
      function seg(s, start, cls) {
        if (errAt >= start && errAt < start + s.length) {
          var k = errAt - start;
          return (k ? '<span class="' + cls + '">' + esc(s.slice(0, k)) + '</span>' : '') + '<span class="' + cls + ' rxb-err">' + esc(s.slice(k, k + 1)) + '</span>' + (k + 1 < s.length ? '<span class="' + cls + '">' + esc(s.slice(k + 1)) + '</span>' : '');
        }
        return '<span class="' + cls + '">' + esc(s) + '</span>';
      }
      r.tokens.forEach(function (t) { if (t.start > pos) html += esc(p.slice(pos, t.start)); html += seg(p.slice(t.start, t.end), t.start, 'rxb-t-' + t.type); pos = t.end; });
      if (pos < p.length) html += esc(p.slice(pos));
      if (errAt >= p.length && p.length) html += '<span class="rxb-err"> </span>';
      return html + '\n';
    }
    function syncPopover(full) {
      if (!pop) return;
      var p = state.regex ? state.pattern : state.query;
      if (full || doc.activeElement !== parts.ta) parts.ta.value = state.regex ? state.pattern : (state.pattern || '');
      parts.useRx.checked = !!state.regex; parts.ww.checked = !!state.wholeWord; parts.cs.checked = !!state.caseSensitive;
      parts.flags.i.checked = !state.caseSensitive;
      ['m', 's', 'u'].forEach(function (f) { parts.flags[f].checked = state.flags.indexOf(f) >= 0; });
      var c = compiledNow();
      parts.pre.innerHTML = highlight(parts.ta.value, state.regex && !c.ok && !c.slow ? c.errorIndex : -1);
      parts.ta.setAttribute('aria-invalid', String(!c.ok));
      parts.msg.classList.toggle('bad', !c.ok && !c.slow);
      if (!c.ok && c.error === 'tooLong') parts.msg.textContent = T('rx.tooLong', LIMITS.pattern);
      else if (!c.ok && !c.slow) parts.msg.textContent = T('rx.bad', c.error);
      else parts.msg.textContent = '';
      parts.warn.hidden = !c.slow;
      parts.ex.textContent = state.regex ? explain(state.pattern, state.flags, o.t) : explain(escapeRegex(p || ''), '', o.t);
      runSample();
    }
    function runSample() {
      if (!pop) return;
      var text = parts.sample.value.slice(0, LIMITS.sample), my = ++evalSeq;
      var st = publicState(); st.allowSlow = allowSlow;
      evaluate(st, text, { workerUrl: o.workerUrl }).then(function (r) {
        if (my !== evalSeq || !pop) return;
        var frag = doc.createDocumentFragment(), pos = 0;
        (r.matches || []).slice(0, 1000).forEach(function (m) {
          if (m.index > pos) frag.appendChild(doc.createTextNode(text.slice(pos, m.index)));
          frag.appendChild(el(doc, 'mark', { text: m.length ? text.slice(m.index, m.index + m.length) : '\u200b' }));
          pos = m.index + m.length;
        });
        frag.appendChild(doc.createTextNode(text.slice(pos)));
        parts.prev.replaceChildren(frag);
        var firstMark = parts.prev.querySelector('mark');
        if (firstMark && firstMark.offsetTop !== undefined) parts.prev.scrollTop = Math.max(0, firstMark.offsetTop - parts.prev.offsetTop - 24);
        if (r.timedOut) parts.count.textContent = T('rx.timeout', LIMITS.timeoutMs);
        else if (!r.ok) parts.count.textContent = '';
        else parts.count.textContent = !text || r.empty ? '' : r.count === 1 ? T('rx.count1') : r.count ? T('rx.count', r.count) : T('rx.count0');
        // capture group table
        var ms = (r.matches || []).filter(function (m) { return m.groups && m.groups.length; }).slice(0, LIMITS.groupRows);
        if (!ms.length) { parts.groups.replaceChildren(); return; }
        var n = ms[0].groups.length, head = el(doc, 'tr', {}, [el(doc, 'th', { scope: 'col', text: T('rx.match') })]);
        for (var g = 1; g <= n; g++) head.appendChild(el(doc, 'th', { scope: 'col', text: T('rx.groupN', g) }));
        var tb = el(doc, 'tbody');
        ms.forEach(function (m) { var tr = el(doc, 'tr', {}, [el(doc, 'td', { text: text.slice(m.index, m.index + m.length) })]); m.groups.forEach(function (x) { tr.appendChild(el(doc, 'td', { text: x == null ? '' : String(x) })); }); tb.appendChild(tr); });
        // search-exempt: capture groups of the sample matches (bounded to 50 rows)
        parts.groups.replaceChildren(el(doc, 'table', { class: 'rxb-tbl' }, [el(doc, 'caption', { class: 'rxb-sr', text: T('rx.groups') }), el(doc, 'thead', {}, [head]), tb]));
      });
    }
    function position() {
      if (!pop || pop.hidden) return;
      var vw = win.innerWidth || 1024, vh = win.innerHeight || 768;
      if (vw < 600) { pop.style.left = '0px'; pop.style.top = 'auto'; return; }
      var r = (field || input).getBoundingClientRect(), pw = Math.min(640, vw - 16), ph = pop.offsetHeight || 400;
      var left = Math.max(8, Math.min(r.left, vw - pw - 8));
      var below = vh - r.bottom - 8, above = r.top - 8, top;
      if (below >= ph || below >= above) top = Math.min(r.bottom + 6, Math.max(8, vh - ph - 8));
      else top = Math.max(8, r.top - 6 - ph);
      pop.style.left = left + 'px'; pop.style.top = top + 'px'; pop.style.maxHeight = Math.max(240, Math.min(720, (below >= above ? below : above) - 6, vh - 16)) + 'px';
    }
    function focusables() { return Array.prototype.filter.call(pop.querySelectorAll('button,input,textarea,select,summary,[tabindex]:not([tabindex="-1"])'), function (n) { return !n.disabled && n.offsetParent !== null || n === doc.activeElement; }); }
    function trap(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== 'Tab') return;
      var f = focusables(); if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function outside(e) { if (!pop || pop.hidden) return; if (pop.contains(e.target) || tools.contains(e.target) || e.target === input || (field && field.contains(e.target))) return; close(true); }
    function open() {
      if (active && active !== api) active.close();
      if (!pop) build();
      lastFocus = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : bbtn;
      relabel();
      if (!sampleTouched && !parts.sample.value && typeof o.sampleProvider === 'function') {
        try { parts.sample.value = String(o.sampleProvider() || '').slice(0, LIMITS.sample); } catch (e) { /* ignore */ }
      }
      if (!state.pattern && state.query && !state.regex) parts.ta.value = '';
      pop.hidden = false; bbtn.setAttribute('aria-expanded', 'true'); active = api;
      syncPopover(true); position();
      doc.addEventListener('pointerdown', outside, true);
      if (win.addEventListener) { win.addEventListener('resize', position); win.addEventListener('scroll', position, true); }
      try { parts.ta.focus({ preventScroll: true }); } catch (e) { parts.ta.focus(); }
    }
    function close(noFocus) {
      if (!pop || pop.hidden) return;
      pop.hidden = true; bbtn.setAttribute('aria-expanded', 'false'); if (active === api) active = null;
      doc.removeEventListener('pointerdown', outside, true);
      if (win.removeEventListener) { win.removeEventListener('resize', position); win.removeEventListener('scroll', position, true); }
      if (!noFocus) { try { (lastFocus && lastFocus.isConnected ? lastFocus : bbtn).focus(); } catch (e) { /* ignore */ } }
      if (input.isConnected === false) { pop.remove(); pop = null; } // the field was re-rendered away
    }
    function destroy() {
      close(true); clearTimeout(tm); if (labelObs) labelObs.disconnect();
      input.removeEventListener('input', onInput); input.removeEventListener('keydown', onKey);
      tools.remove(); if (pop) pop.remove(); pop = null; input.removeAttribute('data-rxb');
      if (field && field.parentNode) { field.parentNode.insertBefore(input, field); field.remove(); input.classList.remove('rxb-input'); }
    }
    var api = {
      open: open, close: close, destroy: destroy, el: tools, field: field, toggle: toggle, builderButton: bbtn, input: input,
      get state() { return publicState(); },
      set: function (s) {
        state = Object.assign(state, s || {}); state.flags = normFlags(state.flags);
        if (state.regex && s && s.pattern === undefined) state.pattern = state.query;
        if (state.regex && s && s.query === undefined) state.query = state.pattern;
        input.value = state.query; setPressed(state.regex);
        if (pop && !pop.hidden) syncPopover(true);
        emit();
      },
      compiled: compiledNow,
      fire: emit
    };
    input.__rxb = api;
    return api;
  }

  // ------------------------------------------------------------------------------------------
  // attachListFilter: an independent search field with the builder in front of any list, tree,
  // table body, listbox or menu. Items that do not match are hidden; tree ancestors of matches
  // stay visible and expanded while a query is active. Re-applies when the list re-renders.
  //   attachListFilter(listEl, { label, t, items() -> Element[], text(el) -> string, mount, place:
  //     'before' | 'after' | 'prepend', tree: bool, placeholder, onFilter(result), sampleProvider })
  //   -> { el, input, builder, refresh(), destroy(), get shown(), get total() }
  // ------------------------------------------------------------------------------------------
  function insertAfter(ref, node) {
    if (ref.insertAdjacentElement) { ref.insertAdjacentElement('afterend', node); return; }
    var p = ref.parentNode, kids = p.childNodes, i = kids.indexOf ? kids.indexOf(ref) : Array.prototype.indexOf.call(kids, ref);
    p.insertBefore(node, kids[i + 1] || null);
  }
  function ownText(el) {
    var out = '';
    (function walk(n) {
      Array.prototype.forEach.call(n.childNodes || [], function (c) {
        if (c.nodeType === 3) out += c.textContent + ' ';
        else if (c.nodeType === 1 && !(c.getAttribute && (c.getAttribute('role') === 'group' || c.getAttribute('aria-hidden') === 'true')) && !(c.classList && c.classList.contains('rxb-filter'))) walk(c);
      });
    })(el);
    return out;
  }
  function attachListFilter(list, o) {
    o = o || {};
    var doc = list.ownerDocument, T = makeT(o.t), fid = 'rxf' + (++uid);
    ensureStyles(doc);
    var label = o.label || T('rx.filterFor', list.getAttribute('aria-label') || '');
    var input = el(doc, 'input', { type: 'search', id: fid, class: 'rxb-in rxb-fin', 'aria-label': label, placeholder: o.placeholder || label, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', 'aria-describedby': fid + '-st' });
    var status = el(doc, 'span', { class: 'rxb-msg rxb-fst', id: fid + '-st', role: 'status', 'aria-live': 'polite' });
    var row = el(doc, 'div', { class: 'rxb-host rxb-frow' }, [input]);
    var wrap = el(doc, 'div', { class: 'rxb-filter', role: 'search', 'data-rxb-list': o.id || '' }, [row, status]);
    var mount = o.mount || list, place = o.place || 'before';
    if (place === 'prepend') mount.insertBefore(wrap, mount.firstChild || null);
    else if (place === 'after') insertAfter(mount, wrap);
    else mount.parentNode.insertBefore(wrap, mount);
    var cur = null, shown = 0, total = 0, applying = false;
    var itemsOf = o.items ? function () { return Array.prototype.slice.call(o.items(list) || []); } : function () {
      if (o.tree) return Array.prototype.slice.call(list.querySelectorAll('[role="treeitem"]'));
      return Array.prototype.filter.call(list.children, function (c) { return !(c.classList && (c.classList.contains('rxb-filter') || c.classList.contains('rxb-keep'))); });
    };
    var textOf = o.text || function (it) { return it.tagName === 'OPTION' ? it.textContent : ownText(it).replace(/\s+/g, ' ').trim(); };
    function apply() {
      if (applying) return; applying = true;
      try {
        var items = itemsOf(), st = cur || defaultState();
        var c = compile(st.regex ? st.pattern : st.query, st);
        total = items.length;
        items.forEach(function (it) { if (it.__rxbPrev === undefined) it.__rxbPrev = !!it.hidden; });
        if (!c.ok) { status.textContent = c.slow ? T('rx.slowWarn') : T('rx.bad', c.error); status.classList.add('bad'); applying = false; return; }
        status.classList.remove('bad');
        if (c.empty) {
          items.forEach(function (it) { it.hidden = it.__rxbPrev; it.__rxbPrev = undefined; restoreGroup(it); });
          shown = total; status.textContent = ''; if (o.onFilter) o.onFilter({ shown: shown, total: total, empty: true }); applying = false; return;
        }
        var r = filterItems(items, function (it) { return textOf(it); }, c, { budgetMs: LIMITS.budgetMs });
        if (r.slow) { var st2 = Object.assign({}, st); r = filterItems(items, function (it) { return textOf(it); }, compile(st.query || st.pattern, { regex: false, caseSensitive: !!st.caseSensitive })); r.slow = true; }
        var keep = new Set(r.items);
        if (o.tree) {
          r.items.forEach(function (it) { var n = it.parentNode; while (n && n !== list) { if (n.getAttribute && n.getAttribute('role') === 'treeitem') keep.add(n); if (n.getAttribute && n.getAttribute('role') === 'group' && n.hidden) { n.__rxbGroup = true; n.hidden = false; } n = n.parentNode; } });
        }
        shown = 0;
        items.forEach(function (it) { var k = keep.has(it); it.hidden = !k; if (k) shown++; });
        status.textContent = (r.slow ? T('rx.slow') + ' ' : '') + T('rx.shown', shown, total);
        if (o.onFilter) o.onFilter({ shown: shown, total: total, slow: r.slow });
      } finally { applying = false; }
    }
    function restoreGroup(it) { Array.prototype.forEach.call(it.querySelectorAll ? it.querySelectorAll('[role="group"]') : [], function (g) { if (g.__rxbGroup) { g.hidden = true; g.__rxbGroup = false; } }); }
    var builder = attachRegexBuilder(input, { label: label, t: o.t, state: o.state, sampleProvider: o.sampleProvider || function () { return itemsOf().slice(0, 200).map(function (it) { return textOf(it).replace(/\s+/g, ' ').trim(); }).join('\n'); }, workerUrl: o.workerUrl, onChange: function (st) { cur = st; if (o.onState) o.onState(st); apply(); }, noHostClass: true });
    if (o.state && (o.state.query || o.state.pattern)) { cur = builder.state; apply(); }
    var mo = null;
    if (typeof MutationObserver === 'function') { mo = new MutationObserver(function () { if (cur && (cur.query || cur.pattern)) apply(); }); mo.observe(list, { childList: true, subtree: !!o.tree }); }
    var api = { el: wrap, input: input, builder: builder, refresh: apply, get shown() { return shown; }, get total() { return total; },
      destroy: function () { if (mo) mo.disconnect(); builder.destroy(); wrap.remove(); } };
    list.__rxbFilter = api;
    return api;
  }

  // ------------------------------------------------------------------------------------------
  // attachTabCloser: search for a tab strip plus "Close tabs containing text" and "Close tabs not
  // containing text" with a live preview count. Empty queries never close anything, pinned tabs
  // are excluded, and tabs with unsaved work are kept unless confirmUnsaved(list) returns true.
  //   attachTabCloser(stripEl, { label, t, tabs() -> [{ id, text, el?, pinned?, dirty? }],
  //     close(ids), confirmUnsaved(tabs) -> bool, mount, place }) -> { el, input, builder, preview(), destroy() }
  // ------------------------------------------------------------------------------------------
  function attachTabCloser(strip, o) {
    o = o || {};
    var doc = strip.ownerDocument, T = makeT(o.t), fid = 'rxt' + (++uid);
    ensureStyles(doc);
    var label = o.label || T('tabs.search');
    var input = el(doc, 'input', { type: 'search', id: fid, class: 'rxb-in rxb-fin', 'aria-label': label, placeholder: label, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': fid + '-st' });
    var bIn = el(doc, 'button', { type: 'button', class: 'rxb-chip rxb-close-in', disabled: true, text: T('tabs.closeContaining') });
    var bOut = el(doc, 'button', { type: 'button', class: 'rxb-chip rxb-close-out', disabled: true, text: T('tabs.closeNotContaining') });
    var status = el(doc, 'span', { class: 'rxb-msg rxb-fst', id: fid + '-st', role: 'status', 'aria-live': 'polite' });
    var wrap = el(doc, 'div', { class: 'rxb-filter rxb-tabclose', role: 'search', 'data-rxb-list': o.id || '' }, [el(doc, 'div', { class: 'rxb-host rxb-frow' }, [input]), el(doc, 'div', { class: 'rxb-row' }, [bIn, bOut]), status]);
    var mount = o.mount || strip, place = o.place || 'before';
    if (place === 'prepend') mount.insertBefore(wrap, mount.firstChild || null); else if (place === 'after') insertAfter(mount, wrap); else mount.parentNode.insertBefore(wrap, mount);
    var cur = null;
    function plan() {
      var st = cur || defaultState(), tabs = (o.tabs ? o.tabs() : []) || [];
      var c = compile(st.regex ? st.pattern : st.query, st);
      if (!c.ok || c.empty) return { ok: c.ok, empty: c.empty, error: c.error, inSet: [], outSet: [], tabs: tabs };
      var r = filterItems(tabs, function (x) { return x.text; }, c);
      var hit = new Set(r.items), closable = tabs.filter(function (x) { return !x.pinned; });
      return { ok: true, slow: r.slow, tabs: tabs, hit: hit, inSet: closable.filter(function (x) { return hit.has(x); }), outSet: closable.filter(function (x) { return !hit.has(x); }) };
    }
    function preview() {
      var p = plan();
      (p.tabs || []).forEach(function (x) { if (x.el) x.el.classList.toggle('rxb-tab-miss', !!(p.hit && !p.hit.has(x))); });
      bIn.disabled = !p.ok || p.empty || !p.inSet.length; bOut.disabled = !p.ok || p.empty || !p.outSet.length;
      bIn.textContent = T('tabs.closeContaining') + (p.ok && !p.empty ? ' (' + p.inSet.length + ')' : '');
      bOut.textContent = T('tabs.closeNotContaining') + (p.ok && !p.empty ? ' (' + p.outSet.length + ')' : '');
      if (!p.ok) status.textContent = T('rx.bad', p.error);
      else if (p.empty) status.textContent = '';
      else status.textContent = (p.slow ? T('rx.slow') + ' ' : '') + T('rx.shown', p.hit.size, p.tabs.length);
      return p;
    }
    function run(which) {
      var p = preview();
      if (!p.ok || p.empty) { status.textContent = T('tabs.closeEmpty'); return []; }
      var set = which === 'in' ? p.inSet : p.outSet;
      var dirty = set.filter(function (x) { return x.dirty; });
      if (dirty.length && !(o.confirmUnsaved && o.confirmUnsaved(dirty))) set = set.filter(function (x) { return !x.dirty; });
      var ids = set.map(function (x) { return x.id; });
      if (ids.length && o.close) o.close(ids);
      status.textContent = T('tabs.closeDone', ids.length) + (dirty.length && set.length !== (which === 'in' ? p.inSet : p.outSet).length ? ' ' + T('tabs.closeUnsaved', dirty.length) : '');
      setTimeout(preview, 0);
      return ids;
    }
    bIn.addEventListener('click', function () { run('in'); });
    bOut.addEventListener('click', function () { run('out'); });
    var builder = attachRegexBuilder(input, { label: label, t: o.t, state: o.state, workerUrl: o.workerUrl, sampleProvider: function () { return ((o.tabs && o.tabs()) || []).map(function (x) { return x.text; }).join('\n'); }, onChange: function (st) { cur = st; if (o.onState) o.onState(st); preview(); }, noHostClass: true });
    if (o.state && o.state.query) { cur = builder.state; preview(); }
    return { el: wrap, input: input, builder: builder, preview: preview, closeContaining: function () { return run('in'); }, closeNotContaining: function () { return run('out'); }, destroy: function () { builder.destroy(); wrap.remove(); } };
  }

  return {
    attachRegexBuilder: attachRegexBuilder, attachListFilter: attachListFilter, attachTabCloser: attachTabCloser, compile: compile, filterItems: filterItems, evaluate: evaluate,
    explain: explain, tokenize: tokenize, isCatastrophic: isCatastrophic, escapeRegex: escapeRegex,
    defaultState: defaultState, GALLERY: GALLERY, LIMITS: LIMITS, STRINGS: EN, version: '1.0.0'
  };
});
