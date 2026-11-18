(() => {
  'use strict';
  const key = 'td.elementStyles.v1';
  const selectors = {
    card: '.card', button: '.btn', input: '.field input:not([type=range]):not([type=checkbox]):not([type=color]), .field select, .field textarea',
    dialog: 'dialog', menu: '.menu-pop, .ctx-menu', notice: '.toast'
  };
  const editor = document.querySelector('[data-style-editor]');

  const fonts = {
    system: 'system-ui, sans-serif', sans: 'Arial, sans-serif',
    serif: 'Georgia, serif', mono: 'ui-monospace, Consolas, monospace'
  };
  const validators = {
    font: n => typeof n === 'string' && Object.hasOwn(fonts, n),
    weight: n => Number.isInteger(n) && n >= 300 && n <= 900 && n % 100 === 0,
    spacing: n => Number.isInteger(n) && n >= 0 && n <= 8,
    radius: n => Number.isInteger(n) && n >= 0 && n <= 48,
    width: n => Number.isInteger(n) && n >= 0 && n <= 8,
    color: n => typeof n === 'string' && /^#[0-9a-f]{6}$/i.test(n)
  };
  function validate(source) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Invalid appearance');
    for (const [target, item] of Object.entries(source)) {
      if (!Object.hasOwn(selectors, target) || !item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('Invalid element');
      }
      for (const [prop, value] of Object.entries(item)) {
        if (!Object.hasOwn(validators, prop) || !validators[prop](value)) throw new Error('Invalid property');
      }
    }
    return source;
  }
  function read() {
    try {
      const text = localStorage.getItem(key);
      if (text && text.length <= 4096) return validate(JSON.parse(text));
    } catch { /* Inaccessible or invalid storage uses the built-in appearance. */ }
    return {};
  }

  let settings = read();
  function draw() {
    const root = document.documentElement;
    for (const target of Object.keys(selectors)) {
      const item = settings[target] || {};
      for (const name of Object.keys(validators)) {
        const flag = 'data-style-' + target + '-' + name;
        const property = '--style-' + target + '-' + name;
        root.toggleAttribute(flag, name in item);
        if (name in item) {
          let value = item[name];
          if (name === 'font') value = fonts[value];
          if (['width', 'radius', 'spacing'].includes(name)) value += 'px';
          root.style.setProperty(property, value);
        }
        else root.style.removeProperty(property);
      }
    }
  }
  draw();

  if (editor) {
    const target = editor.querySelector('[data-style-target]');
    const undo = [];
    const redo = [];
    const undoButton = editor.querySelector('[data-style-undo]');
    const redoButton = editor.querySelector('[data-style-redo]');
    const status = editor.querySelector('[data-style-status]');
    let lastSaved = JSON.stringify(settings);
    const controls = Object.fromEntries(Object.keys(validators).map(name =>
      [name, editor.querySelector('[data-style-' + name + ']')]));
    function refresh() {
      undoButton.disabled = !undo.length;
      redoButton.disabled = !redo.length;
      const item = settings[target.value] || {};
      const example = document.querySelector(selectors[target.value]);
      const style = example && getComputedStyle(example);
      const rgb = style && /^rgb\((\d+), (\d+), (\d+)\)$/.exec(style.borderTopColor);
      controls.radius.value = item.radius ?? (style ? parseFloat(style.borderTopLeftRadius) : 0);
      controls.width.value = item.width ?? (style ? parseFloat(style.borderTopWidth) : 1);
      controls.color.value = item.color ?? (rgb ? '#' + rgb.slice(1).map(n => Number(n).toString(16).padStart(2, '0')).join('') : '#7cf3e6');
      controls.font.value = item.font || '';
      controls.weight.value = item.weight ?? Math.min(900, Math.max(300, Math.round((parseFloat(style?.fontWeight) || 400) / 100) * 100));
      controls.spacing.value = item.spacing ?? (parseFloat(style?.letterSpacing) || 0);
      for (const name of ['radius', 'width', 'weight', 'spacing']) {
        editor.querySelector('[data-style-' + name + '-value]').value =
          name in item ? item[name] + ' px' : '—';
      }
    }
    function persist(remember = true) {
      const next = JSON.stringify(settings);
      if (remember && next !== lastSaved) {
        undo.push(lastSaved);
        if (undo.length > 100) undo.shift();
        redo.length = 0;
      }
      lastSaved = next;
      draw();
      refresh();
      try { localStorage.setItem(key, JSON.stringify(settings)); status.textContent = ''; }
      catch { status.textContent = status.dataset.storageUnavailable; }
    }
    function restore(from, to) {
      if (!from.length) return;
      to.push(lastSaved);
      settings = JSON.parse(from.pop());
      persist(false);
    }
    undoButton.addEventListener('click', () => restore(undo, redo));
    redoButton.addEventListener('click', () => restore(redo, undo));
    editor.querySelector('[data-style-export]').addEventListener('click', () => {
      const file = new Blob([JSON.stringify({ version: 1, elements: settings }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'tempdesk-appearance.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    const upload = editor.querySelector('[data-style-import]');
    let readGeneration = 0;
    upload.addEventListener('change', async () => {
      const generation = ++readGeneration;
      const file = upload.files[0];
      if (!file) return;
      try {
        if (file.size > 8192) throw new Error('Oversize');
        const profile = JSON.parse(await file.text());
        if (generation !== readGeneration) return;
        if (profile.version !== 1) throw new Error('Unknown version');
        settings = validate(profile.elements);
        persist();
      } catch {
        if (generation === readGeneration) status.textContent = status.dataset.invalid;
      } finally {
        if (generation === readGeneration) upload.value = '';
      }
    });
    target.addEventListener('change', refresh);
    for (const [name, control] of Object.entries(controls)) {
      control.addEventListener('input', () => {
        const item = { ...settings[target.value] };
        if (name === 'font' && !control.value) delete item.font;
        else item[name] = ['font', 'color'].includes(name) ? control.value : Number(control.value);
        settings[target.value] = item;
        persist();
      });
    }
    editor.querySelector('[data-style-reset]').addEventListener('click', () => {
      delete settings[target.value];
      persist();
    });
    refresh();
    window.addEventListener('storage', event => {
      if (event.key === key || event.key === null) {
        settings = read();
        lastSaved = JSON.stringify(settings);
        undo.length = redo.length = 0;
        readGeneration++;
        draw();
        refresh();
      }
    });
  } else {
    window.addEventListener('storage', event => {
      if (event.key === key || event.key === null) { settings = read(); draw(); }
    });
  }
})();
