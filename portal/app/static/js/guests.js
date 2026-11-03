// Guests page: countdown rings, quick extend chips, filters and the detail
// drawer (a bottom sheet on phones). Every server change uses the existing
// form routes (CSRF, undo journal) through fetch.
(function () {
  'use strict';
  var doc = document, TD = window.TD || {}, C = window.TDC;
  if (!C) return;
  var t = TD.t || function (k) { return k; };
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  var root = $('[data-guests]'); if (!root) return;
  var drawer = $('[data-g-drawer]'), scrim = $('[data-g-scrim]'), current = null, lastFocus = null;

  function info(card) {
    return { username: card.getAttribute('data-guest'), displayName: card.getAttribute('data-name'), created: card.getAttribute('data-created') || null,
      expiresAt: card.getAttribute('data-expires') || null, enabled: card.getAttribute('data-enabled') === '1', lastLogon: card.getAttribute('data-last') || null };
  }
  function kind(g) {
    var now = Date.now(), x = C.parse(g.expiresAt);
    if (x === null) return 'perm';
    if (x <= now) return 'expired';
    if (x - now <= 3600000) return 'soon';
    return 'active';
  }
  function paintRings() {
    var counts = { all: 0, soon: 0, signed: 0, perm: 0, expired: 0 };
    $$('[data-guest]').forEach(function (card) {
      var g = info(card), host = card.querySelector('[data-ring]');
      host.textContent = ''; host.appendChild(C.ringFor(g, 52));
      var k = kind(g); counts.all++; if (k === 'soon') counts.soon++; if (k === 'perm') counts.perm++; if (k === 'expired') counts.expired++; if (g.lastLogon) counts.signed++;
      card.classList.toggle('dim', k === 'expired' || !g.enabled);
      card.setAttribute('data-kind', k);
    });
    Object.keys(counts).forEach(function (k) { var e = $('[data-g-count="' + k + '"]'); if (e) e.textContent = String(counts[k]); });
  }
  var filter = 'all';
  function applyFilter() {
    var shown = 0;
    $$('[data-guest]').forEach(function (card) {
      var g = info(card), k = card.getAttribute('data-kind');
      var ok = filter === 'all' || (filter === 'signed' ? !!g.lastLogon : k === filter);
      if (card.getAttribute('data-hide-search') === '1') ok = false;
      card.hidden = !ok; if (ok) shown++;
    });
    var none = $('[data-g-none]'); if (none) none.hidden = shown > 0;
  }
  $$('[data-g-filter]').forEach(function (b) {
    b.addEventListener('click', function () {
      filter = b.getAttribute('data-g-filter');
      $$('[data-g-filter]').forEach(function (x) { x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
      applyFilter();
    });
    b.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      var all = $$('[data-g-filter]'), i = all.indexOf(b), n = all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
      n.focus(); n.click();
    });
  });
  // Live search over the cards through the search surface of the guest search box (plain text or
  // regex with the Builder); the server-side search box still works with Enter.
  var gs = window.TDSearch && window.TDSearch.get('table-guests');
  if (gs) gs.listen(function () {
    var cards = $$('[data-guest]'), shown = 0;
    cards.forEach(function (card) {
      var m = gs.test(card.getAttribute('data-guest') + ' ' + card.getAttribute('data-name') + ' ' + card.textContent);
      card.setAttribute('data-hide-search', m ? '0' : '1'); if (m) shown++;
    });
    gs.count(shown, cards.length);
    gs.highlight(gs.active() ? cards.filter(function (c) { return c.getAttribute('data-hide-search') !== '1'; }).map(function (c) { return c.querySelector('.nm') || c; }) : []);
    applyFilter();
  });

  function extend(username, minutes, card) {
    return C.postForm('/guests/' + encodeURIComponent(username) + '/extend', { minutes: String(minutes) }).then(function (j) {
      TD.toast(j.message || t('Saved'), 'success');
      var exp = minutes === 0 ? '' : new Date(Date.now() + minutes * 60000).toISOString().replace(/\.\d+Z$/, 'Z');
      if (card) { card.setAttribute('data-expires', exp); if (!card.getAttribute('data-created')) card.setAttribute('data-created', new Date().toISOString()); }
      paintRings(); applyFilter(); if (current && current === card) fill(card);
    }, function (e) { TD.toast(e.message, 'error'); });
  }
  root.addEventListener('click', function (e) {
    var q1 = e.target.closest('[data-quick-extend]');
    if (q1) { e.preventDefault(); e.stopPropagation(); var card = q1.closest('[data-guest]'); extend(card.getAttribute('data-guest'), parseInt(q1.getAttribute('data-quick-extend'), 10), card); return; }
    var op = e.target.closest('[data-open-guest]');
    if (op) { openDrawer(op.closest('[data-guest]')); return; }
    var card2 = e.target.closest('[data-guest]');
    if (card2 && !e.target.closest('a, button, input, label')) openDrawer(card2);
  });

  function fill(card) {
    var g = info(card);
    $('#gd-name').textContent = g.username;
    var tag = $('[data-gd-tag]'), k = kind(g), x = C.parse(g.expiresAt);
    tag.className = 'pill-tag' + (k === 'perm' ? ' mute' : k === 'active' ? ' ok' : '');
    tag.textContent = k === 'perm' ? t('Permanent') : k === 'expired' ? t('Expired') : t('Ends {time}', { time: C.timeOf(new Date(x)) });
    $('[data-gd="name"]').textContent = g.displayName || t('No name');
    $('[data-gd="created"]').textContent = g.created ? new Date(g.created).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '-';
    $('[data-gd="expires"]').textContent = x === null ? t('No expiry') : new Date(x).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' (' + (x > Date.now() ? C.rel(x - Date.now()) : t('Expired')) + ')';
    $('[data-gd="last"]').textContent = g.lastLogon ? new Date(g.lastLogon).toLocaleString() : t('Never');
    $('[data-gd-dir]').href = '/directory?find=' + encodeURIComponent(g.username);
    $('[data-gd-reset]').href = '/directory?find=' + encodeURIComponent(g.username) + '&do=password';
    $('[data-gd-delete]').href = '/guests/' + encodeURIComponent(g.username) + '/delete';
  }
  function openDrawer(card, quiet) {
    if (!card || !drawer) return;
    $$('.g-card.selected').forEach(function (c) { c.classList.remove('selected'); });
    card.classList.add('selected'); current = card; lastFocus = doc.activeElement;
    fill(card);
    drawer.hidden = false;
    if (window.matchMedia('(max-width: 900px)').matches) { scrim.classList.add('show'); drawer.setAttribute('aria-modal', 'true'); var c = $('[data-gd-close]'); if (c) c.focus(); }
    else { drawer.setAttribute('aria-modal', 'false'); }
    if (!quiet) { try { history.replaceState(null, '', location.pathname + '?open=' + encodeURIComponent(card.getAttribute('data-guest'))); } catch (e) { /* ignore */ } }
  }
  function closeDrawer() {
    if (!drawer || drawer.hidden) return;
    scrim.classList.remove('show');
    if (window.matchMedia('(max-width: 900px)').matches) drawer.hidden = true;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  if (drawer) {
    $('[data-gd-close]').addEventListener('click', closeDrawer);
    scrim.addEventListener('click', closeDrawer);
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !drawer.hidden && window.matchMedia('(max-width: 900px)').matches) closeDrawer(); });
    $$('[data-gd-min]', drawer).forEach(function (b) { b.addEventListener('click', function () { if (current) extend(current.getAttribute('data-guest'), parseInt(b.getAttribute('data-gd-min'), 10), current); }); });
  }
  var cr = $('[data-open-create]'); if (cr) cr.addEventListener('click', function (e) { e.preventDefault(); var i = $('#g-dn'); if (i) { i.scrollIntoView({ block: 'center', behavior: TD.motionOff && TD.motionOff() ? 'auto' : 'smooth' }); i.focus(); } });

  paintRings(); applyFilter();
  setInterval(function () { if (!doc.hidden) { paintRings(); applyFilter(); } }, 30000);
  var want = new URLSearchParams(location.search).get('open');
  var first = want ? $('[data-guest="' + (window.CSS && CSS.escape ? CSS.escape(want) : want) + '"]') : null;
  if (!first && window.matchMedia('(min-width: 901px)').matches) first = $$('[data-guest]').filter(function (c) { return !c.hidden; }).sort(function (a, b) { return (C.parse(a.getAttribute('data-expires')) || 9e15) - (C.parse(b.getAttribute('data-expires')) || 9e15); })[0];
  if (first) { openDrawer(first, true); if (want) first.scrollIntoView({ block: 'center' }); }
  window.TDGuests = { refresh: function () { location.reload(); } };
})();
