// History timeline (Git or JSON lines backend): commit list with search, coloured per-file diff,
// compare two versions, restore any version as a new commit, unlimited undo and redo.
// Help: changelog viewer and offline docs browser with search.
import { h, t, btn, toast, notice, searchBox, contextMenu, fmtTime, dialog, superConfirm, listFilter, chooseExportFormat } from './ui.js';

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

function dateRange(refresh) {
  const from = h('input', { type: 'date' });
  const through = h('input', { type: 'date' });
  const warning = h('span', { role: 'status' });
  function valid() {
    return from.validity.valid && through.validity.valid && (!from.value || !through.value || from.value <= through.value);
  }
  function update() {
    warning.textContent = valid() ? '' : t('records.dateOrder');
    refresh();
  }
  from.addEventListener('input', update);
  through.addEventListener('input', update);
  return {
    controls: h('div', { class: 'row' }, [
      h('label', null, [t('records.from'), from]), h('label', null, [t('records.to'), through]), warning
    ]),
    values: () => ({ from: from.value || null, through: through.value || null }),
    includes(day) {
      return valid() && (!from.value || day && day >= from.value) && (!through.value || day && day <= through.value);
    }
  };
}

async function saveRecords(name, data, rowsKey, columns) {
  const format = await chooseExportFormat(['json', 'csv', 'html'], 'records.formats');
  if (!format) return;
  const rows = data[rowsKey];
  let text;
  if (format === 'json') text = JSON.stringify(data, null, 2) + '\n';
  else if (format === 'csv') text = Core.toCsv(rows, columns);
  else text = Core.toHtml(name, rows, columns);
  const result = await td.invoke['file:save']({ name: name + '.' + format, text });
  if (result.ok) toast(notice('export.saved', [result.path]), 'success');
}

function localDay(timestamp) {
  const date = new Date(timestamp);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export async function historyPage(root, app) {
  const info = await td.invoke['ws:info']();
  const log = await td.invoke['ws:log'](2000);
  const branches = await td.invoke['ws:branches']().catch(() => null);
  root.appendChild(h('div', { class: 'page-head' }, [h('div', null, [h('h1', { text: t('nav.history') }), h('p', { class: 'muted', text: info.kind === 'git' ? t('hist.leadGit', [branches ? branches.current : '']) : t('hist.leadJsonl') })]),
    h('div', { class: 'row' }, [btn(t('hist.undo'), () => app.undo(), 'btn-ghost', { disabled: !info.canUndo || undefined, title: 'Ctrl+Z' }), btn(t('hist.redo'), () => app.redo(), 'btn-ghost', { disabled: !info.canRedo || undefined, title: 'Ctrl+Y' })])]));
  if (info.gitError) root.appendChild(h('div', { class: 'notice warn', text: t('hist.gitError', [info.gitError]) }));
  const detail = h('div', { class: 'card' }, [h('p', { class: 'muted', text: t('hist.pick') })]);
  // search-surface: history-log (the History search below filters this list)
  const list = h('div', { class: 'list', role: 'list' });
  let matcher = null, kind = 'all', compareA = null;
  let limit = 100, shown = [], lastId;
  const selection = new Set();
  const dates = dateRange(draw);
  const kinds = ['all', ...new Set(log.map(entry => entry.kind))];
  const knownKinds = new Set(['all', 'change', 'undo', 'redo', 'restore']);
  const kindLabel = value => knownKinds.has(value) ? t('hist.kind.' + value) : value;
  const counts = new Map();
  for (const entry of log) counts.set(entry.kind, (counts.get(entry.kind) || 0) + 1);
  const preview = h('details');
  const summary = h('summary');
  const previewList = h('ul');
  preview.append(summary, previewList);
  const save = btn(t('records.exportSelected'), () => saveRecords('tempdesk-history', {
    schema: 'tempdesk-history-index', version: 1, encoding: 'UTF-8', lineEnding: 'LF',
    range: dates.values(), records: chosen().map(({ id, t, author, message, kind }) => ({ id, t, author, message, kind }))
  }, 'records', ['id', 't', 'author', 'message', 'kind']), 'btn-ghost');
  function chosen() { return shown.filter(entry => selection.has(entry.id)); }
  function updateSelection() {
    const selected = chosen();
    summary.textContent = t('records.preview') + ' · ' + t('records.selection', [selected.length, shown.length]);
    previewList.replaceChildren(...selected.map(entry => h('li', { text: entry.message + ' · ' + entry.id })));
    save.disabled = !selected.length;
    for (const checkbox of list.querySelectorAll('input[type=checkbox]')) checkbox.checked = selection.has(checkbox.value);
  }
  const bulk = h('div', { class: 'row' }, [
    btn(t('records.selectMatches'), () => { shown.forEach(entry => selection.add(entry.id)); updateSelection(); }, 'btn-ghost'),
    btn(t('records.invert'), () => { shown.forEach(entry => selection.has(entry.id) ? selection.delete(entry.id) : selection.add(entry.id)); updateSelection(); }, 'btn-ghost'), save
  ]);
  const seg = h('div', { class: 'row', role: 'group', 'aria-label': t('hist.filter') }, kinds.map((k) => h('button', { type: 'button', class: 'btn btn-sm ' + (k === kind ? 'btn-primary' : 'btn-ghost'), 'aria-pressed': String(k === kind), onclick: (e) => { kind = k; [...seg.children].forEach((b) => { const on = b === e.currentTarget; b.className = 'btn btn-sm ' + (on ? 'btn-primary' : 'btn-ghost'); b.setAttribute('aria-pressed', String(on)); }); draw(); } }, [kindLabel(k) + ' (' + (k === 'all' ? log.length : counts.get(k)) + ')'])));
  async function show(e, idx) {
    const prev = log[idx + 1];
    const d = await td.invoke['ws:diff'](prev ? prev.id : null, e.id);
    const files = [...new Set((d.match(/^\+\+\+ b\/(.+)$/gm) || []).map((x) => x.slice(6)))];
    const fileSel = h('select', { 'aria-label': t('hist.file') }, [h('option', { value: '', text: t('hist.allFiles') })].concat(files.map((f) => h('option', { value: f, text: f }))));
    const view = h('div', null, [diffView(d)]);
    fileSel.addEventListener('change', async () => view.replaceChildren(diffView(await td.invoke['ws:diff'](prev ? prev.id : null, e.id, fileSel.value || undefined))));
    detail.replaceChildren(h('div', { class: 'row between' }, [h('h2', { text: e.message, style: { margin: 0 } }), h('span', { class: 'chip', text: kindLabel(e.kind) })]),
      h('p', { class: 'small muted', text: fmtTime(e.t) + ' · ' + e.author + ' · ' + String(e.id).slice(0, 12) }),
      h('div', { class: 'row' }, [listFilter(fileSel, 'history-file-picker', t('hist.file'), { items: (l) => [...l.options] }), btn(t('hist.restore'), () => restore(e), 'btn-primary btn-sm', { disabled: idx === 0 || undefined }), btn(compareA ? t('hist.compareWith') : t('hist.compareStart'), () => compare(e), 'btn-ghost btn-sm')]), view);
  }
  async function restore(e) {
    const r = await td.invoke['ws:restore'](e.id, fmtTime(e.t));
    toast(r.title, 'success');
    app.settings = await td.invoke['settings:get']();
    app.applySettings();
  }
  async function compare(e) {
    if (!compareA) { compareA = e; toast(notice('hist.compareNext')); show(e, log.indexOf(e)); return; }
    const a = compareA; compareA = null;
    const older = log.indexOf(a) > log.indexOf(e) ? a : e, newer = older === a ? e : a;
    const d = await td.invoke['ws:diff'](older.id, newer.id);
    detail.replaceChildren(h('h2', { text: t('hist.compareTitle', [older.message, newer.message]) }), diffView(d));
  }
  function draw() {
    shown = log.filter((e) => dates.includes(localDay(e.t)) && (kind === 'all' || e.kind === kind) && (!matcher || matcher.ok && Core.testMatch(e.message + ' ' + e.author, matcher)));
    list.replaceChildren(...shown.slice(0, limit).map((e) => {
      const idx = log.indexOf(e);
      const it = h('div', { class: 'item', role: 'listitem', tabindex: '0' }, [h('div', { class: 'grow' }, [h('div', { class: 'title', text: e.message }), h('div', { class: 'sub', text: fmtTime(e.t) + ' · ' + kindLabel(e.kind) + (idx === 0 ? ' · ' + t('hist.current') : '') })])]);
      const check = h('input', { type: 'checkbox', value: String(e.id), checked: selection.has(e.id), 'aria-label': e.message });
      check.addEventListener('click', event => {
        event.stopPropagation();
        const anchor = shown.findIndex(row => row.id === lastId);
        const end = shown.indexOf(e);
        const range = event.shiftKey && anchor >= 0 ? shown.slice(Math.min(anchor, end), Math.max(anchor, end) + 1) : [e];
        for (const row of range) check.checked ? selection.add(row.id) : selection.delete(row.id);
        lastId = e.id;
        updateSelection();
      });
      it.prepend(check);
      it.addEventListener('click', () => show(e, idx));
      it.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target === it) show(e, idx); });
      contextMenu(it, () => [{ label: t('hist.view'), kbd: 'Enter', run: () => show(e, idx) }, { label: t('hist.restore'), run: () => restore(e), disabled: idx === 0 }, { label: compareA ? t('hist.compareWith') : t('hist.compareStart'), run: () => compare(e) }, { label: t('hist.copyId'), run: () => td.invoke['clipboard:write'](String(e.id)) }]);
      return it;
    }));
    if (shown.length > limit) list.appendChild(btn(t('records.more'), () => { limit += 100; draw(); list.querySelectorAll('input')[limit - 100]?.focus(); }, 'btn-ghost'));
    updateSelection();
    if (!shown.length) list.appendChild(h('div', { class: 'empty', text: log.length ? t('hist.noMatch') : t('hist.empty') }));
  }
  const sb = searchBox({ label: t('hist.search'), onChange: (m) => { matcher = m.empty ? null : m; draw(); }, count: (m) => Core.countMatches(log.map((e) => e.message), m) });
  root.appendChild(h('div', { class: 'cols' }, [h('div', { class: 'side' }, [h('div', { class: 'card flat stack' }, [sb, dates.controls, seg, bulk, preview]), h('div', { style: { marginTop: '12px', maxHeight: '70vh', overflow: 'auto' } }, [list])]), h('div', { class: 'grow' }, [detail])]));
  draw();
  const onChange = () => { if (app.page === 'history') app.render(); };
  document.addEventListener('td:history', onChange, { once: true });
}

function renderInline(parts, openArticle) {
  return parts.map((p) => {
    if (p.t === 'code') return h('code', { text: p.v });
    if (p.t === 'bold') return h('strong', { text: p.v });
    if (p.t === 'link') return h('a', { href: '#', onclick: (e) => {
      e.preventDefault();
      if (openArticle?.(p.href)) return;
      if (/^https?:/.test(p.href)) td.invoke['shell:open'](p.href).catch(() => toast(notice('help.linkBlocked'), 'error'));
      else toast(notice('help.linkBlocked'), 'error');
    } }, [p.v]);
    return document.createTextNode(p.v);
  });
}
function renderMarkdown(md, openArticle) {
  const out = h('div', { class: 'doc' });
  const anchors = new Set();
  Core.parseMarkdown(md).forEach((b) => {
    if (b.type === 'h') {
      const heading = h('h' + Math.min(4, b.level + 1), { tabindex: '-1' }, renderInline(b.inline, openArticle));
      const base = heading.textContent.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-') || 'section';
      let anchor = base;
      for (let i = 1; anchors.has(anchor); i++) anchor = base + '-' + i;
      anchors.add(anchor);
      heading.dataset.docAnchor = anchor;
      out.appendChild(heading);
    }
    else if (b.type === 'p') out.appendChild(h('p', null, renderInline(b.inline, openArticle)));
    else if (b.type === 'pre') out.appendChild(h('pre', { text: b.text }));
    else if (b.type === 'ul' || b.type === 'ol') out.appendChild(h(b.type, null, b.items.map((i) => h('li', null, renderInline(i, openArticle)))));
    else if (b.type === 'quote') out.appendChild(h('blockquote', { class: 'notice' }, renderInline(b.inline, openArticle)));
    else if (b.type === 'table') out.appendChild(listFilter(h('table', null, [h('tbody', null, b.rows.map((r, ri) => h('tr', null, r.map((c) => h(ri === 0 ? 'th' : 'td', null, renderInline(c, openArticle)))))) ]), 'help-doc-table', t('help.tab.docs'), { items: (l) => [...l.querySelectorAll('tr')].slice(1) }));
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
    listFilter(h('div', { class: 'row', role: 'tablist', 'aria-label': t('nav.help') }, ['docs', 'changelog', 'shortcuts'].map((k) => h('button', { type: 'button', role: 'tab', class: 'btn btn-sm ' + (tab === k ? 'btn-primary' : 'btn-ghost'), 'aria-selected': String(tab === k), onclick: () => app.go('help', { tab: k }) }, [t('help.tab.' + k)]))), 'help-tabs', t('nav.help'))]));
  if (tab === 'shortcuts') {
    const rows = [['Ctrl+Shift+F', 'key.palette'], ['Ctrl+1 … Ctrl+8', 'key.pages'], ['Ctrl+Z', 'key.undo'], ['Ctrl+Y, Ctrl+Shift+Z', 'key.redo'], ['Ctrl+Tab', 'key.tabs'], ['Ctrl+W', 'key.closeTab'], ['Ctrl+Shift+Left/Right', 'key.moveTab'], ['Shift+F10, Menu key', 'key.context'], ['Ctrl+N, Ctrl+O, Ctrl+S, Ctrl+Shift+S', 'key.studioFiles'], ['F1', 'key.help'], ['Esc', 'key.close']];
    root.appendChild(h('div', { class: 'card' }, [listFilter(h('table', { class: 'table' }, [h('tbody', null, rows.map(([k, d]) => h('tr', null, [h('td', null, [h('span', { class: 'kbd', text: k })]), h('td', { text: t(d) })])))]), 'help-shortcuts', t('help.tab.shortcuts'), { items: (l) => [...l.querySelectorAll('tr')] })]));
    return;
  }
  if (tab === 'changelog') {
    let md = '';
    try { md = await (await fetch('vendor/CHANGELOG.md')).text(); } catch (e) { md = ''; }
    const rel = Core.parseChangelog(md);
    if (!rel.length) { root.appendChild(h('div', { class: 'card empty', text: t('help.noChangelog') })); return; }
    const box = h('div', { class: 'stack' });
    let matcher = null;
    const dates = dateRange(draw);
    const text = release => [release.version, release.date, release.body].join(' ');
    const matches = () => rel.filter(release => dates.includes(release.date) && (!matcher || matcher.ok && Core.testMatch(text(release), matcher)));
    const data = () => ({ schema: 'tempdesk-changelog', version: 1, encoding: 'UTF-8', lineEnding: 'LF', range: dates.values(), releases: matches() });
    function draw() {
      box.replaceChildren(...matches().map(release => {
        const card = h('div', { class: 'card' }, [h('h2', { text: [release.version, release.date].filter(Boolean).join(' · ') }), renderMarkdown(release.body)]);
        if (matcher) highlight(card, matcher);
        return card;
      }));
      if (!box.children.length) box.appendChild(h('p', { class: 'empty', text: t('hist.noMatch') }));
    }
    root.appendChild(h('div', { class: 'card flat stack' }, [
      searchBox({ label: t('help.searchChangelog'), onChange: m => { matcher = m.empty ? null : m; draw(); }, count: m => Core.countMatches(rel.filter(r => dates.includes(r.date)).map(text), m) }),
      dates.controls,
      h('div', { class: 'row' }, [
        btn(t('export.title'), () => saveRecords('tempdesk-changelog', data(), 'releases', ['version', 'date', 'body']), 'btn-ghost'),
        btn(t('records.copy'), async () => {
          await td.invoke['clipboard:write'](JSON.stringify(data(), null, 2));
          toast(notice('records.copyDone'), 'success');
        }, 'btn-ghost')
      ])
    ]));
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
    const doc = renderMarkdown(texts[cur] || '', (href) => {
      if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(href)) return false;
      const origin = 'https://offline.invalid';
      let target;
      try {
        target = new URL(href, origin + '/' + cur);
      } catch {
        return false;
      }
      const path = target.pathname.slice(1);
      if (target.origin !== origin || !docs.some((article) => article.path === path)) return false;
      let anchor = '';
      try { anchor = decodeURIComponent(target.hash.slice(1)); } catch { return false; }
      if (cur !== path) {
        cur = path;
        draw();
      }
      const headings = [...body.querySelectorAll('[data-doc-anchor]')];
      const heading = headings.find((item) => item.dataset.docAnchor === anchor) || headings[0];
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView({ block: 'start' });
      return true;
    });
    const headings = [...doc.querySelectorAll('[data-doc-anchor]')];
    const contents = h('details', null, [h('summary', { text: t('records.contents') })]);
    if (headings.length) contents.appendChild(h('nav', { 'aria-label': t('records.contents') }, headings.map(heading =>
      btn(heading.textContent, () => { heading.focus(); heading.scrollIntoView({ block: 'start' }); }, 'btn-ghost btn-sm')
    )));
    body.replaceChildren(...(headings.length ? [contents, doc] : [doc]));
    if (matcher) { const n = highlight(doc, matcher); const m = doc.querySelector('mark'); if (m) m.scrollIntoView({ block: 'center' }); announce(n); }
  }
  function announce() { /* the search box already reports counts */ }
  root.appendChild(h('div', { class: 'card flat', style: { marginBottom: '14px' } }, [searchBox({ label: t('help.searchDocs'), onChange: (m) => { matcher = m.ok && !m.empty ? m : null; draw(); }, count: (m) => Core.countMatches(Object.values(texts), m) })]));
  root.appendChild(h('div', { class: 'cols' }, [h('div', { class: 'side' }, [nav]), h('div', { class: 'grow' }, [body])]));
  draw();
}
void dialog; void superConfirm;
