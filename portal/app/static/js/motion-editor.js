(() => {
  'use strict';
  const key = 'td.motion.editor.v1';
  const defaults = { duration: 100, curve: 'default' };
  const curves = { default: '', linear: 'linear', gentle: 'ease-in-out', spring: 'cubic-bezier(.2,.9,.25,1.2)' };
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let editor;
  let sampleAnimation;

  const kinds = ["entry", "stagger", "card", "dialog", "menu", "sheet", "tooltip", "toast", "switch", "chart", "progress", "pulse", "tabs", "hover"];
  const timingKey = 'td.motion.elementTiming.v1';
  function loadTiming() {
    try {
      const text = localStorage.getItem(timingKey);
      if (!text || text.length > 4096) return {};
      const data = JSON.parse(text);
      const result = {};
      for (const name of kinds) {
        const item = data[name];
        if (item && typeof item.enabled === 'boolean' && Object.hasOwn(curves, item.ease) &&
            Number.isInteger(item.duration) && item.duration >= 0 && item.duration <= 5000 &&
            Number.isInteger(item.delay) && item.delay >= 0 && item.delay <= 2000) result[name] = item;
      }
      return result;
    } catch { return {}; }
  }
  let timing = loadTiming();
  function applyTiming() {
    for (const name of kinds) {
      const item = timing[name];
      root.toggleAttribute('data-motion-' + name + '-custom', Boolean(item));
      root.toggleAttribute('data-motion-' + name + '-off', Boolean(item && !item.enabled));
      for (const prop of ['duration', 'delay', 'timing-function']) {
        const variable = '--motion-' + name + '-' + prop;
        if (!item) root.style.removeProperty(variable);
        else if (prop === 'timing-function') root.style.setProperty(variable, curves[item.ease] || 'var(--ease)');
        else root.style.setProperty(variable, item[prop] + 'ms');
      }
    }
  }
  applyTiming();
  function read() {
    try {
      const data = JSON.parse(localStorage.getItem(key));
      if (data && Number.isInteger(data.duration) && data.duration >= 25 && data.duration <= 200
          && Object.hasOwn(curves, data.curve)) return data;
    } catch { /* Use defaults when browser storage is unavailable. */ }
    return { ...defaults };
  }

  function apply(settings) {
    for (const [name, base] of Object.entries({ '--dur-fast': 160, '--dur': 280, '--dur-slow': 600 })) {
      root.style.setProperty(name, (base * settings.duration / 100) + 'ms');
    }
    for (const name of ['--ease', '--ease-spring', '--ease-pop']) {
      if (settings.curve === 'default') root.style.removeProperty(name);
      else root.style.setProperty(name, curves[settings.curve]);
    }
    if (editor) {
      editor.querySelector('[data-motion-speed]').value = settings.duration;
      editor.querySelector('[data-motion-value]').value = settings.duration + '%';
      editor.querySelector('[data-motion-curve]').value = settings.curve;
    }
  }

  function updatePreview() {
    const blocked = reduce.matches || ['off', 'reduced'].includes(root.dataset.motion);
    if (blocked && sampleAnimation) sampleAnimation.cancel();
    editor.querySelector('[data-motion-preview]').disabled = blocked;
    const status = editor.querySelector('[data-motion-status]');
    status.textContent = blocked
      ? status.dataset.disabled : '';
  }

  apply(read());
  editor = document.querySelector('[data-motion-editor]');
  if (editor) {
    const duration = editor.querySelector('[data-motion-speed]');
    const curve = editor.querySelector('[data-motion-curve]');
    const kind = editor.querySelector('[data-kind-name]');
    const custom = editor.querySelector('[data-kind-custom]');
    const fields = editor.querySelector('[data-kind-fields]');
    const enabled = editor.querySelector('[data-kind-enabled]');
    const span = editor.querySelector('[data-kind-duration]');
    const delay = editor.querySelector('[data-kind-delay]');
    const easing = editor.querySelector('[data-kind-ease]');
    function showKind() {
      const item = timing[kind.value];
      custom.checked = Boolean(item);
      fields.hidden = !item;
      enabled.checked = item ? item.enabled : true;
      span.value = item ? item.duration : 280;
      delay.value = item ? item.delay : 0;
      easing.value = item ? item.ease : 'default';
    }
    editor.querySelector('[data-kind-editor]').addEventListener('change', event => {
      if (event.target === kind) { showKind(); return; }
      if (!custom.checked) delete timing[kind.value];
      else {
        if (!span.value || !delay.value || !span.reportValidity() || !delay.reportValidity()) return;
        timing[kind.value] = { enabled: enabled.checked, duration: span.valueAsNumber, delay: delay.valueAsNumber, ease: easing.value };
      }
      applyTiming();
      showKind();
      try { localStorage.setItem(timingKey, JSON.stringify(timing)); }
      catch { const status = editor.querySelector('[data-motion-status]'); status.textContent = status.dataset.unavailable; }
    });
    showKind();
    window.addEventListener('storage', event => {
      if (event.key === timingKey || event.key === null) { timing = loadTiming(); applyTiming(); showKind(); }
    });
    function save(settings) {
      apply(settings);
      updatePreview();
      try { localStorage.setItem(key, JSON.stringify(settings)); }
      catch { const status = editor.querySelector('[data-motion-status]'); status.textContent = status.dataset.unavailable; }
    }
    editor.addEventListener('input', event => {
      if (event.target === duration || event.target === curve) save({ duration: Number(duration.value), curve: curve.value });
    });
    editor.querySelector('[data-motion-reset]').addEventListener('click', () => save(defaults));
    editor.querySelector('[data-motion-preview]').addEventListener('click', () => {
      if (sampleAnimation) sampleAnimation.cancel();
      const style = getComputedStyle(root);
      const item = timing[kind.value];
      if (item && !item.enabled) return;
      sampleAnimation = editor.querySelector('.motion-sample').animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(2rem)' }],
        { duration: item ? item.duration : parseFloat(style.getPropertyValue('--dur-slow')),
          delay: item ? item.delay : 0, easing: (item && curves[item.ease]) || style.getPropertyValue('--ease').trim(),
          direction: 'alternate', iterations: 2 });
    });
    reduce.addEventListener('change', updatePreview);
    new MutationObserver(updatePreview).observe(root, { attributes: true, attributeFilter: ['data-motion'] });
    apply(read());
    updatePreview();
  }
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === key) apply(read());
    if (!editor && (event.key === timingKey || event.key === null)) { timing = loadTiming(); applyTiming(); }
  });
})();
