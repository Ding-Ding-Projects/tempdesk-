// Search surfaces: one independent search field per list, table, tree, panel, picker, menu or
// tab strip, each wired to the shared regex builder (regex-builder.js, window.TempDeskRegex,
// copied from site/assets). Plain text is the default; ".*" opts in to JavaScript regular
// expressions and "Builder" opens the anchored builder for that field only.
//
// Declarative use (server templates or script-built markup):
//   <div data-search-surface="id" data-search-kind="list|table|tree|tabs|select|menu|custom"
//        data-search-target="css" data-search-scope="closest css" data-search-items="css"
//        data-search-text="attribute" data-search-group="css" data-search-label="label"></div>
//   The attributes may also sit on an existing <input>, which is then upgraded in place.
// Script use: TDSearch.mount(hostOrInput, { id, kind, target, items, label, onChange(surface), tabs })
//   surface: { id, input, builder, state(), active(), test(text), matches(text), highlight(roots), refresh(), count(shown, total), listen(fn) }
// Every surface keeps its own state in memory; nothing is persisted.
(function () {
  'use strict';
  var doc = document, TD = window.TD || {}, R = window.TempDeskRegex;
  var t = TD.t || function (k) { return k; };
  if (!R || !R.attachRegexBuilder) return;
  function $$(s, c) { return Array.prototype.slice.call((c || doc).querySelectorAll(s)); }
  function tr(key) { var v = t(key); return v === key ? null : v; }
  function rt(key) { return tr(key) || key; }
  var WORKER = (doc.querySelector('script[src*="regex-builder.js"]') || {}).src || '';
  var all = [];          // live surfaces
  var byId = {};         // id -> latest surface (tests and debugging)
  var hl = {};           // id -> [Range] for the CSS highlight registry
  var HL_OK = !!(window.CSS && CSS.highlights && window.Highlight);

  // compile() of the shared module can throw for plain text with some characters; never let a
  // search field break. The local plain matcher keeps the module's semantics (all words, any order).
  function plainEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function localPlain(q, cs) {
    var words = String(q).trim().split(/\s+/).filter(Boolean), fl = cs ? 'g' : 'gi';
    var res = words.map(function (w) { return new RegExp(plainEsc(w), fl); });
    var any = new RegExp(words.map(plainEsc).join('|'), fl);
    return { ok: true, empty: !words.length, plain: true, error: '', errorIndex: -1,
      test: function (s) { s = String(s); return res.every(function (r) { r.lastIndex = 0; return r.test(s); }); },
      matches: function (s, limit) { var out = [], m; any.lastIndex = 0; while ((m = any.exec(String(s))) && out.length < (limit || 200)) { out.push({ index: m.index, length: m[0].length }); if (!m[0].length) any.lastIndex++; } return out; } };
  }
  function safeCompile(st) {
    try { return R.compile(st.regex ? (st.pattern || st.query) : st.query, { regex: st.regex, flags: st.flags, wholeWord: st.wholeWord, caseSensitive: st.caseSensitive }); }
    catch (e) {
      if (!st.regex) return localPlain(st.query, st.caseSensitive);
      return { ok: false, empty: false, error: e.message, errorIndex: -1, test: function () { return false; }, matches: function () { return []; } };
    }
  }

  function paintHighlights() {
    if (!HL_OK) return;
    var ranges = [];
    Object.keys(hl).forEach(function (k) { ranges = ranges.concat(hl[k]); });
    try {
      if (!ranges.length) { CSS.highlights.delete('td-search'); return; }
      var h = new Highlight(); ranges.forEach(function (r) { h.add(r); }); CSS.highlights.set('td-search', h);
    } catch (e) { /* ignore */ }
  }
  var SKIP = { SCRIPT: 1, STYLE: 1, INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, svg: 1 };

  function Surface(host, o) {
    var self = this;
    o = o || {};
    this.id = o.id || host.getAttribute('data-search-surface') || ('search-' + all.length);
    this.kind = o.kind || host.getAttribute('data-search-kind') || 'list';
    this.host = host; this.o = o;
    var label = o.label || host.getAttribute('data-search-label') || host.getAttribute('aria-label') || host.getAttribute('placeholder') || t('Search');
    var input, pill;
    if (host.tagName === 'INPUT' && (o.bare || host.hasAttribute('data-search-bare'))) {
      // The field already sits in its own pill (command bar, policy search): add the buttons beside it.
      input = host; pill = host.parentNode;
    } else if (host.tagName === 'INPUT') {
      input = host;
      pill = doc.createElement('span'); pill.className = 'ss' + (o.compact || host.hasAttribute('data-search-compact') ? ' sm' : '');
      host.parentNode.insertBefore(pill, host); pill.appendChild(input);
    } else {
      pill = doc.createElement('span'); pill.className = 'ss' + (o.compact || host.hasAttribute('data-search-compact') ? ' sm' : '');
      var ic = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); ic.setAttribute('viewBox', '0 0 24 24'); ic.setAttribute('aria-hidden', 'true'); ic.setAttribute('class', 'ss-ic');
      var p = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-3.5-3.5'); ic.appendChild(p); pill.appendChild(ic);
      input = doc.createElement('input'); input.type = 'search';
      input.id = 'ss-' + this.id.replace(/[^\w-]/g, '_') + '-' + all.length;
      input.placeholder = label; input.setAttribute('aria-label', label);
      pill.appendChild(input); host.appendChild(pill);
    }
    if (!input.getAttribute('aria-label') && !(input.id && doc.querySelector('label[for="' + input.id + '"]'))) input.setAttribute('aria-label', label);
    input.setAttribute('data-search-input', this.id);
    this.input = input; this.pill = pill;
    this.countEl = doc.createElement('span'); this.countEl.className = 'ss-n'; this.countEl.setAttribute('aria-live', 'polite');
    this.errEl = doc.createElement('span'); this.errEl.className = 'ss-err error-text'; this.errEl.hidden = true; this.errEl.setAttribute('role', 'alert');
    pill.insertAdjacentElement('afterend', this.errEl);
    this.compiled = safeCompile(R.defaultState());
    var tmr = null;
    function later() { clearTimeout(tmr); tmr = setTimeout(function () { self.refresh(); }, 130); }
    this.builder = R.attachRegexBuilder(input, {
      label: label, container: pill, noHostClass: true, workerUrl: WORKER,
      t: function (key) { return tr(key) || key; },
      onChange: function () { later(); },
      sampleProvider: function () { return self.sample(); }
    });
    if (pill.classList.contains('ss')) pill.appendChild(this.countEl); // keep the count after the buttons
    else this.builder.el.insertAdjacentElement('afterend', this.countEl);
    host.setAttribute('data-search-ready', '');
    input.addEventListener('input', later);
    this.builder.toggle.addEventListener('click', later);
    // A form around the field (server-side tables): keep the regex flag in step and block invalid submits.
    var form = input.form;
    if (form) {
      this.flag = form.querySelector('[data-regex-flag]');
      if (this.flag && this.flag.value === '1') this.builder.set({ regex: true, query: input.value });
      form.addEventListener('submit', function (e) { if (!self.compiled.ok) { e.preventDefault(); input.focus(); } });
    }
    if (this.kind === 'tabs' && o.tabs) this.tabTools();
    this.observe();
    all.push(this); byId[this.id] = this;
    var prm = host.getAttribute('data-search-param');
    if (prm) { var pv = new URLSearchParams(location.search).get(prm); if (pv) this.builder.set({ query: pv }); }
    if (input.value) this.refresh();
  }
  Surface.prototype.state = function () { return this.builder.state; };
  Surface.prototype.active = function () { return this.compiled.ok && !this.compiled.empty; };
  Surface.prototype.test = function (text) { return !this.active() || this.compiled.test(String(text == null ? '' : text)); };
  Surface.prototype.matches = function (text, limit) { return this.active() ? this.compiled.matches(String(text), limit || 50) : []; };
  Surface.prototype.targets = function () {
    var o = this.o, h = this.host;
    if (o.target) return [].concat(o.target);
    var sel = h.getAttribute('data-search-target'); if (!sel) return [];
    var scopeSel = h.getAttribute('data-search-scope'), scope = scopeSel ? (h.closest(scopeSel) || doc) : doc;
    return $$(sel, scope);
  };
  Surface.prototype.itemSel = function () {
    var s = this.o.items || this.host.getAttribute('data-search-items');
    if (s) return s;
    return { table: 'tbody > tr', select: 'option', menu: '.row-btn, [role="menuitem"], a, button:not(.rxb-btn)', tabs: '[role="tab"]', tree: 'li' }[this.kind] || ':scope > *';
  };
  Surface.prototype.textOf = function (it) {
    var a = this.o.textAttr || this.host.getAttribute('data-search-text');
    if (typeof this.o.textFn === 'function') return String(this.o.textFn(it) || '');
    if (this.kind === 'tree') return ownText(it);
    return (a ? (it.getAttribute(a) || '') + ' ' : '') + (it.textContent || '');
  };
  function ownText(li) {
    var s = '';
    Array.prototype.forEach.call(li.childNodes, function (n) {
      if (n.nodeType === 3) s += n.data;
      else if (n.nodeType === 1 && !/^(UL|OL)$/.test(n.tagName) && n.getAttribute('role') !== 'group') s += ' ' + n.textContent;
    });
    return s;
  }
  Surface.prototype.items = function () {
    var sel = this.itemSel(), out = [];
    this.targets().forEach(function (tg) { out = out.concat($$(sel, tg)); });
    return out.filter(function (x) { return !x.closest('.ss, .rxb-pop, [data-search-surface]'); });
  };
  Surface.prototype.sample = function () {
    var self = this, txt = [];
    this.items().slice(0, 300).forEach(function (it) { txt.push(self.textOf(it).replace(/\s+/g, ' ').trim()); });
    if (!txt.length) this.targets().forEach(function (tg) { txt.push((tg.textContent || '').replace(/\s+/g, ' ').trim()); });
    return txt.filter(Boolean).join('\n').slice(0, 20000);
  };
  Surface.prototype.refresh = function () {
    var st = this.builder.state;
    this.compiled = safeCompile(st);
    var c = this.compiled;
    this.input.setAttribute('aria-invalid', String(!c.ok));
    if (this.flag) this.flag.value = st.regex ? '1' : '';
    this.errEl.hidden = c.ok;
    this.errEl.textContent = c.ok ? '' : (c.slow ? rt('rx.slow') : t('Invalid pattern') + ': ' + c.error);
    this.pill.classList.toggle('on', this.active());
    this.apply();
  };
  Surface.prototype.count = function (shown, total) {
    this.countEl.textContent = this.active() ? t('{shown} of {total}', { shown: shown, total: total }) : '';
  };
  Surface.prototype.apply = function () {
    // A surface whose field is hidden (an inactive panel tab) leaves the shared list alone.
    if (typeof this.o.onChange !== 'function' && this.host.closest('[hidden]') && this.host.tagName !== 'INPUT') return;
    this.applying = true;
    try {
      if (typeof this.o.onChange === 'function') this.o.onChange(this);
      else if (this.kind === 'tree') this.filterTree();
      else if (this.kind !== 'custom') this.filterList();
      var self = this; (this.listeners || []).forEach(function (fn) { fn(self); });
    } finally { this.applying = false; }
    if (this.o.tabs) this.updateTabTools();
  };
  // Page scripts that own the filtering of a declarative surface subscribe here.
  Surface.prototype.listen = function (fn) { (this.listeners = this.listeners || []).push(fn); if (this.active()) fn(this); };
  function hide(el, on, id) {
    if (on) { if (!el.hidden) { el.hidden = true; el.__ssHid = id; } }
    else if (el.__ssHid === id) { el.hidden = false; el.__ssHid = null; }
  }
  Surface.prototype.filterList = function () {
    var self = this, items = this.items(), shown = 0, total = 0, act = this.active();
    items.forEach(function (it) {
      if (it.hidden && it.__ssHid !== self.id) return; // hidden by its owner, not by this search
      total++;
      var m = !act || self.compiled.test(self.textOf(it));
      if (m) shown++;
      hide(it, !m, self.id);
    });
    var g = this.o.group || this.host.getAttribute('data-search-group');
    if (g) this.targets().forEach(function (tg) {
      $$(g, tg).forEach(function (grp) {
        var inside = $$(self.itemSel(), grp).filter(function (x) { return x !== grp; });
        var own = act && self.compiled.test(self.textOf(grp).slice(0, 4000));
        hide(grp, act && !own && !inside.some(function (x) { return !x.hidden; }), self.id);
      });
    });
    this.count(shown, total);
    this.highlight(act ? items.filter(function (x) { return !x.hidden; }) : []);
  };
  Surface.prototype.filterTree = function () {
    var self = this, act = this.active(), lis = this.items(), keep = new Map(), shown = 0;
    for (var i = lis.length - 1; i >= 0; i--) {
      var li = lis[i];
      var k = !act || this.compiled.test(ownText(li));
      if (!k) { for (var j = 0; j < li.children.length && !k; j++) { var c = li.children[j]; if (/^(UL|OL)$/.test(c.tagName) || c.getAttribute('role') === 'group') k = $$(':scope > li', c).some(function (x) { return keep.get(x); }); } }
      keep.set(li, k);
    }
    lis.forEach(function (li) {
      var k = keep.get(li); if (k && act && self.compiled.test(ownText(li))) shown++;
      hide(li, !k, self.id);
      // Open collapsed branches that hold a match, and close them again when the search clears.
      Array.prototype.forEach.call(li.children, function (c) {
        if (!/^(UL|OL)$/.test(c.tagName)) return;
        var want = act && k && $$(':scope > li', c).some(function (x) { return keep.get(x); });
        if (want && c.hidden) { c.hidden = false; c.__ssOpen = self.id; setExp(li, 'true'); }
        else if (!want && c.__ssOpen === self.id) { c.hidden = true; c.__ssOpen = null; setExp(li, 'false'); }
      });
    });
    this.count(shown, lis.length);
    this.highlight(act ? lis.filter(function (x) { return !x.hidden && self.compiled.test(ownText(x)); }) : [], true);
  };
  function setExp(li, v) { var b = li.querySelector(':scope > .node [aria-expanded], :scope > [aria-expanded], :scope > div [aria-expanded]'); if (b) b.setAttribute('aria-expanded', v); }
  // Highlight matches in the given roots (the CSS Custom Highlight API: no DOM changes).
  Surface.prototype.highlight = function (roots, own) {
    var self = this, ranges = [];
    if (this.active() && HL_OK && this.o.highlight !== false && this.host.getAttribute('data-search-highlight') !== '0') {
      (roots || []).slice(0, 400).forEach(function (r) {
        var w = doc.createTreeWalker(r, NodeFilter.SHOW_TEXT, { acceptNode: function (n) {
          var p = n.parentNode; if (!p || SKIP[p.nodeName] || p.closest('.ss, .rxb-tools')) return NodeFilter.FILTER_REJECT;
          if (own && p.closest('ul, ol, [role="group"]') !== r.closest('ul, ol, [role="group"]') && p.closest('li') !== r) return NodeFilter.FILTER_REJECT;
          return /\S/.test(n.data) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        } });
        var n, guard = 0;
        while ((n = w.nextNode()) && guard++ < 200) {
          self.compiled.matches(n.data, 20).forEach(function (m) {
            if (!m.length) return;
            try { var rg = doc.createRange(); rg.setStart(n, m.index); rg.setEnd(n, Math.min(n.data.length, m.index + m.length)); ranges.push(rg); } catch (e) { /* ignore */ }
          });
        }
      });
    }
    hl[this.id] = ranges; paintHighlights();
  };
  Surface.prototype.observe = function () {
    var self = this, pending = false;
    if (!window.MutationObserver) return;
    this.mo = new MutationObserver(function () {
      if (self.applying || pending || !self.active()) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; if (self.host.isConnected) self.apply(); });
    });
    this.targets().forEach(function (tg) { self.mo.observe(tg, { childList: true, subtree: true, characterData: true }); });
  };
  Surface.prototype.destroy = function () {
    if (this.mo) this.mo.disconnect();
    try { this.builder.destroy(); } catch (e) { /* ignore */ }
    delete hl[this.id]; paintHighlights();
    var i = all.indexOf(this); if (i >= 0) all.splice(i, 1);
    if (byId[this.id] === this) delete byId[this.id];
  };

  // ---------------------------------------------------------- tab strips: close by text
  Surface.prototype.tabTools = function () {
    var self = this, bar = doc.createElement('span'); bar.className = 'ss-tabtools';
    function mk(key, fn) { var b = doc.createElement('button'); b.type = 'button'; b.className = 'btn sm text'; b.addEventListener('click', fn); bar.appendChild(b); b.setAttribute('data-label', t(key)); return b; }
    this.closeIn = mk('Close tabs containing text', function () { self.closeTabs(true); });
    this.closeOut = mk('Close tabs not containing text', function () { self.closeTabs(false); });
    this.pill.insertAdjacentElement('afterend', bar);
    this.updateTabTools();
  };
  Surface.prototype.tabPlan = function (containing) {
    var self = this, list = this.o.tabs.list(), close = [], kept = [];
    if (!this.active()) return { close: [], kept: [] };
    list.forEach(function (tb) {
      var hit = self.compiled.test(tb.label || '');
      if (hit !== containing) return;
      if (tb.pinned) kept.push({ tab: tb, why: 'pinned' });
      else if (tb.dirty) kept.push({ tab: tb, why: 'dirty' });
      else close.push(tb);
    });
    return { close: close, kept: kept };
  };
  Surface.prototype.updateTabTools = function () {
    if (!this.closeIn) return;
    var a = this.tabPlan(true), b = this.tabPlan(false), act = this.active();
    this.closeIn.parentNode.hidden = !act; // the close actions appear once there is text to match
    this.closeIn.textContent = this.closeIn.getAttribute('data-label') + (act ? ' (' + a.close.length + ')' : '');
    this.closeOut.textContent = this.closeOut.getAttribute('data-label') + (act ? ' (' + b.close.length + ')' : '');
    this.closeIn.disabled = !act || !a.close.length; this.closeOut.disabled = !act || !b.close.length;
    this.closeIn.title = this.closeOut.title = act ? '' : t('Type text to search the tabs first.');
  };
  Surface.prototype.closeTabs = function (containing) {
    var self = this, plan = this.tabPlan(containing);
    if (!this.active()) { TD.toast && TD.toast(t('Type text to search the tabs first.'), 'error'); return; }
    if (!plan.close.length) return;
    var d = doc.createElement('dialog'); d.className = 'ss-dlg'; d.setAttribute('aria-labelledby', 'ss-dlg-h');
    var h = doc.createElement('h2'); h.id = 'ss-dlg-h'; h.textContent = t(containing ? 'Close tabs containing text' : 'Close tabs not containing text'); d.appendChild(h);
    var p = doc.createElement('p'); p.textContent = t('{count} tabs will close:', { count: plan.close.length }); d.appendChild(p);
    var ul = doc.createElement('ul'); ul.className = 'small'; ul.setAttribute('data-search-exempt', 'confirmation preview');
    plan.close.slice(0, 50).forEach(function (tb) { var li = doc.createElement('li'); li.textContent = tb.label; ul.appendChild(li); });
    d.appendChild(ul);
    if (plan.kept.length) {
      var k = doc.createElement('p'); k.className = 'subtle';
      k.textContent = t('Kept open: {count} (pinned or with unsaved changes)', { count: plan.kept.length }) + ': ' + plan.kept.map(function (x) { return x.tab.label; }).join(', ');
      d.appendChild(k);
    }
    var row = doc.createElement('div'); row.className = 'form-actions';
    var ok = doc.createElement('button'); ok.type = 'button'; ok.className = 'btn filled'; ok.textContent = t('Close {count} tabs', { count: plan.close.length });
    var no = doc.createElement('button'); no.type = 'button'; no.className = 'btn'; no.textContent = t('Cancel');
    ok.addEventListener('click', function () { d.close(); self.o.tabs.close(plan.close.map(function (x) { return x.key; })); self.updateTabTools(); });
    no.addEventListener('click', function () { d.close(); });
    row.appendChild(ok); row.appendChild(no); d.appendChild(row);
    d.addEventListener('close', function () { d.remove(); self.input.focus(); });
    doc.body.appendChild(d); d.showModal(); no.focus();
  };

  // ---------------------------------------------------------- mounting
  function mount(host, o) {
    if (!host) return null;
    if (host.__ss) return host.__ss;
    var s = new Surface(host, o || {}); host.__ss = s; s.input.__ss = s; return s;
  }
  function scan(root) {
    $$('[data-search-surface]:not([data-search-ready])', root).forEach(function (h) {
      if (h.hasAttribute('data-search-manual')) return; // mounted by its page script with options
      mount(h);
    });
  }
  scan(doc);
  if (window.MutationObserver) {
    new MutationObserver(function (muts) {
      var add = false, rem = false;
      muts.forEach(function (m) { if (m.addedNodes.length) add = true; if (m.removedNodes.length) rem = true; });
      if (add) scan(doc);
      if (rem) all.slice().forEach(function (s) { if (!s.host.isConnected) s.destroy(); });
    }).observe(doc.body, { childList: true, subtree: true });
  }
  window.TDSearch = { mount: mount, get: function (id) { return byId[id] || null; }, list: function () { return all.slice(); }, scan: scan };
})();
