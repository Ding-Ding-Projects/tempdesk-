// Numeric widgets: number (stepper and optional slider), size (unit switch and disk percentage),
// duration (unit aware with a human preview), time (HH:MM stored as minutes) and port.
import { h, textInput, toolButton, flash, presetChips } from './base.js';
import { parseSize, formatSize, convertSize, SIZE_UNITS, parseDuration, humanDuration, DURATION_UNITS, minutesToClock, clockToMinutes, parsePort } from './format.js';

function limits(hint) { return { min: hint.min !== undefined ? Number(hint.min) : undefined, max: hint.max !== undefined ? Number(hint.max) : undefined, step: Number(hint.step || 1) }; }
export function checkNumber(v, hint) {
  if (v === undefined || v === '') return '';
  if (!/^-?\d+$/.test(String(v).trim())) return 'int';
  const n = Number(v), l = limits(hint);
  if (l.min !== undefined && n < l.min) return 'min';
  if (l.max !== undefined && n > l.max) return 'max';
  return '';
}

// ---- number -------------------------------------------------------------------------------------
export const number = {
  create(ctx) {
    const { t, hint } = ctx;
    const l = limits(hint);
    let cur = ctx.value === undefined ? '' : String(ctx.value);
    const inp = textInput({ id: ctx.id, value: cur, inputmode: 'numeric', mono: true, describedBy: ctx.describedBy, placeholder: hint.default !== undefined ? String(hint.default) : '' });
    inp.setAttribute('role', 'spinbutton');
    if (l.min !== undefined) inp.setAttribute('aria-valuemin', l.min);
    if (l.max !== undefined) inp.setAttribute('aria-valuemax', l.max);
    const unit = hint.unit ? h('span', { class: 'w-unit', text: hint.unit }) : null;
    const slider = l.min !== undefined && l.max !== undefined && l.max - l.min <= 100000 ? h('input', { type: 'range', class: 'w-range', min: l.min, max: l.max, step: l.step, 'aria-label': t('w.slider', [ctx.label || ''], '{0} slider'), tabindex: '-1' }) : null;
    const base = () => (cur === '' ? Number(hint.default !== undefined ? hint.default : l.min !== undefined ? l.min : 0) : Number(cur));
    const clamp = (n) => Math.min(l.max !== undefined ? l.max : Infinity, Math.max(l.min !== undefined ? l.min : -Infinity, n));
    const sync = () => { inp.value = cur; if (cur !== '') inp.setAttribute('aria-valuenow', cur); else inp.removeAttribute('aria-valuenow'); if (slider) slider.value = String(cur === '' ? base() : cur); };
    const set = (v, fromTyping) => { cur = v; if (!fromTyping) { sync(); flash(inp); } else if (slider && /^-?\d+$/.test(v)) slider.value = v; ctx.onChange(cur === '' ? undefined : cur); };
    const step = (d) => set(String(clamp((Number.isFinite(base()) ? base() : 0) + d * l.step)));
    inp.addEventListener('input', () => set(inp.value.trim(), true));
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); step((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)); }
      if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); step((e.key === 'PageUp' ? 10 : -10)); }
    });
    if (slider) slider.addEventListener('input', () => set(slider.value));
    const minus = toolButton('−', t('w.decrease', null, 'Decrease'), () => step(-1));
    const plus = toolButton('+', t('w.increase', null, 'Increase'), () => step(1));
    sync();
    const el = h('div', { class: 'w-number' }, [h('div', { class: 'w-row' }, [minus, h('div', { class: 'w-affix' }, [inp, unit]), plus]), slider, presetChips(hint.presets, (v) => set(v), t)]);
    return { el, input: inp, set(v) { cur = v === undefined ? '' : String(v); sync(); } };
  },
  validate(v, hint, t) {
    const e = checkNumber(v, hint);
    return e === 'int' ? t('cat.errInt', null, 'Enter a whole number.') : e === 'min' ? t('cat.errMin', [hint.min], 'Minimum {0}.') : e === 'max' ? t('cat.errMax', [hint.max], 'Maximum {0}.') : '';
  },
  describe(v, hint) { return v === undefined || v === '' ? '' : String(v) + (hint.unit ? ' ' + hint.unit : ''); }
};

// ---- size ---------------------------------------------------------------------------------------
const UNITS = ['KB', 'MB', 'GB', 'TB'];
let lastDiskMB = 128000;
export const size = {
  create(ctx) {
    const { t, hint } = ctx;
    const storage = hint.storage || 'MB';
    let cur = ctx.value === undefined ? '' : String(ctx.value);
    const shown = cur !== '' ? formatSize(cur, storage) : { value: '', unit: storage === 'B' ? 'MB' : storage === 'KB' ? 'MB' : 'GB' };
    let unit = UNITS.includes(shown.unit) ? shown.unit : 'MB';
    const inp = textInput({ id: ctx.id, value: shown.value, inputmode: 'decimal', mono: true, describedBy: ctx.describedBy, placeholder: hint.default !== undefined ? formatSize(hint.default, storage).text : '' });
    const seg = h('div', { class: 'w-seg w-seg-sm', role: 'radiogroup', 'aria-label': t('w.unit', null, 'Unit') });
    const ubs = UNITS.filter((u) => SIZE_UNITS[u] >= SIZE_UNITS[storage] || u === 'MB').map((u) => h('button', { type: 'button', role: 'radio', class: 'w-seg-b', 'data-unit': u, onclick: () => { const v = inp.value.trim(); unit = u; if (v && cur !== '') inp.value = String(Math.round(convertSize(cur, storage, u) * 100) / 100); mark(); } }, [u]));
    ubs.forEach((b) => seg.appendChild(b));
    const mark = () => ubs.forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.unit === unit)); b.tabIndex = b.dataset.unit === unit ? 0 : -1; });
    const disk = h('input', { type: 'text', class: 'w-input w-input-sm mono', inputmode: 'numeric', value: String(Math.round((hint.diskMB || lastDiskMB) / 1024)), 'aria-label': t('w.diskSize', null, 'Disk size for the percentage (GB)'), readonly: hint.diskMB ? true : undefined });
    const bar = h('div', { class: 'w-meter', 'aria-hidden': 'true' }, [h('i')]);
    const pct = h('span', { class: 'w-pct', 'aria-live': 'polite' });
    const showPct = storage === 'MB' && (!!hint.diskMB || /Partition|PageFile|ExtendOSPartition/.test(ctx.setting ? ctx.setting.path || '' : ''));
    const drawPct = () => {
      if (!showPct) return;
      const d = Number(disk.value) * 1024;
      if (cur === '' || !d) { pct.textContent = ''; bar.firstChild.style.width = '0'; return; }
      const p = Math.round((Number(cur) / d) * 1000) / 10;
      pct.textContent = t('w.ofDisk', [p, disk.value], '{0}% of a {1} GB disk');
      bar.firstChild.style.width = Math.min(100, p) + '%';
      bar.classList.toggle('over', p > 100);
    };
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      const n = v === '' ? null : parseSize(v, storage, unit);
      cur = v === '' ? '' : n === null ? v : String(n);
      drawPct();
      ctx.onChange(cur === '' ? undefined : cur);
    });
    disk.addEventListener('input', () => { if (!hint.diskMB) lastDiskMB = Number(disk.value) * 1024 || lastDiskMB; drawPct(); });
    mark(); drawPct();
    const el = h('div', { class: 'w-size' }, [h('div', { class: 'w-row' }, [inp, seg]),
      showPct ? h('div', { class: 'w-row w-size-disk' }, [h('label', { class: 'w-mini' }, [t('w.diskOf', null, 'Disk'), ' ', disk, ' GB']), bar, pct]) : null,
      presetChips(hint.presets, (v) => { cur = v; inp.value = formatSize(v, storage).value; drawPct(); flash(inp); ctx.onChange(v); }, t)]);
    return { el, input: inp, set(v) { cur = v === undefined ? '' : String(v); const f = cur !== '' ? formatSize(cur, storage) : { value: '' }; if (UNITS.includes(f.unit)) unit = f.unit; inp.value = f.value; mark(); drawPct(); } };
  },
  validate(v, hint, t) { if (v === undefined || v === '') return ''; if (!/^\d+$/.test(String(v))) return t('w.errSize', null, 'Enter a size such as 300 MB or 1.5 GB.'); return number.validate(v, hint, t); },
  describe(v, hint, t) { return v === undefined || v === '' ? '' : formatSize(v, hint.storage || 'MB').text + (hint.storage && hint.storage !== 'MB' ? '' : '') + ' (' + Number(v).toLocaleString('en-US') + ' ' + (hint.storage || 'MB') + ' ' + t('w.written', null, 'written') + ')'; }
};

// ---- duration -----------------------------------------------------------------------------------
export const duration = {
  create(ctx) {
    const { t, hint } = ctx;
    const unit = hint.unit || 's';
    let cur = ctx.value === undefined ? '' : String(ctx.value);
    const inp = textInput({ id: ctx.id, value: cur, mono: true, describedBy: ctx.describedBy, placeholder: t('w.durationPh', null, 'for example 90s, 2m 30s, 1h') });
    const unitLab = h('span', { class: 'w-unit', text: unit });
    const preview = h('span', { class: 'w-preview', 'aria-live': 'polite' });
    const draw = () => { preview.textContent = cur !== '' && /^\d+$/.test(cur) ? '= ' + humanDuration(cur, unit) : ''; };
    inp.addEventListener('input', () => { const v = inp.value.trim(); const n = v === '' ? null : parseDuration(v, unit); cur = v === '' ? '' : n === null ? v : String(n); draw(); ctx.onChange(cur === '' ? undefined : cur); });
    inp.addEventListener('blur', () => { if (/^\d+$/.test(cur) && inp.value.trim() !== cur) { inp.value = cur; flash(inp); } });
    draw();
    const el = h('div', { class: 'w-duration' }, [h('div', { class: 'w-row' }, [h('div', { class: 'w-affix' }, [inp, unitLab]), preview]), presetChips(hint.presets, (v) => { cur = v; inp.value = v; draw(); ctx.onChange(v); }, t)]);
    return { el, input: inp, set(v) { cur = v === undefined ? '' : String(v); inp.value = cur; draw(); } };
  },
  validate(v, hint, t) { if (v === undefined || v === '') return ''; if (!/^\d+$/.test(String(v))) return t('w.errDuration', null, 'Enter a duration such as 30s, 5m or 1h 30m.'); return number.validate(v, hint, t); },
  describe(v, hint) { return v === undefined || v === '' ? '' : humanDuration(v, hint.unit || 's') + ' (' + v + ' ' + (hint.unit || 's') + ')'; }
};

// ---- time (stored as minutes past midnight) ---------------------------------------------------
export const time = {
  create(ctx) {
    const { t } = ctx;
    let cur = ctx.value === undefined ? '' : String(ctx.value);
    const inp = h('input', { type: 'time', id: ctx.id, class: 'w-input mono', step: '60', value: cur !== '' ? minutesToClock(cur) : '', 'aria-describedby': ctx.describedBy || undefined });
    const raw = h('span', { class: 'w-preview', 'aria-live': 'polite' });
    const draw = () => { raw.textContent = cur !== '' ? t('w.minutesPast', [cur], '{0} minutes past midnight') : ''; };
    inp.addEventListener('change', () => { const m = clockToMinutes(inp.value); cur = m === null ? '' : String(m); draw(); flash(inp); ctx.onChange(cur === '' ? undefined : cur); });
    draw();
    return { el: h('div', { class: 'w-row' }, [inp, raw]), input: inp, set(v) { cur = v === undefined ? '' : String(v); inp.value = cur !== '' ? minutesToClock(cur) : ''; draw(); } };
  },
  validate(v, hint, t) { return v === undefined || v === '' || (minutesToClock(v) !== '') ? '' : t('w.errTime', null, 'Enter a time between 00:00 and 23:59.'); },
  describe(v, hint, t) { return v === undefined || v === '' ? '' : t('w.timeAt', [minutesToClock(v)], 'At {0} local time'); }
};

// ---- port ---------------------------------------------------------------------------------------
export const port = {
  create(ctx) {
    const { t } = ctx;
    let cur = ctx.value === undefined ? '' : String(ctx.value);
    const inp = textInput({ id: ctx.id, value: cur, inputmode: 'numeric', mono: true, describedBy: ctx.describedBy, maxLength: 5, placeholder: '1 to 65535' });
    const name = h('span', { class: 'w-preview', 'aria-live': 'polite' });
    const draw = () => { const p = parsePort(cur); name.textContent = p.ok && p.name ? p.name : ''; };
    inp.addEventListener('input', () => { cur = inp.value.trim(); draw(); ctx.onChange(cur === '' ? undefined : cur); });
    draw();
    return { el: h('div', { class: 'w-row' }, [inp, name]), input: inp, set(v) { cur = v === undefined ? '' : String(v); inp.value = cur; draw(); } };
  },
  validate(v, hint, t) { return v === undefined || v === '' || parsePort(v).ok ? '' : t('w.errPort', null, 'Enter a port from 1 to 65535.'); },
  describe(v, hint, t) { const p = parsePort(v); return p.ok ? t('w.portIs', [p.value, p.name ? ' (' + p.name + ')' : ''], 'TCP or UDP port {0}{1}') : ''; }
};
