// Base64 toolkit page. Everything runs in this browser; nothing is uploaded.
// Codec: assets/base64.js (window.TempDeskBase64). History: assets/history.js.
(function () {
  'use strict';
  var B = window.TempDeskBase64, S = window.TempDeskSite, HI = window.TempDeskHistory, Z = window.TempDeskZip;
  var t = function (k, a, f) { return S.t(k, a, f); };
  var h = S.h, LS = S.LS;
  var $ = function (id) { return document.getElementById(id); };
  var hist = null;
  var keepPayload = function () { return LS.get('td.b64.keep', '0') === '1'; };

  // ---------- options ----------
  function encOpts() {
    var v = $('b64-variant').value;
    var ll = $('b64-wrap').value;
    var lineLength = ll === 'none' ? 0 : ll === 'mime' ? 76 : Math.max(4, parseInt($('b64-linelen').value, 10) || 76);
    return { variant: v, pad: $('b64-pad').checked, lineLength: lineLength, eol: $('b64-eol').value === 'lf' ? '\n' : '\r\n' };
  }
  function decOpts() { return { variant: $('b64-variant').value === 'url' ? 'url' : $('b64-variant').value === 'mime' ? 'mime' : 'standard', strict: $('b64-strict').value === 'strict' }; }
  function textEnc() { return $('b64-textenc').value; }
  function optsSnapshot() {
    return { variant: $('b64-variant').value, pad: $('b64-pad').checked, wrap: $('b64-wrap').value, lineLength: $('b64-linelen').value, eol: $('b64-eol').value, strict: $('b64-strict').value, textEnc: textEnc() };
  }
  function applyOpts(o) {
    if (!o) return;
    ['variant', 'wrap', 'eol', 'strict'].forEach(function (k) { if (o[k] !== undefined) $('b64-' + k).value = o[k]; });
    if (o.textEnc) $('b64-textenc').value = o.textEnc;
    if (o.lineLength !== undefined) $('b64-linelen').value = o.lineLength;
    if (o.pad !== undefined) $('b64-pad').checked = o.pad;
    syncOpts();
  }
  function syncOpts() {
    $('b64-linelen-wrap').hidden = $('b64-wrap').value !== 'custom';
    if ($('b64-variant').value === 'mime' && $('b64-wrap').value === 'none') $('b64-wrap').value = 'mime';
  }

  // ---------- text mode ----------
  function setErr(msg) { var e = $('b64-err'); e.textContent = msg || ''; e.hidden = !msg; }
  function counts() {
    var inp = $('b64-in').value, out = $('b64-out').value;
    var inBytes = 0;
    try { inBytes = $('b64-dir').value === 'encode' ? B.textToBytes(inp, textEnc()).length : inp.length; } catch (e) { inBytes = NaN; }
    $('b64-counts').textContent = t('b64.counts', [inp.length, isNaN(inBytes) ? '?' : inBytes, out.length]);
  }
  function errorText(e) {
    if (e && e.code === 'char') return t('b64.err.char', [JSON.stringify(e.char), e.offset]);
    if (e && e.code === 'padding') return t('b64.err.padding', [e.offset]);
    if (e && e.code === 'length') return t('b64.err.length', [e.offset]);
    if (e && e.code === 'afterPad') return t('b64.err.afterPad', [e.offset]);
    if (e && e.code === 'bits') return t('b64.err.bits', [e.offset]);
    if (e && e.code === 'latin1') return t('b64.err.latin1', [e.offset]);
    if (e && e.code === 'utf16') return t('b64.err.utf16');
    if (e && e.name === 'TypeError') return t('b64.err.utf8');
    return t('b64.err.generic', [e && e.message ? e.message : String(e)]);
  }
  var lastBytes = null;
  function convert(record) {
    setErr('');
    var dir = $('b64-dir').value, inp = $('b64-in').value, out = '';
    lastBytes = null;
    try {
      if (dir === 'encode') {
        var bytes = B.textToBytes(inp, textEnc());
        out = B.encode(bytes, encOpts());
      } else {
        var dec = B.decode(inp, decOpts());
        lastBytes = dec;
        try { out = B.bytesToText(dec, textEnc(), true); }
        catch (e2) { out = ''; setErr(t('b64.notText', [dec.length])); }
        var ty = B.detectType(dec);
        $('b64-detected').textContent = t('b64.detected', [ty.mime, dec.length, B.suggestName('decoded', ty)]);
        preview(dec, ty);
      }
    } catch (e) { setErr(errorText(e)); out = ''; }
    $('b64-out').value = out;
    counts();
    if (record) recordText(dir);
  }
  function recordText(dir) {
    if (!hist) return;
    var st = { tool: 'text', dir: dir, opts: optsSnapshot(), inLen: $('b64-in').value.length, outLen: $('b64-out').value.length };
    if (keepPayload()) { st.input = $('b64-in').value; }
    hist.change(st, { key: dir === 'encode' ? 'b64.h.encode' : 'b64.h.decode', args: [st.inLen, st.outLen] }, 'text');
    updUndo();
  }

  // ---------- preview (inert: no scripts, sandboxed frame for text) ----------
  var blobUrl = null;
  function preview(bytes, ty) {
    var box = $('b64-preview');
    box.replaceChildren();
    if (blobUrl) { URL.revokeObjectURL(blobUrl); blobUrl = null; }
    if (!bytes || !bytes.length) return;
    var safeMime = { 'image/png': 1, 'image/jpeg': 1, 'image/gif': 1, 'image/webp': 1, 'audio/mpeg': 1, 'audio/wav': 1, 'audio/ogg': 1, 'video/mp4': 1 };
    if (safeMime[ty.mime]) {
      blobUrl = URL.createObjectURL(new Blob([bytes], { type: ty.mime }));
      if (ty.kind === 'image') box.appendChild(h('img', { src: blobUrl, alt: t('b64.previewImg'), style: 'max-width:100%;max-height:360px;border-radius:12px' }));
      else if (ty.kind === 'audio') box.appendChild(h('audio', { src: blobUrl, controls: true, preload: 'metadata', style: 'width:100%' }));
      else box.appendChild(h('video', { src: blobUrl, controls: true, preload: 'metadata', style: 'max-width:100%;max-height:360px' }));
    } else if (ty.kind === 'text') {
      var text = B.bytesToText(bytes.subarray(0, 200000), 'utf-8');
      var fr = h('iframe', { sandbox: '', title: t('b64.previewText'), style: 'width:100%;height:260px;border:1px solid var(--outline);border-radius:12px;background:#fff' });
      fr.srcdoc = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><pre style="white-space:pre-wrap;font:13px monospace;margin:8px">' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
      box.appendChild(fr);
    }
    box.appendChild(h('details', null, [h('summary', { style: 'min-height:44px;display:flex;align-items:center;cursor:pointer', text: t('b64.hex') }), h('pre', { class: 'diff', text: B.hexDump(bytes, 4096) + (bytes.length > 4096 ? '\n...' : '') })]));
  }

  // ---------- data: URLs ----------
  function buildDataUrl() {
    setErr('');
    try {
      var bytes = $('b64-dir').value === 'encode' ? B.textToBytes($('b64-in').value, textEnc()) : (lastBytes || B.decode($('b64-in').value, decOpts()));
      var mime = $('b64-mime').value.trim() || B.detectType(bytes).mime;
      if (!/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/.test(mime)) throw { code: 'mime' };
      var params = {};
      if (/^text\//.test(mime) && $('b64-dir').value === 'encode') params.charset = textEnc() === 'latin1' ? 'ISO-8859-1' : textEnc().toUpperCase();
      $('b64-out').value = B.buildDataUrl(bytes, mime, params);
      counts();
      record('b64.h.dataUrl', [mime, bytes.length]);
    } catch (e) { setErr(e && e.code === 'mime' ? t('b64.err.mime') : errorText(e)); }
  }
  function parseDataUrl() {
    setErr('');
    try {
      var r = B.parseDataUrl($('b64-in').value, { strict: $('b64-strict').value === 'strict' });
      lastBytes = r.bytes;
      var params = Object.keys(r.params).map(function (k) { return k + '=' + r.params[k]; }).join('; ');
      $('b64-detected').textContent = t('b64.dataInfo', [r.mime, params || '-', r.bytes.length, r.base64 ? 'base64' : t('b64.percent')]);
      var ty = B.detectType(r.bytes);
      try { $('b64-out').value = B.bytesToText(r.bytes, textEnc(), true); } catch (e2) { $('b64-out').value = ''; setErr(t('b64.notText', [r.bytes.length])); }
      preview(r.bytes, ty);
      counts();
      record('b64.h.parseData', [r.mime, r.bytes.length]);
    } catch (e) { setErr(e.code === 'notData' ? t('b64.err.notData') : e.code === 'noComma' ? t('b64.err.noComma') : errorText(e)); }
  }
  function record(key, args) {
    if (!hist) return;
    var st = { tool: 'text', dir: $('b64-dir').value, opts: optsSnapshot(), inLen: $('b64-in').value.length, outLen: $('b64-out').value.length };
    if (keepPayload()) st.input = $('b64-in').value;
    hist.change(st, { key: key, args: args });
    updUndo();
  }

  // ---------- files: streamed, chunked, verified ----------
  var jobs = [];
  function fmtBytes(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'; }
  var Sha256 = B.createSha256;
  function addFiles(list, dir) {
    Array.prototype.forEach.call(list, function (f) { jobs.push({ file: f, dir: dir, state: 'queued', done: 0, parts: [], paused: false, cancel: false }); });
    drawJobs();
    runNext();
  }
  var running = false;
  function runNext() {
    if (running) return;
    var j = jobs.filter(function (x) { return x.state === 'queued'; })[0];
    if (!j) return;
    running = true;
    process(j).then(function () { running = false; drawJobs(); runNext(); });
  }
  function wait(j) { return new Promise(function (res) { (function chk() { if (!j.paused || j.cancel) res(); else setTimeout(chk, 150); })(); }); }
  async function process(j) {
    j.state = 'running'; j.started = Date.now(); drawJobs();
    var f = j.file, size = f.size;
    try {
      var srcHash = Sha256(), outHash = Sha256(), parts = [];
      var opts = encOpts();
      if (j.dir === 'encode') {
        var enc = B.createEncoder(opts), verify = B.createDecoder({ variant: opts.variant === 'url' ? 'url' : 'standard', strict: false }), vHash = Sha256();
        for (var off = 0; off < size; off += B.ENCODE_CHUNK) {
          if (j.paused) await wait(j);
          if (j.cancel) throw { code: 'cancelled' };
          var chunk = new Uint8Array(await f.slice(off, off + B.ENCODE_CHUNK).arrayBuffer());
          srcHash.update(chunk);
          var s = enc.push(chunk);
          parts.push(s);
          vHash.update(verify.push(s));
          j.done = off + chunk.length; drawProgress(j);
        }
        var tail = enc.end(); parts.push(tail); vHash.update(verify.push(tail)); vHash.update(verify.end());
        j.srcSha = srcHash.hex(); j.verifySha = vHash.hex();
        if (j.srcSha !== j.verifySha) throw { code: 'verify' };
        j.outBlob = new Blob(parts, { type: 'text/plain' });
        j.outName = f.name + '.b64';
        j.outSize = j.outBlob.size;
      } else {
        // decode in 4-character aligned chunks (text read as bytes; Base64 is ASCII)
        var dec = B.createDecoder(decOpts()), carry = '', decoded = [], tdec = new TextDecoder('latin1'), head = null;
        var CH = B.DECODE_CHUNK, consumed = 0;
        for (var o = 0; o < size; o += CH) {
          if (j.paused) await wait(j);
          if (j.cancel) throw { code: 'cancelled' };
          var raw = new Uint8Array(await f.slice(o, o + CH).arrayBuffer());
          for (var q = 0; q < raw.length; q++) if (raw[q] > 127) throw { code: 'char', offset: o + q, char: String.fromCharCode(raw[q]) };
          var piece = carry + tdec.decode(raw);
          // keep alignment: hand over only complete 4-character groups of alphabet chars
          var keep, cnt = 0, cut = piece.length, c, p;
          for (p = piece.length - 1; p >= 0; p--) { c = piece.charCodeAt(p); if (c !== 10 && c !== 13 && c !== 32 && c !== 9) { cnt++; } }
          keep = cnt % 4;
          if (keep && o + CH < size) {
            var seen = 0;
            for (p = piece.length - 1; p >= 0; p--) { c = piece.charCodeAt(p); if (c !== 10 && c !== 13 && c !== 32 && c !== 9) { seen++; if (seen === keep) { cut = p; break; } } }
          }
          var give = o + CH < size ? piece.slice(0, cut) : piece;
          carry = o + CH < size ? piece.slice(cut) : '';
          var outChunk;
          try { outChunk = dec.push(give); } catch (e) { if (e.offset !== undefined) e.offset += consumed; throw e; }
          consumed += give.length;
          if (!head && outChunk.length) head = outChunk.slice(0, 64);
          decoded.push(outChunk);
          outHash.update(outChunk);
          j.done = Math.min(size, o + CH); drawProgress(j);
        }
        var last = dec.end(); decoded.push(last); outHash.update(last);
        j.verifySha = outHash.hex();
        var ty = B.detectType(head || (decoded[0] || new Uint8Array(0)));
        j.outBlob = new Blob(decoded, { type: ty.mime });
        // verification by re-reading the produced blob in chunks and hashing it again
        var check = Sha256();
        for (var r2 = 0; r2 < j.outBlob.size; r2 += B.ENCODE_CHUNK) check.update(new Uint8Array(await j.outBlob.slice(r2, r2 + B.ENCODE_CHUNK).arrayBuffer()));
        j.srcSha = check.hex();
        if (j.srcSha !== j.verifySha) throw { code: 'verify' };
        j.type = ty;
        j.outName = B.suggestName(f.name, ty);
        j.outSize = j.outBlob.size;
        j.head = head;
      }
      // second check with crypto.subtle for outputs that fit comfortably in memory
      if (window.crypto && crypto.subtle && j.outSize < 64 * 1048576) {
        var verifyBytes = j.dir === 'encode' ? new Uint8Array(await f.arrayBuffer()) : new Uint8Array(await j.outBlob.arrayBuffer());
        var d2 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', verifyBytes))).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
        if (d2 !== j.srcSha) throw { code: 'verify' };
        j.subtle = true;
      }
      j.state = 'done';
      if (hist) {
        var st = { tool: 'file', dir: j.dir, name: f.name, size: size, outSize: j.outSize, sha256: j.srcSha, opts: optsSnapshot() };
        hist.change(st, { key: j.dir === 'encode' ? 'b64.h.fileEncode' : 'b64.h.fileDecode', args: [f.name, fmtBytes(size)] });
        updUndo();
      }
    } catch (e) {
      j.state = e && e.code === 'cancelled' ? 'cancelled' : 'failed';
      j.error = e && e.code === 'cancelled' ? '' : e && e.code === 'verify' ? t('b64.err.verify') : errorText(e);
    }
    drawJobs();
  }
  function drawProgress(j) {
    var bar = document.querySelector('[data-job="' + jobs.indexOf(j) + '"] .meter > i');
    var lab = document.querySelector('[data-job="' + jobs.indexOf(j) + '"] .job-pct');
    var pct = j.file.size ? Math.floor(j.done / j.file.size * 100) : 100;
    if (bar) bar.style.width = pct + '%';
    if (lab) lab.textContent = pct + '% · ' + fmtBytes(j.done) + ' / ' + fmtBytes(j.file.size);
  }
  function saveBlob(name, blob) {
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  function drawJobs() {
    var box = $('b64-jobs');
    box.replaceChildren();
    if (!jobs.length) { box.appendChild(h('p', { class: 'help', style: 'color:var(--muted)', text: t('b64.noFiles') })); return; }
    jobs.forEach(function (j, i) {
      var pct = j.file.size ? Math.floor(j.done / j.file.size * 100) : 100;
      var row = h('div', { class: 'list-row', 'data-job': String(i) }, [
        h('div', null, [h('b', { text: j.file.name }), h('br'), h('small', { class: 'meter-label', text: t('b64.job.' + j.dir) + ' · ' + fmtBytes(j.file.size) + ' · ' + t('b64.state.' + j.state) })]),
        h('div', { class: 'meter', 'data-score': j.state === 'failed' ? '0' : '4' }, [h('i', { style: 'width:' + pct + '%' })]),
        h('small', { class: 'job-pct meter-label', text: pct + '%' })
      ]);
      if (j.error) row.appendChild(h('p', { class: 'err', role: 'alert', text: j.error }));
      if (j.state === 'done') row.appendChild(h('small', { class: 'meter-label', style: 'overflow-wrap:anywhere', text: t('b64.verified', [j.srcSha.slice(0, 16) + '...', fmtBytes(j.outSize)]) + (j.type ? ' · ' + j.type.mime : '') }));
      var tools = h('div', { class: 'row-tools' });
      if (j.state === 'running') {
        tools.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: j.paused ? t('b64.resume') : t('b64.pause'), onclick: function () { j.paused = !j.paused; drawJobs(); } }));
        tools.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('common.cancel'), onclick: function () { j.cancel = true; j.paused = false; } }));
      } else if (j.state === 'queued') {
        tools.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('common.cancel'), onclick: function () { j.state = 'cancelled'; drawJobs(); } }));
      } else if (j.state === 'done') {
        tools.appendChild(h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: t('b64.save', [j.outName]), onclick: function () { saveBlob(j.outName, j.outBlob); } }));
        if (j.dir === 'decode' && j.head) tools.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('b64.preview'), onclick: function () {
          j.outBlob.slice(0, 8 * 1048576).arrayBuffer().then(function (b) { preview(new Uint8Array(b), j.type); $('b64-preview').scrollIntoView({ block: 'nearest' }); });
        } }));
      }
      if (j.state !== 'running') tools.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('list.remove'), onclick: function () { jobs.splice(i, 1); drawJobs(); } }));
      row.appendChild(tools);
      box.appendChild(row);
    });
    var done = jobs.filter(function (j) { return j.state === 'done'; });
    if (done.length > 1) box.appendChild(h('button', { type: 'button', class: 'btn btn-inverse btn-sm', text: t('b64.zipAll', [done.length]), onclick: zipAll }));
  }
  async function zipAll() {
    var files = [], names = {};
    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      if (j.state !== 'done') continue;
      if (j.outSize > 512 * 1048576) { S.toast(t('b64.zipTooBig', [j.outName])); continue; }
      var n = j.outName, k = 1;
      while (names[n]) n = j.outName.replace(/(\.[^.]*)?$/, '-' + (++k) + '$1');
      names[n] = 1;
      files.push({ name: n, data: new Uint8Array(await j.outBlob.arrayBuffer()) });
    }
    try { saveBlob('base64-files.zip', Z.makeZip(files)); } catch (e) { S.toast(t('b64.err.generic', [e.message])); }
  }

  // ---------- import / export ----------
  function importClipboard() {
    if (!navigator.clipboard || !navigator.clipboard.readText) { setErr(t('b64.err.clipboard')); return; }
    navigator.clipboard.readText().then(function (txt) { $('b64-in').value = txt; convert(true); }, function () { setErr(t('b64.err.clipboardDenied')); });
  }
  function exportClipboard() {
    var v = $('b64-out').value;
    if (!navigator.clipboard) { setErr(t('b64.err.clipboard')); return; }
    navigator.clipboard.writeText(v).then(function () { S.toast(t('tb.copied')); }, function () { setErr(t('b64.err.clipboardDenied')); });
  }
  function exportFile() {
    var dir = $('b64-dir').value;
    if (dir === 'decode' && lastBytes) { var ty = B.detectType(lastBytes); saveBlob(B.suggestName('decoded', ty), new Blob([lastBytes], { type: ty.mime })); }
    else saveBlob(dir === 'encode' ? 'encoded.b64.txt' : 'decoded.txt', new Blob([$('b64-out').value], { type: 'text/plain' }));
  }
  async function exportJson() {
    var inp = $('b64-in').value, out = $('b64-out').value;
    var dir = $('b64-dir').value;
    var src = dir === 'encode' ? B.textToBytes(inp, textEnc()) : (lastBytes || new Uint8Array(0));
    var sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', src))).map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    var rec = { schema: 'tempdesk-base64-record', version: 1, created: new Date().toISOString(), direction: dir, options: optsSnapshot(), sizes: { inputChars: inp.length, outputChars: out.length, bytes: src.length }, sha256: { bytes: sha } };
    if ($('b64-json-payload').checked) rec.payload = { input: inp, output: out };
    saveBlob('base64-record.json', new Blob([JSON.stringify(rec, null, 2) + '\n'], { type: 'application/json' }));
  }

  // ---------- undo / redo ----------
  function updUndo() {
    document.querySelectorAll('[data-b64-undo]').forEach(function (b) { b.disabled = !hist || !hist.canUndo(); });
    document.querySelectorAll('[data-b64-redo]').forEach(function (b) { b.disabled = !hist || !hist.canRedo(); });
    drawHistory();
  }
  function restoreState(st) {
    if (!st) return;
    applyOpts(st.opts);
    if (st.tool === 'text' || st.tool === undefined) {
      if (st.dir) $('b64-dir').value = st.dir;
      if (st.input !== undefined) { $('b64-in').value = st.input; convert(false); }
      else if (st.inLen) S.toast(t('b64.noPayload'));
      else { $('b64-in').value = ''; $('b64-out').value = ''; counts(); }
    }
  }
  function undo() { if (!hist) return; var e = hist.undo(); if (e) restoreState(e.state); updUndo(); }
  function redo() { if (!hist) return; var e = hist.redo(); if (e) restoreState(e.state); updUndo(); }
  function msgText(m) { return m ? t(m.key, (m.args || []).map(function (a) { return typeof a === 'number' && a > 1e12 ? new Date(a).toLocaleString() : a; })) : ''; }
  var histRx = null; // shared regex builder on the history search (assets/regex-builder.js)
  function histMatcher() {
    var q0 = ($('b64-hist-q') || { value: '' }).value.trim();
    if (histRx && q0) { var c = window.TempDeskRegex.compile(q0, histRx.state); return { ok: c.ok, test: c.test }; }
    var q = q0, re = ($('b64-hist-re') || { getAttribute: function () { return 'false'; } }).getAttribute('aria-pressed') === 'true';
    if (!q) return { ok: true, test: function () { return true; }, empty: true };
    if (re) { try { var rx = new RegExp(q, 'i'); return { ok: true, test: function (x) { return rx.test(x); } }; } catch (e) { return { ok: false, test: function () { return false; } }; } }
    var words = q.toLowerCase().split(/\s+/);
    return { ok: true, test: function (x) { x = x.toLowerCase(); return words.every(function (w) { return x.indexOf(w) >= 0; }); } };
  }
  function drawHistory() {
    var ul = $('b64-hist');
    if (!ul || !hist) return;
    ul.replaceChildren();
    var m = histMatcher();
    $('b64-hist-q').setAttribute('aria-invalid', String(!m.ok));
    var list = hist.entries.slice().reverse().filter(function (e) { return m.test(msgText(e.msg) + ' ' + new Date(e.t).toLocaleString() + ' #' + e.id); });
    $('b64-hist-count').textContent = !m.ok ? t('palette.badRegex') : m.empty ? '' : t('search.listCount', [list.length, hist.entries.length]);
    list.slice(0, 300).forEach(function (e) {
      ul.appendChild(h('li', { class: e === hist.head() ? 'cur' : null }, [
        h('span', { class: 'msg' }, [h('span', { text: msgText(e.msg) }), h('br'), h('small', { text: new Date(e.t).toLocaleString() + ' · #' + e.id })]),
        e === hist.head() ? h('small', { text: t('hist.current') }) : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('hist.restoreBtn'), onclick: function () { var r = hist.restore(e.id); if (r) restoreState(r.state); updUndo(); } })
      ]));
    });
    hist.store.bytes().then(function (b) { $('b64-storage').textContent = t('hist.storage', [hist.entries.length, Math.ceil(b / 1024) + ' KB']); });
  }
  function clearHist() {
    var word = t('hist.clearWord');
    var dlg = h('div', { class: 'sheet center', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'bclr-h' });
    var inp = h('input', { type: 'text', id: 'bclr-in', autocomplete: 'off' });
    var cb = h('input', { type: 'checkbox' });
    var go = h('button', { type: 'button', class: 'btn btn-coral', disabled: true, text: t('hist.clearConfirm') });
    function chk() { go.disabled = !(cb.checked && inp.value.trim() === word); }
    inp.addEventListener('input', chk); cb.addEventListener('change', chk);
    go.addEventListener('click', function () { hist.clear().then(function () { S.closeSheet(dlg); dlg.remove(); S.toast(t('hist.cleared')); updUndo(); }); });
    dlg.appendChild(h('div', { class: 'sheet-panel' }, [h('h2', { id: 'bclr-h', text: t('hist.clearTitle') }), h('p', { text: t('hist.clearBody', [hist.entries.length, word]) }),
      h('label', { class: 'check' }, [cb, t('hist.clearUnderstand')]), h('div', { class: 'field' }, [h('label', { for: 'bclr-in', text: t('hist.clearType', [word]) }), inp]),
      h('div', { class: 'cta' }, [go, h('button', { type: 'button', class: 'btn btn-ghost', text: t('common.cancel'), onclick: function () { S.closeSheet(dlg); dlg.remove(); } })])]));
    document.body.appendChild(dlg); S.trap(dlg); S.openSheet(dlg, '#bclr-in');
  }

  // ---------- wire up ----------
  function init() {
    syncOpts();
    var deb;
    $('b64-in').addEventListener('input', function () { clearTimeout(deb); deb = setTimeout(function () { convert(true); }, 120); });
    ['b64-dir', 'b64-variant', 'b64-pad', 'b64-wrap', 'b64-linelen', 'b64-eol', 'b64-strict', 'b64-textenc'].forEach(function (id) { $(id).addEventListener('change', function () { syncOpts(); convert(true); if (hist) hist.flush(); }); });
    $('b64-swap').addEventListener('click', function () { $('b64-in').value = $('b64-out').value; $('b64-dir').value = $('b64-dir').value === 'encode' ? 'decode' : 'encode'; convert(true); if (hist) hist.flush(); });
    $('b64-clear').addEventListener('click', function () { $('b64-in').value = ''; convert(true); if (hist) hist.flush(); preview(null); });
    $('b64-paste').addEventListener('click', importClipboard);
    $('b64-copy').addEventListener('click', exportClipboard);
    $('b64-save').addEventListener('click', exportFile);
    $('b64-json').addEventListener('click', exportJson);
    $('b64-dataurl').addEventListener('click', buildDataUrl);
    $('b64-parse').addEventListener('click', parseDataUrl);
    $('b64-in-file').addEventListener('change', function () {
      var f = this.files[0]; this.value = '';
      if (!f) return;
      if (f.size > 8 * 1048576) { addFiles([f], $('b64-dir').value); S.toast(t('b64.bigToFiles')); return; }
      f.arrayBuffer().then(function (b) {
        var bytes = new Uint8Array(b);
        try { $('b64-in').value = $('b64-dir').value === 'encode' ? B.bytesToText(bytes, textEnc(), true) : B.bytesToText(bytes, 'latin1'); convert(true); }
        catch (e) { addFiles([f], $('b64-dir').value); S.toast(t('b64.binaryToFiles')); }
      });
    });
    $('b64-files-enc').addEventListener('change', function () { addFiles(this.files, 'encode'); this.value = ''; });
    $('b64-files-dec').addEventListener('change', function () { addFiles(this.files, 'decode'); this.value = ''; });
    var drop = $('b64-drop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drop-ok'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drop-ok'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, $('b64-drop-dir').value); });
    var keep = $('b64-keep'); keep.checked = keepPayload();
    keep.addEventListener('change', function () { LS.set('td.b64.keep', keep.checked ? '1' : '0'); });
    document.querySelectorAll('[data-b64-undo]').forEach(function (b) { b.addEventListener('click', undo); });
    document.querySelectorAll('[data-b64-redo]').forEach(function (b) { b.addEventListener('click', redo); });
    $('b64-hist-clear').addEventListener('click', clearHist);
    var htm;
    if (window.TempDeskRegex) {
      $('b64-hist-re').remove();
      histRx = window.TempDeskRegex.attachRegexBuilder($('b64-hist-q'), { t: S.rxT, onChange: drawHistory,
        sampleProvider: function () { return hist ? hist.entries.slice(-200).map(function (e) { return msgText(e.msg) + ' #' + e.id; }).join('\n') : ''; } });
    } else $('b64-hist-q').addEventListener('input', function () { clearTimeout(htm); htm = setTimeout(drawHistory, 120); });
    if ($('b64-hist-re')) $('b64-hist-re').addEventListener('click', function () { this.setAttribute('aria-pressed', String(this.getAttribute('aria-pressed') !== 'true')); drawHistory(); });
    $('b64-hist-export').addEventListener('click', function () { saveBlob('base64-history.json', new Blob([hist.exportJson({ app: 'base64-toolkit', payloadsStored: keepPayload() })], { type: 'application/json' })); });
    document.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      var inText = e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT');
      var k = e.key.toLowerCase();
      if (inText && !hist) return;
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    });
    document.addEventListener('focusout', function () { if (hist && hist.flush()) updUndo(); });
    drawJobs(); counts();
    HI.openStore('base64').then(function (store) {
      hist = new HI.History({ store: store, initial: { tool: 'text', dir: 'encode', opts: optsSnapshot(), inLen: 0, outLen: 0, input: '' }, redact: function (s) { if (!keepPayload()) { s = JSON.parse(JSON.stringify(s)); delete s.input; } return s; }, onChange: function () {} });
      return hist.load();
    }).then(function () { restoreState(hist.head().state); updUndo(); }).catch(function () { hist = null; updUndo(); });
    S.onLang(function () { drawJobs(); counts(); drawHistory(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
