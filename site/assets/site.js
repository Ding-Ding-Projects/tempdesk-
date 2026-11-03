// TempDesk website shell: settings (language, motion, theme, text size, personal wording),
// i18n for elements marked data-i18n, the Ctrl+Shift+F command palette and small helpers.
// Everything stays in this browser. Nothing is uploaded.
(function () {
  'use strict';
  var ROOT = (document.querySelector('meta[name="td-root"]') || { content: './' }).content || './';
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  var prefs = {
    lang: LS.get('td.lang', 'en'), motion: LS.get('td.motion', 'full'), theme: LS.get('td.theme', 'system'), size: LS.get('td.size', '1')
  };
  var html = document.documentElement;
  function applyPrefs() {
    if (prefs.theme === 'system') html.removeAttribute('data-theme'); else html.setAttribute('data-theme', prefs.theme);
    html.setAttribute('data-motion', prefs.motion);
    html.style.setProperty('--text-scale', prefs.size);
    html.lang = prefs.lang === 'zh-HK' ? 'zh-HK' : 'en';
  }
  applyPrefs();

  // ---------- i18n ----------
  var dict = { en: null, 'zh-HK': null };
  var ready = [];
  var translator = function (t) { return t; };
  function load(lang) {
    if (dict[lang]) return Promise.resolve(dict[lang]);
    return fetch(ROOT + 'i18n/' + lang + '.json').then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) { dict[lang] = j; return j; }).catch(function () { dict[lang] = {}; return {}; });
  }
  function fmt(s, args) { return String(s).replace(/\{(\d+)\}/g, function (m, i) { return args && args[i] !== undefined ? args[i] : m; }); }
  // t(key) returns the string in the current language (English in bilingual mode).
  function t(key, args, fallback) {
    var lang = prefs.lang === 'zh-HK' ? 'zh-HK' : 'en';
    var s = (dict[lang] && dict[lang][key]) || (dict.en && dict.en[key]) || fallback || key;
    return translator(fmt(s, args));
  }
  function tz(key, args) { return dict['zh-HK'] && dict['zh-HK'][key] ? translator(fmt(dict['zh-HK'][key], args)) : ''; }
  function render(el) {
    var key = el.getAttribute('data-i18n');
    if (!el.hasAttribute('data-i18n-orig')) el.setAttribute('data-i18n-orig', el.textContent);
    var args = el.getAttribute('data-i18n-args');
    args = args ? args.split('|') : null;
    var fallback = el.getAttribute('data-i18n-orig');
    if (prefs.lang === 'bi') {
      var en = t(key, args, fallback), zh = tz(key, args);
      el.textContent = en;
      if (zh && zh !== en) {
        var sub = document.createElement('span');
        sub.className = 'bi-sub'; sub.lang = 'zh-HK'; sub.textContent = zh;
        el.appendChild(sub);
      }
    } else {
      el.textContent = t(key, args, fallback);
    }
  }
  function renderAttrs(el) {
    el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
      var p = pair.split(':'); if (p.length !== 2) return;
      var key = 'data-i18n-orig-' + p[0];
      if (!el.hasAttribute(key)) el.setAttribute(key, el.getAttribute(p[0]) || '');
      var v = t(p[1], null, el.getAttribute(key));
      if (prefs.lang === 'bi') { var z = tz(p[1]); if (z && z !== v) v += ' / ' + z; }
      el.setAttribute(p[0], v);
    });
  }
  function translateAll(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(render);
    root.querySelectorAll('[data-i18n-attr]').forEach(renderAttrs);
    var tk = document.querySelector('meta[name="td-title"]');
    if (tk) document.title = t(tk.content, null, document.title.split(' | ')[0]) + ' | TempDesk';
  }
  function setLang(l) {
    prefs.lang = l; LS.set('td.lang', l); applyPrefs();
    return Promise.all([load('en'), l === 'en' ? null : load('zh-HK')]).then(function () { translateAll(); fire(); });
  }
  function fire() { ready.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }

  // ---------- personal wording ----------
  var WORDING_KEY = 'td.wording';
  function loadWording() {
    var raw = LS.get(WORDING_KEY, null);
    if (!raw || !window.TempDeskWording) { translator = function (s) { return s; }; return 'none'; }
    try { translator = window.TempDeskWording.buildTranslator(window.TempDeskWording.validate(raw)); return 'loaded'; }
    catch (e) { translator = function (s) { return s; }; return 'invalid'; }
  }
  var wordingState = loadWording();

  // ---------- settings sheet ----------
  var GEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
  var SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  var CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function seg(name, options, current, onPick) {
    var box = h('div', { class: 'seg', role: 'group', 'aria-label': name });
    options.forEach(function (o) {
      box.appendChild(h('button', { type: 'button', 'aria-pressed': String(o[0] === current), 'data-i18n': o[1], 'data-value': o[0], 'data-palette-setting': o[1], onclick: function () {
        box.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === this)); }, this);
        onPick(o[0]);
      } }, [o[2]]));
    });
    return box;
  }
  var lastFocus = null;
  function openSheet(sheet, focusSel) {
    lastFocus = document.activeElement;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    var f = sheet.querySelector(focusSel || 'button, input, select, textarea');
    if (f) f.focus();
  }
  function closeSheet(sheet) {
    sheet.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function trap(sheet) {
    sheet.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeSheet(sheet); }
      if (e.key !== 'Tab') return;
      var f = Array.prototype.filter.call(sheet.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
    sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(sheet); });
  }

  var settingsSheet, wordingStateEl;
  function wordingMessage(state, extra) {
    var map = { none: 'wording.state.none', loaded: 'wording.state.loaded', invalid: 'wording.state.invalid', replaced: 'wording.state.replaced', cleared: 'wording.state.cleared' };
    wordingStateEl.setAttribute('data-state', state === 'replaced' ? 'loaded' : state === 'cleared' ? 'none' : state);
    wordingStateEl.setAttribute('data-i18n', map[state]);
    if (extra) wordingStateEl.setAttribute('data-i18n-args', extra); else wordingStateEl.removeAttribute('data-i18n-args');
    render(wordingStateEl);
  }
  function wordingError(err) {
    var code = err && err.code ? err.code : 'json';
    var msg = t('wording.err.' + code, [err && err.entry ? err.entry : ''], code);
    return msg;
  }
  function buildSettings() {
    settingsSheet = h('div', { class: 'sheet', id: 'td-settings', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'td-settings-title', hidden: true });
    var panel = h('div', { class: 'sheet-panel', 'data-search-surface': 'site-settings', 'data-search-items': '.set-group', 'data-search-mount': '.sheet-head', 'data-search-label': 'settings.title' });
    panel.appendChild(h('div', { class: 'sheet-head' }, [
      h('h2', { id: 'td-settings-title', 'data-i18n': 'settings.title' }, ['Settings']),
      h('button', { class: 'iconbtn', type: 'button', html: CLOSE, 'data-i18n-attr': 'aria-label:common.close', 'aria-label': 'Close', onclick: function () { closeSheet(settingsSheet); } })
    ]));
    panel.appendChild(h('div', { class: 'set-group', id: 'set-language' }, [h('b', { 'data-i18n': 'settings.language' }, ['Language']),
      seg('Language', [['en', 'settings.lang.en', 'English'], ['zh-HK', 'settings.lang.zh', 'Cantonese (Traditional Chinese, Hong Kong)'], ['bi', 'settings.lang.bi', 'Bilingual']], prefs.lang, setLang)]));
    panel.appendChild(h('div', { class: 'set-group', id: 'set-motion' }, [h('b', { 'data-i18n': 'settings.motion' }, ['Motion']),
      seg('Motion', [['full', 'settings.motion.full', 'Full'], ['reduced', 'settings.motion.reduced', 'Reduced'], ['off', 'settings.motion.off', 'Off']], prefs.motion, function (v) { prefs.motion = v; LS.set('td.motion', v); applyPrefs(); }),
      h('span', { class: 'help', style: 'color:var(--muted);font-size:.84rem', 'data-i18n': 'settings.motion.help' }, ['Full still respects your device setting for reduced motion.'])]));
    panel.appendChild(h('div', { class: 'set-group', id: 'set-theme' }, [h('b', { 'data-i18n': 'settings.theme' }, ['Theme']),
      seg('Theme', [['dark', 'settings.theme.dark', 'Dark'], ['light', 'settings.theme.light', 'Light'], ['system', 'settings.theme.system', 'System']], prefs.theme, function (v) { prefs.theme = v; LS.set('td.theme', v); applyPrefs(); })]));
    panel.appendChild(h('div', { class: 'set-group', id: 'set-size' }, [h('b', { 'data-i18n': 'settings.size' }, ['Text size']),
      seg('Text size', [['0.9', 'settings.size.s', 'Small'], ['1', 'settings.size.m', 'Default'], ['1.15', 'settings.size.l', 'Large'], ['1.3', 'settings.size.xl', 'Extra large']], prefs.size, function (v) { prefs.size = v; LS.set('td.size', v); applyPrefs(); })]));
    // personal wording
    var file = h('input', { type: 'file', accept: 'application/json,.json', id: 'td-wording-file', class: 'sr-only' });
    wordingStateEl = h('div', { class: 'wording-state', role: 'status', 'aria-live': 'polite' });
    var clearBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-i18n': 'wording.clear', onclick: function () {
      LS.del(WORDING_KEY); wordingState = loadWording(); translateAll(); fire(); wordingMessage('cleared'); clearBtn.disabled = true;
    } }, ['Clear']);
    var pick = h('label', { for: 'td-wording-file', class: 'btn btn-primary btn-sm', tabindex: '0', role: 'button', 'data-i18n': 'wording.choose', onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } } }, ['Choose JSON file']);
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      if (f.size > window.TempDeskWording.MAX_BYTES) { wordingMessage('invalid', wordingError({ code: 'size' })); return; }
      f.arrayBuffer().then(function (buf) {
        var had = !!LS.get(WORDING_KEY, null);
        try {
          var entries = window.TempDeskWording.validate(new Uint8Array(buf));
          var text = new TextDecoder().decode(buf);
          if (!LS.set(WORDING_KEY, text)) throw { code: 'storage' };
          wordingState = loadWording(); translateAll(); fire();
          wordingMessage(had ? 'replaced' : 'loaded', String(entries.size));
          clearBtn.disabled = false;
        } catch (err) {
          wordingMessage('invalid', wordingError(err));
        }
      });
    });
    panel.appendChild(h('div', { class: 'set-group', id: 'set-wording' }, [
      h('b', { 'data-i18n': 'wording.title' }, ['Personal wording']),
      h('span', { style: 'color:var(--muted);font-size:.88rem', 'data-i18n': 'wording.help' }, ['Upload a JSON file with your own words for the interface text. It stays in this browser only and never changes generated files or code.']),
      h('code', { style: 'font-size:.8rem;color:var(--muted);overflow-wrap:anywhere' }, ['{"schemaVersion":1,"entries":{"Guest":"Visitor"}}']),
      wordingStateEl,
      h('div', { class: 'cta' }, [pick, file, clearBtn])
    ]));
    clearBtn.disabled = wordingState === 'none';
    panel.appendChild(h('div', { class: 'set-group' }, [h('b', { 'data-i18n': 'settings.palette' }, ['Command palette']),
      h('span', { style: 'color:var(--muted);font-size:.88rem', 'data-i18n': 'settings.palette.help' }, ['Press Ctrl+Shift+F anywhere to jump to a page, section, field or setting.'])]));
    settingsSheet.appendChild(panel);
    trap(settingsSheet);
    document.body.appendChild(settingsSheet);
    wordingMessage(wordingState === 'loaded' ? 'loaded' : wordingState, wordingState === 'loaded' ? String(window.TempDeskWording.validate(LS.get(WORDING_KEY, '')).size) : '');
  }

  // ---------- command palette ----------
  var palRx = null;
  // Translate function handed to the regex builder: missing keys fall back to its English.
  function rxT(key) { var args = Array.prototype.slice.call(arguments, 1); var v = t(key, args, '\u0000'); return v === '\u0000' ? key : v; }
  var palette, palInput, palList, palRegex, palItems = [], palSel = 0, siteIndex = null, paletteSources = [];
  function loadIndex() {
    if (siteIndex) return Promise.resolve(siteIndex);
    return fetch(ROOT + 'search-index.json').then(function (r) { return r.ok ? r.json() : { pages: [] }; }).catch(function () { return { pages: [] }; })
      .then(function (j) { siteIndex = j; return j; });
  }
  function localItems() {
    var out = [];
    document.querySelectorAll('main [id] > h2, main h2[id], main section[id][data-palette]').forEach(function (e) {
      var target = e.id ? e : e.parentElement;
      var label = (e.getAttribute('data-palette') || e.textContent || '').trim();
      if (label) out.push({ kind: 'section', label: label, target: target });
    });
    document.querySelectorAll('[data-palette-field]').forEach(function (e) {
      out.push({ kind: 'field', label: e.getAttribute('data-palette-field'), sub: e.getAttribute('data-palette-group') || '', target: e });
    });
    [['set-language', 'settings.language'], ['set-motion', 'settings.motion'], ['set-theme', 'settings.theme'], ['set-size', 'settings.size'], ['set-wording', 'wording.title']].forEach(function (s) {
      out.push({ kind: 'setting', label: t(s[1]), setting: s[0] });
    });
    return out;
  }
  function makeMatcher(q, useRegex, st) {
    if (!q) return { ok: true, test: function () { return true; } };
    if (window.TempDeskRegex) { var c = window.TempDeskRegex.compile(q, Object.assign({}, st || {}, { regex: !!useRegex })); return { ok: c.ok, test: c.test }; }
    if (useRegex) {
      try { var re = new RegExp(q, 'i'); return { ok: true, test: function (s) { return re.test(s); } }; }
      catch (e) { return { ok: false, test: function () { return false; } }; }
    }
    var words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return { ok: true, test: function (s) { s = s.toLowerCase(); return words.every(function (w) { return s.indexOf(w) >= 0; }); } };
  }
  function renderPalette() {
    var q = palInput.value.trim(), st = palRx ? palRx.state : { regex: palRegex.getAttribute('aria-pressed') === 'true' }, useRe = !!st.regex;
    var m = makeMatcher(q, useRe, st);
    palInput.setAttribute('aria-invalid', String(!m.ok));
    var all = localItems();
    paletteSources.forEach(function (src) { try { all = all.concat(src(q, useRe) || []); } catch (e) { /* ignore a broken source */ } });
    (siteIndex ? siteIndex.pages : []).forEach(function (p) {
      all.push({ kind: 'page', label: p.title, sub: p.summary || '', href: ROOT + p.url });
      (p.sections || []).forEach(function (s) { all.push({ kind: 'section', label: s.title, sub: p.title, href: ROOT + p.url + '#' + s.id }); });
    });
    palItems = all.filter(function (it) { return m.test(it.label + ' ' + (it.sub || '')); }).slice(0, 60);
    palSel = 0;
    palList.innerHTML = '';
    palItems.forEach(function (it, i) {
      var li = h('li', { role: 'option', id: 'pal-' + i, 'aria-selected': String(i === palSel), onclick: function () { go(i); } }, [
        h('span', { text: it.label }), h('small', { text: t('palette.kind.' + it.kind) + (it.sub ? ' · ' + it.sub : '') })
      ]);
      palList.appendChild(li);
    });
    if (!palItems.length) palList.appendChild(h('li', { 'aria-disabled': 'true' }, [h('span', { text: m.ok ? t('palette.empty') : t('palette.badRegex') })]));
    palInput.setAttribute('aria-activedescendant', palItems.length ? 'pal-0' : '');
  }
  function select(i) {
    if (!palItems.length) return;
    palSel = (i + palItems.length) % palItems.length;
    palList.querySelectorAll('li').forEach(function (li, j) { li.setAttribute('aria-selected', String(j === palSel)); });
    var cur = document.getElementById('pal-' + palSel);
    if (cur) { cur.scrollIntoView({ block: 'nearest' }); palInput.setAttribute('aria-activedescendant', cur.id); }
  }
  function pulse(el) {
    if (!el) return;
    el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse');
    setTimeout(function () { el.classList.remove('pulse'); }, 2000);
  }
  function focusTarget(el) {
    // reveal hidden ancestors registered by the builder (tabs, sections, details)
    document.dispatchEvent(new CustomEvent('td:reveal', { detail: el }));
    var d = el.closest('details'); if (d) d.open = true;
    el.scrollIntoView({ block: 'center' });
    var f = el.matches('input, select, textarea, button, a') ? el : el.querySelector('input, select, textarea, button, a') || el;
    if (!f.matches('input, select, textarea, button, a')) f.setAttribute('tabindex', '-1');
    f.focus({ preventScroll: true });
    pulse(f.closest('.field') || f);
  }
  function go(i) {
    var it = palItems[i];
    if (!it) return;
    closeSheet(palette);
    if (it.action) { it.action(); return; }
    if (it.setting) { openSheet(settingsSheet); var s = document.getElementById(it.setting); if (s) { s.scrollIntoView({ block: 'center' }); var b = s.querySelector('button, label'); if (b) b.focus(); pulse(s); } return; }
    if (it.target) { focusTarget(it.target); return; }
    if (it.href) {
      var u = new URL(it.href, location.href);
      if (u.pathname === location.pathname && u.hash) { var tEl = document.getElementById(decodeURIComponent(u.hash.slice(1))); if (tEl) { focusTarget(tEl); return; } }
      LS.set('td.pulse', u.hash.slice(1));
      location.href = u.href;
    }
  }
  function buildPalette() {
    palette = h('div', { class: 'sheet center', id: 'td-palette', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'td-pal-title', hidden: true });
    var panel = h('div', { class: 'sheet-panel' });
    palInput = h('input', { type: 'search', id: 'td-pal-input', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'td-pal-list', 'aria-autocomplete': 'list', autocomplete: 'off', 'data-i18n-attr': 'placeholder:palette.placeholder;aria-label:palette.placeholder', placeholder: 'Search pages, sections, fields and settings' });
    palRegex = h('button', { type: 'button', class: 'iconbtn regex-toggle', 'aria-pressed': 'false', 'data-i18n-attr': 'aria-label:search.regex;title:search.regex', 'aria-label': 'Regular expression', title: 'Regular expression', onclick: function () {
      palRegex.setAttribute('aria-pressed', String(palRegex.getAttribute('aria-pressed') !== 'true')); renderPalette(); palInput.focus();
    } }, ['.*']);
    palList = h('ul', { class: 'palette-list', id: 'td-pal-list', role: 'listbox' });
    panel.appendChild(h('div', { class: 'sheet-head' }, [h('h2', { id: 'td-pal-title', 'data-i18n': 'palette.title' }, ['Go to']),
      h('button', { class: 'iconbtn', type: 'button', html: CLOSE, 'aria-label': 'Close', 'data-i18n-attr': 'aria-label:common.close', onclick: function () { closeSheet(palette); } })]));
    var palRow = h('div', { class: 'searchrow' }, [palInput]);
    panel.appendChild(palRow);
    panel.appendChild(palList);
    // Shared regex builder (assets/regex-builder.js); the plain ".*" toggle stays as a fallback.
    var RX = window.TempDeskRegex;
    if (RX) palRx = RX.attachRegexBuilder(palInput, { t: rxT, sampleProvider: function () { return palItems.map(function (it) { return it.label + ' ' + (it.sub || ''); }).join('\n'); }, onChange: function () { renderPalette(); } });
    else palRow.appendChild(palRegex);
    palette.appendChild(panel);
    trap(palette);
    palInput.addEventListener('input', renderPalette);
    palInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); select(palSel + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); select(palSel - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(palSel); }
    });
    document.body.appendChild(palette);
  }
  function openPalette() {
    openSheet(palette, '#td-pal-input');
    palInput.select();
    renderPalette();
    loadIndex().then(renderPalette);
  }

  // ---------- top bar enhancements ----------
  function decorateTopbar() {
    var nav = document.querySelector('.topnav');
    if (!nav) return;
    var s = h('button', { type: 'button', class: 'iconbtn', html: SEARCH, id: 'td-open-palette', 'aria-label': 'Search (Ctrl+Shift+F)', 'data-i18n-attr': 'aria-label:palette.open;title:palette.open', title: 'Search (Ctrl+Shift+F)', onclick: openPalette });
    var g = h('button', { type: 'button', class: 'iconbtn', html: GEAR, id: 'td-open-settings', 'aria-label': 'Settings', 'data-i18n-attr': 'aria-label:settings.title;title:settings.title', title: 'Settings', 'aria-haspopup': 'dialog', onclick: function () { openSheet(settingsSheet); } });
    nav.insertBefore(g, nav.firstChild);
    nav.insertBefore(s, nav.firstChild);
  }
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) { e.preventDefault(); if (palette.hidden) openPalette(); else closeSheet(palette); }
  });

  function toast(msg) {
    var tEl = h('div', { class: 'toast', role: 'status' }, [msg]);
    document.body.appendChild(tEl);
    setTimeout(function () { tEl.remove(); }, 2600);
  }

  // Declarative search surfaces: any element with data-search-surface="<id>" gets its own search
  // field with the regex builder (assets/regex-builder.js). data-search-items is an optional CSS
  // selector for the items inside it (default: its children); data-search-label an i18n key.
  function wireSearchSurfaces(rootEl) {
    var RX = window.TempDeskRegex;
    if (!RX) return;
    (rootEl || document).querySelectorAll('[data-search-surface]').forEach(function (el) {
      if (el.__rxbFilter) return;
      var sel = el.getAttribute('data-search-items'), lk = el.getAttribute('data-search-label'), mt = el.getAttribute('data-search-mount');
      var mount = mt ? el.querySelector(mt) : null;
      RX.attachListFilter(el, { id: el.getAttribute('data-search-surface'), t: rxT, label: lk ? t('rx.filterFor', [t(lk)]) : undefined, mount: mount || undefined, place: mount ? 'after' : 'before',
        items: sel ? function () { return Array.prototype.slice.call(el.querySelectorAll(sel)); } : undefined });
    });
  }
  window.TempDeskSite = {
    t: t, tz: tz, h: h, ROOT: ROOT, LS: LS, prefs: prefs, translateAll: translateAll, render: render, toast: toast, pulse: pulse,
    openSheet: openSheet, closeSheet: closeSheet, trap: trap, makeMatcher: makeMatcher, focusTarget: focusTarget, wireSearchSurfaces: wireSearchSurfaces, rxT: rxT,
    onLang: function (f) { ready.push(f); }, translate: function (s) { return translator(s); },
    addPaletteSource: function (fn) { paletteSources.push(fn); }
  };

  function init() {
    decorateTopbar();
    buildSettings();
    buildPalette();
    Promise.all([load('en'), prefs.lang === 'en' ? null : load('zh-HK')]).then(function () {
      translateAll(); fire(); wireSearchSurfaces();
      var p = LS.get('td.pulse', '');
      if (p) { LS.del('td.pulse'); var el = document.getElementById(p); if (el) setTimeout(function () { focusTarget(el); }, 60); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
