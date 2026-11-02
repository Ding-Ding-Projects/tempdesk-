// Settings: every setting has a one-line explanation and an info button; the search box filters
// rows (plain or regex). Includes the appearance editor (accent wheel, hex, contrast check,
// radius, density, text scale, theme, logo), language, funny level, personal wording, school
// mode, sounds, updates, Git remote, import/export and backup.
import { h, t, state, btn, toast, dialog, superConfirm, promptDialog, info, searchBox, select, play } from './ui.js';

const td = window.td;
const Core = window.TempDeskCore;

function row(id, label, help, control, keywords) {
  control.id = control.id || id;
  if (!control.getAttribute('aria-label') && control.tagName !== 'DIV') control.setAttribute('aria-describedby', id + '-h');
  return h('div', { class: 'field set-row', 'data-palette': label, 'data-row': id, 'data-keywords': keywords || '' }, [
    h('div', { class: 'lab' }, [control.tagName === 'DIV' ? h('span', { text: label }) : h('label', { for: control.id, text: label }), info('info.' + id, label)]),
    h('div', { class: 'help', id: id + '-h', text: help }), control]);
}
function sw(checked, onchange, label) { const s = h('input', { type: 'checkbox', class: 'switch', checked, 'aria-label': label }); s.addEventListener('change', () => onchange(s.checked)); return s; }

export async function settingsPage(root, app) {
  const s = app.settings;
  const school = state.school;
  const set = (patch, labelKey, v) => app.applySettings(patch, t('hist.setField', [t(labelKey), String(v)]));
  const sections = [];
  const sec = (key, rows) => { sections.push(h('section', { class: 'card', 'aria-labelledby': 'sec-' + key, 'data-sec': key }, [h('h2', { id: 'sec-' + key, text: t('set.sec.' + key) })].concat(rows))); };

  // Appearance
  const hex = h('input', { type: 'text', class: 'mono', value: s.accent, maxlength: '7', style: { maxWidth: '140px' } });
  const swatch = h('div', { class: 'swatch', style: { background: s.accent } });
  const contrast = h('div', { class: 'small', 'aria-live': 'polite' });
  const wheel = h('div', { class: 'wheel', role: 'slider', tabindex: '0', 'aria-label': t('set.accentWheel'), 'aria-valuemin': '0', 'aria-valuemax': '360' });
  const knob = h('span', { class: 'knob' });
  wheel.appendChild(knob);
  function showAccent(c) {
    const hsv = Core.rgbToHsv(Core.parseHex(c));
    const r = 100, ang = hsv.h * Math.PI / 180;
    knob.style.left = (r + Math.cos(ang) * hsv.s * r) + 'px'; knob.style.top = (r - Math.sin(ang) * hsv.s * r) + 'px';
    knob.style.background = c; swatch.style.background = c; wheel.setAttribute('aria-valuenow', String(Math.round(hsv.h)));
    wheel.setAttribute('aria-valuetext', c + ', ' + Math.round(hsv.h) + '°');
    const dark = Core.contrast(c, '#0B1110'), on = Core.contrast(c, Core.onColor(c));
    contrast.textContent = t('set.contrast', [dark.toFixed(1), on.toFixed(1)]) + ' ' + (dark >= 4.5 && on >= 4.5 ? t('set.contrastOk') : t('set.contrastLow'));
    contrast.style.color = dark >= 4.5 && on >= 4.5 ? 'var(--primary)' : 'var(--coral)';
  }
  let accentTimer = null;
  function pickAccent(c, commit) { hex.value = c; showAccent(c); clearTimeout(accentTimer); accentTimer = setTimeout(() => set({ accent: c }, 'set.accent', c), commit ? 0 : 400); }
  function fromPoint(e) {
    const rc = wheel.getBoundingClientRect(), x = e.clientX - rc.left - 100, y = 100 - (e.clientY - rc.top);
    const sat = Math.min(1, Math.hypot(x, y) / 100), hue = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    pickAccent(Core.toHex(Core.hsvToRgb(hue, sat, 0.95)));
  }
  wheel.addEventListener('pointerdown', (e) => { wheel.setPointerCapture(e.pointerId); fromPoint(e); });
  wheel.addEventListener('pointermove', (e) => { if (e.buttons) fromPoint(e); });
  wheel.addEventListener('keydown', (e) => {
    const hsv = Core.rgbToHsv(Core.parseHex(hex.value));
    const d = { ArrowRight: [5, 0], ArrowLeft: [-5, 0], ArrowUp: [0, .05], ArrowDown: [0, -.05] }[e.key];
    if (!d) return;
    e.preventDefault();
    pickAccent(Core.toHex(Core.hsvToRgb(hsv.h + d[0], Math.max(0, Math.min(1, hsv.s + d[1])), Math.max(.5, hsv.v))));
  });
  hex.addEventListener('input', () => { if (/^#[0-9A-Fa-f]{6}$/.test(hex.value)) pickAccent(hex.value.toUpperCase()); });
  const resetAccent = btn(t('set.accentReset'), () => pickAccent('#7CF3E6', true), 'btn-ghost btn-sm');
  showAccent(s.accent);
  const radius = h('input', { type: 'range', min: '8', max: '32', step: '1', value: String(s.radius) });
  radius.addEventListener('change', () => set({ radius: Number(radius.value) }, 'set.radius', radius.value));
  const scale = h('input', { type: 'range', min: '90', max: '160', step: '10', value: String(s.textScale), 'aria-valuetext': s.textScale + '%' });
  const scaleLab = h('span', { class: 'chip', text: s.textScale + '%' });
  scale.addEventListener('input', () => { scaleLab.textContent = scale.value + '%'; scale.setAttribute('aria-valuetext', scale.value + '%'); });
  scale.addEventListener('change', () => set({ textScale: Number(scale.value) }, 'set.textScale', scale.value + '%'));
  const logoPrev = h('img', { src: s.logo || 'img/tempdesk.svg', alt: '', style: { width: '40px', height: '40px', borderRadius: '10px', objectFit: 'contain', background: 'var(--s0)' } });
  sec('appearance', [
    row('theme', t('set.theme'), t('set.themeHelp'), select([['dark', t('opt.dark')], ['light', t('opt.light')], ['system', t('opt.system')]], s.theme, (v) => set({ theme: v }, 'set.theme', v))),
    row('accent', t('set.accent'), t('set.accentHelp'), h('div', { class: 'row', style: { alignItems: 'flex-start', gap: '18px' } }, [wheel, h('div', { class: 'stack' }, [h('div', { class: 'row' }, [swatch, h('label', { class: 'sr-only', for: 'accent-hex', text: t('set.accentHex') }), Object.assign(hex, { id: 'accent-hex' }), resetAccent]), contrast])]), 'color colour'),
    row('radius', t('set.radius'), t('set.radiusHelp'), radius),
    row('density', t('set.density'), t('set.densityHelp'), select([['compact', t('opt.compact')], ['comfortable', t('opt.comfortable')], ['spacious', t('opt.spacious')]], s.density, (v) => set({ density: v }, 'set.density', v))),
    row('textScale', t('set.textScale'), t('set.textScaleHelp'), h('div', { class: 'row' }, [Object.assign(scale, { id: 'textScale-in', 'aria-label': t('set.textScale') }), scaleLab])),
    row('highContrast', t('set.highContrast'), t('set.highContrastHelp'), select([['system', t('opt.system')], ['on', t('opt.on')], ['off', t('opt.off')]], s.highContrast, (v) => set({ highContrast: v }, 'set.highContrast', v))),
    row('motion', t('set.motion'), t('set.motionHelp'), select([['system', t('opt.motionSystem')], ['on', t('opt.on')], ['off', t('opt.off')]], s.motion, (v) => set({ motion: v }, 'set.motion', v)), 'animation'),
    row('appName', t('set.appName'), t('set.appNameHelp'), (() => { const i = h('input', { type: 'text', value: s.appName, maxlength: '40' }); i.addEventListener('change', () => { const v = i.value.trim(); if (!v || /[<>]/.test(v)) { toast(t('set.appNameBad'), 'error'); i.value = s.appName; return; } set({ appName: v }, 'set.appName', v); }); return i; })(), 'rename title'),
    row('logo', t('set.logo'), t('set.logoHelp'), h('div', { class: 'row' }, [logoPrev, btn(t('set.logoPick'), async () => {
      const f = await td.invoke['file:open']({ filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }], maxBytes: 200 * 1024 });
      if (!f || f.cancelled) return;
      if (f.tooLarge) { toast(t('set.logoTooLarge'), 'error'); return; }
      const ext = f.name.split('.').pop().toLowerCase(), mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext];
      const det = window.TempDeskBase64.detectType(f.bytes);
      if (!mime || det.kind !== 'image') { play('invalid'); toast(t('set.logoBad'), 'error'); return; }
      set({ logo: 'data:' + det.mime + ';base64,' + window.TempDeskBase64.encode(f.bytes) }, 'set.logo', f.name);
    }, 'btn-ghost btn-sm'), s.logo ? btn(t('set.logoReset'), () => set({ logo: '' }, 'set.logo', 'default'), 'btn-ghost btn-sm') : null]), 'icon image')
  ]);

  // Language and tone
  const langRows = [row('language', t('set.language'), school.enabled ? t('set.languageSchool') : t('set.languageHelp'), (() => { const x = select([['en', t('lang.en')], ['zh-HK', t('lang.zh-HK')], ['bilingual', t('lang.bilingual')]], school.enabled ? 'en' : s.language, (v) => set({ language: v }, 'set.language', v)); x.disabled = school.enabled; return x; })(), 'cantonese chinese english')];
  if (!school.enabled) {
    const funny = h('input', { type: 'range', min: '0', max: '3', step: '1', value: String(s.funny), 'aria-valuetext': t('funny.' + s.funny) });
    const fl = h('span', { class: 'chip', text: t('funny.' + s.funny) });
    funny.addEventListener('input', () => { fl.textContent = t('funny.' + funny.value); funny.setAttribute('aria-valuetext', t('funny.' + funny.value)); });
    funny.addEventListener('change', () => set({ funny: Number(funny.value) }, 'set.funny', funny.value));
    langRows.push(row('funny', t('set.funny'), t('set.funnyHelp'), h('div', { class: 'row' }, [Object.assign(funny, { id: 'funny-in', 'aria-label': t('set.funny') }), fl]), 'humor humour tone'));
    // Personal wording
    const stateLine = h('div', { class: 'small', role: 'status', text: app.wordingMap ? t('wording.active', [app.wordingMap.size]) : t('wording.none') });
    langRows.push(row('wording', t('set.wording'), t('set.wordingHelp'), h('div', { class: 'stack' }, [stateLine, h('div', { class: 'row' }, [
      btn(t('wording.upload'), async () => { const r = await td.invoke['wording:pick'](); if (!r || r.cancelled) return; if (r.tooLarge) { play('invalid'); toast(t('wording.invalid.size'), 'error'); return; } await app.applyWordingBytes(r.bytes); }, 'btn-primary btn-sm'),
      app.wordingMap ? btn(t('wording.clear'), () => app.clearWording(), 'btn-ghost btn-sm') : null,
      btn(t('wording.schemaBtn'), () => dialog(t('wording.schemaTitle'), () => [h('p', { text: t('wording.schemaHelp') }), h('pre', { class: 'xml', text: '{\n  "schemaVersion": 1,\n  "entries": {\n    "computer": "machine",\n    "private vocabulary": "Wording applied"\n  }\n}' }), h('p', { class: 'small muted', text: t('wording.rules') })]), 'btn-ghost btn-sm')])]), 'vocabulary'));
  }
  sec('language', langRows);

  // Sound
  const vol = h('input', { type: 'range', min: '0', max: '100', step: '5', value: String(s.volume) });
  vol.addEventListener('change', () => { set({ volume: Number(vol.value) }, 'set.volume', vol.value); });
  sec('sound', [
    row('sounds', t('set.sounds'), t('set.soundsHelp'), sw(s.sounds, (v) => set({ sounds: v }, 'set.sounds', v), t('set.sounds')), 'audio mute'),
    row('volume', t('set.volume'), t('set.volumeHelp'), h('div', { class: 'row' }, [Object.assign(vol, { id: 'volume-in', 'aria-label': t('set.volume') }), btn(t('set.test'), () => play('done'), 'btn-ghost btn-sm')]))
  ]);

  // School mode (convenience lock)
  sec('school', [h('p', { class: 'notice warn', text: t('school.notSecurity') }),
    row('schoolMode', school.enabled ? school.name : t('set.school'), t('set.schoolHelp'), h('div', { class: 'row' }, school.enabled
      ? [h('span', { class: 'chip ok', text: t('school.on', [school.name]) }), btn(t('school.unlock'), async () => {
        const pin = await promptDialog(t('school.unlock'), t('school.pin'), '', { password: true, numeric: true });
        if (!pin) return;
        const r = await td.invoke['school:disable'](pin);
        if (!r.ok) { play('invalid'); toast(t('school.wrongPin'), 'error'); return; }
        state.school = await td.invoke['school:get'](); toast(t('school.off'), 'success'); app.applySettings();
      }, 'btn-primary btn-sm')]
      : [btn(t('school.enable'), async () => {
        const name = await promptDialog(t('school.enable'), t('school.name'), s.schoolName || t('set.school'), { validate: (v) => v.trim() && v.length <= 40 ? '' : t('school.nameBad') });
        if (!name) return;
        const pin = await promptDialog(t('school.enable'), t('school.newPin'), '', { password: true, numeric: true, validate: (v) => /^\d{4,12}$/.test(v) ? '' : t('school.pinBad') });
        if (!pin) return;
        const pin2 = await promptDialog(t('school.enable'), t('school.repeatPin'), '', { password: true, numeric: true });
        if (pin !== pin2) { toast(t('school.pinMismatch'), 'error'); return; }
        state.school = await td.invoke['school:enable'](pin, name.trim()); await app.applySettings({ schoolName: name.trim() }, t('hist.setField', [t('set.school'), 'on']));
        toast(t('school.on', [name.trim()]), 'success');
      }, 'btn-ghost btn-sm')]), 'classroom lock pin')]);

  // History, Git and updates
  const remote = h('input', { type: 'url', class: 'mono', value: s.gitRemote, placeholder: 'https://github.com/you/tempdesk-workspace.git' });
  const wsInfo = await td.invoke['ws:info']();
  sec('history', [
    h('p', { class: 'small ' + (wsInfo.kind === 'git' ? 'muted' : 'notice warn'), text: wsInfo.kind === 'git' ? t('hist.backendGit') : t('hist.backendJsonl') }),
    row('gitRemote', t('set.gitRemote'), t('set.gitRemoteHelp'), h('div', { class: 'row' }, [Object.assign(remote, { id: 'gitRemote-in', 'aria-label': t('set.gitRemote') }), btn(t('set.gitSave'), async () => {
      const v = remote.value.trim();
      try { await td.invoke['ws:setRemote'](v); await set({ gitRemote: v }, 'set.gitRemote', v || 'none'); toast(t('set.gitSaved'), 'success'); } catch (e) { toast(e.message, 'error'); }
    }, 'btn-ghost btn-sm'), btn(t('set.gitPush'), async () => { try { await td.invoke['ws:push'](); toast(t('set.gitPushed'), 'success'); } catch (e) { toast(t('set.gitPushFailed', [e.message]), 'error'); } }, 'btn-ghost btn-sm', { disabled: !s.gitRemote || wsInfo.kind !== 'git' || undefined })]), 'git push remote'),
    row('updates', t('set.updates'), app.info.updates ? t('set.updatesHelp') : t('set.updatesPortable'), h('div', { class: 'row' }, [sw(s.updates, (v) => set({ updates: v }, 'set.updates', v), t('set.updates')), btn(t('act.checkUpdates'), async () => { const r = await td.invoke['update:check'](); toast(t('update.state.' + r.state, [r.version || '']), r.state === 'error' ? 'error' : 'info'); }, 'btn-ghost btn-sm', { disabled: !app.info.updates || undefined })]), 'squirrel update')
  ]);

  // Import, export, backup, reset
  sec('data', [
    row('settingsIo', t('set.settingsIo'), t('set.settingsIoHelp'), h('div', { class: 'row' }, [btn(t('set.export'), async () => { const r = await td.invoke['settings:export'](); if (r.ok) toast(t('export.saved', [r.path]), 'success'); }, 'btn-ghost btn-sm'), btn(t('set.import'), async () => {
      const r = await td.invoke['settings:import']();
      if (r.cancelled) return;
      if (!r.ok) { play('invalid'); toast(t('import.settingsBad', [r.key || r.error]), 'error'); return; }
      app.settings = r.settings; app.applySettings(); toast(t('import.settingsDone'), 'success');
    }, 'btn-ghost btn-sm')])),
    row('backup', t('set.backup'), t('set.backupHelp'), h('div', { class: 'row' }, [btn(t('act.backup'), async () => { const r = await td.invoke['backup:export'](); if (r.ok) toast(t('backup.saved', [r.path]), 'success'); }, 'btn-primary btn-sm'), btn(t('backup.restore'), async () => {
      const ok = await superConfirm({ title: t('backup.restoreTitle'), danger: t('backup.restoreWarn'), word: 'RESTORE', action: t('backup.restoreHold') });
      if (!ok) return;
      const r = await td.invoke['backup:import']();
      if (r.cancelled) return;
      if (!r.ok) { play('invalid'); toast(t('backup.restoreBad', [t('err.' + r.error)]), 'error'); return; }
      toast(t('backup.restored', [r.count]), 'success'); app.settings = await td.invoke['settings:get'](); app.applySettings();
    }, 'btn-ghost btn-sm')]), 'zip restore'),
    row('onboarding', t('set.onboarding'), t('set.onboardingHelp'), btn(t('set.onboardingRun'), () => app.applySettings({ onboarded: false, onboarding: { step: 0, path: s.onboarding.path, skipped: [] } }, t('hist.onboarding')).then(() => import('./onboarding.js').then((m) => m.runOnboarding(app))), 'btn-ghost btn-sm'))
  ]);

  // About and provenance
  const b = app.info.build;
  sec('about', [h('table', { class: 'table' }, [h('tbody', null, [[t('about.name'), s.appName], [t('about.version'), b.version], [t('about.commit'), b.commit], [t('about.built'), b.builtUtc], [t('about.runtime'), 'Electron ' + app.info.versions.electron + ', Node ' + app.info.versions.node], [t('about.data'), app.info.dataRoot], [t('about.signing'), t('about.unsigned')]].map(([k, v]) => h('tr', null, [h('th', { text: k }), h('td', { class: 'mono', text: v })])))])]);

  // Settings search across every row (labels, help and keywords).
  const container = h('div', { class: 'stack' }, sections);
  const rows = () => [...container.querySelectorAll('.set-row')];
  const textOf = (r) => r.getAttribute('data-palette') + ' ' + r.querySelector('.help').textContent + ' ' + r.getAttribute('data-keywords');
  const sb = searchBox({ label: t('set.search'), placeholder: t('set.searchPh'),
    onChange: (m) => { rows().forEach((r) => { r.hidden = !(m.empty || !m.ok ? true : Core.testMatch(textOf(r), m)); }); sections.forEach((sct) => { sct.hidden = !sct.querySelector('.set-row:not([hidden])') && !m.empty && m.ok; }); },
    count: (m) => Core.countMatches(rows().map(textOf), m) });
  app.settingsIndex = rows().map((r) => ({ id: r.querySelector('[id]').id, label: r.getAttribute('data-palette'), keywords: r.getAttribute('data-keywords') }));
  root.appendChild(h('div', { class: 'page-head' }, [h('div', null, [h('h1', { text: t('nav.settings') }), h('p', { class: 'muted', text: t('set.lead') })])]));
  root.appendChild(h('div', { class: 'card flat', style: { marginBottom: '16px' } }, [sb]));
  root.appendChild(container);
}
