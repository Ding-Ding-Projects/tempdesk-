// UI toolkit for the desktop app: DOM builder, toasts and notification centre, dialogs, the
// two-key super confirmation, info popovers, context menus, search boxes with the regex builder,
// sounds and the full-window celebration. Every user-facing string comes through t().
const Core = window.TempDeskCore;

export const state = { t: (k) => k, settings: {}, motionOff: false, info: {}, notifications: [], sounds: {}, school: { enabled: false } };

export function h(tag, attrs, kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') e.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(kids === undefined ? [] : kids)) {
    if (c === null || c === undefined || c === false) continue;
    e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return e;
}
export const t = (k, a) => state.t(k, a);
const SVG = (d, extra) => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>';
export const ICON = {
  deploy: SVG('<path d="M12 3v12M7 10l5 5 5-5M4 19h16"/>'), answers: SVG('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
  deployments: SVG('<rect x="3" y="4" width="18" height="6" rx="2"/><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 7h.01M7 17h.01"/>'),
  portals: SVG('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  tools: SVG('<path d="M14 7l3-3 3 3-3 3M17 4v6M4 20l9-9M8 6l-4 4 4 4"/>'), history: SVG('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 3"/>'),
  settings: SVG('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z"/>'),
  help: SVG('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01"/>'),
  bell: SVG('<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0"/>'), search: SVG('<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>'),
  close: SVG('<path d="M6 6l12 12M18 6 6 18"/>'), undo: SVG('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'), redo: SVG('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
  more: SVG('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'), plus: SVG('<path d="M12 5v14M5 12h14"/>'),
  check: SVG('<path d="m5 12 5 5 9-10"/>'), copy: SVG('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/>')
};
export function icon(name) { const s = h('span', { 'aria-hidden': 'true', style: { display: 'inline-flex' } }); s.innerHTML = ICON[name] || ''; return s; }
export function btn(label, onclick, cls, extra) {
  const b = h('button', Object.assign({ type: 'button', class: 'btn ' + (cls || ''), onclick }, extra || {}), [label]);
  return b;
}
export function iconBtn(name, label, onclick, extra) {
  const b = h('button', Object.assign({ type: 'button', class: 'iconbtn', 'aria-label': label, title: label, onclick }, extra || {}));
  b.innerHTML = ICON[name] || '';
  return b;
}

// ---- sounds -------------------------------------------------------------------------------
const audioCache = {};
export async function play(name) {
  if (!state.settings.sounds) return;
  try {
    if (!(name in audioCache)) audioCache[name] = await window.td.invoke['sound:get'](name);
    const src = audioCache[name];
    if (!src) return;
    const a = new Audio(src);
    a.volume = Math.max(0, Math.min(1, (state.settings.volume || 0) / 100));
    await a.play();
  } catch (e) { /* sound is optional */ }
}

// ---- live region, toasts and notification centre -------------------------------------------
let live = null, toasts = null;
export function announce(text) {
  if (!live) { live = h('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' }); document.body.appendChild(live); }
  live.textContent = '';
  setTimeout(() => { live.textContent = text; }, 30);
}
const notifyListeners = [];
export function onNotify(fn) { notifyListeners.push(fn); }
export function toast(text, kind, opts) {
  opts = opts || {};
  if (!toasts) { toasts = h('div', { class: 'toasts', 'aria-live': 'polite' }); document.body.appendChild(toasts); }
  const el = h('div', { class: 'toast ' + (kind || ''), role: kind === 'error' ? 'alert' : 'status' }, [h('div', { style: { flex: '1' } }, [text]),
    iconBtn('close', t('common.dismiss'), () => remove(), { style: { width: '28px', height: '28px' } })]);
  toasts.appendChild(el);
  const remove = () => { el.classList.add('out'); setTimeout(() => el.remove(), state.motionOff ? 0 : 240); };
  setTimeout(remove, opts.ms || (kind === 'error' ? 8000 : 4200));
  if (!opts.noHistory) {
    state.notifications.unshift({ text: String(text), kind: kind || 'info', time: new Date() });
    state.notifications = state.notifications.slice(0, 200);
    notifyListeners.forEach((f) => f());
  }
}

// ---- dialogs ------------------------------------------------------------------------------
export function dialog(title, build, opts) {
  opts = opts || {};
  const prev = document.activeElement;
  const scrim = h('div', { class: 'scrim' });
  const box = h('div', { class: 'dialog' + (opts.wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-title' });
  const close = (v) => { scrim.remove(); if (prev && prev.focus) prev.focus(); if (opts.onClose) opts.onClose(v); };
  box.appendChild(h('div', { class: 'row between' }, [h('h2', { id: 'dlg-title', text: title }), iconBtn('close', t('common.close'), () => close())]));
  const content = build(close);
  [].concat(content).forEach((c) => c && box.appendChild(c));
  scrim.appendChild(box);
  scrim.addEventListener('mousedown', (e) => { if (e.target === scrim && !opts.modal) close(); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key !== 'Tab') return;
    const f = [...box.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  document.body.appendChild(scrim);
  const first = box.querySelector(opts.focus || 'input, select, textarea, .btn-primary, button:not(.iconbtn)');
  (first || box.querySelector('button')).focus();
  return close;
}
export function confirmDialog(title, text, okLabel) {
  return new Promise((resolve) => {
    let done = false;
    dialog(title, (close) => [h('p', { text }), h('div', { class: 'row end' }, [
      btn(t('common.cancel'), () => close(), 'btn-ghost'), btn(okLabel || t('common.ok'), () => { done = true; close(); resolve(true); }, 'btn-primary')])],
    { onClose: () => { if (!done) resolve(false); } });
  });
}
export function promptDialog(title, label, value, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    let result = null;
    const inp = h('input', { type: opts.password ? 'password' : 'text', id: 'prompt-in', value: value || '', autocomplete: 'off', inputmode: opts.numeric ? 'numeric' : undefined });
    const err = h('div', { class: 'err', role: 'alert' });
    dialog(title, (close) => {
      const ok = () => { const v = inp.value; const e = opts.validate ? opts.validate(v) : ''; if (e) { err.textContent = e; inp.setAttribute('aria-invalid', 'true'); return; } result = v; close(); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      return [h('div', { class: 'field' }, [h('label', { for: 'prompt-in', text: label }), inp, err]), h('div', { class: 'row end' }, [btn(t('common.cancel'), () => close(), 'btn-ghost'), btn(opts.ok || t('common.ok'), ok, 'btn-primary')])];
    }, { onClose: () => resolve(result), focus: 'input' });
  });
}

// Two-key super confirmation: type the exact name AND hold the button for 1.5 s.
export function superConfirm(opts) {
  return new Promise((resolve) => {
    let ok = false;
    const id = 'sc-' + Math.random().toString(36).slice(2, 7);
    const inp = h('input', { type: 'text', id, autocomplete: 'off', spellcheck: 'false', 'aria-describedby': id + '-d' });
    const fill = h('span', { class: 'fill' });
    const holdBtn = h('button', { type: 'button', class: 'btn btn-danger hold', disabled: true, 'aria-describedby': id + '-h' }, [fill, h('span', { text: opts.action || t('confirm.hold') })]);
    const status = h('div', { class: 'help', id: id + '-h', text: t('confirm.holdHelp') });
    let timer = null, start = 0, raf = 0;
    const word = String(opts.word);
    inp.addEventListener('input', () => { holdBtn.disabled = inp.value !== word; });
    const close = dialog(opts.title, (c) => [
      opts.danger ? h('div', { class: 'notice danger', role: 'alert' }, [h('strong', { text: opts.danger })]) : null,
      opts.text ? h('p', { text: opts.text }) : null,
      h('div', { class: 'field' }, [h('label', { for: id, text: t('confirm.type', [word]) }), h('div', { class: 'help', id: id + '-d', text: t('confirm.typeHelp') }), inp]),
      status,
      h('div', { class: 'row end' }, [btn(t('common.cancel'), () => c(), 'btn-ghost'), holdBtn])
    ], { onClose: () => { cancel(); resolve(ok); }, modal: true });
    function frame() {
      const p = Math.min(1, (Date.now() - start) / 1500);
      fill.style.transform = 'scaleX(' + p + ')';
      if (p >= 1) { ok = true; cancel(); close(); return; }
      raf = requestAnimationFrame(frame);
    }
    function begin(e) {
      if (holdBtn.disabled) return;
      if (e && e.type === 'keydown' && e.key !== ' ' && e.key !== 'Enter') return;
      if (e) e.preventDefault();
      if (timer) return;
      start = Date.now(); timer = true; status.textContent = t('confirm.holding');
      raf = requestAnimationFrame(frame);
    }
    function cancel() { if (timer) { cancelAnimationFrame(raf); timer = null; fill.style.transform = 'scaleX(0)'; status.textContent = t('confirm.holdHelp'); } }
    holdBtn.addEventListener('pointerdown', begin);
    holdBtn.addEventListener('keydown', begin);
    ['pointerup', 'pointerleave', 'keyup', 'blur'].forEach((ev) => holdBtn.addEventListener(ev, cancel));
  });
}

// ---- info popovers -------------------------------------------------------------------------
let openPop = null;
export function info(key, label) {
  const b = h('button', { type: 'button', class: 'info', 'aria-label': t('common.infoAbout', [label || '']), 'aria-expanded': 'false', text: 'i' });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openPop && openPop.owner === b) { closePop(); return; }
    closePop();
    const pop = h('div', { class: 'popover', role: 'dialog', 'aria-label': label || t('common.info'), tabindex: '-1' }, [h('p', { style: { margin: 0 }, text: t(key) })]);
    document.body.appendChild(pop);
    const r = b.getBoundingClientRect();
    const left = Math.min(window.innerWidth - pop.offsetWidth - 12, Math.max(12, r.left - 20));
    const top = r.bottom + 8 + pop.offsetHeight > window.innerHeight ? r.top - pop.offsetHeight - 8 : r.bottom + 8;
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
    b.setAttribute('aria-expanded', 'true');
    openPop = { el: pop, owner: b };
    pop.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { closePop(); b.focus(); } });
  });
  return b;
}
export function closePop() { if (openPop) { openPop.owner.setAttribute('aria-expanded', 'false'); openPop.el.remove(); openPop = null; } }
document.addEventListener('click', (e) => { if (openPop && !openPop.el.contains(e.target)) closePop(); });

// ---- context menus -------------------------------------------------------------------------
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.el.remove(); if (openMenu.prev && openMenu.prev.focus) openMenu.prev.focus(); openMenu = null; } }
// items: [{ label, kbd, run, danger, disabled } | 'sep']
export function showMenu(x, y, items) {
  closeMenu();
  const prev = document.activeElement;
  const m = h('div', { class: 'menu-in', role: 'menu' });
  // search-surface: deployer-context-menu (each menu gets its own filter field)
  const box = h('div', { class: 'menu menu-box' }, [m]);
  if (RX) RX.attachListFilter(m, { id: 'deployer-context-menu', label: t('search.label'), t: rxT, items: (l) => l.querySelectorAll('[role=menuitem]') });
  items.forEach((it) => {
    if (it === 'sep') { m.appendChild(h('hr')); return; }
    if (!it) return;
    m.appendChild(h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', disabled: it.disabled || undefined, onclick: () => { closeMenu(); it.run(); } }, [h('span', { text: it.label }), it.kbd ? h('span', { class: 'kbd', text: it.kbd }) : null]));
  });
  document.body.appendChild(box);
  box.style.left = Math.max(4, Math.min(x, window.innerWidth - box.offsetWidth - 8)) + 'px';
  box.style.top = Math.max(4, Math.min(y, window.innerHeight - box.offsetHeight - 8)) + 'px';
  openMenu = { el: box, prev };
  const all = [...m.querySelectorAll('button[role=menuitem]:not([disabled])')];
  if (all[0]) all[0].focus();
  box.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('.rxb-filter')) { if (e.key === 'ArrowDown') { e.preventDefault(); const f = all.find((x) => !x.hidden); if (f) f.focus(); } else if (e.key === 'Escape' && !e.target.value) { e.preventDefault(); closeMenu(); } return; }
    const btns = all.filter((x) => !x.hidden);
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); const fin = box.querySelector('.rxb-filter input'); if (i <= 0 && fin) fin.focus(); else btns[(i - 1 + btns.length) % btns.length].focus(); }
    if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); }
  });
}
document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.el.contains(e.target) && !(e.target.closest && e.target.closest('.rxb-pop'))) closeMenu(); });
// Registers a context menu (right click, Shift+F10 and the Menu key) on an element.
export function contextMenu(el, itemsFn) {
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); showMenu(e.clientX, e.clientY, itemsFn()); });
  el.addEventListener('keydown', (e) => {
    if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') { e.preventDefault(); e.stopPropagation(); const r = el.getBoundingClientRect(); showMenu(r.left + 20, r.top + Math.min(r.height, 40), itemsFn()); }
  });
}

// ---- search box with the shared regex builder (vendor/regex-builder.js), live count, message ---
// Builder strings come from the website catalogs (vendor/site-i18n) so both apps use one wording.
const RX = window.TempDeskRegex;
const siteCat = {};
['en', 'zh-HK'].forEach((l) => { try { fetch('vendor/site-i18n/' + l + '.json').then((r) => (r.ok ? r.json() : {})).then((j) => { siteCat[l] = j; }).catch(() => {}); } catch (e) { /* no fetch */ } });
export function rxT(k) { const c = siteCat[(document.documentElement.lang || 'en').startsWith('zh') ? 'zh-HK' : 'en'] || siteCat.en || {}; return c[k] || k; }
// Matcher compatible with Core.testMatch / Core.countMatches: { ok, re, empty, matchesEmpty, message }.
export function stateMatcher(st) {
  const q = String((st.regex ? st.pattern : st.query) || '');
  if (!q) return { ok: true, re: null, empty: true };
  if (!RX) return Core.buildMatcher(q, { regex: !!st.regex, caseSensitive: !!st.caseSensitive });
  const c = RX.compile(q, st);
  if (!c.ok) return { ok: false, error: c.slow ? 'slow' : 'invalid', message: c.slow ? rxT('rx.slowWarn') : String(c.message || c.error || '').replace(/^Invalid regular expression: /, '') };
  let re;
  try { re = new RegExp(c.source, (c.flags || (st.caseSensitive ? '' : 'i') + 'u').replace(/g/g, '') + 'g'); } catch (e) { return { ok: false, error: 'invalid', message: e.message }; }
  const m = { ok: true, re };
  if (st.regex) { re.lastIndex = 0; if (re.test('')) m.matchesEmpty = true; re.lastIndex = 0; }
  return m;
}
// opts: { label, placeholder, onChange(matcher), count(matcher) -> {items, matches}, sampleProvider }
export function searchBox(opts) {
  const id = 'sb-' + Math.random().toString(36).slice(2, 7);
  const inp = h('input', { type: 'search', id, placeholder: opts.placeholder || t('search.placeholder'), 'aria-label': opts.label || t('search.label'), autocomplete: 'off', spellcheck: 'false', 'aria-describedby': id + '-c ' + id + '-e' });
  const count = h('span', { class: 'count', id: id + '-c', 'aria-live': 'polite' });
  const errEl = h('div', { class: 'rxerr', id: id + '-e', role: 'alert' });
  const wrap = h('div', { class: 'search', role: 'search' }, [inp, count, errEl]);
  let st = RX ? RX.defaultState() : { query: '', regex: false };
  function matcher() { st.query = inp.value; if (st.regex) st.pattern = inp.value; return stateMatcher(st); }
  function update() {
    const m = matcher();
    errEl.textContent = m.ok ? (m.matchesEmpty ? t('search.matchesEmpty') : '') : t('search.invalid', [m.message || '']);
    inp.setAttribute('aria-invalid', m.ok ? 'false' : 'true');
    if (opts.onChange) opts.onChange(m);
    if (opts.count) { const c = opts.count(m); count.textContent = m.empty ? '' : t('search.count', [c.matches, c.items]); }
  }
  if (RX) {
    const b = RX.attachRegexBuilder(inp, { label: opts.label || t('search.label'), t: rxT, sampleProvider: opts.sampleProvider, onChange: (s2) => { st = s2; update(); } });
    wrap.builder = b;
  } else {
    inp.addEventListener('input', update);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Escape' && inp.value) { e.stopPropagation(); inp.value = ''; update(); } });
  }
  wrap.input = inp; wrap.matcher = matcher; wrap.refresh = update;
  return wrap;
}
// Search in front of any list, table or card grid that has no search of its own.
// search-surface helper: every call site passes a catalogue id (deployer/app/search-surfaces.json).
export function listFilter(list, id, label, opts) {
  const box = h('div', { class: 'rxb-wrap', 'data-search-surface': id }, [list]);
  if (RX) RX.attachListFilter(list, Object.assign({ id, label: t('search.label') + ': ' + label, t: rxT }, opts || {}));
  return box;
}

// ---- field helper with info button and one-line explanation -------------------------------
export function field(opts) {
  const id = opts.id || 'f-' + Math.random().toString(36).slice(2, 7);
  const control = opts.control;
  control.id = id;
  if (opts.help) control.setAttribute('aria-describedby', id + '-h');
  const lab = h('div', { class: 'lab' }, [h('label', { for: id, text: opts.label }), opts.info ? info(opts.info, opts.label) : null]);
  const wrap = h('div', { class: 'field', 'data-palette': opts.palette || opts.label, 'data-palette-id': id }, [lab, opts.help ? h('div', { class: 'help', id: id + '-h', text: opts.help }) : null, control, opts.err ? h('div', { class: 'err', id: id + '-e', role: 'alert' }) : null]);
  return wrap;
}
export function select(options, value, onchange) {
  const s = h('select', null, options.map(([v, l]) => h('option', { value: v, text: l })));
  s.value = value;
  if (onchange) s.addEventListener('change', () => onchange(s.value));
  return s;
}

// ---- celebration (personal wording applied) -----------------------------------------------
export function celebrate(headline) {
  const box = h('div', { class: 'celebrate', 'aria-hidden': 'true' }, [h('div', { class: 'glow' }), h('div', { class: 'headline', text: headline })]);
  if (!state.motionOff) {
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2, d = 160 + Math.random() * 220;
      box.appendChild(h('span', { class: 'dot' + (i % 3 === 0 ? ' c' : ''), style: { '--dx': Math.cos(a) * d + 'px', '--dy': Math.sin(a) * d + 'px', animationDelay: (Math.random() * 300) + 'ms' } }));
    }
  }
  document.body.appendChild(box);
  announce(headline);
  // Animates in, holds 3 s, animates out; with motion off it shows statically for the same time.
  setTimeout(() => box.remove(), state.motionOff ? 3000 : 3900);
}

// Focus an element and pulse it (used by the command palette teleport).
export function pulseFocus(el) {
  if (!el) return;
  const d = el.closest('details'); if (d) d.open = true;
  el.scrollIntoView({ block: 'center', behavior: state.motionOff ? 'auto' : 'smooth' });
  const target = el.matches('input, select, textarea, button, a') ? el : el.querySelector('input, select, textarea, button, a') || el;
  if (!target.matches('input, select, textarea, button, a')) target.setAttribute('tabindex', '-1');
  setTimeout(() => target.focus({ preventScroll: true }), state.motionOff ? 0 : 200);
  const box = el.closest('.field, .item, .card') || el;
  box.classList.remove('pulse-target'); void box.offsetWidth; box.classList.add('pulse-target');
  setTimeout(() => box.classList.remove('pulse-target'), 3400);
}
export function fmtBytes(n) { if (n < 1024) return n + ' B'; const u = ['KiB', 'MiB', 'GiB', 'TiB']; let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1); return n.toFixed(n < 10 ? 1 : 0) + ' ' + u[i]; }
export function fmtTime(d) { try { return new Date(d).toLocaleString(); } catch (e) { return String(d); } }
