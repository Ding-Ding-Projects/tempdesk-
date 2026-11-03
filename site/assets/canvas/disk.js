// Disk layout canvas: one bar per disk, partitions as proportional blocks. Drag the grip to resize,
// drag a block to reorder, edit type, size, format, label, letter, Extend and the install target.
// Writes model.disks (answer.js turns it into DiskConfiguration and InstallTo).
import { h, iconButton, clone } from './dom.js';
import { startDrag } from './drag.js';
import { searchBox } from './search-ui.js';
import { quickField } from './widgets/index.js';

export const PART_TYPES = ['EFI', 'MSR', 'Primary', 'Recovery', 'Extended', 'Logical'];
export const PRESETS = {
  uefi: () => ({ disks: [{ diskId: '0', sizeMB: '128000', wipe: true, partitions: [
    { type: 'EFI', sizeMB: '300', format: 'FAT32', label: 'System' }, { type: 'MSR', sizeMB: '16' },
    { type: 'Primary', sizeMB: '0', extend: true, format: 'NTFS', label: 'Windows', letter: 'C' }] }], target: { diskId: '0', partitionId: '3' } }),
  uefiRecovery: () => ({ disks: [{ diskId: '0', sizeMB: '128000', wipe: true, partitions: [
    { type: 'EFI', sizeMB: '300', format: 'FAT32', label: 'System' }, { type: 'MSR', sizeMB: '16' },
    { type: 'Primary', sizeMB: '126684', format: 'NTFS', label: 'Windows', letter: 'C' },
    { type: 'Recovery', sizeMB: '1000', format: 'NTFS', label: 'Recovery' }] }], target: { diskId: '0', partitionId: '3' } }),
  bios: () => ({ disks: [{ diskId: '0', sizeMB: '128000', wipe: true, partitions: [
    { type: 'Primary', sizeMB: '500', format: 'NTFS', label: 'System', active: true },
    { type: 'Primary', sizeMB: '0', extend: true, format: 'NTFS', label: 'Windows', letter: 'C' }] }], target: { diskId: '0', partitionId: '2' } }),
  keep: () => ({ disks: [], target: { diskId: '0', partitionId: '3' } })
};
// Pure size math. Returns per-partition MB (extend partitions take the remainder) and free space.
export function layoutMath(disk) {
  const total = Math.max(0, parseInt(disk.sizeMB, 10) || 0);
  const fixed = disk.partitions.reduce((n, p) => n + (p.extend ? 0 : Math.max(0, parseInt(p.sizeMB, 10) || 0)), 0);
  const ext = disk.partitions.filter((p) => p.extend).length;
  const rest = Math.max(0, total - fixed);
  const sizes = disk.partitions.map((p) => (p.extend ? (ext ? Math.floor(rest / ext) : 0) : Math.max(0, parseInt(p.sizeMB, 10) || 0)));
  const used = sizes.reduce((a, b) => a + b, 0);
  return { total, sizes, used, free: Math.max(0, total - used), over: total > 0 && fixed > total };
}
export function validateLayout(layout) {
  const errs = [];
  (layout.disks || []).forEach((d, di) => {
    const efi = d.partitions.filter((p) => p.type === 'EFI').length;
    const ext = d.partitions.filter((p) => p.extend).length;
    if (efi > 1) errs.push({ disk: di, code: 'disk.errTwoEfi' });
    if (ext > 1) errs.push({ disk: di, code: 'disk.errTwoExtend' });
    if (d.partitions.some((p, i) => p.extend && i !== d.partitions.length - 1)) errs.push({ disk: di, code: 'disk.errExtendLast' });
    if (efi && d.partitions.some((p) => p.type === 'Extended' || p.type === 'Logical')) errs.push({ disk: di, code: 'disk.errMixed' });
    if (layoutMath(d).over) errs.push({ disk: di, code: 'disk.errTooBig' });
    const letters = d.partitions.map((p) => (p.letter || '').toUpperCase()).filter(Boolean);
    if (new Set(letters).size !== letters.length) errs.push({ disk: di, code: 'disk.errLetters' });
  });
  const tg = layout.target || {};
  const td = (layout.disks || []).find((d) => String(d.diskId) === String(tg.diskId));
  if (td) {
    const p = td.partitions[(parseInt(tg.partitionId, 10) || 0) - 1];
    if (!p) errs.push({ code: 'disk.errTarget' });
    else if (p.type === 'EFI' || p.type === 'MSR' || p.type === 'Extended' || p.type === 'Recovery') errs.push({ code: 'disk.errTargetType' });
  }
  return errs;
}
function fmtMB(mb) { return mb >= 1024 ? (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB' : mb + ' MB'; }

// ctx: { t, get() -> layout|null, set(layout, msg, coalesceKey) }
export function mountDisk(root, ctx) {
  const t = ctx.t;
  let sel = { disk: 0, part: 0 };
  let fm = null;
  const finder = searchBox({ label: t('disk.find'), placeholder: t('disk.find'), compact: true, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'),
    onChange: (q, re, m) => { fm = m; mark(); },
    onKey: (e) => { if (e.key === 'Enter') { const f = root.querySelector('.part.found'); if (f) { e.preventDefault(); f.focus(); f.click(); } } } });
  function mark() {
    const parts = [...root.querySelectorAll('.part[role=option]')];
    parts.forEach((p) => p.classList.remove('found'));
    if (!fm || !fm.ok || fm.empty) { finder.setStatus(''); return; }
    const hits = parts.filter((p) => fm.test(p.getAttribute('aria-label')));
    hits.forEach((p) => p.classList.add('found'));
    finder.setStatus(t('search.listCount', [hits.length, parts.length]), !hits.length);
  }
  function L() { return clone(ctx.get()) || PRESETS.uefi(); }
  function commit(layout, key, args, co) { ctx.set(layout, { key, args }, co); draw(); }
  function draw() {
    // keep focus and caret in the field being typed in across the redraw
    const act = document.activeElement, keepId = act && root.contains(act) && act.id ? act.id : null;
    const caret = keepId && act.selectionStart != null ? [act.selectionStart, act.selectionEnd] : null;
    drawInner();
    if (keepId) { const n = document.getElementById(keepId); if (n) { n.focus({ preventScroll: true }); if (caret && n.setSelectionRange) try { n.setSelectionRange(caret[0], caret[1]); } catch (e) { /* not a text field */ } } }
  }
  function drawInner() {
    const layout = ctx.get();
    root.replaceChildren();
    const presetSel = h('select', { 'aria-label': t('disk.preset') }, [h('option', { value: '', text: t('disk.preset') })].concat(Object.keys(PRESETS).map((k) => h('option', { value: k, text: t('disk.preset.' + k) }))));
    presetSel.addEventListener('change', () => { if (presetSel.value) { sel = { disk: 0, part: 0 }; commit(PRESETS[presetSel.value](), 'hist.diskPreset', [t('disk.preset.' + presetSel.value)]); } });
    const tools = h('div', { class: 'cv-tools' }, [presetSel,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('disk.addDisk'), onclick: () => { const l = L(); const id = l.disks.length ? Math.max(...l.disks.map((d) => parseInt(d.diskId, 10) || 0)) + 1 : 0; l.disks.push({ diskId: String(id), sizeMB: '256000', wipe: true, partitions: [{ type: 'Primary', sizeMB: '0', extend: true, format: 'NTFS', label: 'Data' }] }); commit(l, 'hist.addDisk', [id]); } }),
      layout ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('disk.useMode'), onclick: () => commit(null, 'hist.diskMode', []) }) : null
    ]);
    root.appendChild(tools);
    root.appendChild(finder.el);
    if (!layout) { root.appendChild(h('p', { class: 'notice', text: t('disk.fromMode') })); return; }
    if (!layout.disks.length) root.appendChild(h('p', { class: 'notice', text: t('disk.keepExisting') }));
    const errs = validateLayout(layout);
    layout.disks.forEach((disk, di) => {
      const m = layoutMath(disk);
      const box = h('div', { class: 'disk' });
      const SPD = 'Microsoft-Windows-Setup|DiskConfiguration/Disk/';
      let idTimer, sizeTimer;
      const idF = quickField({ id: 'dk-id-' + di, label: t('disk.id'), hintKey: SPD + 'DiskID', value: disk.diskId, t, noUnset: true, onChange: (v) => { clearTimeout(idTimer); idTimer = setTimeout(() => { const l = L(); const old = l.disks[di].diskId; l.disks[di].diskId = v || '0'; if (String(l.target.diskId) === String(old)) l.target.diskId = v || '0'; commit(l, 'hist.diskId', [v || '0']); }, 600); } });
      const sizeF = quickField({ id: 'dk-dsize-' + di, label: t('disk.sizeMB'), value: disk.sizeMB, t, noUnset: true, hint: { widget: 'size', storage: 'MB', description: t('disk.sizeHelp', null, 'The size of the disk, used only to draw this layout and check that the partitions fit. It is not written to the answer file.') }, onChange: (v) => { clearTimeout(sizeTimer); sizeTimer = setTimeout(() => { const l = L(); l.disks[di].sizeMB = v || '0'; commit(l, 'hist.diskSize', [disk.diskId, v || '0']); }, 600); } });
      const wipeF = quickField({ id: 'dk-wipe-' + di, label: t('disk.wipe'), hintKey: SPD + 'WillWipeDisk', value: disk.wipe !== false ? 'true' : 'false', t, noUnset: true, onChange: (v) => { const l = L(); l.disks[di].wipe = v === 'true'; commit(l, 'hist.diskWipe', [disk.diskId, String(v === 'true')]); } });
      box.appendChild(h('div', { class: 'disk-head' }, [h('div', { class: 'inline', style: { alignItems: 'center', justifyContent: 'space-between' } }, [h('b', { text: t('disk.disk', [disk.diskId]) }),
        iconButton('del', t('disk.removeDisk'), () => { const l = L(); l.disks.splice(di, 1); sel = { disk: 0, part: 0 }; commit(l, 'hist.removeDisk', [disk.diskId]); })]),
        h('div', { class: 'grid2' }, [idF.el, sizeF.el, wipeF.el])]));
      const bar = h('div', { class: 'disk-bar', role: 'listbox', 'aria-label': t('disk.disk', [disk.diskId]) });
      const total = Math.max(m.total, m.used, 1);
      disk.partitions.forEach((p, pi) => {
        const mb = m.sizes[pi];
        const isTarget = String(layout.target.diskId) === String(disk.diskId) && String(layout.target.partitionId) === String(pi + 1);
        const blk = h('div', { class: 'part', role: 'option', tabindex: '0', 'data-type': p.type, 'aria-selected': String(sel.disk === di && sel.part === pi), style: { flex: `${Math.max(mb, total * 0.02)} 0 0` },
          'aria-label': `${pi + 1}. ${p.type} ${fmtMB(mb)}${p.label ? ' ' + p.label : ''}${isTarget ? ', ' + t('disk.target') : ''}` }, [
          h('b', { text: `${pi + 1}. ${p.type}${isTarget ? ' *' : ''}` }), h('small', { text: fmtMB(mb) + (p.extend ? ' ' + t('disk.extendShort') : '') + (p.letter ? ' ' + p.letter + ':' : '') })]);
        blk.addEventListener('pointerdown', (e) => {
          if (e.target.classList.contains('grip')) return;
          startDrag(e, { data: { di, pi }, targets: () => [...bar.querySelectorAll('.part')].map((el, j) => ({ el, accept: () => true, drop: () => { const l = L(); const arr = l.disks[di].partitions; const [x] = arr.splice(pi, 1); arr.splice(j, 0, x); sel = { disk: di, part: j }; commit(l, 'hist.partMove', [pi + 1, j + 1]); } })),
            onClick: () => { sel = { disk: di, part: pi }; draw(); } });
        });
        blk.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sel = { disk: di, part: pi }; draw(); }
          if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && e.altKey) { e.preventDefault(); const j = pi + (e.key === 'ArrowRight' ? 1 : -1); if (j < 0 || j >= disk.partitions.length) return; const l = L(); const arr = l.disks[di].partitions; [arr[pi], arr[j]] = [arr[j], arr[pi]]; sel = { disk: di, part: j }; commit(l, 'hist.partMove', [pi + 1, j + 1]); }
          else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = blk[e.key === 'ArrowRight' ? 'nextElementSibling' : 'previousElementSibling']; if (n && n.classList.contains('part') && !n.classList.contains('free')) n.focus(); }
        });
        if (!p.extend) {
          const grip = h('span', { class: 'grip', 'aria-hidden': 'true' });
          grip.addEventListener('pointerdown', (e) => {
            e.stopPropagation(); e.preventDefault();
            const startX = e.clientX, start = parseInt(p.sizeMB, 10) || 0, perPx = total / bar.getBoundingClientRect().width;
            const pid = e.pointerId; grip.setPointerCapture(pid);
            const mv = (ev) => { const nv = Math.max(1, Math.round((start + (ev.clientX - startX) * perPx) / 16) * 16); blk.querySelector('small').textContent = fmtMB(nv); blk.style.flex = `${nv} 0 0`; grip.dataset.v = nv; };
            const up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); if (grip.dataset.v) { const l = L(); l.disks[di].partitions[pi].sizeMB = grip.dataset.v; commit(l, 'hist.partSize', [pi + 1, grip.dataset.v]); } };
            grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
          });
          blk.appendChild(grip);
        }
        bar.appendChild(blk);
      });
      if (m.free > 0) bar.appendChild(h('div', { class: 'part free', style: { flex: `${m.free} 0 0` }, 'aria-hidden': 'true' }, [h('small', { text: t('disk.free', [fmtMB(m.free)]) })]));
      box.appendChild(bar);
      box.appendChild(h('div', { class: 'meter-label', style: { marginTop: '6px' }, text: t('disk.math', [fmtMB(m.used), fmtMB(m.total), m.total ? Math.round(m.used / m.total * 100) : 0]) }));
      errs.filter((e) => e.disk === di).forEach((e) => box.appendChild(h('p', { class: 'notice warn', role: 'alert', text: t(e.code) })));
      box.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', style: { marginTop: '8px' }, text: t('disk.addPart'), onclick: () => { const l = L(); const arr = l.disks[di].partitions; const at = arr.length && arr[arr.length - 1].extend ? arr.length - 1 : arr.length; arr.splice(at, 0, { type: 'Primary', sizeMB: '10240', format: 'NTFS', label: '' }); sel = { disk: di, part: at }; commit(l, 'hist.addPart', [disk.diskId]); } }));
      root.appendChild(box);
    });
    errs.filter((e) => e.disk === undefined).forEach((e) => root.appendChild(h('p', { class: 'notice warn', role: 'alert', text: t(e.code) })));
    // editor for selected partition
    const d = layout.disks[sel.disk], p = d && d.partitions[sel.part];
    if (p) {
      const ed = h('div', { class: 'b-sec', style: { marginTop: '8px' } }, [h('header', null, [h('h2', { text: t('disk.partTitle', [d.diskId, sel.part + 1]) })])]);
      const g = h('div', { class: 'grid2' });
      const upd = (k, v, co) => { const l = L(); l.disks[sel.disk].partitions[sel.part][k] = v; commit(l, 'hist.partField', [sel.part + 1, t('disk.f.' + k), String(v)], co); };
      // Partition detail sheet: the same rich field cards as the settings editors.
      const SP = 'Microsoft-Windows-Setup|DiskConfiguration/Disk/';
      const diskMB = parseInt(d.sizeMB, 10) || 0;
      let labTimer, szTimer;
      const qf = (key, label, hintKey, value, onv, hint) => quickField({ id: 'dk-' + key, label, hintKey, hint, value, t, noUnset: true, onChange: onv }).el;
      g.append(
        qf('type', t('disk.f.type'), SP + 'CreatePartitions/CreatePartition/Type', p.type, (v) => upd('type', v || 'Primary'), { widget: 'cards', values: PART_TYPES.map((x) => ({ value: x, label: x })), valueHelp: { Recovery: t('disk.recoveryHelp', null, 'A Windows recovery tools partition (NTFS, about 1 GB, hidden with a type id).') } }),
        p.extend ? null : qf('size', t('disk.f.sizeMB'), SP + 'CreatePartitions/CreatePartition/Size', p.sizeMB, (v) => { clearTimeout(szTimer); szTimer = setTimeout(() => upd('sizeMB', v || '0', 'size'), 500); }, { widget: 'size', storage: 'MB', diskMB }),
        qf('extend', t('disk.f.extend'), SP + 'CreatePartitions/CreatePartition/Extend', p.extend ? 'true' : 'false', (v) => { upd('extend', v === 'true'); }),
        qf('fmt', t('disk.f.format'), SP + 'ModifyPartitions/ModifyPartition/Format', p.format || undefined, (v) => upd('format', v || '')),
        qf('label', t('disk.f.label'), SP + 'ModifyPartitions/ModifyPartition/Label', p.label || '', (v) => { clearTimeout(labTimer); labTimer = setTimeout(() => upd('label', v || '', 'label'), 500); }),
        qf('letter', t('disk.f.letter'), SP + 'ModifyPartitions/ModifyPartition/Letter', (p.letter || '').toUpperCase() || undefined, (v) => upd('letter', v || ''), { widget: 'combobox-search', allowCustom: false }),
        qf('active', t('disk.f.active'), SP + 'ModifyPartitions/ModifyPartition/Active', p.active ? 'true' : 'false', (v) => upd('active', v === 'true')));
      ed.appendChild(g);
      const isT = String(layout.target.diskId) === String(d.diskId) && String(layout.target.partitionId) === String(sel.part + 1);
      ed.appendChild(h('div', { class: 'cta', style: { marginTop: '12px' } }, [
        h('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: isT || undefined, text: isT ? t('disk.isTarget') : t('disk.makeTarget'), onclick: () => { const l = L(); l.target = { diskId: d.diskId, partitionId: String(sel.part + 1) }; commit(l, 'hist.diskTarget', [d.diskId, sel.part + 1]); } }),
        iconButton('left', t('list.up'), () => { if (sel.part === 0) return; const l = L(); const a = l.disks[sel.disk].partitions; [a[sel.part - 1], a[sel.part]] = [a[sel.part], a[sel.part - 1]]; sel.part--; commit(l, 'hist.partMove', [sel.part + 2, sel.part + 1]); }),
        iconButton('right', t('list.down'), () => { const l = L(); const a = l.disks[sel.disk].partitions; if (sel.part >= a.length - 1) return; [a[sel.part + 1], a[sel.part]] = [a[sel.part], a[sel.part + 1]]; sel.part++; commit(l, 'hist.partMove', [sel.part, sel.part + 1]); }),
        iconButton('del', t('list.remove'), () => { const l = L(); l.disks[sel.disk].partitions.splice(sel.part, 1); sel.part = Math.max(0, sel.part - 1); commit(l, 'hist.removePart', []); })
      ]));
      root.appendChild(ed);
    }
    root.appendChild(h('p', { class: 'meter-label', text: t('disk.keysHelp') }));
    mark();
  }
  draw();
  return { update: draw };
}
