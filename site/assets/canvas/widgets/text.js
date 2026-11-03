// Text widgets: text (with formats), password, path, command-line, url, email, registry-path,
// account-picker, color, file (logo BMP check), multiline, string-list and key-value.
import { h, textInput, toolButton, flash, presetChips, nextId, copyText } from './base.js';
import { checkPath, FOLDER_VARS, expandVars, commandTokens, quoteArg, checkUrl, checkEmail, checkRegistryPath, expandHive, checkFormat, splitList, joinList, splitRows, joinRows, parseColor, formatColor, cssHex, hexToRgb, lightness, bmpSize } from './format.js';
import { ACCOUNTS, COMMAND_SNIPPETS } from './data.js';
import { comboboxSearch } from './choice.js';

const S = (v) => (v === undefined ? '' : String(v));
function plainInput(ctx, extra) {
  let cur = S(ctx.value);
  const inp = textInput(Object.assign({ id: ctx.id, value: cur, describedBy: ctx.describedBy, maxLength: ctx.hint.maxLength, placeholder: ctx.hint.example ? ctx.t('w.eg', [ctx.hint.example], 'e.g. {0}') : '' }, extra || {}));
  const api = { input: inp, get: () => cur, set(v) { cur = S(v); inp.value = cur; } };
  inp.addEventListener('input', () => { cur = inp.value; ctx.onChange(cur === '' ? undefined : cur); if (api.after) api.after(); });
  return api;
}

// ---- text -----------------------------------------------------------------------------------------
export const text = {
  create(ctx) {
    const mono = !!ctx.hint.format || /Name$|Id$|ID$|Key$|Identifier$/.test(ctx.setting ? ctx.setting.name : '');
    const p = plainInput(ctx, { mono });
    const count = ctx.hint.maxLength ? h('span', { class: 'w-count', 'aria-live': 'off' }) : null;
    const draw = () => { if (count) { const n = p.get().length; count.textContent = n + ' / ' + ctx.hint.maxLength; count.classList.toggle('over', n > ctx.hint.maxLength); } };
    p.after = draw; draw();
    const el = h('div', { class: 'w-text' }, [h('div', { class: 'w-affix' }, [p.input, count]), presetChips(ctx.hint.presets, (v) => { p.set(v); flash(p.input); ctx.onChange(v); draw(); }, ctx.t)]);
    return { el, input: p.input, set(v) { p.set(v); draw(); } };
  },
  validate(v, hint, t) {
    if (v === undefined || v === '') return '';
    if (hint.maxLength && String(v).length > hint.maxLength) return t('w.errLong', [hint.maxLength], 'At most {0} characters.');
    const e = hint.format ? checkFormat(hint.format, v) : '';
    return e ? t('w.err.' + e, null, e) : '';
  },
  describe(v, hint, t) { return v === undefined || v === '' ? '' : hint.format === 'computername' && v === '*' ? t('w.cnRandom', null, 'Windows makes a random name.') : ''; }
};

// ---- password (never written to history or the search index) -------------------------------------
export const password = {
  create(ctx) {
    const { t, hint, A } = ctx;
    let cur = S(ctx.value);
    const inp = h('input', { type: 'password', id: ctx.id, class: 'w-input mono', value: cur, autocomplete: 'new-password', spellcheck: 'false', autocapitalize: 'off', 'aria-describedby': (ctx.describedBy || '') + ' ' + ctx.id + '-st' });
    const meter = h('div', { class: 'meter w-pwmeter', 'aria-hidden': 'true' }, [h('i')]);
    const lab = h('div', { class: 'meter-label', id: ctx.id + '-st', 'aria-live': 'polite' });
    const draw = () => {
      if (!A || !A.passwordStrength) { lab.textContent = ''; return; }
      const s = A.passwordStrength(cur);
      meter.dataset.score = s.score; meter.firstChild.style.width = (cur ? (s.score + 1) * 20 : 0) + '%';
      lab.textContent = cur ? t('pw.' + s.code) + ' (' + t('pw.bits', [s.bits]) + ')' + (s.meetsPolicy ? '' : ' \u00b7 ' + t('pw.policy')) : '';
    };
    inp.addEventListener('input', () => { cur = inp.value; draw(); ctx.onChange(cur === '' ? undefined : cur, { secret: true }); });
    const show = toolButton('', t('pw.show', null, 'Show or hide'), () => { inp.type = inp.type === 'password' ? 'text' : 'password'; show.setAttribute('aria-pressed', String(inp.type === 'text')); }, { 'aria-pressed': 'false', html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' });
    const gen = toolButton('', t('pw.generate', null, 'Generate a strong password'), () => {
      if (!A || !A.generatePassword) return;
      cur = A.generatePassword(20); inp.value = cur; inp.type = 'text'; show.setAttribute('aria-pressed', 'true'); draw(); flash(inp);
      ctx.onChange(cur, { secret: true, generated: true });
      if (ctx.announce) ctx.announce(t('pw.generated', null, 'A new strong password was generated and is shown.'));
    }, { html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>' });
    draw();
    const note = hint.storage === 'plain' ? h('p', { class: 'w-note warn', text: t('w.plainSecret', null, 'Written in plain text in the answer file. Use a low-privilege account.') }) : h('p', { class: 'w-note', text: t('w.encodedSecret', null, 'Written with the Windows unattend encoding (base64, not encryption). Never kept in history unless you allow it.') });
    return { el: h('div', { class: 'w-pw' }, [h('div', { class: 'w-row' }, [inp, show, gen]), meter, lab, note]), input: inp, set(v) { cur = S(v); inp.value = cur; draw(); } };
  },
  describe(v, hint, t) { return v === undefined || v === '' ? t('w.pwEmpty', null, 'No password is written.') : t('w.pwSet', null, 'A password is set (hidden).'); }
};

// ---- path -----------------------------------------------------------------------------------------
const CHIPS = ['%SystemDrive%', '%WINDIR%', '%ProgramFiles%', '%ProgramData%', '%PUBLIC%', '%USERPROFILE%', '%TEMP%'];
export const path = {
  create(ctx) {
    const { t } = ctx;
    const p = plainInput(ctx, { mono: true });
    const preview = h('div', { class: 'w-preview mono', 'aria-live': 'polite' });
    const draw = () => { const v = p.get(); const x = expandVars(v); preview.textContent = v && x !== v ? '\u2192 ' + x : ''; };
    p.after = draw;
    const insert = (chip) => {
      const inp = p.input, s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? s;
      const add = chip + (/\\$/.test(chip) ? '' : '\\');
      inp.value = inp.value.slice(0, s) + add + inp.value.slice(e);
      p.set(inp.value); inp.focus(); inp.setSelectionRange(s + add.length, s + add.length); draw(); flash(inp); ctx.onChange(inp.value);
    };
    const chips = h('div', { class: 'w-chips', role: 'group', 'aria-label': t('w.folders', null, 'Common folders') }, CHIPS.map((c) => h('button', { type: 'button', class: 'w-chip mono', title: FOLDER_VARS[c], onclick: () => insert(c) }, [c])));
    draw();
    return { el: h('div', { class: 'w-path' }, [p.input, chips, preview]), input: p.input, set(v) { p.set(v); draw(); } };
  },
  validate(v, hint, t) { const e = checkPath(v); return e ? t('w.err.' + e, null, e) : ''; },
  describe(v, hint, t) { if (v === undefined || v === '') return ''; const x = expandVars(v); return x !== v ? t('w.pathIs', [x], 'Usually {0}') : ''; }
};

// ---- command-line ---------------------------------------------------------------------------------
export function highlightCommand(cmd) {
  const toks = commandTokens(cmd);
  const out = []; let at = 0;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  toks.forEach((tk) => { out.push(esc(cmd.slice(at, tk.start))); out.push('<span class="tk-' + tk.kind + (tk.unclosed ? ' tk-bad' : '') + '">' + esc(tk.raw) + '</span>'); at = tk.end; });
  out.push(esc(cmd.slice(at)));
  return out.join('') + '\n';
}
export const commandLine = {
  create(ctx) {
    const { t } = ctx;
    let cur = S(ctx.value);
    const ta = h('textarea', { id: ctx.id, class: 'w-cmd-in mono', rows: '2', spellcheck: 'false', autocapitalize: 'off', 'aria-describedby': (ctx.describedBy || '') + ' ' + ctx.id + '-pv', placeholder: ctx.hint.example || '' });
    ta.value = cur;
    const hl = h('pre', { class: 'w-cmd-hl mono', 'aria-hidden': 'true' });
    const pv = h('ol', { class: 'w-cmd-pv mono', id: ctx.id + '-pv', 'aria-label': t('w.cmdPreview', null, 'What runs') });
    const draw = () => {
      hl.innerHTML = highlightCommand(cur);
      const toks = commandTokens(cur);
      pv.replaceChildren(...toks.map((tk, i) => h('li', { class: 'tk-' + tk.kind }, [h('span', { class: 'w-cmd-k', text: i === 0 ? t('w.cmdProgram', null, 'program') : t('w.cmdArg', [i], 'arg {0}') }), ' ', expandVars(tk.text) || '""'])));
      pv.hidden = !toks.length;
    };
    const sync = () => { hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft; };
    ta.addEventListener('input', () => { cur = ta.value; draw(); ctx.onChange(cur === '' ? undefined : cur); });
    ta.addEventListener('scroll', sync);
    const quote = toolButton(t('w.quote', null, 'Quote'), t('w.quoteHelp', null, 'Put quotes around the selected text (for paths with spaces)'), () => {
      const s = ta.selectionStart, e = ta.selectionEnd;
      if (s === e) return;
      const q = quoteArg(ta.value.slice(s, e).replace(/^"|"$/g, ''));
      ta.value = ta.value.slice(0, s) + q + ta.value.slice(e); cur = ta.value; draw(); flash(ta); ctx.onChange(cur); ta.focus(); ta.setSelectionRange(s, s + q.length);
    }, { class: 'w-tool w-tool-text' });
    const snippets = h('select', { class: 'w-select', 'aria-label': t('w.cmdSnippets', null, 'Insert a common command') }, [h('option', { value: '', text: t('w.cmdSnippetPick', null, 'Insert...') })].concat(COMMAND_SNIPPETS.map(([v, l]) => h('option', { value: v, text: l }))));
    snippets.addEventListener('change', () => { if (!snippets.value) return; const s = ta.selectionStart ?? ta.value.length; ta.value = ta.value.slice(0, s) + snippets.value + ta.value.slice(ta.selectionEnd ?? s); cur = ta.value; snippets.value = ''; draw(); ctx.onChange(cur); ta.focus(); });
    const copy = toolButton(t('w.copy', null, 'Copy'), t('w.copy', null, 'Copy'), async () => { if (await copyText(cur) && ctx.announce) ctx.announce(t('w.copied', null, 'Copied.')); }, { class: 'w-tool w-tool-text' });
    draw();
    const el = h('div', { class: 'w-cmd' }, [h('div', { class: 'w-cmd-box' }, [hl, ta]), h('div', { class: 'w-row w-cmd-tools' }, [quote, snippets, copy]), pv]);
    return { el, input: ta, set(v) { cur = S(v); ta.value = cur; draw(); } };
  },
  validate(v, hint, t) { if (!v) return ''; return commandTokens(v).some((x) => x.unclosed) ? t('w.errQuote', null, 'A quote is not closed.') : ''; },
  describe(v, hint, t) { if (!v) return ''; const toks = commandTokens(v); return t('w.cmdRuns', [toks[0] ? expandVars(toks[0].text) : '', toks.length - 1], 'Runs {0} with {1} arguments'); }
};

// ---- url, email, registry -------------------------------------------------------------------------
export const url = {
  create(ctx) {
    const p = plainInput(ctx, { mono: true, inputmode: 'url', type: 'text' });
    const open = h('a', { class: 'w-tool w-tool-text', target: '_blank', rel: 'noopener noreferrer', text: ctx.t('w.open', null, 'Open') });
    const draw = () => { const v = p.get(); const ok = v && !checkUrl(v) && /^https?:/i.test(v); open.hidden = !ok; if (ok) open.href = v; };
    p.after = draw; draw();
    return { el: h('div', { class: 'w-row' }, [p.input, open]), input: p.input, set(v) { p.set(v); draw(); } };
  },
  validate(v, hint, t) { const e = checkUrl(v, { allowPath: true }); return e ? t('w.err.' + e, null, e) : ''; },
  describe(v, hint, t) { if (!v) return ''; try { const u = new URL(v); return u.protocol === 'https:' ? t('w.urlSecure', [u.host], 'Secure link to {0}') : u.protocol === 'http:' ? t('w.urlPlain', [u.host], 'Unencrypted link to {0}') : ''; } catch (e) { return ''; } }
};
export const email = {
  create(ctx) { const p = plainInput(ctx, { mono: true, inputmode: 'email' }); return { el: p.input, input: p.input, set: p.set }; },
  validate(v, hint, t) { return checkEmail(v) ? t('w.err.email', null, 'Enter an address like name@example.com.') : ''; }
};
export const registryPath = {
  create(ctx) {
    const p = plainInput(ctx, { mono: true, placeholder: 'HKLM\\SOFTWARE\\Contoso' });
    const chips = presetChips(['HKLM\\SOFTWARE\\', 'HKLM\\SYSTEM\\CurrentControlSet\\', 'HKCU\\Software\\'].map((v) => ({ value: v, label: v })), (v) => { p.set(v); flash(p.input); ctx.onChange(v); p.input.focus(); }, ctx.t, ctx.t('w.hives', null, 'Registry hives'));
    return { el: h('div', { class: 'w-path' }, [p.input, chips]), input: p.input, set: p.set };
  },
  validate(v, hint, t) { if (hint.sep) return ''; const e = checkRegistryPath(v); return e ? t('w.err.' + e, null, e) : ''; },
  describe(v) { return v ? expandHive(v) : ''; }
};

// ---- account-picker -------------------------------------------------------------------------------
export const accountPicker = {
  create(ctx) {
    const sid = ctx.hint.storage === 'sid';
    const hint = Object.assign({}, ctx.hint, { source: 'accounts', allowCustom: true, sep: sid ? undefined : ';' });
    const w = comboboxSearch.create(Object.assign({}, ctx, { hint, onChange: (v) => ctx.onChange(sid && v ? (ACCOUNTS.find((a) => a.name === v) || {}).sid || v : v) }));
    return w;
  },
  describe(v, hint, t) {
    if (!v) return '';
    const names = String(v).split(';').map((x) => x.trim()).filter(Boolean);
    return names.map((n) => { const a = ACCOUNTS.find((x) => x.name.toLowerCase() === n.toLowerCase() || x.sid === n); return a ? a.name + ': ' + a.note.replace(/\.$/, '') : n; }).join('; ') + '.';
  },
  validate(v, hint, t) { return hint.storage === 'sid' && v && !/^S-1-\d+(-\d+)+$/.test(v) ? t('w.errSid', null, 'Enter a security identifier such as S-1-5-21-...-513.') : ''; }
};

// ---- color ----------------------------------------------------------------------------------------
export const color = {
  create(ctx) {
    const { t, hint } = ctx;
    const fmt = hint.format || 'argb-hex';
    let cur = S(ctx.value);
    const c0 = parseColor(cur, fmt);
    const picker = h('input', { type: 'color', class: 'w-colorpick', value: c0 ? cssHex(c0) : '#0078d7', 'aria-label': t('w.pickColor', null, 'Pick a color') });
    const inp = textInput({ id: ctx.id, value: cur, mono: true, describedBy: ctx.describedBy, placeholder: fmt === 'rgb-int' ? '16711680' : '0xff0078d7' });
    const sw = h('span', { class: 'w-swatch', 'aria-hidden': 'true' });
    const draw = () => { const c = parseColor(cur, fmt); sw.style.background = c ? cssHex(c) : 'transparent'; sw.classList.toggle('empty', !c); if (c && document.activeElement !== picker) picker.value = cssHex(c); };
    inp.addEventListener('input', () => { cur = inp.value.trim(); draw(); ctx.onChange(cur === '' ? undefined : cur); });
    picker.addEventListener('input', () => { const c = hexToRgb(picker.value); const old = parseColor(cur, fmt); if (old) c.a = old.a; cur = formatColor(c, fmt); inp.value = cur; draw(); flash(inp); ctx.onChange(cur); });
    draw();
    return { el: h('div', { class: 'w-color' }, [h('div', { class: 'w-row' }, [picker, inp, sw]), presetChips(hint.presets, (v) => { cur = v; inp.value = v; draw(); ctx.onChange(v); }, t)]), input: inp, set(v) { cur = S(v); inp.value = cur; draw(); } };
  },
  validate(v, hint, t) {
    if (!v || (hint.presets || []).some((p) => p.value === v)) return '';
    const c = parseColor(v, hint.format || 'argb-hex');
    if (!c) return hint.format === 'rgb-int' ? t('w.errColorInt', null, 'Enter red + green*256 + blue*65536 as one number.') : t('w.errColor', null, 'Enter a color as 0xAARRGGBB, for example 0xff0078d7.');
    if (hint.format !== 'rgb-int' && hint.format !== 'abgr-hex' && !/^0x[0-9a-f]{8}$/.test(v)) return t('w.errColorCase', null, 'Write it as 0x followed by 8 lowercase hex digits.');
    return '';
  },
  describe(v, hint, t) {
    if (!v) return '';
    const p = (hint.presets || []).find((x) => x.value === v); if (p) return p.label;
    const c = parseColor(v, hint.format || 'argb-hex'); if (!c) return '';
    const L = lightness(c);
    return t('w.colorIs', [cssHex(c).toUpperCase(), L], 'Color {0}, lightness {1}%') + (L < 25 || L > 75 ? ' \u00b7 ' + t('w.colorAdjusted', null, 'Windows will adjust it for readability') : '');
  }
};

// ---- file (path plus a local check of the picked image) -------------------------------------------
export const file = {
  create(ctx) {
    const { t, hint } = ctx;
    const pw = path.create(ctx);
    const status = h('p', { class: 'w-note', 'aria-live': 'polite' });
    const pick = h('input', { type: 'file', accept: hint.accept || '', class: 'sr-only', id: nextId('wf') });
    const btn = h('label', { class: 'w-tool w-tool-text', for: pick.id, tabindex: '0', role: 'button', text: t('w.checkFile', null, 'Check a file') });
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.click(); } });
    pick.addEventListener('change', async () => {
      const f = pick.files && pick.files[0]; if (!f) return;
      const buf = await f.arrayBuffer();
      const sz = /\.bmp$/i.test(f.name) ? bmpSize(buf) : null;
      const [w, hh] = hint.imageSize || [];
      if (/\.bmp$/i.test(hint.accept || '') && !sz) { status.textContent = t('w.fileNotBmp', [f.name], '{0} is not a BMP file.'); status.className = 'w-note warn'; return; }
      const ok = !w || (sz && sz.width === w && sz.height === hh);
      status.textContent = sz ? t(ok ? 'w.fileOk' : 'w.fileWrongSize', [f.name, sz.width + ' x ' + sz.height, (w || '') + ' x ' + (hh || '')], ok ? '{0}: {1} pixels, fits.' : '{0} is {1} pixels; Windows expects {2}.') : f.name;
      status.className = 'w-note' + (ok ? ' ok' : ' warn');
      if (!pw.input.value) { const v = 'C:\\Windows\\System32\\' + f.name; pw.set(v); ctx.onChange(v); }
    });
    const hintText = hint.imageSize ? h('p', { class: 'w-note', text: t('w.fileHint', [hint.imageSize.join(' x ')], 'Use a {0} pixel BMP and copy it to the computer before this pass. The file is only checked here, never uploaded.') }) : null;
    return { el: h('div', { class: 'w-file' }, [pw.el, h('div', { class: 'w-row' }, [btn, pick]), status, hintText]), input: pw.input, set: pw.set };
  },
  validate: path.validate,
  describe: path.describe
};

// ---- multiline ------------------------------------------------------------------------------------
export const multiline = {
  create(ctx) {
    let cur = S(ctx.value);
    const ta = h('textarea', { id: ctx.id, class: 'w-input' + (ctx.hint.note === 'blob' ? ' mono' : ''), rows: ctx.hint.note === 'blob' ? '4' : '3', spellcheck: ctx.hint.note === 'blob' ? 'false' : 'true', 'aria-describedby': ctx.describedBy || undefined, maxlength: ctx.hint.maxLength || undefined });
    ta.value = cur;
    const count = h('span', { class: 'w-count' });
    const draw = () => { count.textContent = cur.length ? cur.length.toLocaleString('en-US') + (ctx.hint.maxLength ? ' / ' + ctx.hint.maxLength : '') : ''; };
    ta.addEventListener('input', () => { cur = ctx.hint.note === 'blob' ? ta.value.replace(/\s+/g, '') : ta.value; draw(); ctx.onChange(cur === '' ? undefined : cur, ctx.hint.note === 'blob' ? { secret: true } : undefined); });
    draw();
    return { el: h('div', { class: 'w-multi' }, [ta, count]), input: ta, set(v) { cur = S(v); ta.value = cur; draw(); } };
  },
  describe(v, hint, t) { return !v ? '' : hint.note === 'blob' ? t('w.blobSet', [String(v).length], 'Offline join data set ({0} characters, hidden in history).') : ''; }
};

// ---- string-list (chips, add, remove, reorder) ----------------------------------------------------
export const stringList = {
  create(ctx) {
    const { t, hint } = ctx;
    const sep = hint.sep || ';';
    let items = splitList(ctx.value, sep);
    const list = h('ul', { class: 'w-list', 'aria-label': ctx.label || '' });
    const add = textInput({ id: ctx.id, mono: true, describedBy: ctx.describedBy, placeholder: t('w.addItemPh', null, 'Type and press Enter to add') });
    const options = hint.options ? h('div', { class: 'w-chips' }) : null;
    const emit = () => { const v = joinList(items, sep); ctx.onChange(v === '' ? undefined : v); };
    const draw = () => {
      list.replaceChildren(...items.map((it, i) => h('li', { class: 'w-li' }, [
        h('span', { class: 'mono w-li-t', text: it }),
        toolButton('\u2191', t('list.up', null, 'Move up'), () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; draw(); emit(); }, { disabled: i === 0 || undefined }),
        toolButton('\u2193', t('list.down', null, 'Move down'), () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; draw(); emit(); }, { disabled: i === items.length - 1 || undefined }),
        toolButton('\u00d7', t('w.removeItem', [it], 'Remove {0}'), () => { items.splice(i, 1); draw(); emit(); add.focus(); })])));
      list.hidden = !items.length;
      if (options) options.replaceChildren(...hint.options.filter((o) => !items.includes(o)).map((o) => h('button', { type: 'button', class: 'w-chip mono', onclick: () => { items.push(o); draw(); emit(); } }, ['+ ' + o])));
    };
    const push = () => { const parts = splitList(add.value, sep).concat(sep !== ';' ? [] : []); if (!parts.length) return; items.push(...parts); add.value = ''; draw(); flash(list); emit(); };
    add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); push(); } });
    add.addEventListener('paste', (e) => { const txt = (e.clipboardData || window.clipboardData).getData('text'); if (txt.includes(sep) || /\n/.test(txt)) { e.preventDefault(); items.push(...splitList(txt.replace(/\r?\n/g, sep), sep)); draw(); emit(); } });
    const addBtn = toolButton('+', t('list.add', null, 'Add item'), push);
    draw();
    const el = h('div', { class: 'w-slist' }, [list, h('div', { class: 'w-row' }, [add, addBtn]), options, h('p', { class: 'w-note', text: t('w.listSep', [sep === ' ' ? t('w.sepSpace', null, 'spaces') : sep], 'Written as one value separated by {0}.') })]);
    return { el, input: add, set(v) { items = splitList(v, sep); draw(); } };
  },
  describe(v, hint, t) { const n = splitList(v, hint.sep || ';').length; return n ? t('w.listCount', [n], '{0} entries') : ''; }
};

// ---- key-value rows -------------------------------------------------------------------------------
export const keyValue = {
  create(ctx) {
    const { t, hint } = ctx;
    const sep = hint.sep || ',', fs = hint.fieldSep || ':', cols = hint.columns || [t('w.key', null, 'Key'), t('w.value', null, 'Value')];
    let rows = splitRows(ctx.value, sep, fs);
    const table = h('div', { class: 'w-kv', role: 'table', 'aria-label': ctx.label || '' });
    const emit = () => { const v = joinRows(rows, sep, fs); ctx.onChange(v === '' ? undefined : v); };
    const draw = () => {
      table.replaceChildren(h('div', { class: 'w-kv-r w-kv-h', role: 'row' }, cols.map((c) => h('span', { role: 'columnheader', text: c })).concat([h('span', { role: 'columnheader', class: 'sr-only', text: t('w.actions', null, 'Actions') })])));
      rows.forEach((r, i) => {
        const cells = cols.map((c, k) => { const inp = textInput({ value: r[k] || '', mono: true, label: c + ' ' + (i + 1) }); inp.addEventListener('input', () => { rows[i][k] = inp.value; emit(); }); return h('span', { role: 'cell' }, [inp]); });
        table.appendChild(h('div', { class: 'w-kv-r', role: 'row' }, cells.concat([h('span', { role: 'cell' }, [toolButton('\u00d7', t('list.remove', null, 'Remove'), () => { rows.splice(i, 1); draw(); emit(); })])])));
      });
    };
    const addBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: ctx.id, 'aria-describedby': ctx.describedBy || undefined, text: t('list.add', null, 'Add item'), onclick: () => { rows.push(cols.map(() => '')); draw(); const last = table.lastChild && table.lastChild.querySelector('input'); if (last) last.focus(); } });
    draw();
    return { el: h('div', { class: 'w-kvbox' }, [table, addBtn, h('p', { class: 'w-note mono', text: t('w.kvFormat', [cols.join(fs), sep], 'Written as {0} rows separated by {1}') })]), input: addBtn, set(v) { rows = splitRows(v, sep, fs); draw(); } };
  },
  describe(v, hint, t) { const n = splitRows(v, hint.sep || ',', hint.fieldSep || ':').length; return n ? t('w.rowCount', [n], '{0} rows') : ''; }
};
