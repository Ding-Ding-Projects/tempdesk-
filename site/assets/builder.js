// TempDesk answer file builder (page logic). All work happens in this browser; nothing is uploaded.
// Pure XML generation lives in answer.js (window.TempDeskAnswer); canvases live in ./canvas/.
import { h, iconButton, clone, ICONS } from './canvas/dom.js';
import { loadCatalog, renderSettings, countSet, isEmpty, searchText, PASSES } from './canvas/catalog.js';
import { mountFlow } from './canvas/flow.js';
import { mountDisk, validateLayout } from './canvas/disk.js';
import { mountCommands } from './canvas/commands.js';
import { mountDeploy } from './canvas/deploy.js';
import { buildIndex, search as searchIndex, problemKeys, filterList, compileQuery } from './canvas/search.js';
import { searchBox, combobox } from './canvas/search-ui.js';

const A = window.TempDeskAnswer, Z = window.TempDeskZip, HI = window.TempDeskHistory, S = window.TempDeskSite;
const t = (k, args, fb) => S.t(k, args, fb);
const LS = S.LS;
const ROOT = S.ROOT;
const isPhone = () => window.matchMedia('(max-width: 760px)').matches;

// ------------------------------------------------------------------------------------------------
// Field registry. Labels: f.<id>. Help: h.<id> (optional). Values: model[mode][id] or model.extras[x].
// ------------------------------------------------------------------------------------------------
const TZ_OPTS = () => A.TIME_ZONES.map(([id, off]) => [id, '(UTC' + off + ') ' + id, true]);
const FIELDS = {
  imageIndex: { type: 'edition' },
  imageBy: { type: 'select', options: [['index', 'opt.imageBy.index'], ['name', 'opt.imageBy.name']] },
  imageName: { type: 'text', show: (f) => f.imageBy === 'name' },
  target: { type: 'select', options: [['client', 'opt.target.client'], ['server', 'opt.target.server']] },
  arch: { type: 'select', options: [['amd64', 'opt.arch.amd64'], ['arm64', 'opt.arch.arm64'], ['x86', 'opt.arch.x86']] },
  firmware: { type: 'select', options: [['uefi', 'opt.uefi'], ['bios', 'opt.bios']] },
  diskLayout: { type: 'select', options: [['uefi', 'opt.layout.uefi'], ['bios', 'opt.layout.bios'], ['existing', 'opt.layout.existing']] },
  diskId: { type: 'text', numeric: true },
  partitionId: { type: 'text', numeric: true, show: (f) => f.diskLayout === 'existing' },
  productKey: { type: 'text', mono: true, placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX-XXXXX' },
  setupLanguage: { type: 'datalist', list: 'dl-locales' },
  locale: { type: 'datalist', list: 'dl-locales' },
  keyboard: { type: 'datalist', list: 'dl-keyboards' },
  timeZone: { type: 'select', options: TZ_OPTS },
  computerName: { type: 'text', mono: true },
  organization: { type: 'text' },
  owner: { type: 'text' },
  adminPassword: { type: 'password' },
  dsrmPassword: { type: 'password' },
  adminUser: { type: 'text' },
  accounts: { type: 'accounts' },
  autoLogonCount: { type: 'text', numeric: true },
  domainName: { type: 'text', mono: true },
  netbiosName: { type: 'text', mono: true },
  functionalLevel: { type: 'select', options: [['', 'opt.fl.default'], ['Win2025', 'opt.fl.win2025']] },
  joinDomain: { type: 'text', mono: true },
  joinUser: { type: 'text' },
  joinPassword: { type: 'password', plain: true },
  ou: { type: 'text', mono: true, placeholderFn: (f) => 'OU=Computers,OU=TempDesk,' + A.domainDn(f.domainName) },
  ipAddress: { type: 'text', mono: true, numeric: true },
  prefixLength: { type: 'text', numeric: true },
  gateway: { type: 'text', mono: true, numeric: true },
  dnsServers: { type: 'text', mono: true },
  dnsMode: { type: 'select', options: [['static', 'opt.dns.static'], ['dhcp', 'opt.dns.dhcp']] },
  dnsServer: { type: 'text', mono: true, show: (f) => f.dnsMode !== 'dhcp' },
  portalsMode: { type: 'select', options: [['none', 'opt.portals.none'], ['native', 'opt.portals.native']] },
  agentTls: { type: 'check' },
  rdp: { type: 'check' },
  edgeFirstRunOff: { type: 'check' },
  features: { type: 'text', mono: true },
  driversPE: { type: 'textarea' },
  driversOffline: { type: 'textarea' },
  oobeHideEULAPage: { type: 'check' }, oobeHideOEMRegistrationScreen: { type: 'check' }, oobeHideOnlineAccountScreens: { type: 'check' },
  oobeHideWirelessSetupInOOBE: { type: 'check' }, oobeHideLocalAccountScreen: { type: 'check' },
  protectYourPC: { type: 'select', options: [['', 'opt.notSet'], ['1', 'opt.pyp.1'], ['2', 'opt.pyp.2'], ['3', 'opt.pyp.3']] },
  // extras (all modes)
  'x.uacOff': { type: 'check' }, 'x.ieEscOff': { type: 'check', serverOnly: true }, 'x.serverManagerOff': { type: 'check', serverOnly: true },
  'x.ceipOff': { type: 'check' }, 'x.werOff': { type: 'check' }, 'x.advertisingIdOff': { type: 'check' },
  'x.telemetry': { type: 'select', options: [['default', 'opt.default'], ['0', 'opt.tel.0'], ['1', 'opt.tel.1']] },
  'x.updates': { type: 'select', options: [['default', 'opt.default'], ['notify', 'opt.upd.notify'], ['off', 'opt.upd.off']] },
  'x.winrm': { type: 'check' }, 'x.sshServer': { type: 'check' },
  'x.powerPlan': { type: 'select', options: [['', 'opt.default'], ['balanced', 'opt.power.balanced'], ['high', 'opt.power.high'], ['saver', 'opt.power.saver']] },
  'x.hibernateOff': { type: 'check' }, 'x.monitorTimeout': { type: 'text', numeric: true },
  'x.ntpServer': { type: 'text', mono: true, placeholder: 'time.windows.com' },
  'x.apps': { type: 'apps' },
  'x.oemManufacturer': { type: 'text' }, 'x.oemModel': { type: 'text' }, 'x.oemSupportUrl': { type: 'text' }, 'x.oemSupportPhone': { type: 'text' }, 'x.oemSupportHours': { type: 'text' }, 'x.oemLogo': { type: 'text', mono: true },
  'x.verboseStatus': { type: 'check' }, 'x.setupLog': { type: 'check' },
  raw: { type: 'raw' }
};
const X = (ids) => ids.map((i) => 'x.' + i);
// About 20 sections, each mapped to real catalog settings for Advanced.
const SECTIONS = [
  { id: 'disk', f: { server: ['firmware'], guest: ['firmware', 'diskId'], custom: ['diskLayout', 'diskId', 'partitionId'] }, canvas: 'disk', adv: [['Microsoft-Windows-Setup', ['DiskConfiguration']]] },
  { id: 'image', f: { server: ['imageIndex'], guest: ['imageIndex', 'arch'], custom: ['target', 'arch', 'imageBy', 'imageIndex', 'imageName'] }, adv: [['Microsoft-Windows-Setup', ['ImageInstall', 'DynamicUpdate', 'ComplianceCheck']]] },
  { id: 'key', f: { all: ['productKey'] }, adv: [['Microsoft-Windows-Setup', ['UserData']], ['Microsoft-Windows-Security-SPP-UX', null], ['Microsoft-Windows-Security-SPP', null]] },
  { id: 'language', f: { server: ['locale', 'keyboard'], guest: ['locale', 'keyboard'], custom: ['setupLanguage', 'locale', 'keyboard'] }, adv: [['Microsoft-Windows-International-Core-WinPE', null], ['Microsoft-Windows-International-Core', null]] },
  { id: 'identity', f: { server: ['computerName'], guest: ['computerName'], custom: ['computerName', 'organization', 'owner'] }, adv: [['Microsoft-Windows-Shell-Setup', ['ComputerName', 'RegisteredOrganization', 'RegisteredOwner']]] },
  { id: 'accounts', f: { server: ['adminPassword', 'dsrmPassword'], guest: ['adminUser', 'adminPassword'], custom: ['adminPassword', 'accounts', 'autoLogonCount'] }, adv: [['Microsoft-Windows-Shell-Setup', ['UserAccounts', 'AutoLogon']]] },
  { id: 'domain', f: { server: ['domainName', 'netbiosName', 'functionalLevel'], guest: ['domainName', 'joinDomain', 'joinUser', 'joinPassword', 'ou'], custom: [] }, adv: [['Microsoft-Windows-UnattendedJoin', null]] },
  { id: 'network', f: { server: ['ipAddress', 'prefixLength', 'gateway', 'dnsServers'], guest: ['dnsMode', 'dnsServer'], custom: [] }, canvas: 'map', adv: [['Microsoft-Windows-TCPIP', null], ['Microsoft-Windows-DNS-Client', null]] },
  { id: 'security', f: { all: X(['uacOff', 'ieEscOff']) }, adv: [['Microsoft-Windows-LUA-Settings', null], ['Networking-MPSSVC-Svc', null], ['Microsoft-Windows-IE-ESC', null]] },
  { id: 'remote', f: { server: ['agentTls'].concat(X(['winrm', 'sshServer'])), guest: X(['winrm', 'sshServer']), custom: ['rdp'].concat(X(['winrm', 'sshServer'])) }, adv: [['Microsoft-Windows-TerminalServices-LocalSessionManager', null], ['Microsoft-Windows-TerminalServices-RDP-WinStationExtensions', null]] },
  { id: 'updates', f: { all: X(['updates']) }, adv: [['Microsoft-Windows-Setup', ['DynamicUpdate']]] },
  { id: 'features', f: { server: ['portalsMode'], guest: [], custom: ['features'] }, adv: [] },
  { id: 'drivers', f: { server: [], guest: [], custom: ['driversPE', 'driversOffline'] }, adv: [['Microsoft-Windows-PnpCustomizationsWinPE', null], ['Microsoft-Windows-PnpCustomizationsNonWinPE', null]] },
  { id: 'apps', f: { server: X(['apps']), guest: X(['apps']), custom: ['edgeFirstRunOff'].concat(X(['apps'])) }, canvas: 'commands', adv: [['Microsoft-Windows-Deployment', ['RunSynchronous', 'RunAsynchronous']], ['Microsoft-Windows-Shell-Setup', ['FirstLogonCommands', 'LogonCommands']]] },
  { id: 'oobe', f: { server: X(['serverManagerOff']), guest: X(['serverManagerOff']), custom: ['oobeHideEULAPage', 'oobeHideOEMRegistrationScreen', 'oobeHideOnlineAccountScreens', 'oobeHideWirelessSetupInOOBE', 'oobeHideLocalAccountScreen', 'protectYourPC'].concat(X(['serverManagerOff'])) }, adv: [['Microsoft-Windows-Shell-Setup', ['OOBE']], ['Microsoft-Windows-ServerManager-SvrMgrNc', null], ['Microsoft-Windows-Deployment', ['Reseal']]] },
  { id: 'power', f: { all: X(['powerPlan', 'hibernateOff', 'monitorTimeout']) }, adv: [['Microsoft-Windows-powercpl', null]] },
  { id: 'privacy', f: { all: X(['telemetry', 'advertisingIdOff', 'ceipOff', 'werOff']) }, adv: [['Microsoft-Windows-SQMApi', null], ['Microsoft-Windows-ErrorReportingCore', null]] },
  { id: 'branding', f: { all: X(['oemManufacturer', 'oemModel', 'oemSupportUrl', 'oemSupportPhone', 'oemSupportHours', 'oemLogo']) }, adv: [['Microsoft-Windows-Shell-Setup', ['OEMInformation', 'Themes']]] },
  { id: 'time', f: { all: ['timeZone'].concat(X(['ntpServer'])) }, adv: [['Microsoft-Windows-Shell-Setup', ['TimeZone', 'DisableAutoDaylightTimeSet']]] },
  { id: 'logging', f: { all: X(['verboseStatus', 'setupLog']) }, adv: [['Microsoft-Windows-Setup', ['LogPath']]] },
  { id: 'raw', f: { all: ['raw'] }, adv: [] }
];
const sectionFields = (sec, mode) => (sec.f.all || sec.f[mode] || []).filter((id) => !(FIELDS[id] && FIELDS[id].serverOnly) || isServerTarget(mode));
const isServerTarget = (mode) => mode === 'server' || (mode === 'custom' && model.custom.target === 'server');
const MODE_TABS = ['server', 'guest', 'custom'];
const TOOL_TABS = ['all', 'flow', 'disk', 'commands', 'map'];
const INFO_TABS = ['plan', 'history'];

// ------------------------------------------------------------------------------------------------
// State
// ------------------------------------------------------------------------------------------------
let model = A.defaultModel();
let catalog = null;
let history = null;
const adv = new Set();
let lastXml = '';
let rules = null; // { parseXml, validateModel, raw catalog } from answerfile/ when the build ships them
let ruleIssues = [];
async function loadRules() {
  if (!catalog || catalog.origin !== 'full' || !catalog.raw) return;
  try {
    const g = await import(new URL(ROOT + 'answerfile/generate.mjs', document.baseURI).href);
    rules = { parseXml: g.parseXml, buildXml: g.buildXml, validateModel: g.validateModel, applyFix: g.applyFix, RULES: g.RULES };
  } catch (e) { rules = null; }
}
function computeIssues() {
  ruleIssues = [];
  if (!rules) return ruleIssues;
  try {
    const parsed = rules.parseXml(A.buildXml(model), catalog.raw);
    ruleIssues = rules.validateModel(parsed.model, catalog.raw).filter((i) => i.level !== 'info');
  } catch (e) { ruleIssues = [{ id: 'xml', level: 'error', where: '', message: e.message }]; }
  return ruleIssues;
}
const remember = () => LS.get('td.rememberPw', '0') === '1';

function getVal(id) { return id.startsWith('x.') ? model.extras[id.slice(2)] : id === 'raw' ? model.raw : model[model.mode][id]; }
function setVal(id, v) { if (id.startsWith('x.')) model.extras[id.slice(2)] = v; else if (id === 'raw') model.raw = v; else model[model.mode][id] = v; }
function label(id) { return t('f.' + id.replace(/^x\./, 'x_')); }

// Secrets: when history is redacted, carry the current passwords across undo/redo/restore.
function mergeSecrets(target, from) {
  const out = clone(target);
  Object.keys(A.SECRET_FIELDS).forEach((m) => A.SECRET_FIELDS[m].forEach((k) => { if (out[m] && !out[m][k] && from[m] && from[m][k]) out[m][k] = from[m][k]; }));
  if (out.custom && from.custom && Array.isArray(out.custom.accounts)) out.custom.accounts.forEach((a, i) => { const f = from.custom.accounts && from.custom.accounts[i]; if (!a.password && f && f.name === a.name) a.password = f.password; });
  Object.keys(out.commands || {}).forEach((k) => (out.commands[k] || []).forEach((it, i) => { const f = from.commands && from.commands[k] && from.commands[k][i]; if (it.credentials && !it.credentials.password && f && f.credentials && f.command === it.command) it.credentials.password = f.credentials.password; }));
  (function walk(a, b) {
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return;
    Object.keys(a).forEach((k) => { if (k === '@password' && !a[k] && b[k]) a[k] = b[k]; else walk(a[k], b[k]); });
  })(out.all, from.all);
  return out;
}
function redact(state) { return remember() ? state : A.stripSecrets(state); }

// Record a change. msg = { key, args }. coalesce = field id for typing.
let gsTimer = null;
function commit(msg, coalesce) {
  if (history) history.change(model, msg, coalesce || null);
  if (gs.q || gs.filter !== 'all') { clearTimeout(gsTimer); gsTimer = setTimeout(renderGlobalResults, 400); }
  schedulePreview();
  updateStatus();
  updateUndo();
}
function applyState(state, from) {
  const r = A.normalizeModel(state);
  if (!r.ok) { S.toast(t('err.model.' + r.error.split('.')[1], null, t('err.badState'))); return; }
  model = mergeSecrets(r.model, from || model);
  renderView();
}
function undo() { if (!history) return; const e = history.undo(); if (e) { applyState(e.state); S.toast(t('hist.undone')); } updateUndo(); }
function redo() { if (!history) return; const e = history.redo(); if (e) { applyState(e.state); S.toast(t('hist.redone')); } updateUndo(); }

// ------------------------------------------------------------------------------------------------
// Studio shell: activity bar, side bar, editor tabs, inspector, bottom panel, status bar
// ------------------------------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const shell = $('#studio');
let mainEl = h('div'), indexEl = h('nav');
const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
document.body.appendChild(live);
function announce(text) { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); }
function btn(key, onclick, cls, extra) { return h('button', Object.assign({ type: 'button', class: 'btn ' + (cls || 'btn-ghost'), onclick }, extra || {}), [t(key)]); }
const outputLog = [];
function output(text) { outputLog.push({ t: Date.now(), text }); if (outputLog.length > 500) outputLog.shift(); if (layout.panel === 'output') renderPanel(); }

// Layout (remembered)
const layout = Object.assign({ side: 'explorer', sideW: 280, inspW: 300, panelH: 220, sideOpen: true, inspOpen: true, panelOpen: true, panel: 'problems', split: false, pane: 'editor' }, (() => { try { return JSON.parse(LS.get('td.studio.layout', '{}')) || {}; } catch (e) { return {}; } })());
function saveLayout() { LS.set('td.studio.layout', JSON.stringify(layout)); }
function applyLayout() {
  shell.style.setProperty('--side-w', layout.sideW + 'px');
  shell.style.setProperty('--insp-w', layout.inspW + 'px');
  shell.style.setProperty('--panel-h', layout.panelH + 'px');
  shell.classList.toggle('no-side', !layout.sideOpen);
  shell.classList.toggle('no-insp', !layout.inspOpen);
  shell.classList.toggle('no-panel', !layout.panelOpen);
  shell.dataset.pane = layout.pane;
  document.querySelectorAll('.st-act [data-side]').forEach((b) => b.setAttribute('aria-pressed', String(layout.sideOpen && layout.side === b.dataset.side)));
  document.querySelectorAll('.st-phonebar [data-pane]').forEach((b) => b.setAttribute('aria-pressed', String(layout.pane === b.dataset.pane)));
  saveLayout();
}

// Tabs
const TAB_KINDS = ['template', 'new', 'all', 'flow', 'disk', 'commands', 'map', 'plan', 'history', 'xml', 'firstboot', 'compare', 'simulate', 'secrets', 'snippets'];
let tabs = (() => { try { const v = JSON.parse(LS.get('td.studio.tabs', 'null')); return Array.isArray(v) && v.length ? v.filter((x) => typeof x === 'string') : null; } catch (e) { return null; } })() || ['template', 'flow'];
let view = LS.get('td.studio.active', tabs[0]);
if (!tabs.includes(view)) view = tabs[0];
let step = 0;
let selected = null; // { comp, pass, path } for the inspector
function saveTabs() { LS.set('td.studio.tabs', JSON.stringify(tabs)); LS.set('td.studio.active', view); }
function tabTitle(id) {
  if (id === 'template') return t('tab.' + model.mode);
  if (id.startsWith('comp:')) return id.split('|')[1].replace(/^Microsoft-Windows-/, '') + ' (' + id.slice(5).split('|')[0] + ')';
  if (id.startsWith('file:')) return id.slice(5).split('/').pop();
  if (id === 'xml') return 'autounattend.xml';
  if (id === 'firstboot') return 'firstboot.json';
  return t('tab.' + id);
}
function tabIcon(id) {
  if (id === 'xml' || id.startsWith('file:') || id === 'firstboot') return '‹›';
  if (id.startsWith('comp:')) return '▦';
  return { template: '☰', flow: '⇄', disk: '▭', commands: '≡', map: '◎', all: '☷', history: '⧖', compare: '⇌', simulate: '▶', new: '+', plan: '✓', secrets: '•', snippets: '{}' }[id] || '□';
}
function openTab(id, opts) {
  opts = opts || {};
  if (!tabs.includes(id)) { const at = tabs.indexOf(view); tabs.splice(at < 0 ? tabs.length : at + 1, 0, id); }
  view = id;
  if (isPhone()) layout.pane = 'editor';
  saveTabs(); applyLayout();
  renderView();
  if (!opts.noFocus) { const tb = document.getElementById('tab-' + cssId(id)); if (tb) tb.focus({ preventScroll: true }); }
}
const setView = (id, opts) => {
  if (MODE_TABS.includes(id)) { if (model.mode !== id) { model.mode = id; commit({ key: 'hist.mode', args: ['@tab.' + id] }); } return openTab('template', opts); }
  return openTab(id, opts);
};
function closeTab(id) {
  const i = tabs.indexOf(id);
  if (i < 0) return;
  tabs.splice(i, 1);
  if (!tabs.length) tabs.push('new');
  if (view === id) view = tabs[Math.min(i, tabs.length - 1)];
  saveTabs(); renderView();
}
function moveTab(id, d) {
  const i = tabs.indexOf(id), j = i + d;
  if (i < 0 || j < 0 || j >= tabs.length) return;
  [tabs[i], tabs[j]] = [tabs[j], tabs[i]];
  saveTabs(); renderTabs();
  const tb = document.getElementById('tab-' + cssId(id)); if (tb) tb.focus();
}
function cssId(id) { return id.replace(/[^A-Za-z0-9_-]/g, '_'); }
function renderTabs() {
  const strip = $('#st-tabs');
  strip.replaceChildren();
  tabs.forEach((id) => {
    const sel = id === view;
    const tb = h('div', { class: 'st-tab' + (sel ? ' on' : ''), role: 'tab', id: 'tab-' + cssId(id), 'aria-selected': String(sel), 'aria-controls': 'st-editor', tabindex: sel ? '0' : '-1', 'data-tab': id, title: tabTitle(id) }, [
      h('span', { class: 'st-tab-ic', 'aria-hidden': 'true', text: tabIcon(id) }), h('span', { class: 'st-tab-t', text: tabTitle(id) }),
      h('button', { type: 'button', class: 'st-tab-x', 'aria-label': t('studio.closeTab', [tabTitle(id)]), tabindex: '-1', text: '×', onclick: (e) => { e.stopPropagation(); closeTab(id); } })]);
    tb.addEventListener('click', () => { if (view !== id) { view = id; saveTabs(); renderView(); } });
    tb.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(id); });
    tb.addEventListener('keydown', (e) => {
      const ids = tabs, i = ids.indexOf(id);
      if (e.altKey && e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); moveTab(id, e.key === 'ArrowLeft' ? -1 : 1); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = ids[(i + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length]; view = n; saveTabs(); renderView(); const f = document.getElementById('tab-' + cssId(n)); if (f) f.focus(); }
      if (e.key === 'Delete') { e.preventDefault(); closeTab(id); }
    });
    tb.addEventListener('contextmenu', (e) => { e.preventDefault(); contextMenu(e, [['ctx.close', () => closeTab(id)], ['ctx.closeOthers', () => { tabs = [id]; view = id; saveTabs(); renderView(); }], ['ctx.moveLeft', () => moveTab(id, -1)], ['ctx.moveRight', () => moveTab(id, 1)]]); });
    // drag to reorder
    tb.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.st-tab-x')) return;
      const sx = e.clientX; let moved = false;
      const mv = (ev) => {
        if (!moved && Math.abs(ev.clientX - sx) < 8) return;
        moved = true; tb.classList.add('dragging');
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const other = over && over.closest('.st-tab');
        if (other && other !== tb) { const oi = tabs.indexOf(other.dataset.tab), ci = tabs.indexOf(id); tabs.splice(ci, 1); tabs.splice(oi, 0, id); saveTabs(); strip.insertBefore(tb, oi > ci ? other.nextSibling : other); }
      };
      const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); tb.classList.remove('dragging'); };
      document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
    });
    strip.appendChild(tb);
  });
  strip.appendChild(h('button', { type: 'button', class: 'st-tab-new', 'aria-label': t('studio.newTab'), title: t('studio.newTab'), text: '+', onclick: () => openTab('new') }));
  const splitB = $('#st-split');
  if (splitB) { splitB.setAttribute('aria-pressed', String(layout.split)); splitB.disabled = view === 'xml'; }
}

// Context menu (right-click quick actions)
function contextMenu(e, items) {
  document.querySelectorAll('.st-menu').forEach((m) => m.remove());
  const menu = h('ul', { class: 'st-menu', role: 'menu', style: { left: Math.min(e.clientX, innerWidth - 220) + 'px', top: Math.min(e.clientY, innerHeight - items.length * 44 - 10) + 'px' } });
  items.forEach(([k, fn]) => { const li = h('li', { role: 'menuitem', tabindex: '-1', text: t(k) }); li.addEventListener('click', () => { menu.remove(); fn(); }); li.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); li.click(); } }); menu.appendChild(li); });
  menu.addEventListener('keydown', (ev) => {
    const lis = [...menu.children], i = lis.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') { ev.preventDefault(); (lis[i + 1] || lis[0]).focus(); }
    if (ev.key === 'ArrowUp') { ev.preventDefault(); (lis[i - 1] || lis[lis.length - 1]).focus(); }
    if (ev.key === 'Escape') { menu.remove(); }
  });
  document.body.appendChild(menu);
  menu.firstChild.focus();
  setTimeout(() => document.addEventListener('pointerdown', function off(ev) { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', off); } }), 0);
}

// Resizable panels (pointer and keyboard)
function makeSplitter(el, prop, axis, min, max, invert) {
  el.setAttribute('role', 'separator'); el.setAttribute('tabindex', '0');
  el.setAttribute('aria-orientation', axis === 'x' ? 'vertical' : 'horizontal');
  const sync = () => { el.setAttribute('aria-valuenow', String(layout[prop])); el.setAttribute('aria-valuemin', String(min)); el.setAttribute('aria-valuemax', String(max)); };
  sync();
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const start = axis === 'x' ? e.clientX : e.clientY, v0 = layout[prop];
    el.setPointerCapture(e.pointerId);
    const mv = (ev) => { const d = (axis === 'x' ? ev.clientX : ev.clientY) - start; layout[prop] = Math.max(min, Math.min(max, v0 + (invert ? -d : d))); applyLayout(); sync(); };
    const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 40 : 10;
    const dec = axis === 'x' ? 'ArrowLeft' : 'ArrowUp', inc = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
    if (e.key === dec || e.key === inc) { e.preventDefault(); layout[prop] = Math.max(min, Math.min(max, layout[prop] + ((e.key === inc) !== !!invert ? step : -step))); applyLayout(); sync(); }
    if (e.key === 'Home') { layout[prop] = min; applyLayout(); sync(); }
    if (e.key === 'End') { layout[prop] = max; applyLayout(); sync(); }
  });
}

let undoBtn, redoBtn;
function buildTopbar() {
  const fileIn = h('input', { type: 'file', accept: '.xml,.json,application/xml,text/xml,application/json', class: 'sr-only', id: 'b-import-file', 'aria-label': t('tb.import') });
  fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) importFile(f); });
  undoBtn = h('button', { type: 'button', class: 'iconbtn', html: ICONS.left, 'aria-label': t('tb.undo'), title: t('tb.undo') + ' (Ctrl+Z)', onclick: undo });
  redoBtn = h('button', { type: 'button', class: 'iconbtn', html: ICONS.right, 'aria-label': t('tb.redo'), title: t('tb.redo') + ' (Ctrl+Y)', onclick: redo });
  const fileMenu = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-haspopup': 'menu', text: t('studio.file'), onclick: (e) => contextMenu({ clientX: e.currentTarget.getBoundingClientRect().left, clientY: e.currentTarget.getBoundingClientRect().bottom + 4 }, [
    ['studio.newFromTemplate', () => openTab('new')], ['tb.import', () => fileIn.click()], ['tb.export', openExport], ['tb.downloadXml', downloadXml], ['tb.downloadZip', downloadZip], ['tb.copy', copyXml], ['tb.save', saveVersion], ['tb.presets', () => sidebar('presets')], ['studio.shortcuts', openShortcuts]]) });
  $('#st-file').replaceChildren(fileMenu, fileIn, h('span', { class: 'st-fname', id: 'st-fname' }, [h('span', { class: 'mono', text: 'autounattend.xml' }), h('span', { class: 'st-dirty', id: 'st-dirty', title: t('studio.unsaved'), 'aria-label': t('studio.unsaved'), hidden: true })]), undoBtn, redoBtn);
  $('#st-actions').replaceChildren(
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'st-validate', text: t('studio.validate'), onclick: () => { computeIssues(); layout.panelOpen = true; layout.panel = 'problems'; if (isPhone()) layout.pane = 'problems'; applyLayout(); renderPanel(); announce(t('studio.validated', [problemCount()])); } }),
    h('button', { type: 'button', class: 'btn btn-primary btn-sm', id: 'b-dl-zip', text: t('studio.buildKit'), onclick: downloadZip }));
  updateUndo();
}
function updateUndo() {
  if (!undoBtn) return;
  undoBtn.disabled = !history || !history.canUndo();
  redoBtn.disabled = !history || !history.canRedo();
  document.querySelectorAll('[data-undo]').forEach((b) => { b.disabled = undoBtn.disabled; });
  document.querySelectorAll('[data-redo]').forEach((b) => { b.disabled = redoBtn.disabled; });
  const dirty = $('#st-dirty');
  if (dirty && history) { const hd = history.head(); dirty.hidden = !!hd && (hd.kind === 'save' || hd.kind === 'download' || hd.kind === 'start'); }
  renderStatusBar();
}

// Activity bar and side bar
const SIDES = [['explorer', '☰'], ['search', '⌕'], ['catalog', '☷'], ['history', '⧖'], ['presets', '★'], ['tools', '⚒']];
function buildActivity() {
  $('#st-act').replaceChildren(...SIDES.map(([id, ic]) => h('button', { type: 'button', class: 'st-act-b', 'data-side': id, 'aria-label': t('side.' + id), title: t('side.' + id), 'aria-pressed': 'false', text: ic, onclick: () => sidebar(id, true) })));
}
function sidebar(id, toggle) {
  if (toggle && layout.side === id && layout.sideOpen && !isPhone()) layout.sideOpen = false;
  else { layout.side = id; layout.sideOpen = true; }
  if (isPhone()) layout.pane = 'explorer';
  applyLayout(); renderSide();
}
function renderSide() {
  const box = $('#st-side');
  const head = h('div', { class: 'st-side-h' }, [h('h2', { id: 'st-side-title', text: t('side.' + layout.side) })]);
  box.replaceChildren(head);
  const body = h('div', { class: 'st-side-b' });
  box.appendChild(body);
  ({ explorer: renderExplorer, search: renderSearchSide, catalog: renderCatalogSide, history: renderHistorySide, presets: renderPresetsSide, tools: renderToolsSide })[layout.side](body);
  S.translateAll(box);
}
function treeItem(label, opts) {
  const li = h('li', { role: 'treeitem', tabindex: '-1', 'aria-level': String(opts.level || 1), 'aria-expanded': opts.children ? String(!!opts.open) : null, class: 'st-ti' + (opts.active ? ' on' : '') }, [
    h('span', { class: 'st-ti-row', style: { paddingLeft: (8 + (opts.level - 1) * 14) + 'px' } }, [
      opts.children ? h('span', { class: 'st-caret', 'aria-hidden': 'true', text: opts.open ? '▾' : '▸' }) : h('span', { class: 'st-caret', 'aria-hidden': 'true' }),
      h('span', { class: 'st-ti-l', text: label }),
      opts.problem ? h('span', { class: 'st-badge bad', title: t('studio.problems'), text: String(opts.problem) }) : null,
      opts.count !== undefined ? h('span', { class: 'st-badge', text: String(opts.count) }) : null])]);
  if (opts.children) { const ul = h('ul', { role: 'group', hidden: !opts.open }); opts.children.forEach((c) => ul.appendChild(c)); li.appendChild(ul); }
  li.addEventListener('click', (e) => { e.stopPropagation(); if (opts.children) { const o = li.getAttribute('aria-expanded') !== 'true'; li.setAttribute('aria-expanded', String(o)); li.querySelector(':scope > ul').hidden = !o; li.querySelector('.st-caret').textContent = o ? '▾' : '▸'; if (opts.onToggle) opts.onToggle(o); } if (opts.onOpen) opts.onOpen(); });
  if (opts.menu) li.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); contextMenu(e, opts.menu); });
  return li;
}
function treeKeys(ul) {
  ul.addEventListener('keydown', (e) => {
    const items = [...ul.querySelectorAll('.st-ti')].filter((x) => x.offsetParent !== null);
    const cur = document.activeElement.closest('.st-ti'), i = items.indexOf(cur);
    if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[0]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (items[i - 1] || items[items.length - 1]).focus(); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (cur) cur.click(); }
    else if (e.key === 'ArrowRight' && cur && cur.getAttribute('aria-expanded') === 'false') { e.preventDefault(); cur.click(); }
    else if (e.key === 'ArrowLeft' && cur && cur.getAttribute('aria-expanded') === 'true') { e.preventDefault(); cur.click(); }
    else if (e.key === 'ContextMenu' && cur) { e.preventDefault(); const r = cur.getBoundingClientRect(); cur.dispatchEvent(new MouseEvent('contextmenu', { clientX: r.left + 20, clientY: r.bottom, bubbles: true })); }
  });
  ul.addEventListener('focusin', () => { if (!ul.querySelector('.st-ti[tabindex="0"]')) { const f = ul.querySelector('.st-ti'); if (f) f.tabIndex = 0; } });
  const first = ul.querySelector('.st-ti'); if (first) first.tabIndex = 0;
}
const openTree = new Set(JSON.parse(LS.get('td.studio.tree', '["passes","kit","tools"]') || '[]'));
function saveTree() { LS.set('td.studio.tree', JSON.stringify([...openTree])); }
function issuesFor(prefix) { return computeIssuesCached().filter((i) => (i.where + '/').startsWith(prefix + '/')).length; }
function renderExplorer(body) {
  const ul = h('ul', { class: 'st-tree', role: 'tree', 'aria-labelledby': 'st-side-title' });
  const tree = A.buildModelTree(model);
  const formErr = Object.keys(fieldErrors()).length;
  ul.appendChild(treeItem(t('tab.' + model.mode) + ' · ' + t('studio.template'), { level: 1, problem: formErr, active: view === 'template', onOpen: () => openTab('template') }));
  const passKids = A.PASS_ORDER.map((pass) => {
    const set = tree.c.find((s) => s.a.pass === pass);
    const comps = set ? set.c : [];
    const kids = comps.map((c) => {
      const key = pass + '|' + c.a.name;
      return treeItem(c.a.name.replace(/^Microsoft-Windows-/, ''), { level: 3, count: countSet(A.elementToValue(c)), problem: issuesFor(pass + '/' + c.a.name), active: view === 'comp:' + key,
        onOpen: () => openTab('comp:' + key),
        menu: [['ctx.open', () => openTab('comp:' + key)], ['ctx.revealXml', () => revealInXml(c.a.name, pass)], ['ctx.inspect', () => { selected = { comp: c.a.name, pass }; layout.inspOpen = true; applyLayout(); renderInspector(); }], ['ctx.copyName', () => navigator.clipboard && navigator.clipboard.writeText(c.a.name)],
          model.all[key] ? ['ctx.clearExtra', () => { delete model.all[key]; commit({ key: 'hist.unset', args: [c.a.name] }); renderView(); }] : null].filter(Boolean) });
    });
    return treeItem(pass, { level: 2, children: kids, count: comps.length, problem: issuesFor(pass), open: openTree.has('p:' + pass) || (!openTree.size && comps.length > 0), onToggle: (o) => { if (o) openTree.add('p:' + pass); else openTree.delete('p:' + pass); saveTree(); } });
  });
  ul.appendChild(treeItem(t('studio.passes'), { level: 1, children: passKids, open: openTree.has('passes'), onToggle: (o) => { if (o) openTree.add('passes'); else openTree.delete('passes'); saveTree(); } }));
  // kit files
  const files = [treeItem('autounattend.xml', { level: 2, active: view === 'xml', onOpen: () => openTab('xml'), menu: [['ctx.open', () => openTab('xml')], ['tb.downloadXml', downloadXml], ['tb.copy', copyXml]] })];
  if (model.mode === 'server') {
    files.push(treeItem('TempDesk/firstboot.json', { level: 2, active: view === 'firstboot', onOpen: () => openTab('firstboot') }));
    const payload = treeItem('TempDesk/ (' + t('studio.payload') + ')', { level: 2, children: payloadItems(), open: openTree.has('payload'), onToggle: (o) => { if (o) { openTree.add('payload'); loadManifest().then(() => renderSide()); } else openTree.delete('payload'); saveTree(); } });
    files.push(payload);
  }
  ul.appendChild(treeItem(t('studio.kit'), { level: 1, children: files, open: openTree.has('kit'), onToggle: (o) => { if (o) openTree.add('kit'); else openTree.delete('kit'); saveTree(); } }));
  const tools = ['flow', 'disk', 'commands', 'map', 'all', 'simulate', 'compare', 'plan', 'snippets', 'secrets', 'history'].map((id) => treeItem(t('tab.' + id), { level: 2, active: view === id, onOpen: () => openTab(id) }));
  ul.appendChild(treeItem(t('studio.views'), { level: 1, children: tools, open: openTree.has('tools'), onToggle: (o) => { if (o) openTree.add('tools'); else openTree.delete('tools'); saveTree(); } }));
  body.appendChild(ul);
  treeKeys(ul);
}
let manifest = null;
async function loadManifest() {
  if (manifest) return manifest;
  try { const r = await fetch(ROOT + 'payload/manifest.json', { cache: 'no-cache' }); manifest = r.ok ? await r.json() : { files: [] }; } catch (e) { manifest = { files: [] }; }
  return manifest;
}
function payloadItems() {
  if (!manifest) return [h('li', { class: 'st-ti', role: 'treeitem', 'aria-level': '3' }, [h('span', { class: 'st-ti-row meter-label', style: { paddingLeft: '36px' }, text: t('cat.loading') })])];
  return A.kitLayout(manifest, model.server.portalsMode).map((it) => treeItem(it.dest.slice('TempDesk/'.length), { level: 3, active: view === 'file:' + it.src, onOpen: () => openTab('file:' + it.src) }));
}
let gsSideHost = null;
function renderSearchSide(body) {
  const host = h('div', { class: 'st-search-side' });
  body.appendChild(host);
  gsSideHost = host;
  buildSearchUi(host, 'side');
}
function renderCatalogSide(body) {
  if (!catalog) { body.appendChild(h('p', { class: 'empty', text: t('cat.loading') })); return; }
  let q = '', re = false;
  const list = h('ul', { class: 'st-tree', role: 'tree', 'aria-label': t('side.catalog') });
  const draw = () => {
    list.replaceChildren();
    const m = compileQuery(q, re);
    if (!m.ok) return;
    catalog.components.filter((c) => m.empty || m.test(c.name + ' ' + c.help)).forEach((c) => {
      const n = c.passes.reduce((s, p) => s + countSet(model.all[p + '|' + c.name]), 0);
      list.appendChild(treeItem(c.name.replace(/^Microsoft-Windows-/, ''), { level: 1, count: n || undefined, children: c.passes.map((p) => treeItem(p, { level: 2, count: countSet(model.all[p + '|' + c.name]) || undefined, onOpen: () => openTab('comp:' + p + '|' + c.name) })),
        onToggle: () => { selected = { comp: c.name, pass: c.passes[0] }; renderInspector(); },
        menu: [['ctx.openAll', () => openEditor(c.passes[0], c.name)], ['ctx.inspect', () => { selected = { comp: c.name, pass: c.passes[0] }; layout.inspOpen = true; applyLayout(); renderInspector(); }]] }));
    });
    treeKeys(list);
  };
  const sb = searchBox({ label: t('cat.search'), placeholder: t('cat.search'), compact: true, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'), onChange: (qq, r) => { q = qq; re = r; draw(); } });
  body.append(sb.el, h('p', { class: 'meter-label', text: catalog.origin === 'full' ? t('cat.full', [catalog.components.length, catalog.version]) : t('cat.notBuilt', [catalog.components.length]) }), list);
  draw();
}
function renderHistorySide(body) {
  if (!history) { body.appendChild(h('p', { text: t('hist.unavailable') })); return; }
  body.appendChild(h('div', { class: 'cta' }, [btn('tb.undo', undo, 'btn-ghost btn-sm', { 'data-undo': '' }), btn('tb.redo', redo, 'btn-ghost btn-sm', { 'data-redo': '' }), btn('studio.openHistory', () => openTab('history'), 'btn-primary btn-sm')]));
  const ul = h('ul', { class: 'hist-list compact' });
  let q = '', re = false;
  const draw = () => {
    ul.replaceChildren();
    const fr = filterList(history.entries.slice().reverse(), q, (e) => msgText(e.msg) + ' #' + e.id, re);
    (fr.ok ? fr.items : []).slice(0, 200).forEach(({ it: e }) => ul.appendChild(h('li', { class: e === history.head() ? 'cur' : null }, [h('span', { class: 'msg' }, [msgText(e.msg), h('br'), h('small', { text: '#' + e.id + ' · ' + new Date(e.t).toLocaleTimeString() })]),
      e === history.head() ? null : h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('hist.restoreBtn'), onclick: () => { const r = history.restore(e.id); if (r) { applyState(r.state); output(t('hist.restored')); } } })])));
  };
  const sb = searchBox({ label: t('search.history'), placeholder: t('search.history'), compact: true, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'), onChange: (qq, r) => { q = qq; re = r; draw(); } });
  body.append(sb.el, ul);
  draw();
}
let branch = LS.get('td.studio.branch', '');
function renderPresetsSide(body) {
  const nameIn = h('input', { type: 'text', id: 'side-pre-name', maxlength: '80', placeholder: t('pre.namePh') });
  const inc = h('input', { type: 'checkbox' });
  const list = h('div', { class: 'list-ed' });
  let q = '', re = false;
  const draw = () => {
    const p = loadPresets(); list.replaceChildren();
    const fr = filterList(Object.keys(p).sort(), q, (n) => n, re);
    if (!Object.keys(p).length) list.appendChild(h('p', { class: 'empty', text: t('pre.none') }));
    (fr.ok ? fr.items : []).forEach(({ it: n }) => list.appendChild(h('div', { class: 'list-row' + (n === branch ? ' cur' : '') }, [h('b', { text: n }), h('small', { class: 'meter-label', text: t('tab.' + (p[n].mode || 'server')) }),
      h('div', { class: 'row-tools' }, [btn('pre.load', () => { const r = A.normalizeModel(p[n]); if (!r.ok) { S.toast(t('pre.badOne')); return; } model = mergeSecrets(r.model, model); branch = n; LS.set('td.studio.branch', n); commit({ key: 'hist.presetLoad', args: [n] }); renderView(); }, 'btn-primary btn-sm'),
        btn('pre.delete', () => { if (!window.confirm(t('pre.deleteConfirm', [n]))) return; delete p[n]; savePresets(p); if (branch === n) { branch = ''; LS.set('td.studio.branch', ''); } draw(); renderStatusBar(); }, 'btn-ghost btn-sm')])])));
  };
  const sb = searchBox({ label: t('search.presets'), placeholder: t('search.presets'), compact: true, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'), onChange: (qq, r) => { q = qq; re = r; draw(); } });
  body.append(h('div', { class: 'field' }, [h('label', { for: 'side-pre-name', text: t('pre.name') }), nameIn]), h('label', { class: 'check' }, [inc, t('pre.includePw')]),
    btn('pre.save', () => { const n = nameIn.value.trim(); if (!n || ['__proto__', 'prototype', 'constructor'].includes(n)) { S.toast(t('pre.nameBad')); return; } const p = loadPresets(); if (p[n] && !window.confirm(t('pre.replace', [n]))) return; p[n] = inc.checked ? clone(model) : A.stripSecrets(model); if (savePresets(p)) { branch = n; LS.set('td.studio.branch', n); nameIn.value = ''; draw(); renderStatusBar(); output(t('pre.saved', [n])); } }, 'btn-primary btn-sm'),
    sb.el, list, h('div', { class: 'cta' }, [btn('pre.export', () => openPresets(), 'btn-ghost btn-sm')]), h('p', { class: 'help', style: { color: 'var(--muted)' }, text: t('studio.branchHelp') }));
  draw();
}
function renderToolsSide(body) {
  const items = [['snippets', 'studio.tool.snippets'], ['secrets', 'studio.tool.secrets'], ['compare', 'studio.tool.compare'], ['simulate', 'studio.tool.simulate'], ['plan', 'studio.tool.plan']];
  items.forEach(([id, k]) => body.appendChild(h('button', { type: 'button', class: 'st-tool', onclick: () => openTab(id) }, [h('b', { text: t('tab.' + id) }), h('small', { text: t(k) })])));
  body.appendChild(h('a', { class: 'st-tool', href: ROOT + 'tools/base64.html', target: '_blank', rel: 'noopener' }, [h('b', { text: t('nav.base64') }), h('small', { text: t('home.b64') })]));
  body.appendChild(h('button', { type: 'button', class: 'st-tool', onclick: openShortcuts }, [h('b', { text: t('studio.shortcuts') }), h('small', { text: 'F1 / ?' })]));
}

// Inspector
function renderInspector() {
  const box = $('#st-insp');
  box.replaceChildren(h('div', { class: 'st-side-h' }, [h('h2', { text: t('studio.inspector') })]));
  const body = h('div', { class: 'st-side-b' });
  box.appendChild(body);
  if (!selected && view.startsWith('comp:')) { const [p, c] = view.slice(5).split('|'); selected = { comp: c, pass: p }; }
  if (!selected) { body.appendChild(h('p', { class: 'empty', text: t('studio.inspectEmpty') })); return; }
  const comp = catalog && catalog.byName.get(selected.comp);
  body.appendChild(h('h3', { class: 'mono', style: { overflowWrap: 'anywhere', margin: '0 0 6px', fontSize: '.95rem' }, text: selected.comp }));
  if (!comp) { body.appendChild(h('p', { class: 'help', text: t('studio.notInCatalog') })); return; }
  if (comp.help) body.appendChild(h('p', { class: 'help', text: comp.help }));
  body.appendChild(h('div', { class: 'pass-chips' }, comp.passes.map((p) => h('button', { type: 'button', class: 'pass-chip' + (p === selected.pass ? ' on' : ''), text: p, onclick: () => openTab('comp:' + p + '|' + comp.name) }))));
  if (comp.deprecated) body.appendChild(h('p', { class: 'notice warn', text: t('cat.deprecated') }));
  let setting = null;
  if (selected.path) { let list = comp.settings; selected.path.split('/').forEach((seg) => { setting = list && list.find((s) => s.name === seg); list = setting ? setting.children : null; }); }
  if (setting) {
    body.appendChild(h('h4', { class: 'mono', text: selected.path }));
    body.appendChild(h('p', { class: 'help', text: setting.help || '' }));
    body.appendChild(h('dl', { class: 'st-dl' }, [h('dt', { text: t('studio.type') }), h('dd', { text: setting.type }), h('dt', { text: t('cat.pass') }), h('dd', { text: (setting.passes.length ? setting.passes : comp.passes).join(', ') }),
      setting.default !== undefined ? h('dt', { text: t('studio.default') }) : null, setting.default !== undefined ? h('dd', { text: String(setting.default) }) : null,
      setting.min !== undefined ? h('dt', { text: t('studio.range') }) : null, setting.min !== undefined ? h('dd', { text: setting.min + ' .. ' + (setting.max ?? '') }) : null]));
    if (setting.values.length) body.appendChild(h('ul', { class: 'st-values' }, setting.values.map((v) => h('li', null, [h('code', { text: v.value }), ' ', v.label]))));
  }
  body.appendChild(h('h4', { text: t('studio.related') }));
  const rel = h('ul', { class: 'st-values' });
  comp.settings.slice(0, 40).forEach((s) => {
    const v = countSet(model.all[selected.pass + '|' + comp.name] && model.all[selected.pass + '|' + comp.name][s.name]);
    rel.appendChild(h('li', null, [h('button', { type: 'button', class: 'linkish', text: s.name, onclick: () => { selected = { comp: comp.name, pass: selected.pass, path: s.name }; renderInspector(); } }), v ? h('span', { class: 'setmark', text: t('cat.set') }) : null]));
  });
  body.appendChild(rel);
  body.appendChild(h('div', { class: 'cta' }, [btn('ctx.open', () => openTab('comp:' + selected.pass + '|' + comp.name), 'btn-ghost btn-sm'), btn('ctx.revealXml', () => revealInXml(comp.name, selected.pass), 'btn-ghost btn-sm')]));
}
document.addEventListener('focusin', (e) => {
  const cs = e.target.closest && e.target.closest('[data-setting-path]');
  if (!cs || !$('#st-editor').contains(cs)) return;
  const [comp, ...rest] = cs.dataset.settingPath.split('/');
  const pass = view.startsWith('comp:') ? view.slice(5).split('|')[0] : (allState.pass !== 'all' ? allState.pass : (catalog && catalog.byName.get(comp) ? catalog.byName.get(comp).passes[0] : ''));
  const next = { comp, pass, path: rest.join('/') };
  if (!selected || selected.comp !== next.comp || selected.path !== next.path) { selected = next; if (layout.inspOpen) renderInspector(); }
});

// Bottom panel: Problems, XML, Search results, History, Output
const PANELS = ['problems', 'xml', 'search', 'history', 'output'];
let issuesCache = null;
function computeIssuesCached() { if (!issuesCache) issuesCache = computeIssues(); return issuesCache; }
function problemCount() { return Object.keys(fieldErrors()).length + computeIssuesCached().filter((i) => i.level === 'error' || i.level === 'warning').length; }
function renderPanel() {
  const tabsBar = $('#st-panel-tabs');
  tabsBar.replaceChildren(...PANELS.map((id) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(layout.panel === id), class: 'st-ptab', text: t('panel.' + id) + (id === 'problems' ? ' ' + problemCount() : ''), onclick: () => { layout.panel = id; layout.panelOpen = true; applyLayout(); renderPanel(); } })),
    h('span', { class: 'grow' }), h('button', { type: 'button', class: 'iconbtn', 'aria-label': t('studio.togglePanel'), title: t('studio.togglePanel') + ' (Ctrl+J)', text: layout.panelOpen ? '▾' : '▴', onclick: () => { layout.panelOpen = !layout.panelOpen; applyLayout(); renderPanel(); } }));
  const box = $('#st-panel-body');
  box.replaceChildren();
  if (layout.panel === 'problems') renderProblems(box);
  else if (layout.panel === 'xml') box.appendChild(h('pre', { class: 'st-code-ro', tabindex: '0', html: A.highlightXml(A.buildXml(model)) }));
  else if (layout.panel === 'search') { const host = h('div'); box.appendChild(host); buildSearchUi(host, 'panel'); }
  else if (layout.panel === 'history') { const host = h('div'); box.appendChild(host); renderHistorySide(host); }
  else if (layout.panel === 'output') box.appendChild(h('ul', { class: 'st-output' }, outputLog.slice().reverse().map((o) => h('li', null, [h('small', { text: new Date(o.t).toLocaleTimeString() }), ' ', o.text]))));
}
function renderProblems(box) {
  const ul = h('ul', { class: 'st-problems' });
  const fe = fieldErrors();
  Object.keys(fe).forEach((k) => ul.appendChild(h('li', { class: 'error' }, [h('span', { class: 'sensitive', text: t('studio.form') }), h('span', { class: 'msg', text: fe[k] }), h('small', { class: 'mono', text: k }),
    btn('studio.reveal', () => revealField(k), 'btn-ghost btn-sm')])));
  computeIssuesCached().forEach((i) => {
    const fix = ruleFix(i);
    ul.appendChild(h('li', { class: i.level }, [h('span', { class: i.level === 'error' ? 'sensitive' : 'pass-chip', text: i.level }), h('span', { class: 'msg', text: i.message }), h('small', { class: 'mono', text: i.where + ' (' + i.id + ')' }),
      fix ? h('button', { type: 'button', class: 'btn btn-primary btn-sm', title: fix.label, onclick: () => quickFix(i) }, [t('fix.quick') + ': ' + fix.label]) : null, btn('studio.reveal', () => revealIssue(i), 'btn-ghost btn-sm')]));
  });
  if (!ul.children.length) ul.appendChild(h('li', null, [rules ? t('checks.ok') : t('checks.unavailable')]));
  box.appendChild(ul);
}
function ruleFix(issue) { const r = rules && rules.RULES.find((x) => x.id === issue.id); return r && r.fix ? { label: r.fixLabel } : null; }
// Quick fixes come from the rules engine (answerfile/rules.mjs): parse the XML into the engine's model,
// apply the rule's pure fix, write the XML back and sync it into the studio model.
function quickFix(issue) {
  try {
    const parsed = rules.parseXml(A.buildXml(model), catalog.raw);
    const fixed = rules.applyFix(parsed.model, catalog.raw, issue.id);
    if (!fixed) { S.toast(t('fix.notApplied')); return; }
    const xml = A.alignXml(rules.buildXml(fixed, catalog.raw), A.buildXml(model));
    const r = A.syncFromXml(model, xml, { knownComponent });
    model = r.model;
    commit({ key: 'hist.quickFix', args: [issue.id] });
    output(t('hist.quickFix', [issue.id]));
    renderView();
  } catch (e) { S.toast(t('fix.notApplied') + ' ' + e.message); }
}
function revealField(k) {
  const id = k.split('.')[0] === 'accounts' ? 'accounts' : k;
  const sec = SECTIONS.find((s) => sectionFields(s, model.mode).includes(id));
  openTab('template', { noFocus: true });
  const el = mainEl.querySelector(`[data-field="${CSS.escape(id)}"]`) || (sec && document.getElementById('sec-' + sec.id));
  if (sec && isPhone()) { const s = document.getElementById('sec-' + sec.id); if (s) { step = Number(s.dataset.sectionIndex); renderView(); } }
  const el2 = mainEl.querySelector(`[data-field="${CSS.escape(id)}"]`) || el;
  if (el2) S.focusTarget(el2);
}
function revealIssue(i) {
  const parts = String(i.where).split('/');
  if (parts.length >= 2) {
    const key = parts[0] + '|' + parts[1];
    selected = { comp: parts[1], pass: parts[0], path: parts.slice(2).map((p) => p.replace(/\[\d+\]$/, '')).join('/') };
    openTab('comp:' + key, { noFocus: true });
    const target = selected.path && mainEl.querySelector(`[data-setting-path="${CSS.escape(parts[1] + '/' + selected.path)}"]`);
    if (target) S.focusTarget(target); else revealInXml(parts[1], parts[0]);
    renderInspector();
  }
}
function revealInXml(comp, pass) {
  openTab('xml', { noFocus: true });
  const ed = xmlEditor;
  if (!ed) return;
  const text = ed.cm.value;
  const passAt = text.indexOf('<settings pass="' + pass + '"');
  const at = text.indexOf('name="' + comp + '"', Math.max(0, passAt));
  if (at >= 0) ed.cm.select(at, at + comp.length + 7);
}

// Status bar
function renderStatusBar() {
  const sb = $('#st-status');
  if (!sb) return;
  let comps = 0, sets = 0;
  try { const tree = A.buildModelTree(model); tree.c.forEach((s) => s.c.forEach((c) => { comps++; sets += countSet(A.elementToValue(c)); })); } catch (e) { /* ignore */ }
  const hd = history && history.head();
  const undoDepth = history ? (function () { let n = 0, e = history.head(); while (e && e.back !== null && e.back !== undefined && n < 9999) { n++; e = history.byId(e.back); } return n; })() : 0;
  const target = model.mode === 'server' ? 'Windows Server 2025' : model.mode === 'guest' ? 'Windows 11' : (model.custom.target === 'server' ? 'Windows Server' : 'Windows');
  const pc = problemCount();
  sb.replaceChildren(
    h('button', { type: 'button', class: 'st-sb', title: t('studio.branchHelp'), onclick: () => sidebar('presets') }, ['⎇ ', branch || 'main']),
    h('button', { type: 'button', class: 'st-sb', onclick: () => sidebar('history') }, [hd ? '#' + hd.id : '-']),
    h('span', { class: 'st-sb', text: t('studio.undoDepth', [undoDepth]) }),
    h('button', { type: 'button', class: 'st-sb' + (pc ? ' bad' : ''), onclick: () => { layout.panel = 'problems'; layout.panelOpen = true; if (isPhone()) layout.pane = 'problems'; applyLayout(); renderPanel(); } }, [(pc ? '✖ ' : '✔ ') + t('studio.problemCount', [pc])]),
    h('span', { class: 'grow' }),
    h('span', { class: 'st-sb', text: t('studio.counts', [sets, comps]) }),
    h('span', { class: 'st-sb', text: target + ' · ' + (model.mode === 'server' ? 'amd64' : (model[model.mode].arch || 'amd64')) }),
    h('span', { class: 'st-sb', text: 'UTF-8 · CRLF' }));
}

// Shortcuts sheet
function openShortcuts() {
  const rows = [['Ctrl+Shift+F', 'sc.search'], ['Ctrl+Z', 'tb.undo'], ['Ctrl+Y / Ctrl+Shift+Z', 'tb.redo'], ['Ctrl+S', 'tb.save'], ['Ctrl+B', 'sc.side'], ['Ctrl+J', 'sc.panel'], ['Ctrl+Alt+I', 'sc.insp'], ['Ctrl+\\', 'sc.split'],
    ['Alt+1 .. Alt+9', 'sc.tabN'], ['Alt+Shift+Left / Right', 'sc.moveTab'], ['Delete', 'sc.closeTab'], ['F1 / ?', 'studio.shortcuts'], ['Shift+F10', 'sc.context'], ['Arrow keys', 'sc.tree']];
  sheet('studio.shortcuts', () => [h('div', { class: 'tablebox' }, [h('table', null, [h('tbody', null, rows.map(([k, d]) => h('tr', null, [h('td', null, [h('kbd', { text: k })]), h('td', { text: t(d) })])))])])]);
}

// ------------------------------------------------------------------------------------------------
// Friendly mode forms
// ------------------------------------------------------------------------------------------------
function fieldErrors() {
  const e = A.validateModel(model);
  const out = {};
  Object.keys(e).forEach((k) => { out[k] = t('err.' + e[k], null, A.MESSAGES[e[k]]); });
  if (model.disks) validateLayout(model.disks).forEach((x) => { out.diskLayoutCanvas = t(x.code); });
  return out;
}
function editionOptions(mode) {
  const list = mode === 'server' || (mode === 'custom' && model.custom.target === 'server') ? A.SERVER_EDITIONS : A.CLIENT_EDITIONS;
  return list.map(([v, l]) => [v, v + ': ' + l, true]);
}
function strengthEl(id) {
  const meter = h('div', { class: 'meter', 'aria-hidden': 'true' }, [h('i')]);
  const lab = h('div', { class: 'meter-label', id: id + '-strength', 'aria-live': 'polite' });
  const upd = (v) => { const s = A.passwordStrength(v); meter.dataset.score = s.score; meter.firstChild.style.width = (v ? (s.score + 1) * 20 : 0) + '%'; lab.textContent = v ? t('pw.' + s.code) + ' (' + t('pw.bits', [s.bits]) + ')' + (s.meetsPolicy ? '' : ' · ' + t('pw.policy')) : ''; };
  return { el: h('div', null, [meter, lab]), upd };
}
function renderField(id, mode, errors) {
  const def = FIELDS[id];
  const form = model[mode];
  if (!def || (def.show && !def.show(form))) return null;
  const domId = 'fld-' + mode + '-' + id.replace(/\./g, '-');
  const v = getVal(id);
  const lab = label(id);
  const helpKey = 'h.' + id.replace(/^x\./, 'x_');
  const help = t(helpKey, null, '') === helpKey ? '' : t(helpKey, null, '');
  const err = h('div', { class: 'err', id: domId + '-err', role: 'alert' }, [errors[id] || '']);
  const wrap = h('div', { class: 'field', 'data-palette-field': lab, 'data-palette-group': t('tab.' + mode), 'data-field': id });
  const described = [help ? domId + '-help' : null, domId + '-err'].filter(Boolean).join(' ');
  const textChange = (inp, value) => {
    setVal(id, value);
    const e = fieldErrors();
    err.textContent = e[id] || '';
    inp.setAttribute('aria-invalid', String(!!e[id]));
    commit({ key: def.type === 'password' ? 'hist.setSecret' : 'hist.setField', args: ['@f.' + id.replace(/^x\./, 'x_'), def.type === 'password' ? '' : String(value).slice(0, 60)] }, mode + ':' + id);
  };
  const selectChange = (value, shown) => {
    setVal(id, value);
    commit({ key: 'hist.setField', args: ['@f.' + id.replace(/^x\./, 'x_'), shown || String(value)] });
    renderView();
  };
  if (def.type === 'check') {
    const cb = h('input', { type: 'checkbox', id: domId, checked: !!v, 'aria-describedby': described });
    cb.addEventListener('change', () => { setVal(id, cb.checked); commit({ key: cb.checked ? 'hist.on' : 'hist.off', args: ['@f.' + id.replace(/^x\./, 'x_')] }); renderView(); });
    wrap.appendChild(h('label', { class: 'check', for: domId }, [cb, h('span', { text: lab })]));
  } else {
    wrap.appendChild(h('label', { for: domId, text: lab }));
    if (id === 'timeZone' || def.type === 'datalist') {
      const opts = id === 'timeZone' ? TZ_OPTS().map(([v, l]) => [v, l]) : (def.list === 'dl-keyboards' ? A.KEYBOARDS.map(([v, l]) => [v, v + ' (' + l + ')']) : A.LOCALES.map((l) => [l, l]));
      const cb = combobox({ id: domId, options: opts, value: v === undefined ? '' : String(v), allowCustom: id !== 'timeZone', mono: true, emptyText: t('palette.empty'), openLabel: t('combo.open'), describedby: described,
        onChange: (val, shown) => { setVal(id, val); const e = fieldErrors(); err.textContent = e[id] || ''; cb.input.setAttribute('aria-invalid', String(!!e[id])); commit({ key: 'hist.setField', args: ['@f.' + id, shown] }); updateStatus(); } });
      wrap.appendChild(cb.el);
    } else if (def.type === 'select' || def.type === 'edition') {
      const opts = def.type === 'edition' ? editionOptions(mode) : (typeof def.options === 'function' ? def.options() : def.options);
      const sel = h('select', { id: domId, 'aria-describedby': described }, opts.map(([ov, ol, raw]) => h('option', { value: ov, text: raw ? ol : t(ol) })));
      if (def.type === 'edition' && !opts.some((o) => o[0] === String(v))) sel.appendChild(h('option', { value: String(v), text: String(v) + ': ' + t('opt.customIndex') }));
      sel.appendChild(def.type === 'edition' ? h('option', { value: '__other', text: t('opt.otherIndex') }) : document.createTextNode(''));
      sel.value = String(v === undefined ? '' : v);
      sel.addEventListener('change', () => {
        if (sel.value === '__other') {
          const n = window.prompt(t('opt.otherIndexPrompt'), String(v || '1'));
          if (n && /^\d{1,2}$/.test(n)) selectChange(n); else sel.value = String(v);
          return;
        }
        selectChange(sel.value, sel.options[sel.selectedIndex].text);
      });
      wrap.appendChild(sel);
    } else if (def.type === 'password') {
      const inp = h('input', { type: 'password', id: domId, value: v || '', autocomplete: 'new-password', spellcheck: 'false', 'aria-describedby': described + ' ' + domId + '-strength', 'aria-invalid': String(!!errors[id]) });
      const st = strengthEl(domId);
      inp.addEventListener('input', () => { st.upd(inp.value); textChange(inp, inp.value); });
      const show = iconButton('eye', t('pw.show'), () => { inp.type = inp.type === 'password' ? 'text' : 'password'; show.setAttribute('aria-pressed', String(inp.type === 'text')); }, { 'aria-pressed': 'false' });
      const gen = iconButton('dice', t('pw.generate'), () => { inp.value = A.generatePassword(20); inp.type = 'text'; st.upd(inp.value); textChange(inp, inp.value); history && history.flush(); announce(t('pw.generated')); });
      wrap.appendChild(h('div', { class: 'inline' }, [inp, h('div', { class: 'pw-tools' }, [show, gen])]));
      wrap.appendChild(st.el); st.upd(v || '');
      if (def.plain) wrap.appendChild(h('p', { class: 'notice warn', text: t('warn.plainJoin') }));
    } else if (def.type === 'textarea' || def.type === 'raw') {
      const ta = h('textarea', { id: domId, rows: def.type === 'raw' ? '10' : '3', spellcheck: 'false', 'aria-describedby': described, 'aria-invalid': String(!!errors[id]) });
      ta.value = v || '';
      ta.addEventListener('input', () => {
        textChange(ta, ta.value);
        if (def.type === 'raw') { const r = A.parseRawBlock(ta.value); err.textContent = r.error ? t('err.' + r.error) + (r.detail ? ' ' + r.detail : '') : ''; }
      });
      if (def.type === 'raw') { const r = A.parseRawBlock(v); if (r.error) err.textContent = t('err.' + r.error) + (r.detail ? ' ' + r.detail : ''); }
      wrap.appendChild(ta);
    } else if (def.type === 'accounts') {
      wrap.appendChild(accountsEditor(mode));
    } else if (def.type === 'apps') {
      const cur = new Set(String(v || '').split(/[\s,]+/).filter(Boolean));
      const box = h('div', { class: 'grid2', role: 'group', 'aria-label': lab });
      Object.keys(A.APP_IDS).forEach((app) => {
        const cb = h('input', { type: 'checkbox', checked: cur.has(app) });
        cb.addEventListener('change', () => { if (cb.checked) cur.add(app); else cur.delete(app); setVal(id, [...cur].join(', ')); commit({ key: cb.checked ? 'hist.on' : 'hist.off', args: ['@app.' + app] }); });
        box.appendChild(h('label', { class: 'check' }, [cb, h('span', { text: t('app.' + app) })]));
      });
      wrap.appendChild(box);
    } else {
      const inp = h('input', { type: 'text', id: domId, value: v === undefined ? '' : String(v), spellcheck: 'false', autocomplete: 'off', inputmode: def.numeric ? 'decimal' : undefined, list: def.list || undefined,
        placeholder: def.placeholderFn ? def.placeholderFn(model[mode]) : def.placeholder || undefined, class: def.mono ? 'mono' : undefined, 'aria-describedby': described, 'aria-invalid': String(!!errors[id]) });
      inp.addEventListener('input', () => {
        if (id === 'domainName' && mode === 'server') {
          const old = A.suggestNetbios(model.server.domainName);
          if (!model.server.netbiosName || model.server.netbiosName === old) {
            model.server.netbiosName = A.suggestNetbios(inp.value);
            const nb = document.getElementById('fld-server-netbiosName'); if (nb) nb.value = model.server.netbiosName;
          }
        }
        textChange(inp, inp.value);
      });
      wrap.appendChild(inp);
    }
  }
  if (help) wrap.appendChild(h('div', { class: 'help', id: domId + '-help', text: help }));
  wrap.appendChild(err);
  return wrap;
}
function accountsEditor(mode) {
  const box = h('div', { class: 'list-ed' });
  const list = model.custom.accounts;
  if (list.length > 1) {
    const sb = searchBox({ label: t('search.list'), placeholder: t('search.list'), compact: true, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'),
      onChange: (q, regex) => { const r = filterList(list, q, (a) => [a.name, a.displayName, a.group].join(' '), regex); if (!r.ok) return; const keep = new Set(r.items.map((x) => x.i)); box.querySelectorAll('.list-row[data-i]').forEach((row) => { row.hidden = !keep.has(Number(row.dataset.i)); }); sb.setStatus(q ? t('search.listCount', [keep.size, list.length]) : ''); } });
    box.appendChild(sb.el);
  }
  list.forEach((a, i) => {
    const row = h('div', { class: 'list-row', 'data-i': String(i) });
    const mk = (k, type) => {
      const id = `acc-${i}-${k}`;
      const inp = h('input', { type, id, value: a[k] || '', autocomplete: type === 'password' ? 'new-password' : 'off', spellcheck: 'false' });
      inp.addEventListener('input', () => { a[k] = inp.value; commit({ key: k === 'password' ? 'hist.setSecret' : 'hist.setField', args: [t('f.account') + ' ' + (i + 1) + ' ' + t('f.acc_' + k), k === 'password' ? '' : inp.value] }, 'acc' + i + k); });
      const fe = fieldErrors()['accounts.' + i + '.' + k];
      return h('div', { class: 'field' }, [h('label', { for: id, text: t('f.acc_' + k) }), k === 'password' ? h('div', { class: 'inline' }, [inp, iconButton('dice', t('pw.generate'), () => { inp.value = A.generatePassword(16); inp.type = 'text'; a.password = inp.value; commit({ key: 'hist.setSecret', args: [t('f.account') + ' ' + (i + 1)] }); })]) : inp, h('div', { class: 'err', text: fe || '' })]);
    };
    const grp = h('select', { id: `acc-${i}-group` }, [h('option', { value: 'Administrators', text: t('opt.group.admins') }), h('option', { value: 'Users', text: t('opt.group.users') })]);
    grp.value = a.group || 'Administrators';
    grp.addEventListener('change', () => { a.group = grp.value; commit({ key: 'hist.setField', args: [t('f.account') + ' ' + (i + 1) + ' ' + t('f.acc_group'), grp.value] }); });
    row.append(mk('name', 'text'), mk('displayName', 'text'), h('div', { class: 'field' }, [h('label', { for: `acc-${i}-group`, text: t('f.acc_group') }), grp]), mk('password', 'password'),
      h('div', { class: 'row-tools' }, [
        iconButton('up', t('list.up'), () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; commit({ key: 'hist.reorder', args: ['@f.accounts'] }); renderView(); }, { disabled: i === 0 || undefined }),
        iconButton('down', t('list.down'), () => { [list[i + 1], list[i]] = [list[i], list[i + 1]]; commit({ key: 'hist.reorder', args: ['@f.accounts'] }); renderView(); }, { disabled: i === list.length - 1 || undefined }),
        iconButton('del', t('list.remove'), () => { list.splice(i, 1); commit({ key: 'hist.removeItem', args: ['@f.accounts'] }); renderView(); })]));
    box.appendChild(row);
  });
  box.appendChild(btn('list.addAccount', () => { list.push({ name: '', displayName: '', group: 'Users', password: '' }); commit({ key: 'hist.addItem', args: ['@f.accounts'] }); renderView(); }, 'btn-ghost btn-sm'));
  return box;
}
function sectionStatus(sec, mode, errors) {
  const ids = sectionFields(sec, mode);
  if (ids.some((id) => errors[id]) || (sec.id === 'accounts' && Object.keys(errors).some((k) => k.startsWith('accounts.'))) || (sec.id === 'disk' && errors.diskLayoutCanvas)) return 'error';
  const d = A.defaultModel();
  const changed = ids.some((id) => { const dv = id.startsWith('x.') ? d.extras[id.slice(2)] : id === 'raw' ? '' : d[mode][id]; return JSON.stringify(getVal(id)) !== JSON.stringify(dv) && !isEmpty(getVal(id)); });
  const advSet = (sec.adv || []).some(([c]) => Object.keys(model.all).some((k) => k.endsWith('|' + c) && countSet(model.all[k]) > 0));
  if (sec.id === 'disk' && model.disks) return 'set';
  if (sec.id === 'apps' && Object.values(model.commands).some((l) => l.length)) return 'set';
  return changed || advSet ? 'set' : 'empty';
}
function renderAdvanced(sec, box) {
  box.replaceChildren();
  if (!catalog) { box.appendChild(h('p', { class: 'empty', text: t('cat.loading') })); return; }
  let any = false;
  (sec.adv || []).forEach(([cname, names]) => {
    const comp = catalog.byName.get(cname);
    if (!comp) return;
    const sub = names ? Object.assign({}, comp, { settings: comp.settings.filter((s) => names.includes(s.name)) }) : comp;
    if (!sub.settings.length) return;
    any = true;
    comp.passes.forEach((pass) => {
      const passOk = sub.settings.some((s) => !s.passes.length || s.passes.includes(pass));
      if (!passOk) return;
      const key = pass + '|' + cname;
      const det = h('details', { class: 'cat-comp', open: countSet(model.all[key]) > 0 || undefined }, [h('summary', null, [h('span', { text: cname }), h('span', { class: 'pass-chip', text: pass }), h('small', { class: 'cnt', text: t('cat.countSet', [countSet(model.all[key])]) })])]);
      const body = h('div', { class: 'cat-body' });
      const build = () => { if (body.childNodes.length) return; body.appendChild(renderSettings(sub, model.all[key], (v, msg, co) => allChange(key, v, msg, co, det), { t, pass, idPrefix: 'adv-' + sec.id + '-' + pass })); };
      det.addEventListener('toggle', () => { if (det.open) build(); });
      if (det.open) build();
      det.appendChild(body);
      box.appendChild(det);
    });
  });
  if (!any) box.appendChild(h('p', { class: 'empty', text: t('adv.none') }));
  box.appendChild(h('p', { class: 'help', text: t('adv.note') }));
}
function allChange(key, v, msg, co, det) {
  if (isEmpty(v)) delete model.all[key]; else model.all[key] = v;
  if (det) { const c = det.querySelector('.cnt'); if (c) c.textContent = t('cat.countSet', [countSet(model.all[key])]); }
  commit(msg, co ? 'all:' + key + ':' + co : null);
}
function renderMode(mode) {
  const errors = fieldErrors();
  indexEl.replaceChildren();
  const stepper = isPhone();
  mainEl.classList.toggle('stepper', stepper);
  const secs = SECTIONS.filter((s) => sectionFields(s, mode).length || (s.adv && s.adv.length) || s.canvas);
  if (step >= secs.length) step = 0;
  const secFilter = searchBox({ label: t('search.sections'), placeholder: t('search.sections'), compact: true, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'),
    onChange: (q, regex, m) => {
      let n = 0;
      indexEl.querySelectorAll('a[data-sec]').forEach((a) => { const ok = m.ok && (m.empty || !!m.test(a.textContent)); a.hidden = !ok; if (ok) n++; });
      if (!stepper) mainEl.querySelectorAll('.b-sec[data-section-index]').forEach((sx) => { const a = indexEl.querySelector('a[data-sec="' + sx.id.slice(4) + '"]'); sx.hidden = !!(a && a.hidden); });
      if (m.ok) secFilter.setStatus(m.empty ? '' : t('search.sectionCount', [n]), n === 0);
    } });
  indexEl.appendChild(secFilter.el);
  const intro = h('div', { class: 'notice' }, [t('mode.' + mode + '.intro')]);
  mainEl.appendChild(intro);
  secs.forEach((sec, i) => {
    const status = sectionStatus(sec, mode, errors);
    const a = h('a', { href: '#sec-' + sec.id, 'aria-current': stepper && i === step ? 'step' : undefined, 'data-sec': sec.id }, [h('span', { class: 'sdot', 'data-s': status, 'aria-hidden': 'true' }), h('span', { text: t('sec.' + sec.id) }), h('span', { class: 'sr-only', text: ', ' + t('status.' + status) })]);
    a.addEventListener('click', (e) => { if (stepper) { e.preventDefault(); step = i; renderEditorOnly(); const s = document.getElementById('sec-' + sec.id); if (s) s.scrollIntoView({ block: 'start' }); } });
    indexEl.appendChild(a);
    const isAdv = adv.has(sec.id);
    const advBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': String(isAdv), text: isAdv ? t('adv.hide') : t('adv.show') });
    const fieldFilter = searchBox({ label: t('search.fields'), placeholder: t('search.fields'), compact: true, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'),
      onChange: (q, regex, m) => {
        let shown = 0, total = 0;
        el.querySelectorAll('.grid2 > .field, .cat-set').forEach((f) => {
          total++;
          const ok = !m.ok ? false : m.empty || !!m.test(f.textContent + ' ' + [...f.querySelectorAll('input, select, textarea')].map((x) => x.type === 'password' ? '' : x.value).join(' '));
          f.hidden = !ok; if (ok) shown++;
        });
        if (!m.ok) return;
        fieldFilter.setStatus(m.empty ? '' : t('search.fieldCount', [shown, total]), shown === 0);
        if (!m.empty && !adv.has(sec.id) && shown === 0) fieldFilter.setStatus(t('search.tryAdvanced'), true);
      } });
    const head = h('header', null, [h('h2', { id: 'sec-' + sec.id + '-h' }, [h('span', { class: 'sdot', 'data-s': status, 'aria-hidden': 'true' }), t('sec.' + sec.id)]), h('div', { class: 'sec-tools' }, [fieldFilter.el, sec.adv && sec.adv.length ? advBtn : null])]);
    const el = h('section', { class: 'b-sec' + (i === step ? ' active' : ''), id: 'sec-' + sec.id, 'aria-labelledby': 'sec-' + sec.id + '-h', 'data-section-index': String(i) }, [head]);
    const secHelp = t('sec.' + sec.id + '.help', null, '');
    if (secHelp && secHelp !== 'sec.' + sec.id + '.help') el.appendChild(h('p', { class: 'help', style: { color: 'var(--muted)', marginTop: '-4px' }, text: secHelp }));
    const grid = h('div', { class: 'grid2' });
    sectionFields(sec, mode).forEach((id) => { const f = renderField(id, mode, errors); if (f) { if (['accounts', 'raw', 'x.apps', 'driversPE', 'driversOffline'].includes(id)) f.style.gridColumn = '1 / -1'; grid.appendChild(f); } });
    if (grid.children.length) el.appendChild(grid); else el.appendChild(h('p', { class: 'empty', text: t('sec.noBasic') }));
    // mode specific notes
    if (sec.id === 'image') el.appendChild(h('p', { class: 'notice', text: t(mode === 'server' || (mode === 'custom' && model.custom.target === 'server') ? 'note.editionServer' : 'note.editionClient') }));
    if (sec.id === 'domain' && mode === 'guest') el.appendChild(h('p', { class: 'notice warn', text: t('warn.joinAccount') }));
    if (sec.id === 'network' && mode === 'guest') el.appendChild(h('p', { class: 'notice', text: t('note.joinDns') }));
    if (sec.id === 'features' && mode === 'custom') el.appendChild(h('p', { class: 'help', text: t(model.custom.target === 'server' ? 'note.featuresServer' : 'note.featuresClient') }));
    if (sec.id === 'disk' && model.disks) el.appendChild(h('p', { class: 'notice ok', text: t('note.diskCanvas') }));
    if (sec.id === 'disk' && errors.diskLayoutCanvas) el.appendChild(h('p', { class: 'notice warn', text: errors.diskLayoutCanvas }));
    if (sec.canvas) el.appendChild(h('div', { class: 'cta', style: { marginTop: '12px' } }, [btn('canvas.open.' + sec.canvas, () => setView(sec.canvas), 'btn-ghost btn-sm')]));
    const advBox = h('div', { hidden: !isAdv, style: { marginTop: '14px' } });
    if (isAdv) renderAdvanced(sec, advBox);
    advBtn.addEventListener('click', () => { if (adv.has(sec.id)) adv.delete(sec.id); else adv.add(sec.id); const on = adv.has(sec.id); advBtn.setAttribute('aria-pressed', String(on)); advBtn.textContent = on ? t('adv.hide') : t('adv.show'); advBox.hidden = !on; if (on) renderAdvanced(sec, advBox); });
    el.appendChild(advBox);
    el.appendChild(h('div', { class: 'b-step-nav' }, [
      btn('step.prev', () => { step = Math.max(0, i - 1); renderEditorOnly(); mainEl.scrollTop = 0; }, 'btn-ghost', { disabled: i === 0 || undefined }),
      h('span', { class: 'meter-label', style: { alignSelf: 'center' }, text: t('step.of', [i + 1, secs.length]) }),
      btn('step.next', () => { step = Math.min(secs.length - 1, i + 1); renderEditorOnly(); mainEl.scrollTop = 0; }, 'btn-primary', { disabled: i === secs.length - 1 || undefined })]));
    mainEl.appendChild(el);
  });
}
function updateStatus() {
  if (view !== 'template') return;
  const errors = fieldErrors();
  SECTIONS.forEach((sec) => {
    const s = sectionStatus(sec, model.mode, errors);
    document.querySelectorAll(`[data-sec="${sec.id}"] .sdot, #sec-${sec.id}-h .sdot`).forEach((d) => { d.dataset.s = s; });
    const sr = document.querySelector(`[data-sec="${sec.id}"] .sr-only`); if (sr) sr.textContent = ', ' + t('status.' + s);
  });
}

// ------------------------------------------------------------------------------------------------
// All settings (catalog)
// ------------------------------------------------------------------------------------------------
const allState = { pass: LS.get('td.all.pass', 'all'), platform: 'all', q: '', regex: false, onlySet: false, open: null };
function renderAll() {
  if (!catalog) { mainEl.appendChild(h('p', { class: 'notice', text: t('cat.loading') })); return; }
  if (catalog.origin !== 'full') mainEl.appendChild(h('p', { class: 'notice warn', role: 'status', text: t('cat.notBuilt', [catalog.components.length]) }));
  else mainEl.appendChild(h('p', { class: 'notice ok', text: t('cat.full', [catalog.components.length, catalog.version]) }));
  const passSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('cat.pass') }, ['all'].concat(PASSES).map((p) => h('button', { type: 'button', 'aria-pressed': String(allState.pass === p), text: p === 'all' ? t('cat.allPasses') : p, onclick: () => { allState.pass = p; LS.set('td.all.pass', p); renderView(); } })));
  const platSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('cat.platform') }, ['all', 'client', 'server'].map((p) => h('button', { type: 'button', 'aria-pressed': String(allState.platform === p), text: t('cat.plat.' + p), onclick: () => { allState.platform = p; renderView(); } })));
  const sb = searchBox({ label: t('cat.search'), placeholder: t('cat.search'), value: allState.q, regex: allState.regex, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'),
    onChange: (qq, regex) => { allState.q = qq; allState.regex = regex; draw(); } });
  sb.input.id = 'cat-search';
  const onlySet = h('input', { type: 'checkbox', checked: allState.onlySet });
  const list = h('div', { id: 'cat-list' });
  const count = h('div', { class: 'meter-label', 'aria-live': 'polite' });
  mainEl.appendChild(h('div', { class: 'b-sec' }, [h('header', null, [h('h2', { id: 'all-h', text: t('tab.all') })]),
    h('div', { class: 'cat-tools' }, [sb.el, h('div', { class: 'cat-filters' }, [passSeg]), h('div', { class: 'cat-filters' }, [platSeg, h('label', { class: 'check' }, [onlySet, t('cat.onlySet')])]), count]), list]));
  const draw = () => {
    const m = compileQuery(allState.q, allState.regex);
    const mt = { ok: m.ok, test: (x) => !!m.test(x) };
    list.replaceChildren();
    let n = 0;
    catalog.components.forEach((comp) => {
      if (allState.pass !== 'all' && !comp.passes.includes(allState.pass)) return;
      if (allState.platform !== 'all' && !comp.platforms.includes(allState.platform)) return;
      const setCount = comp.passes.reduce((s, p) => s + countSet(model.all[p + '|' + comp.name]), 0);
      if (allState.onlySet && !setCount) return;
      if (!mt.test(searchText(comp))) return;
      n++;
      const det = h('details', { class: 'cat-comp', 'data-comp': comp.name, open: allState.open === comp.name || undefined }, [h('summary', null, [
        h('span', { text: comp.name }), h('small', { class: 'cnt', text: setCount ? t('cat.countSet', [setCount]) : '' }),
        h('span', { class: 'pass-chips' }, comp.passes.map((p) => h('span', { class: 'pass-chip', text: p })))])]);
      const body = h('div', { class: 'cat-body' });
      const build = () => {
        if (body.childNodes.length) return;
        if (comp.help) body.appendChild(h('p', { class: 'help', text: comp.help }));
        const passes = allState.pass === 'all' ? comp.passes : [allState.pass];
        let pass = (allState.focusPass && passes.includes(allState.focusPass) ? allState.focusPass : null) || passes.find((p) => countSet(model.all[p + '|' + comp.name])) || passes[0];
        const holder = h('div');
        const drawPass = () => {
          const key = pass + '|' + comp.name;
          holder.replaceChildren(renderSettings(comp, model.all[key], (v, msg, co) => allChange(key, v, msg, co, det), { t, pass, expandPath: allState.focusPath, idPrefix: 'all-' + comp.name.replace(/[^A-Za-z0-9]/g, '') + '-' + pass }));
        };
        if (passes.length > 1) {
          const ps = h('select', { 'aria-label': t('cat.pass') }, passes.map((p) => h('option', { value: p, text: p + (countSet(model.all[p + '|' + comp.name]) ? ' (' + t('cat.countSet', [countSet(model.all[p + '|' + comp.name])]) + ')' : '') })));
          ps.value = pass; ps.addEventListener('change', () => { pass = ps.value; drawPass(); });
          body.appendChild(h('div', { class: 'field' }, [h('label', { text: t('cat.pass') }), ps]));
        }
        body.appendChild(holder);
        drawPass();
      };
      det.addEventListener('toggle', () => { if (det.open) { allState.open = comp.name; build(); } });
      if (det.open) build();
      det.appendChild(body);
      list.appendChild(det);
    });
    count.textContent = t('cat.shown', [n, catalog.components.length]);
    if (m.ok) sb.setStatus('');
    if (!n) list.appendChild(h('p', { class: 'empty', text: m.ok ? t('cat.noMatch') : t('palette.badRegex') }));
  };
  onlySet.addEventListener('change', () => { allState.onlySet = onlySet.checked; draw(); });
  draw();
  if (allState.open) {
    const d = list.querySelector(`[data-comp="${CSS.escape(allState.open)}"]`);
    if (d) {
      const target = allState.focusPath && d.querySelector(`[data-setting-path="${CSS.escape(allState.open + '/' + allState.focusPath)}"]`);
      if (target) S.focusTarget(target); else d.scrollIntoView({ block: 'start' });
    }
    allState.focusPath = null; allState.focusPass = null;
  }
}
function openEditor(pass, comp) {
  allState.pass = pass; allState.open = comp; allState.q = ''; allState.onlySet = false;
  if (catalog && !catalog.byName.get(comp)) { S.toast(t('flow.notInCatalog', [comp])); return; }
  setView('all');
}

// ------------------------------------------------------------------------------------------------
// Global search: every setting in every mode, section and the full catalog
// ------------------------------------------------------------------------------------------------
const gs = { q: '', regex: false, filter: 'all', open: false };
function friendlyEntries() {
  const out = [];
  const errsByMode = {};
  MODE_TABS.forEach((mode) => {
    const saved = model.mode; model.mode = mode;
    errsByMode[mode] = fieldErrors();
    SECTIONS.forEach((sec) => sectionFields(sec, mode).forEach((id) => {
      const def = FIELDS[id];
      if (!def) return;
      const v = getVal(id);
      const d = A.defaultModel();
      const dv = id.startsWith('x.') ? d.extras[id.slice(2)] : id === 'raw' ? '' : d[mode][id];
      const helpKey = 'h.' + id.replace(/^x\./, 'x_');
      const help = t(helpKey, null, '');
      out.push({ id, mode, section: sec.id, sectionLabel: t('tab.' + mode) + ' / ' + t('sec.' + sec.id), label: label(id), help: help === helpKey ? '' : help,
        value: def.type === 'select' && def.options && typeof def.options !== 'function' ? [v, ...(def.options.find((o) => o[0] === String(v)) || []).slice(1).map((k) => t(k))].join(' ') : v,
        sensitive: def.type === 'password', isSet: !isEmpty(v) && JSON.stringify(v) !== JSON.stringify(dv), problem: !!errsByMode[mode][id] || (id === 'accounts' && Object.keys(errsByMode[mode]).some((k) => k.startsWith('accounts.'))) });
    }));
    model.mode = saved;
  });
  return out;
}
function runGlobalSearch() {
  const problems = problemKeys(computeIssues());
  const idx = buildIndex({ model, catalog, friendly: friendlyEntries(), problems });
  return searchIndex(idx, gs.q, { regex: gs.regex, filter: gs.filter });
}
function jumpTo(e) {
  closeGlobalSheet();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (isPhone()) { layout.pane = 'editor'; applyLayout(); }
  if (e.kind === 'field') {
    if (model.mode !== e.mode || view !== 'template') setView(e.mode, { noFocus: true });
    const secs = [...mainEl.querySelectorAll('.b-sec[data-section-index]')];
    const sec = document.getElementById('sec-' + e.section);
    if (sec && isPhone()) { step = Number(sec.dataset.sectionIndex); secs.forEach((x) => x.classList.toggle('active', x === sec)); }
    const el = mainEl.querySelector(`[data-field="${CSS.escape(e.id)}"]`) || sec;
    if (el) S.focusTarget(el);
  } else {
    allState.pass = 'all'; allState.platform = 'all'; allState.q = ''; allState.onlySet = false;
    allState.open = e.comp; allState.focusPath = e.path; allState.focusPass = e.pass;
    setView('all', { noFocus: true });
  }
}
// Search UI instances: the top command search (dropdown, or full-screen sheet on phones), the Search
// side bar and the Search results panel all share the same query state (gs).
const gsUis = [];
let gsBox = null;
function resultItem(r, i, prefix) {
  const e = r.entry;
  const where = e.kind === 'field' ? e.sectionLabel : t('tab.all') + ' / ' + e.comp + (e.isSet ? ' (' + e.pass + ')' : '');
  const li = h('li', { role: 'option', id: prefix + '-r-' + i, tabindex: '-1', class: 'gs-item' }, [
    h('span', { class: 'gs-label' }, [e.kind === 'field' ? e.label : e.path]),
    h('small', { text: where + (e.value ? ' · ' + String(e.value).slice(0, 80) : '') }),
    h('span', { class: 'gs-flags' }, [e.isSet ? h('span', { class: 'setmark', text: t('cat.set') }) : null, e.problem ? h('span', { class: 'sensitive', text: t('status.error') }) : null])
  ]);
  li.addEventListener('click', () => jumpTo(e));
  return li;
}
const STUDIO_CMDS = () => [
  ['studio.validate', () => $('#st-validate').click()], ['studio.buildKit', downloadZip], ['tb.downloadXml', downloadXml], ['tb.import', () => $('#b-import-file').click()], ['tb.export', openExport], ['tb.save', saveVersion],
  ['studio.newFromTemplate', () => openTab('new')], ['studio.shortcuts', openShortcuts], ['studio.toggleSplit', () => { layout.split = !layout.split; applyLayout(); renderView(); }],
  ...['flow', 'disk', 'commands', 'map', 'all', 'simulate', 'compare', 'snippets', 'secrets', 'plan', 'history', 'xml'].map((id) => ['tab.' + id, () => openTab(id)]),
  ...Object.keys(A.SNIPPETS).map((id) => ['snip.' + id, () => { model = A.applySnippet(model, id); commit({ key: 'hist.snippet', args: ['@snip.' + id] }); refreshAround(); if (view === 'template') renderEditorOnly(); S.toast(t('snip.inserted', [t('snip.' + id)])); }])
];
function renderGlobalResults() {
  const res = runGlobalSearch();
  const m = compileQuery(gs.q, gs.regex);
  const cmds = gs.q.trim() && m.ok ? STUDIO_CMDS().filter(([k]) => m.test(t(k))) : [];
  let files = [];
  if (gs.q.trim() && m.ok && manifest) files = A.kitLayout(manifest, model.server.portalsMode).filter((f) => m.test(f.dest)).slice(0, 10);
  gsUis.forEach((ui) => {
    if (!ui.results.isConnected) return;
    ui.results.replaceChildren();
    if (!res.ok) { ui.box.setStatus(t('palette.badRegex') + ' ' + res.error, true); ui.box.input.setAttribute('aria-invalid', 'true'); ui.results.hidden = ui.kind === 'top'; return; }
    ui.box.input.setAttribute('aria-invalid', 'false');
    const active = gs.q.trim() || gs.filter !== 'all';
    if (ui.kind === 'top') ui.results.hidden = !active || !ui.open;
    if (!active) { ui.box.setStatus(''); if (ui.kind !== 'top') ui.results.appendChild(h('li', { class: 'gs-more', text: t('search.global.hint') })); return; }
    ui.box.setStatus(t('search.global.count', [res.total, res.sections.size]), res.total === 0 && !cmds.length);
    cmds.slice(0, 6).forEach(([k, fn], i) => { const li = h('li', { role: 'option', id: ui.kind + '-c-' + i, tabindex: '-1', class: 'gs-item gs-cmd' }, [h('span', { class: 'gs-label', text: '› ' + t(k) }), h('small', { text: t('studio.command') })]); li.addEventListener('click', () => { closeGlobalSheet(); fn(); }); ui.results.appendChild(li); });
    files.forEach((f, i) => { const li = h('li', { role: 'option', id: ui.kind + '-f-' + i, tabindex: '-1', class: 'gs-item gs-cmd' }, [h('span', { class: 'gs-label mono', text: f.dest }), h('small', { text: t('studio.file') })]); li.addEventListener('click', () => { closeGlobalSheet(); openTab('file:' + f.src); }); ui.results.appendChild(li); });
    res.results.slice(0, 80).forEach((r, i) => ui.results.appendChild(resultItem(r, i, ui.kind)));
    if (res.total > 80) ui.results.appendChild(h('li', { class: 'gs-more', text: t('search.global.more', [res.total - 80]) }));
    if (!res.total && !cmds.length) ui.results.appendChild(h('li', { class: 'gs-more', text: gs.filter === 'problems' ? t('search.global.noProblems') : t('palette.empty') }));
  });
}
function closeGlobalSheet() {
  gsUis.forEach((ui) => { if (ui.kind === 'top') { ui.open = false; ui.results.hidden = true; ui.panel.classList.remove('as-sheet', 'open'); ui.panel.removeAttribute('role'); ui.panel.removeAttribute('aria-modal'); ui.box.input.setAttribute('aria-expanded', 'false'); } });
}
// kind: 'top' (top bar), 'side' or 'panel'
function buildSearchUi(host, kind) {
  kind = kind || 'top';
  for (let i = gsUis.length - 1; i >= 0; i--) if (gsUis[i].kind === kind || !gsUis[i].results.isConnected) gsUis.splice(i, 1);
  if (!host) { renderGlobalResults(); gsUis.forEach((u) => { u.box.input.value = gs.q; }); return; }
  const results = h('ul', { class: 'gs-results', id: kind + '-gs-results', role: 'listbox', 'aria-label': t('search.global.results'), hidden: kind === 'top' });
  const n = catalog ? catalog.components.reduce((a, c) => { let k = 0; (function w(l) { l.forEach((x) => { k++; w(x.children || []); }); })(c.settings); return a + k; }, 0) : 0;
  const box = searchBox({ label: t('search.global'), placeholder: kind === 'top' ? t('studio.searchPh', [n || '']) : t('search.global.ph'), value: gs.q, regex: gs.regex, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'),
    onChange: (q, regex) => { gs.q = q; gs.regex = regex; gsUis.forEach((u) => { if (u.box !== box) u.box.input.value = q; }); if (kind === 'top' && (q.trim() || gs.filter !== 'all')) openTop(); renderGlobalResults(); },
    onKey: (e) => {
      const items = [...results.querySelectorAll('.gs-item')];
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); if (kind === 'top') openTop(); items[0].focus(); }
      if (e.key === 'Enter') { e.preventDefault(); const first = results.querySelector('.gs-item'); if (first) first.click(); }
      if (e.key === 'Escape' && kind === 'top') { closeGlobalSheet(); }
    } });
  box.input.id = kind + '-gs-input';
  box.input.setAttribute('aria-controls', results.id);
  if (kind === 'top') { box.input.setAttribute('role', 'combobox'); box.input.setAttribute('aria-expanded', 'false'); }
  results.addEventListener('keydown', (e) => {
    const items = [...results.querySelectorAll('.gs-item')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); (items[i + 1] || items[i]).focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? items[i - 1] : box.input).focus(); }
    else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); items[i].click(); }
    else if (e.key === 'Escape') { e.preventDefault(); box.input.focus(); if (kind === 'top') closeGlobalSheet(); }
  });
  const filterSel = h('select', { id: kind + '-gs-filter', 'aria-label': t('search.show') }, [['all', 'search.show.all'], ['set', 'search.show.set'], ['problems', 'search.show.problems']].map(([v, k]) => h('option', { value: v, text: t(k) })));
  filterSel.value = gs.filter;
  filterSel.addEventListener('change', () => { gs.filter = filterSel.value; gsUis.forEach((u) => { u.filter.value = gs.filter; }); if (kind === 'top') openTop(); renderGlobalResults(); });
  const closeB = h('button', { type: 'button', class: 'btn btn-ghost btn-sm gs-close', text: t('common.close'), onclick: () => { closeGlobalSheet(); box.input.blur(); } });
  const kbd = kind === 'top' ? h('kbd', { class: 'gs-kbd', 'aria-hidden': 'true', text: 'Ctrl Shift F' }) : null;
  const panel = h('div', { class: 'gs-panel gs-' + kind, id: kind + '-gs-panel' }, [h('div', { class: 'gs-row' }, [box.el, kbd, h('label', { class: 'gs-show', for: kind + '-gs-filter' }, [h('span', { text: t('search.show') }), filterSel]), closeB]), results]);
  const ui = { kind, box, results, panel, filter: filterSel, open: false };
  function openTop() {
    if (kind !== 'top' || ui.open) return;
    ui.open = true; panel.classList.add('open'); box.input.setAttribute('aria-expanded', 'true');
    if (isPhone()) { panel.classList.add('as-sheet'); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); }
  }
  if (kind === 'top') {
    box.input.addEventListener('focus', () => { if (gs.q || isPhone()) { openTop(); renderGlobalResults(); } });
    document.addEventListener('pointerdown', (e) => { if (ui.open && !panel.contains(e.target)) closeGlobalSheet(); });
    panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeGlobalSheet(); box.input.blur(); } });
  }
  gsUis.push(ui);
  host.replaceChildren(panel);
  if (kind === 'top') gsBox = box;
  renderGlobalResults();
  return ui;
}
function buildGlobalSearch() { buildSearchUi(document.getElementById('st-search'), 'top'); }
// In the studio, Ctrl+Shift+F focuses the command search in the top bar (capture phase, before the site palette).
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f') && gsBox) { e.preventDefault(); e.stopImmediatePropagation(); gsBox.input.focus(); gsBox.input.select(); }
}, true);
// The site command palette also offers every setting.
S.addPaletteSource((q, regex) => {
  if (!q || !q.trim()) return [];
  const saved = { q: gs.q, regex: gs.regex, filter: gs.filter };
  gs.q = q; gs.regex = regex; gs.filter = 'all';
  const r = runGlobalSearch();
  Object.assign(gs, saved);
  if (!r.ok) return [];
  return r.results.slice(0, 30).map((x) => ({ kind: 'field', label: x.entry.kind === 'field' ? x.entry.label : x.entry.path, sub: x.entry.kind === 'field' ? x.entry.sectionLabel : x.entry.comp, action: () => jumpTo(x.entry) }));
});

// ------------------------------------------------------------------------------------------------
// Canvases
// ------------------------------------------------------------------------------------------------
function generatedComponents() {
  const tree = A.buildModelTree(Object.assign({}, model, { all: {}, raw: '', commands: {} }));
  const out = [];
  tree.c.forEach((s) => s.c.forEach((c) => out.push({ pass: s.a.pass, comp: c.a.name, count: countSet(A.elementToValue(c)) })));
  return out;
}
function generatedCommands(listId) {
  const def = A.COMMAND_LISTS[listId];
  const tree = A.buildModelTree(Object.assign({}, model, { all: {}, raw: '', commands: {} }));
  const set = tree.c.find((s) => s.a.pass === def.pass);
  const comp = set && set.c.find((c) => c.a.name === def.component);
  const list = comp && comp.c.find((x) => x.n === def.list);
  return list ? list.c.map((it) => ({ command: (it.c.find((x) => x.n === def.cmd) || { t: '' }).t, description: (it.c.find((x) => x.n === 'Description') || { t: '' }).t })) : [];
}
function renderCanvas(kind) {
  const box = h('div', { class: 'b-sec' }, [h('header', null, [h('h2', { id: 'cv-h', text: t('tab.' + kind) })]), h('p', { class: 'help', style: { color: 'var(--muted)' }, text: t('canvas.' + kind + '.help') })]);
  const root = h('div');
  box.appendChild(root);
  mainEl.appendChild(box);
  if (kind === 'flow') {
    if (!catalog) { root.appendChild(h('p', { text: t('cat.loading') })); return; }
    mountFlow(root, { t, catalog, getModel: () => model, generated: generatedComponents, onAll: (all, msg) => { model.all = all; commit(msg); renderView(); }, openEditor, announce });
  } else if (kind === 'disk') {
    mountDisk(root, { t, get: () => model.disks, set: (l, msg, co) => { model.disks = l; commit(msg, co ? 'disk:' + co : null); } });
  } else if (kind === 'commands') {
    mountCommands(root, { t, get: () => model.commands, set: (c, msg, co) => { model.commands = c; commit(msg, co ? 'cmd:' + co : null); }, generated: generatedCommands });
  } else if (kind === 'map') {
    mountDeploy(root, { t, getModel: () => model, setModel: (m, msg, co) => { model = m; commit(msg, co ? 'map:' + co : null); } });
  }
}

// ------------------------------------------------------------------------------------------------
// What will happen + checklist
// ------------------------------------------------------------------------------------------------
function planContent(forPrint) {
  const mode = model.mode, f = model[mode];
  const box = h('div');
  box.appendChild(h('h2', { id: 'plan-h', text: t('plan.title', ['@']).replace('@', t('tab.' + mode)) }));
  const ol = h('ol', { class: 'timeline' });
  for (let i = 1; i <= A.TIMELINE[mode]; i++) ol.appendChild(h('li', null, [h('b', { text: t(`tl.${mode}.${i}.t`) }), h('span', { text: t(`tl.${mode}.${i}.d`, [f.computerName || '*', f.domainName || '', f.ipAddress || '', f.dnsServer || '']) })]));
  box.appendChild(ol);
  box.appendChild(h('h2', { id: 'check-h', text: t('plan.checklist') }));
  const ul = h('ul', { class: 'checklist' });
  for (let i = 1; i <= A.CHECKLIST[mode]; i++) {
    const id = `ck-${mode}-${i}`;
    const key = 'td.ck.' + mode + '.' + i;
    const cb = h('input', { type: 'checkbox', id, checked: LS.get(key, '0') === '1' });
    cb.addEventListener('change', () => LS.set(key, cb.checked ? '1' : '0'));
    ul.appendChild(h('li', null, [h('label', { class: 'check', for: id }, [forPrint ? h('span', { text: '[  ]' }) : cb, h('span', { text: t(`ck.${mode}.${i}`, [f.computerName || '', f.domainName || '']) })])]));
  }
  box.appendChild(ul);
  const errs = Object.values(fieldErrors());
  box.appendChild(h('p', { class: 'notice' + (errs.length ? ' warn' : ' ok'), text: errs.length ? t('plan.problems', [errs.length]) : t('plan.noProblems') }));
  return box;
}
function renderPlan() {
  const sec = h('div', { class: 'b-sec' }, [planContent(false)]);
  sec.appendChild(h('div', { class: 'cta' }, [btn('plan.print', printChecklist, 'btn-primary')]));
  mainEl.appendChild(sec);
}
function printChecklist() {
  let area = document.getElementById('print-area');
  if (!area) { area = h('div', { id: 'print-area' }); document.body.appendChild(area); }
  area.replaceChildren(h('h1', { text: 'TempDesk: ' + t('tab.' + model.mode) }), h('p', { text: new Date().toLocaleString() }), planContent(true));
  window.print();
}

// ------------------------------------------------------------------------------------------------
// History panel
// ------------------------------------------------------------------------------------------------
function msgText(msg) {
  if (!msg) return '';
  if (typeof msg === 'string') return msg;
  const args = (msg.args || []).map((a) => {
    if (typeof a === 'string' && a[0] === '@') return t(a.slice(1));
    if (typeof a === 'number' && a > 1e12) return new Date(a).toLocaleString();
    return a;
  });
  return t(msg.key, args);
}
function xmlOf(state) { try { const r = A.normalizeModel(state); return r.ok ? A.buildXml(r.model) : ''; } catch (e) { return ''; } }
function diffView(a, b) {
  const lines = A.lineDiff(a, b);
  const pre = h('pre', { class: 'diff', tabindex: '0' });
  let changes = 0;
  lines.forEach((l) => { if (l.op !== ' ') changes++; pre.appendChild(h('span', { class: l.op === '+' ? 'add' : l.op === '-' ? 'del' : null, text: l.op + ' ' + l.line + '\n' })); });
  return h('div', null, [h('p', { class: 'meter-label', text: t('hist.diffCount', [changes]) }), pre]);
}
async function renderHistory() {
  const sec = h('div', { class: 'b-sec' }, [h('header', null, [h('h2', { id: 'hist-h', text: t('tab.history') })])]);
  mainEl.appendChild(sec);
  if (!history) { sec.appendChild(h('p', { text: t('hist.unavailable') })); return; }
  history.flush();
  const rememberCb = h('input', { type: 'checkbox', checked: remember() });
  rememberCb.addEventListener('change', () => { LS.set('td.rememberPw', rememberCb.checked ? '1' : '0'); S.toast(t(rememberCb.checked ? 'hist.rememberOn' : 'hist.rememberOff')); });
  const storage = h('div', { class: 'storage' });
  sec.append(
    h('p', { class: 'help', style: { color: 'var(--muted)' }, text: t('hist.help', [history.store.kind]) }),
    h('label', { class: 'check' }, [rememberCb, t('hist.remember')]),
    storage,
    h('div', { class: 'cta', style: { margin: '8px 0 14px' } }, [
      btn('tb.undo', undo, 'btn-ghost', { 'data-undo': '' }), btn('tb.redo', redo, 'btn-ghost', { 'data-redo': '' }),
      btn('tb.save', saveVersion, 'btn-ghost'), btn('hist.export', exportHistory, 'btn-ghost'), btn('hist.gitFolder', gitFolder, 'btn-ghost'), btn('hist.clear', clearHistory, 'btn-coral')]),
    h('p', { class: 'notice', text: t('hist.gitNote') }));
  const diffBox = h('div', { id: 'hist-diff' });
  const filter = h('select', { 'aria-label': t('hist.filter') }, [['all', 'hist.filter.all'], ['versions', 'hist.filter.versions']].map(([v, k]) => h('option', { value: v, text: t(k) })));
  sec.append(h('div', { class: 'field', style: { maxWidth: '280px' } }, [h('label', { text: t('hist.filter') }), filter]));
  const ul = h('ul', { class: 'hist-list' });
  const cur = xmlOf(model);
  let hq = '', hre = false;
  const hsb = searchBox({ label: t('search.history'), placeholder: t('search.history'), compact: true, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'), onChange: (q, re) => { hq = q; hre = re; drawList(); } });
  sec.append(hsb.el);
  const drawList = () => {
    ul.replaceChildren();
    let entries = history.entries.slice().reverse().filter((e) => filter.value === 'all' || e.kind === 'save' || e.kind === 'download');
    const fr = filterList(entries, hq, (e) => msgText(e.msg) + ' ' + new Date(e.t).toLocaleString() + ' #' + e.id + ' ' + (e.label || ''), hre);
    if (!fr.ok) return;
    entries = fr.items.map((x) => x.it);
    if (hq) hsb.setStatus(t('search.listCount', [entries.length, history.entries.length]), !entries.length);
    entries.slice(0, 500).forEach((e, idx) => {
      const li = h('li', { class: e === history.head() ? 'cur' : null }, [
        h('span', { class: 'msg' }, [h('span', { text: msgText(e.msg) }), h('br'), h('small', { text: new Date(e.t).toLocaleString() + ' · #' + e.id + ' · ' + t('hist.kind.' + e.kind) })]),
        btn('hist.diffCurrent', () => { diffBox.replaceChildren(h('h3', { text: t('hist.diffWith', ['#' + e.id]) }), diffView(xmlOf(e.state), cur)); diffBox.scrollIntoView({ block: 'nearest' }); }, 'btn-ghost btn-sm'),
        idx < entries.length - 1 ? btn('hist.diffPrev', () => { const prev = history.byId(e.back !== null && e.back !== undefined ? e.back : e.id - 1) || entries[idx + 1]; diffBox.replaceChildren(h('h3', { text: t('hist.diffPrevTitle', ['#' + e.id]) }), diffView(xmlOf(prev.state), xmlOf(e.state))); }, 'btn-ghost btn-sm') : null,
        e === history.head() ? h('small', { text: t('hist.current') }) : btn('hist.restoreBtn', () => { const r = history.restore(e.id); if (r) { applyState(r.state); S.toast(t('hist.restored')); } }, 'btn-primary btn-sm')
      ]);
      ul.appendChild(li);
    });
    if (entries.length > 500) ul.appendChild(h('li', null, [t('hist.more', [entries.length - 500])]));
  };
  filter.addEventListener('change', drawList);
  drawList();
  sec.append(ul, diffBox);
  const bytes = await history.store.bytes().catch(() => 0);
  let est = null;
  try { est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null; } catch (e) { est = null; }
  const fmt = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.ceil(b / 1024) + ' KB';
  storage.replaceChildren(h('span', { text: t('hist.storage', [history.entries.length, fmt(bytes)]) + (est && est.quota ? ' · ' + t('hist.quota', [fmt(est.usage || 0), fmt(est.quota)]) : '') }),
    h('div', { class: 'meter', 'data-score': '4' }, [h('i', { style: { width: est && est.quota ? Math.max(1, Math.min(100, (est.usage || 0) / est.quota * 100)) + '%' : '0%' } })]));
}
function exportHistory() { download('tempdesk-builder-history.json', history.exportJson({ app: 'answer-file-builder', passwordsStored: remember() }), 'application/json'); }
function gitFolder() {
  const files = [];
  const versions = history.entries.filter((e) => e.kind === 'save' || e.kind === 'download' || e.kind === 'start');
  versions.forEach((e, i) => {
    const stamp = new Date(e.t).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const lab = String(e.label || e.kind).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 40) || e.kind;
    files.push({ name: `tempdesk-answer-files/versions/${String(i + 1).padStart(4, '0')}-${stamp}-${lab}.xml`, data: xmlOf(e.state) });
  });
  files.push({ name: 'tempdesk-answer-files/autounattend.xml', data: A.buildXml(model) });
  files.push({ name: 'tempdesk-answer-files/README.md', data: t('git.readme', [new Date().toISOString(), versions.length]).replace(/\\n/g, '\n') + '\n' });
  files.push({ name: 'tempdesk-answer-files/.gitignore', data: '# Answer files with real passwords should not be committed.\n*.local.xml\nsecrets/\n' });
  downloadBlob('tempdesk-answer-files.zip', Z.makeZip(files));
}
function clearHistory() {
  const word = t('hist.clearWord');
  const dlg = h('div', { class: 'sheet center', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'clr-h' });
  const inp = h('input', { type: 'text', id: 'clr-in', autocomplete: 'off', 'aria-describedby': 'clr-d' });
  const cb = h('input', { type: 'checkbox' });
  const go = h('button', { type: 'button', class: 'btn btn-coral', disabled: true, text: t('hist.clearConfirm') });
  const check = () => { go.disabled = !(cb.checked && inp.value.trim() === word); };
  inp.addEventListener('input', check); cb.addEventListener('change', check);
  go.addEventListener('click', async () => { await history.clear(); S.closeSheet(dlg); dlg.remove(); S.toast(t('hist.cleared')); renderView(); });
  dlg.appendChild(h('div', { class: 'sheet-panel' }, [h('h2', { id: 'clr-h', text: t('hist.clearTitle') }), h('p', { id: 'clr-d', text: t('hist.clearBody', [history.entries.length, word]) }),
    h('label', { class: 'check' }, [cb, t('hist.clearUnderstand')]), h('div', { class: 'field' }, [h('label', { for: 'clr-in', text: t('hist.clearType', [word]) }), inp]),
    h('div', { class: 'cta' }, [go, btn('common.cancel', () => { S.closeSheet(dlg); dlg.remove(); })])]));
  document.body.appendChild(dlg); S.trap(dlg); S.openSheet(dlg, '#clr-in');
}
function saveVersion() {
  const name = window.prompt(t('ver.prompt'), t('ver.default', [new Date().toLocaleString()]));
  if (name === null) return;
  history.mark('save', name.slice(0, 80));
  S.toast(t('ver.saved'));
  updateUndo();
  if (view === 'history') renderView();
}

// ------------------------------------------------------------------------------------------------
// Preview refresh (the studio shows XML in the split view, the XML tab and the XML panel)
// ------------------------------------------------------------------------------------------------
let pvTimer = null;
function schedulePreview() { clearTimeout(pvTimer); pvTimer = setTimeout(() => { lastXml = A.buildXml(model); refreshAround(); }, 150); }
// ------------------------------------------------------------------------------------------------
// Downloads, copy, export
// ------------------------------------------------------------------------------------------------
function downloadBlob(name, blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function download(name, text, type) { downloadBlob(name, new Blob([text], { type: type || 'text/plain' })); }
function confirmProblems() {
  const n = Object.keys(fieldErrors()).length;
  return !n || window.confirm(t('dl.confirmProblems', [n]));
}
function copyXml() {
  const text = A.buildXml(model);
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => S.toast(t('tb.copied')), () => S.toast(t('tb.copyFailed')));
}
function downloadXml() {
  if (!confirmProblems()) return;
  download('autounattend.xml', A.buildXml(model), 'application/xml');
  history && history.mark('download', 'autounattend.xml');
  updateUndo();
}
async function sha256Hex(bytes) {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function downloadZip() {
  if (!confirmProblems()) return;
  const btnEl = document.getElementById('b-dl-zip');
  const files = [{ name: 'autounattend.xml', data: A.buildXml(model) }];
  try {
    if (btnEl) btnEl.disabled = true;
    if (model.mode === 'server') {
      S.toast(t('dl.fetching'));
      const r = await fetch(ROOT + 'payload/manifest.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(t('dl.noManifest'));
      const manifest = await r.json();
      files.push({ name: 'TempDesk/firstboot.json', data: A.buildFirstboot(model.server) });
      const plan = A.kitLayout(manifest, model.server.portalsMode);
      for (const item of plan) {
        const fr = await fetch(ROOT + 'payload/' + item.src.split('/').map(encodeURIComponent).join('/'), { cache: 'no-cache' });
        if (!fr.ok) throw new Error(t('dl.fileMissing', [item.src]));
        const bytes = new Uint8Array(await fr.arrayBuffer());
        if ((await sha256Hex(bytes)) !== item.sha256) throw new Error(t('dl.hashMismatch', [item.src]));
        files.push({ name: item.dest, data: bytes });
      }
    } else {
      files.push({ name: 'README.txt', data: [t('dl.readmeTitle', [t('tab.' + model.mode)]), '', ...Array.from({ length: A.CHECKLIST[model.mode] }, (_, i) => '[ ] ' + t(`ck.${model.mode}.${i + 1}`, [model[model.mode].computerName || '', model[model.mode].domainName || ''])), ''].join('\r\n') });
    }
    downloadBlob('tempdesk-' + model.mode + '-kit.zip', Z.makeZip(files));
    history && history.mark('download', 'tempdesk-' + model.mode + '-kit.zip');
    updateUndo();
    S.toast(t('dl.done', [files.length]));
  } catch (e) {
    S.toast(t('dl.failed', [e.message]));
    const box = document.getElementById('b-errors'); if (box) { box.hidden = false; box.textContent = t('dl.failed', [e.message]); }
  } finally { if (btnEl) btnEl.disabled = false; }
}
function sheet(titleKey, content) {
  const dlg = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dlg-h' });
  const close = () => { S.closeSheet(dlg); dlg.remove(); };
  dlg.appendChild(h('div', { class: 'sheet-panel' }, [h('div', { class: 'sheet-head' }, [h('h2', { id: 'dlg-h', text: t(titleKey) }), iconButton('del', t('common.close'), close, { html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>' })]), ...content(close)]));
  document.body.appendChild(dlg); S.trap(dlg); S.openSheet(dlg);
  const obs = new MutationObserver(() => { if (dlg.hidden) { dlg.remove(); obs.disconnect(); } });
  obs.observe(dlg, { attributes: true, attributeFilter: ['hidden'] });
  return close;
}
function openExport() {
  sheet('exp.title', (close) => {
    const inc = h('input', { type: 'checkbox' });
    return [
      h('p', { class: 'help', style: { color: 'var(--muted)' }, text: t('exp.help') }),
      h('label', { class: 'check' }, [inc, t('exp.includePw')]),
      h('div', { class: 'cta' }, [
        btn('exp.json', () => { download('tempdesk-answer-model.json', JSON.stringify(inc.checked ? model : A.stripSecrets(model), null, 2) + '\n', 'application/json'); close(); }, 'btn-primary'),
        btn('tb.downloadXml', () => { close(); downloadXml(); }, 'btn-ghost'),
        btn('tb.downloadZip', () => { close(); downloadZip(); }, 'btn-ghost'),
        model.mode === 'server' ? btn('exp.firstboot', () => { download('firstboot.json', A.buildFirstboot(model.server), 'application/json'); close(); }, 'btn-ghost') : null]),
      h('p', { class: 'notice warn', text: t('exp.pwWarn') })];
  });
}

// ------------------------------------------------------------------------------------------------
// Import (validates fully before applying; never applies partially)
// ------------------------------------------------------------------------------------------------
function knownComponent(name) { return !!(catalog && catalog.byName.get(name)); }
function report(lines, okFlag) {
  sheet('imp.title', (close) => [h('div', { class: 'notice ' + (okFlag ? 'ok' : 'warn'), role: 'status' }, [h('div', { class: 'report', text: lines.join('\n') })]), btn('common.close', close, 'btn-primary')]);
}
async function importFile(file) {
  if (file.size > 5 * 1024 * 1024) { report([t('imp.tooBig')], false); return; }
  const text = await file.text();
  const trimmed = text.replace(/^﻿/, '').trim();
  if (trimmed.startsWith('<')) return importXmlText(text);
  let json;
  try { json = JSON.parse(trimmed); } catch (e) { report([t('imp.badJson')], false); return; }
  if (json && json.schema === 'tempdesk-answer-model') {
    const r = A.normalizeModel(json);
    if (!r.ok) { report([t('imp.badModel', [t('err.model.' + r.error.split('.')[1], null, r.error)])], false); return; }
    model = mergeSecrets(r.model, model); commit({ key: 'hist.importJson', args: [file.name] }); renderView();
    report([t('imp.modelOk', [file.name])], true);
  } else if (json && json.schema === 'tempdesk-presets') {
    importPresetBundle(json, file.name);
  } else if (json && typeof json === 'object' && 'domainName' in json && 'netbiosName' in json) {
    try {
      const f = A.importFirstboot(trimmed, model.server);
      model.server = Object.assign(model.server, f); model.mode = 'server'; view = 'server';
      commit({ key: 'hist.importFirstboot', args: [file.name] }); renderView();
      report([t('imp.firstbootOk', [file.name])], true);
    } catch (e) { report([t('imp.badJson')], false); }
  } else report([t('imp.unknownJson')], false);
}
function importXmlText(text) {
  let r;
  try { r = A.importXml(text, { knownComponent, defaults: A.defaultModel() }); }
  catch (e) { report([t('imp.badXml', [e.message])], false); return; }
  const next = clone(model);
  next.mode = r.mode;
  next[r.mode] = Object.assign(A.defaultModel()[r.mode], r.form);
  next.commands = r.commands; next.disks = r.disks; next.extras = r.extras; next.all = r.all; next.raw = r.raw;
  const check = A.normalizeModel(next);
  if (!check.ok) { report([t('imp.badModel', [check.error])], false); return; }
  model = check.model;
  view = r.mode;
  commit({ key: 'hist.importXml', args: ['@tab.' + r.mode] });
  renderView();
  const lines = [t('imp.xmlOk', [t('tab.' + r.mode)])];
  const cmdN = Object.values(r.commands).reduce((n, l) => n + l.length, 0);
  if (cmdN) lines.push(t('imp.commands', [cmdN]));
  if (r.disks) lines.push(t('imp.disks'));
  const allN = Object.keys(r.all).length;
  if (allN) lines.push(t('imp.all', [allN]));
  if (r.unknown.length) { lines.push(t('imp.unknown', [r.unknown.length])); r.unknown.slice(0, 40).forEach((u) => lines.push('  ' + u)); }
  else lines.push(t('imp.allUnderstood'));
  r.notes.forEach((n) => lines.push(t('imp.note.' + n)));
  report(lines, !r.unknown.length);
}

// ------------------------------------------------------------------------------------------------
// Presets (localStorage) and bundles
// ------------------------------------------------------------------------------------------------
const PKEY = 'td.presets';
function loadPresets() { try { const p = JSON.parse(LS.get(PKEY, '{}')); return p && typeof p === 'object' ? p : {}; } catch (e) { return {}; } }
function savePresets(p) { if (!LS.set(PKEY, JSON.stringify(p))) { S.toast(t('pre.storageFull')); return false; } return true; }
function importPresetBundle(json, name) {
  const r = A.normalizePresetBundle(json);
  if (!r.ok) { report([t('pre.bad', [t('err.' + r.error, null, r.error), r.index || ''])], false); return; }
  const cur = loadPresets();
  const names = Object.keys(r.presets);
  names.forEach((n) => { cur[n] = r.presets[n]; });
  if (savePresets(cur)) report([t('pre.imported', [names.length, name])], true);
}
function openPresets() {
  sheet('pre.title', (close) => {
    const box = h('div', { class: 'list-ed' });
    const nameIn = h('input', { type: 'text', id: 'pre-name', maxlength: '80', placeholder: t('pre.namePh') });
    const inc = h('input', { type: 'checkbox' });
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only' });
    fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; fileIn.value = ''; if (!f) return; try { importPresetBundle(JSON.parse(await f.text()), f.name); draw(); } catch (e) { report([t('imp.badJson')], false); } });
    let pq = '', pre = false;
    const psb = searchBox({ label: t('search.presets'), placeholder: t('search.presets'), compact: true, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'), onChange: (q, re) => { pq = q; pre = re; draw(); } });
    const draw = () => {
      const p = loadPresets();
      box.replaceChildren();
      const all = Object.keys(p).sort();
      const fr = filterList(all, pq, (n) => n + ' ' + t('tab.' + (p[n].mode || 'server')), pre);
      const names = fr.ok ? fr.items.map((x) => x.it) : [];
      if (pq) psb.setStatus(t('search.listCount', [names.length, all.length]), !names.length);
      if (!names.length) box.appendChild(h('p', { class: 'empty', text: t('pre.none') }));
      names.forEach((n) => box.appendChild(h('div', { class: 'list-row' }, [h('b', { text: n }), h('small', { class: 'meter-label', text: t('tab.' + (p[n].mode || 'server')) }), h('div', { class: 'row-tools' }, [
        btn('pre.load', () => { const r = A.normalizeModel(p[n]); if (!r.ok) { S.toast(t('pre.badOne')); return; } model = mergeSecrets(r.model, model); view = model.mode; commit({ key: 'hist.presetLoad', args: [n] }); close(); renderView(); }, 'btn-primary btn-sm'),
        btn('pre.delete', () => { if (!window.confirm(t('pre.deleteConfirm', [n]))) return; delete p[n]; savePresets(p); draw(); }, 'btn-ghost btn-sm')])])));
    };
    draw();
    return [
      h('div', { class: 'field' }, [h('label', { for: 'pre-name', text: t('pre.name') }), nameIn]),
      h('label', { class: 'check' }, [inc, t('pre.includePw')]),
      h('div', { class: 'cta' }, [btn('pre.save', () => { const n = nameIn.value.trim(); if (!n || ['__proto__', 'prototype', 'constructor'].includes(n)) { S.toast(t('pre.nameBad')); return; } const p = loadPresets(); if (p[n] && !window.confirm(t('pre.replace', [n]))) return; p[n] = inc.checked ? clone(model) : A.stripSecrets(model); if (savePresets(p)) { S.toast(t('pre.saved', [n])); nameIn.value = ''; draw(); } }, 'btn-primary')]),
      h('h3', { text: t('pre.saved.title') }), psb.el, box,
      h('div', { class: 'cta' }, [btn('pre.export', () => { const p = loadPresets(); const out = {}; Object.keys(p).forEach((k) => { out[k] = inc.checked ? p[k] : A.stripSecrets(p[k]); }); download('tempdesk-presets.json', JSON.stringify({ schema: 'tempdesk-presets', version: 1, presets: out }, null, 2) + '\n', 'application/json'); }, 'btn-ghost'),
        btn('pre.import', () => fileIn.click(), 'btn-ghost'), fileIn]),
      h('p', { class: 'help', style: { color: 'var(--muted)' }, text: t('pre.help') })];
  });
}

// ------------------------------------------------------------------------------------------------
// Editors
// ------------------------------------------------------------------------------------------------
function renderNew() {
  const sec = h('div', { class: 'b-sec' }, [h('header', null, [h('h2', { id: 'new-h', text: t('studio.newTitle') })]), h('p', { class: 'help', style: { color: 'var(--muted)' }, text: t('studio.newHelp') })]);
  const grid = h('div', { class: 'st-gallery' });
  MODE_TABS.forEach((m) => grid.appendChild(h('button', { type: 'button', class: 'st-card' + (model.mode === m ? ' on' : ''), onclick: () => {
    if (model.mode !== m) { model.mode = m; commit({ key: 'hist.mode', args: ['@tab.' + m] }); }
    tabs = tabs.filter((x) => x !== 'new'); openTab('template');
  } }, [h('b', { text: t('tab.' + m) }), h('span', { text: t('mode.' + m + '.intro') }), model.mode === m ? h('small', { class: 'setmark', text: t('studio.current') }) : null])));
  grid.appendChild(h('button', { type: 'button', class: 'st-card', onclick: () => { if (window.confirm(t('studio.blankConfirm'))) { const keepMode = model.mode; model = A.defaultModel(); model.mode = keepMode; commit({ key: 'hist.blank', args: [] }); tabs = ['template']; view = 'template'; saveTabs(); renderView(); } } }, [h('b', { text: t('studio.blank') }), h('span', { text: t('studio.blankHelp') })]));
  grid.appendChild(h('button', { type: 'button', class: 'st-card', onclick: () => $('#b-import-file').click() }, [h('b', { text: t('tb.import') }), h('span', { text: t('studio.importHelp') })]));
  sec.appendChild(grid);
  mainEl.appendChild(sec);
}
function renderComponentTab(key) {
  const [pass, name] = key.split('|');
  const comp = catalog && catalog.byName.get(name);
  const sec = h('div', { class: 'b-sec' }, [h('header', null, [h('h2', { id: 'comp-h', class: 'mono', style: { overflowWrap: 'anywhere' }, text: name }), h('span', { class: 'pass-chip', text: pass })])]);
  mainEl.appendChild(sec);
  // what the template already writes for this component (read only)
  const tree = A.buildModelTree(Object.assign({}, model, { all: {}, raw: '' }));
  const set = tree.c.find((s) => s.a.pass === pass);
  const gen = set && set.c.find((c) => c.a.name === name);
  if (gen) sec.appendChild(h('details', { class: 'st-gen' }, [h('summary', { text: t('studio.fromTemplate', [countSet(A.elementToValue(gen))]) }), h('pre', { class: 'st-code-ro', html: A.highlightXml(A.serialize(gen, { newline: '\n' }).replace(/^<\?xml[^>]*>\n/, '')) })]));
  if (!comp) { sec.appendChild(h('p', { class: 'notice', text: catalog ? t('studio.notInCatalog') : t('cat.loading') })); return; }
  if (comp.help) sec.appendChild(h('p', { class: 'help', style: { color: 'var(--muted)' }, text: comp.help }));
  if (!comp.passes.includes(pass)) sec.appendChild(h('p', { class: 'notice warn', text: t('flow.compNotInPass', [name, pass]) }));
  const ff = searchBox({ label: t('search.fields'), placeholder: t('search.fields'), compact: true, regexLabel: t('search.regex'), badRegex: t('palette.badRegex'),
    onChange: (q, re, m) => { let n = 0, total = 0; holder.querySelectorAll('.cat-set').forEach((f) => { total++; const ok = m.ok && (m.empty || !!m.test(f.textContent)); f.hidden = !ok; if (ok) n++; if (ok && !m.empty) { let p = f.parentElement; while (p && p !== holder) { if (p.tagName === 'DETAILS') p.open = true; if (p.hidden) p.hidden = false; p = p.parentElement; } } }); if (m.ok) ff.setStatus(m.empty ? '' : t('search.fieldCount', [n, total]), !n); } });
  sec.querySelector('header').appendChild(h('div', { class: 'sec-tools' }, [ff.el]));
  const holder = h('div');
  holder.appendChild(renderSettings(comp, model.all[key], (v, msg, co) => allChange(key, v, msg, co, null), { t, pass, expandPath: selected && selected.comp === name ? selected.path : null, idPrefix: 'ct-' + name.replace(/[^A-Za-z0-9]/g, '') + '-' + pass }));
  sec.appendChild(holder);
}
// Code editor: a textarea over a highlighted layer, with line numbers. Two-way for autounattend.xml.
// Code editor: CodeMirror 6 (assets/vendor/codemirror.js, bundled at build time, no CDN) with XML
// autocomplete from the catalog, lint markers from the parser and the rules engine, folding and
// search and replace (Ctrl+F). Two-way for autounattend.xml and firstboot.json.
let xmlSchemaCache = null;
function xmlSchema() {
  if (xmlSchemaCache) return xmlSchemaCache;
  if (!catalog) return {};
  const names = new Map();
  const walk = (list) => list.forEach((s) => { names.set(s.name, s.help || ''); walk(s.children || []); });
  catalog.components.forEach((c) => walk(c.settings));
  const elements = [
    { name: 'unattend', top: true, children: ['settings', 'servicing'], attributes: ['xmlns', 'xmlns:wcm', 'xmlns:xsi'] },
    { name: 'settings', children: ['component'], attributes: [{ name: 'pass', values: A.PASS_ORDER }] },
    { name: 'component', attributes: [{ name: 'name', values: catalog.components.map((c) => c.name) }, { name: 'processorArchitecture', values: ['amd64', 'x86', 'arm64'] }, { name: 'publicKeyToken', values: ['31bf3856ad364e35'] }, { name: 'language', values: ['neutral'] }, { name: 'versionScope', values: ['nonSxS'] }] },
  ];
  names.forEach((help, name) => { if (!['unattend', 'settings', 'component'].includes(name)) elements.push({ name, attributes: [{ name: 'wcm:action', values: ['add', 'modify', 'remove'] }, 'wcm:keyValue'] }); });
  xmlSchemaCache = { elements };
  return xmlSchemaCache;
}
// Lint: parse errors at their line, rules engine issues at the element they name.
function lintXml(text) {
  const out = [];
  const lineStart = (n) => { let pos = 0; for (let k = 1; k < n; k++) { const nl = text.indexOf('\n', pos); if (nl < 0) break; pos = nl + 1; } return pos; };
  try { A.parseXml(text); } catch (e) {
    const from = e.line ? lineStart(e.line) : 0;
    const end = text.indexOf('\n', from);
    return [{ from, to: end < 0 ? text.length : end, severity: 'error', message: e.message }];
  }
  if (!rules || !catalog || !catalog.raw) return out;
  let issues;
  try { issues = rules.validateModel(rules.parseXml(text, catalog.raw).model, catalog.raw); } catch (e) { return [{ from: 0, to: Math.min(text.length, 40), severity: 'error', message: e.message }]; }
  issues.forEach((i) => {
    const parts = String(i.where).split('/');
    if (parts.length < 2) return;
    let pos = text.indexOf('<settings pass="' + parts[0] + '"');
    if (pos < 0) return;
    const ca = text.indexOf('name="' + parts[1] + '"', pos);
    if (ca < 0) return;
    pos = ca;
    const compEnd = text.indexOf('</component>', ca);
    for (const seg of parts.slice(2)) {
      const m = /^([^\[]+)(?:\[(\d+)\])?$/.exec(seg); if (!m) break;
      let at = pos, n = m[2] ? Number(m[2]) : 0;
      do { at = text.indexOf('<' + m[1].split('/').pop(), at + 1); } while (at >= 0 && n-- > 0);
      if (at < 0 || (compEnd >= 0 && at > compEnd)) break;
      pos = at;
    }
    const end = text.indexOf('>', pos);
    out.push({ from: pos, to: end < 0 ? pos + 1 : end + 1, severity: i.level === 'error' ? 'error' : i.level === 'warning' ? 'warning' : 'info', message: i.message + ' (' + i.id + ')' });
  });
  return out;
}
function codeEditor(text, opts) {
  const host = h('div', { class: 'st-cm' });
  const status = h('div', { class: 'pv-status', role: 'status', 'aria-live': 'polite' });
  let tm;
  const cm = window.TempDeskCM.createCodeEditor(host, {
    doc: text, lang: opts.lang, readOnly: !!opts.readonly, label: opts.label,
    schema: opts.lang === 'xml' ? xmlSchema() : undefined,
    lint: opts.lang === 'xml' ? lintXml : undefined,
    onChange: (v) => { clearTimeout(tm); if (opts.onEdit) tm = setTimeout(() => opts.onEdit(v, status), 500); }
  });
  return { el: h('div', { class: 'st-editorbox' }, [host, status]), cm, status, set(v) { if (!cm.hasFocus()) cm.set(v); cm.relint(); } };
}
let xmlEditor = null;
function xmlEdited(text, status) {
  try {
    const r = A.syncFromXml(model, text, { knownComponent });
    const before = A.buildXml(model);
    model = r.model;
    const after = A.buildXml(model);
    status.className = 'pv-status';
    status.textContent = r.unknown.length ? t('studio.syncUnknown', [r.unknown.length]) : t('studio.synced');
    if (after !== before) { commit({ key: 'hist.xmlEdit', args: [] }, 'xml-edit'); refreshAround(); }
  } catch (e) {
    status.className = 'pv-status bad';
    status.textContent = t('studio.xmlNotApplied', [e.message]);
  }
}
function renderXmlTab() {
  const ed = codeEditor(A.buildXml(model), { lang: 'xml', label: 'autounattend.xml', onEdit: xmlEdited });
  xmlEditor = ed;
  mainEl.appendChild(h('div', { class: 'b-sec st-fill' }, [h('header', null, [h('h2', { id: 'xml-h', class: 'mono', text: 'autounattend.xml' }), h('span', { class: 'meter-label', text: t('studio.twoWay') })]), ed.el]));
}
function renderFirstbootTab() {
  const ed = codeEditor(A.buildFirstboot(model.server), { lang: 'json', label: 'firstboot.json', onEdit: (text, status) => {
    try { const f = A.importFirstboot(text, model.server); model.server = Object.assign(model.server, f); status.className = 'pv-status'; status.textContent = t('studio.synced'); commit({ key: 'hist.importFirstboot', args: ['firstboot.json'] }, 'fb-edit'); refreshAround(); }
    catch (e) { status.className = 'pv-status bad'; status.textContent = t('studio.xmlNotApplied', [e.message]); }
  } });
  mainEl.appendChild(h('div', { class: 'b-sec st-fill' }, [h('header', null, [h('h2', { class: 'mono', text: 'TempDesk/firstboot.json' }), h('span', { class: 'meter-label', text: t('studio.fbNote') })]), ed.el]));
}
async function renderFileTab(src) {
  const sec = h('div', { class: 'b-sec st-fill' }, [h('header', null, [h('h2', { class: 'mono', style: { overflowWrap: 'anywhere' }, text: src }), h('span', { class: 'meter-label', text: t('studio.readOnly') })])]);
  mainEl.appendChild(sec);
  try {
    const r = await fetch(ROOT + 'payload/' + src.split('/').map(encodeURIComponent).join('/'));
    if (!r.ok) throw new Error(String(r.status));
    const text = await r.text();
    if (view !== 'file:' + src) return;
    sec.appendChild(codeEditor(text, { lang: /\.xml$/.test(src) ? 'xml' : 'text', label: src, readonly: true }).el);
  } catch (e) { sec.appendChild(h('p', { class: 'notice warn', text: t('dl.fileMissing', [src]) })); }
}
// Compare: against the last saved version, a history entry, or another file
let compareWith = { kind: 'saved', id: null, text: null, name: '' };
function renderCompare() {
  const sec = h('div', { class: 'b-sec' }, [h('header', null, [h('h2', { id: 'cmp-h', text: t('tab.compare') })])]);
  mainEl.appendChild(sec);
  const sel = h('select', { id: 'cmp-src', 'aria-label': t('cmp.with') }, [h('option', { value: 'saved', text: t('cmp.saved') }), h('option', { value: 'history', text: t('cmp.history') }), h('option', { value: 'file', text: t('cmp.file') })]);
  sel.value = compareWith.kind;
  const histSel = h('select', { 'aria-label': t('cmp.history') }, (history ? history.entries.slice().reverse() : []).slice(0, 300).map((e) => h('option', { value: String(e.id), text: '#' + e.id + ' ' + msgText(e.msg) })));
  if (compareWith.id !== null) histSel.value = String(compareWith.id);
  const fileIn = h('input', { type: 'file', accept: '.xml,application/xml,text/xml', 'aria-label': t('cmp.file') });
  const out = h('div');
  const run = () => {
    let other = null, label = '';
    if (compareWith.kind === 'saved') { const e = history && history.entries.slice().reverse().find((x) => x.kind === 'save' || x.kind === 'download'); if (e) { other = xmlOf(e.state); label = '#' + e.id + ' ' + msgText(e.msg); } }
    else if (compareWith.kind === 'history') { const e = history && history.byId(Number(histSel.value)); if (e) { other = xmlOf(e.state); label = '#' + e.id; compareWith.id = e.id; } }
    else if (compareWith.text) { other = compareWith.text; label = compareWith.name; }
    out.replaceChildren();
    if (!other) { out.appendChild(h('p', { class: 'empty', text: t('cmp.nothing') })); return; }
    let c;
    try { c = A.compareXml(other, A.buildXml(model)); } catch (e) { out.appendChild(h('p', { class: 'notice warn', text: t('imp.badXml', [e.message]) })); return; }
    out.appendChild(h('p', { class: 'meter-label', text: t('cmp.summary', [label, c.added.length, c.removed.length, c.changed.length, c.same]) }));
    const tb = h('table', null, [h('thead', null, [h('tr', null, [h('th', { text: t('cmp.change') }), h('th', { text: t('cmp.setting') }), h('th', { text: t('cmp.before') }), h('th', { text: t('cmp.after') })])])]);
    const body = h('tbody');
    c.changed.forEach((x) => body.appendChild(h('tr', { class: 'chg' }, [h('td', { text: t('cmp.changed') }), h('td', { class: 'mono', text: x.path }), h('td', { text: x.from }), h('td', { text: x.to })])));
    c.added.forEach((x) => body.appendChild(h('tr', { class: 'add' }, [h('td', { text: t('cmp.added') }), h('td', { class: 'mono', text: x.path }), h('td', { text: '' }), h('td', { text: x.value })])));
    c.removed.forEach((x) => body.appendChild(h('tr', { class: 'del' }, [h('td', { text: t('cmp.removed') }), h('td', { class: 'mono', text: x.path }), h('td', { text: x.value }), h('td', { text: '' })])));
    tb.appendChild(body);
    out.appendChild(h('div', { class: 'tablebox', tabindex: '0' }, [tb]));
    out.appendChild(h('details', null, [h('summary', { text: t('cmp.lines') }), diffView(other, A.buildXml(model))]));
  };
  sel.addEventListener('change', () => { compareWith.kind = sel.value; histSel.hidden = sel.value !== 'history'; fileIn.hidden = sel.value !== 'file'; run(); });
  histSel.addEventListener('change', run);
  fileIn.addEventListener('change', async () => { const f = fileIn.files[0]; if (!f) return; compareWith.text = await f.text(); compareWith.name = f.name; run(); });
  histSel.hidden = compareWith.kind !== 'history'; fileIn.hidden = compareWith.kind !== 'file';
  sec.appendChild(h('div', { class: 'inline', style: { flexWrap: 'wrap', gap: '8px', marginBottom: '10px' } }, [sel, histSel, fileIn]));
  sec.appendChild(out);
  run();
}
// Simulate: play the setup pass by pass
let simStep = 0, simTimer = null;
function renderSimulate() {
  let steps;
  try { steps = A.simulate(A.buildXml(model)); } catch (e) { mainEl.appendChild(h('p', { class: 'notice warn', text: e.message })); return; }
  const sec = h('div', { class: 'b-sec' }, [h('header', null, [h('h2', { id: 'sim-h', text: t('tab.simulate') })]), h('p', { class: 'help', style: { color: 'var(--muted)' }, text: t('sim.help') })]);
  mainEl.appendChild(sec);
  const ol = h('ol', { class: 'st-sim' });
  const detail = h('div', { class: 'st-sim-detail', role: 'region', 'aria-live': 'polite', 'aria-label': t('sim.current') });
  const show = () => {
    simStep = Math.max(0, Math.min(steps.length - 1, simStep));
    [...ol.children].forEach((li, i) => { li.classList.toggle('on', i === simStep); li.classList.toggle('done', i < simStep); li.setAttribute('aria-current', i === simStep ? 'step' : 'false'); });
    const s = steps[simStep];
    detail.replaceChildren(h('h3', { text: (simStep + 1) + '. ' + s.pass + ' · ' + t('sim.when.' + s.when) }));
    if (s.skipped) detail.appendChild(h('p', { class: 'notice', text: t(s.pass === 'generalize' ? 'sim.skipGeneralize' : 'sim.skipAudit') }));
    if (!s.applies.length && !s.skipped) detail.appendChild(h('p', { class: 'empty', text: t('sim.nothing') }));
    s.applies.forEach((a) => detail.appendChild(h('details', { open: s.applies.length <= 3 || undefined }, [h('summary', { class: 'mono', text: a.comp + ' (' + a.settings.length + ')' }), h('ul', { class: 'st-values' }, a.settings.slice(0, 80).map((x) => h('li', { class: 'mono', text: x })))])));
    if (s.commands.length) detail.appendChild(h('ol', { class: 'st-values' }, s.commands.map((c) => h('li', null, [c.text, c.reboot ? h('span', { class: 'reboot', text: ' ' + t('sim.reboot.' + c.reboot) }) : null]))));
    if (s.reboot) detail.appendChild(h('p', { class: 'reboot', text: t('sim.restart') }));
  };
  steps.forEach((s, i) => ol.appendChild(h('li', { class: s.skipped ? 'sim-skip' : null }, [h('button', { type: 'button', onclick: () => { simStep = i; show(); } }, [h('b', { text: s.pass }), h('small', { text: s.skipped ? t('sim.skipped') : t('sim.count', [s.applies.reduce((n, a) => n + a.settings.length, 0), s.commands.length]) }), s.reboot ? h('span', { class: 'reboot', text: '↻' }) : null])])));
  const play = h('button', { type: 'button', class: 'btn btn-primary btn-sm', text: t('sim.play') });
  play.addEventListener('click', () => {
    if (simTimer) { clearInterval(simTimer); simTimer = null; play.textContent = t('sim.play'); return; }
    play.textContent = t('sim.pause');
    const delay = document.documentElement.dataset.motion === 'off' ? 1500 : 1200;
    simTimer = setInterval(() => { if (simStep >= steps.length - 1 || view !== 'simulate') { clearInterval(simTimer); simTimer = null; play.textContent = t('sim.play'); return; } simStep++; show(); }, delay);
  });
  sec.append(h('div', { class: 'cta' }, [btn('sim.prev', () => { simStep--; show(); }, 'btn-ghost btn-sm'), play, btn('sim.next', () => { simStep++; show(); }, 'btn-ghost btn-sm')]), h('div', { class: 'st-simgrid' }, [ol, detail]));
  show();
}
function renderSnippets() {
  const sec = h('div', { class: 'b-sec' }, [h('header', null, [h('h2', { id: 'snip-h', text: t('tab.snippets') })]), h('p', { class: 'help', style: { color: 'var(--muted)' }, text: t('snip.help') })]);
  const grid = h('div', { class: 'st-gallery' });
  Object.keys(A.SNIPPETS).forEach((id) => grid.appendChild(h('button', { type: 'button', class: 'st-card', onclick: () => {
    model = A.applySnippet(model, id); commit({ key: 'hist.snippet', args: ['@snip.' + id] }); output(t('hist.snippet', [t('snip.' + id)])); S.toast(t('snip.inserted', [t('snip.' + id)])); refreshAround();
  } }, [h('b', { text: t('snip.' + id) }), h('span', { text: t('snip.' + id + '.d') })])));
  sec.appendChild(grid);
  mainEl.appendChild(sec);
}
function renderSecrets() {
  const sec = h('div', { class: 'b-sec' }, [h('header', null, [h('h2', { id: 'sec-h2', text: t('tab.secrets') })]), h('p', { class: 'help', style: { color: 'var(--muted)' }, text: t('secrets.help') })]);
  const rows = [];
  Object.keys(A.SECRET_FIELDS).forEach((mode) => A.SECRET_FIELDS[mode].forEach((k) => { if (mode === model.mode) rows.push([t('tab.' + mode) + ' / ' + label(k), model[mode][k], k === 'joinPassword' ? 'plain' : 'encoded', () => revealField(k)]); }));
  if (model.mode === 'custom') model.custom.accounts.forEach((a, i) => rows.push([t('f.account') + ' ' + (i + 1) + ' (' + (a.name || '?') + ')', a.password, 'encoded', () => revealField('accounts')]));
  Object.keys(model.commands).forEach((k) => (model.commands[k] || []).forEach((it, i) => { if (it.credentials && (it.credentials.username || it.credentials.password)) rows.push([t('cmd.' + k) + ' #' + (i + 1), it.credentials.password, 'plain', () => openTab('commands')]); }));
  (function walk(v, p) { if (!v || typeof v !== 'object') return; Object.keys(v).forEach((k) => { if (k === '@password') rows.push([p.join(' / '), v[k], 'encoded', () => { const [ps, c] = p[0].split('|'); openTab('comp:' + ps + '|' + c); }]); else walk(v[k], p.concat(k)); }); })(model.all, []);
  const tb = h('table', null, [h('thead', null, [h('tr', null, [h('th', { text: t('secrets.where') }), h('th', { text: t('secrets.value') }), h('th', { text: t('secrets.stored') }), h('th', { text: '' })])])]);
  const body = h('tbody');
  rows.forEach(([where, val, how, go]) => {
    const masked = h('span', { class: 'mono', text: val ? '•'.repeat(Math.min(16, val.length)) : t('secrets.empty') });
    body.appendChild(h('tr', null, [h('td', { text: where }), h('td', null, [masked]), h('td', { text: t('secrets.' + how) }), h('td', null, [h('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: t('studio.reveal'), onclick: go }),
      val ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': 'false', text: t('pw.show'), onclick: (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); masked.textContent = on ? val : '•'.repeat(Math.min(16, val.length)); } }) : null])]));
  });
  if (!rows.length) body.appendChild(h('tr', null, [h('td', { colspan: '4', text: t('secrets.none') })]));
  tb.appendChild(body);
  const rememberCb = h('input', { type: 'checkbox', checked: remember() });
  rememberCb.addEventListener('change', () => { LS.set('td.rememberPw', rememberCb.checked ? '1' : '0'); S.toast(t(rememberCb.checked ? 'hist.rememberOn' : 'hist.rememberOff')); });
  sec.append(h('div', { class: 'tablebox', tabindex: '0' }, [tb]), h('label', { class: 'check' }, [rememberCb, t('hist.remember')]), h('p', { class: 'notice warn', text: t('exp.pwWarn') }));
  mainEl.appendChild(sec);
}

// Keep the editor, explorer, inspector, panel and status in step after a change made elsewhere.
function refreshAround() {
  issuesCache = null;
  if (layout.sideOpen && layout.side === 'explorer') renderSide();
  if (layout.panelOpen) renderPanel();
  if (layout.split && view !== 'xml' && splitEditor) splitEditor.set(A.buildXml(model));
  if (xmlEditor && view === 'xml') xmlEditor.set(A.buildXml(model));
  renderStatusBar();
}
let splitEditor = null;
function renderView() {
  const focusId = document.activeElement && document.activeElement.id;
  const sel = focusId && document.activeElement.selectionStart !== undefined ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  issuesCache = null;
  renderTabs();
  const ed = $('#st-editor');
  mainEl = h('div', { class: 'b-main st-main', id: 'b-main', role: 'tabpanel', 'aria-labelledby': 'tab-' + cssId(view), tabindex: '-1' });
  indexEl = h('nav', { class: 'b-index', id: 'b-index', 'aria-label': t('studio.sections') });
  xmlEditor = null;
  const content = h('div', { class: 'st-content' + (view === 'template' ? ' with-index' : '') });
  if (view === 'template') content.appendChild(indexEl);
  content.appendChild(mainEl);
  const parts = [content];
  splitEditor = null;
  if (layout.split && view !== 'xml' && view !== 'firstboot' && !view.startsWith('file:') && !isPhone()) {
    splitEditor = codeEditor(A.buildXml(model), { lang: 'xml', label: 'autounattend.xml', onEdit: (text, status) => { xmlEdited(text, status); renderEditorOnly(); } });
    parts.push(h('div', { class: 'st-splitxml' }, [h('div', { class: 'st-splitxml-h mono', text: 'autounattend.xml' }), splitEditor.el]));
  }
  ed.replaceChildren(...parts);
  ed.classList.toggle('split', parts.length > 1);
  renderEditorContent();
  renderSide(); renderInspector(); renderPanel(); renderStatusBar();
  updateUndo();
  S.translateAll(ed);
  if (focusId) { const f = document.getElementById(focusId); if (f && f !== document.activeElement) { f.focus({ preventScroll: true }); if (sel && f.setSelectionRange) try { f.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } } }
}
function renderEditorOnly() {
  const scroll = mainEl.scrollTop;
  mainEl.replaceChildren(); indexEl.replaceChildren();
  renderEditorContent();
  mainEl.scrollTop = scroll;
}
function renderEditorContent() {
  if (view === 'template') renderMode(model.mode);
  else if (view === 'new') renderNew();
  else if (view === 'all') renderAll();
  else if (['flow', 'disk', 'commands', 'map'].includes(view)) renderCanvas(view);
  else if (view === 'plan') renderPlan();
  else if (view === 'history') renderHistory();
  else if (view === 'xml') renderXmlTab();
  else if (view === 'firstboot') renderFirstbootTab();
  else if (view === 'compare') renderCompare();
  else if (view === 'simulate') renderSimulate();
  else if (view === 'snippets') renderSnippets();
  else if (view === 'secrets') renderSecrets();
  else if (view.startsWith('comp:')) renderComponentTab(view.slice(5));
  else if (view.startsWith('file:')) renderFileTab(view.slice(5));
  else renderNew();
}

// Global keys
document.addEventListener('keydown', (e) => {
  const inField = e.target && e.target.matches && e.target.matches('input, textarea, select, [contenteditable]');
  if ((e.key === 'F1' || (e.key === '?' && !inField)) && !e.ctrlKey) { e.preventDefault(); openShortcuts(); return; }
  if (!(e.ctrlKey || e.metaKey)) { if (e.altKey && /^[1-9]$/.test(e.key)) { e.preventDefault(); const id = tabs[Number(e.key) - 1]; if (id) { view = id; saveTabs(); renderView(); } } return; }
  const k = e.key.toLowerCase();
  if (e.target && e.target.closest && e.target.closest('.cm-editor') && (k === 'z' || k === 'y' || k === 'f')) return; // the code editor has its own undo and search
  if (k === 'z' && !e.shiftKey && !e.altKey) { e.preventDefault(); undo(); }
  else if ((k === 'y' || (k === 'z' && e.shiftKey)) && !e.altKey) { e.preventDefault(); redo(); }
  else if (k === 's' && !e.shiftKey) { e.preventDefault(); saveVersion(); }
  else if (k === 'b' && !e.shiftKey) { e.preventDefault(); layout.sideOpen = !layout.sideOpen; applyLayout(); }
  else if (k === 'j' && !e.shiftKey) { e.preventDefault(); layout.panelOpen = !layout.panelOpen; applyLayout(); renderPanel(); }
  else if (k === 'i' && e.altKey) { e.preventDefault(); layout.inspOpen = !layout.inspOpen; applyLayout(); renderInspector(); }
  else if (k === '\\') { e.preventDefault(); layout.split = !layout.split; applyLayout(); renderView(); }
});
document.addEventListener('contextmenu', (e) => {
  const f = e.target.closest && e.target.closest('#st-editor [data-field], #st-editor [data-setting-path]');
  if (!f) return;
  e.preventDefault();
  const sp = f.dataset.settingPath;
  contextMenu(e, sp ? [['ctx.inspect', () => { const [c, ...r] = sp.split('/'); selected = { comp: c, pass: view.startsWith('comp:') ? view.slice(5).split('|')[0] : '', path: r.join('/') }; layout.inspOpen = true; applyLayout(); renderInspector(); }], ['ctx.revealXml', () => revealInXml(sp.split('/')[0], view.startsWith('comp:') ? view.slice(5).split('|')[0] : '')], ['ctx.copyPath', () => navigator.clipboard && navigator.clipboard.writeText(sp)]]
    : [['ctx.revealXml', () => openTab('xml')], ['ctx.search', () => { gs.q = label(f.dataset.field); buildSearchUi(null); sidebar('search'); }]]);
});

async function init() {
  shell.hidden = false;
  try { window.TempDeskCM = await import(new URL(ROOT + 'assets/vendor/codemirror.js', document.baseURI).href); } catch (e) { output('CodeMirror: ' + e.message); }
  try {
    const store = await HI.openStore('builder');
    history = new HI.History({ store, initial: A.stripSecrets(A.defaultModel()), redact, onChange: () => updateUndo() });
    await history.load();
    const r = A.normalizeModel(history.head().state);
    if (r.ok) model = r.model;
  } catch (e) { history = null; }
  if (isPhone()) layout.sideOpen = layout.pane === 'explorer';
  buildActivity(); buildTopbar(); buildGlobalSearch();
  makeSplitter($('#st-split-side'), 'sideW', 'x', 180, 520, false);
  makeSplitter($('#st-split-insp'), 'inspW', 'x', 220, 560, true);
  makeSplitter($('#st-split-panel'), 'panelH', 'y', 90, Math.round(innerHeight * 0.7), true);
  $('#st-split').addEventListener('click', () => { layout.split = !layout.split; applyLayout(); renderView(); });
  $('#st-insp-toggle').addEventListener('click', () => { layout.inspOpen = !layout.inspOpen; applyLayout(); renderInspector(); });
  document.querySelectorAll('.st-phonebar [data-pane]').forEach((b) => b.addEventListener('click', () => { layout.pane = b.dataset.pane; if (layout.pane === 'explorer') layout.sideOpen = true; if (layout.pane === 'inspector') layout.inspOpen = true; if (layout.pane === 'problems') { layout.panelOpen = true; layout.panel = 'problems'; } applyLayout(); renderSide(); renderInspector(); renderPanel(); }));
  applyLayout();
  renderView();
  output(t('studio.ready'));
  catalog = await loadCatalog(ROOT);
  await loadRules();
  xmlSchemaCache = null;
  output(catalog.origin === 'full' ? t('cat.full', [catalog.components.length, catalog.version]) : t('cat.notBuilt', [catalog.components.length]));
  if (rules) output(t('checks.loaded'));
  buildGlobalSearch();
  renderView();
  S.onLang(() => { buildActivity(); buildTopbar(); buildGlobalSearch(); renderView(); applyLayout(); });
}
init();
