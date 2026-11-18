(() => {
  'use strict';
  const storageKey = 'td.panelSizes.v1';
  const matches = '.menu-pop, .http-pop, .ctx-menu';
  const roomy = matchMedia('(min-width: 48rem) and (pointer: fine)');
  const panels = new WeakSet();
  let sizes = {};
  function load() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw || raw.length > 32768) return {};
      const values = JSON.parse(raw);
      return values && typeof values === 'object' && !Array.isArray(values) ? values : {};
    } catch { return {}; }
  }
  sizes = load();
  function identity(el) {
    // Keys contain only structural position or stable IDs, never selected records or page URLs.
    const group = el.matches('.ctx-menu') ? 'context' : el.matches('.http-pop') ? 'help' : 'menu';
    const peers = [...document.querySelectorAll(matches)].filter(p => p.classList.contains(el.classList.contains('ctx-menu') ? 'ctx-menu' : el.classList.contains('http-pop') ? 'http-pop' : 'menu-pop'));
    return group + '-' + peers.indexOf(el);
  }
  function apply(el, width, height) {
    if (!roomy.matches) { el.style.removeProperty('width'); el.style.removeProperty('height'); return; }
    el.style.width = Math.min(innerWidth - 24, Math.max(200, width)) + 'px';
    el.style.height = Math.min(innerHeight - 48, Math.max(96, height)) + 'px';
  }
  function restore(el) {
    const size = sizes[identity(el)];
    if (Array.isArray(size) && size.length === 2 && size.every(n => Number.isInteger(n) && n > 0 && n <= 16384)) apply(el, size[0], size[1]);
    else { el.style.removeProperty('width'); el.style.removeProperty('height'); }
  }
  function save(el, reset) {
    const id = identity(el);
    if (reset) delete sizes[id];
    else {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      sizes[id] = [Math.round(rect.width), Math.round(rect.height)];
    }
    try { localStorage.setItem(storageKey, JSON.stringify(sizes)); } catch { /* Session-only size still applies. */ }
  }
  function bind(el) {
    if (panels.has(el)) return;
    panels.add(el);
    restore(el);
    el.addEventListener('pointerdown', event => {
      if (!roomy.matches || event.button !== 0) return;
      const r = el.getBoundingClientRect();
      if (event.clientX < r.right - 18 || event.clientY < r.bottom - 18) return;
      const complete = () => { document.removeEventListener('pointercancel', cancel); save(el, false); };
      const cancel = () => document.removeEventListener('pointerup', complete);
      document.addEventListener('pointerup', complete, { once: true });
      document.addEventListener('pointercancel', cancel, { once: true });
    });
    el.addEventListener('keydown', event => {
      if (!roomy.matches || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey) return;
      const sizesByKey = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
      if (event.key === 'Home') { event.preventDefault(); save(el, true); restore(el); return; }
      if (!Object.hasOwn(sizesByKey, event.key)) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const delta = sizesByKey[event.key];
      apply(el, rect.width + delta[0], rect.height + delta[1]);
      save(el, false);
    });
  }
  document.querySelectorAll(matches).forEach(bind);
  new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches(matches)) bind(node);
      node.querySelectorAll(matches).forEach(bind);
    }
  }).observe(document.body, { childList: true, subtree: true });
  const refresh = () => document.querySelectorAll(matches).forEach(restore);
  roomy.addEventListener('change', refresh);
  window.addEventListener('storage', event => {
    if (event.key === storageKey || event.key === null) { sizes = load(); refresh(); }
  });
})();
