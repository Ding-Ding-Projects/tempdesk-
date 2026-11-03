// Address and identifier widgets: ipv4 (octet fields), ipv6, cidr (address/prefix with both mask
// forms), mac, guid (with Generate) and product-key (five groups, paste aware, generic key presets).
import { h, textInput, toolButton, flash, presetChips, nextId } from './base.js';
import { parseIpv4, classifyIpv4, normalizeIpv6, parseCidr, maskFromPrefix, prefixFromMask, parseMac, parseGuid, newGuid, splitProductKey, isProductKey } from './format.js';
import { PRODUCT_KEYS, productKeyPreset, POWER_PLANS } from './data.js';

// ---- ipv4 (four octet boxes; IPv6 text box when allowed and typed) ---------------------------
function octetEditor(ctx, initial, onValue) {
  const { t } = ctx;
  const parts = String(initial || '').split('.');
  const boxes = [0, 1, 2, 3].map((i) => h('input', { type: 'text', class: 'w-octet mono', inputmode: 'numeric', value: /^\d{1,3}$/.test(parts[i] || '') && parts.length === 4 ? parts[i] : '', 'aria-label': t('w.octet', [i + 1], 'Octet {0}'), autocomplete: 'off' }));
  if (ctx.id) boxes[0].id = ctx.id;
  const value = () => (boxes.every((b) => b.value === '') ? '' : boxes.map((b) => b.value).join('.'));
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      if (/[.\s]/.test(b.value) || b.value.length > 3) {
        const pasted = b.value.replace(/\s/g, '');
        if (pasted.split('.').length === 4 && i === 0) { pasted.split('.').forEach((p, k) => { boxes[k].value = p.replace(/\D/g, '').slice(0, 3); }); boxes[3].focus(); }
        else { b.value = b.value.replace(/\D/g, '').slice(0, 3); if (i < 3) boxes[i + 1].focus(); }
      } else {
        b.value = b.value.replace(/\D/g, '');
        if (b.value.length === 3 && i < 3) boxes[i + 1].focus();
      }
      onValue(value());
    });
    b.addEventListener('keydown', (e) => {
      if ((e.key === '.' || e.key === 'ArrowRight') && i < 3 && (e.key === '.' || b.selectionStart === b.value.length)) { if (e.key === '.') e.preventDefault(); if (b.value) boxes[i + 1].focus(); }
      if ((e.key === 'Backspace' && b.value === '') || (e.key === 'ArrowLeft' && b.selectionStart === 0)) { if (i > 0) { e.preventDefault(); boxes[i - 1].focus(); } }
    });
    b.addEventListener('paste', (e) => {
      const txt = (e.clipboardData || window.clipboardData).getData('text').trim();
      const p = txt.split('/')[0].split('.');
      if (p.length === 4) { e.preventDefault(); p.forEach((x, k) => { boxes[k].value = x.replace(/\D/g, '').slice(0, 3); }); onValue(value()); boxes[3].focus(); }
    });
  });
  const el = h('div', { class: 'w-ipv4', role: 'group', 'aria-describedby': ctx.describedBy || undefined, 'aria-label': ctx.label || 'IPv4' }, boxes.flatMap((b, i) => (i ? [h('span', { class: 'w-dot', 'aria-hidden': 'true', text: '.' }), b] : [b])));
  return { el, boxes, set(v) { const p = String(v || '').split('.'); boxes.forEach((b, k) => { b.value = p.length === 4 ? p[k] : ''; }); } };
}
export const ipv4 = {
  create(ctx) {
    const { t, hint } = ctx;
    let cur = ctx.value === undefined ? '' : String(ctx.value);
    const v6 = hint.allowIpv6 && cur.includes(':');
    let mode = v6 ? 6 : 4;
    const oct = octetEditor(Object.assign({}, ctx, { id: mode === 4 ? ctx.id : null }), mode === 4 ? cur : '', (v) => { cur = v; ctx.onChange(cur === '' ? undefined : cur); });
    const text = textInput({ id: mode === 6 ? ctx.id : nextId('ip6'), value: mode === 6 ? cur : '', mono: true, describedBy: ctx.describedBy, placeholder: '2001:db8::10', label: 'IPv6' });
    text.addEventListener('input', () => { cur = text.value.trim(); ctx.onChange(cur === '' ? undefined : cur); });
    text.addEventListener('blur', () => { const n = normalizeIpv6(cur); if (n && n !== cur) { cur = n; text.value = n; flash(text); ctx.onChange(cur); } });
    const famSeg = hint.allowIpv6 ? h('div', { class: 'w-seg w-seg-sm', role: 'radiogroup', 'aria-label': t('w.family', null, 'Address family') }, ['IPv4', 'IPv6'].map((f, i) => h('button', { type: 'button', role: 'radio', class: 'w-seg-b', 'aria-checked': String(mode === (i ? 6 : 4)), tabindex: mode === (i ? 6 : 4) ? '0' : '-1', onclick: () => { mode = i ? 6 : 4; draw(); (mode === 4 ? oct.boxes[0] : text).focus(); } }, [f]))) : null;
    const draw = () => {
      oct.el.hidden = mode !== 4; text.hidden = mode !== 6;
      if (famSeg) [...famSeg.children].forEach((b, i) => { b.setAttribute('aria-checked', String(mode === (i ? 6 : 4))); b.tabIndex = mode === (i ? 6 : 4) ? 0 : -1; });
    };
    draw();
    const el = h('div', { class: 'w-ip' }, [h('div', { class: 'w-row' }, [oct.el, text, famSeg])]);
    return { el, input: mode === 4 ? oct.boxes[0] : text, set(v) { cur = v === undefined ? '' : String(v); mode = hint.allowIpv6 && cur.includes(':') ? 6 : 4; oct.set(mode === 4 ? cur : ''); text.value = mode === 6 ? cur : ''; draw(); } };
  },
  validate(v, hint, t) {
    if (v === undefined || v === '') return '';
    if (parseIpv4(v).ok) return '';
    if (hint.allowIpv6 && normalizeIpv6(v)) return '';
    return hint.allowIpv6 ? t('w.errIp', null, 'Enter an IPv4 address such as 192.168.1.10 or an IPv6 address.') : t('w.errIpv4', null, 'Enter four numbers from 0 to 255, for example 192.168.1.10.');
  },
  describe(v, hint, t) {
    const p = parseIpv4(v);
    if (p.ok) return t('w.ipKind.' + classifyIpv4(p), null, classifyIpv4(p)) + ' IPv4 address';
    const n = normalizeIpv6(v);
    return n ? t('w.ipv6Is', [n], 'IPv6 address {0}') : '';
  }
};
export const ipv6 = {
  create(ctx) { return ipv4.create(Object.assign({}, ctx, { hint: Object.assign({}, ctx.hint, { allowIpv6: true }) })); },
  validate(v, hint, t) { return ipv4.validate(v, Object.assign({}, hint, { allowIpv6: true }), t); },
  describe(v, hint, t) { return ipv4.describe(v, hint, t); }
};

// ---- cidr ---------------------------------------------------------------------------------------
export const cidr = {
  create(ctx) {
    const { t, hint } = ctx;
    let cur = ctx.value === undefined ? '' : String(ctx.value);
    const [ip0, pre0] = cur.split('/');
    const addr = textInput({ id: ctx.id, value: ip0 || '', mono: true, describedBy: ctx.describedBy, placeholder: '192.168.10.20', label: t('w.address', null, 'Address') });
    const prefix = h('input', { type: 'text', class: 'w-input w-input-xs mono', inputmode: 'numeric', maxlength: '3', value: pre0 || '', 'aria-label': t('w.prefix', null, 'Prefix length'), placeholder: '24' });
    const mask = textInput({ value: pre0 && !ip0.includes(':') ? maskFromPrefix(pre0) : '', mono: true, label: t('w.mask', null, 'Subnet mask'), placeholder: '255.255.255.0', cls: 'w-input-sm' });
    const info = h('div', { class: 'w-cidr-info mono', 'aria-live': 'polite' });
    const emit = () => { const a = addr.value.trim(), p = prefix.value.trim(); cur = a || p ? a + '/' + p : ''; draw(); ctx.onChange(cur === '' ? undefined : cur); };
    const draw = () => {
      const r = parseCidr(cur, hint);
      if (!r.ok || r.family !== 4) { info.textContent = r.ok ? '/' + r.prefix + ' (IPv6)' : ''; mask.hidden = !!(r.ok && r.family === 6); return; }
      mask.hidden = false;
      if (document.activeElement !== mask) mask.value = r.mask;
      info.textContent = t('w.cidrInfo', [r.network + '/' + r.prefix, r.first, r.last, r.hosts.toLocaleString('en-US')], 'Network {0}, hosts {1} to {2} ({3} usable)');
    };
    addr.addEventListener('input', emit);
    addr.addEventListener('paste', (e) => { const txt = (e.clipboardData || window.clipboardData).getData('text').trim(); if (/\//.test(txt)) { e.preventDefault(); const [a, p] = txt.split('/'); addr.value = a; prefix.value = p; emit(); } });
    prefix.addEventListener('input', () => { prefix.value = prefix.value.replace(/\D/g, ''); emit(); });
    mask.addEventListener('input', () => { const p = prefixFromMask(mask.value.trim()); if (p >= 0) { prefix.value = String(p); emit(); } });
    draw();
    const el = h('div', { class: 'w-cidr' }, [h('div', { class: 'w-row' }, [addr, h('span', { class: 'w-dot', 'aria-hidden': 'true', text: '/' }), prefix, h('span', { class: 'w-or', text: '=' }), mask]), info,
      presetChips(hint.presets, (v) => { const [a, p] = v.split('/'); addr.value = a; prefix.value = p; emit(); flash(addr); }, t)]);
    return { el, input: addr, set(v) { cur = v === undefined ? '' : String(v); const [a, p] = cur.split('/'); addr.value = a || ''; prefix.value = p || ''; mask.value = ''; draw(); } };
  },
  validate(v, hint, t) {
    if (v === undefined || v === '') return '';
    const r = parseCidr(v, hint);
    if (!r.ok) return r.error === 'prefix4' ? t('w.errPrefix4', null, 'An IPv4 prefix length is 0 to 32.') : r.error === 'prefix6' ? t('w.errPrefix6', null, 'An IPv6 prefix length is 0 to 128.') : t('w.errCidr', null, 'Enter an address and a prefix length, for example 192.168.10.20/24.');
    if (r.family === 4 && /UnicastIpAddresses/.test(hint.path || '') && (r.isNetwork || r.isBroadcast)) return t('w.errHostAddr', null, 'This is the network or broadcast address; use a host address.');
    return '';
  },
  describe(v, hint, t) { const r = parseCidr(v, hint); return r.ok ? (r.family === 4 ? t('w.cidrIs', [r.ip, r.mask, r.network + '/' + r.prefix], '{0} with mask {1} on network {2}') : t('w.ipv6Is', [r.ip + '/' + r.prefix], 'IPv6 address {0}')) : ''; }
};

// ---- mac ------------------------------------------------------------------------------------------
export const mac = {
  create(ctx) {
    let cur = ctx.value === undefined ? '' : String(ctx.value);
    const inp = textInput({ id: ctx.id, value: cur, mono: true, describedBy: ctx.describedBy, placeholder: '00-15-5D-01-02-03', maxLength: 17 });
    inp.addEventListener('input', () => { cur = inp.value.trim(); ctx.onChange(cur === '' ? undefined : cur); });
    inp.addEventListener('blur', () => { const p = parseMac(cur); if (p.ok && p.value !== cur) { cur = p.value; inp.value = cur; flash(inp); ctx.onChange(cur); } });
    return { el: inp, input: inp, set(v) { cur = v === undefined ? '' : String(v); inp.value = cur; } };
  },
  validate(v, hint, t) { return v === undefined || v === '' || parseMac(v).ok ? '' : t('w.errMac', null, 'Enter 12 hex digits, for example 00-15-5D-01-02-03.'); },
  describe(v, hint, t) { const p = parseMac(v); return p.ok ? t('w.macIs', [p.value], 'MAC address {0}') + (p.local ? ' (' + t('w.macLocal', null, 'locally administered') + ')' : '') : ''; }
};

// ---- guid -----------------------------------------------------------------------------------------
export const guid = {
  create(ctx) {
    const { t, hint } = ctx;
    let cur = ctx.value === undefined ? '' : String(ctx.value);
    const inp = textInput({ id: ctx.id, value: cur, mono: true, describedBy: ctx.describedBy, placeholder: '00000000-0000-0000-0000-000000000000', maxLength: 38 });
    const set = (v) => { cur = v; inp.value = v; flash(inp); ctx.onChange(cur === '' ? undefined : cur); };
    inp.addEventListener('input', () => { cur = inp.value.trim(); ctx.onChange(cur === '' ? undefined : cur); });
    inp.addEventListener('blur', () => { const p = parseGuid(cur); if (p.ok) { const n = p.braces ? '{' + p.value + '}' : p.value; if (n !== cur) set(n); } });
    const gen = toolButton(t('w.generate', null, 'Generate'), t('w.generateGuid', null, 'Generate a new GUID'), () => set(newGuid()), { class: 'w-tool w-tool-text' });
    return { el: h('div', { class: 'w-guid' }, [h('div', { class: 'w-row' }, [inp, gen]), presetChips(hint.presets, set, t)]), input: inp, set(v) { cur = v === undefined ? '' : String(v); inp.value = cur; } };
  },
  validate(v, hint, t) { return v === undefined || v === '' || parseGuid(v).ok ? '' : t('w.errGuid', null, 'Enter a GUID such as 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c.'); },
  describe(v, hint, t) { const p = parseGuid(v); if (!p.ok) return ''; const n = POWER_PLANS[p.value] || ((hint.presets || []).find((x) => x.value.toLowerCase() === p.value) || {}).label; return n ? n + ' (' + p.value + ')' : p.value; }
};

// ---- product key ----------------------------------------------------------------------------------
export const productKey = {
  create(ctx) {
    const { t } = ctx;
    let cur = ctx.value === undefined ? '' : String(ctx.value);
    const groups = splitProductKey(cur);
    const boxes = groups.map((g, i) => h('input', { type: 'text', class: 'w-keybox mono', value: g, 'aria-label': t('w.keyGroup', [i + 1], 'Key group {0} of 5'), autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters' }));
    boxes[0].id = ctx.id;
    const reveal = h('button', { type: 'button', class: 'w-tool', 'aria-pressed': 'false', 'aria-label': t('pw.show', null, 'Show or hide'), title: t('pw.show', null, 'Show or hide'), html: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>' });
    const masked = () => reveal.getAttribute('aria-pressed') !== 'true';
    const applyMask = () => boxes.forEach((b) => b.classList.toggle('masked', masked()));
    reveal.addEventListener('click', () => { reveal.setAttribute('aria-pressed', String(masked())); applyMask(); });
    const value = () => (boxes.every((b) => !b.value) ? '' : boxes.map((b) => b.value).join('-'));
    const emit = () => { cur = value(); drawPreset(); ctx.onChange(cur === '' ? undefined : cur); };
    const fill = (text, from) => { const g = splitProductKey(text); const flat = g.join(''); let k = from || 0; for (let i = 0; i < 25 && k < 5; i += 5, k++) boxes[k].value = flat.slice(i, i + 5); };
    boxes.forEach((b, i) => {
      b.addEventListener('input', () => {
        const raw = b.value.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
        if (raw.length > 5) { fill(raw, i); const last = Math.min(4, i + Math.ceil(raw.length / 5) - 1); boxes[last].focus(); }
        else { b.value = raw; if (raw.length === 5 && i < 4) boxes[i + 1].focus(); }
        emit();
      });
      b.addEventListener('paste', (e) => { const txt = (e.clipboardData || window.clipboardData).getData('text'); if (txt.replace(/[^0-9A-Za-z]/g, '').length > 5) { e.preventDefault(); fill(txt, 0); boxes[4].focus(); emit(); } });
      b.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !b.value && i > 0) { e.preventDefault(); boxes[i - 1].focus(); }
        if (e.key === '-' ) { e.preventDefault(); if (i < 4) boxes[i + 1].focus(); }
      });
    });
    const sel = h('select', { class: 'w-select', 'aria-label': t('w.keyPresets', null, 'Generic keys by edition') }, [h('option', { value: '', text: t('w.keyPresetPick', null, 'Generic key for an edition...') })].concat(
      ['KMS', 'AVMA'].map((kind) => h('optgroup', { label: kind === 'KMS' ? t('w.keyKms', null, 'KMS client setup keys') : t('w.keyAvma', null, 'AVMA keys (Hyper-V guests)') }, PRODUCT_KEYS.filter((p) => p.kind === kind).map((p) => h('option', { value: p.key, text: p.edition }))))));
    sel.addEventListener('change', () => { if (!sel.value) return; fill(sel.value, 0); flash(boxes[0].parentElement); emit(); sel.value = ''; });
    const presetNote = h('p', { class: 'w-note', 'aria-live': 'polite' });
    const drawPreset = () => { const p = productKeyPreset(cur); presetNote.textContent = p ? t('w.keyIsGeneric', [p.kind, p.edition], 'Generic {0} key for {1}. It only selects the edition; it does not activate Windows.') : ''; presetNote.hidden = !p; };
    applyMask(); drawPreset();
    const row = h('div', { class: 'w-key', role: 'group', 'aria-describedby': ctx.describedBy || undefined, 'aria-label': ctx.label || t('w.productKey', null, 'Product key') }, boxes.flatMap((b, i) => (i ? [h('span', { class: 'w-dot', 'aria-hidden': 'true', text: '-' }), b] : [b])));
    const el = h('div', { class: 'w-pkey' }, [h('div', { class: 'w-row' }, [row, reveal]), h('div', { class: 'w-row' }, [sel]), presetNote, h('p', { class: 'w-note', text: t('w.keyNote', null, 'Generic keys only select an edition during Setup. Activate with your own MAK, retail or KMS key.') })]);
    return { el, input: boxes[0], set(v) { cur = v === undefined ? '' : String(v); splitProductKey(cur).forEach((g, k) => { boxes[k].value = g; }); drawPreset(); } };
  },
  validate(v, hint, t) { return v === undefined || v === '' || isProductKey(v) ? '' : t('w.errKey', null, 'A product key is five groups of five letters or digits.'); },
  describe(v, hint, t) { if (v === undefined || v === '') return ''; const p = productKeyPreset(v); return p ? t('w.keyGenericShort', [p.edition], 'Generic key: installs {0}, no activation') : t('w.keySet', null, 'A product key is set (hidden).'); }
};
