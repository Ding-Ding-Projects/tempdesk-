// Docs search with the shared regex builder (assets/regex-builder.js; falls back to a plain toggle). Uses search-index.json built by build.mjs.
(function () {
  'use strict';
  var S = window.TempDeskSite;
  var q = document.getElementById('docs-q'), re = document.getElementById('docs-re'), hits = document.getElementById('docs-hits'), count = document.getElementById('docs-count');
  if (!q) return;
  var pages = [];
  fetch(S.ROOT + 'search-index.json').then(function (r) { return r.json(); }).then(function (j) { pages = j.pages.filter(function (p) { return p.text; }); draw(); }).catch(function () { count.textContent = S.t('docs.indexFailed'); });
  function snippet(text, m) {
    var i = m.index, s = Math.max(0, i - 60), e = Math.min(text.length, i + m.len + 80);
    var frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode((s ? '...' : '') + text.slice(s, i)));
    var mk = document.createElement('mark'); mk.textContent = text.slice(i, i + m.len); frag.appendChild(mk);
    frag.appendChild(document.createTextNode(text.slice(i + m.len, e) + (e < text.length ? '...' : '')));
    return frag;
  }
  var RX = window.TempDeskRegex, rx = null;
  function find(text, query, useRe) {
    if (rx) { var c = RX.compile(query, rx.state), f = c.ok ? c.find(text) : null; return f ? { index: f.index, len: Math.max(1, f.length) } : null; }
    if (useRe) { var rx = new RegExp(query, 'i'); var mm = rx.exec(text); return mm ? { index: mm.index, len: Math.max(1, mm[0].length) } : null; }
    var lower = text.toLowerCase(), words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every(function (w) { return lower.indexOf(w) >= 0; })) return null;
    return { index: lower.indexOf(words[0]), len: words[0].length };
  }
  function draw() {
    var query = q.value.trim(), useRe = rx ? rx.state.regex : re.getAttribute('aria-pressed') === 'true';
    hits.replaceChildren();
    if (!query) { count.textContent = ''; return; }
    if (rx) { var cc = RX.compile(query, rx.state); q.setAttribute('aria-invalid', String(!cc.ok)); if (!cc.ok) { count.textContent = S.t('palette.badRegex'); return; } }
    else if (useRe) { try { new RegExp(query, 'i'); q.setAttribute('aria-invalid', 'false'); } catch (e) { q.setAttribute('aria-invalid', 'true'); count.textContent = S.t('palette.badRegex'); return; } }
    var n = 0;
    pages.forEach(function (p) {
      var m = find(p.title + ' ' + p.text, query, useRe);
      if (!m) return;
      n++;
      var a = document.createElement('a');
      a.className = 'hit'; a.href = S.ROOT + p.url;
      a.appendChild(document.createTextNode(p.title));
      var sm = document.createElement('small'); sm.appendChild(snippet(p.title + ' ' + p.text, m)); a.appendChild(sm);
      hits.appendChild(a);
    });
    count.textContent = S.t('docs.results', [n]);
  }
  var tm;
  if (RX) {
    if (re) re.remove();
    rx = RX.attachRegexBuilder(q, { t: function (k) { var a = Array.prototype.slice.call(arguments, 1), v = S.t(k, a, '\u0000'); return v === '\u0000' ? k : v; },
      sampleProvider: function () { return pages.slice(0, 40).map(function (p) { return p.title + ': ' + String(p.text).slice(0, 300); }).join('\n'); }, onChange: draw });
    S.onLang(draw);
    return;
  }
  q.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(draw, 120); });
  re.addEventListener('click', function () { re.setAttribute('aria-pressed', String(re.getAttribute('aria-pressed') !== 'true')); draw(); q.focus(); });
  S.onLang(draw);
})();
