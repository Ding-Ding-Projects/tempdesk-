// Command palette: Ctrl+Shift+F on every page. Fuzzy filter of the pages and
// actions available in this mode (from the navigation registry), Enter navigates.
(function () {
  'use strict';
  var doc = document;
  var items = [];
  try { items = JSON.parse((doc.getElementById('td-palette') || {}).textContent || '[]'); } catch (e) { items = []; }
  var t = (window.TD && window.TD.t) || function (k) { return k; };
  var pal = null, dlg = null, input = null, list = null, results = [], active = 0, lastFocus = null;
  function copy(text) { return window.TD && window.TD.wordingText ? window.TD.wordingText(text) : text; }

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
    list = doc.createElement('ul'); list.id = 'palette-list'; list.setAttribute('role', 'listbox'); /* search: palette */
    var foot = doc.createElement('footer'); foot.textContent = '↑ ↓  Enter  Esc';
    dlg.appendChild(input); dlg.appendChild(list); dlg.appendChild(foot);
    doc.body.appendChild(dlg);
    // With ".*" on (or a pattern from the Builder), the text is a regular expression over the labels.
    input.setAttribute('data-search-surface', 'palette');
    if (window.TDSearch) pal = window.TDSearch.mount(input, { kind: 'custom', highlight: false, label: t('Search pages and actions'), onChange: render });
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(results[active]); }
    });
    dlg.addEventListener('close', function () { if (lastFocus && lastFocus.focus) lastFocus.focus(); });
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
  }
  function localizeControls() {
    var name = copy(t('Search pages and actions'));
    input.placeholder = name;
    input.setAttribute('aria-label', name);
    dlg.setAttribute('aria-label', copy(t('Command palette')));
  }

  function render() {
    localizeControls();
    var q = input.value.trim();
    results = [];
    var rx = pal && pal.state().regex;
    items.forEach(function (original) {
      var it = original.localCopy
        ? Object.assign({}, original, {label: copy(original.label), group: copy(original.group || '')})
        : original;
      var hay = it.label + (it.keywords ? ' ' + it.keywords : '');
      if (rx) {
        if (!pal.test(hay + ' ' + (it.group || '') + ' ' + original.label)) return;
        var hh = []; pal.matches(it.label, 20).forEach(function (mm) { for (var k = 0; k < mm.length; k++) hh.push(mm.index + k); });
        results.push({ it: it, score: 1, hits: hh }); return;
      }
      var labelMatch = score(q, it.label);
      var m = labelMatch || score(q, hay) || score(q, it.group || '') || score(q, original.label);
      if (m) results.push({ it: it, score: m.score, hits: labelMatch ? m.hits : [] });
    });
    results.sort(function (a, b) { return b.score - a.score; });
    results = results.slice(0, 50);
    active = 0;
    list.textContent = '';
    if (!results.length) { var e = doc.createElement('li'); e.className = 'palette-empty'; e.textContent = copy(t('No matches')); list.appendChild(e); input.removeAttribute('aria-activedescendant'); return; }
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
    var here = window.location.pathname;
    var hash = it.href.indexOf('#');
    var target = !it.action && hash >= 0 && it.href.slice(0, hash) === here
      ? doc.getElementById(it.href.slice(hash + 1)) : null;
    var targetControl = target && (target.matches('input, select, textarea, button, [tabindex]') ? target : target.querySelector('input, select, textarea, button'));
    if (targetControl && targetControl.disabled) targetControl = target.closest('#wording')?.querySelector('#wording-status');
    if (targetControl) lastFocus = null;
    dlg.close();
    if (it.action === 'theme' && window.TD) { window.TD.toggleTheme(); return; }
    if (it.action === 'print') { window.print(); return; }
    if (it.action === 'logout') { var f = doc.querySelector('[data-logout-form]'); if (f) f.requestSubmit(); return; }
    window.location.href = it.href;
    if (target) {
      target.scrollIntoView();
      if (targetControl) targetControl.focus();
    }
  }
  function open() {
    if (!dlg) build();
    lastFocus = doc.activeElement;
    input.value = ''; render();
    dlg.showModal(); input.focus();
  }
  window.TDPalette = { open: open, items: items };
  window.addEventListener('td:wording-change', function () {
    if (!dlg) return;
    if (dlg.open) render();
    else {
      localizeControls();
      list.textContent = '';
      results = [];
      input.removeAttribute('aria-activedescendant');
    }
  });
  doc.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); open(); }
  });
  Array.prototype.forEach.call(doc.querySelectorAll('[data-open-palette]'), function (b) { b.addEventListener('click', open); });
})();
