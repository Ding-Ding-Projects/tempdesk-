// Command palette: Ctrl+Shift+F on every page. Fuzzy filter of the pages and
// actions available in this mode (from the navigation registry), Enter navigates.
(function () {
  'use strict';
  var doc = document;
  var items = [];
  try { items = JSON.parse((doc.getElementById('td-palette') || {}).textContent || '[]'); } catch (e) { items = []; }
  var t = (window.TD && window.TD.t) || function (k) { return k; };
  var dlg = null, input = null, list = null, results = [], active = 0, lastFocus = null;

  function score(q, text) {
    // Subsequence match; consecutive and word-start hits score higher.
    q = q.toLowerCase(); var s = text.toLowerCase();
    if (!q) return { score: 1, hits: [] };
    var direct = s.indexOf(q);
    if (direct >= 0) { var h = []; for (var k = 0; k < q.length; k++) h.push(direct + k); return { score: 100 - direct + (direct === 0 ? 50 : 0), hits: h }; }
    var i = 0, j = 0, sc = 0, prev = -2, hits = [];
    while (i < q.length && j < s.length) {
      if (q[i] === s[j]) { sc += (prev === j - 1 ? 5 : 1) + (j === 0 || s[j - 1] === ' ' ? 3 : 0); hits.push(j); prev = j; i++; }
      j++;
    }
    return i === q.length ? { score: sc, hits: hits } : null;
  }
  function build() {
    dlg = doc.createElement('dialog'); dlg.className = 'palette'; dlg.setAttribute('aria-label', t('Command palette'));
    input = doc.createElement('input'); input.type = 'text'; input.className = 'palette-input';
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true'); input.setAttribute('aria-controls', 'palette-list');
    input.setAttribute('aria-autocomplete', 'list'); input.placeholder = t('Search pages and actions'); input.setAttribute('aria-label', t('Search pages and actions'));
    list = doc.createElement('ul'); list.id = 'palette-list'; list.setAttribute('role', 'listbox');
    var foot = doc.createElement('footer'); foot.textContent = '↑ ↓  Enter  Esc';
    dlg.appendChild(input); dlg.appendChild(list); dlg.appendChild(foot);
    doc.body.appendChild(dlg);
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
    });
    dlg.addEventListener('close', function () { if (lastFocus && lastFocus.focus) lastFocus.focus(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  }
  function render() {
    var q = input.value.trim();
    results = [];
    items.forEach(function (it) {
      var hay = it.label + (it.keywords ? ' ' + it.keywords : '');
      var m = score(q, it.label) || score(q, hay) || (it.group ? score(q, it.group + ' ' + it.label) : null);
      if (m) results.push({ it: it, score: m.score, hits: it.label.toLowerCase().indexOf(q.toLowerCase()) >= 0 || m.hits.every(function (h) { return h < it.label.length; }) ? m.hits : [] });
    });
    results.sort(function (a, b) { return b.score - a.score; });
    results = results.slice(0, 50);
    active = 0;
    list.textContent = '';
    if (!results.length) { var e = doc.createElement('li'); e.className = 'palette-empty'; e.textContent = t('No matches'); list.appendChild(e); input.removeAttribute('aria-activedescendant'); return; }
    results.forEach(function (r, i) {
      var li = doc.createElement('li'); li.id = 'pal-' + i; li.setAttribute('role', 'option');
      var label = doc.createElement('span'), hits = {};
      r.hits.forEach(function (h) { hits[h] = true; });
      for (var c = 0; c < r.it.label.length; c++) {
        if (hits[c]) { var m = doc.createElement('mark'); m.textContent = r.it.label[c]; label.appendChild(m); }
        else label.appendChild(doc.createTextNode(r.it.label[c]));
      }
      li.appendChild(label);
      if (r.it.group) { var g = doc.createElement('span'); g.className = 'group'; g.textContent = r.it.group; li.appendChild(g); }
      li.addEventListener('click', function () { go(r); });
      li.addEventListener('mousemove', function () { setActive(i); });
      list.appendChild(li);
    });
    setActive(0);
  }
  function setActive(i) {
    active = i;
    Array.prototype.forEach.call(list.children, function (li, k) { li.setAttribute('aria-selected', k === i ? 'true' : 'false'); });
    input.setAttribute('aria-activedescendant', 'pal-' + i);
    var el = list.children[i]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  function move(d) { if (results.length) setActive((active + d + results.length) % results.length); }
  function go(r) {
    if (!r) return;
    var it = r.it;
    dlg.close();
    if (it.action === 'theme' && window.TD) { window.TD.toggleTheme(); return; }
    if (it.action === 'print') { window.print(); return; }
    if (it.action === 'logout') { var f = doc.querySelector('[data-logout-form]'); if (f) f.submit(); return; }
    var here = window.location.pathname;
    window.location.href = it.href;
    if (it.href.split('#')[0] === here && it.href.indexOf('#') >= 0) {
      var target = doc.getElementById(it.href.split('#')[1]);
      if (target) { target.scrollIntoView(); var f2 = target.querySelector('input, select, textarea, button'); if (f2) f2.focus(); }
    }
  }
  function open() {
    if (!dlg) build();
    lastFocus = doc.activeElement;
    input.value = ''; render();
    dlg.showModal(); input.focus();
  }
  window.TDPalette = { open: open, items: items };
  doc.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); open(); }
  });
  Array.prototype.forEach.call(doc.querySelectorAll('[data-open-palette]'), function (b) { b.addEventListener('click', open); });
})();
