// Choice widgets: toggle (switch), segmented (radio group), cards (radio cards with descriptions),
// enum-flags (checkbox group for a bitmask) and combobox-search (large searchable lists).
import { h, nextId, flash, radioKeys, markRadios } from './base.js';
import { decodeFlags, encodeFlags } from './format.js';
import { sourceOptions, zoneNow } from './data.js';

const isTrue = (v) => /^true$/i.test(String(v));
/** Values of a choice widget: hint values, or true/false for booleans. */
export function choiceValues(hint, setting) {
  if (setting && setting.type === 'boolean' && !(hint.values && hint.values.some((v) => !/^(true|false)$/i.test(v.value)))) return [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }];
  return (hint.values || []).map((v) => ({ value: v.value, label: v.label }));
}
function short(label, value) {
  const s = String(label || '');
  if (!s || s === value) return value;
  const first = s.split(/[.:;(]/)[0].trim();
  return first.length <= 24 ? first : value;
}

// ---- toggle -------------------------------------------------------------------------------------
export const toggle = {
  create(ctx) {
    const { t, hint } = ctx;
    const def = hint.default !== undefined ? isTrue(hint.default) : false;
    const btn = h('button', { type: 'button', id: ctx.id, role: 'switch', class: 'w-switch', 'aria-describedby': ctx.describedBy || undefined }, [h('span', { class: 'w-switch-track', 'aria-hidden': 'true' }, [h('span', { class: 'w-switch-thumb' })]), h('span', { class: 'w-switch-text' })]);
    let cur = ctx.value;
    const draw = () => {
      const on = cur === undefined ? def : isTrue(cur);
      btn.setAttribute('aria-checked', String(on));
      btn.classList.toggle('unset', cur === undefined);
      btn.querySelector('.w-switch-text').textContent = (on ? 'true' : 'false') + (cur === undefined ? ' · ' + t('w.notSetShort', null, 'not set') : '');
    };
    btn.addEventListener('click', () => { const on = cur === undefined ? !def : !isTrue(cur); cur = on ? 'true' : 'false'; draw(); ctx.onChange(cur); });
    draw();
    return { el: btn, input: btn, set(v) { cur = v === undefined ? undefined : String(v).toLowerCase(); draw(); } };
  }
};

// ---- segmented -------------------------------------------------------------------------------
export const segmented = {
  create(ctx) {
    const vals = choiceValues(ctx.hint, ctx.setting);
    const group = h('div', { class: 'w-seg', role: 'radiogroup', id: ctx.id, 'aria-describedby': ctx.describedBy || undefined, 'aria-labelledby': ctx.labelId || undefined });
    const btns = vals.map((v, i) => h('button', { type: 'button', role: 'radio', class: 'w-seg-b', 'data-value': v.value, title: ctx.hint.valueHelp[v.value] || v.label, onclick: () => pick(i) }, [short(v.label, v.value)]));
    btns.forEach((b) => group.appendChild(b));
    let cur = ctx.value;
    const sync = () => markRadios(btns, vals.findIndex((v) => v.value === String(cur)));
    function pick(i) { cur = vals[i].value; sync(); flash(btns[i]); ctx.onChange(cur); }
    radioKeys(group, btns, pick);
    sync();
    return { el: group, input: btns.find((b) => b.tabIndex === 0) || btns[0], set(v) { cur = v; sync(); } };
  }
};

// ---- cards ------------------------------------------------------------------------------------
export const cards = {
  create(ctx) {
    const vals = choiceValues(ctx.hint, ctx.setting);
    const group = h('div', { class: 'w-cards', role: 'radiogroup', id: ctx.id, 'aria-describedby': ctx.describedBy || undefined, 'aria-labelledby': ctx.labelId || undefined });
    const btns = vals.map((v, i) => {
      const help = ctx.hint.valueHelp[v.value] || v.label;
      return h('button', { type: 'button', role: 'radio', class: 'w-card', 'data-value': v.value, onclick: () => pick(i) }, [
        h('span', { class: 'w-card-v mono', text: v.value }), h('span', { class: 'w-card-d', text: help })]);
    });
    btns.forEach((b) => group.appendChild(b));
    let cur = ctx.value;
    const sync = () => markRadios(btns, vals.findIndex((v) => v.value === String(cur)));
    function pick(i) { cur = vals[i].value; sync(); flash(btns[i]); ctx.onChange(cur); }
    radioKeys(group, btns, pick);
    sync();
    return { el: group, input: btns.find((b) => b.tabIndex === 0) || btns[0], set(v) { cur = v; sync(); } };
  }
};

// ---- enum-flags -------------------------------------------------------------------------------
export const enumFlags = {
  create(ctx) {
    const { t } = ctx;
    const flags = (ctx.hint.presets || []).map((p) => ({ value: Number(p.value), label: p.label })).filter((f) => f.value > 0);
    const box = h('div', { class: 'w-flags', role: 'group', id: ctx.id, 'aria-describedby': ctx.describedBy || undefined, 'aria-labelledby': ctx.labelId || undefined });
    const total = h('output', { class: 'w-flags-total mono', 'aria-live': 'polite' });
    let cur = ctx.value;
    const cbs = flags.map((f) => {
      const cb = h('input', { type: 'checkbox', class: 'w-check', value: String(f.value) });
      cb.addEventListener('change', () => { cur = String(encodeFlags(cbs.filter((c) => c.checked).map((c) => c.value)) | decodeFlags(cur || 0, flags.map((x) => x.value)).unknown); draw(); ctx.onChange(cur); });
      box.appendChild(h('label', { class: 'w-flag' }, [cb, h('span', { class: 'mono w-flag-v', text: String(f.value) }), h('span', { text: f.label })]));
      return cb;
    });
    box.appendChild(h('div', { class: 'w-flags-sum' }, [t('w.flagsTotal', null, 'Value written'), ' ', total]));
    const draw = () => {
      const d = decodeFlags(cur || 0, flags.map((f) => f.value));
      cbs.forEach((c) => { c.checked = cur !== undefined && d.set.includes(Number(c.value)); });
      total.textContent = cur === undefined ? t('w.notSetShort', null, 'not set') : String(cur) + (d.unknown ? ' (+' + d.unknown + ' ' + t('w.flagsUnknown', null, 'unknown bits') + ')' : '');
    };
    draw();
    return { el: box, input: cbs[0], set(v) { cur = v; draw(); } };
  },
  describe(v, hint, t) {
    if (v === undefined || v === '') return '';
    const flags = (hint.presets || []).map((p) => ({ value: Number(p.value), label: p.label }));
    const d = decodeFlags(v, flags.map((f) => f.value));
    if (!d.set.length) return t('w.flagsNone', null, 'No flags: every element is shown.');
    return d.set.map((f) => flags.find((x) => x.value === f).label.replace(/\.$/, '')).join('; ') + '.';
  }
};

// ---- combobox-search --------------------------------------------------------------------------
/** Options for a combobox: { value, label, detail, keywords }. */
export function comboOptions(hint, setting, lang) {
  if (hint.source) return sourceOptions(hint.source, lang);
  if (hint.options) return hint.options.map((o) => ({ value: o, label: o, detail: '', keywords: '' }));
  return choiceValues(hint, setting).map((v) => ({ value: v.value, label: v.value + (hint.valueHelp[v.value] ? '' : ''), detail: hint.valueHelp[v.value] || v.label, keywords: v.label }));
}
export const comboboxSearch = {
  create(ctx) {
    const { t, hint } = ctx;
    const listId = ctx.id + '-list';
    let options = comboOptions(hint, ctx.setting, ctx.lang);
    const multi = !!hint.sep;
    const input = h('input', { type: 'text', id: ctx.id, role: 'combobox', class: 'w-input mono', 'aria-autocomplete': 'list', 'aria-expanded': 'false', 'aria-controls': listId,
      autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off', 'aria-describedby': ctx.describedBy || undefined, placeholder: t('w.typeToSearch', null, 'Type to search') });
    const list = h('ul', { class: 'w-combo-list', id: listId, role: 'listbox', hidden: true, 'aria-label': ctx.label || '' });
    const toggleBtn = h('button', { type: 'button', class: 'w-tool w-combo-open', tabindex: '-1', 'aria-label': t('combo.open', null, 'Show options'), html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' });
    let cur = ctx.value === undefined ? '' : String(ctx.value);
    let items = [], sel = -1;
    const lastPart = () => (multi ? input.value.split(hint.sep).pop().trim() : input.value.trim());
    function open(all) {
      if (hint.source === 'timezones') options = comboOptions(hint, ctx.setting, ctx.lang); // refresh the live clock
      const q = all ? '' : lastPart().toLowerCase();
      const words = q.split(/\s+/).filter(Boolean);
      items = options.filter((o) => words.every((w) => (o.value + ' ' + o.label + ' ' + o.detail + ' ' + o.keywords).toLowerCase().includes(w))).slice(0, 250);
      list.replaceChildren(...items.map((o, i) => {
        const li = h('li', { role: 'option', id: listId + '-' + i, 'aria-selected': String(o.value === cur) }, [h('span', { class: 'w-opt-l', text: o.label }), o.detail ? h('span', { class: 'w-opt-d', text: o.detail }) : null]);
        li.addEventListener('pointerdown', (e) => { e.preventDefault(); pick(i); });
        return li;
      }));
      if (!items.length) list.appendChild(h('li', { class: 'w-opt-empty', 'aria-disabled': 'true', text: hint.allowCustom === false ? t('palette.empty', null, 'No match') : t('w.customValue', null, 'No match: press Enter to use what you typed') }));
      list.hidden = false; input.setAttribute('aria-expanded', 'true');
      sel = Math.max(0, items.findIndex((o) => o.value === cur)); mark();
    }
    function close() { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); }
    function mark() {
      [...list.children].forEach((li, i) => li.classList.toggle('active', i === sel));
      const a = list.children[sel];
      if (a && a.id) { input.setAttribute('aria-activedescendant', a.id); if (a.scrollIntoView) a.scrollIntoView({ block: 'nearest' }); }
    }
    function commitValue(v) {
      if (v === cur) return;
      cur = v; flash(input); ctx.onChange(v === '' ? undefined : v);
    }
    function pick(i) {
      const o = items[i]; if (!o) return;
      if (multi) { const parts = input.value.split(hint.sep).map((x) => x.trim()).filter(Boolean); parts.pop(); parts.push(o.value); input.value = parts.join(hint.sep); }
      else input.value = o.value;
      close(); commitValue(input.value.trim());
    }
    input.addEventListener('input', () => open(false));
    input.addEventListener('focus', () => { if (input.select) input.select(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (list.hidden) open(true); else { sel = Math.min(items.length - 1, sel + 1); mark(); } }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
      else if (e.key === 'Enter') { if (!list.hidden && items[sel] && (items.length || hint.allowCustom === false)) { e.preventDefault(); pick(sel); } else if (hint.allowCustom !== false) { e.preventDefault(); close(); commitValue(input.value.trim()); } }
      else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); close(); input.value = cur; }
    });
    input.addEventListener('blur', () => setTimeout(() => {
      close();
      const typed = input.value.trim();
      if (typed === cur) return;
      if (hint.allowCustom === false && typed && !options.some((o) => o.value === typed)) { input.value = cur; return; }
      commitValue(typed);
    }, 140));
    toggleBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); if (list.hidden) { input.focus(); open(true); } else close(); });
    input.value = cur;
    const el = h('div', { class: 'w-combo' }, [h('div', { class: 'w-row' }, [input, toggleBtn]), list]);
    return { el, input, set(v) { cur = v === undefined ? '' : String(v); input.value = cur; } };
  },
  describe(v, hint, t, ctx) {
    if (v === undefined || v === '') return '';
    if (hint.source === 'timezones') { const z = zoneNow(v); return z ? t('w.tzNow', [z.offset, z.time, z.places], 'UTC{0}, local time now {1} ({2})') : t('w.tzUnknown', null, 'Not a Windows time zone id.'); }
    const opts = comboOptions(hint, ctx && ctx.setting, ctx && ctx.lang);
    const parts = hint.sep ? String(v).split(hint.sep).map((x) => x.trim()).filter(Boolean) : [String(v)];
    const named = parts.map((p) => { const o = opts.find((x) => x.value.toLowerCase() === p.toLowerCase()); return o ? (o.label !== o.value ? o.label + ' (' + p + ')' : o.detail ? p + ': ' + o.detail : p) : p; });
    if (hint.valueHelp && hint.valueHelp[v]) return hint.valueHelp[v];
    return named.join('; ');
  }
};
