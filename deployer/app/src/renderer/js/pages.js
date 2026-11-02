// Pages of the desktop app. Every page builds real UI from real data; empty states say what is
// actually missing. Strings come from the i18n catalogs through t().
import { h, t, state, btn, iconBtn, toast, dialog, confirmDialog, promptDialog, superConfirm, info, searchBox, field, select, contextMenu, showMenu, play, fmtBytes, fmtTime, pulseFocus, announce } from './ui.js';
import { progressPanel } from './run.js';
import { base64Page } from './base64.js';
import { settingsPage } from './settings.js';
import { historyPage, helpPage } from './history.js';

const td = window.td;
const Core = window.TempDeskCore;
const A = window.TempDeskAnswer;
const QR = window.TempDeskQr;

// Secrets typed in this session live only in memory, never on disk.
const secrets = new Map();
function secretFor(name, key) { return (secrets.get(name) || {})[key] || ''; }
function setSecret(name, key, v) { const s = secrets.get(name) || {}; s[key] = v; secrets.set(name, s); }

function passwordField(label, name, key, help) {
  const inp = h('input', { type: 'password', autocomplete: 'new-password', spellcheck: 'false', value: secretFor(name, key) });
  const meter = h('div', { class: 'small muted', 'aria-live': 'polite' });
  const upd = () => { setSecret(name, key, inp.value); const s = A.passwordStrength(inp.value); meter.textContent = inp.value ? t('pw.' + s.code) + (s.meetsPolicy ? '' : ' · ' + t('pw.policy')) : ''; };
  inp.addEventListener('input', upd);
  const show = btn(t('pw.show'), () => { inp.type = inp.type === 'password' ? 'text' : 'password'; show.setAttribute('aria-pressed', String(inp.type === 'text')); }, 'btn-ghost btn-sm', { 'aria-pressed': 'false' });
  const gen = btn(t('pw.generate'), () => { inp.value = A.generatePassword(20); upd(); toast(t('pw.generated')); }, 'btn-ghost btn-sm');
  const f = field({ label, control: inp, help: help || t('pw.notStored'), info: 'info.password' });
  f.appendChild(h('div', { class: 'row' }, [show, gen, meter]));
  upd();
  return f;
}
function text(label, value, onInput, opts) {
  opts = opts || {};
  const inp = h('input', { type: 'text', value: value || '', spellcheck: 'false', autocomplete: 'off', inputmode: opts.numeric ? 'decimal' : undefined, class: opts.mono ? 'mono' : '' });
  inp.addEventListener('input', () => onInput(inp.value, inp));
  return field({ label, control: inp, help: opts.help, info: opts.info, err: true });
}

// ------------------------------------------------------------------------------------------
// Deploy
// ------------------------------------------------------------------------------------------
const DEFAULT_SERVER = () => ({ name: 'lab', kind: 'server', server: { computerName: 'TD-DC01', domainName: 'lab.example.org', netbiosName: 'LAB', ipAddress: '192.168.10.10', prefixLength: '24', gateway: '192.168.10.1', dnsServers: '127.0.0.1', imageIndex: '1', firmware: 'uefi', locale: 'en-US', keyboard: 'en-US', timeZone: 'Eastern Standard Time', productKey: '', portalsMode: 'none', agentTls: false, functionalLevel: '', advanced: false }, portals: { where: 'local' } });
const DEFAULT_LITE = () => ({ name: 'lite', kind: 'lite', ssh: { user: 'ubuntu', host: '192.168.1.5', port: 22, remoteDir: 'tempdesk', identityFile: '', acceptNewHostKey: false }, lite: { realm: 'lab.example.org', netbios: 'LAB', dcIp: '192.168.1.20', parentInterface: 'eth0', subnet: '192.168.1.0/24', gateway: '192.168.1.1', dnsForwarder: '1.1.1.1', dcHostname: 'dc1' }, portals: { where: 'ssh' } });

let draft = null;
async function saveDraft(label, key) {
  try { draft = await td.invoke['dep:save'](draft, label); window.TempDeskApp.refreshUndo(); } catch (e) { if (!key) toast(e.message, 'error'); }
}
function deployPage(root, app) {
  if (!draft) draft = (app.settings.onboarding && app.settings.onboarding.path === 'lite') ? DEFAULT_LITE() : DEFAULT_SERVER();
  const kindSeg = h('div', { class: 'row', role: 'group', 'aria-label': t('deploy.kind') }, ['server', 'lite'].map((k) => h('button', { type: 'button', class: 'btn ' + (draft.kind === k ? 'btn-primary' : 'btn-ghost'), 'aria-pressed': String(draft.kind === k), onclick: () => { draft = k === 'server' ? DEFAULT_SERVER() : DEFAULT_LITE(); app.render(); } }, [t('deploy.kind.' + k)])));
  const b = app.info.build;
  root.appendChild(h('div', { class: 'page-head' }, [h('div', null, [h('div', { class: 'kicker', text: t('deploy.kicker') }), h('h1', { text: t('deploy.title') }), h('p', { class: 'muted', text: t('deploy.lead') }),
    h('p', { class: 'small muted mono', 'data-palette': t('about.version'), text: t('about.provenance', [b.version, String(b.commit || '').slice(0, 12), b.builtUtc]) })]), kindSeg]));
  const nameField = text(t('dep.name'), draft.name, (v) => { draft.name = v; }, { info: 'info.depName', help: t('dep.nameHelp') });
  if (draft.kind === 'server') serverDeploy(root, app, nameField); else liteDeploy(root, app, nameField);
}

function serverDeploy(root, app, nameField) {
  const s = draft.server;
  const set = (k, label) => (v) => { s[k] = v; saveDraft(t('hist.setField', [label, v]), 'server.' + k); };
  // Step 1: media
  const media = h('div', { class: 'card' }, [
    h('h2', { text: t('media.title') }),
    h('p', { class: 'muted', text: t('media.lead') }),
    h('div', { class: 'notice danger', role: 'alert' }, [h('strong', { text: t('warn.wipe') }), h('div', { text: t('warn.wipeHelp') })]),
    nameField,
    h('div', { class: 'fields2' }, [
      text(t('f.computerName'), s.computerName, set('computerName', t('f.computerName')), { mono: true }),
      text(t('f.domainName'), s.domainName, (v) => { s.domainName = v; if (!s._nbTouched) s.netbiosName = A.suggestNetbios(v); saveDraft(t('hist.setField', [t('f.domainName'), v]), 'server.domainName'); }, { mono: true, info: 'info.domain' }),
      text(t('f.netbiosName'), s.netbiosName, (v) => { s._nbTouched = true; s.netbiosName = v; saveDraft(t('hist.setField', [t('f.netbiosName'), v]), 'server.netbiosName'); }, { mono: true, info: 'info.netbios' }),
      text(t('f.ipAddress'), s.ipAddress, set('ipAddress', t('f.ipAddress')), { mono: true, numeric: true }),
      text(t('f.prefixLength'), s.prefixLength, set('prefixLength', t('f.prefixLength')), { numeric: true, info: 'info.prefix' }),
      text(t('f.gateway'), s.gateway, set('gateway', t('f.gateway')), { mono: true, numeric: true }),
      text(t('f.dnsServers'), s.dnsServers, set('dnsServers', t('f.dnsServers')), { mono: true, info: 'info.dns' }),
      field({ label: t('f.imageIndex'), info: 'info.imageIndex', control: select(A.SERVER_EDITIONS.map(([v, l]) => [v, v + ': ' + l]), s.imageIndex, set('imageIndex', t('f.imageIndex'))) }),
      field({ label: t('f.firmware'), info: 'info.firmware', control: select([['uefi', t('opt.uefi')], ['bios', t('opt.bios')]], s.firmware, set('firmware', t('f.firmware'))) }),
      field({ label: t('f.timeZone'), control: select(A.TIME_ZONES.map(([id, off]) => [id, '(UTC' + off + ') ' + id]), s.timeZone, set('timeZone', t('f.timeZone'))) }),
      text(t('f.locale'), s.locale, set('locale', t('f.locale')), { info: 'info.locale' }),
      text(t('f.productKey'), s.productKey, set('productKey', t('f.productKey')), { mono: true, help: t('f.productKeyHelp') }),
      field({ label: t('f.portalsMode'), info: 'info.portalsMode', control: select([['none', t('opt.portals.none')], ['native', t('opt.portals.native')]], s.portalsMode, set('portalsMode', t('f.portalsMode'))) })
    ]),
    passwordField(t('f.adminPassword'), draft.name, 'admin'),
    passwordField(t('f.dsrmPassword'), draft.name, 'dsrm', t('f.dsrmHelp')),
    h('div', { class: 'notice warn' }, [h('strong', { text: t('warn.mediaSecrets') }), h('div', { text: t('warn.mediaSecretsHelp') })])
  ]);
  const errs = () => { const f = Object.assign({}, s, { adminPassword: secretFor(draft.name, 'admin'), dsrmPassword: secretFor(draft.name, 'dsrm') }); return A.validateMode('server', f); };
  const mediaRun = progressPanel({
    kicker: t('media.kicker'), title: t('media.runTitle'), phase: 'Media', logName: 'tempdesk-media-' + draft.name, startLabel: t('media.build'),
    config: () => Object.assign({}, draft, { server: Object.assign({}, draft.server) }),
    secrets: () => ({ ADMINPASSWORD: secretFor(draft.name, 'admin'), DSRMPASSWORD: secretFor(draft.name, 'dsrm') }),
    before: async () => {
      const e = errs();
      if (Object.keys(e).length) { toast(t('media.invalid', [Object.keys(e).map((k) => t('f.' + k)).join(', ')]), 'error'); return false; }
      await saveDraft(t('hist.saveDep', [draft.name]));
      return superConfirm({ title: t('warn.wipeTitle'), danger: t('warn.wipe'), text: t('warn.wipeConfirm', [draft.server.computerName]), word: 'WIPE', action: t('warn.wipeHold') });
    },
    onDone: (data) => { if (data) { lastMedia = data; toast(t('media.done', [data.folder]), 'success'); app.render(); } }
  });
  root.appendChild(media);
  root.appendChild(h('div', { class: 'card' }, [mediaRun, lastMedia ? h('div', { class: 'row', style: { marginTop: '12px' } }, [
    btn(t('media.openFolder'), () => td.invoke['file:reveal'](lastMedia.folder), 'btn-ghost'),
    btn(t('media.zipKit'), () => td.invoke['file:reveal'](lastMedia.zip), 'btn-ghost'),
    lastMedia.iso ? btn(t('media.iso'), () => td.invoke['file:reveal'](lastMedia.iso), 'btn-ghost') : null]) : null,
    h('p', { class: 'small muted', style: { marginTop: '12px' }, text: t('media.howTo') })]));
  // Step 2: monitor (or advanced deploy)
  const adv = h('input', { type: 'checkbox', class: 'switch', checked: !!s.advanced });
  adv.addEventListener('change', () => { s.advanced = adv.checked; saveDraft(t(adv.checked ? 'hist.advOn' : 'hist.advOff')); app.render(); });
  const mon = progressPanel({
    kicker: t('server.kicker'), title: s.advanced ? t('server.advTitle', [s.computerName]) : t('server.monTitle', [s.computerName]), phase: 'Server', stepsKey: s.advanced ? 'ServerAdvanced' : 'ServerMonitor', logName: 'tempdesk-server-' + draft.name,
    filterStep: (id) => id !== 'stage-portals' || s.portalsMode === 'native', startLabel: s.advanced ? t('server.deploy') : t('server.watch'),
    config: () => draft, trustAddress: () => draft.server.ipAddress,
    secrets: () => ({ ADMINPASSWORD: secretFor(draft.name, 'admin'), DSRMPASSWORD: secretFor(draft.name, 'dsrm') }),
    before: async () => { if (!secretFor(draft.name, 'admin')) { toast(t('server.needPassword'), 'error'); return false; } await saveDraft(t('hist.saveDep', [draft.name])); return true; },
    onDone: () => { toast(t('server.ready'), 'success'); window.TempDeskApp.openTab(draft.name); }
  });
  root.appendChild(h('div', { class: 'card' }, [h('label', { class: 'check' }, [adv, h('span', { text: t('server.advanced') }), info('info.advanced', t('server.advanced'))]), h('p', { class: 'small muted', text: s.advanced ? t('server.advHelp') : t('server.monHelp') }), mon]));
}
let lastMedia = null;

function liteDeploy(root, app, nameField) {
  const ss = draft.ssh, l = draft.lite;
  const setS = (k, label) => (v) => { ss[k] = k === 'port' ? Number(v) || 22 : v; saveDraft(t('hist.setField', [label, v]), 'ssh.' + k); };
  const setL = (k, label) => (v) => { l[k] = v; saveDraft(t('hist.setField', [label, v]), 'lite.' + k); };
  const keyBox = h('div');
  const accept = h('input', { type: 'checkbox', class: 'switch', checked: !!ss.acceptNewHostKey });
  accept.addEventListener('change', () => { ss.acceptNewHostKey = accept.checked; saveDraft(t('hist.setField', [t('ssh.acceptNew'), String(accept.checked)])); });
  root.appendChild(h('div', { class: 'card' }, [
    h('h2', { text: t('lite.title') }), h('p', { class: 'muted', text: t('lite.lead') }), nameField,
    h('h3', { text: t('ssh.title') }),
    h('div', { class: 'fields2' }, [text(t('ssh.user'), ss.user, setS('user', t('ssh.user'))), text(t('ssh.host'), ss.host, setS('host', t('ssh.host')), { mono: true }), text(t('ssh.port'), String(ss.port), setS('port', t('ssh.port')), { numeric: true }), text(t('ssh.dir'), ss.remoteDir, setS('remoteDir', t('ssh.dir')), { mono: true, info: 'info.remoteDir' })]),
    h('label', { class: 'check' }, [accept, h('span', { text: t('ssh.acceptNew') }), info('info.acceptNew', t('ssh.acceptNew'))]),
    h('div', { class: 'row' }, [
      btn(t('ssh.genKey'), async () => {
        try {
          const k = await td.invoke['engine:sshKey']();
          ss.identityFile = k.identityFile; saveDraft(t('hist.sshKey'));
          keyBox.replaceChildren(h('div', { class: 'notice ok' }, [h('p', { text: t('ssh.pasteKey') }), h('pre', { class: 'mono small', style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', margin: 0 }, text: k.publicKey }), btn(t('common.copy'), () => { td.invoke['clipboard:write'](k.publicKey); toast(t('common.copied')); }, 'btn-ghost btn-sm')]));
        } catch (e) { toast(t('ssh.keyFailed', [e.message]), 'error'); }
      }, 'btn-ghost'),
      btn(t('ssh.console'), async () => { const r = await td.invoke['engine:sshConsole']({ userHost: ss.user + '@' + ss.host, port: Number(ss.port) || 22 }); toast(r.ok ? t('ssh.consoleOpened') : t('ssh.consoleFailed'), r.ok ? 'success' : 'error'); }, 'btn-ghost'),
      info('info.sshAuth', t('ssh.title'))]),
    keyBox,
    h('h3', { text: t('lite.domain'), style: { marginTop: '16px' } }),
    h('div', { class: 'fields2' }, [
      text(t('lite.realm'), l.realm, setL('realm', t('lite.realm')), { mono: true }), text(t('lite.netbios'), l.netbios, setL('netbios', t('lite.netbios')), { mono: true }),
      text(t('lite.dcIp'), l.dcIp, setL('dcIp', t('lite.dcIp')), { mono: true, info: 'info.dcIp' }), text(t('lite.parent'), l.parentInterface, setL('parentInterface', t('lite.parent')), { mono: true, info: 'info.macvlan' }),
      text(t('lite.subnet'), l.subnet, setL('subnet', t('lite.subnet')), { mono: true }), text(t('lite.gateway'), l.gateway, setL('gateway', t('lite.gateway')), { mono: true }),
      text(t('lite.forwarder'), l.dnsForwarder, setL('dnsForwarder', t('lite.forwarder')), { mono: true })]),
    passwordField(t('lite.adminPassword'), draft.name, 'admin', t('lite.adminPasswordHelp'))
  ]));
  const run = progressPanel({
    kicker: t('lite.kicker'), title: t('lite.runTitle', [ss.host]), phase: 'Lite', logName: 'tempdesk-lite-' + draft.name, startLabel: t('lite.deploy'),
    config: () => draft, secrets: () => ({ ADMINPASSWORD: secretFor(draft.name, 'admin') }),
    before: async () => { const e = Core.validateDeployment(draft); if (Object.keys(e).length) { toast(t('dep.invalid', [Object.keys(e).join(', ')]), 'error'); return false; } if (!A.strongPassword(secretFor(draft.name, 'admin'))) { toast(t('lite.weak'), 'error'); return false; } await saveDraft(t('hist.saveDep', [draft.name])); return true; },
    onDone: () => window.TempDeskApp.openTab(draft.name)
  });
  root.appendChild(h('div', { class: 'card' }, [run]));
}

// ------------------------------------------------------------------------------------------
// Answer File Studio (the website's studio hosted in a same-origin frame, plus desktop extras)
// ------------------------------------------------------------------------------------------
let studioFile = null, studioDirty = false;
function studioPage(root, app) {
  const frame = h('iframe', { class: 'afb', src: 'studio.html', title: t('studio.title'), style: { width: '100%', border: '0', display: 'block', background: 'transparent' } });
  const status = h('span', { class: 'small muted', role: 'status' });
  const branchSel = h('select', { 'aria-label': t('studio.branch'), style: { width: 'auto', minWidth: '140px' } });
  const host = () => frame.contentWindow && frame.contentWindow.TempDeskBuilderHost;
  const xml = () => { const m = host() && host().getModel(); return m ? A.buildXml(m) : null; };
  async function refreshBranches() {
    try {
      const b = await td.invoke['ws:branches']();
      branchSel.replaceChildren(...b.list.map((n) => h('option', { value: n, text: n })), h('option', { value: '__new', text: t('studio.newBranch') }));
      branchSel.value = b.current; branchSel.disabled = !!b.unsupported;
      branchSel.title = b.unsupported ? t('studio.branchNoGit') : t('studio.branchHelp');
    } catch (e) { branchSel.disabled = true; }
  }
  branchSel.addEventListener('change', async () => {
    let name = branchSel.value;
    let create = false;
    if (name === '__new') { name = await promptDialog(t('studio.newBranch'), t('studio.branchName'), '', { validate: (v) => /^[A-Za-z0-9][A-Za-z0-9._/-]{0,60}$/.test(v) && !v.includes('..') ? '' : t('studio.branchBad') }); create = true; if (!name) { refreshBranches(); return; } }
    try { await td.invoke['ws:switchBranch'](name, create); toast(t('studio.onBranch', [name]), 'success'); refreshBranches(); }
    catch (e) { toast(e.message, 'error'); refreshBranches(); }
  });
  function setStatus() { status.textContent = (studioFile ? studioFile : t('studio.untitled')) + (studioDirty ? ' · ' + t('studio.unsaved') : ''); }
  // Reloads the studio frame (for example with ?mode=direct) and resolves once its host API exists.
  function loadStudio(query) {
    return new Promise((resolve) => {
      const done = () => { frame.removeEventListener('load', onLoad); resolve(!!host()); };
      const onLoad = () => { let n = 0; const tick = () => (host() || n++ > 50 ? done() : setTimeout(tick, 100)); tick(); };
      frame.addEventListener('load', onLoad);
      frame.src = 'studio.html' + (query || '');
    });
  }
  // Arbitrary .xml files open in Direct mode (passes > components > settings, no template forms).
  async function openFile(r) {
    if (!r) return;
    if (r.tooLarge) { toast(t('studio.tooLarge'), 'error'); return; }
    if (/\.xml$/i.test(r.name || '')) await loadStudio('?mode=direct');
    const ok = host() && host().importText(r.text, r.name);
    if (!ok) { toast(t('studio.importUnsupported'), 'error'); return; }
    studioFile = r.path; studioDirty = false; setStatus(); toast(t('studio.opened', [r.name]), 'success');
  }
  async function newBlank() {
    if (studioDirty && !(await confirmDialog(t('studio.new'), t('studio.discard'), t('studio.new')))) return;
    await loadStudio('?mode=direct');
    const blank = '<?xml version="1.0" encoding="utf-8"?>\r\n<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">\r\n</unattend>\r\n';
    const ok = host() && host().importText(blank, 'autounattend.xml');
    studioFile = null; studioDirty = false; setStatus();
    toast(ok ? t('studio.blankReady') : t('studio.importUnsupported'), ok ? 'success' : 'error');
  }
  function fileMenu(e) {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: t('studio.new'), kbd: 'Ctrl+N', run: newBlank },
      { label: t('studio.open'), kbd: 'Ctrl+O', run: async () => openFile(await td.invoke['studio:open']()) },
      { label: t('studio.recent'), run: recent },
      'sep',
      { label: t('studio.save'), kbd: 'Ctrl+S', run: () => save(false) },
      { label: t('studio.saveAs'), kbd: 'Ctrl+Shift+S', run: () => save(true) }]);
  }
  async function save(as) {
    const x = xml(); if (!x) { toast(t('studio.notReady'), 'error'); return; }
    const r = await td.invoke['studio:save'](studioFile, x, as);
    if (r.ok) { studioFile = r.path; studioDirty = false; setStatus(); toast(t('studio.saved', [r.path]), 'success'); }
  }
  async function recent() {
    const list = await td.invoke['studio:recent']();
    let matcher = null;
    dialog(t('studio.recent'), (close) => {
      const box = h('div', { class: 'list' });
      const draw = () => box.replaceChildren(...(list.filter((f) => !matcher || Core.testMatch(f, matcher)).map((f) => h('button', { type: 'button', class: 'item', style: { textAlign: 'left', cursor: 'pointer' }, onclick: async () => { close(); openFile(await td.invoke['studio:openPath'](f)); } }, [h('div', { class: 'grow' }, [h('div', { class: 'title', text: f.split(/[\\/]/).pop() }), h('div', { class: 'sub mono', text: f })])])) ));
      const sb = searchBox({ label: t('studio.recentSearch'), onChange: (m) => { matcher = m.ok && !m.empty ? m : null; draw(); }, count: (m) => Core.countMatches(list, m) });
      draw();
      return [sb, list.length ? box : h('div', { class: 'empty', text: t('studio.noRecent') })];
    });
  }
  async function kitFiles() {
    const m = host() && host().getModel(); if (!m) return null;
    const files = [{ name: 'autounattend.xml', text: A.buildXml(m) }];
    if (m.mode === 'server') { files.push({ name: 'TempDesk/firstboot.json', text: A.buildFirstboot(m.server) }); (await td.invoke['media:kitPayload']()).forEach((f) => { if (f.name.startsWith('TempDesk/portal/') && m.server.portalsMode !== 'native') return; files.push(f); }); }
    return { files, mode: m.mode, model: m };
  }
  async function buildIso() {
    const k = await kitFiles(); if (!k) return;
    const ok = await superConfirm({ title: t('warn.wipeTitle'), danger: t('warn.wipe'), text: t('studio.isoConfirm'), word: 'WIPE', action: t('warn.wipeHold') });
    if (!ok) return;
    const w = await td.invoke['media:writeKit']({ mode: k.mode, native: k.model.server && k.model.server.portalsMode === 'native', files: k.files.filter((f) => f.text !== undefined) });
    if (!w.ok) { if (!w.cancelled) toast(w.exists ? t('studio.folderExists', [w.path]) : t('studio.isoFailed'), 'error'); return; }
    toast(t('studio.building'));
    const r = await td.invoke['media:iso'](w.path);
    if (r.ok) { toast(t('studio.isoDone', [r.path]), 'success'); td.invoke['file:reveal'](r.path); } else toast(t('studio.isoFailed') + ' ' + (r.error || ''), 'error');
  }
  async function writeUsb() {
    const k = await kitFiles(); if (!k) return;
    const r = await td.invoke['usb:list']();
    if (!r.ok || !r.drives.length) { toast(r.ok ? t('usb.none') : t('usb.unavailable'), 'error'); return; }
    let letter = r.drives[0].letter;
    const okPick = await new Promise((res) => dialog(t('usb.title'), (close) => [
      h('p', { text: t('usb.lead') }),
      field({ label: t('usb.drive'), control: select(r.drives.map((d) => [d.letter, d.letter + ': ' + (d.label || t('usb.noLabel')) + ' (' + d.fs + ', ' + fmtBytes(d.sizeMB * 1048576) + ')']), letter, (v) => { letter = v; }) }),
      h('div', { class: 'row end' }, [btn(t('common.cancel'), () => close(), 'btn-ghost'), btn(t('usb.next'), () => { close(); res(true); }, 'btn-primary')])], { onClose: () => res(false) }));
    if (!okPick) return;
    const ok = await superConfirm({ title: t('warn.wipeTitle'), danger: t('warn.wipe'), text: t('usb.confirm', [letter]), word: 'WIPE', action: t('warn.wipeHold') });
    if (!ok) return;
    let w = await td.invoke['usb:write'](letter, { files: k.files }, null);
    if (w.exists) {
      const again = await superConfirm({ title: t('usb.replaceTitle'), text: t('usb.replace', [letter]), word: letter, action: t('usb.replaceHold') });
      if (!again) return;
      w = await td.invoke['usb:write'](letter, { files: k.files }, letter);
    }
    if (w.ok) toast(t('usb.done', [w.files, w.root]), 'success'); else toast(t('usb.failed'), 'error');
  }
  // Drag a folder of drivers onto the studio to add a PnP driver path.
  async function dropDrivers(e) {
    const f = e.dataTransfer && e.dataTransfer.files[0]; if (!f) return;
    const p = td.pathForFile(f);
    if (!p || !(await td.invoke['fs:isDir'](p))) return;
    e.preventDefault(); e.stopPropagation();
    const r = host() && host().addDriverPath(p);
    toast(r === 'ok' ? t('studio.driverAdded', [p]) : r === 'exists' ? t('studio.driverExists') : t('studio.driverUnsupported'), r === 'ok' ? 'success' : 'error');
  }
  frame.addEventListener('load', () => {
    const d = frame.contentDocument;
    const fit = () => { frame.style.height = Math.max(600, window.innerHeight - 160) + 'px'; };
    fit(); window.addEventListener('resize', fit);
    d.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
    d.addEventListener('drop', dropDrivers, true);
    d.addEventListener('input', () => { studioDirty = true; setStatus(); });
    d.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); save(e.shiftKey); }
      if (e.ctrlKey && e.key.toLowerCase() === 'o') { e.preventDefault(); td.invoke['studio:open']().then(openFile); }
      if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); newBlank(); }
    });
  });
  const off = td.on['studio:changed'](async (ev) => {
    if (ev.path !== studioFile) return;
    if (ev.removed) { toast(t('studio.removed', [ev.path]), 'error'); return; }
    if (await confirmDialog(t('studio.changedTitle'), t('studio.changed', [ev.path]), t('studio.reload'))) openFile({ path: ev.path, name: ev.path.split(/[\\/]/).pop(), text: ev.text });
  });
  root.addEventListener('DOMNodeRemoved', () => {}, { once: true });
  app.cleanup = () => off();
  setStatus(); refreshBranches();
  root.appendChild(h('div', { class: 'afb-host' }, [
    h('div', { class: 'afb-extras', role: 'toolbar', 'aria-label': t('studio.desktopTools') }, [
      btn(t('studio.file'), fileMenu, 'btn-ghost btn-sm', { 'aria-haspopup': 'menu', title: t('studio.fileHelp') }),
      btn(t('studio.new'), newBlank, 'btn-ghost btn-sm', { title: 'Ctrl+N' }),
      btn(t('studio.save'), () => save(false), 'btn-ghost btn-sm', { title: 'Ctrl+S' }),
      btn(t('studio.iso'), buildIso, 'btn-primary btn-sm'),
      btn(t('studio.usb'), writeUsb, 'btn-ghost btn-sm'),
      info('info.studio', t('studio.title')),
      h('span', { style: { flex: '1' } }),
      h('label', { class: 'small muted', text: t('studio.branch') }), branchSel, status]),
    frame]));
}

// ------------------------------------------------------------------------------------------
// Deployments list and deployment tabs
// ------------------------------------------------------------------------------------------
async function deploymentsPage(root, app) {
  const list = await td.invoke['dep:list']();
  root.appendChild(h('div', { class: 'page-head' }, [h('div', null, [h('h1', { text: t('deps.title') }), h('p', { class: 'muted', text: t('deps.lead') })]),
    h('div', { class: 'row' }, [btn(t('deps.new'), () => app.go('deploy'), 'btn-primary'), btn(t('deps.export'), () => exportDeployments(list), 'btn-ghost'), btn(t('deps.import'), importDeployment, 'btn-ghost')])]));
  if (!list.length) { root.appendChild(h('div', { class: 'card empty' }, [h('div', { class: 'big', text: t('deps.empty') }), h('p', { text: t('deps.emptyHelp') }), btn(t('deps.new'), () => app.go('deploy'), 'btn-primary')])); return; }
  const box = h('div', { class: 'list stagger', role: 'list' });
  let matcher = null;
  const textOf = (d) => [d.name, d.kind, d.kind === 'server' ? d.server && d.server.ipAddress : d.ssh && d.ssh.host, d.server && d.server.domainName, d.lite && d.lite.realm].filter(Boolean).join(' ');
  function draw() {
    box.replaceChildren(...list.filter((d) => !matcher || Core.testMatch(textOf(d), matcher)).map((d) => {
      const it = h('div', { class: 'item', role: 'listitem', tabindex: '0', 'data-palette': t('deps.item', [d.name]) }, [
        h('div', { class: 'grow' }, [h('div', { class: 'title', text: d.name }), h('div', { class: 'sub', text: t('deps.kind.' + d.kind) + ' · ' + (d.kind === 'server' ? d.server.ipAddress + ' · ' + d.server.domainName : d.ssh.user + '@' + d.ssh.host + ' · ' + d.lite.realm) + ' · ' + t('deps.updated', [fmtTime(d.updated)]) })]),
        h('span', { class: 'chip ' + (d.agent && d.agent.hasKeys ? 'ok' : ''), text: d.agent && d.agent.hasKeys ? t('deps.keys') : t('deps.noKeys') }),
        btn(t('deps.open'), () => app.openTab(d.name), 'btn-ghost btn-sm')]);
      it.addEventListener('keydown', (e) => { if (e.key === 'Enter') app.openTab(d.name); if (e.key === 'Delete') deleteDeployment(d.name, app); });
      it.addEventListener('dblclick', () => app.openTab(d.name));
      contextMenu(it, () => [
        { label: t('deps.open'), kbd: 'Enter', run: () => app.openTab(d.name) },
        { label: t('deps.health'), run: () => health(d) },
        { label: t('deps.folder'), run: () => td.invoke['dep:openFolder'](d.name) },
        { label: t('deps.exportOne'), run: () => exportDeployments([d]) },
        { label: t('deps.duplicate'), run: async () => { const n = await promptDialog(t('deps.duplicate'), t('dep.name'), d.name + '-copy'); if (n) { await td.invoke['dep:save'](Object.assign({}, d, { name: n }), t('hist.dupDep', [d.name, n])); app.render(); } } },
        'sep',
        { label: t('deps.delete'), kbd: 'Del', danger: true, run: () => deleteDeployment(d.name, app) }]);
      return it;
    }));
  }
  const sb = searchBox({ label: t('deps.search'), onChange: (m) => { matcher = m.ok && !m.empty ? m : null; draw(); }, count: (m) => Core.countMatches(list.map(textOf), m) });
  root.appendChild(h('div', { class: 'card flat', style: { marginBottom: '14px' } }, [sb]));
  root.appendChild(box);
  draw();
}
async function deleteDeployment(name, app) {
  const ok = await superConfirm({ title: t('deps.deleteTitle'), danger: t('deps.deleteWarn'), word: name, action: t('deps.deleteHold') });
  if (!ok) return;
  await td.invoke['dep:delete'](name, name);
  toast(t('deps.deleted', [name]), 'success');
  app.render();
}
async function exportDeployments(list) {
  const fmt = await new Promise((res) => dialog(t('export.title'), (close) => [h('p', { text: t('export.depHelp') }), h('div', { class: 'row' }, ['json', 'csv', 'html'].map((f) => btn(f.toUpperCase(), () => { close(); res(f); }, 'btn-ghost')))], { onClose: () => res(null) }));
  if (!fmt) return;
  const clean = list.map((d) => Core.stripSecrets(Object.assign({}, d, { agent: undefined })));
  const rows = clean.map((d) => Core.flatten(d));
  const text = fmt === 'json' ? JSON.stringify({ schema: 'tempdesk-deployments', version: 1, exported: new Date().toISOString(), deployments: clean }, null, 2) + '\n' : fmt === 'csv' ? Core.toCsv(rows) : Core.toHtml(t('deps.title'), rows);
  const r = await td.invoke['file:save']({ name: 'tempdesk-deployments.' + fmt, text, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] });
  if (r.ok) toast(t('export.saved', [r.path]), 'success');
}
async function importDeployment() {
  const f = await td.invoke['file:open']({ filters: [{ name: 'JSON', extensions: ['json'] }], maxBytes: 2 * 1024 * 1024 });
  if (!f || f.cancelled) return;
  if (f.tooLarge) { toast(t('import.tooLarge'), 'error'); return; }
  let j;
  try { j = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(f.bytes)); } catch (e) { play('invalid'); toast(t('import.badJson'), 'error'); return; }
  const list = j && j.schema === 'tempdesk-deployments' && Array.isArray(j.deployments) ? j.deployments : [j];
  // Validate every entry first; import nothing if any entry is invalid.
  for (let i = 0; i < list.length; i++) { const e = Core.validateDeployment(Core.stripSecrets(list[i])); if (Object.keys(e).length) { play('invalid'); toast(t('import.badEntry', [i + 1, Object.keys(e).join(', ')]), 'error'); return; } }
  for (const d of list) await td.invoke['dep:save'](Core.stripSecrets(d), t('hist.importDep', [d.name]));
  toast(t('import.done', [list.length]), 'success');
  window.TempDeskApp.render();
}
function agentUrl(d) { const a = d.agent || {}; const host = d.kind === 'lite' ? d.lite.dcIp : d.server.ipAddress; return (a.tls ? 'https' : 'http') + '://' + host + ':' + (a.port || (a.tls ? 8443 : 8080)) + '/api/v1'; }
async function health(d) {
  const r = await td.invoke['engine:health'](agentUrl(d));
  if (r.ok) toast(t('health.ok', [d.name, r.version || '?', r.domain || '?', r.backend || '?']), 'success');
  else toast(t('health.fail', [d.name, r.message || r.error]), 'error');
  return r;
}
async function deploymentTab(root, app) {
  const d = await td.invoke['dep:get'](app.params.name);
  if (!d) { root.appendChild(h('div', { class: 'card empty' }, [h('div', { class: 'big', text: t('dep.missing', [app.params.name]) }), btn(t('deps.title'), () => app.go('deployments'), 'btn-primary')])); return; }
  const listInfo = (await td.invoke['dep:list']()).find((x) => x.name === d.name) || {};
  d.agent = listInfo.agent;
  const envs = await td.invoke['dep:envFiles'](d.name);
  const healthBox = h('div', { role: 'status', class: 'small muted', text: t('health.notChecked') });
  root.appendChild(h('div', { class: 'page-head' }, [h('div', null, [h('div', { class: 'kicker', text: t('deps.kind.' + d.kind) }), h('h1', { text: d.name })]), h('div', { class: 'row' }, [
    btn(t('deps.health'), async () => { healthBox.textContent = t('health.checking'); const r = await health(d); healthBox.textContent = r.ok ? t('health.ok', [d.name, r.version, r.domain, r.backend]) : t('health.fail', [d.name, r.message || r.error]); }, 'btn-primary'),
    btn(t('deps.folder'), () => td.invoke['dep:openFolder'](d.name), 'btn-ghost'),
    btn(t('portals.title'), () => app.go('portals', { name: d.name }), 'btn-ghost')])]));
  const rows = d.kind === 'server' ? [[t('f.computerName'), d.server.computerName], [t('f.ipAddress'), d.server.ipAddress], [t('f.domainName'), d.server.domainName], [t('f.netbiosName'), d.server.netbiosName], [t('f.portalsMode'), t('opt.portals.' + d.server.portalsMode)]]
    : [[t('ssh.host'), d.ssh.user + '@' + d.ssh.host + ':' + d.ssh.port], [t('lite.realm'), d.lite.realm], [t('lite.dcIp'), d.lite.dcIp], [t('lite.parent'), d.lite.parentInterface]];
  root.appendChild(h('div', { class: 'cols' }, [
    h('div', { class: 'grow' }, [h('div', { class: 'card' }, [h('h2', { text: t('dep.summary') }), h('table', { class: 'table' }, [h('tbody', null, rows.map(([k, v]) => h('tr', null, [h('th', { text: k }), h('td', { class: 'mono', text: v || '' })])))]), healthBox]),
      h('div', { class: 'card' }, [h('h2', { text: t('dep.actions') }), h('div', { class: 'row' }, [
        btn(t('dep.rerun'), () => { draft = JSON.parse(JSON.stringify(d)); delete draft.agent; app.go('deploy'); }, 'btn-ghost'),
        d.kind === 'server' ? btn(t('dep.updatePayload'), () => { draft = JSON.parse(JSON.stringify(d)); delete draft.agent; draft.server.advanced = true; app.go('deploy'); toast(t('dep.updateHelp')); }, 'btn-ghost') : null,
        d.kind === 'server' ? btn(t('dep.uninstall'), () => uninstallAgent(d), 'btn-danger') : null,
        btn(t('dep.inventory'), () => exportInventory(d, envs), 'btn-ghost')])])]),
    h('div', { class: 'side' }, [h('div', { class: 'card' }, [h('h2', { text: t('dep.files') }), envs.length ? h('ul', null, envs.map((e) => h('li', { class: 'mono small', text: e }))) : h('p', { class: 'muted', text: t('dep.noEnv') }),
      h('p', { class: 'small muted', text: d.agent && d.agent.hasKeys ? t('dep.keysStored') : t('dep.noKeysYet') })])])]));
}
async function uninstallAgent(d) {
  const ok = await superConfirm({ title: t('dep.uninstallTitle'), danger: t('dep.uninstallWarn'), word: d.name, action: t('dep.uninstallHold') });
  if (!ok) return;
  const pw = await promptDialog(t('dep.uninstallTitle'), t('f.adminPassword'), '', { password: true });
  if (!pw) return;
  const panel = progressPanel({ title: t('dep.uninstallTitle'), phase: 'Uninstall', config: () => d, secrets: () => ({ ADMINPASSWORD: pw }) });
  dialog(t('dep.uninstallTitle'), () => [panel], { wide: true });
  panel.start(true);
}
async function exportInventory(d, envs) {
  const fmt = await new Promise((res) => dialog(t('export.title'), (close) => [h('p', { text: t('export.invHelp') }), h('div', { class: 'row' }, ['json', 'csv', 'html'].map((f) => btn(f.toUpperCase(), () => { close(); res(f); }, 'btn-ghost')))], { onClose: () => res(null) }));
  if (!fmt) return;
  const inv = Core.stripSecrets({ deployment: d.name, kind: d.kind, agentUrl: agentUrl(d), envFiles: envs, settings: d.kind === 'server' ? d.server : d.lite, ssh: d.kind === 'lite' ? { user: d.ssh.user, host: d.ssh.host, port: d.ssh.port } : undefined, exported: new Date().toISOString() });
  const rows = Object.entries(Core.flatten(inv)).map(([k, v]) => ({ key: k, value: v }));
  const text = fmt === 'json' ? JSON.stringify(inv, null, 2) + '\n' : fmt === 'csv' ? Core.toCsv(rows, ['key', 'value']) : Core.toHtml(t('dep.inventory') + ': ' + d.name, rows, ['key', 'value']);
  const r = await td.invoke['file:save']({ name: 'tempdesk-inventory-' + d.name + '.' + fmt, text, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] });
  if (r.ok) toast(t('export.saved', [r.path]), 'success');
}

// ------------------------------------------------------------------------------------------
// Portals
// ------------------------------------------------------------------------------------------
async function portalsPage(root, app) {
  const list = await td.invoke['dep:list']();
  root.appendChild(h('div', { class: 'page-head' }, [h('div', null, [h('h1', { text: t('portals.title') }), h('p', { class: 'muted', text: t('portals.lead') })])]));
  const ready = list.filter((d) => d.agent && d.agent.hasKeys);
  if (!ready.length) { root.appendChild(h('div', { class: 'card empty' }, [h('div', { class: 'big', text: t('portals.empty') }), h('p', { text: t('portals.emptyHelp') }), btn(t('nav.deploy'), () => app.go('deploy'), 'btn-primary')])); return; }
  let cur = ready.find((d) => d.name === (app.params && app.params.name)) || ready[0];
  const where = cur.portals && cur.portals.where || (cur.kind === 'lite' ? 'ssh' : 'local');
  const hostIn = h('input', { type: 'text', class: 'mono', value: (cur.portals && cur.portals.publicHost) || (where === 'ssh' ? cur.ssh.host : ''), placeholder: t('portals.hostPh') });
  const urls = h('div');
  function drawUrls() {
    const hostName = hostIn.value.trim();
    if (!hostName) { urls.replaceChildren(h('p', { class: 'muted', text: t('portals.needHost') })); return; }
    const native = cur.kind === 'server' && cur.server.portalsMode === 'native';
    const g = 'http://' + hostName + ':' + (native ? 8081 : 8080) + '/', a = 'http://' + hostName + ':' + (native ? 8082 : 8081) + '/';
    let qrSvg = '';
    try { qrSvg = QR.toSvg(QR.generate(g), { label: t('portals.qr', [g]), dark: '#0B1110', light: '#FFFFFF' }); } catch (e) { qrSvg = ''; }
    const qr = h('div', { class: 'qr', role: 'img', 'aria-label': t('portals.qr', [g]) }); qr.innerHTML = qrSvg;
    urls.replaceChildren(h('div', { class: 'cols' }, [h('div', { class: 'grow stack' }, [
      h('div', { class: 'item' }, [h('div', { class: 'grow' }, [h('div', { class: 'title', text: t('portals.guest') }), h('div', { class: 'sub mono', text: g })]), btn(t('common.copy'), () => { td.invoke['clipboard:write'](g); toast(t('common.copied')); }, 'btn-ghost btn-sm'), btn(t('portals.openBrowser'), () => td.invoke['shell:open'](g).catch(() => toast(t('portals.openFailed'), 'error')), 'btn-ghost btn-sm')]),
      h('div', { class: 'item' }, [h('div', { class: 'grow' }, [h('div', { class: 'title', text: t('portals.admin') }), h('div', { class: 'sub mono', text: a })]), btn(t('common.copy'), () => { td.invoke['clipboard:write'](a); toast(t('common.copied')); }, 'btn-ghost btn-sm'), btn(t('portals.openAdmin'), () => td.invoke['shell:open'](a).catch(() => toast(t('portals.openFailed'), 'error')), 'btn-primary btn-sm')]),
      h('p', { class: 'small muted', text: t('portals.httpNote') })]), h('div', { class: 'side' }, [qr, h('p', { class: 'small muted', text: t('portals.qrHelp') })])]));
  }
  hostIn.addEventListener('input', drawUrls);
  hostIn.addEventListener('change', async () => { cur.portals = Object.assign({}, cur.portals, { publicHost: hostIn.value.trim() }); const c = Object.assign({}, cur); delete c.agent; await td.invoke['dep:save'](c, t('hist.setField', [t('portals.host'), hostIn.value.trim()])); });
  const whereSel = select([['local', t('portals.local')], ['ssh', t('portals.ssh')]], where, async (v) => { cur.portals = Object.assign({}, cur.portals, { where: v }); const c = Object.assign({}, cur); delete c.agent; await td.invoke['dep:save'](c, t('hist.setField', [t('portals.where'), v])); });
  if (cur.kind === 'server') whereSel.querySelector('option[value="ssh"]').disabled = !cur.ssh;
  const native = cur.kind === 'server' && cur.server.portalsMode === 'native';
  const run = progressPanel({ title: t('portals.start', [cur.name]), phase: 'Portals', config: () => { const c = Object.assign({}, cur); delete c.agent; return c; }, onDone: (data) => { if (data && data.guest && !hostIn.value) { hostIn.value = new URL(data.guest).hostname; drawUrls(); } } });
  root.appendChild(h('div', { class: 'card' }, [
    field({ label: t('portals.deployment'), control: select(ready.map((d) => [d.name, d.name]), cur.name, (v) => app.go('portals', { name: v })) }),
    native ? h('div', { class: 'notice ok', text: t('portals.nativeNote') }) : field({ label: t('portals.where'), info: 'info.portalsWhere', control: whereSel }),
    field({ label: t('portals.host'), info: 'info.portalsHost', help: t('portals.hostHelp'), control: hostIn }), urls]));
  if (!native) root.appendChild(h('div', { class: 'card' }, [run]));
  drawUrls();
}

export const PAGES = {
  deploy: deployPage, answers: studioPage, deployments: deploymentsPage, deployment: deploymentTab, portals: portalsPage,
  base64: base64Page, history: historyPage, settings: settingsPage, help: helpPage
};

// Actions for the command palette (pages register more through ACTIONS()).
let appRef = null;
export function registerActions(app) { appRef = app; }
export function ACTIONS() {
  const app = appRef, s = app.settings;
  const tg = (key, get, set) => ({ title: t(key), group: t('palette.settings'), toggle: { get, set } });
  const st = (patch, label) => app.applySettings(patch, label);
  const list = [
    { title: t('act.newServer'), group: t('palette.actions'), run: () => { draft = DEFAULT_SERVER(); app.go('deploy'); } },
    { title: t('act.newLite'), group: t('palette.actions'), run: () => { draft = DEFAULT_LITE(); app.go('deploy'); } },
    { title: t('act.undo'), group: t('palette.actions'), keywords: 'Ctrl+Z', run: () => app.undo() },
    { title: t('act.redo'), group: t('palette.actions'), keywords: 'Ctrl+Y', run: () => app.redo() },
    { title: t('act.notifications'), group: t('palette.actions'), run: () => app.openNotifications() },
    { title: t('act.backup'), group: t('palette.actions'), run: async () => { const r = await td.invoke['backup:export'](); if (r.ok) toast(t('backup.saved', [r.path]), 'success'); } },
    { title: t('act.checkUpdates'), group: t('palette.actions'), run: async () => { const r = await td.invoke['update:check'](); toast(t('update.state.' + r.state, [r.version || '']), r.state === 'error' ? 'error' : 'info'); } },
    { title: t('act.changelog'), group: t('palette.actions'), run: () => app.go('help', { tab: 'changelog' }) },
    { title: t('act.docs'), group: t('palette.actions'), run: () => app.go('help', { tab: 'docs' }) },
    tg('set.sounds', () => s.sounds, (v) => st({ sounds: v }, t('hist.setField', [t('set.sounds'), String(v)]))),
    tg('set.motionOff', () => s.motion === 'off', (v) => st({ motion: v ? 'off' : 'system' }, t('hist.setField', [t('set.motion'), v ? 'off' : 'system']))),
    tg('set.updates', () => s.updates, (v) => st({ updates: v }, t('hist.setField', [t('set.updates'), String(v)]))),
    tg('set.darkTheme', () => s.theme === 'dark', (v) => st({ theme: v ? 'dark' : 'light' }, t('hist.setField', [t('set.theme'), v ? 'dark' : 'light']))),
    tg('set.highContrast', () => s.highContrast === 'on', (v) => st({ highContrast: v ? 'on' : 'system' }, t('hist.setField', [t('set.highContrast'), v ? 'on' : 'system'])))
  ];
  ['en', 'zh-HK', 'bilingual'].forEach((l) => list.push({ title: t('set.language') + ': ' + t('lang.' + l), group: t('palette.settings'), run: () => st({ language: l }, t('hist.setField', [t('set.language'), l])) }));
  // Every setting row in Settings (teleport to the exact control).
  (app.settingsIndex || []).forEach((r) => list.push({ title: r.label, group: t('palette.settings'), keywords: r.keywords || '', run: () => app.go('settings', { focus: '#' + r.id }) }));
  return list.filter((x) => !(state.school.enabled && /funny|wording/i.test(x.title + (x.keywords || ''))));
}
export { secrets };
