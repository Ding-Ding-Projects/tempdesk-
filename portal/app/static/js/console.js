// Control room shell: command bar (also the Ctrl+Shift+F palette), status
// pill popover, account menu, live sparklines and the home page pulse.
// No inline scripts (CSP script-src 'self').
(function () {
  'use strict';
  var doc = document, root = doc.documentElement, TD = window.TD || {};
  var t = TD.t || function (k) { return k; };
  function $(s, c) { return (c || doc).querySelector(s); }
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  function csrf() { var i = $('input[name="csrf_token"]'); return i ? i.value : ''; }
  function motionOff() { return TD.motionOff ? TD.motionOff() : false; }
  function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) { var e = doc.createElementNS(SVGNS, tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }

  // ---------------------------------------------------------- fetch helpers (shared with page scripts)
  function getJSON(url) {
    return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error((j && j.message) || String(r.status)); e.status = r.status; e.body = j; throw e; } return j; });
    });
  }
  function postJSON(url, body) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', body: JSON.stringify(body || {}),
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf(), 'X-Requested-With': 'fetch' } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || j.ok === false) { var e = new Error((j && j.message) || String(r.status)); e.status = r.status; throw e; } return j; }); });
  }
  function postForm(url, fields) {
    var fd = new FormData(); fd.append('csrf_token', csrf());
    Object.keys(fields || {}).forEach(function (k) { var v = fields[k]; if (Array.isArray(v)) v.forEach(function (x) { fd.append(k, x); }); else if (v != null) fd.append(k, v); });
    return fetch(url, { method: 'POST', credentials: 'same-origin', body: fd, headers: { Accept: 'application/json', 'X-Requested-With': 'fetch' } })
      .then(function (r) {
        var ct = r.headers.get('content-type') || '';
        if (ct.indexOf('json') < 0) { if (r.ok || r.redirected) return { ok: true, message: '' }; throw new Error(String(r.status)); }
        return r.json().then(function (j) { if (!r.ok || j.ok === false) throw new Error(j.message || String(r.status)); return j; });
      });
  }
  function undoById(id) {
    var fd = new FormData(); fd.append('csrf_token', csrf()); fd.append('id', id); fd.append('back', location.pathname);
    return fetch('/undo', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'fetch', Accept: 'application/json' } })
      .then(function (r) { return r.json(); }).then(function (j) { TD.toast && TD.toast(j.message, j.ok ? 'success' : 'error'); return j; });
  }
  // A toast with an inline Undo button for actions that went into the journal.
  function toastUndo(text, id, after) {
    TD.toast && TD.toast(text, 'success');
    if (!id) return;
    var box = $('[data-toasts]'); var last = box && box.lastElementChild; if (!last) return;
    var b = el('button', 'btn sm tonal', t('Undo')); b.type = 'button';
    b.addEventListener('click', function () { undoById(id).then(function () { if (after) after(); }); last.remove(); });
    last.insertBefore(b, last.lastElementChild);
  }
  function rel(ms) {
    var a = Math.abs(ms), m = Math.round(a / 60000);
    if (m < 1) return t('now');
    if (m < 60) return m + ' ' + t('min');
    var h = Math.floor(m / 60), mm = m % 60;
    if (h < 24) return h + ' h' + (mm ? ' ' + mm + ' ' + t('min') : '');
    return Math.floor(h / 24) + ' ' + t('d');
  }
  function short(ms) {
    if (ms <= 0) return '0m';
    var m = Math.floor(ms / 60000); if (m < 60) return m + 'm';
    var h = Math.floor(m / 60); if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }
  function timeOf(d) { return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
  function parse(s) { if (!s) return null; var d = new Date(s); return isNaN(d) ? null : d.getTime(); }
  function html(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  // Sparkline: values -> path in a 220x54 box.
  function sparkline(host, values, opts) {
    opts = opts || {};
    var w = 220, h = opts.h || 54, pad = 4;
    host.textContent = '';
    var s = svg('svg', { viewBox: '0 0 ' + w + ' ' + h, preserveAspectRatio: 'none', class: 'sparkline' + (opts.draw && !motionOff() ? ' draw' : ''), 'aria-hidden': 'true' });
    s.style.height = h + 'px';
    var vals = (values || []).filter(function (v) { return typeof v === 'number' && isFinite(v); });
    if (vals.length < 2) vals = vals.length ? [vals[0], vals[0]] : [0, 0];
    var max = opts.max != null ? opts.max : Math.max.apply(null, vals), min = opts.min != null ? opts.min : Math.min(0, Math.min.apply(null, vals));
    if (max === min) max = min + 1;
    var pts = vals.map(function (v, i) { return [(i / (vals.length - 1)) * w, h - pad - ((v - min) / (max - min)) * (h - pad * 2)]; });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    s.appendChild(svg('path', { d: d + ' L' + w + ' ' + h + ' L0 ' + h + 'Z', class: 'ar' }));
    s.appendChild(svg('path', { d: d, class: 'ln' }));
    host.appendChild(s);
  }

  window.TDC = { getJSON: getJSON, postJSON: postJSON, postForm: postForm, undoById: undoById, toastUndo: toastUndo, sparkline: sparkline,
    rel: rel, short: short, timeOf: timeOf, parse: parse, html: html, el: el, svg: svg, csrf: csrf };

  // ---------------------------------------------------------- popovers: HTTP pill, account menu
  function popToggle(btn, pop) {
    if (!btn || !pop) return;
    function close() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); var open = pop.hidden; $$('[data-http-pop], [data-me-menu]').forEach(function (p) { p.hidden = true; }); pop.hidden = !open; btn.setAttribute('aria-expanded', open ? 'true' : 'false'); if (open) { var f = pop.querySelector('button, a, select'); if (f) f.focus(); } });
    doc.addEventListener('click', function (e) { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) close(); });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) { close(); btn.focus(); } });
  }
  popToggle($('[data-http-pill]'), $('[data-http-pop]'));
  popToggle($('[data-me]'), $('[data-me-menu]'));
  (function () { var p = $('[data-http-pop]'); if (!p) return; var r = p.parentElement; if (r && r.getBoundingClientRect().left > window.innerWidth / 2) { p.style.right = '0'; } else { p.style.left = '0'; } })();

  // ---------------------------------------------------------- command bar
  var bar = $('[data-cmdbar]');
  var input = $('[data-cmd-input]'), list = $('[data-cmd-list]');
  var palette = [];
  try { palette = JSON.parse((doc.getElementById('td-palette') || {}).textContent || '[]'); } catch (e) { palette = []; }
  var items = [], active = -1, findTimer = null, findSeq = 0, lastFind = null;

  var DUR = /^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?|w|weeks?)$/i;
  function minutesOf(s) {
    if (!s) return null;
    s = String(s).trim().toLowerCase();
    if (s === 'perm' || s === 'permanent' || s === 'forever') return 0;
    var m = DUR.exec(s); if (!m) return null;
    var n = parseFloat(m[1]), u = m[2][0];
    return Math.round(n * (u === 'm' ? 1 : u === 'h' ? 60 : u === 'd' ? 1440 : 10080));
  }
  function words(mins) { if (mins === 0) return t('Permanent'); if (mins % 1440 === 0) return (mins / 1440) + ' ' + t('Days').toLowerCase(); if (mins % 60 === 0) return (mins / 60) + ' ' + t('Hours').toLowerCase(); return mins + ' ' + t('Minutes').toLowerCase(); }

  // Each command: pattern -> builder of a suggestion {label, desc, run}.
  function parseCommand(q) {
    var out = [], m;
    var s = q.trim();
    if ((m = /^(?:new|create|add)\s+(?:guest|sign-?in)\s*(.*)$/i.exec(s))) {
      var rest = m[1].trim(), parts = rest ? rest.split(/\s+/) : [], mins = null, name = [];
      parts.forEach(function (p) { var x = minutesOf(p); if (x !== null && mins === null) mins = x; else name.push(p); });
      if (mins === null) mins = 240;
      var nm = name.join(' ').replace(/^["']|["']$/g, '');
      out.push({ icon: '+', label: t('Create a guest for {time}', { time: words(mins) }) + (nm ? ' (' + nm + ')' : ''), desc: t('Opens the one-time password page'),
        run: function () { var f = $('[data-cmd-form]'); add(f, 'expiryId', 'custom'); add(f, 'minutes', String(mins)); if (nm) add(f, 'displayName', nm); f.submit(); } });
      return out;
    }
    if ((m = /^extend\s+(\S+)(?:\s+(\S+))?$/i.exec(s))) {
      var who = m[1], mm = minutesOf(m[2] || '1h');
      if (mm === null) mm = 60;
      out.push({ icon: '↻', label: t('Extend {name} by {time}', { name: who, time: words(mm) }), desc: t('You can undo this afterwards.'),
        run: function () { postForm('/guests/' + encodeURIComponent(who) + '/extend', { minutes: String(mm) }).then(function (j) { TD.toast(j.message || t('Saved'), 'success'); if (window.TDGuests) window.TDGuests.refresh(); else if (window.TDHome) window.TDHome.refresh(); }, function (e) { TD.toast(e.message, 'error'); }); } });
      return out;
    }
    if ((m = /^(?:reset\s+password|password)\s+(\S+)$/i.exec(s))) {
      var u = m[1];
      out.push({ icon: '✱', coral: true, label: t('Reset the password of {name}', { name: u }), desc: t('Finds the account and opens the reset dialog'),
        run: function () { resolveUser(u, function (dn) { location.href = '/directory?open=' + encodeURIComponent(dn) + '&do=password'; }); } });
      return out;
    }
    if ((m = /^unlock\s+(\S+)$/i.exec(s))) {
      var u2 = m[1];
      out.push({ icon: '✓', label: t('Unlock {name}', { name: u2 }), desc: t('Clears the lockout so the account can sign in again'),
        run: function () { resolveUser(u2, function (dn) { postJSON('/api/dir/user', { dn: dn, action: 'unlock' }).then(function (j) { TD.toast(t('Account unlocked.') + ' ' + dn, 'success'); }, function (e) { TD.toast(e.message, 'error'); }); }); } });
      return out;
    }
    if ((m = /^(?:disable|enable)\s+(\S+)$/i.exec(s))) {
      var en = /^enable/i.test(s), u3 = m[1];
      out.push({ icon: en ? '✓' : '×', label: (en ? t('Enable') : t('Disable')) + ' ' + u3, desc: t('You can undo this afterwards.'),
        run: function () { resolveUser(u3, function (dn) { postJSON('/api/dir/user', { dn: dn, action: en ? 'enable' : 'disable' }).then(function (j) { toastUndo(t('Saved.') + ' ' + dn, j.undoId); }, function (e) { TD.toast(e.message, 'error'); }); }); } });
      return out;
    }
    if ((m = /^open\s+(?:gpo|policy|group\s+policy)\s+(.+)$/i.exec(s))) {
      var g = m[1].trim();
      out.push({ icon: '◆', label: t('Open the Group Policy object {name}', { name: g }), desc: t('Opens the editor'),
        run: function () { getJSON('/api/console/find?q=' + encodeURIComponent(g)).then(function (r) { var hit = (r.gpos || [])[0]; if (hit) location.href = '/gpo/' + encodeURIComponent(hit.id) + '/edit'; else TD.toast(t('No matches') + ': ' + g, 'error'); }); } });
      return out;
    }
    if ((m = /^(?:find|search)\s+(.+)$/i.exec(s))) {
      var f = m[1].trim();
      out.push({ icon: '⌕', label: t('Find {text} everywhere', { text: f }), desc: t('Guests, directory, policies and pages'), run: function () { location.href = '/find?q=' + encodeURIComponent(f); } });
      return out;
    }
    return out;
  }
  function add(f, name, value) { var i = doc.createElement('input'); i.type = 'hidden'; i.name = name; i.value = value; f.appendChild(i); }
  function resolveUser(name, cb) {
    postJSON('/api/console/resolve', { name: name }).then(function (r) {
      var m = r.matches || [];
      if (!m.length) { TD.toast(t('No account named {name} was found.', { name: name }), 'error'); return; }
      cb(m[0].dn);
    }, function (e) { TD.toast(e.message, 'error'); });
  }
  var TEMPLATES = [
    ['new guest 4h', 'Create a guest sign-in'], ['extend ', 'Extend a guest, for example: extend guest-ab12cd 1h'],
    ['reset password ', 'Reset a password'], ['unlock ', 'Unlock an account'], ['open gpo ', 'Open a Group Policy object'], ['find ', 'Search everything']
  ];
  function score(q, text) {
    q = q.toLowerCase(); var s = text.toLowerCase();
    if (!q) return 1;
    var i = s.indexOf(q); if (i >= 0) return 100 - i + (i === 0 ? 50 : 0);
    // Otherwise every query word must start a word in the text.
    var words = s.split(/[^a-z0-9]+/);
    return q.split(/\s+/).every(function (w) { return words.some(function (x) { return x.indexOf(w) === 0; }); }) ? 20 : 0;
  }
  function build() {
    var q = input.value, qs = q.trim();
    items = [];
    var cmds = qs ? parseCommand(qs) : [];
    cmds.forEach(function (c) { c.group = t('Command'); items.push(c); });
    if (!qs) {
      TEMPLATES.forEach(function (tp) { items.push({ icon: '›', label: tp[0].trim(), desc: t(tp[1]), group: t('Try'), fill: tp[0] }); });
    } else if (!cmds.length) {
      TEMPLATES.forEach(function (tp) { if (tp[0].indexOf(qs.toLowerCase()) === 0 && tp[0] !== qs.toLowerCase()) items.push({ icon: '›', label: tp[0].trim(), desc: t(tp[1]), group: t('Try'), fill: tp[0] }); });
    }
    var pages = palette.map(function (p) { return { p: p, s: score(qs, p.label + ' ' + (p.keywords || '') + ' ' + (p.group || '')) }; })
      .filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s; }).slice(0, qs ? 6 : 4);
    pages.forEach(function (x) { items.push({ icon: '→', label: x.p.label, group: x.p.group || t('Pages'), href: x.p.href, action: x.p.action }); });
    if (qs && lastFind && lastFind.q === qs) {
      (lastFind.r.guests || []).slice(0, 5).forEach(function (g) { items.push({ icon: 'G', label: g.username, desc: g.displayName || '', group: t('Guests'), href: '/guests?open=' + encodeURIComponent(g.username) }); });
      (lastFind.r.objects || []).slice(0, 6).forEach(function (o) { items.push({ icon: 'D', label: o.name, desc: o.dn, group: t('Directory'), href: '/directory?open=' + encodeURIComponent(o.dn) }); });
      (lastFind.r.gpos || []).slice(0, 4).forEach(function (g) { items.push({ icon: 'P', label: g.name, group: t('Group Policy'), href: '/gpo/' + encodeURIComponent(g.id) + '/edit' }); });
    }
    if (qs && !cmds.length) items.push({ icon: '⌕', label: t('Find {text} everywhere', { text: qs }), group: t('Search'), href: '/find?q=' + encodeURIComponent(qs) });
    render();
  }
  function render() {
    list.textContent = '';
    var lastGroup = null;
    items.forEach(function (it, i) {
      if (it.group !== lastGroup) { var hd = el('li', 'cmd-head', it.group); hd.setAttribute('role', 'presentation'); list.appendChild(hd); lastGroup = it.group; }
      var li = el('li'); li.id = 'cmd-o-' + i; li.setAttribute('role', 'option');
      var ic = el('span', 'ico' + (it.coral ? ' coral' : ''), it.icon || '→'); ic.setAttribute('aria-hidden', 'true'); li.appendChild(ic);
      var tx = el('span', 'txt'); tx.appendChild(el('span', null, it.label)); if (it.desc) tx.appendChild(el('div', 'd', it.desc)); li.appendChild(tx);
      li.addEventListener('mousedown', function (e) { e.preventDefault(); choose(i); });
      li.addEventListener('mousemove', function () { setActive(i); });
      list.appendChild(li);
    });
    if (!items.length) { var e = el('li', 'cmd-empty', t('No matches')); e.setAttribute('role', 'presentation'); list.appendChild(e); }
    setActive(items.length ? 0 : -1);
    open(true);
  }
  function setActive(i) {
    active = i;
    $$('[role="option"]', list).forEach(function (li) { li.setAttribute('aria-selected', li.id === 'cmd-o-' + i ? 'true' : 'false'); });
    if (i >= 0) { input.setAttribute('aria-activedescendant', 'cmd-o-' + i); var cur = doc.getElementById('cmd-o-' + i); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' }); }
    else input.removeAttribute('aria-activedescendant');
  }
  function open(on) { list.hidden = !on; input.setAttribute('aria-expanded', on ? 'true' : 'false'); }
  function choose(i) {
    var it = items[i]; if (!it) return;
    if (it.fill) { input.value = it.fill; input.focus(); build(); return; }
    open(false);
    if (it.run) { input.value = ''; it.run(); return; }
    if (it.action === 'theme') { TD.toggleTheme && TD.toggleTheme(); return; }
    if (it.action === 'logout') { var f = $('[data-logout-form]'); if (f) f.submit(); return; }
    if (it.href) location.href = it.href;
  }
  function liveFind() {
    var q = input.value.trim();
    clearTimeout(findTimer);
    if (q.length < 2 || parseCommand(q).length) return;
    var seq = ++findSeq;
    findTimer = setTimeout(function () {
      getJSON('/api/console/find?q=' + encodeURIComponent(q)).then(function (r) { if (seq !== findSeq) return; lastFind = { q: q, r: r }; if (input.value.trim() === q) build(); }, function () { /* ignore */ });
    }, 220);
  }
  if (input && list) {
    if (window.matchMedia('(max-width: 900px)').matches) input.placeholder = t('Command or search');
    input.addEventListener('input', function () { build(); liveFind(); });
    input.addEventListener('focus', function () { build(); });
    input.addEventListener('blur', function () { setTimeout(function () { open(false); }, 120); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) build(); else if (items.length) setActive((active + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) setActive((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0) choose(active); else if (input.value.trim()) location.href = '/find?q=' + encodeURIComponent(input.value.trim()); }
      else if (e.key === 'Escape') { if (!list.hidden) { e.preventDefault(); open(false); } else input.blur(); }
      else if (e.key === 'Tab' && !e.shiftKey && active >= 0 && items[active] && items[active].fill) { e.preventDefault(); choose(active); }
    });
    // Ctrl+Shift+F focuses the command bar (it replaces the palette dialog in the console).
    window.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); e.stopImmediatePropagation(); input.focus(); input.select(); build(); }
    }, true);
    if (window.TDPalette) window.TDPalette.open = function () { input.focus(); build(); };
    $$('[data-cmd-fill]').forEach(function (b) { b.addEventListener('click', function () { input.value = b.getAttribute('data-cmd-fill'); input.focus(); build(); }); });
  }
  void bar;

  // ---------------------------------------------------------- home page pulse
  var home = $('[data-home]');
  if (home) {
    var hist = { cpu: [], active: [] };
    var refresh = function () {
      getJSON('/api/console/pulse').then(function (p) { paintHome(p, hist); }, function () { /* keep the server render */ });
    };
    window.TDHome = { refresh: refresh };
    refresh();
    setInterval(function () { if (!doc.hidden) refresh(); }, 5000);
    var g0 = $('[data-home-guests]'); if (g0) { try { paintTimeline(JSON.parse(g0.textContent)); } catch (e) { /* ignore */ } }
  }
  function activeAt(guests, ts) { return guests.filter(function (g) { var c = parse(g.created) || 0, x = parse(g.expiresAt); return c <= ts && (x === null || x > ts) && g.enabled !== false; }).length; }
  function paintHome(p, hist) {
    var now = Date.now();
    var guests = p.guests || [];
    if (p.guests) {
      var act = guests.filter(function (g) { var x = parse(g.expiresAt); return g.enabled && (x === null || x > now); });
      var soon = act.filter(function (g) { var x = parse(g.expiresAt); return x !== null && x - now <= 3600000; }).sort(function (a, b) { return parse(a.expiresAt) - parse(b.expiresAt); });
      var signed = act.filter(function (g) { return !!g.lastLogon; });
      setText('[data-k="active"]', act.length);
      setText('[data-k="soon"]', soon.length);
      setText('[data-k="signed"]', signed.length);
      setText('[data-k="signed-of"]', '/' + act.length);
      setText('[data-k="headline"]', act.length === 1 ? t('1 person on shared PCs right now') : t('{count} people on shared PCs right now', { count: act.length }));
      setText('[data-k="next"]', soon.length ? t('Next one in {time}', { time: rel(parse(soon[0].expiresAt) - now) }) : t('Nobody ends within the hour'));
      var seg = $('[data-k="segbar"]'); if (seg) { seg.textContent = ''; var n = Math.max(6, Math.min(12, act.length)); for (var i = 0; i < n; i++) seg.appendChild(el('span', i < soon.length ? 'on' : '')); }
      var dg = $('[data-k="dots"]'); if (dg) { dg.textContent = ''; act.slice(0, 27).forEach(function (g) { dg.appendChild(el('span', g.lastLogon ? 'on' : '')); }); if (!act.length) for (var k = 0; k < 9; k++) dg.appendChild(el('span')); }
      var series = []; for (var s = 11; s >= 0; s--) series.push(activeAt(guests, now - s * 30 * 60000));
      var sp = $('[data-k="active-spark"]'); if (sp) sparkline(sp, series, { draw: !sp.dataset.drawn }); if (sp) sp.dataset.drawn = '1';
      var ex = $('[data-extend-soon]'); if (ex) { ex.hidden = !soon.length; ex.onclick = function () { extendAll(soon); }; }
      paintTimeline(guests);
      var ending = $('[data-k="ending-list"]'); if (ending) paintEnding(ending, soon.slice(0, 3));
    }
    var m = p.metrics;
    if (m && typeof m.cpuPercent === 'number') {
      hist.cpu.push(m.cpuPercent); if (hist.cpu.length > 30) hist.cpu.shift();
      setText('[data-k="cpu"]', Math.round(m.cpuPercent));
      var used = Number(m.memoryUsedBytes) || 0, total = Number(m.memoryTotalBytes) || 0;
      var note = total ? t('Memory {used} of {total} GB', { used: (used / 1073741824).toFixed(1), total: (total / 1073741824).toFixed(0) }) : (used ? t('Memory in use {used} GB', { used: (used / 1073741824).toFixed(1) }) : '');
      setText('[data-k="mem-note"]', note);
      var mb = $('[data-k="mem-bar"]'); if (mb && total) mb.style.width = Math.round(100 * used / total) + '%';
      var cs = $('[data-k="cpu-spark"]'); if (cs) sparkline(cs, hist.cpu, { max: 100, min: 0, h: 40 });
    } else if (p.health) {
      setText('[data-k="cpu"]', '-');
      setText('[data-k="mem-note"]', t('Live performance is not available from the agent.'));
    }
    paintActivity(p);
  }
  function setText(sel, v) { $$(sel).forEach(function (e) { e.textContent = String(v); }); }
  function extendAll(list) {
    if (!list.length) return;
    Promise.all(list.map(function (g) { return postForm('/guests/' + encodeURIComponent(g.username) + '/extend', { minutes: '60' }); }))
      .then(function () { TD.toast(t('Extended {count} guests by 1 hour.', { count: list.length }), 'success'); window.TDHome && window.TDHome.refresh(); }, function (e) { TD.toast(e.message, 'error'); });
  }
  function paintEnding(host, soon) {
    host.textContent = '';
    if (!soon.length) { host.appendChild(el('p', 'muted', t('Nobody ends within the hour'))); return; }
    soon.forEach(function (g) {
      var card = el('div', 'tile'); card.style.cssText = 'padding:12px 14px;border-radius:20px;display:flex;align-items:center;gap:12px';
      card.appendChild(ringFor(g, 44));
      var tx = el('div'); tx.style.cssText = 'flex:1;min-width:0';
      var nm = el('div', 'mono', g.username); nm.style.fontWeight = '700'; tx.appendChild(nm);
      tx.appendChild(el('div', 'subtle', g.displayName || t('No name'))); card.appendChild(tx);
      var b = el('button', 'c-chip primary', '+1 h'); b.type = 'button'; b.style.minHeight = '44px';
      b.setAttribute('aria-label', t('Extend {name} by {time}', { name: g.username, time: words(60) }));
      b.addEventListener('click', function () { postForm('/guests/' + encodeURIComponent(g.username) + '/extend', { minutes: '60' }).then(function (j) { TD.toast(j.message, 'success'); window.TDHome.refresh(); }, function (e) { TD.toast(e.message, 'error'); }); });
      card.appendChild(b); host.appendChild(card);
    });
  }
  // Countdown ring used on the home page and the guest cards.
  function ringFor(g, size) {
    var now = Date.now(), x = parse(g.expiresAt), c = parse(g.created) || now;
    var cls = 'ring-sm', label, frac = 1, txt;
    if (x === null) { cls += ' perm'; txt = '∞'; label = t('Permanent'); frac = 0; }
    else if (x <= now) { cls += ' gone'; txt = '0m'; label = t('Expired'); frac = 0; }
    else { var left = x - now; frac = Math.max(0.03, Math.min(1, left / Math.max(1, x - c))); txt = short(left); label = rel(left) + ' ' + t('left'); if (left <= 3600000) cls += ' soon'; }
    var s = svg('svg', { viewBox: '0 0 52 52', class: cls, role: 'img', 'aria-label': label, width: size || 52, height: size || 52 });
    s.appendChild(svg('circle', { cx: 26, cy: 26, r: 22, class: 'trk' }));
    if (x !== null && x > now) s.appendChild(svg('circle', { cx: 26, cy: 26, r: 22, class: 'bar', 'stroke-dasharray': '138', 'stroke-dashoffset': String(Math.round(138 * (1 - frac))), transform: 'rotate(-90 26 26)' }));
    var tx = svg('text', { x: 26, y: x === null ? 32 : 31, 'text-anchor': 'middle' }); tx.textContent = txt; s.appendChild(tx);
    return s;
  }
  window.TDC.ringFor = ringFor; window.TDC.minutesOf = minutesOf; window.TDC.words = words;

  function paintTimeline(guests) {
    var host = $('[data-timeline]'); if (!host) return;
    var now = Date.now(), d0 = new Date(); d0.setHours(7, 0, 0, 0);
    var start = d0.getTime(), end = start + 14 * 3600000;
    if (now < start + 3600000 || now > end - 3600000) { start = now - 5 * 3600000; end = start + 14 * 3600000; }
    var span = end - start;
    var rows = guests.filter(function (g) { var c = parse(g.created) || now, x = parse(g.expiresAt); return c < end && (x === null || x > start); })
      .sort(function (a, b) { return (parse(a.created) || 0) - (parse(b.created) || 0); }).slice(-8);
    host.textContent = '';
    var meta = $('[data-timeline-now]'); if (meta) meta.textContent = t('Now is {time}', { time: timeOf(new Date()) });
    if (!rows.length) { host.appendChild(el('div', 'tl-empty', t('No guest sessions today yet. New sign-ins appear here as bars from creation to expiry.'))); return; }
    var tl = el('div', 'tl');
    rows.forEach(function (g) {
      var r = el('div', 'tl-row');
      var a = el('a', 'who', g.username); a.href = '/guests?open=' + encodeURIComponent(g.username); r.appendChild(a);
      var lane = el('span', 'lane');
      var c = Math.max(start, parse(g.created) || start), x = parse(g.expiresAt), e2 = x === null ? end : Math.min(end, x);
      var b = el('span', 'tl-bar' + (x === null ? ' open' : (x - now <= 3600000 && x > now ? ' soon' : '')));
      b.style.left = (100 * (c - start) / span) + '%'; b.style.width = Math.max(0.6, 100 * (e2 - c) / span) + '%';
      b.title = g.username + ': ' + timeOf(new Date(parse(g.created) || c)) + ' - ' + (x === null ? t('No expiry') : timeOf(new Date(x)));
      lane.appendChild(b);
      if (x !== null && x > now && x - now <= 3600000 && x < end) { var dot = el('span', 'tl-end'); dot.style.left = (100 * (x - start) / span) + '%'; dot.setAttribute('aria-hidden', 'true'); lane.appendChild(dot); }
      r.appendChild(lane); tl.appendChild(r);
    });
    var ax = el('div', 'tl-axis'); ax.appendChild(el('span')); var ticks = el('span', 'ticks');
    for (var i = 0; i <= 4; i++) ticks.appendChild(el('span', null, new Date(start + span * i / 4).toLocaleTimeString(undefined, { hour: 'numeric' })));
    ax.appendChild(ticks); tl.appendChild(ax);
    var nowLine = el('span', 'tl-now'); nowLine.setAttribute('aria-hidden', 'true');
    nowLine.style.left = 'calc(142px + (100% - 142px) * ' + ((now - start) / span).toFixed(4) + ')';
    tl.appendChild(nowLine);
    host.appendChild(tl);
  }
  function paintActivity(p) {
    var host = $('[data-activity]'); if (!host) return;
    var rows = [];
    (p.undo || []).forEach(function (u) { rows.push({ time: (u.time || 0) * 1000, text: u.summary, who: u.user, undo: u.undoable ? u.id : null, kind: /delete|remove/i.test(u.action || '') ? 'neutral' : /create|add/i.test(u.action || '') ? '' : 'coral' }); });
    (p.audit || []).forEach(function (a) { var ts = parse(a.time || a.timeCreated); if (!ts) return; if (rows.some(function (r) { return Math.abs(r.time - ts) < 3000 && r.who === a.user; })) return; rows.push({ time: ts, text: a.message || a.action || '', who: a.user || t('Agent'), kind: /delete|remove|reap/i.test(a.action || a.message || '') ? 'neutral' : /create/i.test(a.action || '') ? '' : 'coral' }); });
    rows.sort(function (a, b) { return b.time - a.time; });
    host.textContent = '';
    if (!rows.length) { var e = el('li'); e.appendChild(el('div', 'muted', t('Agent actions appear here once someone creates a guest or changes a setting.'))); host.appendChild(e); return; }
    rows.slice(0, 5).forEach(function (r) {
      var li = el('li');
      var ic = el('span', 'badge-ic ' + r.kind, r.kind === 'neutral' ? '×' : r.kind === 'coral' ? '✎' : '+'); ic.setAttribute('aria-hidden', 'true'); li.appendChild(ic);
      var d = el('div'); d.style.minWidth = '0'; d.appendChild(el('div', 't1', r.text));
      var t2 = el('div', 't2'); t2.appendChild(el('span', null, (r.who || '') + ' · ' + timeOf(new Date(r.time))));
      if (r.undo) { var b = el('button', 'linkish', t('Undo')); b.type = 'button'; b.addEventListener('click', function () { undoById(r.undo).then(function () { window.TDHome && window.TDHome.refresh(); }); }); t2.appendChild(el('span', null, '·')); t2.appendChild(b); }
      d.appendChild(t2); li.appendChild(d); host.appendChild(li);
    });
  }

  // ---------------------------------------------------------- server area live strip
  var perf = $('[data-perf]');
  if (perf) {
    var ph = { cpu: [], mem: [], net: [] };
    var tick = function () {
      getJSON('/api/console/metrics').then(function (m) {
        if (!m.available) { perf.setAttribute('data-unavailable', '1'); setText('[data-pv="status"]', t('Live performance is not available from the agent.')); return; }
        perf.removeAttribute('data-unavailable'); setText('[data-pv="status"]', '');
        var c = Number(m.cpuPercent) || 0; ph.cpu.push(c);
        var used = Number(m.memoryUsedBytes) || 0, total = Number(m.memoryTotalBytes) || 0; ph.mem.push(used);
        var net = (m.network || []).reduce(function (s, n) { return s + (Number(n.sendBytesPerSec) || 0) + (Number(n.receiveBytesPerSec) || 0); }, 0); ph.net.push(net * 8 / 1e6);
        ['cpu', 'mem', 'net'].forEach(function (k) { if (ph[k].length > 40) ph[k].shift(); });
        setText('[data-pv="cpu"]', Math.round(c) + '%');
        setText('[data-pv="mem"]', (used / 1073741824).toFixed(1));
        setText('[data-pv="mem-total"]', total ? ' / ' + Math.round(total / 1073741824) + ' GB' : ' GB');
        setText('[data-pv="net"]', (net * 8 / 1e6).toFixed(1));
        var s1 = $('[data-ps="cpu"]'), s2 = $('[data-ps="mem"]'), s3 = $('[data-ps="net"]');
        if (s1) sparkline(s1, ph.cpu, { max: 100, min: 0, h: 70, draw: ph.cpu.length === 1 });
        if (s2) sparkline(s2, ph.mem, { min: 0, max: total || undefined, h: 70, draw: ph.mem.length === 1 });
        if (s3) sparkline(s3, ph.net, { min: 0, h: 70, draw: ph.net.length === 1 });
        var d = (m.disks || [])[0];
        if (d && d.usedPercent != null) { setText('[data-pv="disk"]', Math.round(d.usedPercent) + '%'); var mb = $('[data-pv="disk-bar"]'); if (mb) mb.style.width = Math.round(d.usedPercent) + '%'; }
      }, function () { perf.setAttribute('data-unavailable', '1'); setText('[data-pv="status"]', t('Live performance is not available from the agent.')); });
    };
    tick(); setTimeout(tick, 500); setTimeout(tick, 1000); setInterval(function () { if (!doc.hidden) tick(); }, 2000);
  }
})();
