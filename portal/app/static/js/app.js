// Shared behaviour for both portals. No inline scripts (CSP: script-src 'self').
(function () {
  'use strict';
  var doc = document, root = doc.documentElement;
  var S = {};
  try { S = JSON.parse((doc.getElementById('td-strings') || {}).textContent || '{}'); } catch (e) { S = {}; }
  function t(key, args) {
    var s = S[key] || key;
    if (args) Object.keys(args).forEach(function (k) { s = s.split('{' + k + '}').join(String(args[k])); });
    return s;
  }
  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  function motionOff() {
    var m = root.getAttribute('data-motion');
    if (m === 'off' || m === 'reduced') return true;
    if (m === 'full') return false;
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function $(sel, ctx) { return (ctx || doc).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || doc).querySelectorAll(sel)); }

  // ---------------------------------------------------------- notifications and toasts
  var NKEY = 'td.notifications';
  function loadN() { try { return JSON.parse(store.get(NKEY) || '[]'); } catch (e) { return []; } }
  function saveN(list) { store.set(NKEY, JSON.stringify(list.slice(-100))); renderBell(); }
  function toast(text, kind) {
    var box = $('[data-toasts]');
    if (!box || !text) return;
    var el = doc.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    var span = doc.createElement('span'); span.textContent = text; span.style.flex = '1';
    var close = doc.createElement('button'); close.type = 'button'; close.className = 'btn sm text'; close.textContent = t('Close');
    close.addEventListener('click', function () { dismiss(); });
    el.appendChild(span); el.appendChild(close);
    box.appendChild(el);
    var list = loadN(); list.push({ text: text, kind: kind || 'info', time: Date.now(), read: false }); saveN(list);
    var timer = setTimeout(dismiss, kind === 'error' ? 9000 : 5000);
    function dismiss() {
      clearTimeout(timer);
      if (motionOff()) { el.remove(); return; }
      el.classList.add('leaving');
      setTimeout(function () { el.remove(); }, 300);
    }
  }
  window.TD = { t: t, store: store, toast: toast, motionOff: motionOff };
  function renderBell() {
    var badge = $('[data-bell-count]'), listEl = $('[data-notif-list]');
    var list = loadN();
    var unread = list.filter(function (n) { return !n.read; }).length;
    if (badge) { badge.hidden = unread === 0; badge.textContent = String(unread); }
    if (listEl) {
      listEl.textContent = '';
      if (!list.length) { var li = doc.createElement('li'); li.className = 'muted'; li.textContent = t('No notifications yet'); listEl.appendChild(li); }
      list.slice().reverse().forEach(function (n) {
        var li = doc.createElement('li'); if (!n.read) li.className = 'unread';
        var d = doc.createElement('div'); d.textContent = n.text;
        var tm = doc.createElement('div'); tm.className = 'subtle'; tm.textContent = new Date(n.time).toLocaleString();
        li.appendChild(d); li.appendChild(tm); listEl.appendChild(li);
      });
    }
  }

  // Flash messages from the server become toasts and enter the notification history.
  $$('[data-notify]').forEach(function (el) { toast(el.textContent.trim(), el.getAttribute('data-notify')); });

  // ---------------------------------------------------------- theme
  function setTheme(next) {
    if (next === 'system') { root.removeAttribute('data-theme'); store.del('td.theme'); }
    else { root.setAttribute('data-theme', next); store.set('td.theme', next); }
  }
  function toggleTheme() {
    var cur = root.getAttribute('data-theme');
    if (!cur) cur = 'dark'; // dark is the default on every OS; light only when picked
    var next = cur === 'dark' ? 'light' : 'dark';
    var run = function () { setTheme(next); };
    if (doc.startViewTransition && !motionOff()) doc.startViewTransition(run); else run();
  }
  $$('[data-theme-toggle]').forEach(function (b) { b.addEventListener('click', toggleTheme); });
  window.TD.toggleTheme = toggleTheme;
  window.TD.setTheme = setTheme;

  // ---------------------------------------------------------- generic controls
  doc.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-print]'); if (el) { window.print(); return; }
    el = ev.target.closest('[data-reload]'); if (el) { window.location.reload(); return; }
    el = ev.target.closest('[data-copy]');
    if (el) {
      var src = $(el.getAttribute('data-copy'));
      var attr = el.getAttribute('data-copy-attr');
      var text = src ? (attr ? src.getAttribute(attr) : src.textContent) : '';
      copyText(text.trim()).then(function () { toast(t('Copied'), 'success'); }, function () { toast(t('Copy failed'), 'error'); });
      return;
    }
    el = ev.target.closest('[data-toggle-secret]');
    if (el) {
      var sec = $(el.getAttribute('data-toggle-secret'));
      var hidden = el.getAttribute('aria-pressed') === 'true';
      if (hidden) { sec.textContent = sec.getAttribute('data-secret'); sec.classList.remove('masked'); el.textContent = t('Hide'); el.setAttribute('aria-pressed', 'false'); }
      else { sec.textContent = '•'.repeat(sec.getAttribute('data-secret').length); sec.classList.add('masked'); el.textContent = t('Show'); el.setAttribute('aria-pressed', 'true'); }
      return;
    }
    el = ev.target.closest('[data-open-dialog]');
    if (el) { ev.preventDefault(); var d = $(el.getAttribute('data-open-dialog')); if (d && d.showModal) d.showModal(); return; }
    el = ev.target.closest('[data-close]');
    if (el) { var dl = el.closest('dialog'); if (dl) dl.close(); return; }
    el = ev.target.closest('[data-dismiss]');
    if (el) { var b = el.closest('[data-dismiss-key]'); if (b) { b.hidden = true; try { window.sessionStorage.setItem(b.getAttribute('data-dismiss-key'), '1'); } catch (e) { /* ignore */ } } return; }
    el = ev.target.closest('[data-info]');
    if (el) { showPopover(el); return; }
    el = ev.target.closest('[data-remove-row]');
    if (el) { var row = el.closest('[data-row]'); if (row) row.remove(); return; }
    el = ev.target.closest('[data-add-template-row]');
    if (el) {
      var fs = el.closest('fieldset, [data-list-editor], .field');
      var tpl = fs && fs.querySelector('template[data-row-template]');
      if (tpl) { fs.querySelector('[data-rows]').appendChild(tpl.content.cloneNode(true)); }
      return;
    }
    el = ev.target.closest('[data-add-row]');
    if (el) {
      var ed = el.closest('[data-list-editor]'), name = ed.getAttribute('data-name');
      var r = doc.createElement('div'); r.className = 'cluster'; r.setAttribute('data-row', '');
      if (el.getAttribute('data-add-row') === 'named') {
        var n = doc.createElement('input'); n.name = name + '_name'; n.placeholder = 'Name'; n.setAttribute('aria-label', 'Name'); n.style.flex = '1 1 140px'; r.appendChild(n);
      }
      var v = doc.createElement('input'); v.name = name; v.setAttribute('aria-label', 'Value'); v.style.flex = '1 1 200px'; r.appendChild(v);
      var rm = doc.createElement('button'); rm.type = 'button'; rm.className = 'btn sm text'; rm.setAttribute('data-remove-row', ''); rm.textContent = t('Remove'); r.appendChild(rm);
      ed.querySelector('[data-rows]').appendChild(r); v.focus();
      return;
    }
    el = ev.target.closest('[data-toggle-children]');
    if (el) {
      var ul = el.closest('li').querySelector(':scope > ul');
      var open = el.getAttribute('aria-expanded') === 'true';
      el.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (ul) ul.hidden = open;
      return;
    }
    el = ev.target.closest('[data-download-json]');
    if (el) {
      ev.preventDefault();
      var srcj = $(el.getAttribute('data-download-json'));
      if (srcj) downloadText(srcj.textContent, 'output.json', 'application/json');
    }
  });
  $$('[data-dismiss-key]').forEach(function (b) { try { if (window.sessionStorage.getItem(b.getAttribute('data-dismiss-key'))) b.hidden = true; } catch (e) { /* ignore */ } });
  $$('[data-autosubmit]').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); });
  $$('[data-autosubmit-change]').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); s.addEventListener('input', function () { var o = s.parentNode.querySelector('output'); if (o) o.textContent = s.value; }); });
  $$('[data-custom-toggle]').forEach(function (s) {
    var target = $(s.getAttribute('data-custom-toggle'));
    function upd() { if (target) target.hidden = s.value !== 'custom'; }
    s.addEventListener('change', upd); upd();
  });
  $$('textarea[data-tab-indent]').forEach(function (ta) {
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && ta.getAttribute('data-tab-mode') === 'indent') {
        e.preventDefault(); var s = ta.selectionStart; ta.setRangeText('    ', s, ta.selectionEnd, 'end');
      }
      if (e.key === 'Escape') ta.removeAttribute('data-tab-mode');
    });
    ta.addEventListener('focus', function () { ta.setAttribute('data-tab-mode', 'indent'); });
  });

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = doc.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      doc.body.appendChild(ta); ta.select();
      var ok = false; try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove(); ok ? resolve() : reject();
    });
  }
  function downloadText(text, name, type) {
    var a = doc.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' })); a.download = name;
    doc.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  window.TD.copyText = copyText; window.TD.downloadText = downloadText;

  // Info popovers
  var pop = null;
  function showPopover(btn) {
    if (pop) { pop.remove(); if (pop._for === btn) { pop = null; btn.setAttribute('aria-expanded', 'false'); return; } }
    pop = doc.createElement('div'); pop.className = 'popover'; pop.setAttribute('role', 'tooltip'); pop.id = 'pop-' + Date.now();
    pop.textContent = btn.getAttribute('data-info'); pop._for = btn;
    doc.body.appendChild(pop);
    var r = btn.getBoundingClientRect();
    var left = Math.min(window.scrollX + r.left, window.scrollX + doc.documentElement.clientWidth - pop.offsetWidth - 16);
    pop.style.left = Math.max(16, left) + 'px'; pop.style.top = (window.scrollY + r.bottom + 8) + 'px';
    btn.setAttribute('aria-describedby', pop.id); btn.setAttribute('aria-expanded', 'true');
  }
  doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && pop) { pop.remove(); pop = null; } });
  doc.addEventListener('click', function (e) { if (pop && !e.target.closest('[data-info]') && !e.target.closest('.popover')) { pop.remove(); pop = null; } });

  // Ripple on press
  doc.addEventListener('pointerdown', function (e) {
    var b = e.target.closest('.btn'); if (!b || motionOff() || b.disabled) return;
    var r = b.getBoundingClientRect(), size = Math.max(r.width, r.height);
    var s = doc.createElement('span'); s.className = 'ripple';
    s.style.width = s.style.height = size + 'px'; s.style.left = (e.clientX - r.left - size / 2) + 'px'; s.style.top = (e.clientY - r.top - size / 2) + 'px';
    b.appendChild(s); setTimeout(function () { s.remove(); }, 600);
  });

  // ---------------------------------------------------------- times and countdowns
  $$('time[data-local-time]').forEach(function (el) {
    var d = new Date(el.getAttribute('datetime')); if (isNaN(d)) return;
    el.textContent = d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    el.title = d.toISOString();
  });
  $$('time[data-epoch]').forEach(function (el) {
    var d = new Date(parseFloat(el.getAttribute('data-epoch')) * 1000); if (!isNaN(d)) el.textContent = d.toLocaleString();
  });
  function words(ms) {
    if (ms <= 0) return t('Expired');
    var m = Math.floor(ms / 60000), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    var parts = [];
    if (d) parts.push(d + ' ' + t('Days').toLowerCase());
    if (h) parts.push(h + ' ' + t('Hours').toLowerCase());
    if (!d) parts.push(mm + ' ' + t('Minutes').toLowerCase());
    return parts.join(' ');
  }
  var ring = $('[data-countdown]');
  if (ring) {
    var end = new Date(ring.getAttribute('data-countdown')).getTime(), start = Date.now(), total = Math.max(1, end - start);
    var bar = ring.querySelector('.bar'), txt = ring.querySelector('[data-countdown-text]'), w = $('[data-countdown-words]');
    var lastWords = '';
    var tick = function () {
      var left = end - Date.now();
      var h = Math.max(0, Math.floor(left / 3600000)), m = Math.max(0, Math.floor((left % 3600000) / 60000)), s = Math.max(0, Math.floor((left % 60000) / 1000));
      txt.textContent = left <= 0 ? '0:00' : (h >= 24 ? Math.floor(h / 24) + 'd ' + (h % 24) + 'h' : h + ':' + String(m).padStart(2, '0') + (h === 0 ? ':' + String(s).padStart(2, '0') : ''));
      bar.setAttribute('stroke-dashoffset', String(302 * (1 - Math.max(0, left) / total)));
      var ww = words(left);
      if (w && ww !== lastWords) { w.textContent = ww; lastWords = ww; ring.setAttribute('aria-label', ww); }
    };
    tick(); setInterval(tick, 1000);
  }
  $$('[data-countdown-words-for]').forEach(function (el) {
    var end = new Date(el.getAttribute('data-countdown-words-for')).getTime();
    var f = function () { el.textContent = words(end - Date.now()); }; f(); setInterval(f, 30000);
  });

  // Dashboard number roll-up
  $$('[data-rollup]').forEach(function (el) {
    var target = parseInt(el.getAttribute('data-rollup'), 10);
    if (isNaN(target) || motionOff() || target === 0) return;
    var t0 = performance.now(), dur = 700;
    function step(now) { var p = Math.min(1, (now - t0) / dur); el.textContent = String(Math.round(target * (1 - Math.pow(1 - p, 3)))); if (p < 1) requestAnimationFrame(step); }
    requestAnimationFrame(step);
  });

  // ---------------------------------------------------------- regex search boxes
  function regexBox(form) {
    var input = form.querySelector('[data-regex-input]'), flag = form.querySelector('[data-regex-flag]');
    var toggle = form.querySelector('[data-regex-toggle]'), status = form.querySelector('[data-regex-status]');
    var builder = form.querySelector('[data-regex-builder]');
    var targetSel = form.getAttribute('data-local-filter');
    if (!input || !toggle) return;
    function rows() {
      if (targetSel) return $$('[data-filter-text]', $(targetSel));
      var card = form.closest('.card'); return card ? $$('tbody tr', card) : [];
    }
    function update() {
      var on = toggle.getAttribute('aria-pressed') === 'true';
      if (flag) flag.value = on ? '1' : '';
      if (builder) builder.hidden = !on;
      var q = input.value;
      if (!on) {
        if (targetSel) { var n = 0; rows().forEach(function (r) { var m = !q || r.getAttribute('data-filter-text').toLowerCase().indexOf(q.toLowerCase()) >= 0; r.hidden = !m; if (m) n++; }); if (status) status.textContent = q ? t('{count} matches', { count: n }) : ''; }
        else if (status && !status.querySelector('.error-text')) status.textContent = '';
        input.removeAttribute('aria-invalid');
        return;
      }
      var re;
      try { re = new RegExp(q, 'i'); } catch (e) {
        input.setAttribute('aria-invalid', 'true');
        if (status) { status.textContent = ''; var sp = doc.createElement('span'); sp.className = 'error-text'; sp.textContent = t('Invalid pattern') + ': ' + e.message; status.appendChild(sp); }
        return;
      }
      input.removeAttribute('aria-invalid');
      var count = 0;
      rows().forEach(function (r) {
        var text = targetSel ? r.getAttribute('data-filter-text') : r.textContent;
        var m = !q || re.test(text); if (m) count++;
        if (targetSel) r.hidden = !m;
      });
      if (status) status.textContent = q ? t('{count} matches', { count: count }) : '';
    }
    toggle.addEventListener('click', function () { toggle.setAttribute('aria-pressed', toggle.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); update(); input.focus(); });
    input.addEventListener('input', update);
    form.addEventListener('submit', function (e) { if (input.getAttribute('aria-invalid') === 'true') { e.preventDefault(); input.focus(); } if (targetSel && toggle.getAttribute('aria-pressed') === 'true') { e.preventDefault(); } });
    if (builder) builder.addEventListener('click', function () { openBuilder(input, update); });
    update();
  }
  $$('[data-regex-form], [data-local-filter]').forEach(regexBox);

  var TOKENS = [['^', 'Starts with'], ['$', 'Ends with'], ['.*', 'Anything'], ['\\d+', 'Digits'], ['[a-z]+', 'Letters'], ['\\s', 'Space'], ['(a|b)', 'Either'], ['\\.', 'Literal dot'], ['?', 'Optional'], ['{2,4}', '2 to 4 times']];
  function openBuilder(input, update) {
    var d = doc.createElement('dialog'); d.setAttribute('aria-label', 'Regex builder');
    var h = doc.createElement('h2'); h.textContent = 'Regex builder'; d.appendChild(h);
    var grid = doc.createElement('div'); grid.className = 'cluster';
    TOKENS.forEach(function (tk) {
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'btn sm tonal';
      var code = doc.createElement('code'); code.textContent = tk[0]; b.appendChild(code); b.appendChild(doc.createTextNode(' ' + tk[1]));
      b.addEventListener('click', function () { var s = input.selectionStart || input.value.length; input.setRangeText(tk[0], s, input.selectionEnd || s, 'end'); update(); });
      grid.appendChild(b);
    });
    d.appendChild(grid);
    var c = doc.createElement('button'); c.type = 'button'; c.className = 'btn filled'; c.style.marginTop = '16px'; c.textContent = t('Close');
    c.addEventListener('click', function () { d.close(); }); d.appendChild(c);
    d.addEventListener('close', function () { d.remove(); input.focus(); });
    doc.body.appendChild(d); d.showModal();
  }

  // ---------------------------------------------------------- bulk selection
  $$('[data-bulk-form]').forEach(function (form) {
    var bar = form.querySelector('[data-bulkbar]'), count = form.querySelector('[data-bulk-count]');
    var all = form.querySelector('[data-select-all]');
    function boxes() { return $$('input[name="sel"]', form).filter(function (b) { return !b.closest('tr') || !b.closest('tr').hidden; }); }
    function upd() {
      var n = boxes().filter(function (b) { return b.checked; }).length;
      if (count) count.textContent = String(n);
      if (bar) bar.classList.toggle('show', n > 0);
      $$('input[name="sel"]', form).forEach(function (b) { var tr = b.closest('tr'); if (tr) tr.setAttribute('aria-selected', b.checked ? 'true' : 'false'); });
    }
    if (all) all.addEventListener('change', function () { boxes().forEach(function (b) { b.checked = all.checked; }); upd(); });
    form.addEventListener('change', function (e) { if (e.target.name === 'sel') upd(); });
    upd();
  });

  // ---------------------------------------------------------- two-key super confirmation
  $$('[data-super-confirm]').forEach(function (box) {
    var input = box.querySelector('[data-expect]'), btn = box.querySelector('[data-hold]'), tok = box.querySelector('[data-token]');
    var timer = null, armed = false;
    function match() { return input.value.trim() === input.getAttribute('data-expect'); }
    input.addEventListener('input', function () { btn.disabled = !match(); armed = false; tok.value = ''; });
    function start(e) {
      if (!match() || armed) return;
      if (e) e.preventDefault();
      btn.classList.add('holding');
      btn.lastElementChild.dataset.label = btn.lastElementChild.dataset.label || btn.lastElementChild.textContent;
      btn.lastElementChild.textContent = t('Keep holding');
      timer = setTimeout(function () {
        armed = true; tok.value = tok.getAttribute('data-token'); btn.classList.remove('holding');
        btn.lastElementChild.textContent = t('Confirmed');
        btn.form.requestSubmit ? btn.form.requestSubmit() : btn.form.submit();
      }, 1500);
    }
    function stop() { if (armed) return; clearTimeout(timer); btn.classList.remove('holding'); if (btn.lastElementChild.dataset.label) btn.lastElementChild.textContent = btn.lastElementChild.dataset.label; }
    btn.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { btn.addEventListener(ev, stop); });
    btn.addEventListener('keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(e); else if (e.key === 'Enter' || e.key === ' ') e.preventDefault(); });
    btn.addEventListener('keyup', function (e) { if (e.key === 'Enter' || e.key === ' ') stop(); });
    btn.form.addEventListener('submit', function (e) {
      if (e.submitter && e.submitter !== btn && !box.contains(e.submitter)) {
        if (e.submitter.getAttribute('data-bulk-apply') !== null) {
          var sel = btn.form.querySelector('select[name="bulk"]');
          if (!sel || sel.value !== 'delete') return;
        } else return;
      }
      if (!armed) { e.preventDefault(); input.focus(); }
    });
    btn.addEventListener('click', function (e) { if (!armed) e.preventDefault(); });
  });

  // ---------------------------------------------------------- context menu (right click, Shift+F10, menu key)
  var menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  var CTX_SEL = '[data-ctx], tbody tr, .card, .srv-card';
  function autoItems(target) {
    // Without an explicit list, offer the item's own links and buttons, then Copy text.
    var seen = {}, items = [];
    Array.prototype.forEach.call(target.querySelectorAll('a[href], button'), function (el) {
      if (el.closest('dialog') || el.disabled || el.hidden || el.offsetParent === null && el.tagName !== 'A') return;
      if (el.closest('[data-ctx-skip]') || el.matches('.info-btn, [data-remove-row], [data-chip-remove]')) return;
      var owner = el.parentElement && el.parentElement.closest(CTX_SEL);
      if (owner && owner !== target) return;  // belongs to a nested row or card
      var label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!label || seen[label]) return; seen[label] = true;
      items.push({ label: label, el: el, key: el.getAttribute('aria-keyshortcuts') || '' });
    });
    items.push({ label: t('Copy'), copy: true });
    return items;
  }
  function openMenu(target, x, y) {
    var items = null, raw = target.getAttribute('data-ctx');
    if (raw) { try { items = JSON.parse(raw); } catch (e) { items = null; } }
    if (!items || !items.length) items = autoItems(target);
    closeMenu();
    menu = doc.createElement('div'); menu.className = 'ctx-menu'; menu.setAttribute('role', 'menu');
    items.forEach(function (it) {
      var el = it.href ? doc.createElement('a') : doc.createElement('button');
      if (it.href) el.href = it.href; else el.type = 'button';
      el.setAttribute('role', 'menuitem'); el.tabIndex = -1;
      var l = doc.createElement('span'); l.textContent = it.label; el.appendChild(l);
      if (it.key) { var k = doc.createElement('kbd'); k.textContent = it.key; el.appendChild(k); }
      el.addEventListener('click', function (ev) {
        if (it.tab && window.TDTabs) { ev.preventDefault(); window.TDTabs.open(it.href, it.label); window.location.href = it.href; }
        if (it.focus) { ev.preventDefault(); var f = $(it.focus); if (f) { f.focus(); f.click(); } }
        if (it.el) { ev.preventDefault(); closeMenu(); it.el.focus(); it.el.click(); return; }
        if (it.copy) { ev.preventDefault(); copyText(target.innerText.replace(/\s+\n/g, '\n').trim()).then(function () { toast(t('Copied'), 'success'); }, function () { toast(t('Copy failed'), 'error'); }); }
        closeMenu();
      });
      menu.appendChild(el);
    });
    doc.body.appendChild(menu);
    var w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
    var first = menu.querySelector('[role="menuitem"]'); if (first) first.focus();
    menu.addEventListener('keydown', function (e) {
      var list = $$('[role="menuitem"]', menu), i = list.indexOf(doc.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
      else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); if (target.focus) target.focus(); }
    });
  }
  $$(CTX_SEL).forEach(function (el) {
    if (el.closest('thead')) return;
    if (!el.hasAttribute('tabindex') && el.tagName === 'TR') el.tabIndex = 0;
    if (!el.hasAttribute('aria-keyshortcuts')) el.setAttribute('aria-keyshortcuts', 'Shift+F10');
  });
  doc.addEventListener('contextmenu', function (e) {
    var tgt = e.target.closest(CTX_SEL); if (!tgt || tgt.closest('thead') || e.target.closest('input, textarea, select')) return;
    e.preventDefault(); openMenu(tgt, e.clientX, e.clientY);
  });
  doc.addEventListener('keydown', function (e) {
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') {
      var tgt = doc.activeElement && doc.activeElement.closest && doc.activeElement.closest(CTX_SEL);
      if (tgt) { e.preventDefault(); var r = tgt.getBoundingClientRect(); openMenu(tgt, r.left + 24, r.top + Math.min(r.height, 40)); }
    }
    if (e.key === 'Enter' && doc.activeElement && doc.activeElement.tagName === 'TR') {
      var a = doc.activeElement.querySelector('a[href]'); if (a) a.click();
    }
  });
  doc.addEventListener('click', function (e) { if (menu && !e.target.closest('.ctx-menu')) closeMenu(); });
  window.addEventListener('scroll', closeMenu, { passive: true });

  // ---------------------------------------------------------- display preferences on the settings page
  $$('[data-pref]').forEach(function (el) {
    var name = el.getAttribute('data-pref'), key = 'td.' + name, saved = store.get(key);
    if (el.type === 'checkbox') el.checked = saved === el.value;
    else if (saved !== null && name !== 'theme') el.value = saved;
    else if (name === 'theme') el.value = saved || 'system';
    else if (name === 'motion') el.value = saved || 'system';
    var out = $('[data-out-for="' + el.id + '"]'); if (out) out.textContent = el.value + '%';
    el.addEventListener('input', function () {
      var v = el.type === 'checkbox' ? (el.checked ? el.value : '') : el.value;
      if (out) out.textContent = el.value + '%';
      if (name === 'theme') { setTheme(v); return; }
      if (v === '' || v === 'system') store.del(key); else store.set(key, v);
      if (name === 'motion') { if (v === 'system') root.removeAttribute('data-motion'); else root.setAttribute('data-motion', v); }
      if (name === 'text') root.style.setProperty('--text-scale', String(v / 100));
      if (name === 'radius') root.style.setProperty('--radius-scale', String(v / 100));
      if (name === 'density') { if (v === 'compact') root.setAttribute('data-density', 'compact'); else root.removeAttribute('data-density'); }
      if (name === 'contrast') { if (v) root.setAttribute('data-contrast', 'high'); else root.removeAttribute('data-contrast'); }
      if (name === 'focus') { if (v) root.setAttribute('data-focus', 'always'); else root.removeAttribute('data-focus'); }
      if (name === 'accent') { applyAccent(v); return; }
      toast(t('Saved in this browser'), 'success');
    });
  });
  function applyAccent(v) {
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
    root.style.setProperty('--primary', v); root.style.setProperty('--primary-hover', v);
  }
  var accReset = $('[data-accent-reset]');
  if (accReset) accReset.addEventListener('click', function () {
    store.del('td.accent'); root.style.removeProperty('--primary'); root.style.removeProperty('--primary-hover');
    var cp = $('[data-colorpicker]'); var def = getComputedStyle(root).getPropertyValue('--primary').trim() || '#7CF3E6';
    if (cp && cp.setColor) cp.setColor(def); store.del('td.accent'); root.style.removeProperty('--primary'); root.style.removeProperty('--primary-hover');
  });

  // Settings search
  var ss = $('[data-settings-search]');
  if (ss) {
    var cnt = $('[data-settings-count]');
    var run = function () {
      var q = ss.value.trim().toLowerCase(), shown = 0;
      $$('[data-setting]').forEach(function (f) {
        if (f.matches('[data-setting-section]')) return;
        var m = !q || (f.getAttribute('data-setting') + ' ' + f.textContent).toLowerCase().indexOf(q) >= 0;
        f.hidden = !m; if (m) shown++;
      });
      $$('[data-setting-section]').forEach(function (sec) {
        var own = (sec.getAttribute('data-setting') || '').toLowerCase().indexOf(q) >= 0;
        var anyChild = $$('[data-setting]', sec).some(function (f) { return !f.hidden; });
        var fields = $$('[data-setting]', sec);
        if (own && q) fields.forEach(function (f) { f.hidden = false; });
        sec.hidden = q && !own && !anyChild && (fields.length > 0 || !(sec.textContent.toLowerCase().indexOf(q) >= 0));
      });
      if (cnt) cnt.textContent = q ? t('{count} matches', { count: shown }) : '';
    };
    ss.addEventListener('input', run);
    var hq = new URLSearchParams(window.location.search).get('find'); if (hq) { ss.value = hq; run(); }
  }

  // School mode: a convenience lock kept in this browser, verified with a SHA-256 hash of the PIN.
  function sha(text) {
    if (!window.crypto || !crypto.subtle) return Promise.resolve(text);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode('tempdesk-school:' + text)).then(function (b) {
      return Array.prototype.map.call(new Uint8Array(b), function (x) { return x.toString(16).padStart(2, '0'); }).join('');
    });
  }
  function setCookie(name, value) { doc.cookie = name + '=' + value + '; path=/; SameSite=Strict; max-age=' + (value ? 31536000 : 0); }
  $$('[data-school]').forEach(function (b) {
    b.addEventListener('click', function () {
      var pin = ($('#school-pin') || {}).value || '';
      var want = b.getAttribute('data-school');
      if (want === 'on') {
        if (pin.length < 4) { toast(t('Set a PIN first'), 'error'); return; }
        sha(pin).then(function (h) { store.set('td.schoolPin', h); setCookie('td_school', '1'); toast(t('School mode is on'), 'success'); setTimeout(function () { location.reload(); }, 400); });
      } else {
        var saved = store.get('td.schoolPin');
        sha(pin).then(function (h) {
          if (saved && saved !== h) { toast(t('Wrong PIN'), 'error'); return; }
          store.del('td.schoolPin'); setCookie('td_school', ''); toast(t('School mode is off'), 'success'); setTimeout(function () { location.reload(); }, 400);
        });
      }
    });
  });
  var sname = $('[data-school-name]');
  if (sname) { sname.value = store.get('td.schoolName') || ''; sname.addEventListener('change', function () { store.set('td.schoolName', sname.value.trim().slice(0, 40)); }); }

  // Chip lists for user rights
  $$('[data-chips]').forEach(function (box) {
    var input = box.querySelector('[data-chip-value]'), list = box.querySelector('[data-chip-list]');
    function sync() { input.value = $$('.chip', list).map(function (c) { return c.firstChild.textContent.trim(); }).join(','); }
    list.addEventListener('click', function (e) { if (e.target.closest('[data-chip-remove]')) { e.target.closest('.chip').remove(); sync(); } });
    input.addEventListener('change', function () {
      list.textContent = '';
      input.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (v) {
        var c = doc.createElement('span'); c.className = 'chip'; c.appendChild(doc.createTextNode(v));
        var x = doc.createElement('button'); x.type = 'button'; x.setAttribute('data-chip-remove', ''); x.setAttribute('aria-label', t('Remove') + ' ' + v); x.textContent = '×'; c.appendChild(x);
        list.appendChild(c);
      });
    });
  });

  // ADMX: enable options only when the state is Enabled
  $$('[data-admx-state]').forEach(function (r) {
    r.addEventListener('change', function () { var fs = $('[data-admx-options]'); if (fs) fs.disabled = r.value !== 'Enabled'; });
  });

  // Attribute editor prefill
  $$('[data-fill-attr]').forEach(function (b) {
    b.addEventListener('click', function () {
      var a = $('#attr'), v = $('#vals'); if (!a) return;
      a.value = b.getAttribute('data-fill-attr'); v.value = b.getAttribute('data-fill-values') || '';
      var ed = $('#attr-editor'); if (ed) ed.scrollIntoView({ behavior: motionOff() ? 'auto' : 'smooth', block: 'center' });
      v.focus();
    });
  });

  renderBell();
})();
