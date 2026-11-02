// Base64 toolkit page. Runs entirely in the browser: nothing is uploaded.
(function () {
  'use strict';
  var doc = document, TD = window.TD || {}, B = window.TDBase64;
  var app = doc.querySelector('[data-b64-app]'); if (!app || !B) return;
  var t = TD.t || function (k) { return k; };
  function $(s) { return doc.querySelector(s); }
  var inp = $('#b64-in'), out = $('#b64-out'), err = $('[data-b64-error]');
  var alpha = $('#b64-alpha'), wrapSel = $('#b64-wrap'), len = $('#b64-len'), cs = $('#b64-charset'), pad = $('#b64-pad'), strict = $('#b64-strict');
  var typeEl = $('[data-b64-type]'), prev = $('[data-b64-preview]'), histEl = $('[data-b64-history]'), keep = $('#b64-keep');
  var progress = $('[data-b64-progress]'), status = $('[data-b64-status]'), filesEl = $('[data-b64-files]');
  var btn = function (n) { return app.querySelector('[data-b64="' + n + '"]'); };
  var lastBytes = null, results = [], job = null;
  var store = TD.store || { get: function () { return null; }, set: function () {} };

  function dir() { return app.querySelector('input[name="b64dir"]:checked').value; }
  function opts() {
    var w = wrapSel.value === 'custom' ? parseInt(len.value, 10) || 0 : parseInt(wrapSel.value, 10);
    return { alphabet: alpha.value, pad: pad.checked, lineLength: w, eol: '\r\n', strict: strict.checked };
  }
  wrapSel.addEventListener('change', function () { app.querySelector('[data-b64-custom]').hidden = wrapSel.value !== 'custom'; });

  // Undo / redo of input+output states (unlimited, in memory; persisted only when opted in).
  var undo = [], redo = [];
  try { if (store.get('td.b64.keep') === '1') { keep.checked = true; undo = JSON.parse(store.get('td.b64.hist') || '[]'); } } catch (e) { undo = []; }
  keep.addEventListener('change', function () { store.set('td.b64.keep', keep.checked ? '1' : '0'); if (!keep.checked) store.set('td.b64.hist', '[]'); persist(); });
  function persist() { if (keep.checked) store.set('td.b64.hist', JSON.stringify(undo.slice(-200))); renderHist(); }
  function snapshot(label) {
    undo.push({ label: label, time: Date.now(), input: keep.checked ? inp.value : null, output: keep.checked ? out.value : null, mem: { input: inp.value, output: out.value } });
    redo = []; persist();
  }
  function restore(s) { var src = s.mem || s; inp.value = src.input || ''; out.value = src.output || ''; }
  btn('undo').addEventListener('click', function () { if (undo.length < 2) { return; } redo.push(undo.pop()); restore(undo[undo.length - 1]); renderHist(); });
  btn('redo').addEventListener('click', function () { var s = redo.pop(); if (!s) return; undo.push(s); restore(s); renderHist(); });
  btn('clearhist').addEventListener('click', function () { undo = []; redo = []; store.set('td.b64.hist', '[]'); renderHist(); });
  function renderHist() {
    histEl.textContent = '';
    undo.slice(-20).reverse().forEach(function (h) { var li = doc.createElement('li'); li.textContent = new Date(h.time).toLocaleTimeString() + ' ' + h.label; histEl.appendChild(li); });
  }
  app.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.target !== inp) {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); btn('undo').click(); }
      if (e.key.toLowerCase() === 'y') { e.preventDefault(); btn('redo').click(); }
    }
  });

  function showError(e) { err.textContent = e ? (e.message || String(e)) : ''; if (e && typeof e.offset === 'number' && dir() === 'decode') { try { inp.focus(); inp.setSelectionRange(e.offset, e.offset + 1); } catch (x) { /* ignore */ } } }
  function preview(bytes) {
    lastBytes = bytes;
    var d = B.detect(bytes);
    typeEl.textContent = d.label + ' (' + d.mime + '), ' + bytes.length + ' bytes';
    prev.textContent = '';
    if (/^image\/(png|jpeg|gif|webp)$/.test(d.mime) && bytes.length < 8 * 1024 * 1024) {
      // Images are shown through an <img> element only: never as a document.
      var img = doc.createElement('img'); img.alt = t('Preview'); img.style.maxWidth = '100%';
      img.src = URL.createObjectURL(new Blob([bytes], { type: d.mime })); prev.appendChild(img);
    } else if (d.text) {
      prev.textContent = B.bytesToText(bytes.subarray(0, 20000), cs.value);
    } else {
      var hex = []; for (var i = 0; i < Math.min(bytes.length, 512); i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
      prev.textContent = hex.join(' ');
    }
    return d;
  }
  function run() {
    showError(null);
    try {
      var o = opts();
      if (dir() === 'encode') { var b = B.textToBytes(inp.value, cs.value); out.value = B.encode(b, o); preview(b); }
      else { var bytes = B.decode(inp.value, o); var d = preview(bytes); out.value = d.text ? B.bytesToText(bytes, cs.value) : '[' + d.label + ', ' + bytes.length + ' bytes: use Save as file]'; }
      snapshot(dir() === 'encode' ? t('Encode') : t('Decode'));
    } catch (e) { showError(e); }
  }
  btn('run').addEventListener('click', run);
  btn('paste').addEventListener('click', function () {
    if (!navigator.clipboard || !navigator.clipboard.readText) { showError(new Error('Clipboard reading is not available here. Paste with Ctrl+V instead.')); inp.focus(); return; }
    navigator.clipboard.readText().then(function (s) { inp.value = s; snapshot(t('Paste from clipboard')); }, function () { showError(new Error('Clipboard access was refused. Paste with Ctrl+V instead.')); });
  });
  btn('copy').addEventListener('click', function () { TD.copyText(out.value).then(function () { TD.toast(t('Copied'), 'success'); }, function () { TD.toast(t('Copy failed'), 'error'); }); });
  function saveBlob(blob, name) { var a = doc.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; doc.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  btn('save').addEventListener('click', function () {
    if (dir() === 'decode' && lastBytes) saveBlob(new Blob([lastBytes], { type: 'application/octet-stream' }), 'decoded.bin');
    else saveBlob(new Blob([out.value], { type: 'text/plain' }), 'encoded.b64.txt');
  });
  btn('dataurl').addEventListener('click', function () {
    showError(null);
    try {
      var bytes = lastBytes || B.textToBytes(inp.value, cs.value);
      var mime = B.detect(bytes).mime;
      out.value = B.buildDataUrl(mime, B.encode(bytes, { alphabet: 'standard', pad: true })); snapshot(t('Make data: URL'));
    } catch (e) { showError(e); }
  });
  btn('parseurl').addEventListener('click', function () {
    showError(null);
    try { var p = B.parseDataUrl(inp.value); var d = preview(p.bytes); out.value = d.text ? B.bytesToText(p.bytes, cs.value) : '[' + p.mime + ', ' + p.bytes.length + ' bytes]'; snapshot(t('Parse data: URL')); }
    catch (e) { showError(e); }
  });
  btn('json').addEventListener('click', function () {
    var rec = { tool: 'TempDesk Base64', direction: dir(), alphabet: alpha.value, padding: pad.checked, lineLength: opts().lineLength, charset: cs.value, input: inp.value, output: out.value, created: new Date().toISOString() };
    saveBlob(new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' }), 'base64-record.json');
  });

  // ---------------------------------------------------------- files: streamed in chunks with progress, pause, cancel
  var CHUNK = 3 * 1024 * 1024; // multiple of 3 keeps chunk boundaries clean
  function sha256(buf) { return crypto.subtle ? crypto.subtle.digest('SHA-256', buf).then(function (h) { return Array.prototype.map.call(new Uint8Array(h), function (x) { return x.toString(16).padStart(2, '0'); }).join(''); }) : Promise.resolve(''); }
  function setBusy(on) { btn('pause').disabled = !on; btn('cancel').disabled = !on; }
  function processFile(file) {
    return new Promise(function (resolve, reject) {
      var encoding = dir() === 'encode', o = opts(), offset = 0, parts = [], enc = B.createEncoder(o), decodedChunks = [];
      job = { paused: false, cancelled: false, resume: null };
      var textCarry = '';
      function step() {
        if (job.cancelled) { reject(new Error('Cancelled')); return; }
        if (job.paused) { job.resume = step; return; }
        if (offset >= file.size) { finish(); return; }
        var slice = file.slice(offset, offset + CHUNK);
        slice.arrayBuffer().then(function (buf) {
          var bytes = new Uint8Array(buf);
          if (encoding) parts.push(enc.push(bytes));
          else {
            var txt = textCarry + new TextDecoder('latin1').decode(bytes).replace(/[\s]/g, '');
            var usable = txt.length - (txt.length % 4); if (offset + CHUNK >= file.size) usable = txt.length;
            textCarry = txt.slice(usable);
            decodedChunks.push(B.decode(txt.slice(0, usable), { strict: o.strict }));
          }
          offset += bytes.length;
          progress.style.width = Math.round(offset / file.size * 100) + '%';
          status.textContent = file.name + ': ' + Math.round(offset / file.size * 100) + '%';
          setTimeout(step, 0);
        }, reject);
      }
      function finish() {
        if (encoding) {
          parts.push(enc.finish());
          var text = parts.join('');
          // SHA-256 round trip: decode the output again and compare with the original file.
          Promise.all([file.arrayBuffer().then(sha256), sha256(B.decode(text, { strict: false }))]).then(function (h) {
            resolve({ name: file.name + '.b64.txt', blob: new Blob([text], { type: 'text/plain' }), verified: h[0] === h[1], hash: h[0], text: text.length < 2000000 ? text : null });
          });
        } else {
          var total = decodedChunks.reduce(function (a, c) { return a + c.length; }, 0), all = new Uint8Array(total), at = 0;
          decodedChunks.forEach(function (c) { all.set(c, at); at += c.length; });
          sha256(all).then(function (h) { resolve({ name: file.name.replace(/\.(b64|txt)+$/i, '') + '.bin', blob: new Blob([all]), verified: true, hash: h, bytes: all }); });
        }
      }
      step();
    });
  }
  btn('pause').addEventListener('click', function () {
    if (!job) return; job.paused = !job.paused; btn('pause').textContent = job.paused ? t('Resume') : t('Pause');
    if (!job.paused && job.resume) { var r = job.resume; job.resume = null; r(); }
  });
  btn('cancel').addEventListener('click', function () { if (job) { job.cancelled = true; if (job.resume) { var r = job.resume; job.resume = null; r(); } } });
  $('#b64-file').addEventListener('change', function (e) {
    var files = Array.prototype.slice.call(e.target.files || []); if (!files.length) return;
    results = []; filesEl.textContent = ''; setBusy(true); showError(null);
    files.reduce(function (p, f) {
      return p.then(function () {
        return processFile(f).then(function (res) {
          results.push(res);
          var li = doc.createElement('li'); li.textContent = res.name + (res.verified ? ' (SHA-256 verified)' : ' (verification FAILED)');
          var a = doc.createElement('button'); a.type = 'button'; a.className = 'btn sm text'; a.textContent = t('Save as file');
          a.addEventListener('click', function () { saveBlob(res.blob, res.name); }); li.appendChild(a); filesEl.appendChild(li);
          if (res.text) { inp.value = ''; out.value = res.text; }
          if (res.bytes) preview(res.bytes);
        });
      });
    }, Promise.resolve()).then(function () { status.textContent = t('Done') + ': ' + results.length; snapshot(t('Open a file')); btn('zip').disabled = results.length < 1; },
      function (er) { showError(er); status.textContent = er.message; })
      .finally(function () { setBusy(false); job = null; e.target.value = ''; });
  });
  btn('zip').addEventListener('click', function () {
    if (!window.TempDeskZip || !results.length) return;
    Promise.all(results.map(function (r) { return r.blob.arrayBuffer().then(function (b) { return { name: r.name, data: new Uint8Array(b) }; }); }))
      .then(function (files) { saveBlob(window.TempDeskZip.makeZip(files), 'base64-files.zip'); });
  });
  app.addEventListener('dragover', function (e) { e.preventDefault(); });
  app.addEventListener('drop', function (e) {
    e.preventDefault(); var dt = e.dataTransfer; if (!dt || !dt.files.length) return;
    var input = $('#b64-file'); try { input.files = dt.files; input.dispatchEvent(new Event('change')); } catch (x) { showError(x); }
  });
  renderHist();
  snapshot(t('Start'));
})();
