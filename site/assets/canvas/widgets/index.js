// Setting widgets: the registry of widget kinds and the field card every editor uses.
//
//   fieldCard({ id, label, hint, setting, value, t, onChange(value, meta), ... }) -> { el, set(v), setIssues(list), refresh() }
//
// A card shows the label, a "Changed" dot, risk and sensitive badges, the value control, one line that
// explains what the CURRENT value means (updated live), inline validation (from the widget and from the
// rules engine), an "Unset (use default: X)" button and an expandable "More" panel with the full
// description, example, default, valid passes, risk, related settings and the Microsoft page.
import { h, nextId, flash } from './base.js';
import { toggle, segmented, cards, enumFlags, comboboxSearch } from './choice.js';
import { number, size, duration, time, port } from './numeric.js';
import { ipv4, ipv6, cidr, mac, guid, productKey } from './network.js';
import { text, password, path, commandLine, url, email, registryPath, accountPicker, color, file, multiline, stringList, keyValue } from './text.js';

export const KINDS = {
  toggle, segmented, cards, 'enum-flags': enumFlags, 'combobox-search': comboboxSearch, number, size, duration, time, port, ipv4, ipv6, cidr, mac, guid,
  'product-key': productKey, password, path, 'command-line': commandLine, url, email, 'registry-path': registryPath, 'account-picker': accountPicker,
  color, file, multiline, 'string-list': stringList, 'key-value': keyValue, text
};

// ---- hints registry ---------------------------------------------------------------------------
let registry = new Map();
let docBase = '';
/** Registers the resolved hints ('Component|path' -> hint) from answerfile/widgets.mjs allHints. */
export function registerHints(map, base) { registry = map instanceof Map ? map : new Map(Object.entries(map || {})); if (base) docBase = base; }
export function hintAt(key) { return registry.get(key) || null; }
export function hintCount() { return registry.size; }
/** A hint made from the setting alone, used when widgets.json is not loaded (built-in core catalog). */
export function basicHint(setting) {
  const s = setting || {};
  const values = (s.values || []).map((v) => ({ value: String(v.value), label: v.label || String(v.value) }));
  let widget = 'text';
  if (s.type === 'boolean') widget = 'toggle';
  else if (s.type === 'enum') widget = values.length <= 4 && values.every((v) => v.value.length <= 14) ? 'segmented' : values.length <= 8 ? 'cards' : 'combobox-search';
  else if (s.type === 'integer') widget = 'number';
  else if (s.type === 'password' || s.sensitive) widget = 'password';
  const valueHelp = {};
  values.forEach((v) => { if (v.help) valueHelp[v.value] = v.help; else if (v.label !== v.value) valueHelp[v.value] = v.label; });
  return { widget, description: s.help || '', valueHelp, values: values.length ? values : undefined, min: s.min, max: s.max, maxLength: s.maxLength, default: s.default, risk: { level: 'none' }, related: [], storage: s.type === 'string' && s.sensitive ? 'plain' : undefined };
}
/** First sentence of a description (for search results and compact places). */
export function firstSentence(s) { const m = /^(.+?[.!?])(\s|$)/.exec(String(s || '')); return m ? m[1] : String(s || ''); }
/** Text used to index a hint for search: description and every value meaning. */
export function hintSearchText(hint) { return hint ? [hint.description, Object.entries(hint.valueHelp || {}).map(([k, v]) => k + ' ' + v).join(' '), hint.example || ''].join(' ') : ''; }

// ---- meanings ------------------------------------------------------------------------------------
const lower = (s) => String(s || '').replace(/\.$/, '');
function valueHelpFor(hint, v) {
  if (v === undefined || v === null) return '';
  const vh = hint.valueHelp || {};
  return vh[String(v)] || vh[String(v).toLowerCase()] || '';
}
/** One sentence that explains what the current value means. */
export function meaningOf(v, hint, t, extra) {
  const impl = KINDS[hint.widget] || text;
  if (v === undefined || v === '') {
    const d = hint.default;
    if (d === undefined || d === '') return t('w.unsetMeaning', null, 'Not set: Windows uses its own default.');
    const dm = valueHelpFor(hint, d) || (impl.describe ? impl.describe(String(d), hint, t, extra) : '');
    return t('w.unsetDefault', [d + (dm ? ': ' + lower(dm) : '')], 'Not set: Windows uses its default ({0}).');
  }
  const m = valueHelpFor(hint, v);
  if (m) return m;
  if (impl.describe) { const d = impl.describe(v, hint, t, extra); if (d) return /[.!?)]$/.test(d) ? d : d + '.'; }
  if (hint.widget === 'password' || (extra && extra.sensitive)) return t('w.secretSet', null, 'A value is set (hidden).');
  return t('w.valueIs', [String(v).length > 60 ? String(v).slice(0, 60) + '…' : v], 'Set to {0}.');
}
/** Validation message for a value ('' when fine). */
export function validateValue(v, hint, t) {
  if (v === undefined || v === '') return '';
  const impl = KINDS[hint.widget] || text;
  if (hint.values && hint.values.length && ['segmented', 'cards', 'toggle'].includes(hint.widget) && !hint.values.some((x) => x.value === String(v) || (hint.widget === 'toggle' && x.value.toLowerCase() === String(v).toLowerCase()))) {
    return t('w.errValue', [hint.values.map((x) => x.value).join(', ')], 'Use one of: {0}.');
  }
  return impl.validate ? impl.validate(v, hint, t) || '' : '';
}
function riskNow(hint, v) {
  const r = hint.risk || { level: 'none' };
  if (!r.level || r.level === 'none') return null;
  if (r.when !== undefined && String(v).toLowerCase() !== String(r.when).toLowerCase()) return null;
  return r;
}

// ---- field card --------------------------------------------------------------------------------------
/**
 * o: { id, label, hint, setting, value, t, onChange(v, meta), A (answer.js for password helpers), lang,
 *      passes, allPasses, sensitive, deprecated, issues() -> [{ level, message }], onRelated(key), relatedName(key),
 *      dataPath, paletteGroup, compact, unsetLabel, announce, noUnset, extraHead }
 */
export function fieldCard(o) {
  const t = o.t;
  const hint = o.hint || basicHint(o.setting);
  const impl = KINDS[hint.widget] || text;
  const id = o.id || nextId('wf');
  const ids = { label: id + '-l', meaning: id + '-m', desc: id + '-d', err: id + '-e', more: id + '-x' };
  let cur = o.value === undefined || o.value === null || o.value === '' ? undefined : String(o.value);
  const card = h('div', { class: 'wf' + (o.compact ? ' wf-compact' : ''), 'data-widget': hint.widget, 'data-setting-path': o.dataPath || undefined, 'data-palette-field': o.dataPath ? o.dataPath.replace('/', ' / ') : o.label, 'data-palette-group': o.paletteGroup || undefined });
  const dot = h('span', { class: 'wf-dot', title: t('w.changed', null, 'Changed: set in this file') }, [h('span', { class: 'sr-only', text: t('w.changed', null, 'Changed: set in this file') })]);
  const riskBadge = h('span', { class: 'wf-risk' });
  const head = h('div', { class: 'wf-h' }, [h('label', { class: 'wf-label', id: ids.label, for: id, text: o.label }), dot, riskBadge].concat(
    o.sensitive || hint.widget === 'password' ? [h('span', { class: 'sensitive', text: t('cat.sensitive', null, 'sensitive') })] : [],
    o.deprecated ? [h('span', { class: 'pass-chip', text: t('cat.deprecated', null, 'deprecated') })] : [], o.extraHead || []));
  const meaning = h('p', { class: 'wf-meaning', id: ids.meaning, 'aria-live': 'polite' });
  const err = h('div', { class: 'wf-err', id: ids.err, role: 'status', 'aria-live': 'polite' });
  const issuesBox = h('ul', { class: 'wf-issues', hidden: true });
  const describedBy = [ids.meaning, ids.desc, ids.err].join(' ');
  const widget = impl.create({ id, t, hint, setting: o.setting || {}, value: cur, describedBy, labelId: ids.label, label: o.label, lang: o.lang, A: o.A, announce: o.announce,
    onChange: (v, meta) => change(v === '' ? undefined : v, meta) });
  const control = h('div', { class: 'wf-c' }, [widget.el]);
  // unset and more
  const hasDef = hint.default !== undefined && hint.default !== '';
  const unset = o.noUnset ? null : h('button', { type: 'button', class: 'wf-unset', text: o.unsetLabel || (hasDef ? t('w.unset', [String(hint.default)], 'Unset (use default: {0})') : t('w.unsetNoDefault', null, 'Unset (use the Windows default)')) });
  const moreBtn = h('button', { type: 'button', class: 'wf-more-b', 'aria-expanded': 'false', 'aria-controls': ids.more }, [t('w.more', null, 'More'), h('span', { class: 'wf-caret', 'aria-hidden': 'true', text: '▾' })]);
  const panel = buildPanel();
  panel.hidden = true;
  moreBtn.addEventListener('click', () => { const open = panel.hidden; panel.hidden = !open; moreBtn.setAttribute('aria-expanded', String(open)); card.classList.toggle('open', open); });
  if (unset) unset.addEventListener('click', () => { widget.set(undefined); change(undefined, { unset: true }); flash(control); (widget.input || moreBtn).focus(); });
  const foot = h('div', { class: 'wf-foot' }, [unset, moreBtn]);
  card.append(head, control, meaning, err, issuesBox, foot, panel);

  function buildPanel() {
    const p = h('div', { class: 'wf-panel', id: ids.more });
    p.appendChild(h('p', { class: 'wf-desc', id: ids.desc, text: hint.description || (o.setting && o.setting.help) || '' }));
    const dl = h('dl', { class: 'wf-dl' });
    const row = (k, v) => { if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return; dl.append(h('dt', { text: k }), h('dd', null, [v])); };
    if (hint.example) row(t('w.example', null, 'Example'), h('code', { text: hint.example }));
    if (hint.default !== undefined && hint.default !== '') row(t('studio.default', null, 'Default'), h('span', null, [h('code', { text: String(hint.default) }), valueHelpFor(hint, hint.default) ? ' ' + valueHelpFor(hint, hint.default) : '']));
    if (hint.min !== undefined || hint.max !== undefined) row(t('studio.range', null, 'Range'), (hint.min ?? '') + ' .. ' + (hint.max ?? '') + (hint.unit ? ' ' + hint.unit : ''));
    if (hint.maxLength) row(t('w.maxLength', null, 'Max length'), String(hint.maxLength));
    const passes = o.passes && o.passes.length ? o.passes : null;
    if (passes) row(t('w.validPasses', null, 'Valid passes'), h('span', { class: 'pass-chips' }, passes.map((x) => h('span', { class: 'pass-chip', text: x }))));
    row(t('w.widget', null, 'Control'), hint.widget);
    p.appendChild(dl);
    const vh = Object.entries(hint.valueHelp || {});
    if (vh.length && !['cards'].includes(hint.widget)) p.appendChild(h('ul', { class: 'wf-values' }, vh.map(([k, v]) => h('li', null, [h('code', { text: k }), ' ', v]))));
    if (hint.risk && hint.risk.level && hint.risk.level !== 'none') p.appendChild(h('p', { class: 'wf-riskline ' + hint.risk.level }, [h('b', { text: t('w.risk.' + hint.risk.level, null, hint.risk.level) + ': ' }), (hint.risk.when !== undefined ? t('w.riskWhen', [hint.risk.when], 'when set to {0}. ') : '') + (hint.risk.reason || '')]));
    if (hint.related && hint.related.length) {
      p.appendChild(h('p', { class: 'wf-sub', text: t('studio.related', null, 'Related settings') }));
      p.appendChild(h('div', { class: 'wf-related' }, hint.related.map((k) => h('button', { type: 'button', class: 'wf-rel mono', onclick: () => o.onRelated && o.onRelated(k) }, [o.relatedName ? o.relatedName(k) : k.split('|').pop()]))));
    }
    if (hint.docUrl) p.appendChild(h('a', { class: 'wf-doc', href: hint.docUrl, target: '_blank', rel: 'noopener', text: t('direct.docsSetting', null, 'Microsoft documentation for this setting') }));
    if (o.englishNote) p.appendChild(h('p', { class: 'wf-note', text: o.englishNote }));
    return p;
  }
  function paint() {
    const set = cur !== undefined;
    dot.hidden = !(o.isChanged ? o.isChanged(cur) : set);
    card.classList.toggle('is-set', set);
    if (unset) unset.hidden = !set;
    meaning.textContent = meaningOf(cur, hint, t, { setting: o.setting, lang: o.lang, sensitive: o.sensitive });
    const r = riskNow(hint, cur === undefined ? hint.default : cur);
    riskBadge.hidden = !r || (cur === undefined && r.when !== undefined);
    if (r) { riskBadge.className = 'wf-risk ' + r.level; riskBadge.textContent = t('w.risk.' + r.level, null, r.level); riskBadge.title = r.reason || ''; }
    const e = validateValue(cur, hint, t);
    err.textContent = e;
    card.classList.toggle('bad', !!e);
    const inp = widget.input; if (inp && inp.setAttribute) inp.setAttribute('aria-invalid', String(!!e));
  }
  let issueTimer = null;
  function refreshIssues() {
    if (!o.issues) return;
    const list = o.issues() || [];
    issuesBox.replaceChildren(...list.map((i) => h('li', { class: 'wf-issue ' + (i.level || 'warning') }, [h('span', { class: 'wf-issue-l', text: t('w.level.' + (i.level || 'warning'), null, i.level || 'warning') }), ' ', i.message])));
    issuesBox.hidden = !list.length;
  }
  function change(v, meta) {
    const before = cur;
    cur = v;
    paint();
    if (before !== cur) flash(meaning);
    o.onChange(cur, meta || {});
    clearTimeout(issueTimer); issueTimer = setTimeout(refreshIssues, 450);
  }
  paint(); refreshIssues();
  return {
    el: card, widget, input: widget.input,
    get value() { return cur; },
    set(v) { cur = v === undefined || v === null || v === '' ? undefined : String(v); widget.set(cur); paint(); },
    setIssues(list) { o.issues = () => list; refreshIssues(); },
    refresh: refreshIssues
  };
}

/** A compact card for canvas and template editors that are not catalog settings. */
export function quickField(o) { return fieldCard(Object.assign({ compact: true }, o, { hint: Object.assign({ risk: { level: 'none' }, related: [], valueHelp: {} }, o.hintKey ? hintAt(o.hintKey) || {} : {}, o.hint || {}) })); }
