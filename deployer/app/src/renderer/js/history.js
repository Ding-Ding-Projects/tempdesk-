// History timeline (Git or JSON lines backend): commit list with search, coloured per-file diff,
// compare two versions, restore any version as a new commit, unlimited undo and redo.
// Help: changelog viewer and offline docs browser with search.
import { h, t, btn, toast, searchBox, contextMenu, fmtTime, dialog, superConfirm } from './ui.js';

const td = window.td;
const Core = window.TempDeskCore;

function diffView(text) {
  const pre = h('div', { class: 'diff', role: 'region', 'aria-label': t('hist.diff'), tabindex: '0' });
  if (!text.trim()) { pre.appendChild(h('span', { class: 'ctx', text: t('hist.noChanges') })); return pre; }
  text.split('\n').forEach((l) => {
    const cls = /^(\+\+\+|---|diff |index )/.test(l) ? 'hunk' : l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : 'ctx';
    pre.appendChild(h('span', { class: cls, text: l || ' ' }));
    pre.appendChild(document.createTextNode('\n'));
  });
  return pre;
}

export async function historyPage(root, app) {
  const info = await td.invoke['ws:info']();
  const log = await td.invoke['ws:log'](2000);
  const branches = await td.invoke['ws:branches']().catch(() => null);
  root.appendChild(h('div', { class: 'page-head' }, [h('div', null, [h('h1', { text: t('nav.history') }), h('p', { class: 'muted', text: info.kind === 'git' ? t('hist.leadGit', [branches ? branches.current : '']) : t('hist.leadJsonl') })]),
    h('div', { class: 'row' }, [btn(t('hist.undo'), () => app.undo(), 'btn-ghost', { disabled: !info.canUndo || undefined, title: 'Ctrl+Z' }), btn(t('hist.redo'), () => app.redo(), 'btn-ghost', { disabled: !info.canRedo || undefined, title: 'Ctrl+Y' })])]));
  if (info.gitError) root.appendChild(h('div', { class: 'notice warn', text: t('hist.gitError', [info.gitError]) }));
  const detail = h('div', { class: 'card' }, [h('p', { class: 'muted', text: t('hist.pick') })]);
  const list = h('div', { class: 'list', role: 'list' });
  let matcher = null, kind = 'all', compareA = null;
  const kinds = ['all', 'change', 'undo', 'redo', 'restore'];
  const seg = h('div', { class: 'row', role: 'group', 'aria-label': t('hist.filter') }, kinds.map((k) => h('button', { type: 'button', class: 'btn btn-sm ' + (k === kind ? 'btn-primary' : 'btn-ghost'), 'aria-pressed': String(k === kind), onclick: (e) => { kind = k; [...seg.children].forEach((b) => { const on = b === e.currentTarget; b.className = 'btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost'); b.setAttribute('aria-pressed', String(on)); }); draw(); } }, [t('hist.kind.' + k)])));
  async function show(e, idx) {
    const prev = log[idx + 1];
    const d = await td.invoke['ws:diff'](prev ? prev.id : null, e.id);
    const files = [...new Set((d.match(/^\+\+\+ b\/(.+)$/gm) || []).map((x) => x.slice(6)))];
    const fileSel = h('select', { 'aria-label': t('hist.file') }, [h('option', { value: '', text: t('hist.allFiles') })].concat(files.map((f) => h('option', { value: f, text: f }))));
    const view = h('div', null, [diffView(d)]);
    fileSel.addEventListener('change', async () => view.replaceChildren(diffView(await td.invoke['ws:diff'](prev ? prev.id : null, e.id, fileSel.value || undefined))));
    detail.replaceChildren(h('div', { class: 'row between' }, [h('h2', { text: e.message, style: { margin: 0 } }), h('span', { class: 'chip', text: t('hist.kind.' + e.kind) })]),
      h('p', { class: 'small muted', text: fmtTime(e.t) + ' · ' + e.author + ' · ' + String(e.id).slice(0, 12) }),
      h('div', { class: 'row' }, [fileSel, btn(t('hist.restore'), () => restore(e), 'btn-primary btn-sm', { disabled: idx === 0 || undefined }), btn(compareA ? t('hist.compareWith') : t('hist.compareStart'), () => compare(e), 'btn-ghost btn-sm')]), view);
  }
  async function restore(e) {
    const r = await td.invoke['ws:restore'](e.id, fmtTime(e.t));
    toast(r.title, 'success');
    app.settings = await td.invoke['settings:get']();
    app.applySettings();
  }
  async function compare(e) {
    if (!compareA) { compareA = e; toast(t('hist.compareNext')); show(e, log.indexOf(e)); return; }
    const a = compareA; compareA = null;
    const older = log.indexOf(a) > log.indexOf(e) ? a : e, newer = older === a ? e : a;
    const d = await td.invoke['ws:diff'](older.id, newer.id);
    detail.replaceChildren(h('h2', { text: t('hist.compareTitle', [older.message, newer.message]) }), diffView(d));
  }
  function draw() {
    const shown = log.filter((e) => (kind === 'all' || e.kind === kind) && (!matcher || Core.testMatch(e.message + ' ' + e.author, matcher)));
    list.replaceChildren(...shown.slice(0, 500).map((e) => {
      const idx = log.indexOf(e);
      const it = h('div', { class: 'item', role: 'listitem', tabindex: '0' }, [h('div', { class: 'grow' }, [h('div', { class: 'title', text: e.message }), h('div', { class: 'sub', text: fmtTime(e.t) + ' · ' + t('hist.kind.' + e.kind) + (idx === 0 ? ' · ' + t('hist.current') : '') })])]);
      it.addEventListener('click', () => show(e, idx));
      it.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') show(e, idx); });
      contextMenu(it, () => [{ label: t('hist.view'), kbd: 'Enter', run: () => show(e, idx) }, { label: t('hist.restore'), run: () => restore(e), disabled: idx === 0 }, { label: compareA ? t('hist.compareWith') : t('hist.compareStart'), run: () => compare(e) }, { label: t('hist.copyId'), run: () => td.invoke['clipboard:write'](String(e.id)) }]);
      return it;
    }));
    if (!shown.length) list.appendChild(h('div', { class: 'empty', text: log.length > 1 ? t('hist.noMatch') : t('hist.empty') }));
  }
  const sb = searchBox({ label: t('hist.search'), onChange: (m) => { matcher = m.ok && !m.empty ? m : null; draw(); }, count: (m) => Core.countMatches(log.map((e) => e.message), m) });
  root.appendChild(h('div', { class: 'cols' }, [h('div', { class: 'side' }, [h('div', { class: 'card flat stack' }, [sb, seg]), h('div', { style: { marginTop: '12px', maxHeight: '70vh', overflow: 'auto' } }, [list])]), h('div', { class: 'grow' }, [detail])]));
  draw();
  const onChange = () => { if (app.page === 'history') app.render(); };
  document.addEventListener('td:history', onChange, { once: true });
}

function renderInline(parts, q) {
  return parts.map((p) => {
    if (p.t === 'code') return h('code', { text: p.v });
    if (p.t === 'bold') return h('strong', { text: p.v });
    if (p.t === 'link') return h('a', { href: '#', onclick: (e) => { e.preventDefault(); if (/^https?:/.test(p.href)) td.invoke['shell:open'](p.href).catch(() => toast(t('help.linkBlocked'), 'error')); } }, [p.v]);
    return document.createTextNode(p.v);
  });
}
function renderMarkdown(md) {
  const out = h('div', { class: 'doc' });
  Core.parseMarkdown(md).forEach((b) => {
    if (b.type === 'h') out.appendChild(h('h' + Math.min(4, b.level + 1), null, renderInline(b.inline)));
    else if (b.type === 'p') out.appendChild(h('p', null, renderInline(b.inline)));
    else if (b.type === 'pre') out.appendChild(h('pre', { text: b.text }));
    else if (b.type === 'ul' || b.type === 'ol') out.appendChild(h(b.type, null, b.items.map((i) => h('li', null, renderInline(i)))));
    else if (b.type === 'quote') out.appendChild(h('blockquote', { class: 'notice' }, renderInline(b.inline)));
    else if (b.type === 'table') out.appendChild(h('table', null, [h('tbody', null, b.rows.map((r, ri) => h('tr', null, r.map((c) => h(ri === 0 ? 'th' : 'td', null, renderInline(c)))))) ]));
  });
  return out;
}
function highlight(el, matcher) {
  if (!matcher) return 0;
  let n = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((node) => {
    const s = node.nodeValue; matcher.re.lastIndex = 0;
    let m, last = 0; const frag = document.createDocumentFragment(); let any = false, guard = 0;
    while ((m = matcher.re.exec(s)) && guard++ < 1000) { if (!m[0]) { matcher.re.lastIndex++; continue; } any = true; n++; frag.appendChild(document.createTextNode(s.slice(last, m.index))); frag.appendChild(h('mark', { text: m[0] })); last = m.index + m[0].length; }
    if (any) { frag.appendChild(document.createTextNode(s.slice(last))); node.parentNode.replaceChild(frag, node); }
  });
  matcher.re.lastIndex = 0;
  return n;
}

export async function helpPage(root, app) {
  const tab = (app.params && app.params.tab) || 'docs';
  root.appendChild(h('div', { class: 'page-head' }, [h('div', null, [h('h1', { text: t('nav.help') }), h('p', { class: 'muted', text: t('help.lead') })]),
    h('div', { class: 'row', role: 'tablist' }, ['docs', 'changelog', 'shortcuts'].map((k) => h('button', { type: 'button', role: 'tab', class: 'btn btn-sm ' + (tab === k ? 'btn-primary' : 'btn-ghost'), 'aria-selected': String(tab === k), onclick: () => app.go('help', { tab: k }) }, [t('help.tab.' + k)])))]));
  if (tab === 'shortcuts') {
    const rows = [['Ctrl+Shift+F', 'key.palette'], ['Ctrl+1 … Ctrl+8', 'key.pages'], ['Ctrl+Z', 'key.undo'], ['Ctrl+Y, Ctrl+Shift+Z', 'key.redo'], ['Ctrl+Tab', 'key.tabs'], ['Ctrl+W', 'key.closeTab'], ['Ctrl+Shift+Left/Right', 'key.moveTab'], ['Shift+F10, Menu key', 'key.context'], ['Ctrl+O, Ctrl+S, Ctrl+Shift+S', 'key.studioFiles'], ['F1', 'key.help'], ['Esc', 'key.close']];
    root.appendChild(h('div', { class: 'card' }, [h('table', { class: 'table' }, [h('tbody', null, rows.map(([k, d]) => h('tr', null, [h('td', null, [h('span', { class: 'kbd', text: k })]), h('td', { text: t(d) })])))])]));
    return;
  }
  if (tab === 'changelog') {
    let md = '';
    try { md = await (await fetch('vendor/CHANGELOG.md')).text(); } catch (e) { md = ''; }
    const rel = Core.parseChangelog(md);
    if (!rel.length) { root.appendChild(h('div', { class: 'card empty', text: t('help.noChangelog') })); return; }
    const box = h('div', { class: 'stack' });
    let matcher = null;
    const draw = () => box.replaceChildren(...rel.filter((r) => !matcher || Core.testMatch(r.version + ' ' + r.body, matcher)).map((r) => { const c = h('div', { class: 'card' }, [h('h2', { text: r.version + (r.date ? ' · ' + r.date : '') }), renderMarkdown(r.body)]); if (matcher) highlight(c, matcher); return c; }));
    root.appendChild(h('div', { class: 'card flat', style: { marginBottom: '14px' } }, [searchBox({ label: t('help.searchChangelog'), onChange: (m) => { matcher = m.ok && !m.empty ? m : null; draw(); }, count: (m) => Core.countMatches(rel.map((r) => r.body), m) })]));
    root.appendChild(box); draw();
    return;
  }
  const docs = await td.invoke['docs:list']();
  if (!docs.length) { root.appendChild(h('div', { class: 'card empty', text: t('help.noDocs') })); return; }
  const texts = {};
  for (const d of docs) { try { texts[d.path] = await td.invoke['docs:read'](d.path); } catch (e) { texts[d.path] = ''; } }
  let cur = (app.params && app.params.doc) || docs[0].path, matcher = null;
  const nav = h('div', { class: 'list', role: 'list' });
  const body = h('div', { class: 'card' });
  function draw() {
    nav.replaceChildren(...docs.filter((d) => !matcher || Core.testMatch(d.title + ' ' + texts[d.path], matcher)).map((d) => {
      const n = matcher ? Core.countMatches([texts[d.path]], matcher).matches : 0;
      return h('button', { type: 'button', class: 'item', style: { textAlign: 'left', cursor: 'pointer' }, 'aria-current': d.path === cur ? 'page' : null, onclick: () => { cur = d.path; draw(); } }, [h('div', { class: 'grow' }, [h('div', { class: 'title', text: d.title }), h('div', { class: 'sub mono', text: d.path })]), n ? h('span', { class: 'chip ok', text: String(n) }) : null]);
    }));
    const doc = renderMarkdown(texts[cur] || '');
    body.replaceChildren(doc);
    if (matcher) { const n = highlight(doc, matcher); const m = doc.querySelector('mark'); if (m) m.scrollIntoView({ block: 'center' }); announce(n); }
  }
  function announce() { /* the search box already reports counts */ }
  root.appendChild(h('div', { class: 'card flat', style: { marginBottom: '14px' } }, [searchBox({ label: t('help.searchDocs'), onChange: (m) => { matcher = m.ok && !m.empty ? m : null; draw(); }, count: (m) => Core.countMatches(Object.values(texts), m) })]));
  root.appendChild(h('div', { class: 'cols' }, [h('div', { class: 'side' }, [nav]), h('div', { class: 'grow' }, [body])]));
  draw();
}
void dialog; void superConfirm;
