// Desktop host for the website's answer file builder (site/assets/builder.js, bundled unchanged).
// Provides window.TempDeskSite with the same API the website's site.js offers, wired to the
// desktop app's settings (language, theme, motion, text scale, personal wording) and toasts.
// Runs inside a same-origin frame, so it can reach the parent app's bridge (window.parent.td).
(function () {
  'use strict';
  var P = window.parent && window.parent !== window ? window.parent : null;
  var host = (P && P.TempDeskHost) || {};
  var html = document.documentElement;
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  var s = host.settings ? host.settings() : {};
  var prefs = { lang: s.language === 'bilingual' ? 'bi' : (s.language || 'en'), motion: host.motionOff && host.motionOff() ? 'off' : 'full', theme: s.theme || 'dark', size: String((s.textScale || 100) / 100) };
  function apply() {
    if (prefs.theme === 'system') html.removeAttribute('data-theme'); else html.setAttribute('data-theme', prefs.theme);
    html.setAttribute('data-motion', prefs.motion);
    html.style.setProperty('--text-scale', prefs.size);
    html.lang = prefs.lang === 'zh-HK' ? 'zh-HK' : 'en';
    if (s.accent) { html.style.setProperty('--primary', s.accent); }
  }
  apply();
  var dict = { en: {}, 'zh-HK': {} };
  function loadSync(lang) {
    // Synchronous so the module sees strings on its first render (same-origin file in the bundle).
    try { var x = new XMLHttpRequest(); x.open('GET', 'vendor/site-i18n/' + lang + '.json', false); x.send(); if (x.status === 200) dict[lang] = JSON.parse(x.responseText); } catch (e) { dict[lang] = {}; }
  }
  loadSync('en'); loadSync('zh-HK');
  var translator = (host.wording && host.wording()) || function (x) { return x; };
  function fmt(v, args) { return String(v).replace(/\{(\d+)\}/g, function (m, i) { return args && args[i] !== undefined ? args[i] : m; }); }
  function t(key, args, fallback) {
    var lang = prefs.lang === 'zh-HK' ? 'zh-HK' : 'en';
    var v = (dict[lang] && dict[lang][key]) || dict.en[key] || fallback || key;
    return fmt(translator(v), args);
  }
  function tz(key, args) { return dict['zh-HK'][key] ? fmt(translator(dict['zh-HK'][key]), args) : ''; }
  function render(el) {
    var key = el.getAttribute('data-i18n');
    if (!el.hasAttribute('data-i18n-orig')) el.setAttribute('data-i18n-orig', el.textContent);
    var args = el.getAttribute('data-i18n-args'); args = args ? args.split('|') : null;
    var fb = el.getAttribute('data-i18n-orig');
    var en = t(key, args, fb);
    el.textContent = en;
    if (prefs.lang === 'bi') { var zh = tz(key, args); if (zh && zh !== en) { var sub = document.createElement('span'); sub.className = 'bi-sub'; sub.lang = 'zh-HK'; sub.textContent = zh; el.appendChild(sub); } }
  }
  function renderAttrs(el) {
    el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
      var p = pair.split(':'); if (p.length !== 2) return;
      var k = 'data-i18n-orig-' + p[0];
      if (!el.hasAttribute(k)) el.setAttribute(k, el.getAttribute(p[0]) || '');
      el.setAttribute(p[0], t(p[1], null, el.getAttribute(k)));
    });
  }
  function translateAll(root) { root = root || document; root.querySelectorAll('[data-i18n]').forEach(render); root.querySelectorAll('[data-i18n-attr]').forEach(renderAttrs); }
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k]; else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  var lastFocus = null;
  function openSheet(sheet, sel) { lastFocus = document.activeElement; sheet.hidden = false; document.body.style.overflow = 'hidden'; var f = sheet.querySelector(sel || 'button, input, select, textarea'); if (f) f.focus(); }
  function closeSheet(sheet) { sheet.hidden = true; document.body.style.overflow = ''; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function trap(sheet) {
    sheet.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(sheet); }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(sheet.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
  }
  function makeMatcher(q, useRegex) {
    if (!q) return { ok: true, test: function () { return true; } };
    if (useRegex) { try { var re = new RegExp(q, 'i'); return { ok: true, test: function (x) { return re.test(x); } }; } catch (e) { return { ok: false, test: function () { return false; } }; } }
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return { ok: true, test: function (x) { x = x.toLowerCase(); return words.every(function (w) { return x.indexOf(w) >= 0; }); } };
  }
  function pulse(el) { if (!el) return; el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); setTimeout(function () { el.classList.remove('pulse'); }, 2000); }
  function focusTarget(el) {
    document.dispatchEvent(new CustomEvent('td:reveal', { detail: el }));
    var d = el.closest('details'); if (d) d.open = true;
    el.scrollIntoView({ block: 'center' });
    var f = el.matches('input, select, textarea, button, a') ? el : el.querySelector('input, select, textarea, button, a') || el;
    if (!f.matches('input, select, textarea, button, a')) f.setAttribute('tabindex', '-1');
    f.focus({ preventScroll: true }); pulse(f.closest('.field') || f);
  }
  function toast(msg) { if (host.toast) host.toast(msg); }
  var ready = [], paletteSources = [];
  // The studio registers live search sources; the desktop palette (parent window) asks them.
  window.TempDeskStudioPalette = function (q, regex) {
    var out = [];
    paletteSources.forEach(function (src) { try { out = out.concat(src(q, regex) || []); } catch (e) { /* ignore */ } });
    return out;
  };
  window.TempDeskSite = {
    t: t, tz: tz, h: h, ROOT: 'vendor/', LS: LS, prefs: prefs, translateAll: translateAll, render: render, toast: toast, pulse: pulse,
    openSheet: openSheet, closeSheet: closeSheet, trap: trap, makeMatcher: makeMatcher, focusTarget: focusTarget,
    onLang: function (f) { ready.push(f); }, translate: function (x) { return translator(x); },
    addPaletteSource: function (fn) { paletteSources.push(fn); }
  };
  // Any API the website adds later falls back to a no-op instead of breaking the hosted studio.
  if (typeof Proxy === 'function') {
    var real = window.TempDeskSite;
    window.TempDeskSite = new Proxy(real, { get: function (o, k) { if (k in o) return o[k]; if (typeof k === 'string' && P && P.console) P.console.warn('TempDeskSite.' + k + ' is not provided by the desktop host'); return function () { return undefined; }; } });
  }
  // Electron has no window.prompt. Use the default value so "save version" still works with an
  // automatic name; the desktop History page offers named versions through its own dialog.
  window.prompt = function (msg, def) { return def === undefined ? null : String(def); };
  document.addEventListener('DOMContentLoaded', function () { translateAll(); });
  // The parent app tells the frame when language, theme or wording change.
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'td:settings') return;
    s = host.settings ? host.settings() : s;
    prefs.lang = s.language === 'bilingual' ? 'bi' : (s.language || 'en');
    prefs.theme = s.theme; prefs.size = String((s.textScale || 100) / 100); prefs.motion = host.motionOff && host.motionOff() ? 'off' : 'full';
    translator = (host.wording && host.wording()) || function (x) { return x; };
    apply(); translateAll(); ready.forEach(function (f) { try { f(); } catch (err) { /* ignore */ } });
  });
  // Global shortcuts that belong to the app (palette) are forwarded to the parent.
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f') && host.palette) { e.preventDefault(); host.palette(); }
  });
})();
