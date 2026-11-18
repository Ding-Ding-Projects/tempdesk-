(() => {
  'use strict';
  const key = 'td.elementStyles.v1';
  const selectors = {
    card: '.card', button: '.btn', input: '.field input:not([type=range]):not([type=checkbox]):not([type=color]), .field select, .field textarea',
    dialog: 'dialog', menu: '.menu-pop, .ctx-menu', notice: '.toast'
  };
  const editor = document.querySelector('[data-style-editor]');

  function read() {
    try {
      const text = localStorage.getItem(key);
      if (!text || text.length > 4096) return {};
      const source = JSON.parse(text);
      const settings = {};
      for (const target of Object.keys(selectors)) {
        const item = source[target];
        if (!item || typeof item !== 'object') continue;
        const safe = {};
        if (Number.isInteger(item.radius) && item.radius >= 0 && item.radius <= 48) safe.radius = item.radius;
        if (Number.isInteger(item.width) && item.width >= 0 && item.width <= 8) safe.width = item.width;
        if (typeof item.color === 'string' && /^#[0-9a-f]{6}$/i.test(item.color)) safe.color = item.color;
        if (Object.keys(safe).length) settings[target] = safe;
      }
      return settings;
    } catch { return {}; }
  }

  let settings = read();
  function draw() {
    const root = document.documentElement;
    for (const target of Object.keys(selectors)) {
      const item = settings[target] || {};
      for (const name of ['radius', 'width', 'color']) {
        const flag = 'data-style-' + target + '-' + name;
        const property = '--style-' + target + '-' + name;
        root.toggleAttribute(flag, name in item);
        if (name in item) root.style.setProperty(property, name === 'color' ? item[name] : item[name] + 'px');
        else root.style.removeProperty(property);
      }
    }
  }
  draw();

  if (editor) {
    const target = editor.querySelector('[data-style-target]');
    const controls = Object.fromEntries(['radius', 'width', 'color'].map(name =>
      [name, editor.querySelector('[data-style-' + name + ']')]));
    function refresh() {
      const item = settings[target.value] || {};
      const example = document.querySelector(selectors[target.value]);
      const style = example && getComputedStyle(example);
      const rgb = style && /^rgb\((\d+), (\d+), (\d+)\)$/.exec(style.borderTopColor);
      controls.radius.value = item.radius ?? (style ? parseFloat(style.borderTopLeftRadius) : 0);
      controls.width.value = item.width ?? (style ? parseFloat(style.borderTopWidth) : 1);
      controls.color.value = item.color ?? (rgb ? '#' + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('') : '#7cf3e6');
      for (const name of ['radius', 'width']) {
        editor.querySelector('[data-style-' + name + '-value]').value =
          name in item ? item[name] + ' px' : '—';
      }
    }
    function persist() {
      draw();
      refresh();
      const status = editor.querySelector('[data-style-status]');
      try { localStorage.setItem(key, JSON.stringify(settings)); status.textContent = ''; }
      catch { status.textContent = status.dataset.storageUnavailable; }
    }
    target.addEventListener('change', refresh);
    for (const [name, control] of Object.entries(controls)) {
      control.addEventListener('input', () => {
        settings[target.value] = { ...settings[target.value], [name]: name === 'color' ? control.value : Number(control.value) };
        persist();
      });
    }
    editor.querySelector('[data-style-reset]').addEventListener('click', () => {
      delete settings[target.value];
      persist();
    });
    refresh();
    window.addEventListener('storage', event => {
      if (event.key === key || event.key === null) { settings = read(); draw(); refresh(); }
    });
  } else {
    window.addEventListener('storage', event => {
      if (event.key === key || event.key === null) { settings = read(); draw(); }
    });
  }
})();
