// Widget hints for the unattend catalog: loads answerfile/widgets.json, assigns every leaf setting a
// widget kind and a plain description, and checks the hints file against the catalog.
// Dependency-free ES module (browsers and Node 18+).
//
//   import { compileWidgets, resolveHint, allHints, validateWidgets } from './widgets.mjs';
//   const W = compileWidgets(widgetsJson);
//   const hint = resolveHint(W, catalog, 'Microsoft-Windows-Shell-Setup', setting);
//   // -> { widget, description, valueHelp, values, risk, related, docUrl, unit, min, max, ... }
//
// Precedence for each field: explicit `settings` entry, then the first matching `shapes` entry, then
// the first matching `rules` entry, then values generated from the catalog (type, name, values).

export const WIDGET_KINDS = [
  'toggle', 'segmented', 'cards', 'combobox-search', 'number', 'size', 'ipv4', 'ipv6', 'cidr', 'mac', 'port',
  'guid', 'product-key', 'password', 'path', 'command-line', 'url', 'email', 'registry-path', 'account-picker',
  'color', 'file', 'multiline', 'string-list', 'key-value', 'time', 'duration', 'enum-flags', 'text'
];
export const RISK_LEVELS = ['none', 'caution', 'danger'];
const ENTRY_FIELDS = new Set(['widget', 'description', 'example', 'default', 'unit', 'min', 'max', 'step', 'valueHelp', 'values', 'risk', 'related', 'docUrl',
  'source', 'presets', 'format', 'sep', 'fieldSep', 'options', 'storage', 'units', 'allowCustom', 'allowIpv6', 'columns', 'maxLength', 'placeholder', 'imageSize', 'accept', 'note']);

// ---- small text helpers ------------------------------------------------------------------------
/** Number of sentences: a period, ! or ? followed by whitespace and a capital (or the end). */
export function sentenceCount(text) {
  const s = String(text || '').trim();
  if (!s) return 0;
  const m = s.match(/[.!?](?=\s+["'(%A-Z0-9]|\s*$)/g);
  return m ? m.length : 1;
}
const PREFIX_RE = /^(?:(?:R2|Windows Server \d{4}(?: R2)?|Windows Vista|Windows 7|Windows 8(?:\.1)?|Windows 10|Windows 11)(?:,\s*|\s+))+(?=[A-Z])/;
/** The catalog help as one clean sentence for a template, or '' when it is not usable. */
export function cleanHelp(help) {
  let s = String(help || '').trim().replace(PREFIX_RE, '');
  if (/\.\.\.$/.test(s)) {
    const cut = s.slice(0, -3);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
    if (end < 30) return '';
    s = cut.slice(0, end + 1).replace(/;$/, '.');
  }
  if (!s || /^(Existing information|This is new in|This is an optional setting|These settings don't apply|Parent Hierarchy|Functionality in|This setting (has been|is) (deprecated|removed|now deprecated)|This setting is deprecated|It was first deprecated|Users can still|This is not used|This information is included|Gadgets are not|Starting with Windows 10|By default, the Initial|Works with other settings|The Wi-Fi Sense|This field should|Theme files can no longer|The default background color during OOBE|Name displayed in the Get Help|You can configure the Trade-in|To customize the Get Help|Used with the setting|Lets the China|Lets the OEM to|Lets you to specify a plan|Use to enable)/.test(s)) return '';
  s = s.replace(/^[A-Z][A-Za-z0-9_]+ (?:\([^)]*\) )?specifies (?=whether|the|a|an|how|when|which)/, 'Sets ');
  s = s.replace(/^[A-Z][A-Za-z0-9_]+ (disables|enables|identifies) /, (m, v) => v[0].toUpperCase() + v.slice(1) + ' ');
  if (/^That\s/.test(s)) s = 'Sets ' + s.slice(5);
  if (/^(Whether|Which|How|In what|When)\b/.test(s)) s = 'Sets ' + s[0].toLowerCase() + s.slice(1);
  else if (/^(The|A|An)\b/.test(s) && !/\b(is|are|was|specifies|sets|controls|holds)\b/.test(s.split(/[.;]/)[0])) s = 'Sets ' + s[0].toLowerCase() + s.slice(1);
  if (/^Choose whether /.test(s)) s = 'Sets whether ' + s.slice(15);
  if (/^Choose /.test(s)) s = 'Sets ' + s.slice(7);
  if (/^Lets you to /.test(s)) s = 'Lets you ' + s.slice(11);
  if (/^Lets the /.test(s)) s = s.replace(/^Lets the /, 'Turns on the ');
  if (!/[.!?]$/.test(s)) s += '.';
  return s.replace(/\s+/g, ' ');
}
function words(name) {
  return String(name).replace(/^f(?=[A-Z])/, '').replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').trim();
}
function lowerWords(name) {
  return words(name).split(/\s+/).map((w, i) => (/^[A-Z0-9]{2,}$/.test(w) || /^[A-Z][A-Z0-9]+s$/.test(w) ? w : w.toLowerCase())).join(' ');
}
/** Lowercases the first word of a sentence fragment unless it looks like a name (Windows Media, IPv4). */
function lowerFirst(s) {
  const m = /^(\S+)(\s+(\S+))?/.exec(s);
  if (!m || /[A-Z].*[A-Z]/.test(m[1]) || (m[3] && /^[A-Z]/.test(m[3]))) return s;
  return s[0].toLowerCase() + s.slice(1);
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
/** Generated true/false meanings from a boolean setting name, or null when the name has no clear verb. */
export function boolMeaning(name) {
  const n = String(name).replace(/^f(?=[A-Z])/, '');
  const rest = (re) => lowerWords(n.replace(re, ''));
  const pairs = [
    [/^Hide/, 'hidden', 'shown'], [/^Show/, 'shown', 'hidden'], [/^Disable/, 'turned off', 'left on'], [/^Enabled?/, 'turned on', 'turned off'],
    [/^Allow/, 'allowed', 'not allowed'], [/^Deny/, 'blocked', 'allowed'], [/^Skip/, 'skipped', 'not skipped'], [/^Prevent/, 'prevented', 'allowed'],
    [/^Use/, 'used', 'not used'], [/^Is/, 'yes', 'no'], [/^Lock/, 'locked', 'unlocked'], [/^Require/, 'required', 'not required'], [/^Persist/, 'kept', 'not kept'], [/^Play/, 'played', 'not played']
  ];
  for (const [re, on, off] of pairs) {
    if (!re.test(n)) continue;
    const what = rest(re);
    if (!what) return null;
    return { true: cap(what) + ': ' + on + '.', false: cap(what) + ': ' + off + '.' };
  }
  return null;
}
function firstSentence(label, value) {
  let s = String(label || '').trim();
  // a label that only repeats the value says nothing about what it means
  if (!s || (value !== undefined && s.toLowerCase().replace(/[.\s]/g, '') === String(value).toLowerCase().replace(/[.\s]/g, ''))) return '';
  if (/\.\.\.$/.test(s)) return '';
  const m = s.match(/^(.+?[.!?])(?=\s+[A-Z]|$)/);
  s = m ? m[1] : s;
  if (!/[.!?]$/.test(s)) s += '.';
  return s.length > 180 ? '' : s;
}

// ---- compiling ---------------------------------------------------------------------------------
function globToRe(glob, isPath) {
  if (!isPath) return new RegExp('^' + String(glob).split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  const parts = String(glob).split('/').map((seg) => (seg === '**' ? '\u0000' : seg.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')));
  let re = parts.join('/').replace(/\u0000\//g, '(?:[^/]+/)*').replace(/\/\u0000$/, '(?:/[^/]+)*').replace(/^\u0000$/, '.*');
  return new RegExp('^' + re + '$');
}
/** Compiles widgets.json (rules to RegExp, shapes to globs). */
export function compileWidgets(json) {
  const j = json || {};
  const rules = (j.rules || []).map((r) => {
    const w = r.when || {};
    return Object.assign({}, r, { test: {
      type: w.type ? [].concat(w.type) : null, name: w.name ? new RegExp(w.name) : null, path: w.path ? new RegExp(w.path) : null,
      component: w.component ? new RegExp(w.component) : null, help: w.help ? new RegExp(w.help, 'i') : null,
      valuesMin: w.valuesMin, valuesMax: w.valuesMax, valueLenMax: w.valueLenMax, valuePattern: w.valuePattern ? new RegExp(w.valuePattern) : null, flags: w.flags, sensitive: w.sensitive, hasMin: w.hasMin
    } });
  });
  const shapes = (j.shapes || []).map((s) => Object.assign({}, s, { compRe: globToRe(s.component || '*', false), pathRe: globToRe(s.path, true) }));
  return { raw: j, rules, shapes, settings: j.settings || {}, components: j.components || {}, typeDefaults: j.typeDefaults || {} };
}
function ruleMatches(t, comp, s) {
  const vals = s.values || [];
  if (t.type && !t.type.includes(s.type)) return false;
  if (t.name && !t.name.test(s.name)) return false;
  if (t.path && !t.path.test(s.path)) return false;
  if (t.component && !t.component.test(comp)) return false;
  if (t.help && !t.help.test(s.help || '')) return false;
  if (t.valuesMin !== undefined && vals.length < t.valuesMin) return false;
  if (t.valuesMax !== undefined && vals.length > t.valuesMax) return false;
  if (t.valueLenMax !== undefined && vals.some((v) => String(v.value).length > t.valueLenMax)) return false;
  if (t.valuePattern && !vals.every((v) => t.valuePattern.test(String(v.value)))) return false;
  if (t.flags !== undefined && !!s.flags !== t.flags) return false;
  if (t.sensitive !== undefined && !!s.sensitive !== t.sensitive) return false;
  if (t.hasMin !== undefined && (s.min !== undefined) !== t.hasMin) return false;
  return true;
}
function fill(text, vars) { return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)); }

/**
 * Resolves the hint for one catalog leaf setting.
 * @param W compiled widgets (compileWidgets)
 * @param catalog raw catalog JSON (for sourceUrls and component lookups); may be null
 * @param compName component name
 * @param s raw catalog setting (path, name, type, values, help, default, min, max, ...)
 */
export function resolveHint(W, catalog, compName, s) {
  const out = { widget: null, description: '', descriptionSource: '', valueHelp: {}, related: [] };
  const vars = { name: s.name, words: lowerWords(s.name), Words: cap(lowerWords(s.name)), help: cleanHelp(s.help), path: s.path, component: compName,
    profile: (/^(Domain|Private|Public)Profile/.exec(s.name) || [])[1] || '' };
  // rules: the first match assigns the widget and its parameters
  for (const r of W.rules) {
    if (!ruleMatches(r.test, compName, s)) continue;
    out.widget = r.widget; out.rule = r.id;
    Object.assign(out, JSON.parse(JSON.stringify(r.set || {})));
    break;
  }
  // shapes: every match merges, earlier shapes win field by field; the explicit entry wins over shapes
  const shapes = W.shapes.filter((x) => x.compRe.test(compName) && x.pathRe.test(s.path)).reverse();
  const explicit = (W.settings[compName] || {})[s.path];
  for (const src of shapes.concat(explicit ? [explicit] : [])) {
    for (const [k, v] of Object.entries(src)) {
      if (!ENTRY_FIELDS.has(k)) continue;
      if (k === 'valueHelp') Object.assign(out.valueHelp, v);
      else if (k === 'description') { out.description = fill(v, vars); out.descriptionSource = src === explicit ? 'explicit' : 'shape'; }
      else if (v === null) delete out[k];
      else out[k] = typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v;
    }
  }
  for (const k of Object.keys(out.valueHelp)) out.valueHelp[k] = fill(out.valueHelp[k], vars);
  if (!out.widget) out.widget = (W.typeDefaults || {})[s.type] || 'text';
  // values: catalog values, or values a hint declares for a free-form string (for example Allowed/Blocked)
  const values = s.values && s.values.length ? s.values.map((v) => ({ value: String(v.value), label: String(v.label || v.value) })) : (out.values || null);
  if (values) out.values = values.map((v) => ({ value: String(v.value), label: v.label || String(v.value) })); else delete out.values;
  // valueHelp for every value (booleans always have true and false)
  if (s.type === 'boolean') {
    const gen = boolMeaning(s.name);
    for (const v of ['true', 'false']) {
      if (out.valueHelp[v]) continue;
      const lab = (values || []).find((x) => x.value.toLowerCase() === v);
      out.valueHelp[v] = (lab && firstSentence(lab.label, v)) || (gen && gen[v]) || '';
    }
  }
  (values || []).forEach((v) => { if (!out.valueHelp[v.value]) out.valueHelp[v.value] = firstSentence(v.label, v.value) || ''; });
  for (const k of Object.keys(out.valueHelp)) if (!out.valueHelp[k]) delete out.valueHelp[k];
  // defaults and limits from the catalog unless the hint says otherwise
  if (out.default === undefined && s.default !== undefined && s.default !== '') out.default = String(s.default);
  if (out.min === undefined && s.min !== undefined) out.min = s.min;
  if (out.max === undefined && s.max !== undefined) out.max = s.max;
  if (out.maxLength === undefined && s.maxLength !== undefined) out.maxLength = s.maxLength;
  if (!out.presets && s.suggestions && s.suggestions.length) out.presets = s.suggestions.map((x) => ({ value: String(x.value), label: firstSentence(x.label) || String(x.value) }));
  // description template, built last so it can name the default and what that default means
  if (!out.description) {
    const comp = W.components[compName] || {};
    const sentences = (vars.help.match(/[^.!?]+[.!?]+(?=\s+["'(A-Z0-9]|\s*$)/g) || []).map((x) => x.trim());
    const help = sentences.length ? sentences.slice(0, 2).join(' ') : fill(W.raw.fallbackSentence || '', vars);
    const dv = out.default;
    let defaultText = '';
    if (dv !== undefined && dv !== '') {
      const vh = out.valueHelp[dv] || out.valueHelp[String(dv).toLowerCase()] || '';
      defaultText = ', which is ' + dv + (vh ? ' (' + lowerFirst(vh.replace(/\.$/, '')) + ')' : '');
    }
    const unset = fill((W.raw.unsetSentences || {})[s.type] || (W.raw.unsetSentences || {}).default || '', Object.assign({}, vars, { defaultText }));
    const parts = [help];
    if (comp.context && sentenceCount(help) < 3) parts.push(comp.context);
    parts.push(unset);
    while (parts.length > 2 && sentenceCount(parts.join(' ')) > 4) parts.splice(1, 1);
    out.description = parts.filter(Boolean).join(' ');
    out.descriptionSource = sentences.length ? 'template' : 'fallback';
  }
  if (!out.risk) out.risk = { level: 'none' };
  out.related = (out.related || []).map((p) => (p.includes('|') ? p : compName + '|' + p));
  if (!out.docUrl && catalog) {
    const c = (catalog.components || []).find((x) => x.name === compName);
    const base = (catalog.sourceUrls || {})[(c && c.reference) || 'current'] || '';
    const slug = s.doc || (c && c.doc);
    if (base && slug) out.docUrl = base + slug;
  }
  return out;
}

/** Walks every leaf (non-container, non-list) setting of the raw catalog. */
export function leafSettings(catalog) {
  const out = [];
  for (const comp of (catalog && catalog.components) || []) {
    (function walk(list) {
      for (const s of list || []) {
        if (s.type === 'container') walk(s.children);
        else if (s.type === 'list') walk(s.listItem && s.listItem.settings);
        else out.push({ comp: comp.name, setting: s });
      }
    })(comp.settings);
  }
  return out;
}
/** Map 'Component|path' -> hint for every leaf setting. */
export function allHints(W, catalog) {
  const m = new Map();
  for (const { comp, setting } of leafSettings(catalog)) m.set(comp + '|' + setting.path, resolveHint(W, catalog, comp, setting));
  return m;
}

/**
 * Checks widgets.json against the catalog. Returns a list of problems (strings); empty means valid.
 * Every leaf needs a known widget and a 2 to 4 sentence description, every enum and boolean value needs
 * a valueHelp sentence, and explicit entries must point at real settings and values.
 */
export function validateWidgets(json, catalog) {
  const problems = [];
  const W = compileWidgets(json);
  const index = new Map(leafSettings(catalog).map((x) => [x.comp + '|' + x.setting.path, x]));
  for (const r of json.rules || []) if (!WIDGET_KINDS.includes(r.widget)) problems.push('rule ' + r.id + ': unknown widget ' + r.widget);
  for (const s of json.shapes || []) {
    if (s.widget && !WIDGET_KINDS.includes(s.widget)) problems.push('shape ' + s.path + ': unknown widget ' + s.widget);
    for (const k of Object.keys(s)) if (!ENTRY_FIELDS.has(k) && k !== 'component' && k !== 'path') problems.push('shape ' + s.path + ': unknown field ' + k);
    const re = W.shapes.find((x) => x.path === s.path && x.component === s.component);
    if (![...index.values()].some((x) => re.compRe.test(x.comp) && re.pathRe.test(x.setting.path))) problems.push('shape ' + (s.component || '*') + ' ' + s.path + ' matches no setting');
  }
  for (const [comp, entries] of Object.entries(json.settings || {})) {
    for (const [p, e] of Object.entries(entries)) {
      const x = index.get(comp + '|' + p);
      if (!x) { problems.push('settings ' + comp + '|' + p + ': not a leaf setting in the catalog'); continue; }
      if (e.widget && !WIDGET_KINDS.includes(e.widget)) problems.push(comp + '|' + p + ': unknown widget ' + e.widget);
      for (const k of Object.keys(e)) if (!ENTRY_FIELDS.has(k)) problems.push(comp + '|' + p + ': unknown field ' + k);
      const vals = (x.setting.values || []).map((v) => String(v.value));
      if (e.valueHelp && vals.length) for (const k of Object.keys(e.valueHelp)) if (!vals.includes(k)) problems.push(comp + '|' + p + ': valueHelp for unknown value ' + k);
    }
  }
  for (const c of Object.keys(json.components || {})) if (!(catalog.components || []).some((x) => x.name === c)) problems.push('components ' + c + ': not in the catalog');
  for (const [key, x] of index) {
    const h = resolveHint(W, catalog, x.comp, x.setting);
    if (!WIDGET_KINDS.includes(h.widget)) problems.push(key + ': no widget');
    const n = sentenceCount(h.description);
    if (!h.description) problems.push(key + ': no description');
    else if (n < 2 || n > 4) problems.push(key + ': description has ' + n + ' sentences');
    if (/\.\.\.|\u2014/.test(h.description)) problems.push(key + ': description has an ellipsis or em dash');
    if (h.risk && !RISK_LEVELS.includes(h.risk.level)) problems.push(key + ': bad risk level');
    if (h.risk && h.risk.level !== 'none' && !h.risk.reason) problems.push(key + ': risk without a reason');
    const t = x.setting.type;
    if (t === 'enum' || t === 'boolean') {
      const vals = t === 'boolean' ? ['true', 'false'] : (x.setting.values || []).map((v) => String(v.value));
      for (const v of vals) if (!h.valueHelp[v]) problems.push(key + ': no valueHelp for ' + v);
    }
    for (const v of Object.values(h.valueHelp)) if (/\.\.\.$|\u2014/.test(v)) problems.push(key + ': valueHelp has an ellipsis or em dash');
    for (const r of h.related) if (!index.has(r) && !/\|[^|]+$/.test(r)) problems.push(key + ': related ' + r + ' is not a setting');
  }
  return problems;
}
