/* Reader appearance is stored on this device. Only the three bounded display values
   below are accepted, and the documentation content is never modified. */
(() => {
  'use strict';
  const site = window.TempDeskSite;
  if (!site) return;
  const key = 'td.readerAppearance.v1';
  const defaults = { accent: '', width: 100, leading: 165 };
  function read() {
    try {
      const saved = JSON.parse(site.LS.get(key, '{}'));
      return {
        accent: typeof saved.accent === 'string' && /^#[0-9a-f]{6}$/i.test(saved.accent) ? saved.accent : '',
        width: Number.isInteger(saved.width) && saved.width >= 40 && saved.width <= 100 ? saved.width : defaults.width,
        leading: Number.isInteger(saved.leading) && saved.leading >= 120 && saved.leading <= 220 ? saved.leading : defaults.leading
      };
    } catch { return { ...defaults }; }
  }
  let settings = read();
  const root = document.documentElement;
  function apply() {
    root.style.setProperty('--reader-measure', settings.width + 'ch');
    root.style.setProperty('--reader-leading', String(settings.leading / 100));
    if (settings.accent) {
      const channels = settings.accent.slice(1).match(/../g).map(hex => {
        const value = parseInt(hex, 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      root.style.setProperty('--primary', settings.accent);
      root.style.setProperty('--on-primary', luminance > 0.179 ? '#000000' : '#ffffff');
    } else {
      root.style.removeProperty('--primary');
      root.style.removeProperty('--on-primary');
    }
  }
  apply();
  function mount() {
    const panel = document.querySelector('#td-settings .sheet-panel');
    if (!panel || document.getElementById('set-reading')) return;
    const h = site.h;
    const labels = [];
    function label(en, zh) {
      const node = h('span', {});
      labels.push([node, en, zh]);
      return node;
    }
    function translate() {
      for (const [el, en, zh] of labels) {
        const lang = site.prefs.lang;
        el.textContent = site.translate(lang === 'zh-HK' ? zh : lang === 'bi' ? en + ' / ' + zh : en);
      }
    }
    const section = h('section', { class: 'set-group reader-settings', id: 'set-reading' });
    section.append(h('h3', {}, [label('Reading appearance', '閱讀外觀')]));
    const status = h('div', {role:'status'});
    const unavailable = label('Storage unavailable. Changes apply only on this page.', '無法儲存。變更只會套用至此頁。');
    const fields = [
      ['accent', 'Accent colour', '強調色', { type: 'color' }],
      ['width', 'Article width', '文章闊度', { type: 'range', min: 40, max: 100 }],
      ['leading', 'Line spacing', '行距', { type: 'range', min: 120, max: 220 }]
    ];
    const controls = [];
    function sync() {
      for (const [name, control, output] of controls) {
        control.value = settings[name] || (/^#[0-9a-f]{6}$/i.test(getComputedStyle(root).getPropertyValue('--primary').trim())
          ? getComputedStyle(root).getPropertyValue('--primary').trim() : '#7cf3e6');
        output.value = name === 'accent' ? control.value : control.value + (name === 'width' ? ' ch' : '%');
      }
    }
    function save() {
      apply();
      sync();
      const ok = site.LS.set(key, JSON.stringify(settings));
      status.replaceChildren();
      if (!ok) {
        status.append(unavailable);
        translate();
      }
    }
    for (const [name, en, zh, attrs] of fields) {
      const control = h('input', attrs);
      const output = h('output', {});
      control.addEventListener('input', () => {
        settings[name] = name === 'accent' ? control.value : control.valueAsNumber;
        save();
      });
      controls.push([name, control, output]);
      section.append(h('label', {}, [label(en, zh), control, output]));
    }
    const reset = h('button', { type: 'button', class: 'btn btn-ghost' }, [label('Reset reading appearance', '重設閱讀外觀')]);
    reset.addEventListener('click', () => { settings = { ...defaults }; save(); });
    section.append(reset, status);
    document.getElementById('set-size').after(section);
    site.onLang(translate);
    translate();
    sync();
    window.addEventListener('storage', event => {
      if (event.key === key || event.key === null) { settings = read(); apply(); sync(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
  else mount();
})();
