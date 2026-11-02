// Small search controls shared by the builder, its canvases and the Base64 page:
// a search box with a regular expression toggle, and an accessible searchable combobox.
import { h } from './dom.js';
import { compileQuery } from './search.js';

let uid = 0;
// searchBox({ label, placeholder, onChange(q, regex, matcher), value, regex, compact })
// -> { el, input, setStatus(text, bad), focus() }
export function searchBox(o) {
  const id = 'sb-' + (++uid);
  const input = h('input', { type: 'search', id, value: o.value || '', placeholder: o.placeholder || o.label, 'aria-label': o.label, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search' });
  let regex = !!o.regex;
  const re = h('button', { type: 'button', class: 'iconbtn regex-toggle', 'aria-pressed': String(regex), 'aria-label': o.regexLabel || 'Regular expression', title: o.regexLabel || 'Regular expression', text: '.*' });
  const status = h('div', { class: 'meter-label sb-status', id: id + '-st', role: 'status', 'aria-live': 'polite' });
  input.setAttribute('aria-describedby', id + '-st');
  const fire = () => {
    const m = compileQuery(input.value, regex);
    input.setAttribute('aria-invalid', String(!m.ok));
    if (!m.ok) status.textContent = o.badRegex || 'That regular expression is not valid.';
    o.onChange(input.value, regex, m);
  };
  let tm;
  input.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(fire, 120); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; fire(); } if (o.onKey) o.onKey(e); });
  re.addEventListener('click', () => { regex = !regex; re.setAttribute('aria-pressed', String(regex)); fire(); input.focus(); });
  const el = h('div', { class: 'sb' + (o.compact ? ' sb-compact' : '') }, [h('div', { class: 'searchrow' }, [input, re]), status]);
  return {
    el, input, get regex() { return regex; },
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
  const list = h('ul', { class: 'combo-list', id: listId, role: 'listbox', hidden: true });
  let items = [], sel = -1, current = o.value || '';
  function open(all) {
    const q = all ? '' : input.value.trim().toLowerCase();
    const words = q.split(/\s+/).filter(Boolean);
    items = o.options.filter(([v, l]) => words.every((w) => (v + ' ' + l).toLowerCase().includes(w))).slice(0, 200);
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
      close();
      const typed = input.value.trim();
      if (o.allowCustom && typed && typed !== labelOf(current)) { current = typed; o.onChange(typed, typed); }
      else input.value = current ? labelOf(current) : '';
    }, 120);
  });
  const toggle = h('button', { type: 'button', class: 'iconbtn combo-btn', tabindex: '-1', 'aria-label': o.openLabel || 'Show options', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' });
  toggle.addEventListener('pointerdown', (e) => { e.preventDefault(); if (list.hidden) { input.focus(); open(true); } else close(); });
  const el = h('div', { class: 'combo' }, [h('div', { class: 'inline' }, [input, toggle]), list]);
  return { el, input, set(v) { current = v; input.value = labelOf(v); } };
}
