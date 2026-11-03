// Unit tests for the shared regex builder's pure parts (assets/regex-builder.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import R, { compile, filterItems, evaluate, explain, tokenize, isCatastrophic, escapeRegex, GALLERY, LIMITS, STRINGS } from '../assets/regex-builder.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('plain text is the default: all words in any order, case-insensitive, literal characters', () => {
  const c = compile('disk  GUEST');
  assert.ok(c.ok && !c.empty);
  assert.equal(c.test('Guest PC disk layout'), true);
  assert.equal(c.test('guest only'), false);
  assert.equal(compile('a.b').test('axb'), false, 'a dot is literal in plain text');
  assert.equal(compile('a.b').test('xa.by'), true);
  assert.equal(compile('(').ok, true, 'brackets are fine in plain text');
  assert.deepEqual(compile('disk').find('My Disk'), { index: 3, length: 4 });
});

test('empty queries match everything and produce no matches', () => {
  const c = compile('   ', { regex: true });
  assert.equal(c.empty, true);
  assert.equal(c.test('anything'), true);
  assert.deepEqual(c.matches('abc'), []);
});

test('valid and invalid regular expressions, with an error position', () => {
  const ok = compile('^guest-[a-z0-9]{6}$', { regex: true });
  assert.ok(ok.ok);
  assert.equal(ok.test('guest-a1b2c3'), true);
  assert.equal(ok.test('guest-a1b2c'), false);
  const bad = compile('ab(cd', { regex: true });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Unterminated group|Invalid/);
  assert.equal(bad.errorIndex, 2, 'points at the unclosed group');
  assert.equal(bad.test('ab(cd'), false);
  assert.equal(compile('a)', { regex: true }).errorIndex, 1);
  assert.equal(compile('[abc', { regex: true }).errorIndex, 0);
  assert.equal(compile('*a', { regex: true }).errorIndex, 0);
  assert.equal(compile('a{3,1}', { regex: true }).ok, false);
});

test('flags: case sensitivity, multiline, dot matches newline, Unicode', () => {
  assert.equal(compile('abc', { regex: true }).test('ABC'), true, 'ignore case by default');
  assert.equal(compile('abc', { regex: true, caseSensitive: true }).test('ABC'), false);
  assert.equal(compile('abc', { caseSensitive: true }).test('ABC'), false, 'also for plain text');
  assert.equal(compile('^b', { regex: true }).test('a\nb'), false);
  assert.equal(compile('^b', { regex: true, flags: 'm' }).test('a\nb'), true);
  assert.equal(compile('a.b', { regex: true }).test('a\nb'), false);
  assert.equal(compile('a.b', { regex: true, flags: 's' }).test('a\nb'), true);
  assert.equal(compile('\\p{L}+', { regex: true }).ok, true, 'without u, \\p is an identity escape');
  const u = compile('^\\p{Script=Han}+$', { regex: true, flags: 'u' });
  assert.ok(u.ok);
  assert.equal(u.test('世界'), true);
  assert.equal(compile('^.$', { regex: true, flags: 'u' }).test('😀'), true, 'u treats an emoji as one character');
  assert.equal(compile('^.$', { regex: true }).test('😀'), false);
  assert.equal(compile('x', { regex: true, flags: 'gyixq' }).flags, 'i', 'only i, m, s and u are kept');
});

test('whole word in plain text and regex mode', () => {
  assert.equal(compile('disk', { wholeWord: true }).test('disks'), false);
  assert.equal(compile('disk', { wholeWord: true }).test('the disk.'), true);
  assert.equal(compile('dis', { regex: true, wholeWord: true }).test('disk'), false);
  assert.equal(compile('dis|disk', { regex: true, wholeWord: true }).test('disk'), true, 'alternation is grouped before the boundaries');
  assert.equal(compile('客人', { wholeWord: true }).test('訪客人數'), false, 'plain whole word understands Unicode letters');
});

test('captures, named groups and match positions', () => {
  const c = compile('(?<y>\\d{4})-(\\d{2})', { regex: true });
  const m = c.matches('from 2026-11 to 2027-01');
  assert.equal(m.length, 2);
  assert.deepEqual(m[0], { index: 5, length: 7, groups: ['2026', '11'], named: { y: '2026' } });
  assert.deepEqual(m[1].groups, ['2027', '01']);
});

test('zero-width matches advance and never loop forever', () => {
  assert.equal(compile('x*', { regex: true }).matches('axb').length, 4);
  assert.equal(compile('\\b', { regex: true }).matches('ab cd').length, 4);
  assert.equal(compile('(?=a)', { regex: true }).matches('aaa').length, 3);
  assert.equal(compile('', { regex: true }).matches('aaa').length, 0, 'empty query is empty, not zero-width');
  assert.equal(compile('(?:)', { regex: true }).matches('a'.repeat(50000)).length, LIMITS.maxMatches, 'bounded');
  assert.equal(compile('^', { regex: true, flags: 'mu' }).matches('a\n😀\nb').length, 3);
});

test('no matches', () => {
  const c = compile('zzz', { regex: true });
  assert.equal(c.test('abc'), false);
  assert.equal(c.find('abc'), null);
  assert.deepEqual(c.matches('abc'), []);
});

test('length bounds: patterns over 2,000 characters are refused; samples are cut to 20,000', async () => {
  assert.equal(compile('a'.repeat(LIMITS.pattern), { regex: true }).ok, true);
  const long = compile('a'.repeat(LIMITS.pattern + 1), { regex: true });
  assert.equal(long.ok, false);
  assert.equal(long.error, 'tooLong');
  const r = await evaluate({ query: 'x', regex: true, pattern: 'x' }, 'x'.repeat(25000));
  assert.equal(r.ok, true);
  assert.ok(r.count <= LIMITS.maxMatches);
  const plain = await evaluate({ query: 'x', regex: false }, 'x'.repeat(25000));
  assert.equal(plain.count, LIMITS.maxMatches);
});

test('catastrophic backtracking: nested quantifiers are refused unless overridden', () => {
  for (const p of ['(a+)+$', '(a*)*b', '(\\w+\\s?)+$', '(x+x+)+y', '(a+){2,}']) {
    assert.equal(isCatastrophic(p), true, p);
    const c = compile(p, { regex: true });
    assert.equal(c.ok, false, p);
    assert.equal(c.slow, true, p);
  }
  for (const p of ['(ab)+', 'a+b+', '(?:\\.[\\w-]+)+', '(a+){3}', '((a+)b)+', '(?=a+)+']) assert.equal(isCatastrophic(p), false, p);
  const forced = compile('(a+)+$', { regex: true, allowSlow: true });
  assert.equal(forced.ok, true);
  for (const g of GALLERY) assert.equal(isCatastrophic(g.pattern), false, 'gallery ' + g.id + ' is safe');
});

test('adversarial pattern: long inputs never run synchronously; list filters fall back within the budget', async () => {
  const evil = { query: '(a+)+$', pattern: '(a+)+$', regex: true, allowSlow: true };
  const t0 = Date.now();
  const r = await evaluate(evil, 'a'.repeat(5000) + '!');
  assert.equal(r.timedOut, true, 'without a worker, long inputs are not evaluated synchronously');
  assert.ok(Date.now() - t0 < 500);
  // budget: the first item takes longer than 50 ms, so the rest use plain text
  let first = true;
  const items = ['alpha', 'beta', '(a+)+$ literal', 'gamma'];
  const slowText = (s) => { if (first) { first = false; const e = Date.now() + 60; while (Date.now() < e) { /* spin */ } } return s; };
  const fr = filterItems(items, slowText, Object.assign({}, evil, { query: '(a+)+$' }), { budgetMs: 50 });
  assert.equal(fr.slow, true);
  assert.deepEqual(fr.items, ['(a+)+$ literal'], 'simplified plain text search of the same query');
  const quick = filterItems(items, String, { query: 'a$', pattern: 'a$', regex: true });
  assert.equal(quick.slow, false);
  assert.deepEqual(quick.items, ['alpha', 'beta', 'gamma']);
  assert.equal(filterItems(items, String, { query: '(', pattern: '(', regex: true }).ok, false);
});

test('tokenizer and plain explanation describe the pattern token by token', () => {
  const tk = tokenize('^guest-[a-z0-9]{6}$');
  assert.deepEqual(tk.tokens.map((x) => x.type), ['anchor', 'literal', 'literal', 'literal', 'literal', 'literal', 'literal', 'class', 'quant', 'anchor']);
  assert.equal(tk.error, null);
  assert.equal(explain('^guest-[a-z0-9]{6}$'), 'Start of text, then the text "guest-", then one of [a-z0-9], exactly 6 times, then end of text.');
  assert.match(explain('(?<year>\\d{4})|x+?'), /^Group "year" \(a digit, exactly 4 times\) or the text "x", one or more times \(as few as possible\)\.$/);
  assert.match(explain('^a', 'm'), /start of a line/i);
  assert.match(explain('(?!tmp)\\w+'), /^Not followed by \(the text "tmp"\)/);
  assert.equal(explain(''), STRINGS['rx.explainEmpty']);
  const zh = explain('\\d+', '', (k) => ({ 'rx.ex.digit': '一個數字', 'rx.ex.plus': '一次或多次' })[k] || k);
  assert.equal(zh, '一個數字, 一次或多次.');
});

test('escapeRegex round-trips literal text in Unicode mode', () => {
  const lit = 'C:\\Temp\\a+b (1).[x]{2}^$|?*/-';
  const re = new RegExp('^' + escapeRegex(lit) + '$', 'u');
  assert.equal(re.test(lit), true);
});

test('common patterns gallery matches its samples', () => {
  const want = { ipv4: 2, email: 2, guid: 1, date: 2, winpath: 1, guest: 1, sid: 1, mac: 2 };
  assert.deepEqual(GALLERY.map((g) => g.id).sort(), Object.keys(want).sort());
  for (const g of GALLERY) assert.equal(compile(g.pattern, { regex: true }).matches(g.sample).length, want[g.id], g.id);
  assert.equal(compile(GALLERY.find((g) => g.id === 'ipv4').pattern, { regex: true }).test('999.1.1.1'), false);
});

test('every builder string is in both site catalogues with identical keys', () => {
  const en = JSON.parse(readFileSync(path.join(SITE, 'i18n', 'en.json'), 'utf8'));
  const zh = JSON.parse(readFileSync(path.join(SITE, 'i18n', 'zh-HK.json'), 'utf8'));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  for (const k of Object.keys(STRINGS)) { assert.equal(en[k], STRINGS[k], 'en ' + k); assert.ok(zh[k], 'zh-HK ' + k); }
});

test('one shared instance, no persistence by default', () => {
  assert.equal(globalThis.TempDeskRegex, R);
  const src = readFileSync(path.join(SITE, 'assets', 'regex-builder.js'), 'utf8');
  assert.doesNotMatch(src, /\blocalStorage\s*[.[]/);
  assert.match(src, /if \(o\.persistKey\)/, 'session storage only when a consumer opts in');
});
