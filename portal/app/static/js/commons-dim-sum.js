// The checkout result and retry link work without the optional catalogue photograph.
(() => {
  const host = document.querySelector('[data-commons-dish]');
  const catalog = globalThis.TempDeskDimSumCatalog;
  if (!host?.dataset.commonsDish || typeof catalog?.pick !== 'function') return;

  const fallback = host.querySelector('[data-photo-unavailable]');
  const id = host.dataset.commonsDish;
  let active;
  let shown = false;
  function cancel() { active?.abort(); }

  async function show() {
    if (shown) return;
    cancel();
    const controller = new AbortController();
    active = controller;
    fallback.hidden = true;
    let image;
    let deadline;
    function finish(ok) {
      clearTimeout(deadline);
      if (image) {
        image.onload = image.onerror = null;
        if (!ok) image.removeAttribute('src');
      }
      if (active !== controller) return;
      active = null;
      fallback.hidden = ok;
      if (ok) { host.append(image); shown = true; }
    }
    controller.signal.addEventListener('abort', () => finish(false), { once: true });
    try {
      const dish = await catalog.pick({ id, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (dish?.id !== id || !dish.photoUrl) { finish(false); return; }
      const names = host.dataset.mode === 'bi' ? [dish.english, dish.cantonese] :
        [host.dataset.mode === 'zh-HK' ? dish.cantonese : dish.english];
      image = new Image();
      image.alt = names.filter(name => typeof name === 'string' && name.trim()).join(' / ') || host.dataset.photoAlt;
      image.width = 480;
      image.referrerPolicy = 'no-referrer';
      image.decoding = 'async';
      image.onload = () => finish(true);
      image.onerror = () => finish(false);
      deadline = setTimeout(() => controller.abort(), 8000);
      image.src = dish.photoUrl;
    } catch { finish(false); }
  }
  window.addEventListener('pagehide', cancel);
  window.addEventListener('pageshow', event => { if (event.persisted) show(); });
  show();
})();
