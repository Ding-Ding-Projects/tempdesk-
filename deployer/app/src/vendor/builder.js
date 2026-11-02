// TempDesk answer file builder (page logic). All work happens in this browser; nothing is uploaded.
// Pure XML generation lives in answer.js (window.TempDeskAnswer); canvases live in ./canvas/.
import { h, iconButton, clone, ICONS } from './canvas/dom.js';
import { loadCatalog, renderSettings, countSet, isEmpty, searchText, PASSES } from './canvas/catalog.js';
import { mountFlow } from './canvas/flow.js';
import { mountDisk, validateLayout } from './canvas/disk.js';
import { mountCommands } from './canvas/commands.js';
import { mountDeploy } from './canvas/deploy.js';

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
let view = LS.get('td.builder.view', 'server');
if (![...MODE_TABS, ...TOOL_TABS, ...INFO_TABS].includes(view)) view = 'server';
let step = 0;
let catalog = null;
let history = null;
const adv = new Set();
let lastXml = '';
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
function commit(msg, coalesce) {
  if (history) history.change(model, msg, coalesce || null);
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
// DOM skeleton
// ------------------------------------------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const tabsEl = $('#b-tabs'), toolbarEl = $('#b-toolbar'), bodyEl = $('#b-body'), indexEl = $('#b-index'), mainEl = $('#b-main'), previewEl = $('#b-preview');
const live = h('div', { class: 'sr-only', 'aria-live': 'polite' });
document.body.appendChild(live);
function announce(text) { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); }

function buildTabs() {
  tabsEl.replaceChildren();
  const add = (id) => {
    const b = h('button', { type: 'button', role: 'tab', id: 'tab-' + id, 'aria-controls': 'b-main', 'aria-selected': String(view === id), tabindex: view === id ? '0' : '-1', class: MODE_TABS.includes(id) && model.mode === id ? 'mode-current' : null, text: t('tab.' + id) });
    b.addEventListener('click', () => setView(id));
    b.addEventListener('keydown', (e) => {
      const all = [...tabsEl.querySelectorAll('[role=tab]')];
      const i = all.indexOf(b);
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length]; n.focus(); n.click(); }
    });
    tabsEl.appendChild(b);
  };
  MODE_TABS.forEach(add); tabsEl.appendChild(h('span', { class: 'sep', 'aria-hidden': 'true' }));
  TOOL_TABS.forEach(add); tabsEl.appendChild(h('span', { class: 'sep', 'aria-hidden': 'true' }));
  INFO_TABS.forEach(add);
}
function setView(id, opts) {
  if (MODE_TABS.includes(id) && model.mode !== id) {
    model.mode = id;
    commit({ key: 'hist.mode', args: ['@tab.' + id] });
  }
  view = id; LS.set('td.builder.view', id);
  if (!opts || !opts.keepStep) step = 0;
  renderView();
  const tb = $('#tab-' + id); if (tb && (!opts || !opts.noFocus)) tb.focus({ preventScroll: true });
}

function btn(key, onclick, cls, extra) { return h('button', Object.assign({ type: 'button', class: 'btn ' + (cls || 'btn-ghost'), onclick }, extra || {}), [t(key)]); }
let undoBtn, redoBtn;
function buildToolbar() {
  const fileIn = h('input', { type: 'file', accept: '.xml,.json,application/xml,text/xml,application/json', class: 'sr-only', id: 'b-import-file', 'aria-label': t('tb.import') });
  fileIn.addEventListener('change', () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) importFile(f); });
  undoBtn = h('button', { type: 'button', class: 'iconbtn', html: ICONS.left, 'aria-label': t('tb.undo'), title: t('tb.undo') + ' (Ctrl+Z)', onclick: undo });
  redoBtn = h('button', { type: 'button', class: 'iconbtn', html: ICONS.right, 'aria-label': t('tb.redo'), title: t('tb.redo') + ' (Ctrl+Y)', onclick: redo });
  undoBtn.style.border = redoBtn.style.border = '1px solid var(--outline2)';
  toolbarEl.replaceChildren(undoBtn, redoBtn,
    btn('tb.import', () => fileIn.click(), 'btn-ghost', { id: 'b-import', 'data-palette-field': t('tb.import'), 'data-palette-group': t('tb.group') }), fileIn,
    btn('tb.export', openExport, 'btn-ghost', { 'data-palette-field': t('tb.export'), 'data-palette-group': t('tb.group') }),
    btn('tb.presets', openPresets, 'btn-ghost', { 'data-palette-field': t('tb.presets'), 'data-palette-group': t('tb.group') }),
    btn('tb.save', saveVersion, 'btn-ghost', { 'data-palette-field': t('tb.save'), 'data-palette-group': t('tb.group') }),
    h('span', { class: 'grow' }),
    btn('tb.copy', copyXml, 'btn-ghost'),
    btn('tb.downloadXml', downloadXml, 'btn-primary', { id: 'b-dl-xml' }),
    btn('tb.downloadZip', downloadZip, 'btn-inverse', { id: 'b-dl-zip' }));
  updateUndo();
}
function updateUndo() {
  if (!undoBtn) return;
  undoBtn.disabled = !history || !history.canUndo();
  redoBtn.disabled = !history || !history.canRedo();
  document.querySelectorAll('[data-undo]').forEach((b) => { b.disabled = undoBtn.disabled; });
  document.querySelectorAll('[data-redo]').forEach((b) => { b.disabled = redoBtn.disabled; });
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
    if (def.type === 'select' || def.type === 'edition') {
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
  list.forEach((a, i) => {
    const row = h('div', { class: 'list-row' });
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
  const intro = h('div', { class: 'notice' }, [t('mode.' + mode + '.intro')]);
  mainEl.appendChild(intro);
  secs.forEach((sec, i) => {
    const status = sectionStatus(sec, mode, errors);
    const a = h('a', { href: '#sec-' + sec.id, 'aria-current': stepper && i === step ? 'step' : undefined, 'data-sec': sec.id }, [h('span', { class: 'sdot', 'data-s': status, 'aria-hidden': 'true' }), h('span', { text: t('sec.' + sec.id) }), h('span', { class: 'sr-only', text: ', ' + t('status.' + status) })]);
    a.addEventListener('click', (e) => { if (stepper) { e.preventDefault(); step = i; renderView(); const s = document.getElementById('sec-' + sec.id); if (s) s.scrollIntoView({ block: 'start' }); } });
    indexEl.appendChild(a);
    const isAdv = adv.has(sec.id);
    const advBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-pressed': String(isAdv), text: isAdv ? t('adv.hide') : t('adv.show') });
    const head = h('header', null, [h('h2', { id: 'sec-' + sec.id + '-h' }, [h('span', { class: 'sdot', 'data-s': status, 'aria-hidden': 'true' }), t('sec.' + sec.id)]), sec.adv && sec.adv.length ? advBtn : null]);
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
      btn('step.prev', () => { step = Math.max(0, i - 1); renderView(); window.scrollTo({ top: 0 }); }, 'btn-ghost', { disabled: i === 0 || undefined }),
      h('span', { class: 'meter-label', style: { alignSelf: 'center' }, text: t('step.of', [i + 1, secs.length]) }),
      btn('step.next', () => { step = Math.min(secs.length - 1, i + 1); renderView(); window.scrollTo({ top: 0 }); }, 'btn-primary', { disabled: i === secs.length - 1 || undefined })]));
    mainEl.appendChild(el);
  });
}
function updateStatus() {
  if (!MODE_TABS.includes(view)) return;
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
  const q = h('input', { type: 'search', id: 'cat-search', value: allState.q, placeholder: t('cat.search'), 'aria-label': t('cat.search') });
  const reBtn = h('button', { type: 'button', class: 'iconbtn regex-toggle', 'aria-pressed': String(allState.regex), 'aria-label': t('search.regex'), title: t('search.regex'), text: '.*' });
  const onlySet = h('input', { type: 'checkbox', checked: allState.onlySet });
  const list = h('div', { id: 'cat-list' });
  const count = h('div', { class: 'meter-label', 'aria-live': 'polite' });
  mainEl.appendChild(h('div', { class: 'b-sec' }, [h('header', null, [h('h2', { id: 'all-h', text: t('tab.all') })]),
    h('div', { class: 'cat-tools' }, [h('div', { class: 'searchrow' }, [q, reBtn]), h('div', { class: 'cat-filters' }, [passSeg]), h('div', { class: 'cat-filters' }, [platSeg, h('label', { class: 'check' }, [onlySet, t('cat.onlySet')])]), count]), list]));
  const draw = () => {
    const m = S.makeMatcher(allState.q, allState.regex);
    q.setAttribute('aria-invalid', String(!m.ok));
    list.replaceChildren();
    let n = 0;
    catalog.components.forEach((comp) => {
      if (allState.pass !== 'all' && !comp.passes.includes(allState.pass)) return;
      if (allState.platform !== 'all' && !comp.platforms.includes(allState.platform)) return;
      const setCount = comp.passes.reduce((s, p) => s + countSet(model.all[p + '|' + comp.name]), 0);
      if (allState.onlySet && !setCount) return;
      if (!m.test(searchText(comp))) return;
      n++;
      const det = h('details', { class: 'cat-comp', 'data-comp': comp.name, open: allState.open === comp.name || undefined }, [h('summary', null, [
        h('span', { text: comp.name }), h('small', { class: 'cnt', text: setCount ? t('cat.countSet', [setCount]) : '' }),
        h('span', { class: 'pass-chips' }, comp.passes.map((p) => h('span', { class: 'pass-chip', text: p })))])]);
      const body = h('div', { class: 'cat-body' });
      const build = () => {
        if (body.childNodes.length) return;
        if (comp.help) body.appendChild(h('p', { class: 'help', text: comp.help }));
        const passes = allState.pass === 'all' ? comp.passes : [allState.pass];
        let pass = passes.find((p) => countSet(model.all[p + '|' + comp.name])) || passes[0];
        const holder = h('div');
        const drawPass = () => {
          const key = pass + '|' + comp.name;
          holder.replaceChildren(renderSettings(comp, model.all[key], (v, msg, co) => allChange(key, v, msg, co, det), { t, pass, idPrefix: 'all-' + comp.name.replace(/[^A-Za-z0-9]/g, '') + '-' + pass }));
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
    if (!n) list.appendChild(h('p', { class: 'empty', text: m.ok ? t('cat.noMatch') : t('palette.badRegex') }));
  };
  let tm;
  q.addEventListener('input', () => { allState.q = q.value; clearTimeout(tm); tm = setTimeout(draw, 150); });
  reBtn.addEventListener('click', () => { allState.regex = !allState.regex; reBtn.setAttribute('aria-pressed', String(allState.regex)); draw(); });
  onlySet.addEventListener('change', () => { allState.onlySet = onlySet.checked; draw(); });
  draw();
  if (allState.open) { const d = list.querySelector(`[data-comp="${CSS.escape(allState.open)}"]`); if (d) d.scrollIntoView({ block: 'start' }); }
}
function openEditor(pass, comp) {
  allState.pass = pass; allState.open = comp; allState.q = ''; allState.onlySet = false;
  if (catalog && !catalog.byName.get(comp)) { S.toast(t('flow.notInCatalog', [comp])); return; }
  setView('all');
}

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
  const drawList = () => {
    ul.replaceChildren();
    const entries = history.entries.slice().reverse().filter((e) => filter.value === 'all' || e.kind === 'save' || e.kind === 'download');
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
// Preview
// ------------------------------------------------------------------------------------------------
let pvFile = 'xml', pvTimer = null;
function schedulePreview() { clearTimeout(pvTimer); pvTimer = setTimeout(renderPreview, 120); }
function currentFiles() {
  const files = [['xml', 'autounattend.xml', A.buildXml(model)]];
  if (model.mode === 'server') files.push(['json', 'TempDesk/firstboot.json', A.buildFirstboot(model.server)]);
  return files;
}
function renderPreview() {
  const files = currentFiles();
  if (!files.find((f) => f[0] === pvFile)) pvFile = 'xml';
  const file = files.find((f) => f[0] === pvFile);
  lastXml = files[0][2];
  let ok = true, msg;
  if (pvFile === 'xml') { try { A.parseXml(file[2]); msg = t('pv.ok', [file[2].split('\n').length - 1, new Blob([file[2]]).size]); } catch (e) { ok = false; msg = t('pv.bad', [e.message]); } }
  else msg = t('pv.json', [new Blob([file[2]]).size]);
  const errs = Object.keys(fieldErrors()).length;
  if (errs) msg += ' · ' + t('pv.problems', [errs]);
  const pre = h('pre', { tabindex: '0', 'aria-label': file[1], html: pvFile === 'xml' ? A.highlightXml(file[2]) : file[2].replace(/&/g, '&amp;').replace(/</g, '&lt;') });
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('pv.file') }, files.map(([k, n]) => h('button', { type: 'button', 'aria-pressed': String(k === pvFile), text: n, onclick: () => { pvFile = k; renderPreview(); } })));
  const closeB = h('button', { type: 'button', class: 'iconbtn', 'aria-label': t('common.close'), html: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>', onclick: closePreviewSheet, hidden: !previewEl.classList.contains('as-sheet') });
  const scroll = previewEl.querySelector('pre') ? previewEl.querySelector('pre').scrollTop : 0;
  previewEl.replaceChildren(h('div', { class: 'pv' }, [h('div', { class: 'pv-head' }, [h('b', { text: t('pv.title') }), seg, h('div', { class: 'inline' }, [btn('tb.copy', copyXml, 'btn-ghost btn-sm'), closeB])]), pre, h('div', { class: 'pv-status' + (ok && !errs ? '' : ' bad'), role: 'status', text: msg })]));
  previewEl.querySelector('pre').scrollTop = scroll;
}
function openPreviewSheet() { previewEl.classList.add('as-sheet'); previewEl.setAttribute('role', 'dialog'); previewEl.setAttribute('aria-modal', 'true'); previewEl.setAttribute('aria-label', t('pv.title')); document.body.style.overflow = 'hidden'; renderPreview(); const c = previewEl.querySelector('.iconbtn'); if (c) c.focus(); }
function closePreviewSheet() { previewEl.classList.remove('as-sheet'); previewEl.removeAttribute('role'); previewEl.removeAttribute('aria-modal'); document.body.style.overflow = ''; renderPreview(); const b = document.getElementById('bar-preview'); if (b) b.focus(); }
previewEl.addEventListener('keydown', (e) => { if (e.key === 'Escape' && previewEl.classList.contains('as-sheet')) closePreviewSheet(); });

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
    const draw = () => {
      const p = loadPresets();
      box.replaceChildren();
      const names = Object.keys(p).sort();
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
      h('h3', { text: t('pre.saved.title') }), box,
      h('div', { class: 'cta' }, [btn('pre.export', () => { const p = loadPresets(); const out = {}; Object.keys(p).forEach((k) => { out[k] = inc.checked ? p[k] : A.stripSecrets(p[k]); }); download('tempdesk-presets.json', JSON.stringify({ schema: 'tempdesk-presets', version: 1, presets: out }, null, 2) + '\n', 'application/json'); }, 'btn-ghost'),
        btn('pre.import', () => fileIn.click(), 'btn-ghost'), fileIn]),
      h('p', { class: 'help', style: { color: 'var(--muted)' }, text: t('pre.help') })];
  });
}

// ------------------------------------------------------------------------------------------------
// View
// ------------------------------------------------------------------------------------------------
function renderView() {
  const focusId = document.activeElement && document.activeElement.id;
  const sel = focusId && document.activeElement.selectionStart !== undefined ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  buildTabs();
  mainEl.replaceChildren();
  indexEl.replaceChildren();
  const isMode = MODE_TABS.includes(view);
  bodyEl.classList.toggle('wide', !isMode);
  indexEl.hidden = !isMode;
  mainEl.setAttribute('aria-labelledby', 'tab-' + view);
  if (isMode) { if (model.mode !== view) model.mode = view; renderMode(view); }
  else if (view === 'all') renderAll();
  else if (TOOL_TABS.includes(view)) renderCanvas(view);
  else if (view === 'plan') renderPlan();
  else if (view === 'history') renderHistory();
  schedulePreview();
  updateUndo();
  S.translateAll(mainEl);
  if (focusId) { const f = document.getElementById(focusId); if (f && f !== document.activeElement) { f.focus({ preventScroll: true }); if (sel && f.setSelectionRange) try { f.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ } } }
}

// Command palette reveal: switch to the step that holds the element.
document.addEventListener('td:reveal', (e) => {
  const sec = e.detail && e.detail.closest && e.detail.closest('.b-sec[data-section-index]');
  if (sec && isPhone()) { step = Number(sec.dataset.sectionIndex); document.querySelectorAll('.b-sec').forEach((s) => s.classList.toggle('active', s === sec)); }
});
// keyboard undo/redo
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
});
document.addEventListener('focusout', (e) => { if (history && e.target && e.target.matches && e.target.matches('input, textarea')) { if (history.flush()) updateUndo(); } });
window.addEventListener('beforeunload', () => { if (history) history.flush(); });
let wasPhone = isPhone();
window.addEventListener('resize', () => { if (isPhone() !== wasPhone) { wasPhone = isPhone(); if (!wasPhone && previewEl.classList.contains('as-sheet')) closePreviewSheet(); renderView(); } });

function buildBar() {
  const bar = $('#b-bar');
  bar.replaceChildren(
    h('button', { type: 'button', class: 'iconbtn', html: ICONS.left, 'aria-label': t('tb.undo'), 'data-undo': '', onclick: undo }),
    h('button', { type: 'button', class: 'iconbtn', html: ICONS.right, 'aria-label': t('tb.redo'), 'data-redo': '', onclick: redo }),
    h('button', { type: 'button', class: 'btn btn-ghost', id: 'bar-preview', text: t('bar.preview'), onclick: openPreviewSheet }),
    h('button', { type: 'button', class: 'btn btn-primary', text: t('bar.download'), onclick: () => sheet('bar.download', (close) => [
      btn('tb.downloadXml', () => { close(); downloadXml(); }, 'btn-primary'), btn('tb.downloadZip', () => { close(); downloadZip(); }, 'btn-inverse'), btn('tb.export', () => { close(); openExport(); }, 'btn-ghost'), btn('tb.copy', () => { close(); copyXml(); }, 'btn-ghost')]) }));
}

async function init() {
  // datalists
  document.body.appendChild(h('datalist', { id: 'dl-locales' }, A.LOCALES.map((l) => h('option', { value: l }))));
  document.body.appendChild(h('datalist', { id: 'dl-keyboards' }, A.KEYBOARDS.map(([v, l]) => h('option', { value: v, label: l }))));
  try {
    const store = await HI.openStore('builder');
    history = new HI.History({ store, initial: A.stripSecrets(A.defaultModel()), redact, onChange: () => updateUndo() });
    await history.load();
    const r = A.normalizeModel(history.head().state);
    if (r.ok) model = r.model;
  } catch (e) { history = null; }
  if (MODE_TABS.includes(view)) model.mode = view;
  buildToolbar(); buildBar();
  renderView();
  catalog = await loadCatalog(ROOT);
  if (view !== 'server' && view !== 'guest' && view !== 'custom') renderView();
  S.onLang(() => { buildToolbar(); buildBar(); renderView(); });
}
init();

// Added by deployer/app/scripts/prepare-bundle.js for the desktop host.
window.TempDeskBuilderHost = { getModel: () => model, getHistory: () => history };
