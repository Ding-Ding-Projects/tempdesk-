// TempDesk answer file generator and parser.
//
// Pure, dependency-free ES module. Works in browsers and in Node (18+).
// It turns a settings model into an unattend.xml / autounattend.xml document
// and maps an existing document back into the same model, using
// unattend-catalog.json as the description of every component and setting.
//
// Model shape:
//   {
//     architecture: "amd64",                     // processorArchitecture for every component
//     passes: {
//       specialize: {
//         "Microsoft-Windows-Shell-Setup": {
//           "ComputerName": "TD-01",              // leaf: path -> value
//           "OOBE/HideEULAPage": true,
//           "UserAccounts/AdministratorPassword/Value": "secret",   // plain text in the model
//           "UserAccounts/LocalAccounts/LocalAccount": [            // list: path -> array of items
//             { "Name": "kiosk", "Group": "Users", "Password/Value": "pw" }
//           ]
//         }
//       }
//     }
//   }
// Inside a list item the keys are paths relative to the list item element.

export const UNATTEND_NS = 'urn:schemas-microsoft-com:unattend';
export const WCM_NS = 'http://schemas.microsoft.com/WMIConfig/2002/State';
export const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';
export const CPI_NS = 'urn:schemas-microsoft-com:cpi';
export const PUBLIC_KEY_TOKEN = '31bf3856ad364e35';
export const PASS_ORDER = ['windowsPE', 'offlineServicing', 'generalize', 'specialize', 'auditSystem', 'auditUser', 'oobeSystem'];

// ---------------------------------------------------------------------------
// Catalog index
// ---------------------------------------------------------------------------

const indexCache = new WeakMap();

function indexCatalog(catalog) {
  if (!catalog || !Array.isArray(catalog.components)) throw new TypeError('catalog with a components array is required');
  let idx = indexCache.get(catalog);
  if (idx) return idx;
  const byName = new Map();
  for (const comp of catalog.components) {
    const byPath = new Map();
    const walk = (list) => {
      for (const s of list) {
        byPath.set(s.path, s);
        if (s.children) walk(s.children);
        if (s.listItem) walk(s.listItem.settings);
      }
    };
    walk(comp.settings);
    byName.set(comp.name.toLowerCase(), { comp, byPath });
  }
  idx = { byName };
  indexCache.set(catalog, idx);
  return idx;
}

/** Find a component description by name (case-insensitive). */
export function findComponent(catalog, name) {
  const e = indexCatalog(catalog).byName.get(String(name).toLowerCase());
  return e ? e.comp : null;
}

/** Find a setting by component name and full path (list item children use their full path too). */
export function findSetting(catalog, componentName, path) {
  const e = indexCatalog(catalog).byName.get(String(componentName).toLowerCase());
  return e ? e.byPath.get(path) || null : null;
}

/** Components that document at least one setting for the given pass. */
export function componentsForPass(catalog, pass) {
  return catalog.components.filter((c) => c.passes.includes(pass));
}

// Path of a setting relative to the scope it is emitted in (component root or list item).
const relPath = (s) => (s.itemPath !== undefined ? s.itemPath : s.path);

// ---------------------------------------------------------------------------
// Password encoding (Windows SIM "hide sensitive data")
// ---------------------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += b === undefined ? '=' : B64[(n >> 6) & 63];
    out += c === undefined ? '=' : B64[n & 63];
  }
  return out;
}

function base64ToBytes(text) {
  const clean = String(text).replace(/\s+/g, '').replace(/=+$/, '');
  if (!/^[A-Za-z0-9+/]*$/.test(clean) || clean.length % 4 === 1) throw new Error('not base64');
  const bytes = [];
  let buf = 0, bits = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buf >> bits) & 255);
    }
  }
  return bytes;
}

/**
 * Encode a password the way Windows System Image Manager does when PlainText is false:
 * base64 of the UTF-16LE bytes of (password + suffix). The suffix is the literal text
 * "AdministratorPassword" for UserAccounts/AdministratorPassword and
 * OfflineUserAccounts/OfflineAdministratorPassword, and "Password" for every other
 * Password element (local accounts, AutoLogon).
 */
export function encodePassword(value, suffix = 'Password') {
  const s = String(value ?? '') + suffix;
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    const u = s.charCodeAt(i);
    bytes.push(u & 255, u >> 8);
  }
  return bytesToBase64(bytes);
}

/** Reverse of encodePassword. Returns null when the text is not a valid encoded value for that suffix. */
export function decodePassword(encoded, suffix = 'Password') {
  let bytes;
  try {
    bytes = base64ToBytes(encoded);
  } catch {
    return null;
  }
  if (bytes.length % 2) return null;
  let s = '';
  for (let i = 0; i < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  return s.endsWith(suffix) ? s.slice(0, s.length - suffix.length) : null;
}

// ---------------------------------------------------------------------------
// XML writing
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-control-regex
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

function escText(v) {
  const s = String(v);
  if (INVALID_XML_CHARS.test(s)) throw new Error('value contains a character that XML 1.0 cannot represent: ' + JSON.stringify(s));
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(v) {
  return escText(v).replace(/"/g, '&quot;');
}

function scalarToText(v) {
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('number value must be finite');
    return String(v);
  }
  return String(v);
}

const hasValue = (v) => v !== undefined && v !== null;

class Writer {
  constructor(indent) {
    this.lines = [];
    this.indent = indent;
  }
  line(depth, text) {
    this.lines.push(this.indent.repeat(depth) + text);
  }
}

function anyKeyUnder(values, prefix) {
  for (const k of Object.keys(values)) if (k === prefix || k.startsWith(prefix + '/')) return true;
  return false;
}

/**
 * Emit the settings of one scope (component root or list item).
 * values: flat object of relative path -> value or array; consumed: Set of keys used.
 */
function emitScope(w, depth, settings, values, consumed, ctx, prefix = '') {
  for (const s of settings) {
    const rel = prefix ? prefix + '/' + s.name : relPath(s);
    if (s.type === 'list') {
      const items = values[rel];
      if (!hasValue(items)) continue;
      consumed.add(rel);
      if (!Array.isArray(items)) throw new Error(`${ctx.where}: ${rel} is a list and needs an array of items`);
      for (const item of items) emitListItem(w, depth, s, item, ctx, rel);
    } else if (s.type === 'container') {
      if (!anyKeyUnder(values, rel)) continue;
      if (s.encodedPassword) {
        emitPasswordContainer(w, depth, s, values, consumed, ctx, rel);
        continue;
      }
      w.line(depth, `<${s.name}>`);
      emitScope(w, depth + 1, s.children || [], values, consumed, ctx, rel);
      w.line(depth, `</${s.name}>`);
    } else {
      if (!(rel in values) || !hasValue(values[rel])) continue;
      consumed.add(rel);
      const text = scalarToText(values[rel]);
      w.line(depth, text === '' ? `<${s.name}></${s.name}>` : `<${s.name}>${escText(text)}</${s.name}>`);
    }
  }
}

function emitPasswordContainer(w, depth, s, values, consumed, ctx, rel) {
  const vKey = rel + '/Value', pKey = rel + '/PlainText';
  consumed.add(vKey);
  consumed.add(pKey);
  const raw = hasValue(values[vKey]) ? String(values[vKey]) : '';
  let plain = values[pKey];
  if (!hasValue(plain)) plain = !ctx.options.hidePasswords;
  plain = plain === true || plain === 'true';
  const text = plain ? raw : encodePassword(raw, s.passwordSuffix || 'Password');
  w.line(depth, `<${s.name}>`);
  w.line(depth + 1, text === '' ? '<Value></Value>' : `<Value>${escText(text)}</Value>`);
  w.line(depth + 1, `<PlainText>${plain ? 'true' : 'false'}</PlainText>`);
  w.line(depth, `</${s.name}>`);
}

function emitListItem(w, depth, s, item, ctx, rel) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${ctx.where}: items of ${rel} must be objects`);
  const li = s.listItem;
  const action = item._action || li.action || 'add';
  let attrs = ` wcm:action="${escAttr(action)}"`;
  const values = { ...item };
  delete values._action;
  const consumed = new Set();
  if (li.keyStyle === 'keyValue') {
    if (!hasValue(values.Key)) throw new Error(`${ctx.where}: items of ${rel} need a Key (written as wcm:keyValue)`);
    attrs += ` wcm:keyValue="${escAttr(scalarToText(values.Key))}"`;
    consumed.add('Key');
  }
  if (li.keyStyle === 'keyValue' && li.valueStyle === 'text') {
    consumed.add('Value');
    const text = hasValue(values.Value) ? scalarToText(values.Value) : '';
    w.line(depth, `<${s.name}${attrs}>${escText(text)}</${s.name}>`);
  } else {
    const settings = li.keyStyle === 'keyValue' ? li.settings.filter((c) => c.name !== 'Key') : li.settings;
    w.line(depth, `<${s.name}${attrs}>`);
    emitScope(w, depth + 1, settings, values, consumed, { ...ctx, where: `${ctx.where} ${rel}[]` });
    w.line(depth, `</${s.name}>`);
  }
  const extra = Object.keys(values).filter((k) => !consumed.has(k));
  if (extra.length && ctx.options.strict) throw new Error(`${ctx.where}: unknown item settings in ${rel}: ${extra.join(', ')}`);
}

/**
 * Build an unattend XML document.
 * options: { strict: true (throw on unknown components or paths), hidePasswords: true,
 *            indent: '    ', offlineImage: model.offlineImage }
 */
export function buildXml(model, catalog, options = {}) {
  const opts = { strict: true, hidePasswords: true, indent: '    ', ...options };
  if (!model || typeof model !== 'object') throw new TypeError('model is required');
  const arch = model.architecture || 'amd64';
  const passes = model.passes || {};
  const w = new Writer(opts.indent);
  const attrs = catalog.componentAttributes || {};
  const token = attrs.publicKeyToken || PUBLIC_KEY_TOKEN;
  const language = attrs.language || 'neutral';
  const versionScope = attrs.versionScope || 'nonSxS';
  w.lines.push('<?xml version="1.0" encoding="utf-8"?>');
  w.line(0, `<unattend xmlns="${UNATTEND_NS}">`);
  const passNames = Object.keys(passes);
  for (const p of passNames) if (!PASS_ORDER.includes(p)) throw new Error('unknown configuration pass: ' + p);
  for (const pass of PASS_ORDER) {
    const comps = passes[pass];
    if (!comps || !Object.keys(comps).length) continue;
    w.line(1, `<settings pass="${pass}">`);
    for (const [compName, values] of Object.entries(comps)) {
      const comp = findComponent(catalog, compName);
      if (!comp) {
        if (opts.strict) throw new Error(`unknown component ${compName}`);
        continue;
      }
      const compArch = (model.architectureOverrides && model.architectureOverrides[`${pass}/${comp.name}`]) || arch;
      w.line(2, `<component name="${escAttr(comp.name)}" processorArchitecture="${escAttr(compArch)}" publicKeyToken="${token}" language="${language}" versionScope="${versionScope}" xmlns:wcm="${WCM_NS}" xmlns:xsi="${XSI_NS}">`);
      const consumed = new Set();
      emitScope(w, 3, comp.settings, values || {}, consumed, { options: opts, where: `${pass}/${comp.name}` });
      const extra = Object.keys(values || {}).filter((k) => !consumed.has(k));
      if (extra.length && opts.strict) throw new Error(`${pass}/${comp.name}: unknown settings ${extra.join(', ')}`);
      w.line(2, '</component>');
    }
    w.line(1, '</settings>');
  }
  const offline = opts.offlineImage || model.offlineImage;
  if (offline && offline.source) {
    w.line(1, `<cpi:offlineImage cpi:source="${escAttr(offline.source)}" xmlns:cpi="${CPI_NS}" />`);
  }
  w.line(0, '</unattend>');
  return w.lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Validation for builders (does not throw)
// ---------------------------------------------------------------------------

/** Check a model against the catalog. Returns [{level:'error'|'warning', where, message}]. */
export function validateModel(model, catalog) {
  const issues = [];
  const add = (level, where, message) => issues.push({ level, where, message });
  const checkScope = (settingsIndex, values, where, pass) => {
    for (const [key, val] of Object.entries(values || {})) {
      if (key === '_action') continue;
      const s = settingsIndex.get(key);
      if (!s) {
        add('error', `${where}/${key}`, 'unknown setting');
        continue;
      }
      if (pass && s.passes && !s.passes.includes(pass)) add('warning', `${where}/${key}`, `not documented for the ${pass} pass (valid: ${s.passes.join(', ')})`);
      if (s.deprecated) add('warning', `${where}/${key}`, 'deprecated setting');
      if (s.type === 'list') {
        if (!Array.isArray(val)) {
          add('error', `${where}/${key}`, 'list setting needs an array');
          continue;
        }
        const childIndex = new Map();
        const walk = (list) => {
          for (const c of list) {
            childIndex.set(relPath(c), c);
            if (c.children) walk(c.children);
          }
        };
        walk(s.listItem.settings);
        const keys = new Set();
        val.forEach((item, i) => {
          checkScope(childIndex, item, `${where}/${key}[${i}]`, pass);
          if (s.listItem.keyed && s.listItem.key) {
            const k = item[s.listItem.key];
            if (!hasValue(k)) add(s.listItem.keyStyle === 'keyValue' ? 'error' : 'warning', `${where}/${key}[${i}]`, `missing key ${s.listItem.key}`);
            else if (keys.has(String(k))) add('error', `${where}/${key}[${i}]`, `duplicate key ${k}`);
            else keys.add(String(k));
          }
        });
        continue;
      }
      if (!hasValue(val)) continue;
      const text = scalarToText(val);
      if ((s.type === 'enum' || s.type === 'boolean') && s.values && s.values.length) {
        const ok = s.values.some((v) => v.value.toLowerCase() === text.toLowerCase());
        if (!ok) add(s.type === 'boolean' ? 'error' : 'warning', `${where}/${key}`, `value ${text} is not one of ${s.values.map((v) => v.value).join(', ')}`);
      }
      if (s.type === 'integer') {
        if (!/^-?\d+$/.test(text)) add('error', `${where}/${key}`, 'expected an integer');
        else {
          const n = Number(text);
          if (s.min !== undefined && n < s.min) add('error', `${where}/${key}`, `below minimum ${s.min}`);
          if (s.max !== undefined && n > s.max) add('error', `${where}/${key}`, `above maximum ${s.max}`);
        }
      }
      if (s.maxLength !== undefined && text.length > s.maxLength) add('error', `${where}/${key}`, `longer than ${s.maxLength} characters`);
    }
  };
  for (const [pass, comps] of Object.entries((model && model.passes) || {})) {
    if (!PASS_ORDER.includes(pass)) {
      add('error', pass, 'unknown configuration pass');
      continue;
    }
    for (const [compName, values] of Object.entries(comps || {})) {
      const e = indexCatalog(catalog).byName.get(compName.toLowerCase());
      if (!e) {
        add('error', `${pass}/${compName}`, 'unknown component');
        continue;
      }
      if (!e.comp.passes.includes(pass)) add('warning', `${pass}/${compName}`, `component has no settings documented for ${pass}`);
      // top-level scope: settings outside list items, keyed by full path
      const top = new Map();
      for (const [p, s] of e.byPath) if (s.itemPath === undefined) top.set(p, s);
      checkScope(top, values, `${pass}/${e.comp.name}`, pass);
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Tiny XML parser (enough for answer files: elements, attributes, text, CDATA,
// comments, processing instructions, the five named entities and character references)
// ---------------------------------------------------------------------------

const NAME_START = /[A-Za-z_:À-￯]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￯]/;

function decodeEntities(s, pos) {
  return s.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+);|&/g, (m, ent) => {
    if (!ent) throw new XmlError('bare & in text', pos);
    if (ent[0] === '#') {
      const code = ent[1] === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!(code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) {
        throw new XmlError('invalid character reference ' + m, pos);
      }
      return String.fromCodePoint(code);
    }
    const map = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
    if (!(ent in map)) throw new XmlError('unknown entity ' + m, pos);
    return map[ent];
  });
}

export class XmlError extends Error {
  constructor(message, pos) {
    super(`${message} at offset ${pos}`);
    this.name = 'XmlError';
    this.offset = pos;
  }
}

/**
 * Parse XML text into a tree: { name, attrs: {qname: value}, children: [node], text }.
 * Text is the concatenated character data of the element (whitespace kept).
 * Throws XmlError for input that is not well-formed.
 */
export function parseXmlTree(xmlText) {
  let s = String(xmlText);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  let i = 0;
  const n = s.length;
  const stack = [];
  let root = null;
  const err = (m) => {
    throw new XmlError(m, i);
  };
  const readName = () => {
    const start = i;
    if (!NAME_START.test(s[i] || '')) err('expected a name');
    i++;
    while (i < n && NAME_CHAR.test(s[i])) i++;
    return s.slice(start, i);
  };
  const skipWs = () => {
    while (i < n && /\s/.test(s[i])) i++;
  };
  while (i < n) {
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end < 0) err('unterminated processing instruction');
      const target = s.slice(i + 2).match(/^[^\s?]+/);
      if (target && target[0].toLowerCase() === 'xml' && (i !== 0 || root || stack.length)) err('XML declaration not at start');
      i = end + 2;
    } else if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end < 0) err('unterminated comment');
      if (s.slice(i + 4, end).includes('--')) err('"--" inside comment');
      i = end + 3;
    } else if (s.startsWith('<![CDATA[', i)) {
      if (!stack.length) err('CDATA outside the root element');
      const end = s.indexOf(']]>', i + 9);
      if (end < 0) err('unterminated CDATA');
      stack[stack.length - 1].text += s.slice(i + 9, end);
      i = end + 3;
    } else if (s.startsWith('<!DOCTYPE', i)) {
      err('DOCTYPE is not allowed in answer files');
    } else if (s.startsWith('</', i)) {
      i += 2;
      const name = readName();
      skipWs();
      if (s[i] !== '>') err('expected >');
      i++;
      const top = stack.pop();
      if (!top) err('unexpected closing tag </' + name + '>');
      if (top.name !== name) err(`mismatched closing tag </${name}>, expected </${top.name}>`);
      if (!stack.length) root = top;
    } else if (s[i] === '<') {
      i++;
      if (root) err('content after the root element');
      const name = readName();
      const node = { name, attrs: {}, children: [], text: '' };
      for (;;) {
        const before = i;
        skipWs();
        if (s.startsWith('/>', i)) {
          i += 2;
          if (stack.length) stack[stack.length - 1].children.push(node);
          else root = node;
          break;
        }
        if (s[i] === '>') {
          i++;
          if (stack.length) stack[stack.length - 1].children.push(node);
          stack.push(node);
          break;
        }
        if (i === before) err('expected whitespace before attribute');
        const an = readName();
        skipWs();
        if (s[i] !== '=') err('expected = after attribute name');
        i++;
        skipWs();
        const q = s[i];
        if (q !== '"' && q !== "'") err('expected quoted attribute value');
        const end = s.indexOf(q, i + 1);
        if (end < 0) err('unterminated attribute value');
        const rawVal = s.slice(i + 1, end);
        if (rawVal.includes('<')) err('< in attribute value');
        if (an in node.attrs) err('duplicate attribute ' + an);
        node.attrs[an] = decodeEntities(rawVal, i).replace(/[\t\n\r]/g, ' ');
        i = end + 1;
      }
    } else {
      const next = s.indexOf('<', i);
      const end = next < 0 ? n : next;
      const chunk = s.slice(i, end);
      if (!stack.length) {
        if (chunk.trim()) err('text outside the root element');
      } else {
        if (chunk.includes(']]>')) err(']]> in text');
        stack[stack.length - 1].text += decodeEntities(chunk, i);
      }
      i = end;
    }
  }
  if (stack.length) throw new XmlError(`unclosed element <${stack[stack.length - 1].name}>`, i);
  if (!root) throw new XmlError('no root element', i);
  return root;
}

const localName = (q) => (q.includes(':') ? q.slice(q.indexOf(':') + 1) : q);

function attrLocal(node, local) {
  for (const [k, v] of Object.entries(node.attrs)) if (localName(k) === local && k !== 'xmlns') return v;
  return undefined;
}

// ---------------------------------------------------------------------------
// XML -> model
// ---------------------------------------------------------------------------

function typedValue(s, text) {
  const t = text.trim();
  if (s.type === 'boolean') {
    if (/^true$/i.test(t)) return true;
    if (/^false$/i.test(t)) return false;
    return text;
  }
  if (s.type === 'integer' && /^(0|-?[1-9]\d{0,14})$/.test(t)) return Number(t);
  return s.type === 'password' ? text : t;
}

function findChildSetting(settings, name) {
  return settings.find((c) => c.name === name) || settings.find((c) => c.name.toLowerCase() === name.toLowerCase()) || null;
}

/**
 * Parse an existing answer file into the model.
 * Returns { model, unknown: [xpath...], warnings: [text...] }.
 * Elements that the catalog does not describe are skipped and listed in unknown.
 */
export function parseXml(xmlText, catalog) {
  const root = parseXmlTree(xmlText);
  const unknown = [];
  const warnings = [];
  const model = { architecture: undefined, passes: {} };
  if (localName(root.name) !== 'unattend') throw new Error('root element is not <unattend>');

  const walkScope = (node, settings, values, prefix, xp) => {
    const counts = {};
    for (const child of node.children) {
      const name = localName(child.name);
      counts[name] = (counts[name] || 0) + 1;
      const cxp = `${xp}/${name}${counts[name] > 1 ? `[${counts[name]}]` : ''}`;
      const s = findChildSetting(settings, name);
      if (!s) {
        unknown.push(cxp);
        continue;
      }
      const rel = prefix ? `${prefix}/${s.name}` : relPath(s);
      if (s.type === 'list') {
        const li = s.listItem;
        const item = {};
        const action = attrLocal(child, 'action');
        if (action && action !== 'add') item._action = action;
        const kv = attrLocal(child, 'keyValue');
        if (kv !== undefined) item.Key = kv;
        if (li.keyStyle === 'keyValue' && li.valueStyle === 'text' && !child.children.length) {
          item.Value = child.text.trim();
        } else {
          walkScope(child, li.settings, item, '', cxp);
        }
        (values[rel] = values[rel] || []).push(item);
      } else if (s.type === 'container') {
        if (s.encodedPassword) {
          readPassword(child, s, values, rel, cxp);
        } else {
          walkScope(child, s.children || [], values, rel, cxp);
        }
      } else {
        if (child.children.length) {
          unknown.push(...child.children.map((g) => `${cxp}/${localName(g.name)}`));
        }
        values[rel] = typedValue(s, child.text);
      }
    }
  };

  const readPassword = (node, s, values, rel, xp) => {
    let value = '';
    let plain = null;
    for (const child of node.children) {
      const name = localName(child.name);
      if (name === 'Value') value = child.text;
      else if (name === 'PlainText') plain = /^true$/i.test(child.text.trim());
      else unknown.push(`${xp}/${name}`);
    }
    if (plain === false) {
      const decoded = decodePassword(value.trim(), s.passwordSuffix || 'Password');
      if (decoded === null) {
        warnings.push(`${xp}: PlainText is false but the value is not a valid encoded password; kept as written`);
        values[`${rel}/Value`] = value;
        values[`${rel}/PlainText`] = true;
        return;
      }
      values[`${rel}/Value`] = decoded;
      values[`${rel}/PlainText`] = false;
    } else {
      values[`${rel}/Value`] = value;
      values[`${rel}/PlainText`] = plain === null ? true : plain;
    }
  };

  const passCounts = {};
  for (const el of root.children) {
    const name = localName(el.name);
    if (name === 'offlineImage') {
      model.offlineImage = { source: attrLocal(el, 'source') };
      continue;
    }
    if (name !== 'settings') {
      unknown.push(`/unattend/${name}`);
      continue;
    }
    const pass = el.attrs.pass;
    passCounts[pass] = (passCounts[pass] || 0) + 1;
    const pxp = `/unattend/settings[@pass='${pass}']`;
    if (!PASS_ORDER.includes(pass)) {
      unknown.push(pxp);
      continue;
    }
    const passModel = (model.passes[pass] = model.passes[pass] || {});
    for (const compEl of el.children) {
      const cname = compEl.attrs.name;
      const cxp = `${pxp}/component[@name='${cname}']`;
      if (localName(compEl.name) !== 'component') {
        unknown.push(`${pxp}/${localName(compEl.name)}`);
        continue;
      }
      const comp = findComponent(catalog, cname || '');
      if (!comp) {
        unknown.push(cxp);
        continue;
      }
      const arch = compEl.attrs.processorArchitecture;
      if (arch) {
        if (!model.architecture) model.architecture = arch;
        else if (arch !== model.architecture) {
          model.architectureOverrides = model.architectureOverrides || {};
          model.architectureOverrides[`${pass}/${comp.name}`] = arch;
        }
      }
      const values = (passModel[comp.name] = passModel[comp.name] || {});
      walkScope(compEl, comp.settings, values, '', cxp);
    }
    if (!Object.keys(passModel).length) delete model.passes[pass];
  }
  if (!model.architecture) model.architecture = 'amd64';
  return { model, unknown, warnings };
}
