// Tools > Base64. Text conversions run in the renderer with the shared codec (site/assets/base64.js).
// Files of any size are streamed in the main process (constant memory, progress, pause, resume,
// cancel, SHA-256 round-trip verification, atomic output). Every conversion is a history entry
// committed to the workspace; payloads are stored only when the user opts in.
import { h, t, btn, toast, dialog, superConfirm, searchBox, field, select, contextMenu, play, fmtBytes, fmtTime } from './ui.js';

const td = window.td;
const B = window.TempDeskBase64;
const Core = window.TempDeskCore;
const st = { input: '', output: '', mode: 'encode', variant: 'standard', pad: true, lineLength: 0, strict: true, enc: 'utf-8', keepPayloads: false, file: null, job: null };

function encodeOpts() { return { variant: st.variant === 'mime' ? 'standard' : st.variant, pad: st.pad, lineLength: st.variant === 'mime' ? (st.lineLength || 76) : st.lineLength, eol: '\r\n' }; }

async function record(action, meta) {
  const entry = { time: new Date().toISOString(), action, mode: st.mode, variant: st.variant, pad: st.pad, lineLength: st.lineLength, strict: st.strict, encoding: st.enc, inputLength: st.input.length, outputLength: st.output.length };
  Object.assign(entry, meta || {});
  if (st.keepPayloads) { entry.input = st.input.slice(0, 100000); entry.output = st.output.slice(0, 100000); }
  const cur = (await td.invoke['ws:get']('tools/base64.json')) || { schema: 'tempdesk-base64-history', entries: [] };
  cur.entries = [entry].concat(cur.entries || []).slice(0, 1000);
  await td.invoke['ws:save']('tools/base64.json', cur, t('b64.hist.' + action, [entry.inputLength]));
  window.TempDeskApp.refreshUndo();
}

export async function base64Page(root, app) {
  root.appendChild(h('div', { class: 'page-head' }, [h('div', null, [h('div', { class: 'kicker', text: t('nav.base64.kicker') }), h('h1', { text: t('b64.title') }), h('p', { class: 'muted', text: t('b64.lead') })])]));
  const inArea = h('textarea', { rows: '8', spellcheck: 'false', 'aria-label': t('b64.input'), value: st.input });
  const outArea = h('textarea', { rows: '8', spellcheck: 'false', readonly: true, 'aria-label': t('b64.output'), value: st.output });
  const err = h('div', { class: 'err', role: 'alert' });
  const typeLine = h('div', { class: 'small muted', 'aria-live': 'polite' });
  const preview = h('div', { class: 'preview-box', hidden: true, 'aria-label': t('b64.preview') });
  let coalesce = null;
  function convert(commit) {
    err.textContent = ''; st.input = inArea.value;
    try {
      if (st.mode === 'encode') {
        st.output = B.encode(B.textToBytes(st.input, st.enc), encodeOpts());
        typeLine.textContent = t('b64.encLen', [st.output.length]);
        preview.hidden = true;
      } else if (/^data:/i.test(st.input.trim())) {
        const p = B.parseDataUrl(st.input, { strict: st.strict });
        showBytes(p.bytes, p.mime);
      } else {
        const bytes = B.decode(st.input, { variant: st.variant === 'url' ? 'url' : st.variant === 'mime' ? 'mime' : 'standard', strict: st.strict });
        showBytes(bytes);
      }
    } catch (e) {
      st.output = '';
      err.textContent = e.offset !== undefined ? t('b64.err.' + (e.code || 'generic'), [e.offset, e.char || '']) : t('b64.err.generic', [e.message]);
      typeLine.textContent = '';
    }
    outArea.value = st.output;
    if (commit !== false) { clearTimeout(coalesce); coalesce = setTimeout(() => record(st.mode === 'encode' ? 'encodeText' : 'decodeText'), 1000); }
  }
  // Safe preview: images through an <img> from a blob URL; text as text; nothing is executed or opened.
  function showBytes(bytes, declared) {
    const type = B.detectType(bytes);
    st.lastBytes = bytes; st.lastType = type;
    typeLine.textContent = t('b64.detected', [type.mime, fmtBytes(bytes.length)]) + (declared && declared !== type.mime ? ' · ' + t('b64.declared', [declared]) : '');
    preview.hidden = false; preview.replaceChildren();
    if (type.kind === 'image' && type.mime !== 'image/svg+xml') {
      const url = URL.createObjectURL(new Blob([bytes], { type: type.mime }));
      const img = h('img', { src: url, alt: t('b64.imageAlt', [type.mime]) }); img.onload = () => URL.revokeObjectURL(url);
      preview.appendChild(img);
      st.output = t('b64.binaryOut', [fmtBytes(bytes.length)]);
    } else if (type.kind === 'text') {
      try { st.output = B.bytesToText(bytes, st.enc, true); } catch (e) { st.output = B.bytesToText(bytes, st.enc, false); }
      preview.appendChild(h('pre', { text: st.output.slice(0, 20000) }));
    } else { st.output = t('b64.binaryOut', [fmtBytes(bytes.length)]); preview.appendChild(h('pre', { text: B.hexDump(bytes, 1024) })); }
  }
  inArea.addEventListener('input', () => convert());
  inArea.addEventListener('blur', () => { clearTimeout(coalesce); if (st.input) record(st.mode === 'encode' ? 'encodeText' : 'decodeText'); });
  const modeSeg = h('div', { class: 'row', role: 'group', 'aria-label': t('b64.mode') }, ['encode', 'decode'].map((m) => h('button', { type: 'button', class: 'btn btn-sm ' + (st.mode === m ? 'btn-primary' : 'btn-ghost'), 'aria-pressed': String(st.mode === m), onclick: () => { st.mode = m; app.render(); } }, [t('b64.' + m)])));
  const opts = h('div', { class: 'fields2' }, [
    field({ label: t('b64.variant'), info: 'info.b64variant', control: select([['standard', t('b64.v.standard')], ['url', t('b64.v.url')], ['mime', t('b64.v.mime')]], st.variant, (v) => { st.variant = v; if (v === 'url') st.pad = false; convert(false); }) }),
    field({ label: t('b64.lineLength'), info: 'info.b64line', control: (() => { const i = h('input', { type: 'number', min: '0', max: '1000', step: '4', value: String(st.lineLength) }); i.addEventListener('input', () => { st.lineLength = Math.max(0, parseInt(i.value, 10) || 0); convert(false); }); return i; })() }),
    field({ label: t('b64.encoding'), info: 'info.b64enc', control: select([['utf-8', 'UTF-8'], ['utf-16le', 'UTF-16 LE'], ['utf-16be', 'UTF-16 BE'], ['latin1', 'Latin-1']], st.enc, (v) => { st.enc = v; convert(false); }) }),
    h('div', { class: 'stack' }, [
      h('label', { class: 'check' }, [(() => { const c = h('input', { type: 'checkbox', checked: st.pad }); c.addEventListener('change', () => { st.pad = c.checked; convert(false); }); return c; })(), t('b64.pad')]),
      h('label', { class: 'check' }, [(() => { const c = h('input', { type: 'checkbox', checked: st.strict }); c.addEventListener('change', () => { st.strict = c.checked; convert(false); }); return c; })(), t('b64.strict')]),
      h('label', { class: 'check' }, [(() => { const c = h('input', { type: 'checkbox', checked: st.keepPayloads }); c.addEventListener('change', () => { st.keepPayloads = c.checked; }); return c; })(), t('b64.keep')])])
  ]);
  const actions = h('div', { class: 'row' }, [
    btn(t('b64.paste'), async () => { inArea.value = await td.invoke['clipboard:read'](); convert(); }, 'btn-ghost btn-sm'),
    btn(t('b64.copy'), () => { td.invoke['clipboard:write'](outArea.value); toast(t('common.copied')); record('copy'); }, 'btn-ghost btn-sm'),
    btn(t('b64.dataUrl'), () => { const bytes = st.mode === 'encode' ? B.textToBytes(st.input, st.enc) : st.lastBytes; if (!bytes) return; const mime = st.mode === 'encode' ? 'text/plain' : (st.lastType || {}).mime; const u = B.buildDataUrl(bytes, mime, st.mode === 'encode' && st.enc === 'utf-8' ? { charset: 'utf-8' } : null); td.invoke['clipboard:write'](u); toast(t('b64.dataUrlCopied')); record('dataUrl'); }, 'btn-ghost btn-sm'),
    btn(t('b64.saveOut'), async () => {
      const isBin = st.mode === 'decode' && st.lastBytes && (st.lastType || {}).kind !== 'text';
      const name = isBin ? B.suggestName('decoded', st.lastType) : st.mode === 'encode' ? 'encoded.b64' : 'decoded.txt';
      const r = await td.invoke['file:save'](isBin ? { name, base64: B.encode(st.lastBytes) } : { name, text: st.output });
      if (r.ok) { toast(t('export.saved', [r.path]), 'success'); record('saveFile'); }
    }, 'btn-ghost btn-sm'),
    btn(t('b64.json'), async () => { const r = await td.invoke['file:save']({ name: 'base64-record.json', text: JSON.stringify({ schema: 'tempdesk-base64-record', version: 1, created: new Date().toISOString(), mode: st.mode, variant: st.variant, padding: st.pad, lineLength: st.lineLength, encoding: st.enc, input: st.input, output: st.output }, null, 2) + '\n' }); if (r.ok) toast(t('export.saved', [r.path]), 'success'); }, 'btn-ghost btn-sm'),
    btn(t('b64.swap'), () => { inArea.value = st.mode === 'encode' ? st.output : st.input; st.mode = st.mode === 'encode' ? 'decode' : 'encode'; st.input = inArea.value; app.render(); }, 'btn-ghost btn-sm')
  ]);
  root.appendChild(h('div', { class: 'card' }, [h('div', { class: 'row between' }, [h('h2', { text: t('b64.text'), style: { margin: 0 } }), modeSeg]), opts,
    h('div', { class: 'cols' }, [h('div', { class: 'grow' }, [h('label', { class: 'lab', text: t('b64.input') }), inArea]), h('div', { class: 'grow' }, [h('label', { class: 'lab', text: t('b64.output') }), outArea])]), err, typeLine, actions, preview]));

  // Files
  const fileInfo = h('div', { class: 'small', 'aria-live': 'polite', text: st.file ? st.file.name + ' · ' + fmtBytes(st.file.size) : t('b64.noFile') });
  const bar = h('i');
  const barWrap = h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': t('b64.fileProgress') }, [bar]);
  const jobStatus = h('div', { class: 'small muted', role: 'status' });
  const pauseB = btn(t('b64.pause'), () => { if (!st.job) return; if (pauseB.dataset.p === '1') { td.invoke['b64:resume'](st.job); pauseB.dataset.p = '0'; pauseB.textContent = t('b64.pause'); } else { td.invoke['b64:pause'](st.job); pauseB.dataset.p = '1'; pauseB.textContent = t('b64.resume'); } }, 'btn-ghost btn-sm', { disabled: true });
  const cancelB = btn(t('run.cancel'), () => st.job && td.invoke['b64:cancel'](st.job), 'btn-ghost btn-sm', { disabled: true });
  let outDir = null;
  async function useFile(f) {
    if (!f) return;
    st.file = f;
    const type = B.detectType(f.head);
    fileInfo.textContent = t('b64.fileInfo', [f.name, fmtBytes(f.size), type.mime]);
    if (/\.(b64|base64|txt)$/i.test(f.name)) { st.mode = 'decode'; }
  }
  app.onBase64Drop = async (file) => { const p = td.pathForFile(file); if (!p) { toast(t('b64.dropFailed'), 'error'); return; } await useFile(await td.invoke['b64:stat'](p)); };
  async function startJob(overwrite) {
    if (!st.file) { toast(t('b64.noFile'), 'error'); return; }
    const opts = { source: st.file.path, mode: st.mode, variant: st.variant === 'mime' ? 'standard' : st.variant, pad: st.pad, lineLength: st.variant === 'mime' ? (st.lineLength || 76) : st.lineLength, strict: st.strict, outDir, overwrite: !!overwrite };
    const r = await td.invoke['b64:start'](opts);
    if (r.exists) {
      const ok = await superConfirm({ title: t('b64.overwriteTitle'), danger: t('b64.overwriteWarn', [r.dest]), word: r.dest.split(/[\\/]/).pop(), action: t('b64.overwriteHold') });
      if (ok) startJob(true);
      return;
    }
    st.job = r.id; st.started = Date.now();
    pauseB.disabled = false; cancelB.disabled = false; jobStatus.textContent = t('b64.working');
  }
  td.on['b64:event']((ev) => {
    if (ev.job !== st.job) return;
    if (ev.type === 'progress') { const p = ev.total ? Math.round(ev.done / ev.total * 100) : 0; bar.style.width = p + '%'; barWrap.setAttribute('aria-valuenow', String(p)); jobStatus.textContent = t('b64.progress', [fmtBytes(ev.done), fmtBytes(ev.total)]); }
    else if (ev.type === 'verifying') jobStatus.textContent = t('b64.verifying');
    else if (ev.type === 'paused') jobStatus.textContent = t('b64.paused');
    else if (ev.type === 'done') {
      bar.style.width = '100%'; st.job = null; pauseB.disabled = true; cancelB.disabled = true;
      jobStatus.textContent = t('b64.fileDone', [ev.dest, ev.sha256.slice(0, 16)]);
      toast(t('b64.fileDoneToast', [ev.dest]), 'success'); play('done');
      record(st.mode === 'encode' ? 'encodeFile' : 'decodeFile', { file: st.file.name, bytesIn: ev.bytesIn, bytesOut: ev.bytesOut, sha256: ev.sha256 });
    } else if (ev.type === 'error') {
      st.job = null; pauseB.disabled = true; cancelB.disabled = true; bar.style.width = '0';
      jobStatus.textContent = ev.code === 'cancelled' ? t('run.cancelled') : (ev.offset !== undefined ? t('b64.err.' + ev.code, [ev.offset, '']) : t('b64.err.generic', [ev.message]));
      if (ev.code !== 'cancelled') toast(jobStatus.textContent, 'error');
    }
  });
  const dirLine = h('span', { class: 'small muted', text: t('b64.outNext') });
  root.appendChild(h('div', { class: 'card' }, [h('h2', { text: t('b64.files') }), h('p', { class: 'small muted', text: t('b64.filesLead') }), fileInfo,
    h('div', { class: 'row' }, [btn(t('b64.pick'), async () => useFile(await td.invoke['b64:pick']()), 'btn-ghost'), btn(t('b64.outDir'), async () => { outDir = await td.invoke['file:pickFolder'](); dirLine.textContent = outDir ? t('b64.outIn', [outDir]) : t('b64.outNext'); }, 'btn-ghost'), dirLine]),
    h('div', { class: 'row' }, [btn(st.mode === 'encode' ? t('b64.encodeFile') : t('b64.decodeFile'), () => startJob(false), 'btn-primary'), pauseB, cancelB]), barWrap, jobStatus]));

  // History with search, undo/redo through the workspace, and bulk export
  const hist = (await td.invoke['ws:get']('tools/base64.json')) || { entries: [] };
  const list = h('div', { class: 'list' });
  let matcher = null;
  const textOf = (e) => [e.action, e.mode, e.variant, e.file || '', e.encoding].join(' ');
  function draw() {
    const shown = (hist.entries || []).filter((e) => !matcher || Core.testMatch(textOf(e), matcher));
    list.replaceChildren(...shown.slice(0, 200).map((e) => {
      const it = h('div', { class: 'item', tabindex: '0' }, [h('div', { class: 'grow' }, [h('div', { class: 'title', text: t('b64.hist.' + e.action, [e.inputLength]) + (e.file ? ' · ' + e.file : '') }), h('div', { class: 'sub', text: fmtTime(e.time) + ' · ' + e.variant + (e.sha256 ? ' · SHA-256 ' + e.sha256.slice(0, 12) : '') + (e.input !== undefined ? ' · ' + t('b64.payloadKept') : '') })])]);
      contextMenu(it, () => [{ label: t('b64.reuse'), run: () => { if (e.input !== undefined) { st.input = e.input; st.mode = e.mode; app.render(); } else toast(t('b64.noPayload')); }, disabled: e.input === undefined }, { label: t('common.copy'), run: () => td.invoke['clipboard:write'](JSON.stringify(e)) }]);
      return it;
    }));
    if (!shown.length) list.appendChild(h('div', { class: 'empty', text: (hist.entries || []).length ? t('hist.noMatch') : t('b64.histEmpty') }));
  }
  const sb = searchBox({ label: t('b64.histSearch'), onChange: (m) => { matcher = m.ok && !m.empty ? m : null; draw(); }, count: (m) => Core.countMatches((hist.entries || []).map(textOf), m) });
  root.appendChild(h('div', { class: 'card' }, [h('div', { class: 'row between' }, [h('h2', { text: t('b64.history'), style: { margin: 0 } }), h('div', { class: 'row' }, [
    btn(t('hist.undo'), () => window.TempDeskApp.undo(), 'btn-ghost btn-sm'), btn(t('hist.redo'), () => window.TempDeskApp.redo(), 'btn-ghost btn-sm'),
    btn(t('b64.bulk'), async () => {
      const entries = (hist.entries || []).filter((e) => e.output !== undefined);
      if (!entries.length) { toast(t('b64.bulkNone')); return; }
      const files = entries.map((e, i) => ({ name: String(i + 1).padStart(4, '0') + '-' + e.mode + '.txt', text: e.output }));
      files.push({ name: 'records.json', text: JSON.stringify(entries, null, 2) + '\n' });
      const r = await td.invoke['file:zip']({ name: 'base64-export.zip', files });
      if (r.ok) toast(t('export.saved', [r.path]), 'success');
    }, 'btn-ghost btn-sm')])]), sb, list]));
  draw();
  if (st.input) convert(false);
}
void dialog;
