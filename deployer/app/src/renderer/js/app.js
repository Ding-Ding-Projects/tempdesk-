// TempDesk Deployer renderer: shell (title bar, navigation rail, tabs), settings application,
// language and wording, command palette, notifications, updates, onboarding and global shortcuts.
import { h, t, state, btn, iconBtn, icon, toast, announce, onNotify, dialog, play, celebrate, pulseFocus, searchBox, contextMenu, fmtTime } from './ui.js';
import { PAGES, registerActions, ACTIONS } from './pages.js';
import { runOnboarding } from './onboarding.js';

const Core = window.TempDeskCore;
const Wording = window.TempDeskWording;
const td = window.td;

const app = {
  info: null, settings: null, catalogs: {}, page: 'deploy', tabs: { open: [], active: null }, wording: null, wordingFile: null, back: false,
  palette: null, update: null
};
window.TempDeskApp = app;

// The hosted builder frame reads these through window.parent.
window.TempDeskHost = {
  settings: () => app.settings,
  motionOff: () => state.motionOff,
  wording: () => (app.wording && !state.school.enabled ? app.wording : null),
  toast: (m) => toast(m),
  palette: () => openPalette(),
  historyChanged: () => document.dispatchEvent(new CustomEvent('td:history'))
};

async function loadCatalog(lang) {
  const r = await fetch('vendor/i18n/' + lang + '.json');
  return r.json();
}

function effectiveLanguage() { return state.school.enabled ? 'en' : app.settings.language; }
function makeT() {
  const wording = app.wording && !state.school.enabled ? app.wording : null;
  const funny = state.school.enabled ? 0 : app.settings.funny;
  state.t = Core.makeTranslator({ catalogs: app.catalogs, mode: effectiveLanguage(), funny, wording });
}

function applyAppearance() {
  const s = app.settings, root = document.documentElement;
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = s.theme === 'system' ? (sysDark ? 'dark' : 'light') : s.theme;
  root.dataset.density = s.density;
  root.style.setProperty('--text-scale', String(s.textScale / 100));
  root.style.setProperty('--r', s.radius + 'px');
  const light = root.dataset.theme === 'light';
  const accent = s.accent || '#7CF3E6';
  // In light mode a bright accent is darkened until it reaches 4.5:1 on the light ground.
  let a = accent;
  if (light) { let k = 0; while (Core.contrast(a, '#F4F8F7') < 4.5 && k < 20) { a = Core.mix(a, '#000000', 0.08); k++; } }
  root.style.setProperty('--primary', a);
  root.style.setProperty('--on-primary', Core.onColor(a));
  const rgb = Core.parseHex(a);
  root.style.setProperty('--primary-soft', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.14)');
  root.style.setProperty('--primary-glow', 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',.45)');
  const hc = s.highContrast === 'on' || (s.highContrast === 'system' && (app.info.highContrast || window.matchMedia('(forced-colors: active)').matches));
  if (hc) root.dataset.contrast = 'high'; else delete root.dataset.contrast;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  state.motionOff = s.motion === 'off' || (s.motion === 'system' && (reduce || app.info.animations === false));
  root.dataset.motion = state.motionOff ? 'off' : 'on';
  root.lang = effectiveLanguage() === 'zh-HK' ? 'zh-HK' : 'en';
  document.getElementById('tb-name').textContent = s.appName;
  document.title = s.appName;
  td.invoke['win:title'](s.appName);
  document.getElementById('tb-logo').src = s.logo || 'img/tempdesk.svg';
}

export async function applySettings(patch, label) {
  if (patch) app.settings = await td.invoke['settings:set'](patch, label);
  state.settings = app.settings;
  makeT();
  applyAppearance();
  renderChrome();
  render();
  const fr = document.querySelector('iframe.afb');
  if (fr && fr.contentWindow) fr.contentWindow.postMessage({ type: 'td:settings' }, location.origin);
}
app.applySettings = applySettings;

// ---- personal wording ---------------------------------------------------------------------
function buildWording(text) {
  if (!text) return { fn: null, map: null };
  try { const map = Wording.validate(text); return { fn: Wording.buildTranslator(map), map }; } catch (e) { return { fn: null, map: null }; }
}
export async function applyWordingBytes(bytes) {
  if (state.school.enabled) { toast(t('wording.schoolBlocked'), 'error'); return false; }
  let map;
  try { map = Wording.validate(bytes); } catch (e) {
    play('invalid');
    toast(t('wording.invalid.' + (e.code || 'json'), [e.entry || '']), 'error', { noHistory: false });
    return false;
  }
  const r = await td.invoke['wording:apply'](bytes);
  if (!r.ok) { play('invalid'); toast(t('wording.invalid.' + r.code, [r.entry || '']), 'error'); return false; }
  app.wording = Wording.buildTranslator(map);
  app.wordingMap = map;
  await applySettings();
  const headline = map.get('private vocabulary') || t('wording.applied');
  if (state.settings.sounds) play('tada');
  celebrate(headline);
  return true;
}
app.applyWordingBytes = applyWordingBytes;
export async function clearWording() {
  await td.invoke['wording:clear']();
  app.wording = null; app.wordingMap = null;
  await applySettings();
  toast(t('wording.cleared'), 'success');
}
app.clearWording = clearWording;

// Drag and drop a wording file (or a file for the Base64 toolkit) anywhere on the window.
function setupDrop() {
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer || !e.dataTransfer.files.length) return;
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (app.page === 'base64' && app.onBase64Drop) { app.onBase64Drop(f); return; }
    if (/\.json$/i.test(f.name)) {
      if (f.size > 256 * 1024) { play('invalid'); toast(t('wording.invalid.size'), 'error'); return; }
      const bytes = new Uint8Array(await f.arrayBuffer());
      // A dropped JSON file is treated as personal wording only when it has that schema.
      let looks = false;
      try { const j = JSON.parse(new TextDecoder().decode(bytes)); looks = j && typeof j === 'object' && 'entries' in j; } catch (x) { looks = true; }
      if (looks) { await applyWordingBytes(bytes); return; }
      toast(t('drop.notWording'), 'error');
    } else toast(t('drop.unknown'), 'error');
  });
}

// ---- chrome: rail, title bar actions, tabs -------------------------------------------------
const NAV = [
  ['deploy', 'deploy'], ['answers', 'answers'], ['deployments', 'deployments'], ['portals', 'portals'], ['base64', 'tools'], ['history', 'history'], ['settings', 'settings'], ['help', 'help']
];
function renderChrome() {
  const rail = document.getElementById('rail');
  const ind = document.getElementById('rail-ind');
  rail.replaceChildren(ind);
  NAV.forEach(([id, ic], i) => {
    if (id === 'settings') rail.appendChild(h('span', { class: 'spacer' }));
    const b = h('button', { type: 'button', 'aria-current': app.page === id ? 'page' : null, 'data-page': id, 'aria-label': t('nav.' + id), title: t('nav.' + id) + (i < 8 ? ' (Ctrl+' + (i + 1) + ')' : '') }, [h('span', { class: 'pill' }, [icon(ic)]), h('span', { text: t('nav.' + id + '.short') })]);
    b.addEventListener('click', () => go(id));
    b.addEventListener('keydown', (e) => {
      const all = [...rail.querySelectorAll('button')];
      const k = all.indexOf(b);
      if (e.key === 'ArrowDown') { e.preventDefault(); all[(k + 1) % all.length].focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); all[(k - 1 + all.length) % all.length].focus(); }
    });
    contextMenu(b, () => [{ label: t('ctx.open'), kbd: 'Ctrl+' + (i + 1), run: () => go(id) }, { label: t('ctx.palette'), kbd: 'Ctrl+Shift+F', run: openPalette }]);
    rail.appendChild(b);
  });
  requestAnimationFrame(moveIndicator);
  const ver = app.info.build;
  document.getElementById('tb-ver').textContent = ver.version;
  document.getElementById('tb-ver').title = t('about.provenance', [ver.version, (ver.commit || '').slice(0, 12), ver.builtUtc]);
  const acts = document.getElementById('tb-actions');
  const unread = state.notifications.filter((n) => !n.read).length;
  acts.replaceChildren(
    iconBtn('undo', t('hist.undo') + ' (Ctrl+Z)', () => doUndo(), { class: 'tb-btn', id: 'tb-undo' }),
    iconBtn('redo', t('hist.redo') + ' (Ctrl+Y)', () => doRedo(), { class: 'tb-btn', id: 'tb-redo' }),
    h('button', { type: 'button', class: 'tb-btn', onclick: openPalette, 'aria-label': t('palette.open'), title: t('palette.open') + ' (Ctrl+Shift+F)' }, [icon('search'), h('span', { text: t('palette.short') }), h('span', { class: 'kbd', text: 'Ctrl+Shift+F' })]),
    h('button', { type: 'button', class: 'tb-btn', onclick: openNotifications, 'aria-label': t('notif.open', [unread]), title: t('notif.title') }, [icon('bell'), unread ? h('span', { class: 'badge', text: String(unread) }) : null])
  );
  renderTabs();
  renderBanner();
}
function moveIndicator() {
  const ind = document.getElementById('rail-ind');
  const cur = document.querySelector('.rail button[aria-current="page"] .pill');
  if (!cur) { ind.style.opacity = '0'; return; }
  const rail = document.getElementById('rail');
  ind.style.opacity = '1';
  ind.style.transform = 'translateY(' + (cur.getBoundingClientRect().top - rail.getBoundingClientRect().top + rail.scrollTop) + 'px)';
}

function renderTabs() {
  const el = document.getElementById('tabs');
  el.replaceChildren();
  app.tabs.open.forEach((name, i) => {
    const sel = app.page === 'deployment' && app.tabs.active === name;
    const tab = h('div', { class: 'tab', role: 'tab', 'aria-selected': String(sel), tabindex: sel || (!app.tabs.active && i === 0) ? '0' : '-1', draggable: 'true', 'data-name': name, title: name }, [
      h('span', { class: 'tname', text: name }),
      h('button', { type: 'button', class: 'tclose', 'aria-label': t('tabs.close', [name]), title: t('tabs.close', [name]) + ' (Ctrl+W)', onclick: (e) => { e.stopPropagation(); closeTab(name); } }, [icon('close')])]);
    tab.addEventListener('click', () => openTab(name));
    tab.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); closeTab(name); } });
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTab(name); }
      if (e.key === 'Delete') closeTab(name);
      const tabs = [...el.querySelectorAll('.tab')];
      if (e.key === 'ArrowRight') tabs[(i + 1) % tabs.length].focus();
      if (e.key === 'ArrowLeft') tabs[(i - 1 + tabs.length) % tabs.length].focus();
      if (e.ctrlKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); moveTab(name, e.key === 'ArrowLeft' ? -1 : 1); }
    });
    tab.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-td-tab', name); tab.classList.add('dragging'); });
    tab.addEventListener('dragend', () => tab.classList.remove('dragging'));
    tab.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-td-tab')) e.preventDefault(); });
    tab.addEventListener('drop', (e) => {
      const from = e.dataTransfer.getData('text/x-td-tab');
      if (!from || from === name) return;
      e.preventDefault(); e.stopPropagation();
      const list = app.tabs.open.filter((n) => n !== from);
      list.splice(list.indexOf(name) + (e.offsetX > tab.offsetWidth / 2 ? 1 : 0), 0, from);
      app.tabs.open = list; saveTabs(); renderTabs();
    });
    contextMenu(tab, () => [
      { label: t('tabs.open'), kbd: 'Enter', run: () => openTab(name) },
      { label: t('tabs.moveLeft'), kbd: 'Ctrl+Shift+Left', run: () => moveTab(name, -1), disabled: i === 0 },
      { label: t('tabs.moveRight'), kbd: 'Ctrl+Shift+Right', run: () => moveTab(name, 1), disabled: i === app.tabs.open.length - 1 },
      'sep',
      { label: t('tabs.close', [name]), kbd: 'Ctrl+W', run: () => closeTab(name) },
      { label: t('tabs.closeOthers'), run: () => { app.tabs.open = [name]; saveTabs(); renderTabs(); } }]);
    el.appendChild(tab);
  });
}
function saveTabs() { td.invoke['tabs:set'](app.tabs); }
function moveTab(name, d) { const l = app.tabs.open, i = l.indexOf(name), j = i + d; if (j < 0 || j >= l.length) return; l.splice(i, 1); l.splice(j, 0, name); saveTabs(); renderTabs(); const tb = document.querySelector('.tab[data-name="' + CSS.escape(name) + '"]'); if (tb) tb.focus(); }
export function openTab(name) {
  if (!app.tabs.open.includes(name)) app.tabs.open.push(name);
  app.tabs.active = name; saveTabs();
  go('deployment', { name });
}
app.openTab = openTab;
function closeTab(name) {
  const i = app.tabs.open.indexOf(name);
  app.tabs.open = app.tabs.open.filter((n) => n !== name);
  if (app.tabs.active === name) app.tabs.active = app.tabs.open[Math.min(i, app.tabs.open.length - 1)] || null;
  saveTabs();
  if (app.page === 'deployment') { if (app.tabs.active) go('deployment', { name: app.tabs.active }); else go('deployments'); } else renderTabs();
}

function renderBanner() {
  const slot = document.getElementById('banner-slot');
  slot.replaceChildren();
  const u = app.update;
  if (u && u.state === 'ready') {
    slot.appendChild(h('div', { class: 'banner', role: 'region', 'aria-label': t('update.region') }, [
      h('div', { class: 'grow', role: 'status' }, [h('strong', { text: t('update.ready', [u.version]) }), ' ', h('span', { text: t('update.unsigned') })]),
      btn(t('update.restart'), () => td.invoke['update:restart'](), 'btn-primary btn-sm'),
      btn(t('update.later'), () => { app.update = null; renderBanner(); }, 'btn-ghost btn-sm')]));
  }
}

// ---- navigation ---------------------------------------------------------------------------
const ORDER = NAV.map((n) => n[0]);
export function go(page, params) {
  const prev = app.page;
  app.back = ORDER.indexOf(page) >= 0 && ORDER.indexOf(prev) > ORDER.indexOf(page);
  app.page = page; app.params = params || {};
  if (page !== 'deployment') app.tabs.active = page === 'deployment' ? app.tabs.active : app.tabs.active;
  renderChrome();
  render();
  const view = document.getElementById('view');
  view.scrollTop = 0;
  if (!params || !params.keepFocus) view.focus({ preventScroll: true });
  announce(t('nav.' + (page === 'deployment' ? 'deployments' : page)));
}
app.go = go;
let renderToken = 0;
async function render() {
  const view = document.getElementById('view');
  const token = ++renderToken;
  const page = PAGES[app.page] || PAGES.deploy;
  const root = h('div', { class: 'page' + (state.motionOff ? '' : app.back ? ' enter-back' : ' enter') });
  try { await page(root, app); } catch (e) { root.replaceChildren(h('div', { class: 'notice danger', role: 'alert' }, [h('strong', { text: t('err.page') }), h('p', { text: String(e && e.message || e) })])); console.error(e); }
  if (token !== renderToken) return;
  view.replaceChildren(root);
  if (app.params && app.params.focus) { const el = view.querySelector(app.params.focus); if (el) pulseFocus(el); }
  refreshUndo();
}
app.render = render;

// ---- undo / redo (workspace history, survives restarts) ------------------------------------
async function refreshUndo() {
  try {
    const i = await td.invoke['ws:info']();
    const u = document.getElementById('tb-undo'), r = document.getElementById('tb-redo');
    if (u) u.disabled = !i.canUndo;
    if (r) r.disabled = !i.canRedo;
  } catch (e) { /* ignore */ }
}
app.refreshUndo = refreshUndo;
document.addEventListener('td:history', refreshUndo);
async function afterHistoryMove(r, word) {
  if (!r) { toast(t(word === 'undo' ? 'hist.nothingUndo' : 'hist.nothingRedo')); return; }
  toast(r.title, 'success');
  // Settings come back from the workspace: re-apply them when they changed.
  const snap = await td.invoke['ws:snapshot']();
  if (snap['settings.json']) {
    const s = Object.assign({}, snap['settings.json']); delete s.logo; delete s.schema; delete s.version;
    const cur = app.settings, patch = {};
    Object.keys(s).forEach((k) => { if (JSON.stringify(s[k]) !== JSON.stringify(cur[k]) && k in cur) patch[k] = s[k]; });
    if (Object.keys(patch).length) { app.settings = Object.assign({}, cur, patch); await td.invoke['settings:set'](patch, null).catch(() => {}); }
  }
  await applySettings();
}
async function doUndo() {
  const fr = document.querySelector('iframe.afb');
  if (app.page === 'answers' && fr && fr.contentDocument) { fr.contentDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); return; }
  await afterHistoryMove(await td.invoke['ws:undo'](), 'undo');
}
async function doRedo() {
  const fr = document.querySelector('iframe.afb');
  if (app.page === 'answers' && fr && fr.contentDocument) { fr.contentDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })); return; }
  await afterHistoryMove(await td.invoke['ws:redo'](), 'redo');
}
app.undo = doUndo; app.redo = doRedo;

// ---- command palette (Ctrl+Shift+F) ---------------------------------------------------------
function paletteItems(q, regex) {
  const items = [];
  NAV.forEach(([id]) => items.push({ title: t('nav.' + id), group: t('palette.pages'), keywords: id, run: () => go(id) }));
  app.tabs.open.forEach((n) => items.push({ title: n, group: t('palette.tabs'), run: () => openTab(n) }));
  ACTIONS().forEach((a) => items.push(a));
  // Answer File Studio results (every setting in every mode) when the studio is open.
  const fr = document.querySelector('iframe.afb');
  if (q && fr && fr.contentWindow && fr.contentWindow.TempDeskStudioPalette) {
    try { fr.contentWindow.TempDeskStudioPalette(q, regex).forEach((x) => items.push({ title: x.label, group: t('studio.title') + (x.sub ? ' · ' + x.sub : ''), run: () => { if (x.action) x.action(); else if (x.href) fr.contentWindow.location.hash = x.href.split('#')[1] || ''; } })); } catch (e) { /* ignore */ }
  }
  // Every labelled control currently on the page (fields carry data-palette).
  document.querySelectorAll('#view [data-palette]').forEach((el) => {
    items.push({ title: el.getAttribute('data-palette'), group: t('palette.onPage'), run: () => pulseFocus(el) });
  });
  return items;
}
function openPalette() {
  if (app.palette) { app.palette.querySelector('input').focus(); return; }
  const prev = document.activeElement;
  let items = paletteItems(), sel = 0, shown = [];
  const list = h('ul', { role: 'listbox', id: 'pal-list', 'aria-label': t('palette.results') });
  const sb = searchBox({ label: t('palette.label'), placeholder: t('palette.placeholder'), onChange: draw, count: () => ({ items: shown.length, matches: shown.length }) });
  sb.input.setAttribute('role', 'combobox'); sb.input.setAttribute('aria-controls', 'pal-list'); sb.input.setAttribute('aria-expanded', 'true');
  const box = h('div', { class: 'box', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('palette.label') }, [sb, list, h('div', { class: 'small muted', style: { padding: '8px 16px' }, text: t('palette.help') })]);
  const wrap = h('div', { class: 'palette' }, [box]);
  function close() { wrap.remove(); app.palette = null; if (prev && prev.focus) prev.focus(); }
  function draw(m) {
    const q = sb.input.value;
    const rxOn = sb.querySelector('.rx').getAttribute('aria-pressed') === 'true';
    if (document.querySelector('iframe.afb')) items = paletteItems(q, rxOn);
    const matcher = m || sb.matcher();
    shown = !q ? items.slice(0, 60) : matcher.ok && /[\\^$|()[\]{}*+?]/.test(q) && sb.querySelector('.rx').getAttribute('aria-pressed') === 'true'
      ? items.filter((it) => Core.testMatch(it.title + ' ' + (it.group || ''), matcher)).slice(0, 60)
      : Core.rankItems(q, items, 60);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((it, i) => {
      const li = h('li', { role: 'option', id: 'pal-' + i, 'aria-selected': String(i === sel) }, [h('span', { class: 't', text: it.title })]);
      if (it.toggle) {
        const sw = h('input', { type: 'checkbox', class: 'switch', checked: it.toggle.get(), 'aria-label': it.title, tabindex: '-1' });
        sw.addEventListener('click', async (e) => { e.stopPropagation(); await it.toggle.set(sw.checked); items = paletteItems(); });
        li.appendChild(sw);
      }
      li.appendChild(h('span', { class: 'grp', text: it.group || '' }));
      li.addEventListener('click', () => choose(i));
      li.addEventListener('mousemove', () => { if (sel !== i) { sel = i; mark(); } });
      return li;
    }));
    sb.input.setAttribute('aria-activedescendant', shown.length ? 'pal-' + sel : '');
    if (!shown.length) list.appendChild(h('li', { 'aria-disabled': 'true', text: t('palette.none') }));
  }
  function mark() { [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === sel))); sb.input.setAttribute('aria-activedescendant', 'pal-' + sel); const c = list.children[sel]; if (c) c.scrollIntoView({ block: 'nearest' }); }
  async function choose(i) {
    const it = shown[i]; if (!it) return;
    if (it.toggle) { await it.toggle.set(!it.toggle.get()); items = paletteItems(); draw(); return; }
    close(); await it.run();
  }
  sb.input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.body.appendChild(wrap);
  app.palette = wrap;
  draw();
  sb.input.focus();
}
app.openPalette = openPalette;

// ---- notification centre ------------------------------------------------------------------
function openNotifications() {
  const old = document.querySelector('.drawer'); if (old) { old.remove(); return; }
  state.notifications.forEach((n) => { n.read = true; });
  const content = h('div', { class: 'content' });
  let matcher = null;
  function draw() {
    const items = state.notifications.filter((n) => !matcher || Core.testMatch(n.text, matcher));
    content.replaceChildren(items.length ? h('div', { class: 'list' }, items.map((n) => h('div', { class: 'item', tabindex: '0' }, [h('div', { class: 'grow' }, [h('div', { class: 'title', text: n.text }), h('div', { class: 'sub', text: fmtTime(n.time) + ' · ' + t('notif.kind.' + (n.kind || 'info')) })])]))) : h('div', { class: 'empty' }, [h('div', { class: 'big', text: t('notif.empty') }), h('p', { text: t('notif.emptyHelp') })]));
  }
  const sb = searchBox({ label: t('notif.search'), onChange: (m) => { matcher = m.ok && !m.empty ? m : null; draw(); }, count: (m) => Core.countMatches(state.notifications.map((n) => n.text), m) });
  const d = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': t('notif.title') }, [h('header', null, [h('h2', { text: t('notif.title'), style: { margin: 0 } }), h('div', { class: 'row' }, [
    btn(t('notif.clear'), () => { state.notifications = []; draw(); renderChrome(); }, 'btn-ghost btn-sm'), iconBtn('close', t('common.close'), () => { d.remove(); renderChrome(); })])]), h('div', { style: { padding: '12px 18px 0' } }, [sb]), content]);
  d.addEventListener('keydown', (e) => { if (e.key === 'Escape') { d.remove(); renderChrome(); } });
  document.body.appendChild(d);
  draw();
  sb.input.focus();
}
app.openNotifications = openNotifications;
onNotify(() => { const b = document.querySelector('#tb-actions .badge'); const unread = state.notifications.filter((n) => !n.read).length; if (b) b.textContent = String(unread); else if (unread) renderChrome(); });

// ---- keyboard -----------------------------------------------------------------------------
function setupKeys() {
  document.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const inField = e.target.matches && e.target.matches('input, textarea, select');
    if (e.ctrlKey && e.shiftKey && k === 'f') { e.preventDefault(); openPalette(); return; }
    if (e.ctrlKey && !e.shiftKey && !e.altKey && /^[1-8]$/.test(e.key)) { e.preventDefault(); go(ORDER[Number(e.key) - 1]); return; }
    if (e.ctrlKey && k === 'w' && app.page === 'deployment' && app.tabs.active) { e.preventDefault(); closeTab(app.tabs.active); return; }
    if (e.ctrlKey && k === 'tab' && app.tabs.open.length) { e.preventDefault(); const l = app.tabs.open, i = l.indexOf(app.tabs.active); openTab(l[(i + (e.shiftKey ? -1 : 1) + l.length) % l.length]); return; }
    if (e.ctrlKey && !inField && ((k === 'z' && !e.shiftKey))) { e.preventDefault(); doUndo(); return; }
    if (e.ctrlKey && !inField && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); return; }
    if (e.key === 'F1') { e.preventDefault(); go('help'); }
  });
  // Typing coalesces into one commit per field: flush on blur.
  document.addEventListener('focusout', (e) => { if (e.target && e.target.matches && e.target.matches('input, textarea')) td.invoke['ws:flush']().then(refreshUndo); });
}

async function init() {
  document.getElementById('win-min').addEventListener('click', () => td.invoke['win:minimize']());
  document.getElementById('win-max').addEventListener('click', () => td.invoke['win:maximize']());
  document.getElementById('win-close').addEventListener('click', () => td.invoke['win:close']());
  document.getElementById('titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) td.invoke['win:maximize'](); });
  app.info = await td.invoke['app:info']();
  app.settings = await td.invoke['settings:get']();
  state.settings = app.settings;
  state.school = await td.invoke['school:get']();
  app.catalogs = { en: await loadCatalog('en'), 'zh-HK': await loadCatalog('zh-HK') };
  const w = buildWording(await td.invoke['wording:get']());
  app.wording = w.fn; app.wordingMap = w.map;
  app.tabs = await td.invoke['tabs:get']();
  makeT();
  applyAppearance();
  ['win-min', 'win-max', 'win-close'].forEach((id, i) => document.getElementById(id).setAttribute('aria-label', t(['win.min', 'win.max', 'win.close'][i])));
  registerActions(app);
  setupKeys();
  setupDrop();
  td.on['update:state']((s) => { app.update = s; if (s.state === 'ready') { toast(t('update.ready', [s.version]) + ' ' + t('update.unsigned'), 'success'); renderBanner(); } });
  td.on['theme:system']((s) => { app.info.highContrast = s.highContrast; applyAppearance(); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', applyAppearance);
  window.addEventListener('resize', moveIndicator);
  if (app.info.workspace && app.info.workspace.kind === 'jsonl') toast(t('hist.noGit'), 'info', { ms: 6000 });
  if (!app.settings.onboarded) { app.page = 'deploy'; renderChrome(); await render(); runOnboarding(app); }
  else go(app.tabs.active && app.tabs.open.includes(app.tabs.active) ? 'deployment' : 'deploy', app.tabs.active ? { name: app.tabs.active } : undefined);
}
init();
