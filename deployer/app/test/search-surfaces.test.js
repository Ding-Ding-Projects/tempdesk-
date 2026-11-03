// Search surfaces in the desktop app: every catalogued search in search-surfaces.json exists and is
// wired to the shared regex builder, and a guard fails when a list, tree, table, listbox, menu or
// tab strip in the renderer has no registered search (or no search-exempt comment with a reason).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const cat = JSON.parse(fs.readFileSync(path.join(APP, 'search-surfaces.json'), 'utf8'));
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');

test('catalogue: unique ids, required fields, known consumers', () => {
  const ids = new Set();
  for (const s of cat.surfaces) {
    for (const k of ['id', 'page', 'surface', 'file', 'consumer']) assert.ok(s[k], (s.id || '?') + ': missing ' + k);
    assert.ok(!ids.has(s.id), 'duplicate ' + s.id); ids.add(s.id);
    assert.ok(cat.consumers[s.consumer], s.id + ': unknown consumer');
  }
});

test('catalogue: every entry exists and is wired to the regex builder', () => {
  for (const s of cat.surfaces) {
    assert.ok(fs.existsSync(path.join(APP, s.file)), s.id + ': missing ' + s.file);
    const src = read(s.file);
    assert.ok(src.includes(s.match || s.id), s.id + ': not found in ' + s.file);
    const wired = s.file.endsWith('.html') ? /regex-builder\.js/.test(src) : new RegExp('\\b' + s.consumer + '\\(').test(src);
    assert.ok(wired, s.id + ': ' + s.file + ' does not call ' + s.consumer);
  }
  const ui = read('src/renderer/js/ui.js');
  assert.match(ui, /export function searchBox\([\s\S]*?RX\.attachRegexBuilder\(inp/, 'searchBox puts the builder on its field');
  assert.match(ui, /export function listFilter\([\s\S]*?RX\.attachListFilter\(list/, 'listFilter uses the list filter');
  assert.match(read('src/renderer/index.html'), /<script src="vendor\/regex-builder\.js"><\/script>/);
});

test('catalogue: every surface id used in the renderer is catalogued', () => {
  const ids = new Set(cat.surfaces.map((s) => s.id));
  let n = 0;
  for (const f of files()) {
    for (const m of read(f).matchAll(/(?:search-surface:\s*|data-search-surface['"]?[=:]\s*['"]|listFilter\([^\n]*?,\s*'(?=[a-z0-9]+(?:-[a-z0-9]+)+',\s*t\()|(?:attachListFilter|attachTabCloser)\([^\n]*?\bid:\s*')([a-z0-9]+(?:-[a-z0-9]+)+)/g)) {
      if (f.endsWith('studio.html')) continue; // the studio page is the website's (site/search-surfaces.json)
      n++; assert.ok(ids.has(m[1]), f + ': "' + m[1] + '" is not in search-surfaces.json');
    }
  }
  assert.ok(n >= 15);
});

function files() {
  const dir = 'src/renderer/js';
  return fs.readdirSync(path.join(APP, dir)).filter((f) => f.endsWith('.js')).map((f) => dir + '/' + f).concat(['src/renderer/index.html']);
}
const CONTAINER = /h\('(ul|ol|table)'|role: '(tree|listbox|tablist|menu|grid|table|list)'|<(ul|ol|table)[\s>]|role="(tree|listbox|tablist|menu|grid|table|list)"/;
const REG = /searchBox\(|listFilter\(|attachListFilter\(|attachTabCloser\(|attachRegexBuilder\(|data-search-surface|search-surface:|search-exempt: \S/;
function unregistered(src, file) {
  const lines = src.split('\n'), bad = [];
  lines.forEach((line, i) => {
    if (!CONTAINER.test(line)) return;
    if (REG.test(lines.slice(Math.max(0, i - 3), i + 4).join('\n'))) return;
    const v = /(?:const|let|var)\s+(\w+)\s*=\s*h\(/.exec(line);
    if (v && new RegExp('(?:listFilter|attachListFilter|attachTabCloser)\\(\\s*' + v[1] + '\\b').test(src)) return;
    if (/searchBox\(|attachRegexBuilder\(/.test(lines.slice(Math.max(0, i - 25), i + 26).join('\n'))) return;
    bad.push(file + ':' + (i + 1) + ': ' + line.trim().slice(0, 120));
  });
  return bad;
}
test('guard: every list, table, listbox, menu and tab strip in the renderer has a registered search', () => {
  const bad = [];
  for (const f of files()) bad.push(...unregistered(read(f), f));
  assert.deepEqual(bad, [], 'containers without a search:\n' + bad.join('\n'));
  assert.equal(unregistered("const x = h('ul');\nroot.append(x);", 't.js').length, 1, 'the guard catches an unregistered list');
});

test('the shared module is vendored from the website by prepare-bundle', () => {
  const pb = read('scripts/prepare-bundle.js');
  assert.match(pb, /m\?js\|css\|svg/, 'site/assets/*.mjs and *.js are copied');
  const vend = path.join(APP, 'src', 'vendor', 'regex-builder.js');
  if (fs.existsSync(vend)) assert.equal(fs.readFileSync(vend, 'utf8'), fs.readFileSync(path.join(APP, '..', '..', 'site', 'assets', 'regex-builder.js'), 'utf8'), 'src/vendor is stale: run node scripts/prepare-bundle.js');
});

test('stateMatcher semantics through the shared compile', () => {
  global.window = global.window || {};
  const R = require('../../../site/assets/regex-builder.js');
  const c = R.compile('guest-\\d+', { regex: true });
  assert.ok(c.ok);
  const re = new RegExp(c.source, c.flags + 'g');
  assert.equal(re.test('GUEST-12'), true);
  assert.equal(R.compile('(a+)+', { regex: true }).ok, false);
});
