// Small search controls shared by the builder, its canvases and the Base64 page: a search box
// with the shared regex builder (plain text by default, ".*" toggle and an anchored Builder
// popover, see ../regex-builder.js), and an accessible searchable combobox.
import { h } from './dom.js';
import { compileQuery } from './search.js';
import { attachRegexBuilder, STRINGS } from '../regex-builder.mjs';

let uid = 0;
// Translate through the page's i18n (TempDeskSite.t) and fall back to the module's English.
const tr = (o) => (key, ...args) => {
  const S = typeof window !== 'undefined' && window.TempDeskSite;
  const v = o.t ? o.t(key, ...args) : S && S.t ? S.t(key, args, '\u0000') : '';
  return !v || v === '\u0000' || v === key ? (STRINGS[key] || key).replace(/\{(\d+)\}/g, (m, i) => (args[+i] === undefined ? m : String(args[+i]))) : v;
};
// searchBox({ label, placeholder, onChange(q, regex, matcher, state), value, regex, compact, onKey, sampleProvider })
// -> { el, input, builder, setStatus(text, bad), focus(), fire(), get regex(), get state() }
// matcher comes from compileQuery: { ok, empty, test(text) -> null | {index, length}, error }.
export function searchBox(o) {
  const id = 'sb-' + (++uid);
  const input = h('input', { type: 'search', id, value: o.value || '', placeholder: o.placeholder || o.label, 'aria-label': o.label, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  const status = h('div', { class: 'meter-label sb-status', id: id + '-st', role: 'status', 'aria-live': 'polite' });
  input.setAttribute('aria-describedby', id + '-st');
  const row = h('div', { class: 'searchrow' }, [input]);
  const el = h('div', { class: 'sb' + (o.compact ? ' sb-compact' : '') }, [row, status]);
  let state = null;
  const t = tr(o);
  const builder = attachRegexBuilder(input, {
    label: o.label, t, sampleProvider: o.sampleProvider,
    state: { query: o.value || '', regex: !!o.regex, pattern: o.regex ? o.value || '' : '' },
    onChange: (st) => { state = st; fire(); }
  });
  state = builder.state;
  function fire() {
    const st = state || builder.state;
    const m = compileQuery(st.regex ? st.pattern : st.query, st);
    input.setAttribute('aria-invalid', String(!m.ok));
    if (!m.ok) status.textContent = m.slow ? t('rx.slowWarn') : (o.badRegex || 'That regular expression is not valid.');
    o.onChange(st.regex ? st.pattern : st.query, !!st.regex, m, st);
  }
  if (o.onKey) input.addEventListener('keydown', (e) => o.onKey(e));
  return {
    el, input, builder, get regex() { return !!(state && state.regex); }, get state() { return builder.state; },
    setStatus(text, bad) { status.textContent = text || ''; status.classList.toggle('bad', !!bad); },
    focus() { input.focus(); }, fire
  };
}

// combobox({ id, label, options: [[value, label]], value, onChange(value, label), describedby })
// Type to filter, arrows to move, Enter to pick, Escape to close. Only listed values are accepted
// unless allowCustom is true.
export function combobox(o) {
  const listId = o.id + '-list';
  const labelOf = (v) => { const f = o.options.find((x) => x[0] === v); return f ? f[1] : v; };
  const input = h('input', { type: 'text', id: o.id, role: 'combobox', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId, autocomplete: 'off', spellcheck: 'false', value: o.value ? labelOf(o.value) : '', 'aria-describedby': o.describedby || null, class: o.mono ? 'mono' : null });
  // search-surface: studio-combobox (the listbox is filtered by the combobox field and its builder)
  const list = h('ul', { class: 'combo-list', id: listId, role: 'listbox', hidden: true });
  let items = [], sel = -1, current = o.value || '';
  function open(all) {
    const st = rx ? rx.state : { regex: false };
    const m = compileQuery(all ? '' : input.value.trim(), st);
    items = m.ok ? o.options.filter(([v, l]) => !!m.test(v + ' ' + l)).slice(0, 200) : [];
    list.replaceChildren(...items.map(([v, l], i) => {
      const li = h('li', { role: 'option', id: listId + '-' + i, 'aria-selected': String(v === current), text: l });
      li.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(i); });
      return li;
    }));
    if (!items.length) list.appendChild(h('li', { class: 'combo-empty', 'aria-disabled': 'true', text: o.emptyText || 'No match' }));
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    sel = Math.max(0, items.findIndex((x) => x[0] === current)); mark();
  }
  function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
  function mark() {
    [...list.children].forEach((li, i) => li.classList.toggle('active', i === sel));
    const a = list.children[sel];
    if (a && a.id) { input.setAttribute('aria-activedescendant', a.id); a.scrollIntoView({ block: 'nearest' }); }
  }
  function pick(i) {
    const it = items[i]; if (!it) return;
    current = it[0]; input.value = it[1]; close(); o.onChange(it[0], it[1]);
  }
  input.addEventListener('focus', () => { input.select(); });
  input.addEventListener('input', () => open(false));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(true); else { sel = Math.min(items.length - 1, sel + 1); mark(); } }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === 'Enter' && !list.hidden) { e.preventDefault(); pick(sel); }
    else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); input.value = labelOf(current); }
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.rxb-tools, .rxb-pop')) return;
      close();
      if (rx && rx.state.regex) { input.value = current ? labelOf(current) : ''; return; } // a pattern is a search, never a value
      const typed = input.value.trim();
      if (o.allowCustom && typed && typed !== labelOf(current)) { current = typed; o.onChange(typed, typed); }
      else input.value = current ? labelOf(current) : '';
    }, 120);
  });
  const toggle = h('button', { type: 'button', class: 'iconbtn combo-btn', tabindex: '-1', 'aria-label': o.openLabel || 'Show options', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' });
  toggle.addEventListener('pointerdown', (e) => { e.preventDefault(); if (list.hidden) { input.focus(); open(true); } else close(); });
  const row = h('div', { class: 'inline' }, [input, toggle]);
  const el = h('div', { class: 'combo' }, [row, list]);
  // search-surface: studio-combobox (the field is the search; the regex builder sits beside it)
  const rx = attachRegexBuilder(input, { label: o.label || input.getAttribute('aria-label') || '', t: tr(o), escapeClears: false, noHostClass: true,
    sampleProvider: () => o.options.slice(0, 300).map((x) => x[0] + ' ' + x[1]).join('\n'), onChange: () => { if (document.activeElement === input || rx.state.regex) open(false); } });
  return { el, input, builder: rx, set(v) { current = v; input.value = labelOf(v); } };
}
