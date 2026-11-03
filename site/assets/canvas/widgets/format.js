// Pure parsing, formatting and validation for the setting widgets. No DOM; tested in Node.
// Every function takes and returns plain strings or numbers so the widgets can stay thin.

// ---- IPv4, IPv6, CIDR, MAC, ports ---------------------------------------------------------------
export function parseIpv4(s) {
  const t = String(s == null ? '' : s).trim();
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(t);
  if (!m) return { ok: false, error: 'ipv4' };
  const octets = m.slice(1).map(Number);
  if (octets.some((o, i) => o > 255 || (m[i + 1].length > 1 && m[i + 1][0] === '0'))) return { ok: false, error: 'ipv4' };
  return { ok: true, octets, value: octets.join('.'), int: ((octets[0] << 24) >>> 0) + (octets[1] << 16) + (octets[2] << 8) + octets[3] };
}
export function intToIpv4(n) { n = n >>> 0; return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
/** 'private' | 'loopback' | 'link-local' | 'multicast' | 'unspecified' | 'broadcast' | 'cgnat' | 'public' */
export function classifyIpv4(ip) {
  const p = typeof ip === 'string' ? parseIpv4(ip) : ip;
  if (!p || !p.ok) return '';
  const [a, b] = p.octets;
  if (p.int === 0) return 'unspecified';
  if (p.int === 0xffffffff) return 'broadcast';
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 100 && b >= 64 && b <= 127) return 'cgnat';
  if (a >= 224 && a <= 239) return 'multicast';
  return 'public';
}
/** Expands an IPv6 address to 8 groups. Returns null when it is not valid. */
export function expandIpv6(s) {
  let t = String(s == null ? '' : s).trim().toLowerCase();
  if (!t || /[^0-9a-f:.]/.test(t)) return null;
  let tail = [];
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(t);
  if (v4) {
    const p = parseIpv4(v4[1]);
    if (!p.ok) return null;
    tail = [((p.octets[0] << 8) | p.octets[1]).toString(16), ((p.octets[2] << 8) | p.octets[3]).toString(16)];
    t = t.slice(0, -v4[1].length);
    if (t.endsWith('::')) t += '';
    else if (t.endsWith(':')) t = t.slice(0, -1);
  }
  const halves = t.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2 ? head : head;
  const all = (halves.length === 2 ? head.concat(new Array(Math.max(0, 8 - head.length - rest.length - tail.length)).fill('0'), rest) : groups).concat(tail);
  if (halves.length === 2 && head.length + rest.length + tail.length >= 8) return null;
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => g.replace(/^0+(?=.)/, ''));
}
/** Compressed IPv6 text (RFC 5952 style), or null. */
export function normalizeIpv6(s) {
  const g = expandIpv6(s);
  if (!g) return null;
  let best = -1, len = 0;
  for (let i = 0; i < 8;) {
    if (g[i] !== '0') { i++; continue; }
    let j = i; while (j < 8 && g[j] === '0') j++;
    if (j - i > len && j - i > 1) { best = i; len = j - i; }
    i = j;
  }
  if (best < 0) return g.join(':');
  return (g.slice(0, best).join(':') + '::' + g.slice(best + len).join(':')).replace(/^:::/, '::');
}
export function maskFromPrefix(prefix) {
  const p = Math.max(0, Math.min(32, Number(prefix) | 0));
  return intToIpv4(p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
}
/** Prefix length of a dotted mask, or -1 when the mask is not contiguous. */
export function prefixFromMask(mask) {
  const p = parseIpv4(mask);
  if (!p.ok) return -1;
  const bits = p.int.toString(2).padStart(32, '0');
  return /^1*0*$/.test(bits) ? bits.indexOf('0') === -1 ? 32 : bits.indexOf('0') : -1;
}
/** Parses 'address/prefix'. Returns { ok, family, ip, prefix, mask, network, broadcast, first, last, hosts } or { ok:false, error }. */
export function parseCidr(s, opts) {
  const t = String(s == null ? '' : s).trim();
  const m = /^([^/\s]+)\/(\d{1,3})$/.exec(t);
  if (!m) return { ok: false, error: 'cidr' };
  const prefix = Number(m[2]);
  const v4 = parseIpv4(m[1]);
  if (v4.ok) {
    if (prefix > 32) return { ok: false, error: 'prefix4' };
    const maskInt = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const net = (v4.int & maskInt) >>> 0;
    const bc = (net | (~maskInt >>> 0)) >>> 0;
    const hosts = prefix >= 31 ? 2 ** (32 - prefix) : Math.max(0, 2 ** (32 - prefix) - 2);
    return { ok: true, family: 4, ip: v4.value, prefix, mask: intToIpv4(maskInt), wildcard: intToIpv4(~maskInt >>> 0), network: intToIpv4(net), broadcast: intToIpv4(bc),
      first: intToIpv4(prefix >= 31 ? net : net + 1), last: intToIpv4(prefix >= 31 ? bc : bc - 1), hosts, isNetwork: v4.int === net && prefix < 31, isBroadcast: v4.int === bc && prefix < 31 };
  }
  if (opts && opts.allowIpv6 === false) return { ok: false, error: 'ipv4' };
  const v6 = normalizeIpv6(m[1]);
  if (!v6) return { ok: false, error: 'ip' };
  if (prefix > 128) return { ok: false, error: 'prefix6' };
  return { ok: true, family: 6, ip: v6, prefix };
}
/** Normalizes a MAC address to AA-BB-CC-DD-EE-FF. */
export function parseMac(s) {
  const hex = String(s == null ? '' : s).trim().replace(/[\s:.-]/g, '');
  if (!/^[0-9a-fA-F]{12}$/.test(hex)) return { ok: false, error: 'mac' };
  const v = hex.toUpperCase().match(/../g).join('-');
  const first = parseInt(hex.slice(0, 2), 16);
  return { ok: true, value: v, multicast: !!(first & 1), local: !!(first & 2) };
}
export const WELL_KNOWN_PORTS = { 20: 'FTP data', 21: 'FTP', 22: 'SSH', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 88: 'Kerberos', 135: 'RPC', 139: 'NetBIOS session', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 587: 'SMTP submission', 636: 'LDAPS', 1433: 'SQL Server', 3268: 'Global Catalog', 3389: 'Remote Desktop', 5985: 'WinRM HTTP', 5986: 'WinRM HTTPS', 8080: 'HTTP alternate', 8443: 'HTTPS alternate' };
export function parsePort(s) {
  const t = String(s == null ? '' : s).trim();
  if (!/^\d{1,5}$/.test(t) || Number(t) < 1 || Number(t) > 65535) return { ok: false, error: 'port' };
  return { ok: true, value: Number(t), name: WELL_KNOWN_PORTS[Number(t)] || '' };
}

// ---- GUIDs and product keys ------------------------------------------------------------------
const GUID_RE = /^\{?([0-9a-fA-F]{8})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{4})-?([0-9a-fA-F]{12})\}?$/;
export function parseGuid(s) {
  const m = GUID_RE.exec(String(s == null ? '' : s).trim());
  if (!m) return { ok: false, error: 'guid' };
  const braces = /^\{/.test(String(s).trim());
  return { ok: true, value: m.slice(1).join('-').toLowerCase(), braces };
}
/** Random version 4 GUID. `rand(n)` returns an integer below n (crypto in the browser). */
export function newGuid(rand) {
  const r = rand || ((n) => { const a = new Uint32Array(1); (globalThis.crypto || {}).getRandomValues ? globalThis.crypto.getRandomValues(a) : (a[0] = Math.floor(Math.random() * 2 ** 32)); return a[0] % n; });
  const h = []; for (let i = 0; i < 32; i++) h.push(r(16).toString(16));
  h[12] = '4'; h[16] = (8 + (parseInt(h[16], 16) & 3)).toString(16);
  const s = h.join('');
  return [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20)].join('-');
}
const KEY_CHARS = /[^0-9A-Za-z]/g;
/** Splits pasted text into five 5-character groups (uppercase). */
export function splitProductKey(s) {
  const raw = String(s == null ? '' : s).replace(KEY_CHARS, '').toUpperCase().slice(0, 25);
  const out = [];
  for (let i = 0; i < 5; i++) out.push(raw.slice(i * 5, i * 5 + 5));
  return out;
}
export function formatProductKey(s) { const g = splitProductKey(s); return g.filter(Boolean).length ? g.join('-').replace(/-+$/, '') : ''; }
export function isProductKey(s) { return /^[0-9A-Z]{5}(-[0-9A-Z]{5}){4}$/.test(String(s || '').trim().toUpperCase()); }

// ---- sizes, durations, times, flags ----------------------------------------------------------
export const SIZE_UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
/** Converts a value in `from` units to `to` units (binary units, as Windows uses). */
export function convertSize(v, from, to) { return (Number(v) * SIZE_UNITS[from]) / SIZE_UNITS[to]; }
/** Parses '10 GB', '512', '1.5TB' into a whole number of `storage` units, or null. */
export function parseSize(text, storage, defaultUnit) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([KMGT]?B)?\s*$/i.exec(String(text == null ? '' : text));
  if (!m) return null;
  const unit = (m[2] || defaultUnit || storage).toUpperCase();
  return Math.round(convertSize(Number(m[1]), unit, storage));
}
/** Best human unit for a stored value: { value, unit, text }. */
export function formatSize(v, storage) {
  const bytes = Number(v) * SIZE_UNITS[storage || 'MB'];
  if (!isFinite(bytes)) return { value: v, unit: storage, text: String(v) };
  const unit = bytes >= SIZE_UNITS.TB && bytes % (SIZE_UNITS.TB / 10) === 0 ? 'TB' : bytes >= SIZE_UNITS.GB ? 'GB' : bytes >= SIZE_UNITS.MB ? 'MB' : bytes >= SIZE_UNITS.KB ? 'KB' : 'B';
  const n = bytes / SIZE_UNITS[unit];
  const value = Math.round(n * 100) / 100;
  return { value, unit, text: value.toLocaleString('en-US') + ' ' + unit };
}
export const DURATION_UNITS = { ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 };
/** Parses '2m 30s', '1h', '90', '1:30' (minutes:seconds) into whole `unit`s, or null. */
export function parseDuration(text, unit) {
  const s = String(text == null ? '' : text).trim().toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  let ms = 0, any = false;
  const clock = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (clock) { ms = clock[3] !== undefined ? (+clock[1] * 3600 + +clock[2] * 60 + +clock[3]) * 1000 : (+clock[1] * 60 + +clock[2]) * 1000; any = true; }
  else {
    const re = /(\d+(?:\.\d+)?)\s*(milliseconds?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d)(?![a-z])/g;
    let m, rest = s;
    while ((m = re.exec(s))) {
      any = true; rest = rest.replace(m[0], '');
      const u = m[2];
      ms += Number(m[1]) * (/^ms|^milli/.test(u) ? 1 : /^s/.test(u) ? 1000 : /^m/.test(u) ? 60000 : /^h/.test(u) ? 3600000 : 86400000);
    }
    if (rest.replace(/[\s,]|and/g, '')) return null;
  }
  return any ? Math.round(ms / DURATION_UNITS[unit || 's']) : null;
}
/** '2 minutes 30 seconds' for a value in `unit`. */
export function humanDuration(v, unit) {
  let ms = Number(v) * DURATION_UNITS[unit || 's'];
  if (!isFinite(ms) || ms < 0) return '';
  if (ms === 0) return '0 seconds';
  const parts = [];
  for (const [name, size] of [['day', 86400000], ['hour', 3600000], ['minute', 60000], ['second', 1000], ['millisecond', 1]]) {
    const n = Math.floor(ms / size);
    if (n) { parts.push(n + ' ' + name + (n === 1 ? '' : 's')); ms -= n * size; }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}
export function minutesToClock(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1440) return '';
  const h = Math.floor(n / 60) % 24, m = n % 60;
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
export function clockToMinutes(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  return +m[1] * 60 + +m[2];
}
/** Splits a bitmask into the flag values it contains. `flags` are numbers (powers of two). */
export function decodeFlags(v, flags) {
  const n = Number(v) | 0;
  const set = flags.filter((f) => f && (n & f) === f);
  const known = set.reduce((a, f) => a | f, 0);
  return { set, unknown: n & ~known };
}
export function encodeFlags(list) { return list.reduce((a, f) => a | (Number(f) | 0), 0); }

// ---- colours -----------------------------------------------------------------------------------
/** Reads a stored colour. format: 'argb-hex' (0xAARRGGBB), 'abgr-hex' (0xAABBGGRR), 'rgb-int' (R + G*256 + B*65536), 'hex' (#RRGGBB). */
export function parseColor(value, format) {
  const s = String(value == null ? '' : value).trim();
  if (format === 'rgb-int') {
    if (!/^\d+$/.test(s) || Number(s) > 0xffffff) return null;
    const n = Number(s); return { r: n & 255, g: (n >> 8) & 255, b: (n >> 16) & 255, a: 255 };
  }
  const m = /^(?:0x|#)?([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(s);
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 6) hex = 'ff' + hex;
  const [a, x, y, z] = hex.match(/../g).map((p) => parseInt(p, 16));
  if (format === 'abgr-hex') return { a, b: x, g: y, r: z };
  return { a, r: x, g: y, b: z };
}
export function formatColor(c, format) {
  const h2 = (n) => n.toString(16).padStart(2, '0');
  if (format === 'rgb-int') return String(c.r + c.g * 256 + c.b * 65536);
  if (format === 'abgr-hex') return '0x' + h2(c.a ?? 255) + h2(c.b) + h2(c.g) + h2(c.r);
  if (format === 'hex') return '#' + h2(c.r) + h2(c.g) + h2(c.b);
  return '0x' + h2(c.a ?? 255) + h2(c.r) + h2(c.g) + h2(c.b);
}
export function cssHex(c) { return '#' + [c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, '0')).join(''); }
export function hexToRgb(hex) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return null; const n = parseInt(m[1], 16); return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 255 }; }
/** HSL lightness in percent (0..100). */
export function lightness(c) { const mx = Math.max(c.r, c.g, c.b) / 255, mn = Math.min(c.r, c.g, c.b) / 255; return Math.round(((mx + mn) / 2) * 100); }

// ---- text formats ------------------------------------------------------------------------------
const BAD_PATH = /[<>"|?*\u0000-\u001f]/;
/** Windows path check: '' when valid, else an error code. Environment variables are allowed. */
export function checkPath(s, opts) {
  const t = String(s == null ? '' : s);
  if (!t.trim()) return '';
  if (t !== t.trim()) return 'pathSpaces';
  const noVars = t.replace(/%[A-Za-z_][A-Za-z0-9_()]*%/g, 'X');
  if (BAD_PATH.test(noVars.replace(/^\\\\\?\\/, ''))) return 'pathChars';
  if (/^[A-Za-z]:(?![\\/]|$)/.test(noVars)) return 'pathDrive';
  if (/:/.test(noVars.replace(/^[A-Za-z]:/, ''))) return 'pathChars';
  if (opts && opts.absolute && !/^([A-Za-z]:[\\/]|\\\\|%)/.test(t)) return 'pathRelative';
  if (t.length > 259 && !/^\\\\\?\\/.test(t)) return 'pathLong';
  return '';
}
export const FOLDER_VARS = {
  '%SystemDrive%': 'C:', '%SystemRoot%': 'C:\\Windows', '%WINDIR%': 'C:\\Windows', '%ProgramFiles%': 'C:\\Program Files', '%ProgramFiles(x86)%': 'C:\\Program Files (x86)',
  '%ProgramData%': 'C:\\ProgramData', '%ALLUSERSPROFILE%': 'C:\\ProgramData', '%PUBLIC%': 'C:\\Users\\Public', '%USERPROFILE%': 'C:\\Users\\<user>', '%APPDATA%': 'C:\\Users\\<user>\\AppData\\Roaming',
  '%LOCALAPPDATA%': 'C:\\Users\\<user>\\AppData\\Local', '%TEMP%': 'C:\\Users\\<user>\\AppData\\Local\\Temp', '%USERNAME%': '<user>', '%COMPUTERNAME%': '<computer>'
};
/** Expands the common environment variables to their usual values (for a preview only). */
export function expandVars(s) {
  return String(s || '').replace(/%[A-Za-z_][A-Za-z0-9_()]*%/g, (m) => { const k = Object.keys(FOLDER_VARS).find((x) => x.toLowerCase() === m.toLowerCase()); return k ? FOLDER_VARS[k] : m; });
}
/** Splits a command line the way the Windows C runtime does (quotes group, backslashes before quotes escape). */
export function tokenizeCommand(cmd) {
  const s = String(cmd || '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const start = i;
    let text = '', quoted = false, inQ = false;
    while (i < s.length && (inQ || !/\s/.test(s[i]))) {
      if (s[i] === '\\') {
        let n = 0; while (s[i] === '\\') { n++; i++; }
        if (s[i] === '"') { text += '\\'.repeat(Math.floor(n / 2)); if (n % 2) { text += '"'; i++; } }
        else text += '\\'.repeat(n);
        continue;
      }
      if (s[i] === '"') { inQ = !inQ; quoted = true; i++; continue; }
      text += s[i++];
    }
    out.push({ text, raw: s.slice(start, i), start, end: i, quoted, unclosed: inQ });
  }
  return out;
}
/** Quotes one argument for a Windows command line when it needs it. */
export function quoteArg(a) {
  const s = String(a);
  if (s && !/[\s"]/.test(s)) return s;
  return '"' + s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
}
/** Token kinds for highlighting: exe, flag, var, string, path, arg. */
export function commandTokens(cmd) {
  return tokenizeCommand(cmd).map((tk, i) => ({ ...tk, kind: i === 0 ? 'exe' : /^[-/][A-Za-z?]/.test(tk.text) ? 'flag' : /%[^%]+%/.test(tk.raw) ? 'var' : tk.quoted ? 'string' : /[\\/]/.test(tk.text) ? 'path' : 'arg' }));
}
export function checkUrl(s, opts) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  if (opts && opts.allowPath && /^([A-Za-z]:\\|\\\\|%)/.test(t)) return '';
  let u; try { u = new URL(t); } catch (e) { return 'url'; }
  if (!/^(https?|ms-[a-z-]+|mailto|file):$/.test(u.protocol) && !(opts && opts.anyScheme)) return 'urlScheme';
  return '';
}
export function checkEmail(s) { const t = String(s || '').trim(); return !t || /^[^\s@<>()",;]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(t) ? '' : 'email'; }
export const HIVES = { HKLM: 'HKEY_LOCAL_MACHINE', HKCU: 'HKEY_CURRENT_USER', HKCR: 'HKEY_CLASSES_ROOT', HKU: 'HKEY_USERS', HKCC: 'HKEY_CURRENT_CONFIG' };
export function checkRegistryPath(s) {
  const t = String(s == null ? '' : s).trim();
  if (!t) return '';
  const hive = t.split('\\')[0].toUpperCase();
  if (!HIVES[hive] && !Object.values(HIVES).includes(hive)) return 'regHive';
  if (/\\\\|\\$/.test(t) || /[\u0000-\u001f]/.test(t)) return 'regPath';
  return '';
}
export function expandHive(s) { const t = String(s || ''); const i = t.indexOf('\\'); const h = (i < 0 ? t : t.slice(0, i)).toUpperCase(); return HIVES[h] ? HIVES[h] + (i < 0 ? '' : t.slice(i)) : t; }
/** Text formats used by the text widget. Returns '' or an error code. */
export function checkFormat(fmt, s) {
  const t = String(s == null ? '' : s);
  if (!t) return '';
  if (fmt === 'computername') {
    if (t === '*') return '';
    if (t.length > 15) return 'cnLong';
    if (!/^[A-Za-z0-9-]+$/.test(t)) return 'cnChars';
    if (/^\d+$/.test(t)) return 'cnDigits';
    return '';
  }
  if (fmt === 'fqdn') return /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.?$/.test(t) ? '' : 'fqdn';
  if (fmt === 'dn') return /^([A-Za-z]+=[^,=]+)(,\s*[A-Za-z]+=[^,=]+)*$/.test(t) ? '' : 'dn';
  if (fmt === 'phone') return /^[+()\d][\d\s().-]{3,}$/.test(t) ? '' : 'phone';
  if (fmt === 'typeid') return parseGuid(t).ok || /^0x[0-9a-fA-F]{1,2}$/.test(t) ? '' : 'typeid';
  return '';
}
/** Splits and joins separated lists ('a;b;c'). */
export function splitList(s, sep) {
  const t = String(s == null ? '' : s);
  if (!t.trim()) return [];
  const re = sep === ' ' ? /\s+/ : sep === '\n' ? /\r?\n/ : new RegExp('\\s*' + sep.replace(/[|.*+?^${}()[\]\\]/g, '\\$&') + '\\s*');
  return t.split(re).map((x) => x.trim()).filter(Boolean);
}
export function joinList(items, sep) { return items.map((x) => String(x).trim()).filter(Boolean).join(sep === '\n' ? '\n' : sep); }
/** Parses 'a:b:c,d:e:f' into rows. */
export function splitRows(s, sep, fieldSep) { return splitList(s, sep).map((r) => r.split(fieldSep).map((x) => x.trim())); }
export function joinRows(rows, sep, fieldSep) { return rows.filter((r) => r.some((x) => String(x).trim())).map((r) => r.map((x) => String(x).trim()).join(fieldSep)).join(sep); }
/** Reads width and height from the start of a BMP file (ArrayBuffer). */
export function bmpSize(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 26 || v.getUint8(0) !== 0x42 || v.getUint8(1) !== 0x4d) return null;
  const header = v.getUint32(14, true);
  if (header === 12) return { width: v.getUint16(18, true), height: v.getUint16(20, true), bits: v.byteLength > 24 ? v.getUint16(24, true) : 0 };
  return { width: v.getInt32(18, true), height: Math.abs(v.getInt32(22, true)), bits: v.byteLength > 29 ? v.getUint16(28, true) : 0 };
}
