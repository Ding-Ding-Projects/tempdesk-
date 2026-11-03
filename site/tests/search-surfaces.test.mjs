// Search surfaces: every catalogued search in site/search-surfaces.json exists and is wired to the
// shared regex builder, and a guard fails when a list, tree, table, listbox, menu or tab strip in
// the page sources has no registered search (or no search-exempt comment with a reason).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDom } from './mini-dom.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cat = JSON.parse(readFileSync(path.join(SITE, 'search-surfaces.json'), 'utf8'));
const read = (rel) => readFileSync(path.join(SITE, rel), 'utf8');

// Helpers that are verified to put attachRegexBuilder on their field.
const WRAPPERS = { searchBox: 'assets/canvas/search-ui.js' };

test('catalogue: ids are unique and every entry has the required fields', () => {
  const ids = new Set();
  for (const s of cat.surfaces) {
    for (const k of ['id', 'page', 'surface', 'file', 'consumer']) assert.ok(s[k], `${s.id || '?'}: missing ${k}`);
    assert.ok(!ids.has(s.id), 'duplicate id ' + s.id);
    ids.add(s.id);
    assert.ok(cat.consumers[s.consumer], `${s.id}: unknown consumer ${s.consumer}`);
  }
  assert.ok(cat.surfaces.length >= 50, 'the catalogue covers the whole site');
});

test('catalogue: every entry exists in its source file and is wired to the regex builder', () => {
  for (const s of cat.surfaces) {
    assert.ok(existsSync(path.join(SITE, s.file)), `${s.id}: ${s.file} does not exist`);
    const src = read(s.file);
    const needle = s.match || s.id;
    const n = src.split(needle).length - 1;
    assert.ok(n >= (s.count || 1), `${s.id}: "${needle}" not found ${s.count || 1} time(s) in ${s.file}`);
    if (!s.match) assert.match(src, new RegExp(`['"\\s:]${s.id.replace(/[-]/g, '\\-')}['"\\s]`), `${s.id}: id is not passed in ${s.file}`);
    const wired = s.file.endsWith('.html') || s.file === 'build.mjs'
      ? /data-search-surface/.test(src) // declarative: site.js wires these with attachListFilter
      : new RegExp(`\\b${s.consumer}\\(`).test(src) || (s.consumer === 'attachListFilter' && /\bwithFilter\(/.test(src));
    assert.ok(wired, `${s.id}: ${s.file} does not call ${s.consumer}`);
  }
  // wrappers really use the builder
  for (const [fn, file] of Object.entries(WRAPPERS)) {
    const src = read(file);
    assert.match(src, new RegExp(`export function ${fn}\\(`));
    assert.match(src, /attachRegexBuilder\(input/);
  }
  // declarative surfaces are wired by site.js
  assert.match(read('assets/site.js'), /querySelectorAll\('\[data-search-surface\]'\)[\s\S]*attachListFilter/);
  // withFilter in the studio is attachListFilter
  assert.match(read('assets/builder.js'), /function withFilter\([^)]*\) \{[\s\S]{0,300}attachListFilter\(/);
});

test('catalogue: every id used in the sources is catalogued (no unregistered surface ids)', () => {
  const ids = new Set(cat.surfaces.map((s) => s.id));
  const files = sourceFiles();
  const used = [];
  for (const f of files) {
    const src = read(f);
    // ids appear as data-search-surface="id", "search-surface: id" comments, { id: 'id' } options and
    // withFilter(list, 'id', 'label.key') calls
    for (const m of src.matchAll(/(?:data-search-surface[=:]\s*['"]|search-surface:\s*|(?:attachListFilter|attachTabCloser)\([^\n]*?\bid:\s*'|'(?=[a-z0-9]+(?:-[a-z0-9]+)+',\s*'[a-zA-Z]+\.[a-zA-Z.]+'\s*[,)]))([a-z0-9]+(?:-[a-z0-9]+)+)/g)) {
      used.push([m[1], f]);
    }
  }
  assert.ok(used.length > 30);
  for (const [id, f] of used) assert.ok(ids.has(id), `${f}: search surface "${id}" is not in search-surfaces.json`);
});

test('built pages load the regex builder', () => {
  for (const f of ['index.html', 'answer-file.html', 'templates/layout.html']) assert.match(read(f), /<script src="[^"]*assets\/regex-builder\.js"><\/script>\s*\n<script src="[^"]*assets\/site\.js">/, f);
  const out = path.join(SITE, '_site');
  if (existsSync(path.join(out, 'tools', 'base64.html'))) {
    for (const f of ['index.html', 'answer-file.html', 'tools/base64.html', 'docs/index.html']) assert.match(readFileSync(path.join(out, f), 'utf8'), /assets\/regex-builder\.js/, '_site/' + f);
    assert.ok(existsSync(path.join(out, 'assets', 'regex-builder.mjs')));
  }
});

// ---------------------------------------------------------------------------------------------
// Guard: containers without a registered search
// ---------------------------------------------------------------------------------------------
function sourceFiles() {
  const out = ['index.html', 'answer-file.html', 'build.mjs'];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(SITE, dir))) {
      const rel = dir + '/' + e;
      if (statSync(path.join(SITE, rel)).isDirectory()) { if (e !== 'vendor') walk(rel); continue; }
      if (/\.(m?js|html)$/.test(e)) out.push(rel);
    }
  };
  walk('assets'); walk('templates');
  return out;
}
const CONTAINER = /h\('(ul|ol|table)'|role: '(tree|listbox|tablist|menu|grid|table|list)'|createElement\('(ul|ol|table)'\)|<(ul|ol|table)[\s>]|role="(tree|listbox|tablist|menu|grid|table|list)"|el\(doc, '(ul|ol|table)'/;
const REG = /searchBox\(|withFilter\(|attachListFilter\(|attachTabCloser\(|attachRegexBuilder\(|listFilter\(|data-search-surface|search-surface:|search-exempt: \S/;
export function unregistered(src, file) {
  const lines = src.split('\n');
  const bad = [];
  lines.forEach((line, i) => {
    if (!CONTAINER.test(line)) return;
    if (/^\s*(\/\/|\*|<!--)/.test(line) && !/<(ul|ol|table)/.test(line)) return; // comments describing containers
    const near = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
    if (REG.test(near)) return;
    // a variable holding the container that is wrapped later in the file
    const v = /(?:const|let|var)\s+(\w+)\s*=\s*(?:h|el)\(/.exec(line);
    if (v && new RegExp(`(?:withFilter|attachListFilter|listFilter|attachTabCloser)\\(\\s*${v[1]}\\b`).test(src)) return;
    // lists filtered by a search box in the same function
    const around = lines.slice(Math.max(0, i - 25), i + 26).join('\n');
    if (/searchBox\(|attachRegexBuilder\(/.test(around)) return;
    bad.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return bad;
}
test('guard: every list, tree, table, listbox, menu and tab strip has a registered search', () => {
  const bad = [];
  for (const f of sourceFiles()) bad.push(...unregistered(read(f), f));
  assert.deepEqual(bad, [], 'containers without a search (wire one up or add a "search-exempt: reason" comment):\n' + bad.join('\n'));
});
test('guard: the guard itself catches an unregistered list', () => {
  assert.equal(unregistered("const a = 1;\nconst ul = h('ul', { class: 'x' });\nbox.appendChild(ul);", 'x.js').length, 1);
  assert.equal(unregistered("const ul = h('ul', { class: 'x' });\nbox.appendChild(withFilter(ul, 'x', 'y'));", 'x.js').length, 0);
  assert.equal(unregistered("<ul class=\"a\">\n<li>1</li></ul>", 'x.html').length, 1);
  assert.equal(unregistered("<!-- search-exempt: static legend -->\n<ul class=\"a\">", 'x.html').length, 0);
});

// ---------------------------------------------------------------------------------------------
// Mini-DOM runs of the shared consumers
// ---------------------------------------------------------------------------------------------
test('mini-DOM: the studio searchBox wrapper puts the builder beside its field and reports regex state', async () => {
  const dom = installDom();
  try {
    const { searchBox } = await import('../assets/canvas/search-ui.js');
    const seen = [];
    const sb = searchBox({ label: 'Find', onChange: (q, regex, m) => seen.push([q, regex, m.ok]) });
    dom.document.body.appendChild(sb.el);
    const tools = sb.el.querySelector('.rxb-tools');
    assert.ok(tools, 'builder buttons are present');
    const [toggle, builderBtn] = tools.children;
    assert.equal(toggle.getAttribute('aria-pressed'), 'false');
    assert.equal(builderBtn.getAttribute('aria-expanded'), 'false');
    toggle.click();
    assert.equal(toggle.getAttribute('aria-pressed'), 'true');
    sb.builder.set({ query: '(', regex: true });
    assert.deepEqual(seen[seen.length - 1], ['(', true, false]);
    sb.builder.set({ query: 'guest-\\w+', regex: true });
    assert.deepEqual(seen[seen.length - 1], ['guest-\\w+', true, true]);
    builderBtn.click();
    assert.equal(builderBtn.getAttribute('aria-expanded'), 'true');
    const pop = dom.document.querySelector('.rxb-pop');
    assert.ok(pop && !pop.hidden && pop.getAttribute('role') === 'dialog');
    sb.builder.close();
    assert.equal(builderBtn.getAttribute('aria-expanded'), 'false');
  } finally { dom.restore(); }
});

test('mini-DOM: two search surfaces keep independent state', async () => {
  const dom = installDom();
  try {
    const R = (await import('../assets/regex-builder.mjs')).default;
    const mk = (n) => { const ul = dom.document.createElement('ul'); for (let i = 0; i < n; i++) { const li = dom.document.createElement('li'); li.textContent = 'item ' + i + (i % 2 ? ' odd' : ' even'); ul.appendChild(li); } const box = dom.document.createElement('div'); box.appendChild(ul); dom.document.body.appendChild(box); return ul; };
    const a = mk(6), b = mk(4);
    const fa = R.attachListFilter(a, { id: 'a', label: 'A' }), fb = R.attachListFilter(b, { id: 'b', label: 'B' });
    fa.builder.set({ query: 'odd' });
    assert.equal(a.children.filter((x) => !x.hidden).length, 3);
    assert.equal(b.children.filter((x) => !x.hidden).length, 4, 'the other list is untouched');
    fb.builder.set({ query: 'item [0-1]$', regex: true });
    assert.equal(fa.builder.state.regex, false);
    assert.equal(b.children.filter((x) => !x.hidden).length, 0, 'anchored $ fails because the text ends with odd/even');
    fb.builder.set({ query: 'item [0-1] ', regex: true });
    assert.equal(b.children.filter((x) => !x.hidden).length, 2);
    fa.builder.set({ query: '' });
    assert.equal(a.children.filter((x) => !x.hidden).length, 6, 'clearing restores every item');
  } finally { dom.restore(); }
});

test('mini-DOM: tab closer previews, guards empty queries, keeps pinned and unsaved tabs', async () => {
  const dom = installDom();
  try {
    const R = (await import('../assets/regex-builder.mjs')).default;
    const strip = dom.document.createElement('div'); const host = dom.document.createElement('div'); host.appendChild(strip); dom.document.body.appendChild(host);
    let tabs = [{ id: '1', text: 'Disk layout' }, { id: '2', text: 'Disk notes', pinned: true }, { id: '3', text: 'Commands', dirty: true }, { id: '4', text: 'Setup flow' }];
    const closed = [];
    const c = R.attachTabCloser(strip, { tabs: () => tabs, close: (ids) => { closed.push(...ids); tabs = tabs.filter((x) => !ids.includes(x.id)); }, confirmUnsaved: () => false });
    assert.deepEqual(c.closeContaining(), [], 'an empty query never closes anything');
    const [bIn, bOut] = c.el.querySelectorAll('.rxb-chip');
    assert.equal(bIn.disabled, true);
    c.builder.set({ query: 'disk' });
    let p = c.preview();
    assert.deepEqual(p.inSet.map((x) => x.id), ['1'], 'pinned tabs are excluded');
    assert.match(bIn.textContent, /\(1\)/);
    assert.deepEqual(p.outSet.map((x) => x.id), ['3', '4']);
    assert.deepEqual(c.closeNotContaining(), ['4'], 'the tab with unsaved work is kept');
    assert.deepEqual(closed, ['4']);
    c.builder.set({ query: '^disk', regex: true });
    assert.deepEqual(c.closeContaining(), ['1']);
  } finally { dom.restore(); }
});

test('mini-DOM: the list editor widget shows its filter from four entries', async () => {
  const dom = installDom();
  try {
    const W = await import('../assets/canvas/widgets/index.js');
    const t = (k, a, f) => f || k;
    const make = (v) => W.quickField({ id: 'q' + v.length, label: 'DNS', hint: { widget: 'string-list', sep: ',' }, value: v, t, onChange() {} });
    const few = make('a,b'), many = make('a,b,c,d,e');
    dom.document.body.append(few.el, many.el);
    const f1 = few.el.querySelector('.rxb-filter'), f2 = many.el.querySelector('.rxb-filter');
    assert.ok(f1 && f2);
    assert.equal(f1.hidden, true);
    assert.equal(f2.hidden, false);
  } finally { dom.restore(); }
});
