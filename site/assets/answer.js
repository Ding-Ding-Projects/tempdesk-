// TempDesk answer file builder library. Pure functions only: no DOM, no network.
// Runs in the browser (window.TempDeskAnswer) and in Node for tests (module.exports).
// Produces autounattend.xml for three modes (TempDesk server, Guest PC, Custom), the server's
// TempDesk/firstboot.json, and imports an existing autounattend.xml back into form values.
// Must stay compatible with deployer/engine (same file names and firstboot.json schema).
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------------------------
  function xmlEscape(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function str(v) { return v === undefined || v === null ? '' : String(v); }
  function bool(v) { return v === true || v === 'true' || v === 1 || v === '1' || v === 'on'; }
  function b64encode(bin) {
    if (typeof btoa === 'function') return btoa(bin);
    return Buffer.from(bin, 'binary').toString('base64');
  }
  function b64decode(s) {
    if (typeof atob === 'function') return atob(s);
    return Buffer.from(s, 'base64').toString('binary');
  }

  // Windows unattend password obfuscation: base64(UTF-16LE(password + suffix)). This is NOT encryption.
  function unattendPassword(password, suffix) {
    var s = String(password) + suffix;
    var bin = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      bin += String.fromCharCode(c & 0xff, c >> 8);
    }
    return b64encode(bin);
  }
  // Reverse of unattendPassword. Returns null when the value is not in that encoding.
  function decodeUnattendPassword(value, suffix) {
    try {
      var bin = b64decode(String(value).trim());
      if (bin.length % 2) return null;
      var s = '';
      for (var i = 0; i < bin.length; i += 2) s += String.fromCharCode(bin.charCodeAt(i) | (bin.charCodeAt(i + 1) << 8));
      if (suffix && s.slice(-suffix.length) === suffix) return s.slice(0, -suffix.length);
      return null;
    } catch (e) { return null; }
  }

  // ---------------------------------------------------------------------------------------------
  // XML element tree: { n: name, a: {attr: value}, c: [children], t: text }
  // ---------------------------------------------------------------------------------------------
  var NS = 'urn:schemas-microsoft-com:unattend';
  var WCM = 'http://schemas.microsoft.com/WMIConfig/2002/State';
  var PASS_ORDER = ['windowsPE', 'offlineServicing', 'generalize', 'specialize', 'auditSystem', 'auditUser', 'oobeSystem'];

  function el(name, attrs, children) {
    var e = { n: name, a: {}, c: [], t: '' };
    if (attrs) for (var k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.a[k] = String(attrs[k]);
    if (Array.isArray(children)) {
      children.forEach(function (ch) { if (ch) e.c.push(ch); });
    } else if (children !== undefined && children !== null) {
      e.t = String(children);
    }
    return e;
  }
  function leaf(name, text) { return el(name, null, str(text)); }
  function addItem(name, children, keyValue) {
    var a = { 'wcm:action': 'add' };
    if (keyValue !== undefined) a['wcm:keyValue'] = keyValue;
    return el(name, a, children);
  }
  function component(name, arch, children) {
    return el('component', {
      name: name, processorArchitecture: arch || 'amd64', publicKeyToken: '31bf3856ad364e35',
      language: 'neutral', versionScope: 'nonSxS'
    }, children);
  }
  function newDoc() { return el('unattend', { xmlns: NS, 'xmlns:wcm': WCM }, []); }
  function child(e, name) { for (var i = 0; i < e.c.length; i++) if (e.c[i].n === name) return e.c[i]; return null; }
  function children(e, name) { return e.c.filter(function (c) { return c.n === name; }); }
  function path(e, p) {
    var cur = e, parts = p.split('/');
    for (var i = 0; i < parts.length && cur; i++) cur = child(cur, parts[i]);
    return cur;
  }
  function pathText(e, p) { var x = e && path(e, p); return x ? x.t.trim() : ''; }

  function getSettings(doc, pass, create) {
    for (var i = 0; i < doc.c.length; i++) if (doc.c[i].n === 'settings' && doc.c[i].a.pass === pass) return doc.c[i];
    if (!create) return null;
    var s = el('settings', { pass: pass }, []);
    var idx = PASS_ORDER.indexOf(pass), at = doc.c.length;
    for (var j = 0; j < doc.c.length; j++) {
      if (doc.c[j].n === 'settings' && PASS_ORDER.indexOf(doc.c[j].a.pass) > idx) { at = j; break; }
    }
    doc.c.splice(at, 0, s);
    return s;
  }
  function getComponent(doc, pass, name, arch, create) {
    var s = getSettings(doc, pass, create);
    if (!s) return null;
    for (var i = 0; i < s.c.length; i++) if (s.c[i].n === 'component' && s.c[i].a.name === name) return s.c[i];
    if (!create) return null;
    var c = component(name, arch, []);
    s.c.push(c);
    return c;
  }

  function serialize(doc, opts) {
    opts = opts || {};
    var nl = opts.newline || '\r\n';
    var out = ['<?xml version="1.0" encoding="utf-8"?>'];
    if (opts.comment) out.push('<!-- ' + String(opts.comment).replace(/--/g, '- -') + ' -->');
    (function write(e, depth) {
      var pad = new Array(depth + 1).join('  ');
      var attrs = Object.keys(e.a).map(function (k) { return ' ' + k + '="' + xmlEscape(e.a[k]) + '"'; }).join('');
      if (e.c.length) {
        out.push(pad + '<' + e.n + attrs + '>');
        e.c.forEach(function (ch) { write(ch, depth + 1); });
        out.push(pad + '</' + e.n + '>');
      } else if (e.t !== '') {
        out.push(pad + '<' + e.n + attrs + '>' + xmlEscape(e.t) + '</' + e.n + '>');
      } else {
        out.push(pad + '<' + e.n + attrs + ' />');
      }
    })(doc, 0);
    return out.join(nl) + nl;
  }

  // ---------------------------------------------------------------------------------------------
  // Minimal XML parser (well-formedness checker and importer). Elements, attributes, text,
  // CDATA, comments, processing instructions and the five predefined plus numeric entities.
  // Throws Error with .line on malformed input.
  // ---------------------------------------------------------------------------------------------
  var NAME_RE = /^[A-Za-z_:][-A-Za-z0-9_:.]*/;
  function decodeEntities(s, lineOf) {
    return s.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z]+)?;?/g, function (m, g) {
      if (!g || m[m.length - 1] !== ';') throw xmlError('Unescaped & in text or attribute', lineOf());
      if (g[0] === '#') {
        var code = g[1] === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        if (!(code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0x10ffff))) throw xmlError('Invalid character reference', lineOf());
        return String.fromCodePoint(code);
      }
      var map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
      if (!(g in map)) throw xmlError('Unknown entity &' + g + ';', lineOf());
      return map[g];
    });
  }
  function xmlError(msg, line) { var e = new Error(msg + (line ? ' (line ' + line + ')' : '')); e.line = line; return e; }

  function parseXml(text, opts) {
    opts = opts || {};
    var s = String(text), i = 0, n = s.length;
    if (s.charCodeAt(0) === 0xfeff) i = 1;
    function lineAt(p) { var l = 1; for (var k = 0; k < p && k < n; k++) if (s.charCodeAt(k) === 10) l++; return l; }
    var stack = [], rootEl = null, fragment = opts.fragment ? el('#fragment', null, []) : null;
    if (fragment) stack.push(fragment);
    while (i < n) {
      var lt = s.indexOf('<', i);
      var textPart = lt < 0 ? s.slice(i) : s.slice(i, lt);
      if (textPart) {
        if (!stack.length || (fragment && stack.length === 1)) {
          if (textPart.trim()) throw xmlError('Text outside the root element', lineAt(i));
        } else {
          if (textPart.indexOf(']]>') >= 0) throw xmlError(']]> is not allowed in text', lineAt(i));
          var p0 = i;
          stack[stack.length - 1].t += decodeEntities(textPart, function () { return lineAt(p0); });
        }
      }
      if (lt < 0) break;
      i = lt;
      if (s.startsWith('<!--', i)) {
        var ce = s.indexOf('-->', i + 4);
        if (ce < 0) throw xmlError('Unclosed comment', lineAt(i));
        if (s.slice(i + 4, ce).indexOf('--') >= 0) throw xmlError('-- inside a comment', lineAt(i));
        i = ce + 3; continue;
      }
      if (s.startsWith('<![CDATA[', i)) {
        var cd = s.indexOf(']]>', i);
        if (cd < 0) throw xmlError('Unclosed CDATA section', lineAt(i));
        if (stack.length && !(fragment && stack.length === 1)) stack[stack.length - 1].t += s.slice(i + 9, cd);
        else throw xmlError('CDATA outside the root element', lineAt(i));
        i = cd + 3; continue;
      }
      if (s.startsWith('<?', i)) {
        var pe = s.indexOf('?>', i);
        if (pe < 0) throw xmlError('Unclosed processing instruction', lineAt(i));
        var target = s.slice(i + 2, pe).split(/\s/)[0];
        if (target.toLowerCase() === 'xml' && (i > (s.charCodeAt(0) === 0xfeff ? 1 : 0))) throw xmlError('XML declaration must come first', lineAt(i));
        i = pe + 2; continue;
      }
      if (s.startsWith('<!DOCTYPE', i)) throw xmlError('DOCTYPE is not allowed in an answer file', lineAt(i));
      if (s[i + 1] === '/') {
        var m = NAME_RE.exec(s.slice(i + 2));
        if (!m) throw xmlError('Bad closing tag', lineAt(i));
        var close = s.indexOf('>', i);
        if (close < 0 || s.slice(i + 2 + m[0].length, close).trim()) throw xmlError('Bad closing tag', lineAt(i));
        var top = stack.pop();
        if (!top || top.n !== m[0]) throw xmlError('Closing tag </' + m[0] + '> does not match <' + (top ? top.n : '') + '>', lineAt(i));
        i = close + 1; continue;
      }
      // start tag
      var nm = NAME_RE.exec(s.slice(i + 1));
      if (!nm) throw xmlError('Bad start tag', lineAt(i));
      var e = el(nm[0], null, []);
      i += 1 + nm[0].length;
      var selfClose = false;
      for (;;) {
        var ws = /^\s*/.exec(s.slice(i))[0];
        i += ws.length;
        if (s[i] === '>') { i++; break; }
        if (s.startsWith('/>', i)) { i += 2; selfClose = true; break; }
        if (i >= n) throw xmlError('Unclosed start tag <' + e.n + '>', lineAt(i));
        if (!ws) throw xmlError('Expected whitespace between attributes', lineAt(i));
        var an = NAME_RE.exec(s.slice(i));
        if (!an) throw xmlError('Bad attribute in <' + e.n + '>', lineAt(i));
        i += an[0].length;
        var eq = /^\s*=\s*/.exec(s.slice(i));
        if (!eq) throw xmlError('Attribute ' + an[0] + ' has no value', lineAt(i));
        i += eq[0].length;
        var q = s[i];
        if (q !== '"' && q !== "'") throw xmlError('Attribute value must be quoted', lineAt(i));
        var endq = s.indexOf(q, i + 1);
        if (endq < 0) throw xmlError('Unclosed attribute value', lineAt(i));
        var raw = s.slice(i + 1, endq);
        if (raw.indexOf('<') >= 0) throw xmlError('< inside an attribute value', lineAt(i));
        if (Object.prototype.hasOwnProperty.call(e.a, an[0])) throw xmlError('Duplicate attribute ' + an[0], lineAt(i));
        var p1 = i;
        e.a[an[0]] = decodeEntities(raw, function () { return lineAt(p1); });
        i = endq + 1;
      }
      if (stack.length) stack[stack.length - 1].c.push(e);
      else if (rootEl) throw xmlError('More than one root element', lineAt(i));
      else rootEl = e;
      if (!selfClose) stack.push(e);
    }
    if (fragment) {
      if (stack.length !== 1) throw xmlError('Unclosed element <' + stack[stack.length - 1].n + '>', lineAt(n));
      return fragment;
    }
    if (stack.length) throw xmlError('Unclosed element <' + stack[stack.length - 1].n + '>', lineAt(n));
    if (!rootEl) throw xmlError('No root element', 1);
    // Whitespace-only text in elements that have element children is formatting.
    (function trim(x) { if (x.c.length) { if (!x.t.trim()) x.t = ''; x.c.forEach(trim); } })(rootEl);
    return rootEl;
  }
  function isWellFormed(text) { try { parseXml(text); return true; } catch (e) { return false; } }

  // ---------------------------------------------------------------------------------------------
  // Generic value <-> element conversion (used by "All settings", the raw XML block and import).
  // value: string | {child: value} | [item objects (repeated, wcm:action="add")] | {"@password": pw}
  // ---------------------------------------------------------------------------------------------
  function isPasswordContainer(e) { return !!(child(e, 'Value') && child(e, 'PlainText') && e.c.length === 2); }
  function passwordSuffix(name) { return /AdministratorPassword$/.test(name) ? 'AdministratorPassword' : 'Password'; }

  function elementToValue(e) {
    if (isPasswordContainer(e)) {
      var v = pathText(e, 'Value'), plain = pathText(e, 'PlainText').toLowerCase() === 'true';
      var dec = plain ? v : decodeUnattendPassword(v, passwordSuffix(e.n));
      if (dec !== null) return { '@password': dec };
    }
    if (!e.c.length) return e.t.trim();
    var out = {}, counts = {};
    e.c.forEach(function (c) { counts[c.n] = (counts[c.n] || 0) + 1; });
    e.c.forEach(function (c) {
      var list = counts[c.n] > 1 || c.a['wcm:action'] === 'add';
      var v = elementToValue(c);
      if (c.a['wcm:keyValue'] !== undefined) {
        if (typeof v !== 'object' || Array.isArray(v)) v = { '#text': v };
        v['@keyValue'] = c.a['wcm:keyValue'];
      }
      if (list) { (out[c.n] = out[c.n] || []).push(v); } else out[c.n] = v;
    });
    return out;
  }
  function valueToElement(name, v, asItem) {
    var attrs = asItem ? { 'wcm:action': 'add' } : null;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (v['@keyValue'] !== undefined) { attrs = attrs || {}; attrs['wcm:keyValue'] = v['@keyValue']; }
      if (v['@password'] !== undefined) {
        return el(name, attrs, [leaf('Value', unattendPassword(v['@password'], passwordSuffix(name))), leaf('PlainText', 'false')]);
      }
      if (v['#text'] !== undefined) return el(name, attrs, str(v['#text']));
      var kids = [];
      Object.keys(v).forEach(function (k) {
        if (k[0] === '@' || k[0] === '#') return;
        var cv = v[k];
        if (Array.isArray(cv)) cv.forEach(function (item) { kids.push(valueToElement(k, item, true)); });
        else kids.push(valueToElement(k, cv, false));
      });
      return el(name, attrs, kids);
    }
    if (typeof v === 'boolean') v = v ? 'true' : 'false';
    return el(name, attrs, str(v));
  }
  function deepEqualEl(a, b) {
    if (a.n !== b.n || a.t.trim() !== b.t.trim() || a.c.length !== b.c.length) return false;
    if ((a.a['wcm:keyValue'] || '') !== (b.a['wcm:keyValue'] || '')) return false;
    if (isPasswordContainer(a) && isPasswordContainer(b)) {
      var va = elementToValue(a), vb = elementToValue(b);
      if (va['@password'] !== undefined && va['@password'] === vb['@password']) return true;
    }
    for (var i = 0; i < a.c.length; i++) if (!deepEqualEl(a.c[i], b.c[i])) return false;
    return true;
  }
  // Merge a value object into an element: objects merge, list items append (renumbering a
  // clashing <Order>), leaves overwrite.
  function mergeValue(parent, obj) {
    Object.keys(obj || {}).forEach(function (k) {
      if (k[0] === '@' || k[0] === '#') return;
      var v = obj[k];
      if (Array.isArray(v)) {
        v.forEach(function (item) {
          var ne = valueToElement(k, item, true);
          var existing = children(parent, k);
          if (existing.some(function (x) { return deepEqualEl(x, ne); })) return;
          var ord = child(ne, 'Order');
          if (ord) {
            var used = existing.map(function (x) { return parseInt(pathText(x, 'Order'), 10) || 0; });
            if (used.indexOf(parseInt(ord.t, 10)) >= 0) ord.t = String(Math.max.apply(null, used) + 1);
          }
          var kv = ne.a['wcm:keyValue'];
          if (kv !== undefined) parent.c = parent.c.filter(function (x) { return !(x.n === k && x.a['wcm:keyValue'] === kv); });
          parent.c.push(ne);
        });
        return;
      }
      var cur = child(parent, k);
      var isObj = v && typeof v === 'object';
      if (isObj && v['@password'] === undefined && v['#text'] === undefined && cur && cur.c.length && !isPasswordContainer(cur)) {
        mergeValue(cur, v);
        return;
      }
      var ne2 = valueToElement(k, v, false);
      if (cur) parent.c[parent.c.indexOf(cur)] = ne2; else parent.c.push(ne2);
    });
  }
  // What in `inEl` is not already produced by `genEl`, as a sparse value object (or undefined).
  function diffElement(inEl, genEl) {
    var out = {}, any = false, names = [];
    inEl.c.forEach(function (c) { if (names.indexOf(c.n) < 0) names.push(c.n); });
    names.forEach(function (name) {
      var ins = children(inEl, name), gens = genEl ? children(genEl, name) : [];
      var isList = ins.length > 1 || ins.some(function (c) { return c.a['wcm:action'] === 'add'; });
      if (isList) {
        var used = [], left = [];
        ins.forEach(function (c) {
          var hit = -1;
          for (var g = 0; g < gens.length; g++) if (used.indexOf(g) < 0 && deepEqualEl(c, gens[g])) { hit = g; break; }
          if (hit >= 0) used.push(hit);
          else {
            var v = elementToValue(c);
            if (c.a['wcm:keyValue'] !== undefined && (typeof v !== 'object' || Array.isArray(v))) v = { '#text': v };
            if (c.a['wcm:keyValue'] !== undefined) v['@keyValue'] = c.a['wcm:keyValue'];
            left.push(v);
          }
        });
        if (left.length) { out[name] = left; any = true; }
        return;
      }
      var a = ins[0], b = gens.length === 1 ? gens[0] : null;
      if (b && deepEqualEl(a, b)) return;
      if (b && a.c.length && b.c.length && !isPasswordContainer(a)) {
        var sub = diffElement(a, b);
        if (sub !== undefined) { out[name] = sub; any = true; }
        return;
      }
      out[name] = elementToValue(a); any = true;
    });
    return any ? out : undefined;
  }
  function valuesToRawXml(map, arch) {
    // map: { "pass|Component": value } -> settings/component XML fragment text
    var byPass = {};
    Object.keys(map).forEach(function (key) {
      var parts = key.split('|');
      (byPass[parts[0]] = byPass[parts[0]] || []).push([parts[1], map[key]]);
    });
    var doc = el('#fragment', null, []);
    PASS_ORDER.concat(Object.keys(byPass).filter(function (p) { return PASS_ORDER.indexOf(p) < 0; })).forEach(function (pass) {
      if (!byPass[pass]) return;
      var s = el('settings', { pass: pass }, []);
      byPass[pass].forEach(function (pair) {
        var c = component(pair[0], arch, []);
        mergeValue(c, pair[1]);
        s.c.push(c);
      });
      doc.c.push(s);
    });
    return doc.c.map(function (s) { return serialize(s, { newline: '\n' }).replace(/^<\?xml[^>]*>\n/, ''); }).join('');
  }
  // Raw block: zero or more <settings pass="..."> elements. Returns { map, error }.
  function parseRawBlock(text) {
    if (!String(text || '').trim()) return { map: {} };
    try {
      var frag = parseXml(text, { fragment: true });
      var map = {};
      for (var i = 0; i < frag.c.length; i++) {
        var s = frag.c[i];
        if (s.n !== 'settings' || !s.a.pass) return { map: {}, error: 'raw.notSettings' };
        if (PASS_ORDER.indexOf(s.a.pass) < 0) return { map: {}, error: 'raw.badPass' };
        for (var j = 0; j < s.c.length; j++) {
          var c = s.c[j];
          if (c.n !== 'component' || !c.a.name) return { map: {}, error: 'raw.notComponent' };
          var key = s.a.pass + '|' + c.a.name;
          var v = elementToValue(c);
          map[key] = typeof v === 'object' ? v : {};
        }
      }
      return { map: map };
    } catch (e) {
      return { map: {}, error: 'raw.malformed', detail: e.message };
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Shared building blocks
  // ---------------------------------------------------------------------------------------------
  function internationalPE(arch, setupLang, f) {
    var ui = f.locale || 'en-US';
    return component('Microsoft-Windows-International-Core-WinPE', arch, [
      el('SetupUILanguage', null, [leaf('UILanguage', setupLang || ui)]),
      leaf('InputLocale', f.keyboard || ui), leaf('SystemLocale', ui), leaf('UILanguage', ui), leaf('UserLocale', ui)
    ]);
  }
  function internationalOobe(arch, f) {
    var ui = f.locale || 'en-US';
    return component('Microsoft-Windows-International-Core', arch, [
      leaf('InputLocale', f.keyboard || ui), leaf('SystemLocale', ui), leaf('UILanguage', ui), leaf('UserLocale', ui)
    ]);
  }
  function diskConfig(diskId, firmware) {
    var id = String(parseInt(diskId, 10) || 0);
    var cp, mp;
    if (firmware === 'bios') {
      cp = [
        addItem('CreatePartition', [leaf('Order', 1), leaf('Type', 'Primary'), leaf('Size', 500)]),
        addItem('CreatePartition', [leaf('Order', 2), leaf('Type', 'Primary'), leaf('Extend', 'true')])
      ];
      mp = [
        addItem('ModifyPartition', [leaf('Order', 1), leaf('PartitionID', 1), leaf('Format', 'NTFS'), leaf('Label', 'System'), leaf('Active', 'true')]),
        addItem('ModifyPartition', [leaf('Order', 2), leaf('PartitionID', 2), leaf('Format', 'NTFS'), leaf('Label', 'Windows'), leaf('Letter', 'C')])
      ];
    } else {
      cp = [
        addItem('CreatePartition', [leaf('Order', 1), leaf('Type', 'EFI'), leaf('Size', 300)]),
        addItem('CreatePartition', [leaf('Order', 2), leaf('Type', 'MSR'), leaf('Size', 16)]),
        addItem('CreatePartition', [leaf('Order', 3), leaf('Type', 'Primary'), leaf('Extend', 'true')])
      ];
      mp = [
        addItem('ModifyPartition', [leaf('Order', 1), leaf('PartitionID', 1), leaf('Format', 'FAT32'), leaf('Label', 'System')]),
        addItem('ModifyPartition', [leaf('Order', 2), leaf('PartitionID', 2)]),
        addItem('ModifyPartition', [leaf('Order', 3), leaf('PartitionID', 3), leaf('Format', 'NTFS'), leaf('Label', 'Windows'), leaf('Letter', 'C')])
      ];
    }
    return el('DiskConfiguration', null, [addItem('Disk', [leaf('DiskID', id), leaf('WillWipeDisk', 'true'), el('CreatePartitions', null, cp), el('ModifyPartitions', null, mp)])]);
  }
  function installPartitionFor(firmware) { return firmware === 'bios' ? 2 : 3; }
  function imageInstall(diskId, partitionId, byName, image) {
    var meta = byName
      ? addItem('MetaData', [leaf('Key', '/IMAGE/NAME'), leaf('Value', image)])
      : addItem('MetaData', [leaf('Key', '/IMAGE/INDEX'), leaf('Value', parseInt(image, 10) || 1)]);
    return el('ImageInstall', null, [el('OSImage', null, [
      el('InstallFrom', null, [meta]),
      el('InstallTo', null, [leaf('DiskID', parseInt(diskId, 10) || 0), leaf('PartitionID', parseInt(partitionId, 10) || 1)])
    ])]);
  }
  function userData(productKey, org, owner) {
    var kids = [leaf('AcceptEula', 'true')];
    if (productKey) kids.push(el('ProductKey', null, [leaf('Key', productKey), leaf('WillShowUI', 'OnError')]));
    if (org) kids.push(leaf('Organization', org));
    if (owner) kids.push(leaf('FullName', owner));
    return el('UserData', null, kids);
  }
  function pw(name, value) {
    return el(name, null, [leaf('Value', unattendPassword(value, passwordSuffix(name))), leaf('PlainText', 'false')]);
  }
  function syncCommands(listName, itemName, cmdName, items, extra) {
    return el(listName, null, items.map(function (it, i) {
      var kids = [leaf('Order', i + 1)];
      if (it.description) kids.push(leaf('Description', it.description));
      kids.push(leaf(cmdName, it.command));
      if (extra) extra(kids, it);
      return addItem(itemName, kids);
    }));
  }

  // ---------------------------------------------------------------------------------------------
  // Mode a) TempDesk server (Windows Server 2025 Core, first domain controller)
  // ---------------------------------------------------------------------------------------------
  var FIRSTLOGON_CMD = "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"$f = Get-PSDrive -PSProvider FileSystem | ForEach-Object { Join-Path $_.Root 'TempDesk\\FirstLogon.ps1' } | Where-Object { Test-Path $_ } | Select-Object -First 1; if ($f) { & $f }\"";

  function serverTree(o) {
    var arch = 'amd64', doc = newDoc();
    var f = { locale: o.locale || 'en-US', keyboard: o.keyboard || o.locale || 'en-US' };
    getSettings(doc, 'windowsPE', true).c.push(
      internationalPE(arch, null, f),
      component('Microsoft-Windows-Setup', arch, [
        diskConfig(0, o.firmware),
        imageInstall(0, installPartitionFor(o.firmware), false, o.imageIndex),
        userData(o.productKey)
      ]));
    getSettings(doc, 'specialize', true).c.push(component('Microsoft-Windows-Shell-Setup', arch, [
      leaf('ComputerName', o.computerName), leaf('TimeZone', o.timeZone || 'Eastern Standard Time')
    ]));
    getSettings(doc, 'oobeSystem', true).c.push(internationalOobe(arch, f), component('Microsoft-Windows-Shell-Setup', arch, [
      el('UserAccounts', null, [pw('AdministratorPassword', o.adminPassword || '')]),
      el('AutoLogon', null, [pw('Password', o.adminPassword || ''), leaf('Enabled', 'true'), leaf('LogonCount', 1), leaf('Username', 'Administrator')]),
      el('OOBE', null, [leaf('HideEULAPage', 'true'), leaf('HideLocalAccountScreen', 'true'), leaf('HideOnlineAccountScreens', 'true'), leaf('HideWirelessSetupInOOBE', 'true'), leaf('ProtectYourPC', 3)]),
      syncCommands('FirstLogonCommands', 'SynchronousCommand', 'CommandLine',
        [{ command: FIRSTLOGON_CMD, description: 'TempDesk unattended setup' }],
        function (kids) { kids.push(leaf('RequiresUserInput', 'false')); })
    ]));
    return doc;
  }
  var SERVER_COMMENT = 'Generated by TempDesk. Contains the Administrator password in Windows unattend encoding (base64, not encryption). Erase the media after installing.';

  // Compatible with the first version of this file.
  function buildAutounattend(o) { return serialize(serverTree(o), { comment: SERVER_COMMENT }); }

  function splitList(v) { return Array.isArray(v) ? v.map(String).filter(Boolean) : str(v).split(/[\s,;]+/).filter(Boolean); }
  function buildFirstboot(o) {
    return JSON.stringify({
      computerName: o.computerName,
      ipAddress: o.ipAddress,
      prefixLength: parseInt(o.prefixLength, 10),
      gateway: o.gateway,
      dnsServers: splitList(o.dnsServers),
      domainName: o.domainName,
      netbiosName: str(o.netbiosName).toUpperCase(),
      functionalLevel: o.functionalLevel || '',
      dsrmPassword: o.dsrmPassword,
      initialAdminUser: o.initialAdminUser || 'Administrator',
      agent: { tls: bool(o.agentTls) },
      portals: { mode: o.portalsMode === 'native' ? 'native' : 'none' }
    }, null, 2) + '\n';
  }
  // firstboot.json -> server form fields (inverse of buildFirstboot). Throws on a bad shape.
  function importFirstboot(text, base) {
    var j = JSON.parse(text);
    if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('firstboot.json must be a JSON object.');
    var f = clone(base || {});
    ['computerName', 'ipAddress', 'gateway', 'domainName', 'netbiosName', 'functionalLevel', 'dsrmPassword', 'initialAdminUser'].forEach(function (k) {
      if (j[k] !== undefined && j[k] !== null) f[k] = String(j[k]);
    });
    if (j.prefixLength !== undefined) f.prefixLength = String(j.prefixLength);
    if (Array.isArray(j.dnsServers)) f.dnsServers = j.dnsServers.join(', ');
    if (j.agent && typeof j.agent === 'object') f.agentTls = !!j.agent.tls;
    if (j.portals && typeof j.portals === 'object') f.portalsMode = j.portals.mode === 'native' ? 'native' : 'none';
    if (f.initialAdminUser === 'Administrator') delete f.initialAdminUser;
    return f;
  }
  // Zip layout of the server kit: autounattend.xml and TempDesk/ at the root; the firstboot scripts
  // (FirstLogon.ps1, Continue-Setup.ps1, SetupStatus.ps1) directly in TempDesk/; payload folders as
  // TempDesk/server, TempDesk/agent, TempDesk/client and TempDesk/portal (portal only when native).
  function kitLayout(manifest, portalsMode) {
    var out = [];
    (manifest.files || []).forEach(function (f) {
      var p = f.path;
      if (p.indexOf('server/firstboot/') === 0) {
        if (/^server\/firstboot\/[^/]+\.ps1$/.test(p)) out.push({ src: p, dest: 'TempDesk/' + p.slice(17), sha256: f.sha256 });
        return;
      }
      var top = p.split('/')[0];
      if (top === 'portal' && portalsMode !== 'native') return;
      if (top === 'server' || top === 'agent' || top === 'client' || top === 'portal') out.push({ src: p, dest: 'TempDesk/' + p, sha256: f.sha256 });
    });
    return out;
  }
  // Keys Continue-Setup.ps1 / FirstLogon.ps1 read from firstboot.json.
  var FIRSTBOOT_KEYS = ['computerName', 'ipAddress', 'prefixLength', 'gateway', 'dnsServers', 'domainName', 'netbiosName', 'functionalLevel', 'dsrmPassword', 'initialAdminUser', 'agent', 'portals'];

  function suggestNetbios(domain) {
    var first = str(domain).split('.')[0] || '';
    return first.replace(/[^A-Za-z0-9-]/g, '').slice(0, 15).toUpperCase();
  }
  function domainDn(domain) {
    return str(domain).split('.').filter(Boolean).map(function (p) { return 'DC=' + p; }).join(',');
  }

  // ---------------------------------------------------------------------------------------------
  // Mode b) Guest PC (Windows 11, joins the TempDesk domain in specialize)
  // ---------------------------------------------------------------------------------------------
  function dnsCommand(dns) {
    var list = splitList(dns).map(function (d) { return "'" + d + "'"; }).join(',');
    return "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Get-NetAdapter -Physical | Sort-Object ifIndex | Select-Object -First 1 | Set-DnsClientServerAddress -ServerAddresses " + list + '"';
  }
  function guestOu(o) {
    return o.ou || ('OU=Computers,OU=TempDesk,' + domainDn(o.domainName));
  }
  function guestTree(o) {
    var arch = o.arch || 'amd64', doc = newDoc();
    var f = { locale: o.locale || 'en-US', keyboard: o.keyboard || o.locale || 'en-US' };
    getSettings(doc, 'windowsPE', true).c.push(internationalPE(arch, null, f), component('Microsoft-Windows-Setup', arch, [
      diskConfig(o.diskId, o.firmware),
      imageInstall(o.diskId, installPartitionFor(o.firmware), false, o.imageIndex),
      userData(o.productKey)
    ]));
    var spec = getSettings(doc, 'specialize', true);
    spec.c.push(component('Microsoft-Windows-Shell-Setup', arch, [
      leaf('ComputerName', o.computerName ? o.computerName : '*'), leaf('TimeZone', o.timeZone || 'Eastern Standard Time')
    ]));
    if (o.dnsMode !== 'dhcp' && splitList(o.dnsServer).length) {
      spec.c.push(component('Microsoft-Windows-Deployment', arch, [
        syncCommands('RunSynchronous', 'RunSynchronousCommand', 'Path', [{ command: dnsCommand(o.dnsServer), description: 'Point DNS at the TempDesk domain controller before the domain join' }])
      ]));
    }
    spec.c.push(component('Microsoft-Windows-UnattendedJoin', arch, [
      el('Identification', null, [
        el('Credentials', null, [leaf('Domain', o.joinDomain || o.domainName), leaf('Password', o.joinPassword || ''), leaf('Username', o.joinUser || '')]),
        leaf('JoinDomain', o.domainName),
        leaf('MachineObjectOU', guestOu(o))
      ])
    ]));
    var oobeKids = [
      el('OOBE', null, [leaf('HideEULAPage', 'true'), leaf('HideOEMRegistrationScreen', 'true'), leaf('HideOnlineAccountScreens', 'true'), leaf('HideWirelessSetupInOOBE', 'true'), leaf('HideLocalAccountScreen', 'true'), leaf('ProtectYourPC', 3)])
    ];
    if (o.adminUser) {
      oobeKids.unshift(el('UserAccounts', null, [el('LocalAccounts', null, [addItem('LocalAccount', [
        pw('Password', o.adminPassword || ''), leaf('Description', 'Local administrator (TempDesk guest PC)'),
        leaf('DisplayName', o.adminUser), leaf('Group', 'Administrators'), leaf('Name', o.adminUser)
      ])])]));
    }
    getSettings(doc, 'oobeSystem', true).c.push(internationalOobe(arch, f), component('Microsoft-Windows-Shell-Setup', arch, oobeKids));
    return doc;
  }
  var GUEST_COMMENT = 'Generated by TempDesk. WARNING: the domain join password is stored in PLAIN TEXT in this file. Use a dedicated account that can only join computers, and erase the media after installing.';

  // ---------------------------------------------------------------------------------------------
  // Mode c) Custom (general Windows / Windows Server)
  // ---------------------------------------------------------------------------------------------
  var OOBE_HIDE = ['HideEULAPage', 'HideOEMRegistrationScreen', 'HideOnlineAccountScreens', 'HideWirelessSetupInOOBE', 'HideLocalAccountScreen'];
  function featureCommand(o) {
    var names = splitList(o.features);
    if (!names.length) return null;
    if (o.target === 'server') {
      return { command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Install-WindowsFeature -Name ' + names.join(',') + ' -IncludeManagementTools"', description: 'Enable Windows features (TempDesk builder)' };
    }
    return { command: 'cmd.exe /c ' + names.map(function (n) { return 'dism.exe /online /enable-feature /featurename:' + n + ' /all /norestart'; }).join(' & '), description: 'Enable Windows features (TempDesk builder)' };
  }
  var EDGE_CMD = 'reg.exe add "HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge" /v HideFirstRunExperience /t REG_DWORD /d 1 /f';
  function customTree(o) {
    var arch = o.arch || 'amd64', doc = newDoc();
    var f = { locale: o.locale || 'en-US', keyboard: o.keyboard || o.locale || 'en-US' };
    var setupKids = [];
    var layout = o.diskLayout || 'uefi';
    var part;
    if (layout === 'existing') part = parseInt(o.partitionId, 10) || 1;
    else { setupKids.push(diskConfig(o.diskId, layout === 'bios' ? 'bios' : 'uefi')); part = installPartitionFor(layout === 'bios' ? 'bios' : 'uefi'); }
    setupKids.push(imageInstall(o.diskId, part, o.imageBy === 'name', o.imageBy === 'name' ? o.imageName : o.imageIndex));
    setupKids.push(userData(o.productKey, o.organization, o.owner));
    var pe = getSettings(doc, 'windowsPE', true);
    pe.c.push(internationalPE(arch, o.setupLanguage, f), component('Microsoft-Windows-Setup', arch, setupKids));
    var drivers = splitList(o.driversPE ? str(o.driversPE).split(/\n/).join(',') : '');
    drivers = str(o.driversPE).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (drivers.length) {
      pe.c.push(component('Microsoft-Windows-PnpCustomizationsWinPE', arch, [el('DriverPaths', null, drivers.map(function (p, i) {
        return addItem('PathAndCredentials', [leaf('Path', p)], String(i + 1));
      }))]));
    }
    var offDrivers = str(o.driversOffline).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (offDrivers.length) {
      getSettings(doc, 'offlineServicing', true).c.push(component('Microsoft-Windows-PnpCustomizationsNonWinPE', arch, [el('DriverPaths', null, offDrivers.map(function (p, i) {
        return addItem('PathAndCredentials', [leaf('Path', p)], String(i + 1));
      }))]));
    }
    var spec = getSettings(doc, 'specialize', true);
    var shellSpec = [leaf('ComputerName', o.computerName ? o.computerName : '*')];
    if (o.organization) shellSpec.push(leaf('RegisteredOrganization', o.organization));
    if (o.owner) shellSpec.push(leaf('RegisteredOwner', o.owner));
    shellSpec.push(leaf('TimeZone', o.timeZone || 'Eastern Standard Time'));
    spec.c.push(component('Microsoft-Windows-Shell-Setup', arch, shellSpec));
    var runSync = [];
    if (bool(o.edgeFirstRunOff)) runSync.push({ command: EDGE_CMD, description: 'Edge first-run experience off (policy)' });
    if (runSync.length) spec.c.push(component('Microsoft-Windows-Deployment', arch, [syncCommands('RunSynchronous', 'RunSynchronousCommand', 'Path', runSync)]));
    if (bool(o.rdp)) {
      spec.c.push(
        component('Microsoft-Windows-TerminalServices-LocalSessionManager', arch, [leaf('fDenyTSConnections', 'false')]),
        component('Networking-MPSSVC-Svc', arch, [el('FirewallGroups', null, [addItem('FirewallGroup', [leaf('Active', 'true'), leaf('Group', 'Remote Desktop'), leaf('Profile', 'all')], 'RemoteDesktop')])]),
        component('Microsoft-Windows-TerminalServices-RDP-WinStationExtensions', arch, [leaf('UserAuthentication', 1)]));
    }
    var oobe = [];
    var accounts = (o.accounts || []).filter(function (a) { return a && str(a.name).trim(); });
    var ua = [];
    if (o.adminPassword) ua.push(pw('AdministratorPassword', o.adminPassword));
    if (accounts.length) ua.push(el('LocalAccounts', null, accounts.map(function (a) {
      return addItem('LocalAccount', [pw('Password', a.password || ''), leaf('DisplayName', a.displayName || a.name), leaf('Group', a.group === 'Users' ? 'Users' : 'Administrators'), leaf('Name', a.name)]);
    })));
    if (ua.length) oobe.push(el('UserAccounts', null, ua));
    var alc = parseInt(o.autoLogonCount, 10) || 0;
    if (alc > 0) {
      var who = accounts[0] || { name: 'Administrator', password: o.adminPassword || '' };
      oobe.push(el('AutoLogon', null, [pw('Password', who.password || ''), leaf('Enabled', 'true'), leaf('LogonCount', alc), leaf('Username', who.name)]));
    }
    var hide = OOBE_HIDE.filter(function (k) { return bool(o['oobe' + k]); }).map(function (k) { return leaf(k, 'true'); });
    if (o.protectYourPC) hide.push(leaf('ProtectYourPC', parseInt(o.protectYourPC, 10) || 3));
    if (hide.length) oobe.push(el('OOBE', null, hide));
    var fl = [];
    var feat = featureCommand(o);
    if (feat) fl.push(feat);
    if (fl.length) oobe.push(syncCommands('FirstLogonCommands', 'SynchronousCommand', 'CommandLine', fl, function (kids) { kids.push(leaf('RequiresUserInput', 'false')); }));
    getSettings(doc, 'oobeSystem', true).c.push(internationalOobe(arch, f));
    if (oobe.length) getSettings(doc, 'oobeSystem', true).c.push(component('Microsoft-Windows-Shell-Setup', arch, oobe));
    return doc;
  }
  var CUSTOM_COMMENT = 'Generated by the TempDesk answer file builder. Passwords use Windows unattend encoding (base64, not encryption). Erase the media after installing.';

  // ---------------------------------------------------------------------------------------------
  // Whole model: { mode, server, guest, custom, all: {"pass|Component": value}, raw: "xml" }
  // ---------------------------------------------------------------------------------------------
  var MODES = ['server', 'guest', 'custom'];
  function modeTree(mode, form) {
    if (mode === 'guest') return guestTree(form || {});
    if (mode === 'custom') return customTree(form || {});
    return serverTree(form || {});
  }
  function modeComment(mode) { return mode === 'guest' ? GUEST_COMMENT : mode === 'custom' ? CUSTOM_COMMENT : SERVER_COMMENT; }
  function modeArch(model) { var f = model[model.mode] || {}; return model.mode === 'server' ? 'amd64' : (f.arch || 'amd64'); }

  function mergeMap(doc, map, arch) {
    Object.keys(map || {}).forEach(function (key) {
      var parts = key.split('|');
      if (PASS_ORDER.indexOf(parts[0]) < 0 || !parts[1]) return;
      var c = getComponent(doc, parts[0], parts[1], arch, true);
      mergeValue(c, map[key]);
    });
  }
  // ---- Model-level command lists (command timeline) -------------------------------------------
  // model.commands = { runSync: [], runAsync: [], firstLogon: [], logon: [] }
  // item: { command, description, willReboot: 'Never'|'Always'|'OnRequest', disabled, credentials: {domain, username, password} }
  var COMMAND_LISTS = {
    runSync: { pass: 'specialize', component: 'Microsoft-Windows-Deployment', list: 'RunSynchronous', item: 'RunSynchronousCommand', cmd: 'Path', reboot: true, creds: true },
    runAsync: { pass: 'specialize', component: 'Microsoft-Windows-Deployment', list: 'RunAsynchronous', item: 'RunAsynchronousCommand', cmd: 'Path', reboot: false, creds: true },
    firstLogon: { pass: 'oobeSystem', component: 'Microsoft-Windows-Shell-Setup', list: 'FirstLogonCommands', item: 'SynchronousCommand', cmd: 'CommandLine', reboot: false, creds: false, userInput: true },
    logon: { pass: 'oobeSystem', component: 'Microsoft-Windows-Shell-Setup', list: 'LogonCommands', item: 'AsynchronousCommand', cmd: 'CommandLine', reboot: false, creds: false, userInput: true }
  };
  function commandItem(def, it, order) {
    var kids = [leaf('Order', order)];
    if (it.description) kids.push(leaf('Description', it.description));
    kids.push(leaf(def.cmd, it.command));
    if (def.reboot && it.willReboot && it.willReboot !== 'Never') kids.push(leaf('WillReboot', it.willReboot));
    if (def.userInput) kids.push(leaf('RequiresUserInput', 'false'));
    var c = it.credentials;
    if (def.creds && c && (c.username || c.domain)) kids.push(el('Credentials', null, [leaf('Domain', c.domain || ''), leaf('Password', c.password || ''), leaf('Username', c.username || '')]));
    return addItem(def.item, kids);
  }
  function mergeCommands(doc, commands, arch) {
    Object.keys(COMMAND_LISTS).forEach(function (k) {
      var items = ((commands || {})[k] || []).filter(function (it) { return it && !it.disabled && str(it.command).trim(); });
      if (!items.length) return;
      var def = COMMAND_LISTS[k];
      var comp = getComponent(doc, def.pass, def.component, arch, true);
      var list = child(comp, def.list);
      if (!list) { list = el(def.list, null, []); comp.c.push(list); }
      var used = children(list, def.item).map(function (x) { return parseInt(pathText(x, 'Order'), 10) || 0; });
      var next = used.length ? Math.max.apply(null, used) + 1 : 1;
      items.forEach(function (it) { list.c.push(commandItem(def, it, next++)); });
    });
  }
  function readCommandItem(def, e) {
    var it = { command: pathText(e, def.cmd), description: pathText(e, 'Description'), willReboot: pathText(e, 'WillReboot') || 'Never', disabled: false };
    var c = path(e, 'Credentials');
    if (c) it.credentials = { domain: pathText(c, 'Domain'), username: pathText(c, 'Username'), password: pathText(c, 'Password') };
    return it;
  }

  // ---- Model-level disk layout (disk canvas) ---------------------------------------------------
  // model.disks = null | { disks: [{ diskId, sizeMB, wipe, partitions: [{ type, sizeMB, extend, format, label, letter, active, typeId }] }],
  //                        target: { diskId, partitionId } }
  var PART_TYPES = ['EFI', 'MSR', 'Primary', 'Recovery', 'Extended', 'Logical'];
  var RECOVERY_GPT = 'de94bba4-06d1-4d40-a16a-bfd50179d6ac';
  function layoutDiskXml(layout) {
    var disks = (layout.disks || []).map(function (d) {
      var kids = [leaf('DiskID', parseInt(d.diskId, 10) || 0), leaf('WillWipeDisk', d.wipe === false ? 'false' : 'true')];
      var cp = [], mp = [];
      (d.partitions || []).forEach(function (p, i) {
        var order = i + 1;
        var type = p.type === 'Recovery' ? 'Primary' : p.type;
        var ck = [leaf('Order', order), leaf('Type', type)];
        if (p.extend) ck.push(leaf('Extend', 'true')); else ck.push(leaf('Size', Math.max(1, parseInt(p.sizeMB, 10) || 1)));
        cp.push(addItem('CreatePartition', ck));
        var mk = [leaf('Order', order), leaf('PartitionID', order)];
        if (p.type === 'EFI') { mk.push(leaf('Format', 'FAT32')); }
        else if (p.type !== 'MSR' && p.type !== 'Extended' && p.format) mk.push(leaf('Format', p.format));
        if (p.label && p.type !== 'MSR' && p.type !== 'Extended') mk.push(leaf('Label', p.label));
        if (p.letter && /^[C-Z]$/i.test(p.letter)) mk.push(leaf('Letter', p.letter.toUpperCase()));
        if (p.active) mk.push(leaf('Active', 'true'));
        if (p.type === 'Recovery') mk.push(leaf('TypeID', p.typeId || RECOVERY_GPT));
        mp.push(addItem('ModifyPartition', mk));
      });
      if (d.wipe !== false && cp.length) kids.push(el('CreatePartitions', null, cp));
      if (mp.length) kids.push(el('ModifyPartitions', null, mp));
      return addItem('Disk', kids);
    });
    return el('DiskConfiguration', null, disks);
  }
  function applyDiskLayout(doc, layout, arch) {
    var setup = getComponent(doc, 'windowsPE', 'Microsoft-Windows-Setup', arch, true);
    setup.c = setup.c.filter(function (c) { return c.n !== 'DiskConfiguration'; });
    if ((layout.disks || []).length) setup.c.unshift(layoutDiskXml(layout));
    var t = layout.target || {};
    var ii = child(setup, 'ImageInstall');
    if (!ii) { ii = el('ImageInstall', null, [el('OSImage', null, [])]); setup.c.push(ii); }
    var os = child(ii, 'OSImage');
    os.c = os.c.filter(function (c) { return c.n !== 'InstallTo' && c.n !== 'InstallToAvailablePartition'; });
    os.c.push(el('InstallTo', null, [leaf('DiskID', parseInt(t.diskId, 10) || 0), leaf('PartitionID', parseInt(t.partitionId, 10) || 1)]));
  }
  function readDiskLayout(setup) {
    var dc = path(setup, 'DiskConfiguration');
    var layout = { disks: [], target: { diskId: pathText(setup, 'ImageInstall/OSImage/InstallTo/DiskID') || '0', partitionId: pathText(setup, 'ImageInstall/OSImage/InstallTo/PartitionID') || '1' } };
    if (!dc) return layout;
    children(dc, 'Disk').forEach(function (d) {
      var disk = { diskId: pathText(d, 'DiskID') || '0', sizeMB: 0, wipe: pathText(d, 'WillWipeDisk').toLowerCase() === 'true', partitions: [] };
      var mods = children(path(d, 'ModifyPartitions') || el('x'), 'ModifyPartition');
      var creates = children(path(d, 'CreatePartitions') || el('x'), 'CreatePartition').sort(function (a, b) { return (parseInt(pathText(a, 'Order'), 10) || 0) - (parseInt(pathText(b, 'Order'), 10) || 0); });
      creates.forEach(function (c, i) {
        var m = mods.filter(function (x) { return pathText(x, 'PartitionID') === String(i + 1); })[0];
        var type = pathText(c, 'Type') || 'Primary';
        var typeId = m ? pathText(m, 'TypeID') : '';
        var p = { type: typeId && typeId.toLowerCase() === RECOVERY_GPT ? 'Recovery' : type, sizeMB: pathText(c, 'Size') || '0', extend: pathText(c, 'Extend').toLowerCase() === 'true',
          format: m ? pathText(m, 'Format') : '', label: m ? pathText(m, 'Label') : '', letter: m ? pathText(m, 'Letter') : '', active: !!(m && pathText(m, 'Active').toLowerCase() === 'true') };
        if (p.type === 'Recovery' && typeId.toLowerCase() !== RECOVERY_GPT) p.typeId = typeId;
        if (p.type === 'EFI') p.format = 'FAT32';
        disk.partitions.push(p);
      });
      layout.disks.push(disk);
    });
    return layout;
  }

  // ---- Extras: dense-section settings shared by every mode -------------------------------------
  // Component settings (written as real unattend settings) and generated commands (tagged with a
  // description "TempDesk extra: <id>=<value>" so import restores them exactly).
  var EXTRA_SETTINGS = [
    { id: 'uacOff', pass: 'offlineServicing', comp: 'Microsoft-Windows-LUA-Settings', path: 'EnableLUA', value: 'false' },
    { id: 'ceipOff', pass: 'specialize', comp: 'Microsoft-Windows-SQMApi', path: 'CEIPEnabled', value: '0' },
    { id: 'werOff', pass: 'specialize', comp: 'Microsoft-Windows-ErrorReportingCore', path: 'DisableWER', value: '1' },
    { id: 'serverManagerOff', pass: 'specialize', comp: 'Microsoft-Windows-ServerManager-SvrMgrNc', path: 'DoNotOpenServerManagerAtLogon', value: 'true' },
    { id: 'ieEscOff', pass: 'specialize', comp: 'Microsoft-Windows-IE-ESC', path: 'IEHardenAdmin', value: 'false' },
    { id: 'oemManufacturer', pass: 'specialize', comp: 'Microsoft-Windows-Shell-Setup', path: 'OEMInformation/Manufacturer', text: true },
    { id: 'oemModel', pass: 'specialize', comp: 'Microsoft-Windows-Shell-Setup', path: 'OEMInformation/Model', text: true },
    { id: 'oemSupportUrl', pass: 'specialize', comp: 'Microsoft-Windows-Shell-Setup', path: 'OEMInformation/SupportURL', text: true },
    { id: 'oemSupportPhone', pass: 'specialize', comp: 'Microsoft-Windows-Shell-Setup', path: 'OEMInformation/SupportPhone', text: true },
    { id: 'oemSupportHours', pass: 'specialize', comp: 'Microsoft-Windows-Shell-Setup', path: 'OEMInformation/SupportHours', text: true },
    { id: 'oemLogo', pass: 'specialize', comp: 'Microsoft-Windows-Shell-Setup', path: 'OEMInformation/Logo', text: true }
  ];
  var POWER_PLANS = { balanced: '381b4222-f694-41f0-9685-ff5bb260df2e', high: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', saver: 'a1841308-3541-4fab-bc81-f71556f20b4a' };
  var APP_IDS = { chrome: 'Google.Chrome', vscode: 'Microsoft.VisualStudioCode', git: 'Git.Git', node: 'OpenJS.NodeJS.LTS', python: 'Python.Python.3.13', sevenzip: '7zip.7zip', pwsh: 'Microsoft.PowerShell' };
  var REG = 'reg.exe add ';
  // id -> { list, build(value) -> command or null }
  var EXTRA_COMMANDS = {
    updates: { list: 'runSync', build: function (v) {
      if (v === 'notify') return REG + '"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" /v AUOptions /t REG_DWORD /d 2 /f';
      if (v === 'off') return REG + '"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsUpdate\\AU" /v NoAutoUpdate /t REG_DWORD /d 1 /f';
      return null; } },
    telemetry: { list: 'runSync', build: function (v) {
      if (v === '0' || v === '1') return REG + '"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DataCollection" /v AllowTelemetry /t REG_DWORD /d ' + v + ' /f';
      return null; } },
    advertisingIdOff: { list: 'runSync', build: function (v) { return v ? REG + '"HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\AdvertisingInfo" /v DisabledByGroupPolicy /t REG_DWORD /d 1 /f' : null; } },
    verboseStatus: { list: 'runSync', build: function (v) { return v ? REG + '"HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v VerboseStatus /t REG_DWORD /d 1 /f' : null; } },
    powerPlan: { list: 'firstLogon', build: function (v) { return POWER_PLANS[v] ? 'powercfg.exe /setactive ' + POWER_PLANS[v] : null; } },
    hibernateOff: { list: 'firstLogon', build: function (v) { return v ? 'powercfg.exe /hibernate off' : null; } },
    monitorTimeout: { list: 'firstLogon', build: function (v) { return /^\d{1,3}$/.test(str(v)) ? 'powercfg.exe /change monitor-timeout-ac ' + parseInt(v, 10) : null; } },
    ntpServer: { list: 'firstLogon', build: function (v) { return /^[A-Za-z0-9.,-]{1,200}$/.test(str(v)) ? 'cmd.exe /c w32tm /config /manualpeerlist:"' + str(v).split(',').join(' ') + '" /syncfromflags:manual /update && w32tm /resync' : null; } },
    winrm: { list: 'firstLogon', build: function (v) { return v ? 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Enable-PSRemoting -Force -SkipNetworkProfileCheck"' : null; } },
    sshServer: { list: 'firstLogon', build: function (v) { return v ? 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0; Set-Service sshd -StartupType Automatic; Start-Service sshd"' : null; } },
    apps: { list: 'firstLogon', build: function (v) {
      var ids = splitList(v).filter(function (a) { return APP_IDS[a]; });
      return ids.length ? 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "' + ids.map(function (a) { return 'winget install --id ' + APP_IDS[a] + ' -e --silent --accept-package-agreements --accept-source-agreements --scope machine'; }).join('; ') + '"' : null; } },
    setupLog: { list: 'firstLogon', build: function (v) { return v ? 'cmd.exe /c mkdir C:\\ProgramData\\TempDesk\\logs 2>nul & copy /y C:\\Windows\\Panther\\setupact.log C:\\ProgramData\\TempDesk\\logs\\ & copy /y C:\\Windows\\Panther\\UnattendGC\\setupact.log C:\\ProgramData\\TempDesk\\logs\\setupact-oobe.log' : null; } }
  };
  var EXTRA_TAG = 'TempDesk extra: ';
  function extraDefaults() {
    return { uacOff: false, ceipOff: false, werOff: false, serverManagerOff: false, ieEscOff: false, oemManufacturer: '', oemModel: '', oemSupportUrl: '', oemSupportPhone: '', oemSupportHours: '', oemLogo: '',
      updates: 'default', telemetry: 'default', advertisingIdOff: false, verboseStatus: false, powerPlan: '', hibernateOff: false, monitorTimeout: '', ntpServer: '', winrm: false, sshServer: false, apps: '', setupLog: false };
  }
  function encodeExtraValue(v) { return typeof v === 'boolean' ? (v ? 'true' : 'false') : str(v); }
  function applyExtras(doc, extras, arch) {
    if (!extras) return;
    EXTRA_SETTINGS.forEach(function (d) {
      var v = extras[d.id];
      if (d.text ? !str(v).trim() : !v) return;
      var obj = {}, cur = obj, parts = d.path.split('/');
      for (var i = 0; i < parts.length - 1; i++) { cur[parts[i]] = {}; cur = cur[parts[i]]; }
      cur[parts[parts.length - 1]] = d.text ? str(v) : d.value;
      mergeValue(getComponent(doc, d.pass, d.comp, arch, true), obj);
    });
    var cmds = { runSync: [], firstLogon: [] };
    Object.keys(EXTRA_COMMANDS).forEach(function (id) {
      var def = EXTRA_COMMANDS[id], v = extras[id];
      if (v === undefined || v === '' || v === false || v === 'default') return;
      var c = def.build(v);
      if (c) cmds[def.list].push({ command: c, description: EXTRA_TAG + id + '=' + encodeExtraValue(v) });
    });
    mergeCommands(doc, cmds, arch);
  }
  function readExtras(doc) {
    var ex = extraDefaults(), found = false;
    EXTRA_SETTINGS.forEach(function (d) {
      var c = compOf(doc, d.pass, d.comp);
      if (!c) return;
      var t = pathText(c, d.path);
      if (d.text) { if (t) { ex[d.id] = t; found = true; } }
      else if (t.toLowerCase() === d.value) { ex[d.id] = true; found = true; }
    });
    Object.keys(COMMAND_LISTS).forEach(function (k) {
      var def = COMMAND_LISTS[k], c = compOf(doc, def.pass, def.component);
      children(c && path(c, def.list) || el('x'), def.item).forEach(function (x) {
        var desc = pathText(x, 'Description');
        if (desc.indexOf(EXTRA_TAG) !== 0) return;
        var kv = desc.slice(EXTRA_TAG.length), eq = kv.indexOf('='), id = kv.slice(0, eq), val = kv.slice(eq + 1);
        if (!EXTRA_COMMANDS[id]) return;
        var parsed = typeof ex[id] === 'boolean' ? val === 'true' : val;
        if (EXTRA_COMMANDS[id].build(parsed) === pathText(x, def.cmd)) { ex[id] = parsed; found = true; }
      });
    });
    return found ? ex : null;
  }

  // ---- Deployment map extras (written back into firstboot fields and guest join) ---------------
  // model.deploy = { appHost: { name, ip }, portalsHost: { name, ip, guestPort, adminPort }, network: { cidr } }

  function buildModelTree(model) {
    var mode = MODES.indexOf(model.mode) >= 0 ? model.mode : 'server';
    var doc = modeTree(mode, model[mode]);
    var arch = modeArch(model);
    if (model.disks && Array.isArray(model.disks.disks)) applyDiskLayout(doc, model.disks, arch);
    applyExtras(doc, model.extras, arch);
    mergeCommands(doc, model.commands, arch);
    mergeMap(doc, model.all, arch);
    var raw = parseRawBlock(model.raw);
    mergeMap(doc, raw.map, arch);
    return doc;
  }
  function buildXml(model) {
    return serialize(buildModelTree(model), { comment: modeComment(model.mode) });
  }

  // ---------------------------------------------------------------------------------------------
  // Validation. validateMode returns {field: code}; validate() keeps the original message API.
  // ---------------------------------------------------------------------------------------------
  var MESSAGES = {
    computerName: 'Use 1 to 15 letters, numbers or hyphens (not only numbers).',
    computerNameOpt: 'Use 1 to 15 letters, numbers or hyphens (not only numbers), or leave empty for a random name.',
    domainName: 'Use a full DNS name such as lab.example.org.',
    netbiosName: 'Use 1 to 15 letters, numbers or hyphens.',
    ip: 'Enter an IPv4 address.',
    prefix: 'Use a prefix between 8 and 30 (24 is common).',
    dns: 'Enter one or more IPv4 addresses, separated by commas.',
    password: 'At least 12 characters with upper and lower case, a number and a symbol.',
    passwordReq: 'Enter a password.',
    productKey: 'Format: XXXXX-XXXXX-XXXXX-XXXXX-XXXXX, or leave empty.',
    imageIndex: 'Use a whole number from 1 to 99.',
    imageName: 'Enter the image name exactly as dism /Get-WimInfo shows it.',
    diskId: 'Use a disk number from 0 to 99.',
    partitionId: 'Use a partition number from 1 to 128.',
    user: 'Use 1 to 20 characters without " / \\ [ ] : ; | = , + * ? < >.',
    ou: 'Use a distinguished name such as OU=Computers,OU=TempDesk,DC=lab,DC=example,DC=org.',
    locale: 'Use a language tag such as en-US or zh-HK.',
    keyboard: 'Use a language tag (en-US) or an input locale such as 0409:00000409.',
    timeZone: 'Pick a Windows time zone id from the list.',
    functionalLevel: 'Leave empty for the server default, or choose Win2025.',
    count: 'Use a whole number from 0 to 999.',
    command: 'Commands cannot be empty; remove the row instead.',
    path: 'Enter a path such as D:\\Drivers or \\\\server\\share\\drivers.',
    raw: 'The raw XML block is not valid. See the message below it.'
  };
  var IP_RE = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
  var NAME15 = /^[A-Za-z0-9-]{1,15}$/;
  function strongPassword(p) { p = str(p); return p.length >= 12 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p) && /[^A-Za-z0-9]/.test(p); }
  function okComputer(n) { return NAME15.test(n) && !/^\d+$/.test(n); }
  function okUser(u) { return /^[^"/\\\[\]:;|=,+*?<>]{1,20}$/.test(str(u)) && str(u).trim() === str(u); }
  var LOCALE_RE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
  var KEYBOARD_RE = /^([a-z]{2,3}(-[A-Za-z0-9]{2,8})*|[0-9A-Fa-f]{4}:[0-9A-Fa-f]{8}|[0-9A-Fa-f]{4}:\{[0-9A-Fa-f-]{36}\}\{[0-9A-Fa-f-]{36}\})(;([a-z]{2,3}(-[A-Za-z0-9]{2,8})*|[0-9A-Fa-f]{4}:[0-9A-Fa-f]{8}))*$/;
  function checkCommon(o, errors) {
    if (o.locale !== undefined && !LOCALE_RE.test(str(o.locale))) errors.locale = 'locale';
    if (o.keyboard && !KEYBOARD_RE.test(str(o.keyboard))) errors.keyboard = 'keyboard';
    if (o.timeZone !== undefined && TIME_ZONE_IDS.indexOf(str(o.timeZone)) < 0) errors.timeZone = 'timeZone';
    if (o.productKey && !/^([A-Z0-9]{5}-){4}[A-Z0-9]{5}$/i.test(o.productKey)) errors.productKey = 'productKey';
  }
  function validateMode(mode, o) {
    o = o || {};
    var errors = {};
    if (mode === 'server') {
      if (!okComputer(str(o.computerName))) errors.computerName = 'computerName';
      if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(str(o.domainName))) errors.domainName = 'domainName';
      if (!NAME15.test(str(o.netbiosName))) errors.netbiosName = 'netbiosName';
      if (!IP_RE.test(str(o.ipAddress))) errors.ipAddress = 'ip';
      if (!IP_RE.test(str(o.gateway))) errors.gateway = 'ip';
      var p = parseInt(o.prefixLength, 10);
      if (!(p >= 8 && p <= 30)) errors.prefixLength = 'prefix';
      var dns = splitList(o.dnsServers);
      if (!dns.length || dns.some(function (d) { return !IP_RE.test(d); })) errors.dnsServers = 'dns';
      if (!strongPassword(o.adminPassword)) errors.adminPassword = 'password';
      if (!strongPassword(o.dsrmPassword)) errors.dsrmPassword = 'password';
      if (o.functionalLevel && o.functionalLevel !== 'Win2025') errors.functionalLevel = 'functionalLevel';
      var ix = parseInt(o.imageIndex, 10);
      if (o.imageIndex !== undefined && !(ix >= 1 && ix <= 99 && String(ix) === str(o.imageIndex).trim())) errors.imageIndex = 'imageIndex';
    } else if (mode === 'guest') {
      if (o.computerName && !okComputer(str(o.computerName))) errors.computerName = 'computerNameOpt';
      if (!/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(str(o.domainName))) errors.domainName = 'domainName';
      if (!okUser(o.joinUser)) errors.joinUser = 'user';
      if (!str(o.joinPassword)) errors.joinPassword = 'passwordReq';
      if (o.ou && !/^(OU|CN)=[^,]+(,(OU|CN|DC)=[^,]+)*$/i.test(str(o.ou))) errors.ou = 'ou';
      if (o.dnsMode !== 'dhcp') {
        var d2 = splitList(o.dnsServer);
        if (!d2.length || d2.some(function (d) { return !IP_RE.test(d); })) errors.dnsServer = 'dns';
      }
      if (o.adminUser && !okUser(o.adminUser)) errors.adminUser = 'user';
      if (o.adminUser && !strongPassword(o.adminPassword)) errors.adminPassword = 'password';
      var gi = parseInt(o.imageIndex, 10);
      if (!(gi >= 1 && gi <= 99)) errors.imageIndex = 'imageIndex';
      var dk = parseInt(o.diskId, 10);
      if (!(dk >= 0 && dk <= 99)) errors.diskId = 'diskId';
    } else if (mode === 'custom') {
      if (o.computerName && !okComputer(str(o.computerName))) errors.computerName = 'computerNameOpt';
      if (o.imageBy === 'name') { if (!str(o.imageName).trim()) errors.imageName = 'imageName'; }
      else { var ci = parseInt(o.imageIndex, 10); if (!(ci >= 1 && ci <= 99)) errors.imageIndex = 'imageIndex'; }
      var dk2 = parseInt(o.diskId, 10);
      if (!(dk2 >= 0 && dk2 <= 99)) errors.diskId = 'diskId';
      if (o.diskLayout === 'existing') { var pi = parseInt(o.partitionId, 10); if (!(pi >= 1 && pi <= 128)) errors.partitionId = 'partitionId'; }
      if (o.adminPassword && !strongPassword(o.adminPassword)) errors.adminPassword = 'password';
      (o.accounts || []).forEach(function (a, i) {
        if (!a) return;
        if (!okUser(a.name)) errors['accounts.' + i + '.name'] = 'user';
        if (!str(a.password)) errors['accounts.' + i + '.password'] = 'passwordReq';
      });
      var alc = str(o.autoLogonCount);
      if (alc && !/^\d{1,3}$/.test(alc)) errors.autoLogonCount = 'count';
      ['driversPE', 'driversOffline'].forEach(function (k) {
        str(o[k]).split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (p) {
          if (!/^([A-Za-z]:\\|\\\\[^\\]+\\[^\\]+|%[A-Za-z]+%)/.test(p)) errors[k] = 'path';
        });
      });
    }
    checkCommon(o, errors);
    return errors;
  }
  function validateModel(model) {
    var e = validateMode(model.mode, model[model.mode]);
    var raw = parseRawBlock(model.raw);
    if (raw.error) e.raw = 'raw';
    return e;
  }
  // Original API: server form -> {field: English message}.
  function validate(o) {
    var codes = validateMode('server', o), out = {};
    Object.keys(codes).forEach(function (k) { out[k] = MESSAGES[codes[k]]; });
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Import an existing autounattend.xml
  // ---------------------------------------------------------------------------------------------
  function compOf(doc, pass, name) { return getComponent(doc, pass, name, null, false); }
  function readPassword(e, name) {
    if (!e) return '';
    var v = elementToValue(e);
    return v && v['@password'] !== undefined ? v['@password'] : '';
  }
  function detectMode(doc) {
    var shell = compOf(doc, 'oobeSystem', 'Microsoft-Windows-Shell-Setup');
    var cmds = shell ? children(path(shell, 'FirstLogonCommands') || el('x'), 'SynchronousCommand') : [];
    if (cmds.some(function (c) { return /TempDesk\\FirstLogon\.ps1/.test(pathText(c, 'CommandLine')); })) return 'server';
    if (compOf(doc, 'specialize', 'Microsoft-Windows-UnattendedJoin')) return 'guest';
    return 'custom';
  }
  function readCommon(doc, f) {
    var intl = compOf(doc, 'oobeSystem', 'Microsoft-Windows-International-Core') || compOf(doc, 'windowsPE', 'Microsoft-Windows-International-Core-WinPE');
    if (intl) {
      if (pathText(intl, 'UILanguage')) f.locale = pathText(intl, 'UILanguage');
      if (pathText(intl, 'InputLocale')) f.keyboard = pathText(intl, 'InputLocale');
    }
    var spec = compOf(doc, 'specialize', 'Microsoft-Windows-Shell-Setup');
    if (spec && pathText(spec, 'TimeZone')) f.timeZone = pathText(spec, 'TimeZone');
    if (spec) { var cn = pathText(spec, 'ComputerName'); f.computerName = cn === '*' ? '' : cn; }
    var setup = compOf(doc, 'windowsPE', 'Microsoft-Windows-Setup');
    if (setup) {
      var types = children(path(setup, 'DiskConfiguration/Disk/CreatePartitions') || el('x'), 'CreatePartition').map(function (c) { return pathText(c, 'Type'); });
      f.firmware = types.indexOf('EFI') >= 0 ? 'uefi' : 'bios';
      f._hasDisk = types.length > 0;
      var dk = pathText(setup, 'DiskConfiguration/Disk/DiskID') || pathText(setup, 'ImageInstall/OSImage/InstallTo/DiskID');
      if (dk) f.diskId = dk;
      var meta = path(setup, 'ImageInstall/OSImage/InstallFrom/MetaData');
      if (meta) {
        if (/NAME/i.test(pathText(meta, 'Key'))) { f.imageBy = 'name'; f.imageName = pathText(meta, 'Value'); }
        else { f.imageBy = 'index'; f.imageIndex = pathText(meta, 'Value'); }
      }
      f.partitionId = pathText(setup, 'ImageInstall/OSImage/InstallTo/PartitionID');
      f.productKey = pathText(setup, 'UserData/ProductKey/Key');
      f.organization = pathText(setup, 'UserData/Organization');
      f.owner = pathText(setup, 'UserData/FullName');
      f.arch = setup.a.processorArchitecture || 'amd64';
    }
    var pe = compOf(doc, 'windowsPE', 'Microsoft-Windows-International-Core-WinPE');
    if (pe) f.setupLanguage = pathText(pe, 'SetupUILanguage/UILanguage');
  }
  function listCommands(container, itemName, cmdName) {
    if (!container) return [];
    return children(container, itemName).map(function (c) {
      return { order: parseInt(pathText(c, 'Order'), 10) || 0, command: pathText(c, cmdName), description: pathText(c, 'Description') };
    }).sort(function (a, b) { return a.order - b.order; }).map(function (c) { return { command: c.command, description: c.description }; });
  }
  function extractForm(mode, doc, base) {
    var f = JSON.parse(JSON.stringify(base || {}));
    readCommon(doc, f);
    var oobe = compOf(doc, 'oobeSystem', 'Microsoft-Windows-Shell-Setup');
    if (mode === 'server') {
      f.adminPassword = readPassword(oobe && path(oobe, 'UserAccounts/AdministratorPassword')) || readPassword(oobe && path(oobe, 'AutoLogon/Password')) || f.adminPassword || '';
      delete f.diskId; delete f.imageBy; delete f.imageName; delete f.partitionId; delete f.organization; delete f.owner; delete f.arch; delete f.setupLanguage;
    } else if (mode === 'guest') {
      var join = compOf(doc, 'specialize', 'Microsoft-Windows-UnattendedJoin');
      f.domainName = pathText(join, 'Identification/JoinDomain');
      f.joinDomain = pathText(join, 'Identification/Credentials/Domain');
      if (f.joinDomain === f.domainName) f.joinDomain = '';
      f.joinUser = pathText(join, 'Identification/Credentials/Username');
      f.joinPassword = pathText(join, 'Identification/Credentials/Password');
      f.ou = pathText(join, 'Identification/MachineObjectOU');
      if (f.ou === 'OU=Computers,OU=TempDesk,' + domainDn(f.domainName)) f.ou = '';
      var dep = compOf(doc, 'specialize', 'Microsoft-Windows-Deployment');
      var cmds = listCommands(dep && path(dep, 'RunSynchronous'), 'RunSynchronousCommand', 'Path');
      var dnsCmd = cmds.filter(function (c) { return /Set-DnsClientServerAddress/.test(c.command); })[0];
      if (dnsCmd) {
        f.dnsMode = 'static';
        f.dnsServer = (dnsCmd.command.match(/ServerAddresses\s+(.+?)"?$/) || ['', ''])[1].replace(/'/g, '').split(',').filter(Boolean).join(', ');
      } else { f.dnsMode = 'dhcp'; }
      var acct = oobe && path(oobe, 'UserAccounts/LocalAccounts/LocalAccount');
      f.adminUser = acct ? pathText(acct, 'Name') : '';
      f.adminPassword = acct ? readPassword(path(acct, 'Password')) : '';
      delete f.imageBy; delete f.imageName; delete f.partitionId; delete f.organization; delete f.owner; delete f.setupLanguage;
    } else {
      var setup = compOf(doc, 'windowsPE', 'Microsoft-Windows-Setup');
      f.diskLayout = f._hasDisk ? f.firmware : 'existing';
      if (f.diskLayout !== 'existing') f.partitionId = f.partitionId || '';
      if (!setup) f.diskLayout = 'uefi';
      var spec = compOf(doc, 'specialize', 'Microsoft-Windows-Shell-Setup');
      if (spec) {
        if (pathText(spec, 'RegisteredOrganization')) f.organization = pathText(spec, 'RegisteredOrganization');
        if (pathText(spec, 'RegisteredOwner')) f.owner = pathText(spec, 'RegisteredOwner');
      }
      var dep2 = compOf(doc, 'specialize', 'Microsoft-Windows-Deployment');
      var rs = listCommands(dep2 && path(dep2, 'RunSynchronous'), 'RunSynchronousCommand', 'Path');
      f.edgeFirstRunOff = rs.some(function (c) { return c.command === EDGE_CMD; });

      var ls = compOf(doc, 'specialize', 'Microsoft-Windows-TerminalServices-LocalSessionManager');
      f.rdp = !!(ls && pathText(ls, 'fDenyTSConnections').toLowerCase() === 'false');
      f.adminPassword = oobe ? readPassword(path(oobe, 'UserAccounts/AdministratorPassword')) : '';
      f.accounts = oobe ? children(path(oobe, 'UserAccounts/LocalAccounts') || el('x'), 'LocalAccount').map(function (a) {
        return { name: pathText(a, 'Name'), displayName: pathText(a, 'DisplayName') === pathText(a, 'Name') ? '' : pathText(a, 'DisplayName'), group: pathText(a, 'Group') === 'Users' ? 'Users' : 'Administrators', password: readPassword(path(a, 'Password')) };
      }) : [];
      f.accounts.forEach(function (a) { if (!a.displayName) a.displayName = ''; });
      var al = oobe && path(oobe, 'AutoLogon');
      f.autoLogonCount = al && pathText(al, 'Enabled').toLowerCase() === 'true' ? pathText(al, 'LogonCount') : '0';
      OOBE_HIDE.forEach(function (k) { f['oobe' + k] = !!(oobe && pathText(oobe, 'OOBE/' + k).toLowerCase() === 'true'); });
      f.protectYourPC = oobe ? pathText(oobe, 'OOBE/ProtectYourPC') : '';
      var fl = listCommands(oobe && path(oobe, 'FirstLogonCommands'), 'SynchronousCommand', 'CommandLine');
      var featCmd = fl.filter(function (c) { return c.description === 'Enable Windows features (TempDesk builder)'; })[0];
      f.features = '';
      if (featCmd) {
        var m1 = featCmd.command.match(/Install-WindowsFeature -Name (\S+)/);
        if (m1) { f.target = 'server'; f.features = m1[1].split(',').join(', '); }
        else { f.target = 'client'; f.features = (featCmd.command.match(/featurename:(\S+)/g) || []).map(function (x) { return x.slice(12); }).join(', '); }
      }

      var dpe = compOf(doc, 'windowsPE', 'Microsoft-Windows-PnpCustomizationsWinPE');
      f.driversPE = dpe ? children(path(dpe, 'DriverPaths') || el('x'), 'PathAndCredentials').map(function (p) { return pathText(p, 'Path'); }).join('\n') : '';
      var doff = compOf(doc, 'offlineServicing', 'Microsoft-Windows-PnpCustomizationsNonWinPE');
      f.driversOffline = doff ? children(path(doff, 'DriverPaths') || el('x'), 'PathAndCredentials').map(function (p) { return pathText(p, 'Path'); }).join('\n') : '';
      delete f.firmware;
    }
    delete f._hasDisk;
    return f;
  }
  // importXml(xmlText, {defaults, knownComponent(name) -> bool})
  // -> { mode, form, all, raw, unknown: [paths kept in the raw block], notes: [codes] }
  function importXml(xml, opts) {
    opts = opts || {};
    var doc = parseXml(xml);
    if (doc.n !== 'unattend') throw new Error('The root element is <' + doc.n + '>, not <unattend>.');
    var mode = opts.mode || detectMode(doc), notes = [];
    var form = extractForm(mode, doc, (opts.defaults || {})[mode]);
    var base = modeTree(mode, form);
    var commands = { runSync: [], runAsync: [], firstLogon: [], logon: [] };
    var extras = readExtras(doc);
    Object.keys(COMMAND_LISTS).forEach(function (k) {
      var def = COMMAND_LISTS[k];
      var inC = compOf(doc, def.pass, def.component), genC = compOf(base, def.pass, def.component);
      var inItems = inC ? children(path(inC, def.list) || el('x'), def.item) : [];
      var genCmds = genC ? children(path(genC, def.list) || el('x'), def.item).map(function (x) { return pathText(x, def.cmd); }) : [];
      inItems.sort(function (a, b) { return (parseInt(pathText(a, 'Order'), 10) || 0) - (parseInt(pathText(b, 'Order'), 10) || 0); }).forEach(function (x) {
        var c = pathText(x, def.cmd), at = genCmds.indexOf(c);
        if (at >= 0) { genCmds.splice(at, 1); return; }
        if (pathText(x, 'Description').indexOf(EXTRA_TAG) === 0 && extras) {
          var probe = newDoc(); applyExtras(probe, extras, 'amd64');
          var pc = compOf(probe, def.pass, def.component);
          if (pc && children(path(pc, def.list) || el('x'), def.item).some(function (y) { return pathText(y, def.cmd) === c; })) return;
        }
        commands[k].push(readCommandItem(def, x));
      });
    });
    var disks = null, setupIn = compOf(doc, 'windowsPE', 'Microsoft-Windows-Setup'), setupGen = compOf(base, 'windowsPE', 'Microsoft-Windows-Setup');
    if (setupIn) {
      var a1 = path(setupIn, 'DiskConfiguration'), b1 = setupGen && path(setupGen, 'DiskConfiguration');
      var a2 = path(setupIn, 'ImageInstall/OSImage/InstallTo'), b2 = setupGen && path(setupGen, 'ImageInstall/OSImage/InstallTo');
      var same1 = (!a1 && !b1) || (a1 && b1 && deepEqualEl(a1, b1));
      var same2 = (!a2 && !b2) || (a2 && b2 && deepEqualEl(a2, b2));
      if (!same1 || !same2) {
        disks = readDiskLayout(setupIn);
        var regen = newDoc(); regen.c = []; applyDiskLayout(regen, disks, 'amd64');
        var rs = compOf(regen, 'windowsPE', 'Microsoft-Windows-Setup');
        if (a1 && !deepEqualEl(path(rs, 'DiskConfiguration') || el('x'), a1)) notes.push('diskPartial');
      }
    }
    var gen = buildModelTree({ mode: mode, server: mode === 'server' ? form : {}, guest: mode === 'guest' ? form : {}, custom: mode === 'custom' ? form : {}, commands: commands, disks: disks, extras: extras || undefined });
    var all = {}, rawMap = {}, unknown = [];
    doc.c.forEach(function (s) {
      if (s.n !== 'settings') return;
      s.c.forEach(function (c) {
        if (c.n !== 'component') return;
        var key = s.a.pass + '|' + c.a.name;
        var g = compOf(gen, s.a.pass, c.a.name);
        var left = g ? diffElement(c, g) : (c.c.length ? elementToValue(c) : {});
        if (left === undefined) return;
        if (typeof left !== 'object') left = {};
        if (opts.knownComponent && opts.knownComponent(c.a.name, s.a.pass)) all[key] = left;
        else {
          rawMap[key] = left;
          Object.keys(left).forEach(function (k) { unknown.push(s.a.pass + ' / ' + c.a.name + ' / ' + k); });
          if (!Object.keys(left).length) unknown.push(s.a.pass + ' / ' + c.a.name);
        }
      });
    });
    if (mode === 'server') notes.push('serverJsonSeparate');
    return { mode: mode, form: form, commands: commands, disks: disks, extras: extras || extraDefaults(), all: all, raw: Object.keys(rawMap).length ? valuesToRawXml(rawMap, form.arch) : '', unknown: unknown, notes: notes };
  }


  // ---------------------------------------------------------------------------------------------
  // Studio helpers: two-way XML sync, compare, simulate, quick fixes, snippets
  // ---------------------------------------------------------------------------------------------
  // Applies edited XML back to the model. Keeps what XML cannot carry: the server firstboot.json
  // fields, the deployment map and turned-off commands. Throws on malformed XML (nothing applied).
  function syncFromXml(model, xml, opts) {
    opts = opts || {};
    var mode = model.mode;
    var defaults = {}; defaults[mode] = clone(model[mode]);
    var r = importXml(xml, { mode: mode, defaults: defaults, knownComponent: opts.knownComponent });
    var next = clone(model);
    next[mode] = Object.assign(clone(model[mode]), r.form);
    next.commands = r.commands;
    Object.keys(model.commands || {}).forEach(function (k) {
      (model.commands[k] || []).forEach(function (it, i) { if (it && it.disabled) { next.commands[k] = next.commands[k] || []; next.commands[k].splice(Math.min(i, next.commands[k].length), 0, clone(it)); } });
    });
    next.disks = r.disks; next.extras = r.extras; next.all = r.all; next.raw = r.raw;
    return { model: next, unknown: r.unknown, notes: r.notes };
  }

  // Reorders the elements of `xml` to follow the order used in `reference` (same pass, component and
  // element names), so XML written by another generator syncs back without spurious differences.
  function alignXml(xml, reference) {
    var a = parseXml(xml), ref = parseXml(reference);
    function keyOf(e) { return e.n + '|' + (e.a.pass || e.a.name || e.a['wcm:keyValue'] || ''); }
    function align(e, r) {
      if (!r) return;
      var order = {};
      r.c.forEach(function (c, i) { var k = keyOf(c); if (!(k in order)) order[k] = i; if (!(c.n in order)) order[c.n] = i; });
      var idx = e.c.map(function (c, i) { var k = keyOf(c); return { c: c, i: i, o: k in order ? order[k] : c.n in order ? order[c.n] : 1e6 + i }; });
      idx.sort(function (x, y) { return x.o - y.o || x.i - y.i; });
      e.c = idx.map(function (x) { return x.c; });
      var used = {};
      e.c.forEach(function (c) {
        var k = keyOf(c), n = used[k] = (used[k] || 0) + 1;
        var matches = r.c.filter(function (x) { return keyOf(x) === k; });
        align(c, matches[n - 1] || null);
      });
    }
    align(a, ref);
    var comment = /^<\?xml[^>]*>\r?\n(<!--[\s\S]*?-->)/.exec(String(reference));
    var out = serialize(a);
    return comment ? out.replace(/^(<\?xml[^>]*>\r?\n)/, '$1' + comment[1] + '\r\n') : out;
  }

  // Flattens XML into setting paths: pass/Component/Path, list items named by key (Order, keyValue, Name, DiskID...).
  var ITEM_KEYS = ['Order', 'Name', 'DiskID', 'PartitionID', 'Key', 'Identifier', 'Domain', 'Group'];
  function flattenXml(xml) {
    var root = typeof xml === 'string' ? parseXml(xml) : xml, out = [];
    function walk(e, p) {
      if (isPasswordContainer(e)) { out.push({ path: p, value: '(password ' + pathText(e, 'Value').length + ')' , secret: true, raw: pathText(e, 'Value') }); return; }
      if (!e.c.length) { out.push({ path: p, value: e.t.trim() }); return; }
      var counts = {};
      e.c.forEach(function (c) { counts[c.n] = (counts[c.n] || 0) + 1; });
      var seen = {};
      e.c.forEach(function (c) {
        var name = c.n;
        if (c.a['wcm:action'] === 'add' || counts[c.n] > 1) {
          var key = c.a['wcm:keyValue'];
          if (key === undefined) for (var i = 0; i < ITEM_KEYS.length && key === undefined; i++) { var k = child(c, ITEM_KEYS[i]); if (k && !k.c.length) key = k.t.trim(); }
          if (key === undefined) { seen[c.n] = (seen[c.n] || 0) + 1; key = '#' + seen[c.n]; }
          name += '[' + key + ']';
        }
        walk(c, p + '/' + name);
      });
    }
    root.c.forEach(function (s) {
      if (s.n !== 'settings') return;
      s.c.forEach(function (c) { if (c.n === 'component') walk(c, s.a.pass + '/' + c.a.name); });
    });
    return out;
  }
  // Setting-level comparison of two answer files. -> { added, removed, changed, same }
  function compareXml(a, b) {
    var fa = flattenXml(a), fb = flattenXml(b), ma = {}, mb = {};
    fa.forEach(function (x) { ma[x.path] = x; });
    fb.forEach(function (x) { mb[x.path] = x; });
    var out = { added: [], removed: [], changed: [], same: 0 };
    fa.forEach(function (x) {
      var y = mb[x.path];
      if (!y) out.removed.push({ path: x.path, value: x.value });
      else if ((x.secret ? x.raw : x.value) !== (y.secret ? y.raw : y.value)) out.changed.push({ path: x.path, from: x.value, to: y.secret && x.secret ? '(password changed)' : y.value });
      else out.same++;
    });
    fb.forEach(function (y) { if (!ma[y.path]) out.added.push({ path: y.path, value: y.value }); });
    return out;
  }

  // Plays the unattended setup pass by pass. -> [{ pass, when, applies: [{ comp, settings: [path=value] }], commands: [{ text, reboot }], reboot, skipped }]
  var PASS_WHEN = {
    windowsPE: 'pe', offlineServicing: 'offline', generalize: 'sysprep', specialize: 'firstBoot', auditSystem: 'audit', auditUser: 'audit', oobeSystem: 'oobe'
  };
  function simulate(xml) {
    var root = typeof xml === 'string' ? parseXml(xml) : xml;
    var steps = [];
    var audit = false;
    root.c.forEach(function (s) {
      if (s.n !== 'settings') return;
      s.c.forEach(function (c) { var m = pathText(c, 'Reseal/Mode'); if (/audit/i.test(m)) audit = true; });
    });
    PASS_ORDER.forEach(function (pass) {
      var set = getSettings(root, pass, false);
      var step = { pass: pass, when: PASS_WHEN[pass], applies: [], commands: [], reboot: false, skipped: false };
      if (pass === 'generalize') step.skipped = true;
      if ((pass === 'auditSystem' || pass === 'auditUser') && !audit) step.skipped = true;
      if (set) set.c.forEach(function (c) {
        var flat = flattenXml({ n: 'unattend', c: [{ n: 'settings', a: { pass: pass }, c: [c], t: '' }], a: {}, t: '' });
        step.applies.push({ comp: c.a.name, settings: flat.map(function (x) { return x.path.split('/').slice(2).join('/') + ' = ' + x.value; }) });
        Object.keys(COMMAND_LISTS).forEach(function (k) {
          var def = COMMAND_LISTS[k];
          if (def.pass !== pass || def.component !== c.a.name) return;
          var list = child(c, def.list);
          if (!list) return;
          children(list, def.item).sort(function (x, y) { return (parseInt(pathText(x, 'Order'), 10) || 0) - (parseInt(pathText(y, 'Order'), 10) || 0); }).forEach(function (it) {
            var wr = pathText(it, 'WillReboot');
            step.commands.push({ list: k, text: pathText(it, 'Description') || pathText(it, def.cmd), reboot: wr === 'Always' ? 'always' : wr === 'OnRequest' ? 'onRequest' : '' });
          });
        });
      });
      // Windows Setup restarts after windowsPE and after specialize.
      step.reboot = pass === 'windowsPE' || pass === 'specialize';
      steps.push(step);
    });
    return steps;
  }

  // Snippets: common blocks inserted into model.all (catalog settings) or model.commands.
  var SNIPPETS = {
    rdp: { all: { 'specialize|Microsoft-Windows-TerminalServices-LocalSessionManager': { fDenyTSConnections: 'false' }, 'specialize|Networking-MPSSVC-Svc': { FirewallGroups: { FirewallGroup: [{ '@keyValue': 'RemoteDesktop', Active: 'true', Group: 'Remote Desktop', Profile: 'all' }] } }, 'specialize|Microsoft-Windows-TerminalServices-RDP-WinStationExtensions': { UserAuthentication: '1' } } },
    joinDomain: { all: { 'specialize|Microsoft-Windows-UnattendedJoin': { Identification: { Credentials: { Domain: 'lab.example.org', Password: '', Username: 'td-join' }, JoinDomain: 'lab.example.org', MachineObjectOU: 'OU=Computers,OU=TempDesk,DC=lab,DC=example,DC=org' } } } },
    skipOobe: { all: { 'oobeSystem|Microsoft-Windows-Shell-Setup': { OOBE: { HideEULAPage: 'true', HideOEMRegistrationScreen: 'true', HideOnlineAccountScreens: 'true', HideWirelessSetupInOOBE: 'true', HideLocalAccountScreen: 'true', ProtectYourPC: '3' } } } },
    uacOff: { all: { 'offlineServicing|Microsoft-Windows-LUA-Settings': { EnableLUA: 'false' } } },
    staticIp: { all: { 'specialize|Microsoft-Windows-TCPIP': { Interfaces: { Interface: [{ Identifier: 'Ethernet', Ipv4Settings: { DhcpEnabled: 'false' }, UnicastIpAddresses: { IpAddress: [{ '@keyValue': '1', '#text': '192.168.10.50/24' }] }, Routes: { Route: [{ Identifier: '0', Prefix: '0.0.0.0/0', NextHopAddress: '192.168.10.1' }] } }] } }, 'specialize|Microsoft-Windows-DNS-Client': { Interfaces: { Interface: [{ Identifier: 'Ethernet', DNSServerSearchOrder: { IpAddress: [{ '@keyValue': '1', '#text': '192.168.10.10' }] } }] } } } },
    noServerManager: { all: { 'specialize|Microsoft-Windows-ServerManager-SvrMgrNc': { DoNotOpenServerManagerAtLogon: 'true' } } },
    timeZoneUtc: { all: { 'specialize|Microsoft-Windows-Shell-Setup': { TimeZone: 'UTC' } } },
    psRemoting: { commands: { firstLogon: [{ command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Enable-PSRemoting -Force -SkipNetworkProfileCheck"', description: 'Turn on PowerShell remoting', willReboot: 'Never', disabled: false }] } }
  };
  function deepMergeValue(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) return a.concat(clone(b));
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      var out = clone(a); Object.keys(b).forEach(function (k) { out[k] = k in out ? deepMergeValue(out[k], b[k]) : clone(b[k]); }); return out;
    }
    return clone(b);
  }
  function applySnippet(model, id) {
    var sn = SNIPPETS[id];
    if (!sn) throw new Error('Unknown snippet ' + id);
    var m = clone(model);
    Object.keys(sn.all || {}).forEach(function (k) { m.all[k] = deepMergeValue(m.all[k] || {}, sn.all[k]); });
    Object.keys(sn.commands || {}).forEach(function (k) { m.commands[k] = (m.commands[k] || []).concat(clone(sn.commands[k])); });
    return m;
  }
  // ---------------------------------------------------------------------------------------------
  // Passwords: generator and strength meter
  // ---------------------------------------------------------------------------------------------
  var PW_SETS = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789', '!#$%*+-=?@^_~'];
  function randomInt(max, rand) {
    if (rand) return Math.floor(rand() * max);
    var c = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);
    var buf = new Uint32Array(1), limit = Math.floor(0x100000000 / max) * max;
    do { c.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % max;
  }
  function generatePassword(length, rand) {
    length = Math.max(12, Math.min(128, parseInt(length, 10) || 20));
    var all = PW_SETS.join(''), chars = PW_SETS.map(function (set) { return set[randomInt(set.length, rand)]; });
    while (chars.length < length) chars.push(all[randomInt(all.length, rand)]);
    for (var i = chars.length - 1; i > 0; i--) { var j = randomInt(i + 1, rand); var t = chars[i]; chars[i] = chars[j]; chars[j] = t; }
    return chars.join('');
  }
  var COMMON = ['password', 'passw0rd', 'p@ssw0rd', 'admin', 'administrator', 'welcome', 'qwerty', 'letmein', 'tempdesk', 'windows', 'server', 'summer', 'winter', 'spring', 'autumn', '123456', 'abc123', 'iloveyou', 'dragon', 'monkey'];
  // -> { score 0..4, bits, code: 'empty'|'veryWeak'|'weak'|'fair'|'strong'|'veryStrong', meetsPolicy }
  function passwordStrength(p) {
    p = str(p);
    if (!p) return { score: 0, bits: 0, code: 'empty', meetsPolicy: false };
    var pool = 0;
    if (/[a-z]/.test(p)) pool += 26;
    if (/[A-Z]/.test(p)) pool += 26;
    if (/\d/.test(p)) pool += 10;
    if (/[^A-Za-z0-9]/.test(p)) pool += 33;
    var uniq = {}; for (var i = 0; i < p.length; i++) uniq[p[i]] = 1;
    var effLen = Math.min(p.length, Object.keys(uniq).length * 2);
    var bits = effLen * Math.log2(Math.max(pool, 2));
    var low = p.toLowerCase();
    COMMON.forEach(function (w) { if (low.indexOf(w) >= 0) bits -= w.length * 4; });
    if (/(.)\1\1/.test(p)) bits -= 10;
    if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|qwer|asdf)/i.test(p)) bits -= 12;
    if (/(19|20)\d\d/.test(p)) bits -= 6;
    bits = Math.max(0, Math.round(bits));
    var score = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
    return { score: score, bits: bits, code: ['veryWeak', 'weak', 'fair', 'strong', 'veryStrong'][score], meetsPolicy: strongPassword(p) };
  }

  // ---------------------------------------------------------------------------------------------
  // Model helpers: defaults, secrets, validation of imported JSON
  // ---------------------------------------------------------------------------------------------
  var SECRET_FIELDS = { server: ['adminPassword', 'dsrmPassword'], guest: ['adminPassword', 'joinPassword'], custom: ['adminPassword'] };
  function defaultModel() {
    return {
      schema: 'tempdesk-answer-model', version: 1, mode: 'server',
      server: { imageIndex: '1', computerName: 'TD-DC01', domainName: 'lab.example.org', netbiosName: 'LAB', functionalLevel: '', ipAddress: '192.168.10.10', prefixLength: '24', gateway: '192.168.10.1', dnsServers: '127.0.0.1', adminPassword: '', dsrmPassword: '', productKey: '', firmware: 'uefi', locale: 'en-US', keyboard: 'en-US', timeZone: 'Eastern Standard Time', portalsMode: 'none', agentTls: false },
      guest: { imageIndex: '6', diskId: '0', firmware: 'uefi', arch: 'amd64', locale: 'en-US', keyboard: 'en-US', timeZone: 'Eastern Standard Time', computerName: '', adminUser: 'tdadmin', adminPassword: '', domainName: 'lab.example.org', joinDomain: '', joinUser: 'td-join', joinPassword: '', ou: '', dnsMode: 'static', dnsServer: '192.168.10.10', productKey: '' },
      custom: { target: 'client', arch: 'amd64', setupLanguage: 'en-US', diskLayout: 'uefi', diskId: '0', partitionId: '3', imageBy: 'index', imageIndex: '1', imageName: '', productKey: '', computerName: '', organization: '', owner: '', timeZone: 'Eastern Standard Time', rdp: false, edgeFirstRunOff: true, locale: 'en-US', keyboard: 'en-US', adminPassword: '', accounts: [{ name: 'admin', displayName: '', group: 'Administrators', password: '' }], autoLogonCount: '0', oobeHideEULAPage: true, oobeHideOEMRegistrationScreen: true, oobeHideOnlineAccountScreens: true, oobeHideWirelessSetupInOOBE: false, oobeHideLocalAccountScreen: true, protectYourPC: '3', features: '', driversPE: '', driversOffline: '' },
      commands: { runSync: [], runAsync: [], firstLogon: [], logon: [] },
      extras: extraDefaults(),
      disks: null,
      deploy: { appHost: { name: '', ip: '' }, portalsHost: { name: '', ip: '', guestPort: '8081', adminPort: '8082' }, network: { cidr: '192.168.10.0/24' } },
      all: {}, raw: ''
    };
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function stripSecrets(model) {
    var m = clone(model);
    Object.keys(SECRET_FIELDS).forEach(function (mode) {
      if (!m[mode]) return;
      SECRET_FIELDS[mode].forEach(function (k) { if (k in m[mode]) m[mode][k] = ''; });
      if (Array.isArray(m[mode].accounts)) m[mode].accounts.forEach(function (a) { a.password = ''; });
    });
    Object.keys(m.commands || {}).forEach(function (k) { (m.commands[k] || []).forEach(function (it) { if (it.credentials) it.credentials.password = ''; }); });
    (function scrub(v) {
      if (!v || typeof v !== 'object') return;
      Object.keys(v).forEach(function (k) {
        if (k === '@password') v[k] = '';
        else scrub(v[k]);
      });
    })(m.all);
    return m;
  }
  // Checks the shape of a model before anything is applied. Returns { ok, model, error }.
  var FORBIDDEN = ['__proto__', 'prototype', 'constructor'];
  function checkPlain(v, depth) {
    if (depth > 12) return false;
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number') return typeof v !== 'string' || v.length <= 20000;
    if (Array.isArray(v)) return v.length <= 500 && v.every(function (x) { return checkPlain(x, depth + 1); });
    if (typeof v === 'object') return Object.keys(v).every(function (k) { return FORBIDDEN.indexOf(k) < 0 && k.length <= 200 && checkPlain(v[k], depth + 1); });
    return false;
  }
  function normalizeModel(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'model.notObject' };
    if (input.schema !== 'tempdesk-answer-model') return { ok: false, error: 'model.schema' };
    if (input.version !== 1) return { ok: false, error: 'model.version' };
    if (!checkPlain(input, 0)) return { ok: false, error: 'model.shape' };
    if (MODES.indexOf(input.mode) < 0) return { ok: false, error: 'model.mode' };
    var d = defaultModel(), out = clone(d);
    out.mode = input.mode;
    for (var i = 0; i < MODES.length; i++) {
      var m = MODES[i], src = input[m];
      if (src === undefined) continue;
      if (!src || typeof src !== 'object' || Array.isArray(src)) return { ok: false, error: 'model.shape' };
      for (var k in src) {
        if (!(k in d[m])) continue;
        var want = d[m][k], got = src[k];
        if (Array.isArray(want)) {
          if (!Array.isArray(got) || !got.every(function (r) { return r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).every(function (q) { return typeof r[q] === 'string'; }); })) return { ok: false, error: 'model.shape' };
          out[m][k] = clone(got);
        } else if (typeof want === 'boolean') {
          if (typeof got !== 'boolean') return { ok: false, error: 'model.shape' };
          out[m][k] = got;
        } else {
          if (typeof got !== 'string' && typeof got !== 'number') return { ok: false, error: 'model.shape' };
          out[m][k] = String(got);
        }
      }
    }
    if (input.all !== undefined) {
      if (!input.all || typeof input.all !== 'object' || Array.isArray(input.all)) return { ok: false, error: 'model.shape' };
      for (var key in input.all) {
        var parts = key.split('|');
        if (parts.length !== 2 || PASS_ORDER.indexOf(parts[0]) < 0 || !/^[A-Za-z0-9.-]+$/.test(parts[1])) return { ok: false, error: 'model.allKey' };
        if (!input.all[key] || typeof input.all[key] !== 'object') return { ok: false, error: 'model.shape' };
      }
      out.all = clone(input.all);
    }
    if (input.commands !== undefined) {
      if (!input.commands || typeof input.commands !== 'object' || Array.isArray(input.commands)) return { ok: false, error: 'model.shape' };
      for (var ck in input.commands) {
        if (!COMMAND_LISTS[ck] || !Array.isArray(input.commands[ck])) return { ok: false, error: 'model.commands' };
        for (var ci = 0; ci < input.commands[ck].length; ci++) {
          var it = input.commands[ck][ci];
          if (!it || typeof it !== 'object' || typeof it.command !== 'string') return { ok: false, error: 'model.commands' };
          if (it.willReboot !== undefined && ['Never', 'Always', 'OnRequest'].indexOf(it.willReboot) < 0) return { ok: false, error: 'model.commands' };
        }
        out.commands[ck] = clone(input.commands[ck]);
      }
    }
    if (input.extras !== undefined) {
      if (!input.extras || typeof input.extras !== 'object' || Array.isArray(input.extras)) return { ok: false, error: 'model.shape' };
      var exd = extraDefaults();
      for (var ek in input.extras) {
        if (!(ek in exd)) continue;
        if (typeof exd[ek] === 'boolean' ? typeof input.extras[ek] !== 'boolean' : typeof input.extras[ek] !== 'string') return { ok: false, error: 'model.extras' };
        out.extras[ek] = input.extras[ek];
      }
    }
    if (input.disks !== undefined && input.disks !== null) {
      var dl = input.disks;
      if (!dl || typeof dl !== 'object' || !Array.isArray(dl.disks) || dl.disks.length > 16) return { ok: false, error: 'model.disks' };
      for (var di = 0; di < dl.disks.length; di++) {
        var dd = dl.disks[di];
        if (!dd || !Array.isArray(dd.partitions) || dd.partitions.length > 128) return { ok: false, error: 'model.disks' };
        if (dd.partitions.some(function (p) { return !p || PART_TYPES.indexOf(p.type) < 0; })) return { ok: false, error: 'model.disks' };
      }
      out.disks = clone(dl);
    }
    if (input.deploy !== undefined) {
      if (!input.deploy || typeof input.deploy !== 'object' || Array.isArray(input.deploy)) return { ok: false, error: 'model.shape' };
      ['appHost', 'portalsHost', 'network'].forEach(function (k) {
        if (input.deploy[k] && typeof input.deploy[k] === 'object') Object.keys(out.deploy[k]).forEach(function (f) { if (input.deploy[k][f] !== undefined) out.deploy[k][f] = String(input.deploy[k][f]); });
      });
    }
    if (input.raw !== undefined) {
      if (typeof input.raw !== 'string') return { ok: false, error: 'model.shape' };
      if (parseRawBlock(input.raw).error) return { ok: false, error: 'model.raw' };
      out.raw = input.raw;
    }
    return { ok: true, model: out };
  }
  // Presets bundle: { schema: 'tempdesk-presets', version: 1, presets: { name: model } }
  function normalizePresetBundle(input) {
    if (!input || typeof input !== 'object' || input.schema !== 'tempdesk-presets' || input.version !== 1 || !input.presets || typeof input.presets !== 'object' || Array.isArray(input.presets)) return { ok: false, error: 'presets.schema' };
    var out = {}, names = Object.keys(input.presets);
    if (names.length > 200) return { ok: false, error: 'presets.tooMany' };
    for (var i = 0; i < names.length; i++) {
      var nm = names[i];
      if (!nm.trim() || nm.length > 80 || FORBIDDEN.indexOf(nm) >= 0) return { ok: false, error: 'presets.name', index: i + 1 };
      var r = normalizeModel(input.presets[nm]);
      if (!r.ok) return { ok: false, error: r.error, index: i + 1 };
      out[nm] = r.model;
    }
    return { ok: true, presets: out };
  }

  // ---------------------------------------------------------------------------------------------
  // Line diff (LCS) and XML syntax highlighting for the preview
  // ---------------------------------------------------------------------------------------------
  function lineDiff(a, b) {
    var x = str(a).replace(/\r\n/g, '\n').split('\n'), y = str(b).replace(/\r\n/g, '\n').split('\n');
    var n = x.length, m = y.length;
    if (n * m > 4e6) return x.map(function (l) { return { op: '-', line: l }; }).concat(y.map(function (l) { return { op: '+', line: l }; }));
    var dp = [];
    for (var i = 0; i <= n; i++) { dp.push(new Uint32Array(m + 1)); }
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = []; i = 0; j = 0;
    while (i < n && j < m) {
      if (x[i] === y[j]) { out.push({ op: ' ', line: x[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ op: '-', line: x[i++] }); }
      else out.push({ op: '+', line: y[j++] });
    }
    while (i < n) out.push({ op: '-', line: x[i++] });
    while (j < m) out.push({ op: '+', line: y[j++] });
    return out;
  }
  function esc(s) { return str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function highlightXml(xml) {
    var s = str(xml).replace(/\r\n/g, '\n'), out = '', re = /(<!--[\s\S]*?-->)|(<\?[\s\S]*?\?>)|(<\/?)([A-Za-z_:][-\w:.]*)([^>]*?)(\/?>)|([^<]+)/g, m;
    while ((m = re.exec(s))) {
      if (m[1]) out += '<span class="x-com">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="x-pi">' + esc(m[2]) + '</span>';
      else if (m[4]) {
        var attrs = esc(m[5]).replace(/([\w:.-]+)(=)(&quot;|")([^"]*?)(")/g, '<span class="x-attr">$1</span>$2<span class="x-val">"$4"</span>');
        attrs = esc(m[5]).replace(/([\w:.-]+)=("[^"]*")/g, function (_, k, v) { return '<span class="x-attr">' + k + '</span>=<span class="x-val">' + v + '</span>'; });
        out += '<span class="x-tag">' + esc(m[3]) + m[4] + '</span>' + attrs + '<span class="x-tag">' + esc(m[6]) + '</span>';
      } else if (m[7]) out += '<span class="x-text">' + esc(m[7]) + '</span>';
      else { out += esc(s[re.lastIndex]); re.lastIndex++; }
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------
  // Reference data
  // ---------------------------------------------------------------------------------------------
  var TIME_ZONES = [
    ['Dateline Standard Time', '-12:00'], ['UTC-11', '-11:00'], ['Aleutian Standard Time', '-10:00'], ['Hawaiian Standard Time', '-10:00'],
    ['Marquesas Standard Time', '-09:30'], ['Alaskan Standard Time', '-09:00'], ['UTC-09', '-09:00'], ['Pacific Standard Time (Mexico)', '-08:00'],
    ['UTC-08', '-08:00'], ['Pacific Standard Time', '-08:00'], ['US Mountain Standard Time', '-07:00'], ['Mountain Standard Time (Mexico)', '-07:00'],
    ['Mountain Standard Time', '-07:00'], ['Yukon Standard Time', '-07:00'], ['Central America Standard Time', '-06:00'], ['Central Standard Time', '-06:00'],
    ['Easter Island Standard Time', '-06:00'], ['Central Standard Time (Mexico)', '-06:00'], ['Canada Central Standard Time', '-06:00'],
    ['SA Pacific Standard Time', '-05:00'], ['Eastern Standard Time (Mexico)', '-05:00'], ['Eastern Standard Time', '-05:00'], ['Haiti Standard Time', '-05:00'],
    ['Cuba Standard Time', '-05:00'], ['US Eastern Standard Time', '-05:00'], ['Turks And Caicos Standard Time', '-05:00'], ['Paraguay Standard Time', '-04:00'],
    ['Atlantic Standard Time', '-04:00'], ['Venezuela Standard Time', '-04:00'], ['Central Brazilian Standard Time', '-04:00'], ['SA Western Standard Time', '-04:00'],
    ['Pacific SA Standard Time', '-04:00'], ['Newfoundland Standard Time', '-03:30'], ['Tocantins Standard Time', '-03:00'], ['E. South America Standard Time', '-03:00'],
    ['SA Eastern Standard Time', '-03:00'], ['Argentina Standard Time', '-03:00'], ['Greenland Standard Time', '-03:00'], ['Montevideo Standard Time', '-03:00'],
    ['Magallanes Standard Time', '-03:00'], ['Saint Pierre Standard Time', '-03:00'], ['Bahia Standard Time', '-03:00'], ['UTC-02', '-02:00'],
    ['Mid-Atlantic Standard Time', '-02:00'], ['Azores Standard Time', '-01:00'], ['Cape Verde Standard Time', '-01:00'], ['UTC', '+00:00'],
    ['GMT Standard Time', '+00:00'], ['Greenwich Standard Time', '+00:00'], ['Sao Tome Standard Time', '+00:00'], ['Morocco Standard Time', '+01:00'],
    ['W. Europe Standard Time', '+01:00'], ['Central Europe Standard Time', '+01:00'], ['Romance Standard Time', '+01:00'], ['Central European Standard Time', '+01:00'],
    ['W. Central Africa Standard Time', '+01:00'], ['Jordan Standard Time', '+03:00'], ['GTB Standard Time', '+02:00'], ['Middle East Standard Time', '+02:00'],
    ['Egypt Standard Time', '+02:00'], ['E. Europe Standard Time', '+02:00'], ['Syria Standard Time', '+03:00'], ['West Bank Standard Time', '+02:00'],
    ['South Africa Standard Time', '+02:00'], ['FLE Standard Time', '+02:00'], ['Israel Standard Time', '+02:00'], ['South Sudan Standard Time', '+02:00'],
    ['Kaliningrad Standard Time', '+02:00'], ['Sudan Standard Time', '+02:00'], ['Libya Standard Time', '+02:00'], ['Namibia Standard Time', '+02:00'],
    ['Arabic Standard Time', '+03:00'], ['Turkey Standard Time', '+03:00'], ['Arab Standard Time', '+03:00'], ['Belarus Standard Time', '+03:00'],
    ['Russian Standard Time', '+03:00'], ['E. Africa Standard Time', '+03:00'], ['Volgograd Standard Time', '+03:00'], ['Iran Standard Time', '+03:30'],
    ['Arabian Standard Time', '+04:00'], ['Astrakhan Standard Time', '+04:00'], ['Azerbaijan Standard Time', '+04:00'], ['Russia Time Zone 3', '+04:00'],
    ['Mauritius Standard Time', '+04:00'], ['Saratov Standard Time', '+04:00'], ['Georgian Standard Time', '+04:00'], ['Caucasus Standard Time', '+04:00'],
    ['Afghanistan Standard Time', '+04:30'], ['West Asia Standard Time', '+05:00'], ['Qyzylorda Standard Time', '+05:00'], ['Ekaterinburg Standard Time', '+05:00'],
    ['Pakistan Standard Time', '+05:00'], ['India Standard Time', '+05:30'], ['Sri Lanka Standard Time', '+05:30'], ['Nepal Standard Time', '+05:45'],
    ['Central Asia Standard Time', '+05:00'], ['Bangladesh Standard Time', '+06:00'], ['Omsk Standard Time', '+06:00'], ['Myanmar Standard Time', '+06:30'],
    ['SE Asia Standard Time', '+07:00'], ['Altai Standard Time', '+07:00'], ['W. Mongolia Standard Time', '+07:00'], ['North Asia Standard Time', '+07:00'],
    ['N. Central Asia Standard Time', '+07:00'], ['Tomsk Standard Time', '+07:00'], ['China Standard Time', '+08:00'], ['North Asia East Standard Time', '+08:00'],
    ['Singapore Standard Time', '+08:00'], ['W. Australia Standard Time', '+08:00'], ['Taipei Standard Time', '+08:00'], ['Ulaanbaatar Standard Time', '+08:00'],
    ['Aus Central W. Standard Time', '+08:45'], ['Transbaikal Standard Time', '+09:00'], ['Tokyo Standard Time', '+09:00'], ['North Korea Standard Time', '+09:00'],
    ['Korea Standard Time', '+09:00'], ['Yakutsk Standard Time', '+09:00'], ['Cen. Australia Standard Time', '+09:30'], ['AUS Central Standard Time', '+09:30'],
    ['E. Australia Standard Time', '+10:00'], ['AUS Eastern Standard Time', '+10:00'], ['West Pacific Standard Time', '+10:00'], ['Tasmania Standard Time', '+10:00'],
    ['Vladivostok Standard Time', '+10:00'], ['Lord Howe Standard Time', '+10:30'], ['Bougainville Standard Time', '+11:00'], ['Russia Time Zone 10', '+11:00'],
    ['Magadan Standard Time', '+11:00'], ['Norfolk Standard Time', '+11:00'], ['Sakhalin Standard Time', '+11:00'], ['Central Pacific Standard Time', '+11:00'],
    ['Russia Time Zone 11', '+12:00'], ['New Zealand Standard Time', '+12:00'], ['UTC+12', '+12:00'], ['Fiji Standard Time', '+12:00'],
    ['Kamchatka Standard Time', '+12:00'], ['Chatham Islands Standard Time', '+12:45'], ['UTC+13', '+13:00'], ['Tonga Standard Time', '+13:00'],
    ['Samoa Standard Time', '+13:00'], ['Line Islands Standard Time', '+14:00']
  ];
  var TIME_ZONE_IDS = TIME_ZONES.map(function (z) { return z[0]; });
  var LOCALES = ['en-US', 'en-GB', 'en-AU', 'en-CA', 'en-IN', 'en-IE', 'en-NZ', 'zh-HK', 'zh-TW', 'zh-CN', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'fr-CA', 'es-ES', 'es-MX', 'it-IT', 'pt-BR', 'pt-PT', 'nl-NL', 'sv-SE', 'nb-NO', 'da-DK', 'fi-FI', 'pl-PL', 'cs-CZ', 'hu-HU', 'tr-TR', 'ru-RU', 'uk-UA', 'el-GR', 'he-IL', 'ar-SA', 'th-TH', 'vi-VN', 'id-ID', 'ms-MY'];
  var KEYBOARDS = [['en-US', 'US'], ['0409:00000409', 'US (input locale id)'], ['en-GB', 'United Kingdom'], ['0809:00000809', 'United Kingdom (input locale id)'], ['zh-HK', 'Chinese (Hong Kong SAR)'], ['0c04:00000409', 'Chinese (Hong Kong SAR) with US keys'], ['zh-TW', 'Chinese (Taiwan)'], ['ja-JP', 'Japanese'], ['ko-KR', 'Korean'], ['de-DE', 'German'], ['fr-FR', 'French'], ['es-ES', 'Spanish'], ['it-IT', 'Italian'], ['pt-BR', 'Portuguese (Brazil)'], ['nl-NL', 'Dutch']];
  var SERVER_EDITIONS = [['1', 'Windows Server 2025 Standard (Server Core)'], ['2', 'Windows Server 2025 Standard (Desktop Experience)'], ['3', 'Windows Server 2025 Datacenter (Server Core)'], ['4', 'Windows Server 2025 Datacenter (Desktop Experience)']];
  var CLIENT_EDITIONS = [['1', 'Windows 11 Home'], ['4', 'Windows 11 Education'], ['6', 'Windows 11 Pro'], ['7', 'Windows 11 Pro N'], ['8', 'Windows 11 Pro Education'], ['10', 'Windows 11 Pro for Workstations'], ['3', 'Windows 11 Enterprise (Enterprise media)']];

  // Steps of the unattended install per mode; text lives in i18n under tl.<mode>.<n>.t / .d
  var TIMELINE = { server: 7, guest: 6, custom: 6 };
  var CHECKLIST = { server: 8, guest: 7, custom: 6 };

  var api = {
    // original API
    buildAutounattend: buildAutounattend, buildFirstboot: buildFirstboot, importFirstboot: importFirstboot, kitLayout: kitLayout, validate: validate, unattendPassword: unattendPassword,
    // modes and model
    buildXml: buildXml, buildModelTree: buildModelTree, serverTree: serverTree, guestTree: guestTree, customTree: customTree,
    defaultModel: defaultModel, normalizeModel: normalizeModel, normalizePresetBundle: normalizePresetBundle, stripSecrets: stripSecrets,
    validateMode: validateMode, validateModel: validateModel, MESSAGES: MESSAGES, SECRET_FIELDS: SECRET_FIELDS, MODES: MODES,
    // XML
    serialize: serialize, parseXml: parseXml, isWellFormed: isWellFormed, elementToValue: elementToValue, valueToElement: valueToElement,
    mergeValue: mergeValue, parseRawBlock: parseRawBlock, valuesToRawXml: valuesToRawXml, importXml: importXml, detectMode: detectMode,
    decodeUnattendPassword: decodeUnattendPassword, highlightXml: highlightXml, lineDiff: lineDiff,
    // helpers
    suggestNetbios: suggestNetbios, domainDn: domainDn, guestOu: guestOu, dnsCommand: dnsCommand, FIRSTLOGON_CMD: FIRSTLOGON_CMD, FIRSTBOOT_KEYS: FIRSTBOOT_KEYS,
    generatePassword: generatePassword, passwordStrength: passwordStrength, strongPassword: strongPassword,
    TIME_ZONES: TIME_ZONES, TIME_ZONE_IDS: TIME_ZONE_IDS, LOCALES: LOCALES, KEYBOARDS: KEYBOARDS,
    SERVER_EDITIONS: SERVER_EDITIONS, CLIENT_EDITIONS: CLIENT_EDITIONS, TIMELINE: TIMELINE, CHECKLIST: CHECKLIST, PASS_ORDER: PASS_ORDER,
    syncFromXml: syncFromXml, alignXml: alignXml, flattenXml: flattenXml, compareXml: compareXml, simulate: simulate, SNIPPETS: SNIPPETS, applySnippet: applySnippet,
    COMMAND_LISTS: COMMAND_LISTS, EXTRA_SETTINGS: EXTRA_SETTINGS, EXTRA_COMMANDS: EXTRA_COMMANDS, APP_IDS: APP_IDS, POWER_PLANS: POWER_PLANS, extraDefaults: extraDefaults, PART_TYPES: PART_TYPES, layoutDiskXml: layoutDiskXml, readDiskLayout: readDiskLayout, clone: clone
  };
  root.TempDeskAnswer = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
