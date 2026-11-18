(() => {
  'use strict';
  const key = 'td.motion.editor.v1';
  const defaults = { duration: 100, curve: 'default' };
  const curves = { default: '', linear: 'linear', gentle: 'ease-in-out', spring: 'cubic-bezier(.2,.9,.25,1.2)' };
  const root = document.documentElement;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let editor;
  let sampleAnimation;

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
    editor.querySelector('[data-motion-status]').textContent = blocked
      ? 'Motion preview is disabled by your motion preference. · 你的動態效果設定已停用預覽。' : '';
  }

  apply(read());
  editor = document.querySelector('[data-motion-editor]');
  if (editor) {
    const duration = editor.querySelector('[data-motion-speed]');
    const curve = editor.querySelector('[data-motion-curve]');
    function save(settings) {
      apply(settings);
      updatePreview();
      try { localStorage.setItem(key, JSON.stringify(settings)); }
      catch { editor.querySelector('[data-motion-status]').textContent = 'Storage unavailable. · 無法儲存。'; }
    }
    editor.addEventListener('input', event => {
      if (event.target === duration || event.target === curve) save({ duration: Number(duration.value), curve: curve.value });
    });
    editor.querySelector('[data-motion-reset]').addEventListener('click', () => save(defaults));
    editor.querySelector('[data-motion-preview]').addEventListener('click', () => {
      if (sampleAnimation) sampleAnimation.cancel();
      const style = getComputedStyle(root);
      sampleAnimation = editor.querySelector('.motion-sample').animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(2rem)' }],
        { duration: parseFloat(style.getPropertyValue('--dur-slow')), easing: style.getPropertyValue('--ease').trim(),
          direction: 'alternate', iterations: 2 });
    });
    reduce.addEventListener('change', updatePreview);
    new MutationObserver(updatePreview).observe(root, { attributes: true, attributeFilter: ['data-motion'] });
    apply(read());
    updatePreview();
  }
  window.addEventListener('storage', event => {
    if (event.key === null || event.key === key) apply(read());
  });
})();
