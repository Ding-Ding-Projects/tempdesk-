// Group Policy editor: scope toggle, Group Policy Management Editor tree
// (Policies and Preferences), policy / item list with search, regex and
// filters, and a rich editor sheet. Three panes on desktop, drill-down on
// phones. Saves go through the portal (CSRF, policy backup, undo journal).
(function () {
  'use strict';
  var doc = document, TD = window.TD || {}, C = window.TDC;
  var root = doc.querySelector('[data-ged]');
  if (!root || !C) return;
  var t = TD.t || function (k) { return k; };
  var el = C.el;
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  var cfg = {}; try { cfg = JSON.parse($('[data-ged-cfg]').textContent); } catch (e) { cfg = {}; }
  var gid = cfg.gid, caps = cfg.caps || [];
  var scope = cfg.scope || 'Computer';
  var tree = [], byId = {}, openIds = {}, current = null; // current tree node
  var listItems = [], listKind = null, activeIdx = -1, filter = 'all', supported = '';
  var schema = null, stats = null;
  var phone = window.matchMedia('(max-width: 900px)');

  function toast(m, k) { TD.toast && TD.toast(m, k); }
  function fail(e) { toast(e && e.message ? e.message : String(e), 'error'); }
  function setView(v) { root.setAttribute('data-view', v); if (phone.matches) window.scrollTo(0, 0); }
  function enc(s) { return encodeURIComponent(s); }
  function admxClass() { return scope === 'User' ? 'User' : 'Machine'; }
  function norm(n, parent, depth) {
    // Accept agent node shapes: {id,name|label|title,kind|type,children|items,count,node|path,category|categoryId,href}
    var o = {
      id: String(n.id || n.path || n.node || (parent ? parent.id + '/' : '') + (n.name || n.label || n.title)),
      name: n.name || n.label || n.title || n.id,
      kind: n.kind || n.type || (n.category || n.categoryId ? 'admx' : (n.node || n.path) && !(n.children || []).length ? 'table' : 'folder'),
      node: n.node || n.path || null, category: n.category != null ? n.category : (n.categoryId || null), href: n.href || null,
      count: n.count != null ? n.count : (n.configured != null ? n.configured : null), all: !!n.all, schema: n.schema || n.itemType || null,
      parent: parent, depth: depth, children: []
    };
    if (o.kind === 'category') o.kind = 'admx';
    if (o.kind === 'items' || o.kind === 'list') o.kind = 'table';
    byId[o.id] = o;
    (n.children || n.items || []).forEach(function (c) { if (c && typeof c === 'object' && (c.children || c.name || c.label || c.title)) o.children.push(norm(c, o, depth + 1)); });
    return o;
  }

  // ---------------------------------------------------------- tree
  function loadTree() {
    $('[data-ged-tree]').textContent = ''; $('[data-ged-tree]').appendChild(el('div', 'skeleton')).style.height = '28px';
    return C.getJSON('/api/gpo/' + enc(gid) + '/tree?scope=' + scope).then(function (r) {
      byId = {}; tree = (r.tree || []).map(function (n) { return norm(n, null, 1); });
      stats = r.stats;
      if (!Object.keys(openIds).length) tree.forEach(function (n) { openIds[n.id] = true; n.children.forEach(function (c) { if (/admin|template|windows/i.test(c.name)) openIds[c.id] = true; }); });
      renderTree(); renderStats();
    }, function (e) { var tr = $('[data-ged-tree]'); tr.textContent = ''; tr.appendChild(el('p', 'muted', e.message)); });
  }
  function renderStats() {
    var s = $('[data-ged-stats]'); s.textContent = '';
    if (stats && (stats.policies || stats.policyCount)) {
      s.appendChild(doc.createTextNode(t('Administrative Templates') + ': '));
      s.appendChild(el('b', null, t('{count} policies', { count: Number(stats.policies || stats.policyCount).toLocaleString() })));
      s.appendChild(doc.createTextNode(' ' + (stats.source === 'local' ? t('from the local PolicyDefinitions folder') : t('from the central store')) + (stats.files || stats.admxFiles ? ', ' + t('{count} ADMX files', { count: stats.files || stats.admxFiles }) : '') + (stats.language ? ', ' + stats.language : '')));
    } else if (caps.indexOf('admx') >= 0) {
      s.appendChild(doc.createTextNode(t('Administrative Templates are read from the central store.')));
    } else s.appendChild(doc.createTextNode(t('Administrative Templates are not available on this backend.')));
  }
  // Tree search: one surface per scope (Computer and User keep their own text). Matching folders
  // and their ancestors stay, branches that hold a match open, the matched text is highlighted.
  var S = window.TDSearch || { mount: function () { return null; } }, treeSearch = {};
  ['Computer', 'User'].forEach(function (sc) {
    treeSearch[sc] = S.mount($('[data-ged-tree-search="' + sc + '"]'), { kind: 'custom', compact: true, onChange: function () { if (scope === sc) renderTree(); } });
  });
  function ts() { var x = treeSearch[scope]; return x && x.active() ? x : null; }
  function selfHit(n) { var x = ts(); return !!x && x.test(n.name); }
  function keepNode(n) { return !ts() || selfHit(n) || n.children.some(keepNode); }
  function renderTree() {
    var host = $('[data-ged-tree]'); host.textContent = '';
    $$('[data-ged-tree-search]').forEach(function (h) { h.hidden = h.getAttribute('data-ged-tree-search') !== scope; });
    var ul = el('ul'); /* search: gpo-tree-computer, gpo-tree-user */ ul.setAttribute('role', 'group');
    tree.forEach(function (n) { if (keepNode(n)) ul.appendChild(treeLi(n)); });
    host.appendChild(ul);
    if (!tree.length) host.appendChild(el('p', 'muted', t('This policy has no editable sections on this backend.')));
    var x = treeSearch[scope];
    if (x) {
      var hits = $$('[data-ged-tree] .lbl').filter(function (b) { return b._node && selfHit(b._node); });
      var total = 0; (function cnt(l) { l.forEach(function (c) { total++; cnt(c.children); }); })(tree);
      x.count(hits.length, total); x.highlight(hits.map(function (b) { return b.querySelector('.t'); }));
      if (ts() && !hits.length && tree.length) host.appendChild(el('p', 'muted small', t('No matches')));
    }
  }
  function treeLi(n) {
    var li = el('li'); li.setAttribute('role', 'none');
    var row = el('div', 'ged-node' + (n.depth === 1 ? ' root' : ''));
    var has = n.children.length > 0, open = !!openIds[n.id] || (!!ts() && n.children.some(keepNode));
    var tw = el('button', 'tw' + (has ? '' : ' leaf'), '▸'); tw.type = 'button'; tw.tabIndex = -1; tw.setAttribute('aria-hidden', 'true'); tw.setAttribute('aria-expanded', open ? 'true' : 'false');
    tw.addEventListener('click', function () { openIds[n.id] = !openIds[n.id]; renderTree(); });
    var lb = el('button', 'lbl'); lb.type = 'button'; lb.setAttribute('role', 'treeitem'); lb.setAttribute('aria-level', String(n.depth)); lb._node = n;
    if (has) lb.setAttribute('aria-expanded', open ? 'true' : 'false');
    lb.setAttribute('aria-current', current && current.id === n.id ? 'true' : 'false');
    lb.tabIndex = (current ? current.id === n.id : n.depth === 1 && n === tree[0]) ? 0 : -1;
    lb.appendChild(el('span', 't', n.name));
    if (n.count) lb.appendChild(el('span', 'cnt', String(n.count)));
    lb.addEventListener('click', function () { if (has && !openIds[n.id]) openIds[n.id] = true; selectNode(n); });
    lb.addEventListener('keydown', function (e) { treeKey(e, n); });
    row.appendChild(tw); row.appendChild(lb); li.appendChild(row);
    if (has && open) { var ul = el('ul'); /* search: gpo-tree-computer, gpo-tree-user */ ul.setAttribute('role', 'group'); n.children.forEach(function (c) { if (keepNode(c)) ul.appendChild(treeLi(c)); }); li.appendChild(ul); }
    return li;
  }
  function treeKey(e, n) {
    var items = $$('[data-ged-tree] [role="treeitem"]'), i = items.indexOf(e.currentTarget);
    function focus(j) { if (items[j]) { items.forEach(function (x) { x.tabIndex = -1; }); items[j].tabIndex = 0; items[j].focus(); } }
    if (e.key === 'ArrowDown') { e.preventDefault(); focus(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focus(i - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (n.children.length && !openIds[n.id]) { openIds[n.id] = true; renderTree(); refocus(n); } else focus(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (openIds[n.id] && n.children.length) { openIds[n.id] = false; renderTree(); refocus(n); } else if (n.parent) refocus(n.parent); }
    else if (e.key === 'Home') { e.preventDefault(); focus(0); }
    else if (e.key === 'End') { e.preventDefault(); focus(items.length - 1); }
  }
  function refocus(n) { var b = $$('[data-ged-tree] [role="treeitem"]').filter(function (x) { return x.querySelector('.t').textContent === n.name; })[0]; if (b) { b.tabIndex = 0; b.focus(); } }
  function pathOf(n) { var p = []; while (n) { p.unshift(n.name); n = n.parent; } return (scope === 'User' ? t('User') : t('Computer')) + ' › ' + p.join(' › '); }

  $$('[data-scope]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (scope === b.getAttribute('data-scope')) return;
      scope = b.getAttribute('data-scope'); openIds = {}; current = null;
      $$('[data-scope]').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
      clearList(); clearSheet(); loadTree().then(autoPick); syncUrl();
    });
    b.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var o = $$('[data-scope]').filter(function (x) { return x !== b; })[0]; o.focus(); o.click(); } });
  });

  // ---------------------------------------------------------- list
  function clearList() { listItems = []; activeIdx = -1; $('[data-ged-list]').textContent = ''; $('[data-ged-midtitle]').textContent = ''; $('[data-ged-found]').textContent = ''; }
  function clearSheet(msg) { var s = $('[data-ged-sheet]'); s.textContent = ''; var d = el('div', 'ged-empty'); d.appendChild(el('strong', null, t('Pick a setting'))); d.appendChild(doc.createTextNode(msg || t('Choose a folder in the tree, then a policy or item in the list.'))); s.appendChild(d); }
  function selectNode(n) {
    current = n; renderTree(); syncUrl();
    $('[data-ged-midtitle]').textContent = n.name;
    if (n.kind === 'link' && n.href) { location.href = n.href; return; }
    if (n.kind === 'admx') { loadPolicies(n.all ? '' : n.category, plainQuery() ? $('[data-ged-q]').value.trim() : ''); setView('list'); return; }
    if (n.kind === 'table') { loadItems(n); setView('list'); return; }
    // folder: list its children as rows
    listKind = 'folder'; listItems = n.children.map(function (c) { return { folder: c }; });
    renderList(); setView('list');
    if (!n.children.length) { var l = $('[data-ged-list]'); l.textContent = ''; l.appendChild(emptyRow(t('This folder has no settings on this backend.'))); }
  }
  function emptyRow(text) { var d = el('div', 'ged-empty'); d.appendChild(doc.createTextNode(text)); return d; }
  var polSeq = 0;
  function loadPolicies(category, q) {
    listKind = 'admx'; var seq = ++polSeq;
    var list = $('[data-ged-list]'); list.textContent = ''; for (var i = 0; i < 5; i++) { var s = el('div', 'skeleton'); s.style.height = '44px'; list.appendChild(s); }
    if (!category && !q) { list.textContent = ''; list.appendChild(emptyRow(t('Type in the search box to search every policy.'))); listItems = []; return; }
    C.getJSON('/api/gpo/' + enc(gid) + '/policies?' + new URLSearchParams({ scope: scope, category: category || '', q: q || '' })).then(function (r) {
      if (seq !== polSeq) return;
      listItems = (r.policies || []).map(function (p) { return { policy: p }; });
      var sup = {}; listItems.forEach(function (x) { if (x.policy.supportedOn) sup[x.policy.supportedOn] = 1; });
      var sel = $('[data-ged-supported]'), keep = sel.value; sel.length = 1; Object.keys(sup).sort().forEach(function (s) { sel.appendChild(new Option(s, s)); }); sel.value = sup[keep] ? keep : '';
      renderList();
      if (cfg.policy) { var k = listItems.findIndex(function (x) { return x.policy.id === cfg.policy; }); cfg.policy = ''; if (k >= 0) openItem(k); }
      else if (!phone.matches && listItems.length && activeIdx < 0) openItem(firstVisible());
    }, function (e) { list.textContent = ''; list.appendChild(emptyRow(e.message)); });
  }
  function firstVisible() { var rows = $$('[data-ged-list] [data-idx]'); return rows.length ? parseInt(rows[0].getAttribute('data-idx'), 10) : -1; }
  function textOf(x) {
    if (x.policy) return x.policy.name + ' ' + x.policy.id + ' ' + (x.policy.explain || '');
    if (x.item) return JSON.stringify(x.item);
    if (x.folder) return x.folder.name;
    return '';
  }
  function stateOf(x) { return x.policy ? (x.policy.state || 'NotConfigured') : null; }
  function renderList() {
    var list = $('[data-ged-list]'); list.textContent = '';
    var q = $('[data-ged-q]').value.trim(), on = listSearch ? listSearch.active() : !!q;
    if (listSearch && !listSearch.compiled.ok) { $('[data-ged-found]').textContent = t('Invalid pattern'); }
    var shown = 0, conf = 0;
    if (listKind === 'table') list.appendChild(addRow());
    listItems.forEach(function (x, i) {
      var st = stateOf(x);
      if (st && st !== 'NotConfigured') conf++;
      if (on && !(listSearch ? listSearch.test(textOf(x)) : textOf(x).toLowerCase().indexOf(q.toLowerCase()) >= 0)) return;
      if (filter === 'configured' && x.policy && st === 'NotConfigured') return;
      if (supported && x.policy && x.policy.supportedOn !== supported) return;
      shown++;
      var b = el('button', 'p-row'); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('data-idx', String(i));
      b.setAttribute('aria-current', i === activeIdx ? 'true' : 'false'); b.setAttribute('aria-selected', i === activeIdx ? 'true' : 'false');
      var nm = el('span', 'nm');
      if (x.policy) { nm.appendChild(doc.createTextNode(x.policy.name)); b.appendChild(nm); var s = el('span', 'p-st' + (st === 'Enabled' ? ' en' : st === 'Disabled' ? ' dis' : ''), st === 'Enabled' ? t('Enabled') : st === 'Disabled' ? t('Disabled') : st ? t('Not set') : '?'); b.appendChild(s); }
      else if (x.folder) { nm.appendChild(doc.createTextNode(x.folder.name)); b.appendChild(nm); b.appendChild(el('span', 'subtle', '›')); }
      else if (x.item) { var sum = summarize(x.item, current); nm.appendChild(doc.createTextNode(sum[0])); nm.appendChild(el('span', 'sub', sum[1])); b.appendChild(nm); if (sum[2]) b.appendChild(el('span', 'p-st en', sum[2])); }
      b.addEventListener('click', function () { if (x.folder) { openIds[x.folder.id] = true; if (current) openIds[current.id] = true; selectNode(x.folder); } else openItem(i); });
      b.addEventListener('keydown', function (e) {
        var rows = $$('[data-ged-list] [data-idx]'), k = rows.indexOf(b);
        if (e.key === 'ArrowDown') { e.preventDefault(); if (rows[k + 1]) rows[k + 1].focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (rows[k - 1]) rows[k - 1].focus(); }
      });
      list.appendChild(b);
    });
    var cc = $('[data-ged-ccount]'); if (cc) cc.textContent = listKind === 'admx' ? String(conf) : '';
    if (!listSearch || listSearch.compiled.ok) $('[data-ged-found]').textContent = on ? t('{count} matches', { count: shown }) : (listKind === 'admx' ? t('{count} policies', { count: listItems.length }) : '');
    if (listSearch && on) listSearch.highlight($$('[data-ged-list] .p-row .nm'));
    else if (listSearch) listSearch.highlight([]);
    if (!shown && listKind !== 'table') list.appendChild(emptyRow(on ? t('No matches') : t('Nothing here for this scope. Try the other scope or another folder.')));
    if (!shown && listKind === 'table' && !listItems.length) list.appendChild(emptyRow(t('No items yet. Add the first one.')));
    var cnt = $('[data-ged-count]'); if (cnt && listKind === 'admx' && current) cnt.textContent = t('{count} configured here', { count: conf });
  }
  var qTimer = null;
  // The policy search is a search surface: plain text also asks the agent for matching policies,
  // a regular expression only filters the policies already listed (the agent has no regex search).
  var listSearch = S.mount($('[data-ged-q]'), { kind: 'custom', bare: true, highlight: true, onChange: function () { renderList(); } });
  function plainQuery() { return !listSearch || !listSearch.state().regex; }
  $('[data-ged-q]').addEventListener('input', function () {
    clearTimeout(qTimer);
    if (!plainQuery()) return;
    var q = this.value.trim();
    if (listKind === 'admx' || !current || current.kind === 'folder') {
      qTimer = setTimeout(function () { if (q.length >= 3 && (!current || current.kind !== 'admx' || current.all || !listItems.length)) loadPolicies('', q); }, 450);
    }
  });
  $('[data-ged-q]').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var q = this.value.trim(); if (q && plainQuery()) { $('[data-ged-midtitle]').textContent = t('Search: {text}', { text: q }); loadPolicies('', q); } } else if (e.key === 'ArrowDown') { var r = $('[data-ged-list] [data-idx]'); if (r) { e.preventDefault(); r.focus(); } } });
  $$('[data-f]').forEach(function (b) { b.addEventListener('click', function () { filter = b.getAttribute('data-f'); $$('[data-f]').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); }); renderList(); }); });
  $('[data-ged-supported]').addEventListener('change', function () { supported = this.value; renderList(); });
  $$('[data-ged-back]').forEach(function (b) { b.addEventListener('click', function () { setView(b.getAttribute('data-ged-back')); }); });

  function openItem(i) {
    if (i < 0 || !listItems[i]) return;
    activeIdx = i;
    $$('[data-ged-list] [data-idx]').forEach(function (r) { var on = r.getAttribute('data-idx') === String(i); r.setAttribute('aria-current', on ? 'true' : 'false'); r.setAttribute('aria-selected', on ? 'true' : 'false'); });
    var x = listItems[i];
    if (x.policy) policySheet(x.policy);
    else if (x.item !== undefined) itemSheet(x.item, i);
    setView('edit');
    if (x.policy) syncUrl(x.policy.id);
  }
  function step(d) {
    var rows = $$('[data-ged-list] [data-idx]').map(function (r) { return parseInt(r.getAttribute('data-idx'), 10); });
    var k = rows.indexOf(activeIdx); if (rows[k + d] != null) { openItem(rows[k + d]); var r = $('[data-ged-list] [data-idx="' + rows[k + d] + '"]'); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' }); }
  }

  // ---------------------------------------------------------- ADMX policy sheet
  var MEANING = {
    NotConfigured: 'Inherit: this policy leaves the setting alone',
    Enabled: 'Turn the policy on with the options below',
    Disabled: 'Turn the policy off explicitly'
  };
  function sheetHead(sheet, crumb, title) {
    var top = el('div', 'sheet-top');
    var back = el('button', 'btn sm text ged-back', '‹ ' + t('Back')); back.type = 'button'; back.addEventListener('click', function () { setView('list'); }); top.appendChild(back);
    var h = el('div'); h.style.minWidth = '0'; h.appendChild(el('div', 'crumb', crumb)); var h2 = el('h2', null, title); h2.id = 'ged-sheet-title'; h.appendChild(h2); top.appendChild(h);
    sheet.appendChild(top); sheet.setAttribute('aria-labelledby', 'ged-sheet-title');
  }
  function policySheet(p) {
    var sheet = $('[data-ged-sheet]'); sheet.textContent = '';
    sheet.style.animation = 'none'; void sheet.offsetWidth; sheet.style.animation = '';
    sheetHead(sheet, current ? pathOf(current) : (scope === 'User' ? t('User') : t('Computer')), p.name);
    var form = el('form', 'stack'); form.style.gap = '14px'; form.noValidate = true; sheet.appendChild(form);
    form.appendChild(el('div', 'skeleton')).style.height = '64px';
    C.getJSON('/api/gpo/' + enc(gid) + '/policy/' + enc(p.id) + '?scope=' + scope).then(function (s) { drawPolicy(form, p, s.state, s.values || {}); }, function (e) { form.textContent = ''; form.appendChild(el('p', 'alert error', e.message)); });
  }
  function drawPolicy(form, p, state, values) {
    form.textContent = '';
    var fs = el('fieldset', 'opt-cards'); fs.setAttribute('role', 'radiogroup'); fs.setAttribute('aria-label', t('State'));
    var legend = el('legend', 'sr-only', t('State')); fs.appendChild(legend);
    var enabledText = p.enabledMeaning || (p.elements && p.elements.length ? t('Turn the policy on with the options below') : t(MEANING.Enabled));
    [['NotConfigured', t('Not set'), t(MEANING.NotConfigured)], ['Enabled', t('Enabled'), p.enabledMeaning || enabledText], ['Disabled', t('Disabled'), p.disabledMeaning || t(MEANING.Disabled)]].forEach(function (o) {
      var lab = el('label', 'opt'); var r = el('input'); r.type = 'radio'; r.name = 'state'; r.value = o[0]; r.checked = state === o[0];
      r.addEventListener('change', function () { opts.disabled = r.value !== 'Enabled'; opts.toggleAttribute('disabled', r.value !== 'Enabled'); });
      lab.appendChild(r); lab.appendChild(el('span', 'o1', o[1])); lab.appendChild(el('span', 'o2', o[2])); fs.appendChild(lab);
    });
    form.appendChild(fs);
    var opts = el('fieldset', 'el-box'); opts.disabled = state !== 'Enabled'; if (state !== 'Enabled') opts.setAttribute('disabled', '');
    var lg = el('legend', 'sr-only', t('Options')); opts.appendChild(lg);
    (p.elements || []).forEach(function (e2) { opts.appendChild(elementControl(e2, values[e2.id])); });
    if ((p.elements || []).length) form.appendChild(opts);
    var help = el('p', 'help-text', p.explain || t('No help text is provided for this policy.')); form.appendChild(help);
    var tags = el('div', 'tagrow');
    if (p.supportedOn) tags.appendChild(el('span', null, p.supportedOn));
    if (p.key) { var reg = (admxClass() === 'User' ? 'HKCU\\' : 'HKLM\\') + p.key + (p.valueName ? '\\' + p.valueName : ''); var rb = el('button', 'mono', reg); rb.type = 'button'; rb.title = t('Copy'); rb.setAttribute('aria-label', t('Copy') + ' ' + reg); rb.addEventListener('click', function () { TD.copyText(reg).then(function () { toast(t('Copied'), 'success'); }); }); tags.appendChild(rb); }
    tags.appendChild(el('span', 'mono', p.id));
    form.appendChild(tags);
    form.appendChild(el('p', 'hint', t('A policy backup is taken first, so Undo can restore it.')));
    var acts = el('div', 'sheet-actions');
    var ap = el('button', 'btn filled', t('Apply')); ap.type = 'submit'; acts.appendChild(ap);
    var pv = el('button', 'btn', t('Previous')); pv.type = 'button'; pv.addEventListener('click', function () { step(-1); }); acts.appendChild(pv);
    var nx = el('button', 'btn', t('Next')); nx.type = 'button'; nx.addEventListener('click', function () { step(1); }); acts.appendChild(nx);
    form.appendChild(acts);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var fields = { 'class': admxClass(), category: (current && current.category) || p.categoryId || '' };
      var fd = new FormData(form); fd.forEach(function (v, k) { if (fields[k] === undefined) fields[k] = fd.getAll(k).length > 1 ? fd.getAll(k) : v; else if (Array.isArray(fields[k])) {} });
      fields.state = (form.querySelector('input[name="state"]:checked') || {}).value;
      // list editors: collect in order
      $$('[data-list-editor]', form).forEach(function (le) { var n = le.getAttribute('data-name'); fields[n] = $$('input[name="' + n + '"]', le).map(function (i) { return i.value; }); var nn = $$('input[name="' + n + '_name"]', le).map(function (i) { return i.value; }); if (nn.length) fields[n + '_name'] = nn; });
      ap.disabled = true;
      C.postForm('/gpo/' + enc(gid) + '/admx/' + enc(p.id), fields).then(function (j) {
        p.state = fields.state; toast(j.message || t('Policy saved.'), 'success'); renderList();
        var row = $('[data-ged-list] [data-idx="' + activeIdx + '"]'); if (row) row.focus();
      }, fail).then(function () { ap.disabled = false; });
    });
  }
  function elementControl(e2, v) {
    var name = 'el_' + e2.id, wrap = el('div', 'field'), id = 'ged-' + e2.id;
    var desc = e2.description || e2.help || '';
    function lbl(text) { var l = el('label', 'el-q', text); l.htmlFor = id; return l; }
    if (e2.type === 'boolean') {
      var sw = el('label', 'switch'); var s = el('span'); s.appendChild(doc.createTextNode(e2.label)); if (desc) s.appendChild(el('small', null, desc)); sw.appendChild(s);
      var c = el('input'); c.type = 'checkbox'; c.name = name; c.setAttribute('role', 'switch'); c.checked = !!v; sw.appendChild(c); return sw;
    }
    if (e2.type === 'enum' && (e2.items || []).length <= 4) {
      var fs = el('fieldset', 'stack tight'); fs.appendChild(el('legend', 'el-q', e2.label)); if (desc) fs.appendChild(el('div', 'el-d', desc));
      var cards = el('div', 'opt-cards' + ((e2.items || []).length === 2 ? ' two' : '')); cards.setAttribute('role', 'radiogroup');
      (e2.items || []).forEach(function (it, k) { var l = el('label', 'opt soft'); l.style.minHeight = '52px'; var r = el('input'); r.type = 'radio'; r.name = name; r.value = it.id; r.checked = v != null ? String(v) === String(it.id) : k === 0; l.appendChild(r); l.appendChild(el('span', 'o1', it.label)); if (it.description) l.appendChild(el('span', 'o2', it.description)); cards.appendChild(l); });
      fs.appendChild(cards); return fs;
    }
    wrap.appendChild(lbl(e2.label + (e2.required ? ' *' : '')));
    if (desc) wrap.appendChild(el('div', 'el-d', desc));
    var inp;
    if (e2.type === 'decimal') { inp = el('input'); inp.type = 'number'; inp.inputMode = 'numeric'; if (e2.min != null) inp.min = e2.min; if (e2.max != null) inp.max = e2.max; inp.value = v != null ? v : (e2['default'] != null ? e2['default'] : ''); if (e2.min != null || e2.max != null) wrap.appendChild(el('span', 'hint', t('From {min} to {max}', { min: e2.min != null ? e2.min : '', max: e2.max != null ? e2.max : '' }))); }
    else if (e2.type === 'text') { inp = el('input'); inp.type = 'text'; inp.value = v || ''; if (e2.maxLength) inp.maxLength = e2.maxLength; }
    else if (e2.type === 'multiText') { inp = el('textarea'); inp.rows = 4; inp.value = Array.isArray(v) ? v.join('\n') : (v || ''); wrap.appendChild(el('span', 'hint', t('One line per entry.'))); }
    else if (e2.type === 'enum') { inp = el('select'); /* search: gpo-enum */ (e2.items || []).forEach(function (it) { inp.appendChild(new Option(it.label, it.id, false, String(v) === String(it.id))); }); }
    else if (e2.type === 'list') { return listEditor(e2, v, name, desc); }
    else { inp = el('input'); inp.type = 'text'; inp.value = v == null ? '' : String(v); }
    inp.id = id; inp.name = name; if (e2.required) inp.required = true;
    wrap.insertBefore(inp, wrap.children[desc ? 2 : 1] || null);
    if (inp.tagName === 'SELECT' && inp.options.length > 8) selectSearch(inp, 'gpo-enum', e2.label);
    return wrap;
  }
  // A search field for a long drop-down list (enumerations from ADMX files, item fields).
  function selectSearch(sel, id, label) {
    var h = el('div', 'ss-host tight'); h.setAttribute('data-search-surface', id); h.setAttribute('data-search-manual', '');
    sel.parentNode.insertBefore(h, sel);
    S.mount(h, { kind: 'select', target: sel, compact: true, label: t('Search {name}', { name: label }) });
  }
  function listEditor(e2, v, name, desc) {
    var w = el('div', 'field'); w.setAttribute('data-list-editor', ''); w.setAttribute('data-name', name);
    w.appendChild(el('span', 'el-q', e2.label)); if (desc) w.appendChild(el('div', 'el-d', desc));
    var lh = el('div', 'ss-host tight'); lh.setAttribute('data-search-surface', 'gpo-list-values'); lh.setAttribute('data-search-manual', ''); w.appendChild(lh);
    var rows = el('div', 'stack tight'); rows.setAttribute('role', 'list'); /* search: gpo-list-values */ w.appendChild(rows);
    S.mount(lh, { kind: 'list', target: rows, compact: true, highlight: false, label: t('Search the entries of {name}', { name: e2.label }),
      textFn: function (r) { return Array.prototype.map.call(r.querySelectorAll('input'), function (i) { return i.value; }).join(' '); } });
    var named = v && typeof v === 'object' && !Array.isArray(v);
    function addRow(k, val, isNamed) {
      var r = el('div', 'cluster'); r.style.flexWrap = 'nowrap'; r.setAttribute('role', 'listitem');
      if (isNamed) { var n = el('input'); n.name = name + '_name'; n.value = k || ''; n.placeholder = t('Name'); n.setAttribute('aria-label', t('Name')); n.style.flex = '1 1 120px'; r.appendChild(n); }
      var i = el('input'); i.name = name; i.value = val || ''; i.placeholder = t('Value'); i.setAttribute('aria-label', t('Value')); i.style.flex = '1 1 160px'; r.appendChild(i);
      var x = el('button', 'btn icon text', '×'); x.type = 'button'; x.setAttribute('aria-label', t('Remove')); x.addEventListener('click', function () { r.remove(); }); r.appendChild(x);
      rows.appendChild(r); return i;
    }
    if (named) Object.keys(v).forEach(function (k) { addRow(k, v[k], true); }); else (v || []).forEach(function (x) { addRow('', x, false); });
    var bar = el('div', 'cluster');
    var a = el('button', 'btn sm tonal', t('Add row')); a.type = 'button'; a.addEventListener('click', function () { addRow('', '', named || e2.explicitValue).focus(); }); bar.appendChild(a);
    if (!named && !e2.explicitValue) { var an = el('button', 'btn sm text', t('Add named row')); an.type = 'button'; an.addEventListener('click', function () { named = true; addRow('', '', true).focus(); }); bar.appendChild(an); }
    w.appendChild(bar); return w;
  }

  // ---------------------------------------------------------- table nodes (items)
  // Built-in schemas for the routes every agent has; the agent's GET /gpo/nodes/schema extends them.
  var BUILTIN = {
    'registry': { title: 'Registry value', key: ['key', 'valueName'], fields: [
      { id: 'key', label: 'Key', type: 'text', mono: true, required: true, placeholder: 'HKLM\\Software\\Policies\\...', help: 'Must start with HKLM\\ or HKCU\\.' },
      { id: 'valueName', label: 'Value name', type: 'text', mono: true },
      { id: 'type', label: 'Type', type: 'enum', options: ['String', 'ExpandString', 'DWord', 'QWord', 'MultiString', 'Binary'], 'default': 'DWord' },
      { id: 'value', label: 'Value', type: 'text', mono: true, help: 'DWord and QWord accept decimal or 0x hex. MultiString takes one string per line.' }],
      write: { method: 'PUT' }, remove: { method: 'DELETE', params: ['key', 'valueName'] } },
    'preferences/registry': { title: 'Registry item', gpp: true, key: ['key', 'valueName'], fields: [
      { id: 'action', label: 'Action', type: 'enum', options: ['Update', 'Create', 'Replace', 'Delete'], 'default': 'Update', help: 'Create adds the value only if missing. Replace deletes and recreates it. Update changes it or creates it. Delete removes it.' },
      { id: 'key', label: 'Key', type: 'text', mono: true, required: true },
      { id: 'valueName', label: 'Value name', type: 'text', mono: true },
      { id: 'type', label: 'Type', type: 'enum', options: ['String', 'ExpandString', 'DWord', 'QWord', 'MultiString', 'Binary'], 'default': 'String' },
      { id: 'value', label: 'Value', type: 'text', mono: true }],
      fixed: { context: function () { return scope; } }, write: { method: 'PUT' }, remove: { method: 'DELETE', params: ['key', 'valueName', 'context'] } }
  };
  function schemaFor(n) {
    var key = n.schema || n.node;
    var s = null;
    if (schema) {
      var src = schema.nodes || schema.schemas || schema.items || schema;
      if (Array.isArray(src)) s = src.filter(function (x) { return x.id === key || x.node === key || x.name === key; })[0];
      else if (src && typeof src === 'object') s = src[key] || src[n.node] || src[String(key || '').split('/').pop()];
    }
    var b = BUILTIN[n.node] || BUILTIN[key];
    if (!s) return b || null;
    var fields = (s.fields || s.properties || s.columns || []).map(function (f) { return typeof f === 'string' ? { id: f, label: f, type: 'text' } : f; });
    return { title: s.title || s.label || n.name, fields: fields, key: s.key || s.keys || (b && b.key) || null, gpp: s.gpp != null ? s.gpp : /preferences/i.test(n.node || '') || !!s.commonOptions,
      write: s.write || b && b.write || null, remove: s.remove || b && b.remove || null, fixed: b && b.fixed, targets: s.targets || s.targetingTypes || null };
  }
  function loadItems(n) {
    listKind = 'table'; activeIdx = -1;
    var list = $('[data-ged-list]'); list.textContent = ''; list.appendChild(el('div', 'skeleton')).style.height = '44px';
    var params = new URLSearchParams({ node: n.node }); if (/preferences/.test(n.node)) params.set('context', scope);
    if (n.node === 'registry') params.set('key', scope === 'User' ? 'HKCU\\Software\\Policies' : 'HKLM\\Software\\Policies');
    C.getJSON('/api/gpo/' + enc(gid) + '/node?' + params).then(function (r) {
      var items = r.items; if (items && !Array.isArray(items)) items = items.items || items.values || items.rows || [];
      items = (items || []).filter(function (it) { return !it || !it.context || it.context === scope || /preferences/.test(n.node) === false; });
      listItems = items.map(function (it) { return { item: it }; });
      renderList();
      if (!phone.matches && listItems.length) openItem(firstVisible()); else if (!listItems.length) itemSheet(null, -1);
    }, function (e) { list.textContent = ''; list.appendChild(emptyRow(e.message)); clearSheet(); });
  }
  function summarize(it, n) {
    var s = schemaFor(n || current) || {}, f = s.fields || [];
    var title = it.name || it.displayName || it.label || it.title || (it.key ? it.key + (it.valueName ? '\\' + it.valueName : '') : null) || (f[0] && it[f[0].id]) || JSON.stringify(it).slice(0, 60);
    var sub = [it.action, it.type, it.value != null && typeof it.value !== 'object' ? String(it.value) : null, it.path, it.letter, it.direction, it.startupType].filter(function (x) { return x != null && x !== ''; }).join(' · ');
    var badge = it.enabled === false ? t('Off') : it.policyState || it.state || null;
    return [String(title), sub, badge ? String(badge) : ''];
  }
  function addRow() {
    var b = el('button', 'p-row'); b.type = 'button'; b.style.color = 'var(--primary)'; b.style.fontWeight = '700';
    b.appendChild(el('span', 'nm', '+ ' + t('New item'))); b.addEventListener('click', function () { activeIdx = -1; renderList(); itemSheet(null, -1); setView('edit'); });
    return b;
  }
  function itemSheet(item, idx) {
    var sheet = $('[data-ged-sheet]'); sheet.textContent = '';
    sheet.style.animation = 'none'; void sheet.offsetWidth; sheet.style.animation = '';
    var n = current, s = schemaFor(n);
    sheetHead(sheet, pathOf(n), item ? summarize(item, n)[0] : t('New item'));
    if (!s) {
      sheet.appendChild(el('p', 'muted', t('The agent did not describe the fields for this kind of item, so it is shown read only.')));
      if (item) { var pre = el('pre', 'st-raw'); pre.textContent = JSON.stringify(item, null, 2); sheet.appendChild(pre); }
      return;
    }
    var form = el('form', 'stack'); form.style.gap = '12px'; form.noValidate = true; sheet.appendChild(form);
    var grid = el('div', 'form-grid'); form.appendChild(grid);
    (s.fields || []).forEach(function (f) { if (f.hidden) return; grid.appendChild(fieldControl(f, item ? item[f.id] : undefined, !!item && (s.key || []).indexOf(f.id) >= 0 && s.keyLocked)); });
    var gpp = null, ilt = null;
    if (s.gpp) { gpp = commonOptions(item || {}); form.appendChild(gpp.el); ilt = targeting((item || {}).targeting || (item || {}).filters || (item || {}).itemLevelTargeting || [], s.targets); form.appendChild(ilt.el); }
    form.appendChild(el('p', 'hint', t('A policy backup is taken first, so Undo can restore it.')));
    var acts = el('div', 'sheet-actions');
    var ap = el('button', 'btn filled', item ? t('Apply') : t('Add')); ap.type = 'submit'; acts.appendChild(ap);
    if (item) { var dl = el('button', 'btn danger', t('Delete')); dl.type = 'button'; dl.addEventListener('click', function () { removeItem(item, s); }); acts.appendChild(dl); }
    var pv = el('button', 'btn', t('Previous')); pv.type = 'button'; pv.addEventListener('click', function () { step(-1); }); acts.appendChild(pv);
    var nx = el('button', 'btn', t('Next')); nx.type = 'button'; nx.addEventListener('click', function () { step(1); }); acts.appendChild(nx);
    form.appendChild(acts);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var body = {}, bad = null;
      (s.fields || []).forEach(function (f) {
        var v = readField(form, f);
        if (f.required && (v === '' || v == null || (Array.isArray(v) && !v.length))) bad = bad || t('{name}: a value is required.', { name: t(f.label || f.id) });
        if (v !== undefined) body[f.id] = v;
      });
      if (n.node === 'registry' || n.node === 'preferences/registry') {
        if (!/^(HKLM|HKCU|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER)\\/i.test(body.key || '')) bad = bad || t('The key must start with HKLM\\ or HKCU\\.');
        if (body.type === 'DWord' || body.type === 'QWord') { var raw = String(body.value || '').trim(); var num = /^0x/i.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10); if (isNaN(num)) bad = bad || t('DWord and QWord values must be numbers (decimal or 0x hex).'); else body.value = num; }
        if (body.type === 'MultiString') body.value = String(body.value || '').split(/\r?\n/).filter(Boolean);
      }
      Object.keys(s.fixed || {}).forEach(function (k) { body[k] = typeof s.fixed[k] === 'function' ? s.fixed[k]() : s.fixed[k]; });
      if (gpp) { var co = gpp.read(); Object.keys(co).forEach(function (k) { body[k] = co[k]; }); body.targeting = ilt.read(); }
      if (!body.context && /preferences/.test(n.node)) body.context = scope;
      if (item && item.id != null && body.id == null) body.id = item.id;
      if (bad) { toast(bad, 'error'); return; }
      var w = s.write || { method: item ? 'PUT' : 'POST' };
      var method = item ? (w.update || w.method || 'PUT') : (w.create || w.method || 'POST');
      var node = n.node + (item && item.id != null && w.byId ? '/' + enc(item.id) : '');
      ap.disabled = true;
      C.postJSON('/api/gpo/' + enc(gid) + '/node', { node: node, method: method, json: body, summary: (item ? 'Edit ' : 'Add ') + (s.title || n.name) + ': ' + summarize(body, n)[0] })
        .then(function (j) { C.toastUndo(j.message, j.undoId, function () { loadItems(n); }); loadItems(n); }, fail).then(function () { ap.disabled = false; });
    });
  }
  function removeItem(item, s) {
    var n = current, r = s.remove || { method: 'DELETE' };
    var params = {}; (r.params || s.key || []).forEach(function (k) { if (item[k] != null) params[k] = item[k]; });
    if (!params.context && /preferences/.test(n.node)) params.context = scope;
    var node = n.node + (item.id != null && (r.byId || (s.write && s.write.byId)) ? '/' + enc(item.id) : '');
    if (item.id != null && !Object.keys(params).length) params.id = item.id;
    if (!window.confirm(t('Delete this item? A policy backup is taken first, so Undo can restore it.'))) return;
    C.postJSON('/api/gpo/' + enc(gid) + '/node', { node: node, method: 'DELETE', params: params, summary: 'Delete ' + (s.title || n.name) + ': ' + summarize(item, n)[0] })
      .then(function (j) { C.toastUndo(j.message, j.undoId, function () { loadItems(n); }); loadItems(n); }, fail);
  }
  function fieldControl(f, v, locked) {
    var id = 'gf-' + f.id, w = el('div', 'field'), type = f.type || 'text';
    if (v === undefined && f['default'] !== undefined) v = f['default'];
    if (type === 'boolean' || type === 'bool' || type === 'switch') {
      var sw = el('label', 'switch'); var s = el('span'); s.appendChild(doc.createTextNode(t(f.label || f.id))); if (f.help || f.description) s.appendChild(el('small', null, f.help || f.description)); sw.appendChild(s);
      var c = el('input'); c.type = 'checkbox'; c.setAttribute('role', 'switch'); c.checked = !!v; c.setAttribute('data-f', f.id); sw.appendChild(c); sw.style.gridColumn = '1 / -1'; return sw;
    }
    var l = el('label', null, t(f.label || f.id) + (f.required ? ' *' : '')); l.htmlFor = id; w.appendChild(l);
    var inp, opts = f.options || f['enum'] || f.items || f.choices;
    if (opts && (type === 'enum' || type === 'select' || type === 'choice' || !f.type)) {
      inp = el('select'); /* search: gpo-field-enum */ opts.forEach(function (o) { var val = typeof o === 'object' ? (o.id != null ? o.id : o.value) : o, lab = typeof o === 'object' ? (o.label || o.name || val) : o; inp.appendChild(new Option(t(String(lab)), val, false, String(v) === String(val))); });
    } else if (type === 'number' || type === 'integer' || type === 'decimal' || type === 'port') { inp = el('input'); inp.type = 'number'; if (f.min != null) inp.min = f.min; if (f.max != null) inp.max = f.max; inp.value = v == null ? '' : v; }
    else if (type === 'multiline' || type === 'multiText' || type === 'textarea' || type === 'list' || type === 'array') { inp = el('textarea'); inp.rows = 3; inp.value = Array.isArray(v) ? v.join('\n') : (v == null ? '' : String(v)); w.appendChild(el('span', 'hint', t('One line per entry.'))); w.style.gridColumn = '1 / -1'; }
    else if (type === 'password' || type === 'secret') { inp = el('input'); inp.type = 'password'; inp.autocomplete = 'new-password'; inp.placeholder = v ? t('Unchanged') : ''; }
    else if (type === 'datetime' || type === 'date' || type === 'time') { inp = el('input'); inp.type = type === 'datetime' ? 'datetime-local' : type; inp.value = v || ''; }
    else { inp = el('input'); inp.type = 'text'; inp.value = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); if (f.placeholder) inp.placeholder = f.placeholder; }
    if (f.mono || /path|key|sid|ip|port|address|command|program/i.test(f.id)) inp.classList.add('mono');
    inp.id = id; inp.setAttribute('data-f', f.id); inp.setAttribute('data-type', type); if (f.required) inp.required = true; if (locked) inp.readOnly = true;
    w.appendChild(inp);
    if (inp.tagName === 'SELECT' && inp.options.length > 8) selectSearch(inp, 'gpo-field-enum', f.label || f.id);
    if (f.help || f.description) w.appendChild(el('span', 'hint', f.help || f.description));
    return w;
  }
  function readField(form, f) {
    var i = form.querySelector('[data-f="' + f.id + '"]'); if (!i) return undefined;
    if (i.type === 'checkbox') return i.checked;
    var type = i.getAttribute('data-type');
    if (i.type === 'password' && !i.value) return undefined;
    if (i.type === 'number') return i.value === '' ? null : Number(i.value);
    if (type === 'list' || type === 'array') return i.value.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    return i.value;
  }
  function commonOptions(item) {
    var box = el('details', 'el-box'); box.open = !!(item.stopOnError || item.runInUserContext || item.removeWhenNotApplied || item.applyOnce || (item.targeting || []).length);
    box.appendChild(el('summary', 'el-q', t('Common options')));
    var opts = [['stopOnError', t('Stop processing items in this extension if an error occurs')], ['runInUserContext', t("Run in logged-on user's security context")], ['removeWhenNotApplied', t('Remove this item when it is no longer applied')], ['applyOnce', t('Apply once and do not reapply')]];
    var g = el('div', 'stack tight');
    opts.forEach(function (o) { var l = el('label', 'switch'); l.appendChild(el('span', null, o[1])); var c = el('input'); c.type = 'checkbox'; c.setAttribute('role', 'switch'); c.checked = !!item[o[0]]; c.setAttribute('data-co', o[0]); l.appendChild(c); g.appendChild(l); });
    var dw = el('div', 'field'); var dl = el('label', null, t('Description')); dl.htmlFor = 'gco-desc'; var di = el('input'); di.id = 'gco-desc'; di.value = item.description || ''; dw.appendChild(dl); dw.appendChild(di); g.appendChild(dw);
    box.appendChild(g);
    return { el: box, read: function () { var o = {}; $$('[data-co]', box).forEach(function (c) { o[c.getAttribute('data-co')] = c.checked; }); o.description = di.value; return o; } };
  }
  var ILT_TYPES = ['Computer name', 'Security group', 'User', 'Organizational unit', 'Operating system', 'IP address range', 'Registry match', 'File match', 'WMI query', 'Environment variable', 'Battery present', 'Language', 'Site', 'Time range', 'Domain'];
  function targeting(list, types) {
    types = types || ILT_TYPES;
    var box = el('details', 'el-box'); box.open = !!(list && list.length);
    box.appendChild(el('summary', 'el-q', t('Item-level targeting') + (list && list.length ? ' (' + list.length + ')' : '')));
    box.appendChild(el('div', 'el-d', t('The item applies only when these conditions are true. Leave empty to apply everywhere the policy applies.')));
    var th = el('div', 'ss-host tight'); th.setAttribute('data-search-surface', 'gpo-targeting'); th.setAttribute('data-search-manual', ''); box.appendChild(th);
    var rows = el('div', 'stack tight'); rows.setAttribute('role', 'list'); /* search: gpo-targeting */ box.appendChild(rows);
    S.mount(th, { kind: 'list', target: rows, items: '.ilt-row', compact: true, highlight: false, label: t('Search the conditions'),
      textFn: function (r) { return Array.prototype.map.call(r.querySelectorAll('select, input:not([type="checkbox"])'), function (i) { return i.tagName === 'SELECT' ? (i.options[i.selectedIndex] || {}).text : i.value; }).join(' '); } });
    function add(r) {
      r = r || {};
      var row = el('div', 'ilt-row'); row.setAttribute('role', 'listitem');
      var join = el('select'); /* search-exempt: two fixed choices, And or Or */ join.setAttribute('aria-label', t('Join')); [['AND', t('And')], ['OR', t('Or')]].forEach(function (x) { join.appendChild(new Option(x[1], x[0], false, (r.bool || r.join || 'AND').toUpperCase() === x[0])); });
      if (!rows.children.length) join.style.visibility = 'hidden';
      var ty = el('select'); /* search-exempt: fixed list of targeting condition types */ ty.setAttribute('aria-label', t('Condition type')); types.forEach(function (x) { var v = typeof x === 'object' ? x.id : x, lab = typeof x === 'object' ? x.label : x; ty.appendChild(new Option(t(lab), v, false, (r.type || '') === v)); });
      var val = el('input'); val.setAttribute('aria-label', t('Value')); val.value = r.value || r.name || ''; val.placeholder = t('Value, for example LIB-PC-*');
      var nt = el('label', 'check small'); var nc = el('input'); nc.type = 'checkbox'; nc.checked = !!r.not; nt.appendChild(nc); nt.appendChild(doc.createTextNode(' ' + t('Is not')));
      var x = el('button', 'btn icon text', '×'); x.type = 'button'; x.setAttribute('aria-label', t('Remove condition')); x.addEventListener('click', function () { row.remove(); var f = rows.firstElementChild; if (f) f.firstElementChild.style.visibility = 'hidden'; });
      var tail = el('div', 'cluster'); tail.style.flexWrap = 'nowrap'; tail.appendChild(nt); tail.appendChild(x);
      row.appendChild(join); row.appendChild(ty); row.appendChild(val); row.appendChild(tail); rows.appendChild(row);
      row._read = function () { return { bool: join.value, type: ty.value, value: val.value, not: nc.checked }; };
    }
    (list || []).forEach(add);
    var b = el('button', 'btn sm tonal', '+ ' + t('Add condition')); b.type = 'button'; b.addEventListener('click', function () { add(); box.open = true; rows.lastElementChild.querySelector('input').focus(); });
    box.appendChild(b);
    return { el: box, read: function () { return Array.prototype.map.call(rows.children, function (r) { return r._read(); }).filter(function (r) { return r.value || /battery/i.test(r.type); }); } };
  }

  // ---------------------------------------------------------- url, start
  function syncUrl(pid) {
    var p = new URLSearchParams(); p.set('scope', scope);
    if (current && current.kind === 'admx' && current.category) p.set('category', current.category);
    if (pid) p.set('policy', pid);
    try { history.replaceState(null, '', location.pathname + '?' + p); } catch (e) { /* ignore */ }
  }
  function autoPick() {
    var want = cfg.category ? Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (n) { return n.kind === 'admx' && n.category === cfg.category; })[0] : null;
    if (want) { var p = want.parent; while (p) { openIds[p.id] = true; p = p.parent; } cfg.category = ''; selectNode(want); if (phone.matches && !cfg.policy) setView('list'); return; }
    if (phone.matches) { setView('tree'); return; }
    // Desktop: open the first Administrative Templates category with content.
    var all = Object.keys(byId).map(function (k) { return byId[k]; }).filter(function (n) { return n.kind === 'admx' && !n.all; });
    var adm = all.filter(function (n) { return n.count; })[0] || all.filter(function (n) { return /system/i.test(n.name); })[0] || all[0];
    if (adm) { var q = adm.parent; while (q) { openIds[q.id] = true; q = q.parent; } selectNode(adm); }
  }
  if (cfg.scope === 'User') $$('[data-scope]').forEach(function (x) { x.setAttribute('aria-checked', x.getAttribute('data-scope') === 'User' ? 'true' : 'false'); });
  C.getJSON('/api/gpo/schema').then(function (r) { schema = r.schema; }, function () { schema = null; });
  loadTree().then(autoPick);
  doc.addEventListener('keydown', function (e) {
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    if (e.altKey && e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
  });
})();
