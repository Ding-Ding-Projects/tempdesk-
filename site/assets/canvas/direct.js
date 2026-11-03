// Direct mode: the answer file IS the catalog model (passes > components > settings, list items,
// servicing packages and raw blocks). No template fields. XML is written only by
// answerfile/generate.mjs buildXml and read back only by its parseXml, so editing is two-way.
// Pure ES module. `gen` is the generate.mjs module and `cat` the raw catalog JSON; `A` (answer.js)
// is passed in where a function needs it.
//
// direct = {
//   architecture: 'amd64',
//   all: { 'pass|Component': nested value },   // same nested format as the studio forms use
//   servicing: [ package ],                     // generate.mjs servicing shape
//   offlineImage: { source } | undefined,
//   rawBlocks: [ { id, scope: 'top'|'servicing'|'pass'|'inside', pass, component, parent, xml } ]
// }
// Nested format: containers are objects, lists are arrays, wcm:keyValue is '@keyValue', the text of a
// keyValue item is '#text', a password is { '@password': text } ('@plain': true keeps it plain text),
// a non-add wcm:action is '@action'.

export const PASSES = ['windowsPE', 'offlineServicing', 'generalize', 'specialize', 'auditSystem', 'auditUser', 'oobeSystem'];
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export function blankDirect() { return { architecture: 'amd64', all: {}, servicing: [], rawBlocks: [] }; }

function compOf(cat, name) {
  const low = String(name).toLowerCase();
  return cat.components.find((c) => c.name === name) || cat.components.find((c) => c.name.toLowerCase() === low) || null;
}
const byName = (settings, name) => (settings || []).find((s) => s.name === name) || (settings || []).find((s) => s.name.toLowerCase() === String(name).toLowerCase()) || null;
const scalar = (v) => (typeof v === 'boolean' ? (v ? 'true' : 'false') : v === null || v === undefined ? '' : String(v));

// ---- nested <-> generate.mjs flat format ----------------------------------------------------
function nestedToFlat(settings, obj, prefix, out) {
  for (const k of Object.keys(obj || {})) {
    if (k[0] === '@' || k === '#text') continue;
    const s = byName(settings, k);
    const rel = prefix ? prefix + '/' + (s ? s.name : k) : (s ? s.name : k);
    const v = obj[k];
    if (!s) { out[rel] = v; continue; } // unknown: buildXml (strict) will report it
    if (s.type === 'list') {
      out[rel] = (Array.isArray(v) ? v : [v]).map((it) => itemToFlat(s.listItem, it));
    } else if (s.encodedPassword) {
      const pw = v && typeof v === 'object' ? (v['@password'] !== undefined ? v['@password'] : v.Value !== undefined ? scalar(v.Value) : '') : scalar(v);
      out[rel + '/Value'] = pw;
      out[rel + '/PlainText'] = !!(v && typeof v === 'object' && (v['@plain'] === true || /^true$/i.test(scalar(v.PlainText))));
    } else if (s.type === 'container') {
      if (v && typeof v === 'object') nestedToFlat(s.children || [], v, rel, out);
    } else {
      out[rel] = v && typeof v === 'object' ? scalar(v['#text']) : scalar(v);
    }
  }
  return out;
}
function itemToFlat(li, it) {
  const out = {};
  if (it && typeof it === 'object' && it['@action']) out._action = it['@action'];
  if (li.keyStyle === 'keyValue') {
    out.Key = it && typeof it === 'object' ? scalar(it['@keyValue']) : '';
    if (li.valueStyle === 'text') { out.Value = it && typeof it === 'object' ? scalar(it['#text']) : scalar(it); return out; }
  }
  if (it && typeof it === 'object') nestedToFlat(li.keyStyle === 'keyValue' ? li.settings.filter((s) => s.name !== li.key) : li.settings, it, '', out);
  return out;
}
function flatToNested(settings, flat, prefix) {
  const out = {};
  for (const s of settings || []) {
    const rel = prefix ? prefix + '/' + s.name : s.name;
    if (s.type === 'list') {
      if (Array.isArray(flat[rel])) out[s.name] = flat[rel].map((it) => itemToNested(s.listItem, it));
    } else if (s.encodedPassword) {
      if ((rel + '/Value') in flat) {
        const v = { '@password': scalar(flat[rel + '/Value']) };
        if (flat[rel + '/PlainText'] === true || /^true$/i.test(scalar(flat[rel + '/PlainText']))) v['@plain'] = true;
        out[s.name] = v;
      }
    } else if (s.type === 'container') {
      const c = flatToNested(s.children || [], flat, rel);
      if (Object.keys(c).length) out[s.name] = c;
    } else if (rel in flat && flat[rel] !== undefined && flat[rel] !== null) {
      out[s.name] = scalar(flat[rel]);
    }
  }
  return out;
}
function itemToNested(li, it) {
  const out = {};
  if (it._action) out['@action'] = it._action;
  if (li.keyStyle === 'keyValue') {
    out['@keyValue'] = scalar(it.Key);
    if (li.valueStyle === 'text') { out['#text'] = scalar(it.Value); return out; }
  }
  Object.assign(out, flatToNested(li.keyStyle === 'keyValue' ? li.settings.filter((s) => s.name !== li.key) : li.settings, it, ''));
  return out;
}

/** Direct model -> generate.mjs model. */
export function toGenModel(direct, cat) {
  const m = { architecture: direct.architecture || 'amd64', passes: {} };
  for (const key of Object.keys(direct.all || {})) {
    const [pass, name] = key.split('|');
    const comp = compOf(cat, name);
    m.passes[pass] = m.passes[pass] || {};
    m.passes[pass][comp ? comp.name : name] = comp ? nestedToFlat(comp.settings, direct.all[key], '', {}) : {};
  }
  if (direct.servicing && direct.servicing.length) m.servicing = clone(direct.servicing);
  if (direct.offlineImage && direct.offlineImage.source) m.offlineImage = clone(direct.offlineImage);
  if (direct.architectureOverrides) m.architectureOverrides = clone(direct.architectureOverrides);
  return m;
}
/** generate.mjs model -> direct model (raw blocks are kept from `keep`). */
export function fromGenModel(gm, cat, keep) {
  const d = blankDirect();
  d.architecture = gm.architecture || 'amd64';
  for (const pass of PASSES) {
    for (const [name, flat] of Object.entries((gm.passes || {})[pass] || {})) {
      const comp = compOf(cat, name);
      if (!comp) continue;
      d.all[pass + '|' + comp.name] = flatToNested(comp.settings, flat || {}, '');
    }
  }
  d.servicing = clone(gm.servicing || []);
  if (gm.offlineImage && gm.offlineImage.source) d.offlineImage = clone(gm.offlineImage);
  if (gm.architectureOverrides) d.architectureOverrides = clone(gm.architectureOverrides);
  d.rawBlocks = clone((keep && keep.rawBlocks) || []);
  return d;
}

// ---- XML tree helpers (generate.mjs parseXmlTree nodes: { name, attrs, children, text }) ------
const localName = (n) => String(n).split(':').pop();
const escText = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => escText(s).replace(/"/g, '&quot;');
export function serializeNode(node, depth, indent) {
  indent = indent === undefined ? '    ' : indent;
  const pad = indent.repeat(depth || 0);
  const attrs = Object.entries(node.attrs || {}).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  if (node.children && node.children.length) {
    return pad + `<${node.name}${attrs}>\n` + node.children.map((c) => serializeNode(c, (depth || 0) + 1, indent)).join('\n') + '\n' + pad + `</${node.name}>`;
  }
  const t = node.text || '';
  return t === '' && /^(assemblyIdentity|source|selection|offlineImage|cpi:offlineImage)$/.test(node.name) ? pad + `<${node.name}${attrs} />` : pad + `<${node.name}${attrs}>${escText(t)}</${node.name}>`;
}
function splitXpath(xp) {
  const out = []; let cur = '', q = false, b = 0;
  for (const ch of xp) {
    if (ch === "'") q = !q;
    if (!q && ch === '[') b++;
    if (!q && ch === ']') b--;
    if (ch === '/' && !q && !b) { if (cur) out.push(cur); cur = ''; } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
function parseSeg(seg) {
  const m = /^([^\[]+)(?:\[(?:@(\w+)='([^']*)'|(\d+))\])?$/.exec(seg);
  return m ? { name: m[1], attr: m[2], val: m[3], index: m[4] ? Number(m[4]) : 1 } : null;
}
function stepTo(node, seg) {
  const p = parseSeg(seg);
  if (!p) return null;
  const kids = node.children.filter((c) => localName(c.name) === p.name && (!p.attr || c.attrs[p.attr] === p.val));
  return kids[p.attr ? 0 : p.index - 1] || null;
}

/** Splits the unknown xpaths reported by parseXml into raw blocks with their serialized XML. */
// Resolves a parseXml xpath to its node, trying every sibling that matches an attribute step (answer
// files may repeat <settings pass="..."> blocks).
function resolve(node, segs, i) {
  if (i >= segs.length) return node;
  const p = parseSeg(segs[i]);
  if (!p) return null;
  const kids = node.children.filter((c) => localName(c.name) === p.name && (!p.attr || c.attrs[p.attr] === p.val));
  const cands = p.attr ? kids : [kids[p.index - 1]].filter(Boolean);
  for (const c of cands) { const r = resolve(c, segs, i + 1); if (r) return r; }
  return null;
}
export function extractRawBlocks(root, unknown) {
  const blocks = [];
  let n = 0;
  for (const xp of unknown) {
    const segs = splitXpath(xp);
    if (segs[0] !== 'unattend') continue;
    const node = resolve(root, segs, 1);
    if (!node) continue;
    const xml = serializeNode(node, 0);
    const first = parseSeg(segs[1] || '');
    if (segs.length === 2) { blocks.push({ id: 'r' + (++n), scope: 'top', xml }); continue; }
    if (first && first.name === 'servicing') { blocks.push({ id: 'r' + (++n), scope: 'servicing', xml }); continue; }
    const pass = first && first.attr === 'pass' ? first.val : null;
    if (!pass) { blocks.push({ id: 'r' + (++n), scope: 'top', xml }); continue; }
    if (segs.length === 3) { blocks.push({ id: 'r' + (++n), scope: 'pass', pass, xml }); continue; }
    const c = parseSeg(segs[2]);
    blocks.push({ id: 'r' + (++n), scope: 'inside', pass, component: c && c.val, parent: segs.slice(3, -1).join('/'), xml });
  }
  return blocks;
}
function ensureChild(parent, seg) {
  const found = stepTo(parent, seg);
  if (found) return found;
  const p = parseSeg(seg);
  const el = { name: p.name, attrs: p.attr ? { [p.attr]: p.val } : {}, children: [], text: '' };
  parent.children.push(el);
  return el;
}
/** Inserts raw blocks into XML written by buildXml. Returns the same text when there are none. */
export function insertRawBlocks(xml, blocks, gen) {
  if (!blocks || !blocks.length) return xml;
  const root = gen.parseXmlTree(xml);
  const nodeOf = (b) => gen.parseXmlTree(b.xml);
  for (const b of blocks) {
    const node = nodeOf(b);
    if (b.scope === 'top') { root.children.push(node); continue; }
    if (b.scope === 'servicing') {
      let s = root.children.find((c) => localName(c.name) === 'servicing');
      if (!s) { s = { name: 'servicing', attrs: {}, children: [], text: '' }; root.children.unshift(s); }
      s.children.push(node); continue;
    }
    let settings = root.children.find((c) => localName(c.name) === 'settings' && c.attrs.pass === b.pass);
    if (!settings) {
      settings = { name: 'settings', attrs: { pass: b.pass }, children: [], text: '' };
      const order = PASSES.indexOf(b.pass);
      const at = root.children.findIndex((c) => localName(c.name) === 'settings' && PASSES.indexOf(c.attrs.pass) > order);
      if (at < 0) root.children.push(settings); else root.children.splice(at, 0, settings);
    }
    if (b.scope === 'pass') { settings.children.push(node); continue; }
    let comp = settings.children.find((c) => localName(c.name) === 'component' && c.attrs.name === b.component);
    if (!comp) { comp = { name: 'component', attrs: { name: b.component }, children: [], text: '' }; settings.children.push(comp); }
    let parent = comp;
    for (const seg of String(b.parent || '').split('/').filter(Boolean)) parent = ensureChild(parent, seg);
    parent.children.push(node);
  }
  return '<?xml version="1.0" encoding="utf-8"?>\n' + serializeNode(root, 0) + '\n';
}

/** Direct model -> XML (generate.mjs buildXml, plus raw blocks). Throws on invalid content. */
export function buildDirectXml(direct, cat, gen) {
  return insertRawBlocks(gen.buildXml(toGenModel(direct, cat), cat), direct.rawBlocks, gen);
}
/** XML -> direct model (generate.mjs parseXml). Unknown elements become raw blocks. */
export function importDirect(xml, cat, gen) {
  const r = gen.parseXml(xml, cat);
  const root = gen.parseXmlTree(xml);
  const rawBlocks = extractRawBlocks(root, r.unknown);
  const d = fromGenModel(r.model, cat, { rawBlocks });
  return { direct: d, unknown: r.unknown, warnings: r.warnings };
}
/** Issues from the rules engine for a direct model. */
export function directIssues(direct, cat, gen) { return gen.validateModel(toGenModel(direct, cat), cat); }
/** Applies a rule's automatic fix. Returns a new direct model or null. */
export function directFix(direct, cat, gen, ruleId) {
  const fixed = gen.applyFix(toGenModel(direct, cat), cat, ruleId);
  return fixed ? fromGenModel(fixed, cat, direct) : null;
}

// ---- component edits -----------------------------------------------------------------------
export function addComponent(direct, pass, name) {
  const d = clone(direct);
  const key = pass + '|' + name;
  if (!d.all[key]) d.all[key] = {};
  return d;
}
export function removeComponent(direct, key) { const d = clone(direct); delete d.all[key]; return d; }
function mergeDeep(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.concat(clone(b));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = clone(a); for (const k of Object.keys(b)) out[k] = k in out ? mergeDeep(out[k], b[k]) : clone(b[k]); return out;
  }
  return clone(b);
}
/** Copies (or moves) a component to another pass, keeping only settings that pass allows. */
export function copyComponent(direct, key, toPass, cat, move) {
  const [, name] = key.split('|');
  const comp = compOf(cat, name);
  const d = clone(direct);
  const v = clone(d.all[key] || {});
  const kept = {}, dropped = [];
  for (const k of Object.keys(v)) {
    const s = comp && byName(comp.settings, k);
    if (s && s.passes && s.passes.length && !s.passes.includes(toPass)) dropped.push(k); else kept[k] = v[k];
  }
  const to = toPass + '|' + name;
  d.all[to] = mergeDeep(d.all[to] || {}, kept);
  if (move) { if (dropped.length) { d.all[key] = {}; dropped.forEach((k) => { d.all[key][k] = v[k]; }); } else delete d.all[key]; }
  return { direct: d, dropped };
}

// ---- conversion between Guided and Direct -------------------------------------------------
/** Guided studio model -> direct model, by parsing the generated XML (nothing is lost). */
export function guidedToDirect(model, A, cat, gen) {
  return importDirect(A.buildXml(model), cat, gen);
}
/**
 * Direct model -> Guided, only when the file matches a template exactly: every element maps to template
 * fields, the command timeline or the disk canvas, and regenerating gives the same settings.
 * -> { ok: true, model } or { ok: false, reasons: [text] }
 */
export function directToGuided(direct, A, cat, gen) {
  let xml;
  try { xml = buildDirectXml(direct, cat, gen); } catch (e) { return { ok: false, reasons: [e.message] }; }
  const reasons = [];
  if (direct.rawBlocks && direct.rawBlocks.length) reasons.push('raw:' + direct.rawBlocks.length);
  if (direct.servicing && direct.servicing.length) reasons.push('servicing');
  let r;
  try { r = A.importXml(xml, {}); } catch (e) { return { ok: false, reasons: [e.message] }; }
  const m = A.defaultModel();
  m.mode = r.mode;
  Object.assign(m[r.mode], r.form);
  m.commands = r.commands; m.disks = r.disks; m.extras = r.extras; m.all = {}; m.raw = '';
  // The guided model must regenerate every setting of the direct file, and nothing more.
  const c = A.compareXml(xml, A.buildXml(m));
  c.removed.forEach((x) => reasons.push('- ' + x.path));
  c.changed.forEach((x) => reasons.push('~ ' + x.path));
  c.added.forEach((x) => reasons.push('+ ' + x.path));
  return reasons.length ? { ok: false, reasons, mode: r.mode } : { ok: true, model: m, mode: r.mode };
}

// ---- adapters for the disk and command canvases --------------------------------------------
const SETUP_KEY = 'windowsPE|Microsoft-Windows-Setup';
export function directDisks(direct, A) {
  const v = direct.all[SETUP_KEY];
  if (!v || !v.DiskConfiguration) return null;
  return A.readDiskLayout(A.valueToElement('component', v));
}
export function setDirectDisks(direct, layout, A) {
  const d = clone(direct);
  const v = d.all[SETUP_KEY] = d.all[SETUP_KEY] || {};
  if (!layout) { delete v.DiskConfiguration; return d; }
  const dc = A.elementToValue(A.layoutDiskXml(layout));
  if (dc && typeof dc === 'object' && Object.keys(dc).length) v.DiskConfiguration = dc; else delete v.DiskConfiguration;
  v.ImageInstall = v.ImageInstall || {};
  v.ImageInstall.OSImage = v.ImageInstall.OSImage || {};
  v.ImageInstall.OSImage.InstallTo = { DiskID: String(parseInt(layout.target.diskId, 10) || 0), PartitionID: String(parseInt(layout.target.partitionId, 10) || 1) };
  return d;
}
const LIST_MAP = {
  runSync: ['specialize|Microsoft-Windows-Deployment', 'RunSynchronous', 'RunSynchronousCommand', 'Path'],
  runAsync: ['specialize|Microsoft-Windows-Deployment', 'RunAsynchronous', 'RunAsynchronousCommand', 'Path'],
  firstLogon: ['oobeSystem|Microsoft-Windows-Shell-Setup', 'FirstLogonCommands', 'SynchronousCommand', 'CommandLine'],
  logon: ['oobeSystem|Microsoft-Windows-Shell-Setup', 'LogonCommands', 'AsynchronousCommand', 'CommandLine']
};
export function directCommands(direct) {
  const out = {};
  for (const [id, [key, list, item, cmd]] of Object.entries(LIST_MAP)) {
    const items = ((direct.all[key] || {})[list] || {})[item];
    out[id] = (Array.isArray(items) ? items : []).slice().sort((a, b) => (parseInt(a.Order, 10) || 0) - (parseInt(b.Order, 10) || 0)).map((it) => {
      const c = { command: scalar(it[cmd]), description: scalar(it.Description), willReboot: it.WillReboot || 'Never', disabled: false };
      if (it.Credentials) c.credentials = { domain: scalar(it.Credentials.Domain), username: scalar(it.Credentials.Username), password: scalar(it.Credentials.Password) };
      return c;
    });
  }
  return out;
}
export function setDirectCommands(direct, commands) {
  const d = clone(direct);
  for (const [id, [key, list, item, cmd]] of Object.entries(LIST_MAP)) {
    const prev = ((d.all[key] || {})[list] || {})[item];
    const items = (commands[id] || []).filter((c) => !c.disabled).map((c, i) => {
      const it = { Order: String(i + 1) };
      if (c.description) it.Description = c.description;
      it[cmd] = c.command || '';
      if (id === 'runSync' && c.willReboot && c.willReboot !== 'Never') it.WillReboot = c.willReboot;
      if (id === 'firstLogon' || id === 'logon') {
        const old = Array.isArray(prev) ? prev.find((p) => scalar(p[cmd]) === c.command) : null;
        if (old && old.RequiresUserInput !== undefined) it.RequiresUserInput = old.RequiresUserInput;
      }
      if ((id === 'runSync' || id === 'runAsync') && c.credentials && (c.credentials.username || c.credentials.domain)) it.Credentials = { Domain: c.credentials.domain || '', Password: c.credentials.password || '', Username: c.credentials.username || '' };
      return it;
    });
    if (!items.length && !prev) continue;
    d.all[key] = d.all[key] || {};
    if (items.length) { d.all[key][list] = d.all[key][list] || {}; d.all[key][list][item] = items; }
    else if (d.all[key][list]) { delete d.all[key][list][item]; if (!Object.keys(d.all[key][list]).length) delete d.all[key][list]; }
  }
  return d;
}
