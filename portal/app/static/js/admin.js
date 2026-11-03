// Admin console behaviour: browser-style tabs, lazy directory tree, undo
// shortcuts, notification panel, elevation dialog, personal wording drop.
(function () {
  'use strict';
  var doc = document, TD = window.TD || {};
  var t = TD.t || function (k) { return k; };
  var store = TD.store || { get: function () { return null; }, set: function () {}, del: function () {} };
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  function csrf() { var i = $('input[name="csrf_token"]'); return i ? i.value : ''; }

  // ---------------------------------------------------------- tabs (restored on reload)
  var TKEY = 'td.tabs';
  function loadTabs() { try { return JSON.parse(store.get(TKEY) || '[]').filter(function (x) { return x && typeof x.href === 'string' && x.href.charAt(0) === '/'; }); } catch (e) { return []; } }
  function saveTabs(list) { store.set(TKEY, JSON.stringify(list.slice(0, 20))); }
  var bar = $('[data-doc-tabs]');
  var here = location.pathname + location.search;
  function renderTabs() {
    if (!bar) return;
    var list = loadTabs();
    bar.textContent = '';
    list.forEach(function (tab, i) {
      var el = doc.createElement('div'); el.className = 'doc-tab' + (tab.href === here ? ' active' : ''); el.draggable = true; el.setAttribute('role', 'presentation');
      var a = doc.createElement('a'); a.href = tab.href; a.textContent = tab.title; a.setAttribute('role', 'tab'); a.setAttribute('aria-selected', tab.href === here ? 'true' : 'false'); a.title = tab.title;
      var x = doc.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', t('Close tab') + ': ' + tab.title); x.textContent = '×';
      x.addEventListener('click', function () { close(i); });
      el.addEventListener('auxclick', function (e) { if (e.button === 1) { e.preventDefault(); close(i); } });
      el.addEventListener('dragstart', function (e) { el.classList.add('dragging'); e.dataTransfer.setData('text/x-td-tab', String(i)); e.dataTransfer.effectAllowed = 'move'; });
      el.addEventListener('dragend', function () { el.classList.remove('dragging'); });
      el.addEventListener('dragover', function (e) { if (e.dataTransfer.types.indexOf('text/x-td-tab') >= 0) { e.preventDefault(); } });
      el.addEventListener('drop', function (e) {
        var from = parseInt(e.dataTransfer.getData('text/x-td-tab'), 10); if (isNaN(from)) return;
        e.preventDefault(); e.stopPropagation();
        var l = loadTabs(), moved = l.splice(from, 1)[0]; l.splice(i, 0, moved); saveTabs(l); renderTabs();
      });
      el.addEventListener('keydown', function (e) {
        if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          var l = loadTabs(), j = i + (e.key === 'ArrowLeft' ? -1 : 1); if (j < 0 || j >= l.length) return;
          var m = l.splice(i, 1)[0]; l.splice(j, 0, m); saveTabs(l); renderTabs(); bar.children[j].querySelector('a').focus();
        }
        if (e.key === 'Delete') close(i);
      });
      el.appendChild(a); el.appendChild(x); bar.appendChild(el);
    });
  }
  function open(href, title) {
    var list = loadTabs();
    if (!list.some(function (x) { return x.href === href; })) { list.push({ href: href, title: (title || href).slice(0, 80) }); saveTabs(list); }
    renderTabs();
  }
  function close(i) {
    var list = loadTabs(), was = list[i]; list.splice(i, 1); saveTabs(list); renderTabs();
    if (was && was.href === here && list.length) location.href = list[Math.max(0, i - 1)].href;
  }
  window.TDTabs = { open: open };
  // Search the open tabs, and close the tabs that contain (or do not contain) the text.
  // There are no pinned tabs in this strip; the current page counts as unsaved while a form on it was edited.
  var pageDirty = false;
  doc.addEventListener('input', function (e) { if (e.target.closest && e.target.closest('main form') && !e.target.closest('[role="search"], .ss')) pageDirty = true; });
  doc.addEventListener('submit', function () { pageDirty = false; });
  if (window.TDSearch && bar) {
    window.TDSearch.mount($('[data-search-surface="doc-tabs"]'), {
      kind: 'tabs', target: bar, items: '.doc-tab',
      tabs: {
        list: function () { return loadTabs().map(function (x) { return { key: x.href, label: x.title + ' ' + x.href, pinned: false, dirty: x.href === here && pageDirty }; }); },
        close: function (keys) {
          var list = loadTabs().filter(function (x) { return keys.indexOf(x.href) < 0; }); saveTabs(list); renderTabs();
          if (keys.indexOf(here) >= 0 && list.length) location.href = list[0].href;
        }
      }
    });
  }
  var main = $('main[data-tab-title]');
  if (main) open(here, main.getAttribute('data-tab-title'));
  else renderTabs();
  doc.addEventListener('auxclick', function (e) {
    var a = e.target.closest('a[data-tab-link]'); if (a && e.button === 1) { open(a.getAttribute('href'), a.textContent.trim()); }
  });

  // ---------------------------------------------------------- lazy directory tree
  function loadChildren(btn) {
    var li = btn.closest('li'), existing = li.querySelector(':scope > ul');
    var open = btn.getAttribute('aria-expanded') === 'true';
    if (open) { btn.setAttribute('aria-expanded', 'false'); if (existing) existing.hidden = true; return; }
    btn.setAttribute('aria-expanded', 'true');
    if (existing) { existing.hidden = false; return; }
    var ul = doc.createElement('ul'); /* search: dir-classic-tree */ var sk = doc.createElement('li'); sk.className = 'skeleton'; sk.style.height = '28px'; sk.setAttribute('aria-label', t('Loading')); ul.appendChild(sk); li.appendChild(ul);
    fetch('/directory/children?dn=' + encodeURIComponent(btn.getAttribute('data-dn')), { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (rows) {
        ul.textContent = '';
        var cur = ($('[data-lazy-tree]') || {}).getAttribute ? $('[data-lazy-tree]').getAttribute('data-current') : '';
        rows.forEach(function (n) {
          var c = doc.createElement('li'), node = doc.createElement('div'); node.className = 'node';
          if (n.hasChildren) { var b = doc.createElement('button'); b.type = 'button'; b.className = 'twisty'; b.setAttribute('aria-expanded', 'false'); b.setAttribute('data-dn', n.dn); b.setAttribute('aria-label', t('Expand') + ' ' + n.name); b.textContent = '▸'; node.appendChild(b); }
          else { var sp = doc.createElement('span'); sp.style.width = '32px'; sp.style.flex = '0 0 32px'; node.appendChild(sp); }
          var a = doc.createElement('a'); a.href = '/directory?view=list&dn=' + encodeURIComponent(n.dn); a.textContent = n.name; if (n.dn === cur) a.setAttribute('aria-current', 'page');
          node.appendChild(a); c.appendChild(node); ul.appendChild(c);
        });
        if (!rows.length) { var e = doc.createElement('li'); e.className = 'subtle small'; e.style.padding = '6px 12px'; e.textContent = '-'; ul.appendChild(e); }
      })
      .catch(function () { ul.textContent = ''; TD.toast && TD.toast(t('Loading') + ': error', 'error'); btn.setAttribute('aria-expanded', 'false'); ul.remove(); });
  }
  doc.addEventListener('click', function (e) { var b = e.target.closest('[data-lazy-tree] .twisty'); if (b) loadChildren(b); });
  // Expand the tree towards the current DN.
  (function () {
    var tree = $('[data-lazy-tree]'); if (!tree) return;
    var cur = tree.getAttribute('data-current'); if (!cur) return;
    var first = tree.querySelector('.twisty'); if (first && cur.toLowerCase().endsWith(first.getAttribute('data-dn').toLowerCase())) loadChildren(first);
  })();

  // ---------------------------------------------------------- undo / redo shortcuts
  doc.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    var tag = (doc.activeElement && doc.activeElement.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (doc.activeElement && doc.activeElement.isContentEditable)) return;
    var k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); var f = $('[data-undo-form]'); if (f) f.submit(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); var g = $('[data-redo-form]'); if (g) g.submit(); }
  });

  // ---------------------------------------------------------- notifications panel
  var bell = $('[data-bell]'), panel = $('[data-notif-panel]');
  function loadN() { try { return JSON.parse(store.get('td.notifications') || '[]'); } catch (e) { return []; } }
  if (bell && panel) {
    bell.addEventListener('click', function () {
      var open = panel.hidden; panel.hidden = !open; bell.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var b = panel.querySelector('button'); if (b) b.focus(); }
    });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { panel.hidden = true; bell.setAttribute('aria-expanded', 'false'); bell.focus(); } });
    $('[data-notif-read]').addEventListener('click', function () { var l = loadN(); l.forEach(function (n) { n.read = true; }); store.set('td.notifications', JSON.stringify(l)); location.reload(); });
    $('[data-notif-clear]').addEventListener('click', function () { store.del('td.notifications'); location.reload(); });
  }

  // ---------------------------------------------------------- elevation dialog
  var elevDlg = $('[data-elevate-dialog]');
  doc.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="/auth/elevate"]');
    if (a && elevDlg && elevDlg.showModal) {
      e.preventDefault();
      var nx = new URL(a.href, location.href).searchParams.get('next');
      elevDlg.querySelector('input[name="next"]').value = nx || location.pathname + location.search;
      elevDlg.showModal(); elevDlg.querySelector('input[type="password"]').focus();
    }
  });
  if (elevDlg) {
    var ef = $('[data-elevate-form]'), err = $('[data-elevate-error]');
    ef.addEventListener('submit', function (e) {
      e.preventDefault(); err.hidden = true;
      fetch('/auth/elevate', { method: 'POST', body: new FormData(ef), credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch', Accept: 'application/json' } })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (res.ok && res.j.ok) { elevDlg.close(); location.href = ef.querySelector('input[name="next"]').value || location.href; }
          else { err.textContent = res.j.error || 'Error'; err.hidden = false; }
        })
        .catch(function () { err.textContent = 'Error'; err.hidden = false; })
        .finally(function () { ef.querySelector('input[type="password"]').value = ''; });
    });
  }

  // ---------------------------------------------------------- personal wording drag and drop (any page)
  var overlay = $('[data-drop-overlay]'), live = $('[data-live]'), depth = 0;
  var schoolOn = doc.cookie.split(';').some(function (c) { return c.trim() === 'td_school=1'; });
  function hasFile(e) { return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], 'Files') >= 0; }
  function isOwnDrop(e) { return e.target.closest && (e.target.closest('input[type="file"]') || e.target.closest('[data-b64-app]')); }
  if (overlay && !schoolOn) {
    doc.addEventListener('dragenter', function (e) { if (!hasFile(e) || isOwnDrop(e)) return; depth++; overlay.classList.add('show'); });
    doc.addEventListener('dragleave', function (e) { if (!hasFile(e)) return; depth = Math.max(0, depth - 1); if (!depth) overlay.classList.remove('show'); });
    doc.addEventListener('dragover', function (e) { if (hasFile(e) && !isOwnDrop(e)) e.preventDefault(); });
    doc.addEventListener('drop', function (e) {
      if (!hasFile(e) || isOwnDrop(e)) return;
      e.preventDefault(); depth = 0; overlay.classList.remove('show');
      var f = e.dataTransfer.files[0]; if (!f) return;
      if (f.size > 256 * 1024) { fail(t('This file was not applied') + ': ' + 'The file is larger than 256 KiB.'); return; }
      if (live) live.textContent = t('Uploading personal wording');
      f.arrayBuffer().then(function (buf) {
        return fetch('/api/wording', { method: 'POST', body: buf, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf(), Accept: 'application/json' } });
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.ok) celebrate(j.headline || t('Personal wording applied'));
        else fail(t('This file was not applied') + ': ' + (j.error || ''));
      }).catch(function () { fail(t('This file was not applied')); });
    });
  }
  function fail(msg) { if (live) live.textContent = msg; TD.toast && TD.toast(msg, 'error'); }
  function celebrate(text) {
    if (live) live.textContent = text;
    var el = doc.createElement('div'); el.className = 'celebrate'; el.setAttribute('aria-hidden', 'true');
    var h = doc.createElement('div'); h.className = 'headline'; h.textContent = text; el.appendChild(h);
    doc.body.appendChild(el);
    var reduced = TD.motionOff && TD.motionOff();
    requestAnimationFrame(function () { el.classList.add('in'); });
    setTimeout(function () { el.classList.add('out'); }, reduced ? 2500 : 3000);
    setTimeout(function () { el.remove(); location.reload(); }, reduced ? 3000 : 3600);
  }
})();
