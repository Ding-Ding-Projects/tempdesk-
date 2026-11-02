// Setup flow canvas: the seven configuration passes as lanes in time order. Each component with
// settings is a card showing how many settings are set. Cards (and single top-level settings) can be
// dragged between lanes, only to passes the catalog allows; refused drops snap back with a reason.
// Pan and zoom (wheel, pinch, buttons), minimap, keyboard alternative and an accessible list view.
import { h, iconButton, clone } from './dom.js';
import { PASSES, countSet, settingAllowedPasses } from './catalog.js';
import { startDrag } from './drag.js';
import { searchBox } from './search-ui.js';

const LANE_W = 230;

function deepMerge(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = clone(a);
    for (const k of Object.keys(b)) out[k] = k in out ? deepMerge(out[k], b[k]) : clone(b[k]);
    return out;
  }
  return clone(b);
}
// Pure: move a component value (or one top-level setting of it) to another pass.
export function moveInAll(all, fromKey, toPass, settingName) {
  const out = clone(all || {});
  const comp = fromKey.split('|')[1];
  const toKey = toPass + '|' + comp;
  if (toKey === fromKey) return out;
  if (settingName) {
    const v = out[fromKey] && out[fromKey][settingName];
    if (v === undefined) return out;
    delete out[fromKey][settingName];
    if (!Object.keys(out[fromKey]).length) delete out[fromKey];
    out[toKey] = deepMerge(out[toKey] || {}, { [settingName]: v });
  } else {
    const v = out[fromKey];
    delete out[fromKey];
    out[toKey] = deepMerge(out[toKey] || {}, v || {});
  }
  return out;
}
export function canMove(catalog, comp, settingName, toPass) {
  const c = catalog.byName.get(comp);
  if (!c) return { ok: false, reason: 'flow.unknownComp' };
  if (!c.passes.includes(toPass)) return { ok: false, reason: 'flow.compNotInPass' };
  if (settingName) {
    const s = c.settings.find((x) => x.name === settingName);
    if (s && !settingAllowedPasses(c, s).includes(toPass)) return { ok: false, reason: 'flow.settingNotInPass' };
  }
  return { ok: true };
}

// ctx: { t, catalog, getModel(), generated() -> [{pass, comp, count}], onAll(newAll, msg), openEditor(pass, comp), announce(text) }
export function mountFlow(root, ctx) {
  const t = ctx.t;
  let scale = 1, tx = 0, ty = 0, listView = false, focusKey = null;
  const status = h('div', { class: 'notice', role: 'status', 'aria-live': 'polite', hidden: true });
  const world = h('div', { class: 'cv-world' });
  const viewport = h('div', { class: 'cv', tabindex: '-1' }, [world]);
  const mini = h('div', { class: 'minimap', 'aria-hidden': 'true' });
  viewport.appendChild(mini);
  const listBox = h('div', { hidden: true });
  const zoomLabel = h('span', { class: 'meter-label', text: '100%' });
  const tools = h('div', { class: 'cv-tools' }, [
    iconButton('minus', t('cv.zoomOut'), () => zoom(1 / 1.2)),
    zoomLabel,
    iconButton('plus', t('cv.zoomIn'), () => zoom(1.2)),
    iconButton('fit', t('cv.fit'), fit),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': 'false', text: t('cv.listView'), onclick: (e) => { listView = !listView; e.currentTarget.setAttribute('aria-pressed', String(listView)); draw(); } }),
    h('span', { class: 'help', style: { color: 'var(--muted)', fontSize: '.84rem' }, text: t('flow.keys') })
  ]);
  const finder = searchBox({ label: t('flow.find'), placeholder: t('flow.find'), compact: true, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'),
    onChange: (q, re, m) => {
      const cards = [...world.querySelectorAll('.ccard')];
      cards.forEach((c) => c.classList.remove('found'));
      if (!m.ok || m.empty) { finder.setStatus(''); return; }
      const hits = cards.filter((c) => m.test(c.dataset.key + ' ' + c.textContent));
      hits.forEach((c) => c.classList.add('found'));
      finder.setStatus(t('flow.found', [hits.length]), !hits.length);
      if (hits[0]) centreOn(hits[0]);
    },
    onKey: (e) => { if (e.key === 'Enter') { const f = world.querySelector('.ccard.found'); if (f) { e.preventDefault(); f.focus({ preventScroll: true }); } } } });
  tools.appendChild(finder.el);
  function centreOn(card) {
    const lane = card.closest('.lane');
    const vr = viewport.getBoundingClientRect();
    const cx = (lane.offsetLeft + card.offsetLeft + card.offsetWidth / 2) * scale, cy = (lane.offsetTop + card.offsetTop + card.offsetHeight / 2) * scale;
    tx = vr.width / 2 - cx; ty = vr.height / 2 - cy; apply();
    if (window.TempDeskSite) window.TempDeskSite.pulse(card);
  }
  root.replaceChildren(tools, status, viewport, listBox);

  function apply() {
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    zoomLabel.textContent = Math.round(scale * 100) + '%';
    drawMini();
  }
  function zoom(f, cx, cy) {
    const r = viewport.getBoundingClientRect();
    cx = cx === undefined ? r.width / 2 : cx; cy = cy === undefined ? r.height / 2 : cy;
    const ns = Math.min(2.5, Math.max(0.3, scale * f));
    tx = cx - (cx - tx) * (ns / scale); ty = cy - (cy - ty) * (ns / scale); scale = ns; apply();
  }
  function fit() {
    const r = viewport.getBoundingClientRect();
    const w = PASSES.length * LANE_W, hgt = world.scrollHeight || 400;
    scale = Math.max(0.3, Math.min(1, r.width / w, (r.height - 10) / hgt)); tx = 0; ty = 0; apply();
  }
  // wheel: ctrl or pinch zooms, plain wheel pans
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
    else { tx -= e.deltaX || (e.shiftKey ? e.deltaY : 0); ty -= e.shiftKey ? 0 : e.deltaY; apply(); }
  }, { passive: false });
  // pan with background drag, pinch with two pointers
  const pts = new Map();
  let pinch = null;
  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ccard')) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { viewport.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s: scale }; }
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    const prev = pts.get(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const r = viewport.getBoundingClientRect();
      const ns = pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
      zoom(ns / scale, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
    } else if (pts.size === 1) { tx += e.clientX - prev.x; ty += e.clientY - prev.y; apply(); }
  });
  const endPt = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
  viewport.addEventListener('pointerup', endPt);
  viewport.addEventListener('pointercancel', endPt);

  function drawMini() {
    mini.replaceChildren();
    const ww = PASSES.length * LANE_W, wh = Math.max(world.scrollHeight, 300);
    const k = Math.min(180 / ww, 70 / wh);
    world.querySelectorAll('.ccard').forEach((c) => {
      const lane = c.closest('.lane');
      mini.appendChild(h('i', { style: { left: (lane.offsetLeft + c.offsetLeft) * k + 'px', top: (lane.offsetTop + c.offsetTop) * k + 'px', width: Math.max(2, c.offsetWidth * k) + 'px', height: Math.max(2, c.offsetHeight * k) + 'px' } }));
    });
    const r = viewport.getBoundingClientRect();
    mini.appendChild(h('span', { class: 'vp', style: { left: (-tx / scale) * k + 'px', top: (-ty / scale) * k + 'px', width: (r.width / scale) * k + 'px', height: (r.height / scale) * k + 'px' } }));
  }
  mini.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    const ww = PASSES.length * LANE_W, wh = Math.max(world.scrollHeight, 300);
    const k = Math.min(180 / ww, 70 / wh), r = mini.getBoundingClientRect(), vr = viewport.getBoundingClientRect();
    tx = -((e.clientX - r.left) / k) * scale + vr.width / 2; ty = -((e.clientY - r.top) / k) * scale + vr.height / 2; apply();
  });

  function say(text, bad) { status.hidden = false; status.className = 'notice' + (bad ? ' warn' : ' ok'); status.textContent = text; if (ctx.announce) ctx.announce(text); }
  function tryMove(key, toPass, settingName) {
    const comp = key.split('|')[1];
    const chk = canMove(ctx.catalog, comp, settingName, toPass);
    if (!chk.ok) { say(t(chk.reason, [settingName || comp, toPass]), true); return false; }
    const all = moveInAll(ctx.getModel().all, key, toPass, settingName);
    ctx.onAll(all, { key: settingName ? 'hist.moveSetting' : 'hist.moveComp', args: [settingName ? comp + ' ' + settingName : comp, toPass] });
    focusKey = toPass + '|' + comp;
    say(t('flow.moved', [settingName || comp, toPass]));
    return true;
  }
  function cardsByPass() {
    const model = ctx.getModel();
    const map = new Map(PASSES.map((p) => [p, []]));
    const seen = new Set();
    Object.keys(model.all || {}).forEach((key) => {
      const [pass, comp] = key.split('|');
      if (!map.has(pass)) return;
      seen.add(key);
      map.get(pass).push({ key, pass, comp, count: countSet(model.all[key]), movable: true, settings: Object.keys(model.all[key] || {}).filter((k) => k[0] !== '@') });
    });
    (ctx.generated() || []).forEach((g) => {
      const key = g.pass + '|' + g.comp;
      const existing = map.get(g.pass) && map.get(g.pass).find((c) => c.key === key);
      if (existing) existing.genCount = g.count;
      else if (map.has(g.pass)) map.get(g.pass).push({ key, pass: g.pass, comp: g.comp, count: 0, genCount: g.count, movable: false, settings: [] });
    });
    return map;
  }
  function moveMenu(key, settingName, anchor) {
    const comp = key.split('|')[1];
    const sel = h('select', { 'aria-label': t('flow.moveTo') }, [h('option', { value: '', text: t('flow.moveTo') })].concat(PASSES.map((p) => {
      const chk = canMove(ctx.catalog, comp, settingName, p);
      return h('option', { value: p, disabled: !chk.ok || p === key.split('|')[0] || undefined, text: p + (chk.ok ? '' : ' (' + t('flow.notAllowed') + ')') });
    })));
    sel.addEventListener('change', () => { if (sel.value) tryMove(key, sel.value, settingName); });
    sel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { sel.remove(); anchor.focus(); } });
    anchor.after(sel);
    sel.focus();
  }
  function draw() {
    const map = cardsByPass();
    world.replaceChildren();
    listBox.replaceChildren();
    viewport.hidden = listView; mini.hidden = listView; listBox.hidden = !listView;
    if (listView) {
      const ul = h('ul', { class: 'hist-list' });
      PASSES.forEach((p) => map.get(p).forEach((c) => {
        const li = h('li', null, [h('span', { class: 'msg', text: p + ' / ' + c.comp + ' (' + t('flow.count', [c.count + (c.genCount || 0)]) + ')' })]);
        if (c.movable) {
          const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('flow.moveTo') });
          btn.addEventListener('click', () => moveMenu(c.key, null, btn));
          li.appendChild(btn);
        }
        li.appendChild(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('common.edit'), onclick: () => ctx.openEditor(c.pass, c.comp) }));
        ul.appendChild(li);
      }));
      if (!ul.children.length) ul.appendChild(h('li', null, [t('flow.empty')]));
      listBox.appendChild(ul);
      return;
    }
    const lanes = [];
    PASSES.forEach((p, i) => {
      const lane = h('div', { class: 'lane', style: { left: i * LANE_W + 'px', width: LANE_W + 'px' }, 'data-pass': p, role: 'group', 'aria-label': p }, [h('h3', { text: (i + 1) + '. ' + p })]);
      map.get(p).forEach((c) => {
        const card = h('button', { type: 'button', class: 'ccard' + (c.movable ? '' : ' fixed'), 'data-key': c.key, 'aria-label': c.comp + ', ' + p + ', ' + t('flow.count', [c.count + (c.genCount || 0)]) + (c.movable ? '' : ', ' + t('flow.fromMode')) }, [
          h('b', { text: c.comp.replace(/^Microsoft-Windows-/, '') }),
          h('small', { text: t('flow.count', [c.count + (c.genCount || 0)]) + (c.genCount ? ' · ' + t('flow.fromModeN', [c.genCount]) : '') })
        ]);
        if (c.movable && c.settings.length > 1) {
          const chips = h('div', { class: 'pass-chips', style: { marginTop: '6px' } });
          c.settings.forEach((s) => {
            const chip = h('span', { class: 'pass-chip', text: s, role: 'button', tabindex: '-1', title: t('flow.dragSetting') });
            chip.addEventListener('pointerdown', (e) => { e.stopPropagation(); startDrag(e, { ghostFrom: chip, data: { key: c.key, setting: s }, targets, onEnd: endDrop, onClick: () => ctx.openEditor(c.pass, c.comp) }); });
            chips.appendChild(chip);
          });
          card.appendChild(chips);
        }
        card.addEventListener('pointerdown', (e) => {
          if (!c.movable) return;
          startDrag(e, { ghostFrom: card, data: { key: c.key }, targets, onEnd: endDrop, onClick: () => ctx.openEditor(c.pass, c.comp) });
        });
        card.addEventListener('click', (e) => { if (e.detail === 0 || !c.movable) ctx.openEditor(c.pass, c.comp); });
        card.addEventListener('keydown', (e) => keyNav(e, c, card));
        lane.appendChild(card);
      });
      world.appendChild(lane);
      lanes.push(lane);
    });
    world.style.width = PASSES.length * LANE_W + 'px';
    const hgt = Math.max(400, ...lanes.map((l) => l.scrollHeight + 20));
    world.style.height = hgt + 'px';
    lanes.forEach((l) => { l.style.height = hgt + 'px'; });
    function targets() {
      return lanes.map((l) => ({ el: l, accept: (d) => { const chk = canMove(ctx.catalog, d.key.split('|')[1], d.setting, l.dataset.pass); return chk.ok ? true : t(chk.reason, [d.setting || d.key.split('|')[1], l.dataset.pass]); }, drop: (d) => tryMove(d.key, l.dataset.pass, d.setting) }));
    }
    function endDrop(result) { if (typeof result === 'string') say(result + ' ' + t('flow.snapBack'), true); }
    if (focusKey) { const f = world.querySelector(`[data-key="${CSS.escape(focusKey)}"]`); if (f) f.focus({ preventScroll: true }); focusKey = null; }
    apply();
  }
  function keyNav(e, c, card) {
    const all = [...world.querySelectorAll('.ccard')];
    const lane = card.closest('.lane');
    const inLane = [...lane.querySelectorAll('.ccard')];
    const li = PASSES.indexOf(lane.dataset.pass);
    let target = null;
    if (e.key === 'ArrowDown') target = inLane[inLane.indexOf(card) + 1];
    else if (e.key === 'ArrowUp') target = inLane[inLane.indexOf(card) - 1];
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const step = e.key === 'ArrowRight' ? 1 : -1;
      for (let i = li + step; i >= 0 && i < PASSES.length && !target; i += step) target = world.querySelector(`.lane[data-pass="${PASSES[i]}"] .ccard`);
    } else if ((e.key === 'm' || e.key === 'M') && c.movable) { e.preventDefault(); moveMenu(c.key, null, card); return; }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.openEditor(c.pass, c.comp); return; }
    if (target) { e.preventDefault(); target.focus(); const r = target.getBoundingClientRect(), vr = viewport.getBoundingClientRect(); if (r.left < vr.left || r.right > vr.right) { tx -= r.left - vr.left - 20; apply(); } }
    void all;
  }
  draw();
  return { update: draw, fit };
}
