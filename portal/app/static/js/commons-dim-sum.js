// The checkout result and retry link work without the optional catalogue photograph.
(() => {
  const host = document.querySelector('[data-commons-dish]');
  const catalog = globalThis.TempDeskDimSumCatalog;
  if (!host || !host.dataset.commonsDish || typeof catalog?.pick !== 'function') return;

  let pending;
  let image;
  function cancel() {
    pending?.abort();
    if (image && host.hidden) {
      image.onload = image.onerror = null;
      image.removeAttribute('src');
    }
  }
  async function show() {
    if (!host.hidden) return;
    cancel();
    const controller = new AbortController();
    pending = controller;
    try {
      const id = host.dataset.commonsDish;
      const dish = await catalog.pick({ id, signal: controller.signal });
      if (controller.signal.aborted || dish?.id !== id || !dish.photoUrl) return;
      image = new Image();
      image.alt = host.dataset.photoAlt;
      image.referrerPolicy = 'no-referrer';
      image.decoding = 'async';
      image.style.cssText = 'display:block;max-width:100%;width:auto;height:auto;max-height:22rem;object-fit:contain';
      image.onload = () => {
        if (controller.signal.aborted) return;
        image.onload = image.onerror = null;
        host.replaceChildren(image);
        host.hidden = false;
      };
      image.onerror = () => {
        image.onload = image.onerror = null;
        image = null;
      };
      image.src = dish.photoUrl;
    } catch { /* Keep the original result available when the catalogue is offline. */ }
  }
  window.addEventListener('pagehide', cancel);
  window.addEventListener('pageshow', event => { if (event.persisted) show(); });
  show();
})();
