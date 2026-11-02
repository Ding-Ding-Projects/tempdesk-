// Pointer drag helper (mouse, touch and pen) with a floating ghost and drop targets.
// startDrag(event, { ghostFrom, data, targets: () => [{ el, accept(data) -> true | reason string, drop(data) }], onEnd })
export function startDrag(ev, opt) {
  if (ev.button !== undefined && ev.button !== 0) return;
  const src = ev.currentTarget;
  const sx = ev.clientX, sy = ev.clientY;
  let ghost = null, over = null, moved = false;
  const pid = ev.pointerId;
  try { src.setPointerCapture(pid); } catch (e) { /* ignore */ }
  function find(x, y) {
    const list = opt.targets();
    for (const tg of list) {
      const r = tg.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return tg;
    }
    return null;
  }
  function move(e) {
    if (e.pointerId !== pid) return;
    if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 6) return;
    if (!moved) {
      moved = true;
      ghost = (opt.ghostFrom || src).cloneNode(true);
      ghost.classList.add('dragging');
      ghost.removeAttribute('id');
      document.body.appendChild(ghost);
    }
    e.preventDefault();
    ghost.style.left = (e.clientX + 8) + 'px';
    ghost.style.top = (e.clientY + 8) + 'px';
    const tg = find(e.clientX, e.clientY);
    if (over && over !== tg) over.el.classList.remove('drop-ok', 'drop-no');
    over = tg;
    if (tg) { const ok = tg.accept(opt.data); tg.el.classList.toggle('drop-ok', ok === true); tg.el.classList.toggle('drop-no', ok !== true); }
    if (opt.onMove) opt.onMove(e, tg);
  }
  function up(e) {
    if (e.pointerId !== pid) return;
    src.removeEventListener('pointermove', move);
    src.removeEventListener('pointerup', up);
    src.removeEventListener('pointercancel', up);
    if (ghost) ghost.remove();
    if (over) over.el.classList.remove('drop-ok', 'drop-no');
    if (!moved) { if (opt.onClick) opt.onClick(e); return; }
    const tg = e.type === 'pointercancel' ? null : find(e.clientX, e.clientY);
    let result = null;
    if (tg) { const ok = tg.accept(opt.data); result = ok === true ? (tg.drop(opt.data), true) : ok; }
    if (opt.onEnd) opt.onEnd(result, e);
  }
  src.addEventListener('pointermove', move);
  src.addEventListener('pointerup', up);
  src.addEventListener('pointercancel', up);
}
