// Directory studio: explorer tree, closable tabs (object editors, map, query
// builder, bulk edit), inspector, problems/search/history/LDAP panel and
// status bar. Uses only the agent routes behind /api/dir/* and the existing
// form routes; every write is recorded in the undo journal on the server.
(function () {
  'use strict';
  var doc = document, TD = window.TD || {}, C = window.TDC;
  var host = doc.querySelector('[data-studio]');
  if (!host || !C) return;
  var t = TD.t || function (k) { return k; };
  var el = C.el;
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  var cfg = {};
  try { cfg = JSON.parse($('[data-studio-cfg]').textContent); } catch (e) { cfg = {}; }
  var caps = cfg.caps || [];
  var rootDn = ((cfg.root || [])[0] || {}).dn || '';
  var nodes = {};            // dn -> {dn,name,objectClass,hasChildren,children:[dn]|null,parent,open}
  var selected = [];         // selected dns in the explorer
  var tabs = [], activeTab = null;
  var objCache = {};         // dn -> object json
  var ldapLog = [];
  var historyRows = [], problems = [], lastSearch = null;
  var panelTab = 'problems';
  var inspectorAttr = null;
  var phone = window.matchMedia('(max-width: 900px)');

  // ---------------------------------------------------------- helpers
  function log(method, url, ms, ok) { ldapLog.unshift({ time: new Date(), method: method, url: url, ms: ms, ok: ok }); ldapLog = ldapLog.slice(0, 200); if (panelTab === 'ldap') renderPanel(); }
  function api(url) { var t0 = performance.now(); return C.getJSON(url).then(function (j) { log('GET', url, Math.round(performance.now() - t0), true); return j; }, function (e) { log('GET', url, Math.round(performance.now() - t0), false); throw e; }); }
  function post(url, body) { var t0 = performance.now(); return C.postJSON(url, body).then(function (j) { log('POST', url, Math.round(performance.now() - t0), true); return j; }, function (e) { log('POST', url, Math.round(performance.now() - t0), false); throw e; }); }
  function cls(o) { var c = o && o.objectClass; if (Array.isArray(c)) c = c[c.length - 1]; return String(c || '').toLowerCase(); }
  function kindOf(c) {
    c = String(c || '').toLowerCase();
    if (c === 'domaindns' || c === 'domain') return 'dom';
    if (c === 'organizationalunit') return 'ou';
    if (c === 'computer') return 'computer';
    if (c === 'user' || c === 'person' || c === 'inetorgperson') return 'user';
    if (c === 'group') return 'group';
    return 'ct';
  }
  function iconFor(c) { var k = kindOf(c); var s = el('span', 'oi ' + k, k === 'user' ? 'U' : k === 'group' ? 'G' : k === 'computer' ? 'C' : ''); s.setAttribute('aria-hidden', 'true'); return s; }
  function first(v) { return Array.isArray(v) ? v[0] : v; }
  function rdnName(dn) { var p = String(dn || '').split(',')[0]; return p.indexOf('=') > 0 ? p.split('=').slice(1).join('=') : dn; }
  function parentOf(dn) { var i = String(dn).indexOf(','); return i > 0 ? dn.slice(i + 1) : ''; }
  function isContainer(c) { var k = kindOf(c); return k === 'dom' || k === 'ou' || k === 'ct'; }
  function toast(m, k) { TD.toast && TD.toast(m, k); }
  function fail(e) { toast(e && e.message ? e.message : String(e), 'error'); }
  function storeGet(k) { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function storeSet(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }

  // ---------------------------------------------------------- explorer tree
  (cfg.root || []).forEach(function (n) { nodes[n.dn] = { dn: n.dn, name: n.name, objectClass: n.objectClass, hasChildren: n.hasChildren !== false, children: null, parent: '', open: false }; });
  if (cfg.domain) $('[data-st-domain]').textContent = cfg.domain;
  $('[data-sb="nc"]').textContent = rootDn;
  function load(dn) {
    var n = nodes[dn];
    if (n && n.children) return Promise.resolve(n.children);
    return api('/api/dir/children?dn=' + encodeURIComponent(dn)).then(function (rows) {
      var kids = [];
      rows.forEach(function (r) { nodes[r.dn] = nodes[r.dn] || { dn: r.dn, name: r.name, objectClass: r.objectClass, hasChildren: r.hasChildren, children: null, parent: dn, open: false }; nodes[r.dn].hasChildren = r.hasChildren; kids.push(r.dn); });
      kids.sort(function (a, b) { var ca = isContainer(nodes[a].objectClass) ? 0 : 1, cb = isContainer(nodes[b].objectClass) ? 0 : 1; return ca - cb || String(nodes[a].name).localeCompare(String(nodes[b].name)); });
      if (n) n.children = kids;
      updateStatus();
      return kids;
    });
  }
  function toggle(dn, force) {
    var n = nodes[dn]; if (!n || !n.hasChildren) return Promise.resolve();
    var want = force != null ? force : !n.open;
    if (!want) { n.open = false; renderTree(); renderMapIfOpen(); return Promise.resolve(); }
    return load(dn).then(function () { n.open = true; renderTree(); renderMapIfOpen(); }, fail);
  }
  function revealPath(dn) {
    // Open each ancestor from the root down so the object is visible in the tree.
    var chain = [], p = dn;
    while (p && p.toLowerCase() !== rootDn.toLowerCase() && p.indexOf(',') > 0) { p = parentOf(p); chain.unshift(p); }
    if (rootDn) chain[0] = rootDn;
    var seq = Promise.resolve();
    chain.forEach(function (d) { seq = seq.then(function () { if (nodes[d]) return toggle(d, true); }); });
    return seq;
  }
  var filterText = '';
  function matches(dn) {
    if (!filterText) return true;
    var n = nodes[dn]; if (!n) return false;
    if (String(n.name).toLowerCase().indexOf(filterText) >= 0) return true;
    return (n.children || []).some(matches);
  }
  function renderTree() {
    var tree = $('[data-st-tree]'); var scroll = tree.scrollTop; tree.textContent = '';
    var ul = el('ul'); ul.setAttribute('role', 'group');
    (cfg.root || []).forEach(function (r) { ul.appendChild(nodeLi(r.dn, 1)); });
    tree.appendChild(ul); tree.scrollTop = scroll;
    if (!(cfg.root || []).length) tree.appendChild(el('p', 'muted', t('The directory tree could not be read.')));
  }
  function nodeLi(dn, level) {
    var n = nodes[dn], li = el('li'); li.setAttribute('role', 'none');
    if (!matches(dn)) { li.hidden = true; return li; }
    var row = el('div', 'st-n'); row.setAttribute('data-dn', dn);
    var tw = el('button', 'tw' + (n.hasChildren ? '' : ' leaf'), '▸'); tw.type = 'button'; tw.tabIndex = -1;
    tw.setAttribute('aria-label', (n.open ? t('Collapse') : t('Expand')) + ' ' + n.name);
    tw.setAttribute('aria-expanded', n.open ? 'true' : 'false');
    tw.addEventListener('click', function (e) { e.stopPropagation(); toggle(dn); });
    var lb = el('button', 'lb'); lb.type = 'button'; lb.setAttribute('role', 'treeitem'); lb.setAttribute('aria-level', String(level));
    if (n.hasChildren) lb.setAttribute('aria-expanded', n.open ? 'true' : 'false');
    lb.setAttribute('aria-selected', selected.indexOf(dn) >= 0 ? 'true' : 'false');
    lb.tabIndex = (selected[0] === dn || (!selected.length && level === 1)) ? 0 : -1;
    lb.appendChild(iconFor(n.objectClass));
    var tx = el('span', 't', n.name); lb.appendChild(tx);
    if (kindOf(n.objectClass) === 'user' || kindOf(n.objectClass) === 'computer') lb.style.fontFamily = 'var(--font-mono)';
    if (n.children) lb.appendChild(el('span', 'c', String(n.children.length)));
    if (activeTab && tabs.some(function (x) { return x.id === activeTab && x.dn === dn; })) lb.classList.add('focus');
    lb.addEventListener('click', function (e) { select(dn, e); });
    lb.addEventListener('dblclick', function () { openObject(dn); });
    lb.addEventListener('keydown', function (e) { treeKey(e, dn); });
    lb.addEventListener('contextmenu', function (e) { e.preventDefault(); e.stopPropagation(); if (selected.indexOf(dn) < 0) select(dn, {}); ctxMenu(e.clientX, e.clientY, dn); });
    // drag and drop between containers
    lb.draggable = kindOf(n.objectClass) !== 'dom';
    lb.addEventListener('dragstart', function (e) { var list = selected.indexOf(dn) >= 0 ? selected.slice() : [dn]; e.dataTransfer.setData('text/x-td-dn', JSON.stringify(list)); e.dataTransfer.effectAllowed = 'move'; });
    if (isContainer(n.objectClass)) {
      lb.addEventListener('dragover', function (e) { if (Array.prototype.indexOf.call(e.dataTransfer.types, 'text/x-td-dn') >= 0) { e.preventDefault(); row.classList.add('drop'); } });
      lb.addEventListener('dragleave', function () { row.classList.remove('drop'); });
      lb.addEventListener('drop', function (e) { e.preventDefault(); row.classList.remove('drop'); var list = []; try { list = JSON.parse(e.dataTransfer.getData('text/x-td-dn')); } catch (x) { return; } moveTo(list, dn); });
    }
    row.appendChild(tw); row.appendChild(lb); li.appendChild(row);
    if (n.open && n.children) {
      var ul = el('ul'); ul.setAttribute('role', 'group');
      n.children.forEach(function (c) { ul.appendChild(nodeLi(c, level + 1)); });
      if (!n.children.length) { var e = el('li', 'subtle small', t('Empty')); e.style.padding = '4px 30px'; ul.appendChild(e); }
      li.appendChild(ul);
    }
    return li;
  }
  function visibleItems() { return $$('[data-st-tree] [role="treeitem"]').filter(function (b) { return b.offsetParent !== null; }); }
  function treeKey(e, dn) {
    var items = visibleItems(), i = items.indexOf(e.currentTarget), n = nodes[dn];
    function go(j) { var b = items[j]; if (b) { var d = b.closest('[data-dn]').getAttribute('data-dn'); select(d, { shiftKey: e.shiftKey }); setTimeout(function () { var nb = $('[data-st-tree] [data-dn="' + cssEsc(d) + '"] .lb'); if (nb) nb.focus(); }, 0); } }
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (n.hasChildren && !n.open) toggle(dn, true).then(refocus); else go(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); if (n.open) toggle(dn, false).then(refocus); else if (nodes[n.parent]) { select(n.parent, {}); setTimeout(function () { var b = $('[data-st-tree] [data-dn="' + cssEsc(n.parent) + '"] .lb'); if (b) b.focus(); }, 0); } }
    else if (e.key === 'Enter') { e.preventDefault(); openObject(dn); }
    else if (e.key === 'Delete') { e.preventDefault(); location.href = '/directory/object?dn=' + encodeURIComponent(dn) + '#delete'; }
    else if (e.key === 'F2') { e.preventDefault(); openObject(dn, 'Attributes'); }
    else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { e.preventDefault(); e.stopPropagation(); var r = e.currentTarget.getBoundingClientRect(); ctxMenu(r.left + 30, r.bottom, dn); }
    function refocus() { var b = $('[data-st-tree] [data-dn="' + cssEsc(dn) + '"] .lb'); if (b) b.focus(); }
  }
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }
  function select(dn, e) {
    e = e || {};
    if (e.ctrlKey || e.metaKey) { var i = selected.indexOf(dn); if (i >= 0) selected.splice(i, 1); else selected.push(dn); }
    else if (e.shiftKey && selected.length) {
      var items = visibleItems().map(function (b) { return b.closest('[data-dn]').getAttribute('data-dn'); });
      var a = items.indexOf(selected[selected.length - 1]), b = items.indexOf(dn);
      if (a >= 0 && b >= 0) { var lo = Math.min(a, b), hi = Math.max(a, b); selected = items.slice(lo, hi + 1); }
    } else selected = [dn];
    renderTree(); updateStatus(); renderInspector();
    if (!(e.ctrlKey || e.metaKey || e.shiftKey) && e.type === 'click') openObject(dn, null, true);
  }
  $('[data-st-filter]').addEventListener('input', function (e) { filterText = e.target.value.trim().toLowerCase(); renderTree(); });

  // ---------------------------------------------------------- context menu
  var menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function ctxMenu(x, y, dn) {
    closeMenu();
    var n = nodes[dn] || { objectClass: '' }, k = kindOf(n.objectClass), many = selected.length > 1;
    var items = [];
    if (!many) {
      items.push([t('Open'), function () { openObject(dn); }, 'Enter']);
      items.push([t('Open in a new tab'), function () { openObject(dn, null, false, true); }]);
      if (k === 'user') { items.push([t('Reset password'), function () { pwDialog(dn); }]); items.push([t('Unlock'), function () { userAction(dn, 'unlock'); }]); }
      if (k === 'user' || k === 'computer') { items.push([t('Enable'), function () { userAction(dn, 'enable'); }]); items.push([t('Disable'), function () { userAction(dn, 'disable'); }]); }
      if (isContainer(n.objectClass)) { items.push([t('Create object here'), function () { location.href = '/directory/create?parent=' + encodeURIComponent(dn); }]); items.push([t('Bulk edit children'), function () { bulkFromContainer(dn); }]); items.push([t('Import users here'), function () { location.href = '/import?ou=' + encodeURIComponent(dn); }]); }
      items.push([t('Move'), function () { moveDialog([dn]); }]);
      items.push([t('Show on the map'), function () { openTab({ id: 'map', kind: 'map', title: t('Map') }); }]);
      items.push([t('Copy distinguished name'), function () { C && TD.copyText(dn).then(function () { toast(t('Copied'), 'success'); }); }]);
      items.push([t('Delete'), function () { location.href = '/directory/object?dn=' + encodeURIComponent(dn) + '#delete'; }, 'Del']);
    } else {
      items.push([t('Bulk edit {count} objects', { count: selected.length }), function () { openBulk(selected.slice()); }]);
      items.push([t('Enable'), function () { selected.forEach(function (d) { userAction(d, 'enable'); }); }]);
      items.push([t('Disable'), function () { selected.forEach(function (d) { userAction(d, 'disable'); }); }]);
      items.push([t('Move'), function () { moveDialog(selected.slice()); }]);
    }
    menu = el('div', 'ctx-menu'); menu.setAttribute('role', 'menu');
    items.forEach(function (it) {
      var b = el('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.tabIndex = -1;
      b.appendChild(el('span', null, it[0])); if (it[2]) b.appendChild(el('kbd', null, it[2]));
      b.addEventListener('click', function () { closeMenu(); it[1](); });
      menu.appendChild(b);
    });
    doc.body.appendChild(menu);
    menu.style.left = Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8)) + 'px';
    var f = menu.querySelector('button'); if (f) f.focus();
    menu.addEventListener('keydown', function (e) {
      var l = $$('button', menu), i = l.indexOf(doc.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); l[(i + 1) % l.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); l[(i - 1 + l.length) % l.length].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); }
    });
  }
  doc.addEventListener('click', function (e) { if (menu && !menu.contains(e.target)) closeMenu(); });

  // ---------------------------------------------------------- dialogs
  var dlg = $('[data-st-dialog]');
  function ask(title, body, okLabel) {
    return new Promise(function (resolve) {
      $('[data-st-dlgtitle]').textContent = title;
      var b = $('[data-st-dlgbody]'); b.textContent = ''; if (typeof body === 'string') b.appendChild(el('p', 'muted', body)); else b.appendChild(body);
      $('[data-st-dlgok]').textContent = okLabel || t('Confirm');
      function done() { dlg.removeEventListener('close', done); resolve(dlg.returnValue === 'ok'); }
      dlg.addEventListener('close', done);
      dlg.returnValue = ''; dlg.showModal();
      var f = b.querySelector('input, select, textarea'); if (f) f.focus();
    });
  }
  function field(label, input) { var w = el('label', 'field'); w.appendChild(el('span', null, label)); w.appendChild(input); return w; }
  function moveTo(list, target) {
    list = list.filter(function (d) { return d !== target && parentOf(d).toLowerCase() !== target.toLowerCase() && target.toLowerCase().indexOf(d.toLowerCase()) < 0; });
    if (!list.length) return;
    var body = el('div', 'stack tight');
    body.appendChild(el('p', null, t('Move {count} object(s) to {target}?', { count: list.length, target: nodes[target] ? nodes[target].name : target })));
    var ul = el('ul', 'small mono'); list.slice(0, 8).forEach(function (d) { ul.appendChild(el('li', null, d)); }); body.appendChild(ul);
    body.appendChild(el('p', 'hint', t('You can undo this afterwards.')));
    ask(t('Move objects'), body, t('Move')).then(function (ok) {
      if (!ok) return;
      var seq = Promise.resolve(), ids = [];
      list.forEach(function (d) { seq = seq.then(function () { return post('/api/dir/move', { dn: d, newParentDn: target }).then(function (j) { ids.push(j.undoId); retarget(d, j.dn); }); }); });
      seq.then(function () { C.toastUndo(t('Moved {count} object(s).', { count: list.length }), ids.length === 1 ? ids[0] : null, reloadAll); afterMove(list, target); }, function (e) { fail(e); reloadAll(); });
    });
  }
  function moveDialog(list) {
    var inp = el('input'); inp.type = 'text'; inp.className = 'mono'; inp.value = parentOf(list[0]); inp.required = true; inp.spellcheck = false;
    var body = el('div', 'stack'); body.appendChild(field(t('New parent container (distinguished name)'), inp));
    ask(t('Move objects'), body, t('Move')).then(function (ok) { if (ok && inp.value.trim()) moveTo(list, inp.value.trim()); });
  }
  function retarget(oldDn, newDn) {
    tabs.forEach(function (tb) { if (tb.dn === oldDn) { tb.dn = newDn; tb.id = 'obj:' + newDn; if (activeTab === 'obj:' + oldDn) activeTab = tb.id; } });
    delete objCache[oldDn];
  }
  function afterMove(list, target) {
    list.forEach(function (d) { var p = nodes[parentOf(d)]; if (p) p.children = null; delete nodes[d]; });
    if (nodes[target]) nodes[target].children = null;
    selected = [];
    reloadOpen().then(function () { saveTabs(); renderTabs(); renderActive(); loadHistory(); });
  }
  function reloadOpen() {
    var open = Object.keys(nodes).filter(function (d) { return nodes[d].open; });
    open.forEach(function (d) { nodes[d].children = null; });
    var seq = Promise.resolve();
    open.sort(function (a, b) { return a.length - b.length; }).forEach(function (d) { seq = seq.then(function () { if (nodes[d]) return load(d).catch(function () { /* gone */ }); }); });
    return seq.then(renderTree);
  }
  function reloadAll() { objCache = {}; reloadOpen().then(function () { renderActive(); loadHistory(); }); }
  function pwDialog(dn) {
    var p1 = el('input'); p1.type = 'password'; p1.autocomplete = 'new-password'; p1.minLength = 8; p1.required = true;
    var mc = el('input'); mc.type = 'checkbox';
    var gen = el('button', 'btn sm tonal', t('Generate')); gen.type = 'button';
    var show = el('output', 'cred pw'); show.style.fontSize = '1.2rem';
    gen.addEventListener('click', function () { var a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789#+!'; var r = new Uint32Array(14); crypto.getRandomValues(r); p1.value = Array.prototype.map.call(r, function (x) { return a[x % a.length]; }).join(''); show.textContent = p1.value; });
    var body = el('div', 'stack');
    body.appendChild(el('p', 'muted mono small', dn));
    body.appendChild(field(t('New password'), p1)); body.appendChild(gen); body.appendChild(show);
    var lab = el('label', 'check'); lab.appendChild(mc); lab.appendChild(doc.createTextNode(' ' + t('User must change the password at next sign-in'))); body.appendChild(lab);
    body.appendChild(el('p', 'hint', t('A password reset cannot be undone: the old password is never stored.')));
    ask(t('Reset password'), body, t('Reset password')).then(function (ok) {
      if (!ok) return;
      if (p1.value.length < 8) { toast(t('The new password must be at least 8 characters.'), 'error'); return; }
      C.postForm('/directory/user/password', { dn: dn, password: p1.value, mustChange: mc.checked ? 'on' : '' }).then(function (j) { toast(j.message || t('Password reset.'), 'success'); loadHistory(); }, fail);
    });
  }
  function userAction(dn, action) {
    return post('/api/dir/user', { dn: dn, action: action }).then(function (j) { C.toastUndo(j.message + ' ' + rdnName(dn), j.undoId, reloadAll); delete objCache[dn]; if (activeDn() === dn) renderActive(); loadHistory(); }, fail);
  }

  // ---------------------------------------------------------- tabs
  function saveTabs() { storeSet('td.studio.tabs', { tabs: tabs.map(function (x) { return { id: x.id, kind: x.kind, dn: x.dn, title: x.title, list: x.list }; }), active: activeTab }); }
  function openTab(tb, replacePreview) {
    var ex = tabs.filter(function (x) { return x.id === tb.id; })[0];
    if (!ex) {
      var prev = replacePreview ? tabs.filter(function (x) { return x.preview; })[0] : null;
      tb.preview = !!replacePreview;
      if (prev) tabs[tabs.indexOf(prev)] = tb; else tabs.push(tb);
    } else if (!replacePreview) ex.preview = false;
    activeTab = tb.id; saveTabs(); renderTabs(); renderActive();
    if (phone.matches) setPane('editor');
  }
  function closeTab(id) {
    var i = tabs.findIndex(function (x) { return x.id === id; }); if (i < 0) return;
    tabs.splice(i, 1);
    if (activeTab === id) activeTab = tabs.length ? tabs[Math.max(0, i - 1)].id : null;
    saveTabs(); renderTabs(); renderActive();
  }
  function renderTabs() {
    var bar = $('[data-st-tabs]'); bar.textContent = '';
    tabs.forEach(function (tb, i) {
      var b = el('div', 'st-tab' + (tb.kind === 'obj' ? ' mono' : '')); b.setAttribute('role', 'tab'); b.tabIndex = tb.id === activeTab ? 0 : -1;
      b.setAttribute('aria-selected', tb.id === activeTab ? 'true' : 'false');
      var lbl = el('span', null, tb.title); if (tb.preview) lbl.style.fontStyle = 'italic'; b.appendChild(lbl);
      var x = el('button', 'x', '×'); x.type = 'button'; x.setAttribute('aria-label', t('Close tab') + ': ' + tb.title); x.tabIndex = -1;
      x.addEventListener('click', function (e) { e.stopPropagation(); closeTab(tb.id); });
      b.appendChild(x);
      b.addEventListener('click', function () { activeTab = tb.id; saveTabs(); renderTabs(); renderActive(); });
      b.addEventListener('dblclick', function () { tb.preview = false; renderTabs(); });
      b.addEventListener('auxclick', function (e) { if (e.button === 1) closeTab(tb.id); });
      b.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          var j = i + (e.key === 'ArrowRight' ? 1 : -1); if (j < 0 || j >= tabs.length) return;
          if (e.altKey) { var m = tabs.splice(i, 1)[0]; tabs.splice(j, 0, m); } else activeTab = tabs[j].id;
          saveTabs(); renderTabs(); renderActive(); var nb = $$('[data-st-tabs] .st-tab')[j]; if (nb) nb.focus();
        } else if (e.key === 'Delete') closeTab(tb.id);
        else if (e.key === 'Enter') { activeTab = tb.id; renderActive(); }
      });
      b.draggable = true;
      b.addEventListener('dragstart', function (e) { b.classList.add('dragging'); e.dataTransfer.setData('text/x-td-stab', String(i)); });
      b.addEventListener('dragend', function () { b.classList.remove('dragging'); });
      b.addEventListener('dragover', function (e) { if (Array.prototype.indexOf.call(e.dataTransfer.types, 'text/x-td-stab') >= 0) e.preventDefault(); });
      b.addEventListener('drop', function (e) { var from = parseInt(e.dataTransfer.getData('text/x-td-stab'), 10); if (isNaN(from)) return; e.preventDefault(); var m = tabs.splice(from, 1)[0]; tabs.splice(i, 0, m); saveTabs(); renderTabs(); });
      bar.appendChild(b);
    });
  }
  function activeDn() { var tb = tabs.filter(function (x) { return x.id === activeTab; })[0]; return tb && tb.kind === 'obj' ? tb.dn : null; }
  function renderActive() {
    var ed = $('[data-st-editor]'); var map = $('.st-map', host);
    var tb = tabs.filter(function (x) { return x.id === activeTab; })[0];
    if (map && (!tb || tb.kind !== 'map')) { map.remove(); ed.hidden = false; }
    if (!tb) { ed.textContent = ''; welcome(ed); renderInspector(); renderTree(); return; }
    if (tb.kind === 'map') { ed.hidden = true; renderMap(); renderInspector(); return; }
    ed.hidden = false;
    ed.style.animation = 'none'; void ed.offsetWidth; ed.style.animation = '';
    if (tb.kind === 'obj') renderObject(ed, tb);
    else if (tb.kind === 'query') renderQuery(ed, tb);
    else if (tb.kind === 'bulk') renderBulk(ed, tb);
    renderTree();
  }
  function welcome(ed) {
    ed.appendChild(el('h2', null, t('Directory studio')));
    ed.appendChild(el('p', 'muted', t('Pick an object in the explorer to open it in a tab. Drag objects onto a container to move them, right-click for actions, and use the Query builder for LDAP searches.')));
    var row = el('div', 'chip-row');
    [['map', t('Map')], ['query', t('Query builder')]].forEach(function (x) { var b = el('button', 'c-chip', x[1]); b.type = 'button'; b.addEventListener('click', function () { openView(x[0]); }); row.appendChild(b); });
    ed.appendChild(row);
    var keys = el('dl', 'kv small'); keys.style.marginTop = '12px';
    [['Enter', t('Open the selected object')], ['Ctrl / Shift + click', t('Select several objects')], ['Shift+F10', t('Actions for the selection')], ['Alt + Left / Right', t('Reorder tabs')], ['Ctrl+K', t('Find any object')]].forEach(function (k) { keys.appendChild(el('dt', 'mono', k[0])); keys.appendChild(el('dd', null, k[1])); });
    ed.appendChild(keys);
  }
  function openView(kind) {
    if (kind === 'map') openTab({ id: 'map', kind: 'map', title: t('Map') });
    else if (kind === 'query') openTab({ id: 'query', kind: 'query', title: t('Query builder') });
  }
  $$('[data-open-tab]').forEach(function (b) { b.addEventListener('click', function () { openView(b.getAttribute('data-open-tab')); }); });

  // ---------------------------------------------------------- object editor
  function openObject(dn, sub, preview, forceNew) {
    var title = nodes[dn] ? nodes[dn].name : rdnName(dn);
    openTab({ id: 'obj:' + dn, kind: 'obj', dn: dn, title: title, sub: sub || null }, preview && !forceNew);
    if (sub) { var tb = tabs.filter(function (x) { return x.id === 'obj:' + dn; })[0]; if (tb) { tb.sub = sub; renderActive(); } }
  }
  function getObj(dn, force) {
    if (!force && objCache[dn]) return Promise.resolve(objCache[dn]);
    return api('/api/dir/object?dn=' + encodeURIComponent(dn)).then(function (o) { objCache[dn] = o; return o; });
  }
  function classesOf(o) { return (o.objectClass || []).map(function (c) { return String(c).toLowerCase(); }); }
  function a1(o, k) { var v = (o.attributes || {})[k]; return Array.isArray(v) ? v[0] : v; }
  function uacOf(o) { return parseInt(a1(o, 'userAccountControl') || '0', 10) || 0; }
  function renderObject(ed, tb) {
    ed.textContent = ''; ed.appendChild(el('div', 'skeleton', '')).style.height = '56px';
    getObj(tb.dn).then(function (o) { if (activeTab !== tb.id) return; drawObject(ed, tb, o); renderInspector(); }, function (e) {
      ed.textContent = ''; ed.appendChild(el('h2', null, tb.title)); var p = el('p', 'alert error', e.message); p.setAttribute('role', 'alert'); ed.appendChild(p);
    });
  }
  function drawObject(ed, tb, o) {
    ed.textContent = '';
    var cl = classesOf(o), isUser = cl.indexOf('user') >= 0 && cl.indexOf('computer') < 0, isComp = cl.indexOf('computer') >= 0, isGroup = cl.indexOf('group') >= 0;
    var name = a1(o, 'displayName') || a1(o, 'name') || tb.title, uac = uacOf(o);
    var head = el('div', 'st-ohead');
    head.appendChild(el('span', 'st-av', String(name).slice(0, 1).toUpperCase()));
    var hd = el('div'); hd.style.cssText = 'flex:1;min-width:0';
    hd.appendChild(el('div', 'nm', name));
    var subt = [a1(o, 'sAMAccountName') || rdnName(o.dn), (o.objectClass || [])[(o.objectClass || []).length - 1]];
    if (isUser || isComp) subt.push(uac & 2 ? t('disabled') : t('enabled'));
    hd.appendChild(el('div', 'sub', subt.filter(Boolean).join(' · ')));
    head.appendChild(hd);
    var exp = o.decoded && o.decoded.accountExpires && o.decoded.accountExpires.decoded;
    if (exp) { var x = new Date(exp); head.appendChild(el('span', 'pill-tag' + (x < new Date() ? '' : ' ok'), (x < new Date() ? t('Expired') : t('Expires')) + ' ' + x.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))); }
    ed.appendChild(head);
    var subs = ['General'];
    if (isUser || isComp) subs.push('Account');
    if (isUser || isComp || isGroup) subs.push('Member of');
    if (isGroup) subs.push('Members');
    if (isUser) subs.push('Profile', 'Sign-in history');
    subs.push('Attributes', 'Security');
    if (!tb.sub || subs.indexOf(tb.sub) < 0) tb.sub = isUser ? 'Account' : 'General';
    var st = el('div', 'st-subtabs'); st.setAttribute('role', 'tablist'); st.setAttribute('aria-label', t('Object sections'));
    subs.forEach(function (s) {
      var b = el('button', null, t(s)); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', s === tb.sub ? 'true' : 'false'); b.tabIndex = s === tb.sub ? 0 : -1;
      b.addEventListener('click', function () { tb.sub = s; drawObject(ed, tb, o); });
      b.addEventListener('keydown', function (e) { var i = subs.indexOf(s); if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); tb.sub = subs[(i + (e.key === 'ArrowRight' ? 1 : -1) + subs.length) % subs.length]; drawObject(ed, tb, o); var nb = $('.st-subtabs [aria-selected="true"]', ed); if (nb) nb.focus(); } });
      st.appendChild(b);
    });
    ed.appendChild(st);
    var body = el('div', 'stack'); body.style.gap = '14px'; body.setAttribute('role', 'tabpanel'); ed.appendChild(body);
    ({ 'General': secGeneral, 'Account': secAccount, 'Member of': secMemberOf, 'Members': secMembers, 'Profile': secProfile, 'Sign-in history': secSignins, 'Attributes': secAttributes, 'Security': secSecurity }[tb.sub])(body, o, tb);
    var acts = el('div', 'st-actions');
    if (isUser) { acts.appendChild(btn(t('Reset password'), function () { pwDialog(o.dn); })); acts.appendChild(btn(uac & 2 ? t('Enable') : t('Disable'), function () { userAction(o.dn, uac & 2 ? 'enable' : 'disable'); })); }
    if (isComp) acts.appendChild(btn(uac & 2 ? t('Enable') : t('Disable'), function () { userAction(o.dn, uac & 2 ? 'enable' : 'disable'); }));
    if (!cl.some(function (c) { return c === 'domaindns' || c === 'domain'; })) acts.appendChild(btn(t('Move'), function () { moveDialog([o.dn]); }));
    var cls0 = cl.indexOf('organizationalunit') >= 0 || cl.indexOf('container') >= 0 || cl.indexOf('domaindns') >= 0;
    if (cls0) { acts.appendChild(btn(t('Bulk edit children'), function () { bulkFromContainer(o.dn); })); var a = el('a', 'st-btn', t('Create object here')); a.href = '/directory/create?parent=' + encodeURIComponent(o.dn); acts.appendChild(a); }
    var cl2 = el('a', 'st-btn', t('Classic view')); cl2.href = '/directory/object?dn=' + encodeURIComponent(o.dn); acts.appendChild(cl2);
    var del = el('a', 'st-btn coral', t('Delete')); del.href = '/directory/object?dn=' + encodeURIComponent(o.dn) + '#delete'; del.title = cfg.deleteNote || ''; acts.appendChild(del);
    ed.appendChild(acts);
  }
  function btn(label, fn, cls) { var b = el('button', 'st-btn' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function textField(o, attr, label, opts) {
    opts = opts || {};
    var w = el('label', 'st-f'); w.appendChild(el('span', null, label));
    var i = el(opts.multiline ? 'textarea' : 'input'); if (!opts.multiline) i.type = opts.type || 'text';
    i.value = a1(o, attr) || ''; i.setAttribute('data-attr', attr); i.setAttribute('data-orig', i.value);
    if (opts.mono) i.className = 'mono';
    if (opts.readonly) i.readOnly = true;
    i.addEventListener('focus', function () { inspectorAttr = attr; renderInspector(); });
    w.appendChild(i); return w;
  }
  function saveFields(container, o, extra) {
    var setv = {}, clear = [], ft = {};
    $$('[data-attr]', container).forEach(function (i) {
      if (i.readOnly) return;
      var a = i.getAttribute('data-attr'), v = i.value.trim(), orig = i.getAttribute('data-orig') || '';
      if (i.getAttribute('data-filetime')) { if (v !== orig) ft[a] = v ? new Date(v).toISOString() : ''; return; }
      if (v === orig) return;
      if (v) setv[a] = [v]; else clear.push(a);
    });
    Object.keys(extra || {}).forEach(function (k) { setv[k] = extra[k]; });
    Object.keys(ft).forEach(function (k) { if (!ft[k]) { delete ft[k]; setv[k] = ['0']; } });
    if (!Object.keys(setv).length && !clear.length && !Object.keys(ft).length) { toast(t('Nothing was changed.'), 'info'); return Promise.resolve(); }
    return post('/api/dir/patch', { dn: o.dn, set: setv, clear: clear, filetime: ft }).then(function (j) {
      C.toastUndo(j.message, j.undoId, function () { delete objCache[o.dn]; renderActive(); });
      delete objCache[o.dn]; renderActive(); loadHistory();
    }, fail);
  }
  function secGeneral(body, o) {
    var g = el('div', 'st-fields');
    var cl = classesOf(o);
    g.appendChild(textField(o, 'name', t('Name'), { readonly: true }));
    if (cl.indexOf('organizationalunit') < 0 && cl.indexOf('domaindns') < 0) g.appendChild(textField(o, 'displayName', t('Display name')));
    g.appendChild(textField(o, 'description', t('Description')));
    if (cl.indexOf('user') >= 0 || cl.indexOf('group') >= 0) g.appendChild(textField(o, 'mail', t('Email'), { type: 'email' }));
    if (cl.indexOf('computer') >= 0) { g.appendChild(textField(o, 'dNSHostName', t('DNS name'), { mono: true })); g.appendChild(textField(o, 'operatingSystem', t('Operating system'), { readonly: true })); }
    if (cl.indexOf('group') >= 0) g.appendChild(textField(o, 'groupType', t('Group type'), { readonly: true, mono: true }));
    if (cl.indexOf('organizationalunit') >= 0) g.appendChild(textField(o, 'gPLink', t('Linked policies'), { readonly: true, mono: true }));
    body.appendChild(g);
    var info = textField(o, 'info', t('Notes'), { multiline: true }); body.appendChild(info);
    var dl = el('dl', 'kv small');
    [['DN', o.dn], [t('Created'), dt(o, 'whenCreated')], [t('Modified'), dt(o, 'whenChanged')]].forEach(function (r) { dl.appendChild(el('dt', null, r[0])); var d = el('dd', 'mono small', r[1] || '-'); dl.appendChild(d); });
    body.appendChild(dl);
    body.appendChild(saveRow(body, o));
  }
  function dt(o, k) { var d = o.decoded && o.decoded[k] && o.decoded[k].decoded; return d ? new Date(d).toLocaleString() : (a1(o, k) || ''); }
  function saveRow(container, o, extraFn) { var r = el('div', 'cluster'); r.appendChild(btn(t('Save'), function () { saveFields(container, o, extraFn ? extraFn() : null); }, 'primary')); return r; }
  function localInput(iso) { if (!iso) return ''; var d = new Date(iso), p = function (n) { return String(n).padStart(2, '0'); }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
  function secAccount(body, o) {
    var g = el('div', 'st-fields');
    g.appendChild(textField(o, 'sAMAccountName', t('Sign-in name'), { mono: true }));
    if (classesOf(o).indexOf('computer') < 0) g.appendChild(textField(o, 'userPrincipalName', 'UPN', { mono: true }));
    var exp = o.decoded && o.decoded.accountExpires ? o.decoded.accountExpires.decoded : null;
    var w = el('label', 'st-f'); w.appendChild(el('span', null, t('Account expires')));
    var row = el('span', 'cluster'); row.style.flexWrap = 'nowrap';
    var di = el('input'); di.type = 'datetime-local'; di.value = localInput(exp); di.setAttribute('data-attr', 'accountExpires'); di.setAttribute('data-filetime', '1'); di.setAttribute('data-orig', di.value);
    di.addEventListener('focus', function () { inspectorAttr = 'accountExpires'; renderInspector(); });
    var plus = btn('+1 h', function () { var base = di.value ? new Date(di.value) : new Date(); if (base < new Date()) base = new Date(); di.value = localInput(new Date(base.getTime() + 3600000).toISOString()); });
    plus.style.minHeight = '42px';
    var never = btn(t('Never'), function () { di.value = ''; }); never.style.minHeight = '42px';
    row.appendChild(di); row.appendChild(plus); row.appendChild(never); w.appendChild(row); g.appendChild(w);
    body.appendChild(g);
    // userAccountControl as switches
    var uac = uacOf(o), sw = el('div', 'st-sw');
    var lockT = parseInt(a1(o, 'lockoutTime') || '0', 10) || 0;
    var flags = [[2, t('Account enabled'), t('Can sign in now'), true], [0x10000, t('Password never expires'), t('Guests keep one password')], [0x40, t('User cannot change password'), t('Set by TempDesk for guests')], [0x100000, t('Sensitive, cannot be delegated'), t('Protects privileged accounts')]];
    flags.forEach(function (f) {
      var lab = el('label', 'switch'); var s = el('span'); s.appendChild(doc.createTextNode(f[1])); s.appendChild(el('small', null, f[2])); lab.appendChild(s);
      var c = el('input'); c.type = 'checkbox'; c.setAttribute('role', 'switch'); c.checked = f[3] ? !(uac & f[0]) : !!(uac & f[0]); c.setAttribute('data-uac', String(f[0])); if (f[3]) c.setAttribute('data-invert', '1');
      c.addEventListener('focus', function () { inspectorAttr = 'userAccountControl'; renderInspector(); });
      lab.appendChild(c); sw.appendChild(lab);
    });
    var lk = el('label', 'switch'); var ls = el('span'); ls.appendChild(doc.createTextNode(t('Locked out'))); ls.appendChild(el('small', null, lockT ? t('Turn off to unlock') : t('No failed sign-ins'))); lk.appendChild(ls);
    var lc = el('input'); lc.type = 'checkbox'; lc.setAttribute('role', 'switch'); lc.checked = !!lockT; lc.disabled = !lockT; lc.addEventListener('change', function () { if (!lc.checked) userAction(o.dn, 'unlock'); }); lk.appendChild(lc); sw.appendChild(lk);
    body.appendChild(sw);
    if (o.decoded && o.decoded.logonHours && o.decoded.logonHours.kind === 'hours') body.appendChild(hoursEditor(o));
    else { var lh = el('div', 'st-f'); lh.appendChild(el('span', null, t('Logon hours'))); lh.appendChild(el('span', 'muted', t('Always allowed (no logonHours value set).'))); var setb = btn(t('Restrict hours'), function () { o.decoded.logonHours = { kind: 'hours', decoded: new Array(168).fill(true) }; lh.replaceWith(hoursEditor(o)); }); lh.appendChild(setb); body.appendChild(lh); }
    body.appendChild(saveRow(body, o, function () {
      var n = uac;
      $$('[data-uac]', body).forEach(function (c) { var b = parseInt(c.getAttribute('data-uac'), 10), on = c.getAttribute('data-invert') ? !c.checked : c.checked; n = on ? (n | b) : (n & ~b); });
      var extra = {};
      if (n !== uac) extra.userAccountControl = [String(n)];
      var hg = $('[data-hours]', body); if (hg && hg.getAttribute('data-dirty')) extra.logonHours = ['b64:' + hoursB64(hg)];
      return extra;
    }));
  }
  function hoursEditor(o) {
    var bits = o.decoded.logonHours.decoded.slice();
    var w = el('div', 'st-f'); w.appendChild(el('span', null, t('Logon hours (your local time, drag to paint)')));
    var scroll = el('div'); scroll.style.overflowX = 'auto';
    var g = el('div', 'hours'); g.setAttribute('data-hours', ''); g.setAttribute('role', 'grid'); g.setAttribute('aria-label', t('Logon hours'));
    var off = -new Date().getTimezoneOffset() / 60; // UTC bits -> local display
    var days = [t('Sun'), t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat')];
    g.appendChild(el('span'));
    for (var h = 0; h < 24; h++) g.appendChild(el('span', 'h', h % 3 === 0 ? String(h) : ''));
    var painting = null;
    for (var d = 0; d < 7; d++) {
      g.appendChild(el('span', 'd', days[d]));
      for (var hh = 0; hh < 24; hh++) {
        var idx = ((d * 24 + hh - off) % 168 + 168) % 168;
        var b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', bits[idx] ? 'true' : 'false'); b.setAttribute('data-i', String(idx));
        b.setAttribute('aria-label', days[d] + ' ' + hh + ':00'); b.tabIndex = d === 0 && hh === 0 ? 0 : -1;
        g.appendChild(b);
      }
    }
    function set(b, v) { b.setAttribute('aria-pressed', v ? 'true' : 'false'); g.setAttribute('data-dirty', '1'); }
    g.addEventListener('pointerdown', function (e) { var b = e.target.closest('button'); if (!b) return; e.preventDefault(); painting = b.getAttribute('aria-pressed') !== 'true'; set(b, painting); });
    g.addEventListener('pointerover', function (e) { if (painting === null) return; var b = e.target.closest('button'); if (b) set(b, painting); });
    doc.addEventListener('pointerup', function () { painting = null; });
    g.addEventListener('keydown', function (e) {
      var all = $$('button', g), i = all.indexOf(doc.activeElement); if (i < 0) return;
      var j = { ArrowRight: i + 1, ArrowLeft: i - 1, ArrowDown: i + 24, ArrowUp: i - 24 }[e.key];
      if (j != null) { e.preventDefault(); if (all[j]) { all[i].tabIndex = -1; all[j].tabIndex = 0; all[j].focus(); } }
      else if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(all[i], all[i].getAttribute('aria-pressed') !== 'true'); }
    });
    scroll.appendChild(g); w.appendChild(scroll);
    var row = el('div', 'chip-row');
    row.appendChild(btn(t('Allow all'), function () { $$('button', g).forEach(function (b) { set(b, true); }); }, 'sm'));
    row.appendChild(btn(t('Weekdays 8 to 20'), function () { $$('button', g).forEach(function (b, k) { var d = Math.floor(k / 24), h = k % 24; set(b, d >= 1 && d <= 5 && h >= 8 && h < 20); }); }, 'sm'));
    row.appendChild(btn(t('Deny all'), function () { $$('button', g).forEach(function (b) { set(b, false); }); }, 'sm'));
    w.appendChild(row);
    return w;
  }
  function hoursB64(g) {
    var bytes = new Uint8Array(21);
    $$('button', g).forEach(function (b) { if (b.getAttribute('aria-pressed') === 'true') { var i = parseInt(b.getAttribute('data-i'), 10); bytes[i >> 3] |= 1 << (i & 7); } });
    return btoa(String.fromCharCode.apply(null, bytes));
  }
  function dnList(body, list, emptyText, onRemove, onAdd, addLabel) {
    var wrap = el('div', 'stack tight');
    if (!list.length) wrap.appendChild(el('p', 'muted', emptyText));
    list.forEach(function (d) {
      var r = el('div', 'item-row');
      r.appendChild(iconFor(/^CN=.*Computers?/i.test(d) ? 'computer' : 'user'));
      var n = el('button', 'nm'); n.type = 'button'; n.style.cssText = 'background:none;border:0;color:var(--text);text-align:left;font:inherit;cursor:pointer';
      n.appendChild(el('span', null, rdnName(d))); n.appendChild(el('span', 'sub mono', d));
      n.addEventListener('click', function () { openObject(d); });
      r.appendChild(n);
      if (onRemove) r.appendChild(btn(t('Remove'), function () { onRemove(d); }, 'sm coral'));
      wrap.appendChild(r);
    });
    body.appendChild(wrap);
    if (onAdd) {
      var row = el('div', 'cluster'); var inp = el('input'); inp.type = 'text'; inp.placeholder = t('Name or distinguished name'); inp.setAttribute('aria-label', addLabel); inp.style.flex = '1 1 240px'; inp.className = 'mono';
      row.appendChild(inp); row.appendChild(btn(addLabel, function () { var v = inp.value.trim(); if (!v) return; resolveDn(v).then(onAdd, fail); }, 'primary'));
      body.appendChild(row);
    }
  }
  function resolveDn(v) {
    if (/^(CN|OU|DC)=/i.test(v)) return Promise.resolve(v);
    return post('/api/console/resolve', { name: v }).then(function (r) { if (!r.matches || !r.matches.length) throw new Error(t('No account named {name} was found.', { name: v })); return r.matches[0].dn; });
  }
  function arr(o, k) { var v = (o.attributes || {})[k]; return Array.isArray(v) ? v : v ? [v] : []; }
  function members(group, add, remove, o) {
    return post('/api/dir/members', { groupDn: group, add: add, remove: remove }).then(function (j) { C.toastUndo(j.message, j.undoId, reloadAll); objCache = {}; renderActive(); loadHistory(); }, fail);
  }
  function secMemberOf(body, o) {
    body.appendChild(el('p', 'hint', t('Groups this object belongs to. Adding or removing changes the group.')));
    dnList(body, arr(o, 'memberOf'), t('Not a member of any group (apart from the primary group).'), function (g) { members(g, [], [o.dn]); }, function (g) { members(g, [o.dn], []); }, t('Add to group'));
  }
  function secMembers(body, o) {
    dnList(body, arr(o, 'member'), t('This group has no members.'), function (m) { members(o.dn, [], [m]); }, function (m) { members(o.dn, [m], []); }, t('Add member'));
  }
  function secProfile(body, o) {
    var g = el('div', 'st-fields');
    [['givenName', t('First name')], ['sn', t('Last name')], ['title', t('Job title')], ['department', t('Department')], ['company', t('Company')], ['telephoneNumber', t('Phone')], ['profilePath', t('Profile path'), 1], ['scriptPath', t('Logon script'), 1], ['homeDirectory', t('Home folder'), 1], ['homeDrive', t('Home drive')]]
      .forEach(function (f) { g.appendChild(textField(o, f[0], f[1], { mono: !!f[2] })); });
    body.appendChild(g); body.appendChild(saveRow(body, o));
  }
  function secSignins(body, o) {
    var dl = el('dl', 'kv');
    [['lastLogon', t('Last sign-in on this domain controller')], ['lastLogonTimestamp', t('Last sign-in (replicated)')], ['pwdLastSet', t('Password last set')], ['badPasswordTime', t('Last wrong password')], ['lockoutTime', t('Locked out at')]].forEach(function (r) {
      dl.appendChild(el('dt', null, r[1])); var d = o.decoded && o.decoded[r[0]]; dl.appendChild(el('dd', null, d && d.decoded ? new Date(d.decoded).toLocaleString() : t('Never')));
    });
    [['logonCount', t('Sign-in count')], ['badPwdCount', t('Wrong passwords since the last good one')]].forEach(function (r) { dl.appendChild(el('dt', null, r[1])); dl.appendChild(el('dd', null, a1(o, r[0]) || '0')); });
    body.appendChild(dl);
    var more = el('div', 'stack tight'); body.appendChild(more);
    if (caps.indexOf('cmdlets') < 0) { more.appendChild(el('p', 'muted', t('Per-PC sign-in history needs the cmdlet runner, which this backend does not provide. The values above come from the directory.'))); return; }
    more.appendChild(el('p', 'subtle', t('Asking the domain controller (Get-ADUser)...')));
    api('/api/dir/signins?dn=' + encodeURIComponent(o.dn)).then(function (r) {
      more.textContent = '';
      if (!r.available || !r.data) { more.appendChild(el('p', 'muted', (r.errors && r.errors.length) ? r.errors.join(' ') : t('The domain controller returned no extra sign-in data for this account.'))); return; }
      var d2 = el('dl', 'kv small'); Object.keys(r.data).slice(0, 20).forEach(function (k) { d2.appendChild(el('dt', 'mono', k)); d2.appendChild(el('dd', null, String(r.data[k]))); }); more.appendChild(d2);
    }, function (e) { more.textContent = ''; more.appendChild(el('p', 'muted', e.message)); });
  }
  function secSecurity(body, o) {
    var sd = (o.attributes || {}).nTSecurityDescriptor;
    if (sd) { body.appendChild(el('p', 'muted', t('The raw security descriptor is shown below. Editing permissions is not available through the agent API yet.'))); body.appendChild(el('div', 'st-raw', String(first(sd)).slice(0, 2000))); }
    else body.appendChild(el('p', 'muted', t('The agent API does not return permissions (ACLs) for directory objects, so they cannot be shown or edited here. Use Active Directory Users and Computers, or the cmdlet runner, for delegation.')));
    var a = el('a', 'st-btn', t('Open the cmdlet runner')); a.href = '/cmdlets'; body.appendChild(a);
  }
  // Attributes: every attribute, schema aware
  function secAttributes(body, o, tb) {
    var top = el('div', 'cluster');
    var f = el('input'); f.type = 'search'; f.placeholder = t('Filter {count} attributes', { count: Object.keys(o.attributes || {}).length }); f.setAttribute('aria-label', t('Filter attributes')); f.style.cssText = 'flex:1 1 220px;min-height:42px;height:42px';
    top.appendChild(f);
    var addSel = el('select'); addSel.setAttribute('aria-label', t('Add an attribute')); addSel.style.cssText = 'width:auto;min-height:42px;height:42px';
    addSel.appendChild(new Option(t('Add an attribute'), ''));
    (o.schemaAllowed || []).filter(function (a) { return !(a in (o.attributes || {})); }).forEach(function (a) { addSel.appendChild(new Option(a, a)); });
    top.appendChild(addSel); body.appendChild(top);
    var wrap = el('div'); wrap.style.overflowX = 'auto';
    var tbl = el('table', 'attr-tbl'); var tbody = el('tbody'); tbl.appendChild(tbody); wrap.appendChild(tbl); body.appendChild(wrap);
    var names = Object.keys(o.attributes || {}).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; });
    function draw() {
      tbody.textContent = ''; var q = f.value.trim().toLowerCase();
      names.forEach(function (n) {
        if (q && n.toLowerCase().indexOf(q) < 0 && JSON.stringify(o.attributes[n]).toLowerCase().indexOf(q) < 0) return;
        var tr = el('tr'); if (inspectorAttr === n) tr.className = 'sel';
        tr.appendChild(el('td', 'an', n));
        var td = el('td', 'av'); td.appendChild(attrView(o, n)); tr.appendChild(td);
        var ec = el('td'); ec.style.width = '1%'; var eb = btn(t('Edit'), function () { editAttr(o, n, td); }, 'sm'); eb.setAttribute('aria-label', t('Edit') + ' ' + n); ec.appendChild(eb); tr.appendChild(ec);
        tr.addEventListener('click', function (e) { if (e.target.closest('button, input, select, textarea')) return; inspectorAttr = n; renderInspector(); $$('tr', tbody).forEach(function (x) { x.classList.remove('sel'); }); tr.classList.add('sel'); });
        tbody.appendChild(tr);
      });
    }
    f.addEventListener('input', draw);
    addSel.addEventListener('change', function () { var a = addSel.value; if (!a) return; names.push(a); o.attributes[a] = []; draw(); var rows = $$('tr', tbody); rows.forEach(function (r) { if (r.firstChild.textContent === a) editAttr(o, a, r.children[1]); }); });
    draw();
  }
  function attrView(o, n) {
    var d = (o.decoded || {})[n] || { kind: 'text', values: (o.attributes || {})[n] || [] };
    var vals = Array.isArray(d.values) ? d.values : [d.values];
    if (d.kind === 'filetime' || d.kind === 'generalized') return el('span', null, d.decoded ? new Date(d.decoded).toLocaleString() : t('Never') + ' (' + (vals[0] || '0') + ')');
    if (d.kind === 'uac') { var on = (d.decoded || []).filter(function (f) { return f.on; }).map(function (f) { return t(f.label); }); return el('span', null, (vals[0] || '') + ': ' + (on.join(', ') || '-')); }
    if (d.kind === 'sid' || d.kind === 'guid') return el('span', 'mono', d.decoded);
    if (d.kind === 'hours') { var c = d.decoded.filter(Boolean).length; return el('span', null, t('{count} of 168 hours allowed', { count: c })); }
    if (d.kind === 'binary') return el('span', 'mono subtle', d.decoded);
    if (vals.length > 1 || d.kind === 'multi') { var w = el('span', 'vchips'); vals.slice(0, 30).forEach(function (v) { w.appendChild(el('span', 'vchip', String(v))); }); if (vals.length > 30) w.appendChild(el('span', 'subtle', '+' + (vals.length - 30))); return w; }
    return el('span', null, vals.length ? String(vals[0]) : '');
  }
  function editAttr(o, n, td) {
    inspectorAttr = n; renderInspector();
    var d = (o.decoded || {})[n] || { kind: 'text', values: (o.attributes || {})[n] || [] };
    var vals = (o.attributes || {})[n] || []; if (!Array.isArray(vals)) vals = [vals];
    td.textContent = '';
    var box = el('div', 'stack tight');
    var getter;
    if (d.kind === 'filetime') {
      var di = el('input'); di.type = 'datetime-local'; di.value = localInput(d.decoded); box.appendChild(di);
      getter = function () { return { filetime: { [n]: di.value ? new Date(di.value).toISOString() : '' } }; };
    } else if (d.kind === 'uac') {
      var u = parseInt(vals[0] || '0', 10) || 0, g = el('div', 'uac');
      (o.uacFlags || []).forEach(function (f) { var l = el('label', 'check small'); var c = el('input'); c.type = 'checkbox'; c.checked = !!(u & f.bit); c.value = String(f.bit); l.appendChild(c); l.appendChild(doc.createTextNode(' ' + t(f.label) + ' (' + f.id + ')')); g.appendChild(l); });
      box.appendChild(g);
      getter = function () { var x = u; $$('input', g).forEach(function (c) { var b = parseInt(c.value, 10); x = c.checked ? (x | b) : (x & ~b); }); return { set: { [n]: [String(x)] } }; };
    } else if (d.kind === 'hours') {
      var hw = hoursEditor(o); box.appendChild(hw);
      getter = function () { return { set: { [n]: ['b64:' + hoursB64($('[data-hours]', hw))] } }; };
    } else if (d.kind === 'sid' || d.kind === 'guid' || d.kind === 'binary' || n === 'objectClass' || n === 'distinguishedName' || n === 'memberOf') {
      box.appendChild(el('p', 'muted small', t('This attribute is read only here.'))); box.appendChild(attrView(o, n));
      getter = null;
    } else if (vals.length > 1 || d.kind === 'multi') {
      var chips = el('div', 'vchips'), cur = vals.slice();
      var redraw = function () { chips.textContent = ''; cur.forEach(function (v, i) { var c = el('span', 'vchip', String(v)); var x = el('button', null, '×'); x.type = 'button'; x.setAttribute('aria-label', t('Remove') + ' ' + v); x.addEventListener('click', function () { cur.splice(i, 1); redraw(); }); c.appendChild(x); chips.appendChild(c); }); };
      redraw(); box.appendChild(chips);
      var add = el('input'); add.type = 'text'; add.placeholder = t('Add a value and press Enter'); add.setAttribute('aria-label', t('Add a value'));
      add.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (add.value.trim()) { cur.push(add.value.trim()); add.value = ''; redraw(); } } });
      box.appendChild(add);
      getter = function () { if (add.value.trim()) cur.push(add.value.trim()); return cur.length ? { set: { [n]: cur } } : { clear: [n] }; };
    } else {
      var ti = el(String(vals[0] || '').length > 60 ? 'textarea' : 'input'); if (ti.tagName === 'INPUT') ti.type = 'text'; ti.value = vals[0] || ''; ti.setAttribute('aria-label', n); box.appendChild(ti);
      getter = function () { var v = ti.value; return v ? { set: { [n]: [v] } } : { clear: [n] }; };
    }
    var row = el('div', 'cluster');
    if (getter) row.appendChild(btn(t('Save'), function () { var b = getter(); b.dn = o.dn; post('/api/dir/patch', b).then(function (j) { C.toastUndo(j.message + ' ' + n, j.undoId, function () { delete objCache[o.dn]; renderActive(); }); delete objCache[o.dn]; renderActive(); loadHistory(); }, fail); }, 'primary sm'));
    row.appendChild(btn(t('Cancel'), function () { td.textContent = ''; td.appendChild(attrView(o, n)); }, 'sm'));
    box.appendChild(row); td.appendChild(box);
    var fi = box.querySelector('input, textarea, button'); if (fi) fi.focus();
  }

  // ---------------------------------------------------------- inspector
  function renderInspector() {
    var ins = $('[data-st-inspector]'); ins.textContent = '';
    var dn = activeDn() || selected[0];
    ins.appendChild(el('div', 'st-k', t('Inspector')));
    if (!dn) { ins.appendChild(el('p', 'muted small', t('Select an object to see its details, the selected attribute and the Group Policy that applies to it.'))); return; }
    var o = objCache[dn];
    ins.appendChild(el('div', null, nodes[dn] ? nodes[dn].name : rdnName(dn))).style.fontWeight = '700';
    ins.appendChild(el('div', 'st-raw', dn));
    if (!o) { getObj(dn).then(function () { if ((activeDn() || selected[0]) === dn) renderInspector(); }, function () { /* shown in editor */ }); return; }
    if (inspectorAttr && (o.decoded || {})[inspectorAttr] || inspectorAttr) {
      var d = (o.decoded || {})[inspectorAttr] || { values: [], help: '' };
      ins.appendChild(el('div', 'st-k', t('Attribute'))).style.marginTop = '8px';
      ins.appendChild(el('div', 'mono', inspectorAttr)).style.fontWeight = '700';
      if (d.help) ins.appendChild(el('div', 'small muted', t(d.help)));
      var raw = el('div', 'st-raw'); raw.textContent = (d.values || []).join('\n') || t('(not set)');
      if (d.decoded != null && d.kind !== 'uac' && d.kind !== 'hours') raw.textContent += '\n= ' + (d.kind === 'filetime' || d.kind === 'generalized' ? new Date(d.decoded).toISOString().replace('.000', '') : d.decoded);
      if (d.kind === 'uac') raw.textContent += '\n= ' + d.decoded.filter(function (f) { return f.on; }).map(function (f) { return f.id; }).join(' | ');
      if (d.kind === 'hours') raw.textContent += '\n= ' + t('{count} of 168 hours allowed', { count: d.decoded.filter(Boolean).length });
      ins.appendChild(raw);
    }
    ins.appendChild(el('div', 'st-k', t('Effective policy'))).style.marginTop = '8px';
    if (caps.indexOf('gpo') < 0) ins.appendChild(el('p', 'muted small', t('Group Policy is not available on this backend.')));
    else if (!(o.policies || []).length) ins.appendChild(el('p', 'muted small', t('No Group Policy objects are linked above this object.')));
    (o.policies || []).forEach(function (p) {
      var a = el('a', 'st-eff'); a.href = '/gpo/' + encodeURIComponent(p.id) + '/edit'; a.style.textDecoration = 'none'; a.style.color = 'var(--text)';
      a.appendChild(doc.createTextNode(p.name + ' ')); a.appendChild(el('span', null, t('via {where}', { where: rdnName(p.via) }) + (p.enforced ? ' (' + t('enforced') + ')' : '')));
      ins.appendChild(a);
    });
    var cl = classesOf(o);
    if (cl.indexOf('user') >= 0) { var row = el('div', 'chip-row'); row.style.marginTop = '8px'; row.appendChild(btn(t('Reset password'), function () { pwDialog(dn); }, 'sm')); row.appendChild(btn(t('Unlock'), function () { userAction(dn, 'unlock'); }, 'sm')); ins.appendChild(row); }
  }

  // ---------------------------------------------------------- map
  var view = { x: 0, y: 0, k: 1 };
  function renderMapIfOpen() { if (tabs.some(function (x) { return x.id === activeTab && x.kind === 'map'; })) renderMap(); }
  function layout() {
    // Tidy tree: leaves get consecutive x slots, parents centre over children.
    var pos = {}, slot = 0, depthY = 120, colW = 190;
    function walk(dn, depth) {
      var n = nodes[dn]; var kids = n.open && n.children ? n.children.filter(function (c) { return nodes[c]; }) : [];
      var shown = kids.slice(0, 12);
      if (!shown.length) { pos[dn] = { x: slot++ * colW, y: depth * depthY, extra: 0 }; return pos[dn]; }
      var xs = shown.map(function (c) { return walk(c, depth + 1).x; });
      pos[dn] = { x: (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2, y: depth * depthY, extra: kids.length - shown.length };
      return pos[dn];
    }
    (cfg.root || []).forEach(function (r) { walk(r.dn, 0); });
    return pos;
  }
  function renderMap() {
    var center = $('.st-center', host), m = $('.st-map', host);
    if (!m) {
      m = el('section', 'st-map'); m.setAttribute('aria-label', t('Directory map')); m.tabIndex = 0;
      center.insertBefore(m, $('[data-st-inspector]'));
      var ctl = el('div', 'ctl');
      ctl.appendChild(mbtn('−', t('Zoom out'), function () { zoom(1 / 1.2); }));
      ctl.appendChild(mbtn('+', t('Zoom in'), function () { zoom(1.2); }));
      ctl.appendChild(mbtn(t('Fit'), t('Fit'), fit));
      ctl.appendChild(mbtn(t('Expand all'), t('Expand all'), expandVisible));
      m.appendChild(ctl);
      bindPan(m);
    }
    var old = $('svg', m); if (old) old.remove();
    var pos = layout(), s = C.svg('svg', { role: 'tree', 'aria-label': t('Directory map') });
    var g = C.svg('g', { transform: 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')' });
    var sel = activeDn() || selected[0] || '';
    Object.keys(pos).forEach(function (dn) {
      var n = nodes[dn], p = pos[dn];
      if (n.parent && pos[n.parent]) { var q = pos[n.parent]; var hot = sel && (sel === dn || sel.toLowerCase().endsWith(',' + dn.toLowerCase())); g.appendChild(C.svg('path', { class: 'edge' + (hot ? ' hot' : ''), d: 'M' + q.x + ' ' + (q.y + 20) + ' C' + q.x + ' ' + (q.y + 70) + ' ' + p.x + ' ' + (p.y - 50) + ' ' + p.x + ' ' + (p.y - 20) })); }
    });
    Object.keys(pos).forEach(function (dn, i) {
      var n = nodes[dn], p = pos[dn], w = Math.min(176, 40 + String(n.name).length * 8);
      var ng = C.svg('g', { class: 'mnode' + (n.parent ? '' : ' root') + (dn === sel ? ' sel' : ''), transform: 'translate(' + (p.x - w / 2) + ' ' + (p.y - 20) + ')', tabindex: '0', role: 'treeitem', 'aria-label': n.name + (n.hasChildren ? (n.open ? ', ' + t('expanded') : ', ' + t('collapsed')) : '') });
      ng.style.animationDelay = Math.min(i * 20, 300) + 'ms';
      ng.appendChild(C.svg('rect', { width: w, height: 40, rx: 14 }));
      var tx = C.svg('text', { x: 14, y: 25 }); tx.textContent = String(n.name).length > 18 ? String(n.name).slice(0, 17) + '…' : n.name; ng.appendChild(tx);
      var badge = n.children ? String(n.children.length) : n.hasChildren ? '+' : '';
      if (p.extra) badge = '+' + p.extra;
      if (badge) { var b = C.svg('text', { x: w - 10, y: 25, 'text-anchor': 'end', class: 's' }); b.textContent = badge; ng.appendChild(b); }
      ng.addEventListener('click', function (e) { e.stopPropagation(); selected = [dn]; updateStatus(); if (n.hasChildren && isContainer(n.objectClass)) toggle(dn); else renderMap(); renderInspector(); if (phone.matches) setPane('inspector'); });
      ng.addEventListener('dblclick', function (e) { e.stopPropagation(); openObject(dn); });
      ng.addEventListener('keydown', function (e) { if (e.key === 'Enter') { openObject(dn); } else if (e.key === ' ') { e.preventDefault(); toggle(dn); } });
      g.appendChild(ng);
    });
    s.appendChild(g); m.insertBefore(s, m.firstChild);
    if (!m.dataset.fitted) { m.dataset.fitted = '1'; requestAnimationFrame(fit); }
  }
  function mbtn(label, aria, fn) { var b = el('button', null, label); b.type = 'button'; b.setAttribute('aria-label', aria); b.addEventListener('click', function (e) { e.stopPropagation(); fn(); }); return b; }
  function apply() { var g = $('.st-map svg > g', host); if (g) g.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')'); }
  function zoom(f, cx, cy) {
    var m = $('.st-map', host); if (!m) return; var r = m.getBoundingClientRect();
    cx = cx == null ? r.width / 2 : cx; cy = cy == null ? r.height / 2 : cy;
    var k2 = Math.max(0.25, Math.min(2.5, view.k * f)); view.x = cx - (cx - view.x) * (k2 / view.k); view.y = cy - (cy - view.y) * (k2 / view.k); view.k = k2; apply();
  }
  function fit() {
    var m = $('.st-map', host), g = $('.st-map svg > g', host); if (!m || !g) return;
    var bb; try { view = { x: 0, y: 0, k: 1 }; apply(); bb = g.getBBox(); } catch (e) { return; }
    var r = m.getBoundingClientRect(); if (!bb.width) return;
    var k = Math.min(1.4, Math.max(0.25, Math.min((r.width - 60) / bb.width, (r.height - 110) / bb.height)));
    view.k = k; view.x = (r.width - bb.width * k) / 2 - bb.x * k; view.y = 30 - bb.y * k; apply();
  }
  function expandVisible() {
    var list = Object.keys(nodes).filter(function (d) { return nodes[d].hasChildren && isContainer(nodes[d].objectClass) && !nodes[d].open; }).slice(0, 12);
    Promise.all(list.map(function (d) { return load(d).then(function () { nodes[d].open = true; }); })).then(function () { renderTree(); var m = $('.st-map', host); if (m) delete m.dataset.fitted; renderMap(); }, fail);
  }
  function bindPan(m) {
    var drag = null, pts = {};
    m.addEventListener('pointerdown', function (e) { if (e.target.closest('.mnode, button')) return; m.setPointerCapture(e.pointerId); pts[e.pointerId] = [e.clientX, e.clientY]; drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; m.style.cursor = 'grabbing'; });
    m.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var ids = Object.keys(pts);
      if (ids.length === 2 && pts[e.pointerId]) { var o = pts[ids[0]], p = pts[ids[1]], d0 = Math.hypot(o[0] - p[0], o[1] - p[1]); pts[e.pointerId] = [e.clientX, e.clientY]; o = pts[ids[0]]; p = pts[ids[1]]; var d1 = Math.hypot(o[0] - p[0], o[1] - p[1]); if (d0) zoom(d1 / d0); return; }
      view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y; apply();
    });
    function up(e) { delete pts[e.pointerId]; if (!Object.keys(pts).length) { drag = null; m.style.cursor = ''; } }
    m.addEventListener('pointerup', up); m.addEventListener('pointercancel', up);
    m.addEventListener('wheel', function (e) { e.preventDefault(); var r = m.getBoundingClientRect(); zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    m.addEventListener('keydown', function (e) { if (e.target !== m) return; var s = 40; if (e.key === '+' || e.key === '=') zoom(1.2); else if (e.key === '-') zoom(1 / 1.2); else if (e.key === '0') fit(); else if (e.key === 'ArrowLeft') { view.x += s; apply(); } else if (e.key === 'ArrowRight') { view.x -= s; apply(); } else if (e.key === 'ArrowUp') { view.y += s; apply(); } else if (e.key === 'ArrowDown') { view.y -= s; apply(); } else return; e.preventDefault(); });
  }

  // ---------------------------------------------------------- query builder
  var ATTRS = ['objectClass', 'name', 'sAMAccountName', 'displayName', 'description', 'mail', 'userPrincipalName', 'memberOf', 'userAccountControl', 'lastLogonTimestamp', 'whenCreated', 'operatingSystem'];
  var OPS = [['eq', '='], ['contains', t('contains')], ['starts', t('starts with')], ['present', t('is set')], ['absent', t('is not set')], ['ge', '>='], ['le', '<='], ['bit', t('has bit')]];
  function esc(v) { return String(v).replace(/[\\*()\x00]/g, function (c) { return '\\' + c.charCodeAt(0).toString(16).padStart(2, '0'); }); }
  function cond(r) {
    var a = r.attr, v = r.value;
    switch (r.op) {
      case 'eq': return '(' + a + '=' + esc(v) + ')';
      case 'contains': return '(' + a + '=*' + esc(v) + '*)';
      case 'starts': return '(' + a + '=' + esc(v) + '*)';
      case 'present': return '(' + a + '=*)';
      case 'absent': return '(!(' + a + '=*))';
      case 'ge': return '(' + a + '>=' + esc(v) + ')';
      case 'le': return '(' + a + '<=' + esc(v) + ')';
      case 'bit': return '(' + a + ':1.2.840.113556.1.4.803:=' + esc(v) + ')';
    }
    return '';
  }
  function buildFilter(q) { var parts = q.rows.filter(function (r) { return r.attr; }).map(cond); if (!parts.length) return '(objectClass=*)'; if (parts.length === 1) return parts[0]; return '(' + (q.join === 'or' ? '|' : '&') + parts.join('') + ')'; }
  function renderQuery(ed, tb) {
    tb.q = tb.q || storeGet('td.studio.query') || { rows: [{ attr: 'objectClass', op: 'eq', value: 'user' }, { attr: 'name', op: 'contains', value: '' }], join: 'and', base: rootDn, scope: 'sub', attrs: 'name,objectClass,description' };
    var q = tb.q; ed.textContent = '';
    ed.appendChild(el('h2', null, t('Query builder')));
    var seg = el('div', 'seg pill'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', t('Match')); seg.style.maxWidth = '340px';
    [['and', t('Match all')], ['or', t('Match any')]].forEach(function (x) { var b = el('button', null, x[1]); b.type = 'button'; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', q.join === x[0] ? 'true' : 'false'); b.addEventListener('click', function () { q.join = x[0]; renderQuery(ed, tb); }); seg.appendChild(b); });
    ed.appendChild(seg);
    var rows = el('div', 'stack tight');
    q.rows.forEach(function (r, i) {
      var row = el('div', 'qb-row');
      var a = el('input'); a.setAttribute('list', 'qb-attrs'); a.value = r.attr; a.setAttribute('aria-label', t('Attribute')); a.className = 'mono'; a.addEventListener('input', function () { r.attr = a.value.trim(); upd(); });
      var o = el('select'); o.setAttribute('aria-label', t('Condition')); OPS.forEach(function (x) { o.appendChild(new Option(x[1], x[0], false, r.op === x[0])); }); o.addEventListener('change', function () { r.op = o.value; v.disabled = r.op === 'present' || r.op === 'absent'; upd(); });
      var v = el('input'); v.value = r.value; v.setAttribute('aria-label', t('Value')); v.disabled = r.op === 'present' || r.op === 'absent'; v.addEventListener('input', function () { r.value = v.value; upd(); });
      v.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
      var x = el('button', 'st-btn sm', '×'); x.type = 'button'; x.setAttribute('aria-label', t('Remove condition')); x.addEventListener('click', function () { q.rows.splice(i, 1); renderQuery(ed, tb); });
      row.appendChild(a); row.appendChild(o); row.appendChild(v); row.appendChild(x); rows.appendChild(row);
    });
    ed.appendChild(rows);
    var dl = el('datalist'); dl.id = 'qb-attrs'; ATTRS.forEach(function (x) { dl.appendChild(new Option(x)); }); ed.appendChild(dl);
    var r2 = el('div', 'cluster');
    r2.appendChild(btn('+ ' + t('Condition'), function () { q.rows.push({ attr: 'name', op: 'contains', value: '' }); renderQuery(ed, tb); }, 'sm'));
    ed.appendChild(r2);
    var g = el('div', 'st-fields');
    var base = el('input'); base.value = q.base || ''; base.className = 'mono'; base.addEventListener('input', function () { q.base = base.value; });
    var sc = el('select'); [['sub', t('Subtree')], ['one', t('One level')], ['base', t('Base only')]].forEach(function (x) { sc.appendChild(new Option(x[1], x[0], false, q.scope === x[0])); }); sc.addEventListener('change', function () { q.scope = sc.value; });
    var at = el('input'); at.value = q.attrs; at.className = 'mono'; at.addEventListener('input', function () { q.attrs = at.value; });
    g.appendChild(wrapF(t('Search base'), base)); g.appendChild(wrapF(t('Scope'), sc)); g.appendChild(wrapF(t('Columns'), at));
    ed.appendChild(g);
    var fl = el('textarea', 'mono'); fl.rows = 2; fl.setAttribute('aria-label', t('LDAP filter')); fl.value = q.raw || buildFilter(q); fl.style.minHeight = '60px';
    fl.addEventListener('input', function () { q.raw = fl.value; });
    ed.appendChild(wrapF(t('LDAP filter (edit freely)'), fl));
    function upd() { q.raw = ''; fl.value = buildFilter(q); storeSet('td.studio.query', q); clearTimeout(upd.tm); upd.tm = setTimeout(run, 600); }
    var r3 = el('div', 'cluster'); r3.appendChild(btn(t('Run'), run, 'primary'));
    var bulkB = btn(t('Bulk edit results'), function () { if (tb.rows) openBulk(tb.rows.map(function (r) { return r.dn; }), (q.attrs || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean)); }); r3.appendChild(bulkB);
    var cnt = el('span', 'subtle'); r3.appendChild(cnt); ed.appendChild(r3);
    var grid = el('div', 'grid-wrap'); ed.appendChild(grid);
    function run() {
      var f = fl.value.trim() || '(objectClass=*)';
      if ((f.match(/\(/g) || []).length !== (f.match(/\)/g) || []).length) { cnt.textContent = t('The parentheses in the filter do not match.'); return; }
      cnt.textContent = t('Searching...');
      api('/api/dir/search?' + new URLSearchParams({ filter: f, base: q.base || '', scope: q.scope, attrs: q.attrs || 'name', limit: '500' })).then(function (r) {
        tb.rows = r.rows; cnt.textContent = t('{count} results in {ms} ms', { count: r.rows.length, ms: r.ms });
        lastSearch = { filter: f, rows: r.rows }; if (panelTab === 'search') renderPanel();
        drawGrid(grid, r.rows, (q.attrs || 'name').split(',').map(function (s) { return s.trim(); }).filter(Boolean), false);
      }, function (e) { cnt.textContent = e.message; });
    }
    if (tb.rows) drawGrid(grid, tb.rows, (q.attrs || 'name').split(',').map(function (s) { return s.trim(); }).filter(Boolean), false); else run();
  }
  function wrapF(label, input) { var w = el('label', 'st-f'); w.appendChild(el('span', null, label)); w.appendChild(input); return w; }
  function drawGrid(host2, rows, cols, editable, dirty) {
    host2.textContent = '';
    if (!rows.length) { host2.appendChild(el('p', 'muted', t('No objects matched'))).style.padding = '12px'; return; }
    var tbl = el('table', 'dgrid'), thead = el('thead'), tr = el('tr');
    tr.appendChild(el('th', null, 'DN')); cols.forEach(function (c) { tr.appendChild(el('th', 'mono', c)); });
    thead.appendChild(tr); tbl.appendChild(thead);
    var tb = el('tbody');
    rows.forEach(function (r, ri) {
      var row = el('tr');
      var d = el('td'); var dc = el('span', 'cell mono'); dc.textContent = rdnName(r.dn); dc.title = r.dn; dc.style.cursor = 'pointer'; dc.tabIndex = 0;
      dc.addEventListener('click', function () { openObject(r.dn); }); dc.addEventListener('keydown', function (e) { if (e.key === 'Enter') openObject(r.dn); });
      d.appendChild(dc); row.appendChild(d);
      cols.forEach(function (c, ci) {
        var td = el('td'), v = (r.attributes || {})[c]; v = Array.isArray(v) ? v.join('; ') : (v == null ? '' : String(v));
        var key = ri + ':' + c;
        if (dirty && key in dirty) { td.className = 'dirty'; v = dirty[key]; }
        var cell = el('span', 'cell', v);
        if (editable && c !== 'objectClass' && c !== 'distinguishedName') {
          cell.contentEditable = 'true'; cell.setAttribute('role', 'textbox'); cell.setAttribute('aria-label', rdnName(r.dn) + ' ' + c); cell.spellcheck = false;
          cell.addEventListener('input', function () { var orig = (r.attributes || {})[c]; orig = Array.isArray(orig) ? orig.join('; ') : (orig == null ? '' : String(orig)); if (cell.textContent !== orig) { dirty[key] = cell.textContent; td.className = 'dirty'; } else { delete dirty[key]; td.className = ''; } host2.dispatchEvent(new Event('dirty')); });
          cell.addEventListener('keydown', function (e) {
            var cells = $$('[contenteditable]', tbl), i = cells.indexOf(cell);
            if (e.key === 'Enter') { e.preventDefault(); var n = cells[i + cols.length - (cols.indexOf('objectClass') >= 0 ? 1 : 0)]; if (n) n.focus(); }
            else if (e.key === 'Tab') { /* default */ }
            else if (e.key === 'Escape') { cell.blur(); }
          });
          cell.addEventListener('paste', function (e) {
            var txt = (e.clipboardData || window.clipboardData).getData('text'); if (txt.indexOf('\n') < 0 && txt.indexOf('\t') < 0) return;
            e.preventDefault(); var lines = txt.replace(/\r/g, '').split('\n').filter(function (l) { return l !== ''; });
            lines.forEach(function (ln, k) { ln.split('\t').forEach(function (val, m) { var rr = rows[ri + k], cc = cols[ci + m]; if (!rr || !cc) return; dirty[(ri + k) + ':' + cc] = val; }); });
            drawGrid(host2, rows, cols, editable, dirty); host2.dispatchEvent(new Event('dirty'));
          });
        }
        td.appendChild(cell); row.appendChild(td);
      });
      tb.appendChild(row);
    });
    tbl.appendChild(tb); host2.appendChild(tbl);
  }

  // ---------------------------------------------------------- bulk edit
  function bulkFromContainer(dn) {
    api('/api/dir/search?' + new URLSearchParams({ filter: '(objectClass=*)', base: dn, scope: 'one', attrs: 'name,description,displayName,objectClass', limit: '1000' })).then(function (r) {
      openBulk(r.rows.map(function (x) { return x.dn; }).filter(function (d) { return d !== dn; }), ['description', 'displayName'], (nodes[dn] || {}).name || rdnName(dn));
    }, fail);
  }
  function openBulk(dns, cols, label) {
    openTab({ id: 'bulk:' + Date.now(), kind: 'bulk', title: t('Bulk edit') + ': ' + (label || dns.length), list: dns, cols: cols || ['description', 'displayName'] });
  }
  function renderBulk(ed, tb) {
    ed.textContent = '';
    ed.appendChild(el('h2', null, tb.title));
    ed.appendChild(el('p', 'hint', t('Click a cell to edit it like a spreadsheet. Paste rows from Excel. Preview shows every change before anything is written; each object is saved with undo.')));
    var colIn = el('input'); colIn.className = 'mono'; colIn.value = (tb.cols || []).join(', ');
    var top = el('div', 'cluster'); var cw = wrapF(t('Columns'), colIn); cw.style.flex = '1 1 280px'; top.appendChild(cw);
    top.appendChild(btn(t('Load'), function () { tb.cols = colIn.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean); tb.data = null; renderBulk(ed, tb); }));
    ed.appendChild(top);
    var grid = el('div', 'grid-wrap'); ed.appendChild(grid);
    var bar = el('div', 'cluster'); var info = el('span', 'subtle'); ed.appendChild(bar);
    var prevB = btn(t('Preview changes'), preview, 'primary'), applyB = btn(t('Apply'), applyAll); applyB.disabled = true;
    bar.appendChild(prevB); bar.appendChild(applyB); bar.appendChild(btn(t('Discard'), function () { tb.dirty = {}; drawGrid(grid, tb.data, tb.cols, true, tb.dirty); count(); })); bar.appendChild(info);
    var prevBox = el('div', 'stack tight'); ed.appendChild(prevBox);
    tb.dirty = tb.dirty || {};
    function count() { var n = Object.keys(tb.dirty).length; info.textContent = n ? t('{count} changed cells', { count: n }) : t('No changes yet'); applyB.disabled = true; prevBox.textContent = ''; }
    grid.addEventListener('dirty', count);
    function draw() { drawGrid(grid, tb.data, tb.cols, true, tb.dirty); count(); }
    if (tb.data) draw();
    else {
      grid.appendChild(el('p', 'subtle', t('Loading'))).style.padding = '12px';
      var dns = (tb.list || []).slice(0, 300);
      Promise.all(dns.map(function (d) { return getObj(d).catch(function () { return null; }); })).then(function (objs) {
        tb.data = objs.filter(Boolean).map(function (o) { return { dn: o.dn, attributes: o.attributes }; }); draw();
      });
    }
    function changes() {
      var byDn = {};
      Object.keys(tb.dirty).forEach(function (k) { var p = k.indexOf(':'), ri = +k.slice(0, p), c = k.slice(p + 1), r = tb.data[ri]; if (!r) return; (byDn[r.dn] = byDn[r.dn] || { set: {}, clear: [] }); var v = tb.dirty[k].trim(); if (v) byDn[r.dn].set[c] = v.split(/;\s*/); else byDn[r.dn].clear.push(c); });
      return byDn;
    }
    function preview() {
      var ch = changes(), dns = Object.keys(ch); prevBox.textContent = '';
      if (!dns.length) { prevBox.appendChild(el('p', 'muted', t('No changes yet'))); return; }
      prevBox.appendChild(el('div', 'st-k', t('Preview'))); var ul = el('ul', 'small');
      dns.forEach(function (d) { var c = ch[d]; Object.keys(c.set).forEach(function (a) { ul.appendChild(el('li', null, rdnName(d) + ': ' + a + ' → ' + c.set[a].join('; '))); }); c.clear.forEach(function (a) { ul.appendChild(el('li', null, rdnName(d) + ': ' + t('clear') + ' ' + a)); }); });
      prevBox.appendChild(ul); applyB.disabled = false; applyB.focus();
    }
    function applyAll() {
      var ch = changes(), dns = Object.keys(ch), done = 0, errs = []; applyB.disabled = true;
      var seq = Promise.resolve();
      dns.forEach(function (d) { seq = seq.then(function () { return post('/api/dir/patch', { dn: d, set: ch[d].set, clear: ch[d].clear }).then(function () { done++; info.textContent = t('{done} of {total} saved', { done: done, total: dns.length }); delete objCache[d]; }, function (e) { errs.push(rdnName(d) + ': ' + e.message); }); }); });
      seq.then(function () { toast(t('{done} of {total} saved', { done: done, total: dns.length }) + (errs.length ? '. ' + errs.join(' ') : ''), errs.length ? 'error' : 'success'); tb.data = null; tb.dirty = {}; renderBulk(ed, tb); loadHistory(); });
    }
  }

  // ---------------------------------------------------------- panel
  var SAVED = [
    { label: t('Disabled accounts'), filter: '(&(objectCategory=person)(objectClass=user)(userAccountControl:1.2.840.113556.1.4.803:=2))', problem: true },
    { label: t('Locked out accounts'), filter: '(&(objectClass=user)(lockoutTime>=1))', problem: true },
    { label: t('Computers not seen in 30 days'), filter: function () { var ft = (Date.now() - 30 * 864e5) * 1e4 + 116444736000000000; return '(&(objectClass=computer)(lastLogonTimestamp<=' + Math.floor(ft) + '))'; }, problem: true },
    { label: t('TempDesk guests'), filter: '(&(objectClass=user)(description=TempDesk guest*))' },
    { label: t('Members of Domain Admins'), filter: function () { return '(memberOf=CN=Domain Admins,CN=Users,' + rootDn + ')'; } },
    { label: t('Empty groups'), filter: '(&(objectClass=group)(!(member=*)))', problem: true }
  ];
  function renderSaved() {
    var box = $('[data-st-saved]'); box.textContent = '';
    SAVED.forEach(function (s) {
      var b = el('button', 'st-q'); b.type = 'button'; b.appendChild(el('span', null, s.label)); var c = el('span', 'c', ''); b.appendChild(c);
      b.addEventListener('click', function () { var f = typeof s.filter === 'function' ? s.filter() : s.filter; openTab({ id: 'query', kind: 'query', title: t('Query builder') }); var tb = tabs.filter(function (x) { return x.id === 'query'; })[0]; tb.q = { rows: [], join: 'and', base: rootDn, scope: 'sub', attrs: 'name,objectClass,description', raw: f }; tb.rows = null; renderActive(); });
      s.badge = c; box.appendChild(b);
    });
  }
  function renderPanel() {
    var b = $('[data-st-pbody]'); b.textContent = '';
    $$('[data-ptab]').forEach(function (x) { x.setAttribute('aria-selected', x.getAttribute('data-ptab') === panelTab ? 'true' : 'false'); });
    if (panelTab === 'problems') {
      if (problems === null) { b.appendChild(el('p', 'subtle', t('Checking the directory...'))); return; }
      if (!problems.length) { var ok = el('div', 'st-prob'); ok.appendChild(el('span', 'ok', '✓')); ok.appendChild(el('span', 'tx', t('No problems found: disabled admins, stale computers, expired guests and empty groups were checked.'))); b.appendChild(ok); return; }
      problems.forEach(function (p) {
        var r = el('div', 'st-prob'); r.appendChild(el('span', 'bang', p.severity === 'info' ? 'i' : '!')); r.appendChild(el('span', 'tx', p.text));
        if (p.fix === 'remove-members') { r.appendChild(btn(t('Review'), function () { openObject(p.target, 'Members'); }, 'sm primary')); r.appendChild(btn(t('Remove them'), function () { members(p.target, [], p.items).then(loadProblems); }, 'sm')); }
        else if (p.fix === 'disable') { r.appendChild(btn(t('Review'), function () { openObject(p.target); }, 'sm')); r.appendChild(btn(t('Disable'), function () { userAction(p.target, 'disable').then(loadProblems); }, 'sm')); }
        else if (p.fix === 'delete-guest') { var a = el('a', 'st-btn sm primary', t('Review')); a.href = '/guests?open=' + encodeURIComponent(p.target); r.appendChild(a); var d = el('a', 'st-btn sm', t('Delete')); d.href = '/guests/' + encodeURIComponent(p.target) + '/delete'; r.appendChild(d); }
        else r.appendChild(btn(t('Review'), function () { openObject(p.target); }, 'sm'));
        b.appendChild(r);
      });
    } else if (panelTab === 'search') {
      if (!lastSearch) { b.appendChild(el('p', 'muted', t('Search results appear here. Use the find box at the top or the Query builder.'))); return; }
      b.appendChild(el('div', 'st-log', lastSearch.filter + ' → ' + lastSearch.rows.length));
      lastSearch.rows.slice(0, 200).forEach(function (r) { var x = el('button', 'st-q'); x.type = 'button'; var a = r.attributes || {}; x.appendChild(iconFor(first(a.objectClass && a.objectClass.slice ? a.objectClass.slice(-1) : ''))); x.appendChild(el('span', null, first(a.name) || rdnName(r.dn))); x.appendChild(el('span', 'subtle small', r.dn)).style.marginLeft = 'auto'; x.addEventListener('click', function () { revealPath(r.dn); openObject(r.dn); }); b.appendChild(x); });
    } else if (panelTab === 'history') {
      if (!historyRows.length) { b.appendChild(el('p', 'muted', t('Directory changes you make appear here with Undo.'))); return; }
      historyRows.forEach(function (h) { var r = el('div', 'st-prob'); r.appendChild(el('span', 'subtle', new Date(h.time * 1000).toLocaleTimeString())); r.appendChild(el('span', 'tx', h.summary + (h.status !== 'done' ? ' (' + h.status + ')' : ''))); if (h.undoable) r.appendChild(btn(t('Undo'), function () { C.undoById(h.id).then(reloadAll); }, 'sm')); b.appendChild(r); });
    } else {
      if (!ldapLog.length) { b.appendChild(el('p', 'muted', t('Requests this studio sends to the agent are listed here.'))); return; }
      ldapLog.forEach(function (l) { b.appendChild(el('div', 'st-log', l.time.toLocaleTimeString() + '  ' + l.method + ' ' + decodeURIComponent(l.url) + '  ' + l.ms + ' ms' + (l.ok ? '' : '  ' + t('failed')))); });
    }
  }
  $$('[data-ptab]').forEach(function (x) { x.addEventListener('click', function () { panelTab = x.getAttribute('data-ptab'); $('[data-st-panel]').classList.remove('collapsed'); renderPanel(); }); });
  $('[data-ptoggle]').addEventListener('click', function (e) { var p = $('[data-st-panel]'); p.classList.toggle('collapsed'); e.currentTarget.setAttribute('aria-expanded', p.classList.contains('collapsed') ? 'false' : 'true'); });
  function loadProblems() {
    problems = null; if (panelTab === 'problems') renderPanel();
    return api('/api/dir/problems').then(function (r) { problems = r.problems || []; $('[data-prob-count]').textContent = String(problems.length); $('[data-sb="objects"]').textContent = t('{count} objects', { count: (r.users || 0) + (r.groups || 0) }); renderPanel(); }, function (e) { problems = []; renderPanel(); });
  }
  function loadSavedCounts() {
    SAVED.forEach(function (s) {
      if (!s.problem) return;
      var f = typeof s.filter === 'function' ? s.filter() : s.filter;
      api('/api/dir/search?' + new URLSearchParams({ filter: f, attrs: 'name', limit: '200' })).then(function (r) { s.badge.textContent = r.rows.length ? String(r.rows.length) : ''; }, function () { /* ignore */ });
    });
  }
  function loadHistory() { return api('/api/dir/history').then(function (r) { historyRows = r; updateStatus(); if (panelTab === 'history') renderPanel(); }, function () { /* ignore */ }); }
  function updateStatus() {
    $('[data-sb="sel"]').textContent = t('{count} selected', { count: selected.length });
    $('[data-sb="undo"]').textContent = t('Undo: {count} steps', { count: historyRows.filter(function (h) { return h.undoable; }).length });
    if (!$('[data-sb="objects"]').textContent) $('[data-sb="objects"]').textContent = t('{count} objects', { count: Object.keys(nodes).length });
  }

  // ---------------------------------------------------------- top bar
  var find = $('[data-st-find]');
  find.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return; e.preventDefault();
    var v = find.value.trim().replace(/[()\\*\x00]/g, ''); if (!v) return;
    var f = /^[A-Za-z][\w-]*=/.test(v) ? '(' + v + ')' : '(|(name=*' + v + '*)(sAMAccountName=*' + v + '*)(displayName=*' + v + '*)(description=*' + v + '*))';
    api('/api/dir/search?' + new URLSearchParams({ filter: f, attrs: 'name,objectClass', limit: '200' })).then(function (r) {
      lastSearch = { filter: f, rows: r.rows }; panelTab = 'search'; $('[data-st-panel]').classList.remove('collapsed'); renderPanel();
      if (r.rows.length === 1 || (r.rows[0] && (first((r.rows[0].attributes || {}).name) || '').toLowerCase() === v.toLowerCase())) { revealPath(r.rows[0].dn); openObject(r.rows[0].dn); }
      if (phone.matches) setPane(r.rows.length === 1 ? 'editor' : 'problems');
    }, fail);
  });
  $('[data-st-undo]').addEventListener('click', function () {
    var fd = new FormData(); fd.append('csrf_token', C.csrf()); fd.append('back', '/directory');
    fetch('/undo', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch', Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (j) { toast(j.message, j.ok ? 'success' : 'error'); reloadAll(); });
  });
  var nb = $('[data-st-new]'), nm = $('[data-st-newmenu]');
  nb.addEventListener('click', function (e) { e.stopPropagation(); nm.hidden = !nm.hidden; nb.setAttribute('aria-expanded', nm.hidden ? 'false' : 'true'); if (!nm.hidden) { var p = selected[0] && nodes[selected[0]] && isContainer(nodes[selected[0]].objectClass) ? selected[0] : (selected[0] ? parentOf(selected[0]) : rootDn); $$('a[data-new]', nm).forEach(function (a) { a.href = '/directory/create?parent=' + encodeURIComponent(p) + '&class=' + a.getAttribute('data-new'); }); var f = nm.querySelector('a'); if (f) f.focus(); } });
  doc.addEventListener('click', function (e) { if (!nm.hidden && !nm.contains(e.target)) { nm.hidden = true; nb.setAttribute('aria-expanded', 'false'); } });
  doc.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); find.focus(); }
    if (e.key === 'Escape' && !nm.hidden) { nm.hidden = true; nb.focus(); }
  });

  // ---------------------------------------------------------- phone panes
  function setPane(p) { host.setAttribute('data-pane', p); $$('[data-pane-btn]').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-pane-btn') === p ? 'true' : 'false'); }); if (p === 'editor' && !tabs.length && selected[0]) openObject(selected[0]); if (p === 'editor') renderMapIfOpen(); }
  $$('[data-pane-btn]').forEach(function (b) { b.addEventListener('click', function () { setPane(b.getAttribute('data-pane-btn')); }); });
  if (!phone.matches) host.setAttribute('data-pane', 'editor');

  // ---------------------------------------------------------- start
  renderSaved();
  var saved = storeGet('td.studio.tabs');
  if (saved && saved.tabs) { tabs = saved.tabs.filter(function (x) { return x.kind !== 'bulk'; }); activeTab = saved.active; if (!tabs.some(function (x) { return x.id === activeTab; })) activeTab = tabs.length ? tabs[0].id : null; }
  renderTree(); renderTabs();
  var startDn = cfg.open || cfg.dn;
  var boot = rootDn ? toggle(rootDn, true) : Promise.resolve();
  boot.then(function () {
    if (startDn) return revealPath(startDn).then(function () { selected = [startDn]; openObject(startDn); if (cfg['do'] === 'password') pwDialog(startDn); });
    if (cfg.find) { find.value = cfg.find; find.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })); return; }
    if (!tabs.length && !phone.matches) { var g = Object.keys(nodes).filter(function (d) { return /^OU=/i.test(d); })[0]; if (g) { selected = [g]; openObject(g); } else renderActive(); }
    else renderActive();
  });
  if (cfg.find && cfg['do'] === 'password') {
    // Reset password requested from the guests page: open the dialog once the object is found.
    var once = setInterval(function () { var d = activeDn(); if (d) { clearInterval(once); pwDialog(d); } }, 300); setTimeout(function () { clearInterval(once); }, 6000);
  }
  loadProblems(); loadHistory(); loadSavedCounts();
  renderPanel(); updateStatus();
})();
