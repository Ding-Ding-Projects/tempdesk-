// Builder search: one index over every setting in every mode, section and the full catalog, with
// plain text (all words) or regular expression matching and a Show filter (all / only set / only
// with problems). Pure ES module; the page supplies label lookups and problem lists.
import { countSet, isEmpty } from './catalog.js';
import { hintAt, hintSearchText, firstSentence } from './widgets/index.js';
import { compile, filterItems } from '../regex-builder.mjs';

// Compile a query. Delegates to the shared regex builder's compile (../regex-builder.js).
// useRegex is a boolean or a builder state { regex, flags, wholeWord, caseSensitive }.
// Returns { ok, empty, test(text) -> null | {index, length}, error, errorIndex, slow, compiled }.
export function compileQuery(q, useRegex) {
  const st = useRegex && typeof useRegex === 'object' ? useRegex : { regex: !!useRegex };
  const c = compile(String(q || '').trim(), { regex: !!st.regex, flags: st.flags, wholeWord: !!st.wholeWord, caseSensitive: !!st.caseSensitive, allowSlow: !!st.allowSlow });
  if (c.empty) return { ok: true, empty: true, compiled: c, test: () => ({ index: 0, length: 0 }) };
  if (!c.ok) return { ok: false, error: c.error === 'tooLong' ? c.message : c.error, errorIndex: c.errorIndex, slow: c.slow, compiled: c, test: () => null };
  return { ok: true, compiled: c, test: (s) => { const m = c.find(String(s)); return m ? { index: m.index, length: Math.max(1, m.length) } : null; } };
}

function valueText(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') { if (v['@password'] !== undefined) return ''; return Object.values(v).map(valueText).join(' '); }
  return String(v);
}
function getIn(obj, path) {
  let cur = obj;
  for (const p of path.split('/')) { if (!cur || typeof cur !== 'object') return undefined; cur = cur[p]; }
  return cur;
}

// Builds search entries.
// args: { model, catalog, friendly: [{ id, mode, section, sectionLabel, label, help, value, sensitive, problem }], problems: Set of 'pass|Component|path' }
// Entry: { kind: 'field'|'catalog', id, mode, section, sectionLabel, label, path, help, value, isSet, problem, text, pass, comp }
export function buildIndex({ model, catalog, friendly, problems }) {
  const out = [];
  (friendly || []).forEach((f) => {
    const value = f.sensitive ? '' : valueText(f.value);
    out.push({ kind: 'field', id: f.id, mode: f.mode, section: f.section, sectionLabel: f.sectionLabel, label: f.label, path: f.path || '', help: f.help || '', value, isSet: !!f.isSet, problem: !!f.problem,
      text: [f.label, f.sectionLabel, f.help, f.path, value].join('   ') });
  });
  if (catalog) {
    for (const comp of catalog.components) {
      const walk = (settings, prefix) => {
        for (const s of settings) {
          const path = prefix ? prefix + '/' + s.name : s.name;
          let setPasses = [], val = '';
          for (const pass of comp.passes) {
            const v = getIn((model.all || {})[pass + '|' + comp.name], path);
            if (!isEmpty(v)) { setPasses.push(pass); if (!val && !s.sensitive) val = valueText(v); }
          }
          const problem = !!(problems && comp.passes.some((p) => problems.has(p + '|' + comp.name + '|' + path)));
          const hint = hintAt(comp.name + '|' + (s.hintPath || path)); // descriptions and value meanings are searchable
          out.push({ kind: 'catalog', id: comp.name + '/' + path, comp: comp.name, path, pass: setPasses[0] || (s.passes[0] || comp.passes[0]), section: 'all', sectionLabel: comp.name,
            label: s.name, help: hint && hint.description ? firstSentence(hint.description) : s.help || '', value: val, isSet: setPasses.length > 0, problem, deprecated: s.deprecated,
            text: [comp.name, path, s.name, s.help, val, (s.values || []).map((x) => x.value + ' ' + x.label).join(' '), hintSearchText(hint)].join('   ') });
          if (s.type === 'container' || s.type === 'list') walk(s.children || [], path);
        }
      };
      walk(comp.settings, '');
    }
  }
  return out;
}

// filter: 'all' | 'set' | 'problems'. Returns { ok, error, results: [{entry, match}], sections: Set }
export function search(index, q, { regex = false, filter = 'all', limit = 400 } = {}) {
  const m = compileQuery(q, regex);
  if (!m.ok) return { ok: false, error: m.error, results: [], sections: new Set(), total: 0 };
  const results = [];
  const sections = new Set();
  let total = 0;
  for (const e of index) {
    if (filter === 'set' && !e.isSet) continue;
    if (filter === 'problems' && !e.problem) continue;
    if (m.empty && filter === 'all') continue;
    const hit = m.test(e.text);
    if (!hit) continue;
    total++;
    sections.add(e.kind === 'field' ? e.mode + ':' + e.section : 'all:' + e.comp);
    if (results.length < limit) results.push({ entry: e, match: hit });
  }
  // fields first, then set catalog settings, then the rest
  results.sort((a, b) => (a.entry.kind === 'field' ? 0 : 1) - (b.entry.kind === 'field' ? 0 : 1) || (b.entry.isSet - a.entry.isSet));
  return { ok: true, results, sections, total };
}

// Problems from the shared rules engine: 'where' looks like 'pass/Component/path[index]/...'.
export function problemKeys(issues) {
  const set = new Set();
  (issues || []).forEach((i) => {
    const parts = String(i.where || '').split('/');
    if (parts.length < 3) return;
    const path = parts.slice(2).map((p) => p.replace(/\[\d+\]$/, '')).join('/');
    set.add(parts[0] + '|' + parts[1] + '|' + path);
  });
  return set;
}

// Generic list filter used by list editors, history, presets and pickers. Applies the shared
// 50 ms per-keystroke budget; slow is true when the plain text fallback was used.
export function filterList(items, q, toText, regex) {
  const m = compileQuery(q, regex);
  if (!m.ok) return { ok: false, error: m.error, items: [] };
  const all = items.map((it, i) => ({ it, i }));
  if (m.empty) return { ok: true, items: all };
  const st = regex && typeof regex === 'object' ? regex : { regex: !!regex };
  const r = filterItems(all, (x) => toText(x.it), Object.assign({}, st, { query: String(q || '').trim(), pattern: st.regex ? String(q || '').trim() : '' }));
  return { ok: true, slow: r.slow, items: r.items };
}
export { countSet };
