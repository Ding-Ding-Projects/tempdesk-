// TempDesk Deployer main process: one frameless window, a narrow IPC surface (preload.js), the
// PowerShell engine as a child process, Git-backed history, Base64 file jobs and the updater.
'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, clipboard, Menu, session, systemPreferences, protocol, net } = require('electron');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Store, dataRoot, validateSettings } = require('./store.js');
const { EngineRun, runElevatedTrust } = require('./engine.js');
const { openWorkspace, redact } = require('./workspace.js');
const school = require('./school.js');
const { Updater } = require('./updater.js');
const { Job, outputPath, sniff } = require('./base64files.js');
const { makeZip, readZip } = require('./zipfile.js');
const Core = require('../shared/core.js');
const Wording = require('../vendor/wording.js');

// Bundled files are served from app://td/ so ES modules, fetch and a strict CSP all work.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: false } }]);
const SERVE = { '': path.join(__dirname, '..', 'renderer'), vendor: path.join(__dirname, '..', 'vendor'), shared: path.join(__dirname, '..', 'shared') };
// The builder's zip kit fetches payload/manifest.json and the payload files (verified by SHA-256).
let payloadManifest = null;
function servePayload(parts) {
  if (!payloadManifest) {
    const files = [];
    for (const f of ['server', 'agent', 'client', 'portal']) walkPayload(path.join(PAYLOAD, f), f, files);
    payloadManifest = { schema: 'tempdesk-payload', version: 1, generated: new Date().toISOString(), files: files.map((x) => { const b = Buffer.from(x.base64, 'base64'); return { path: x.name, size: b.length, sha256: require('crypto').createHash('sha256').update(b).digest('hex') }; }) };
  }
  const rel = parts.join('/');
  if (rel === 'manifest.json') return new Response(JSON.stringify(payloadManifest), { headers: { 'content-type': 'application/json' } });
  if (!payloadManifest.files.some((f) => f.path === rel)) return new Response('Not found', { status: 404 });
  return new Response(fs.readFileSync(path.join(PAYLOAD, ...parts)), { headers: { 'content-type': 'application/octet-stream' } });
}
function serveApp(request) {
  const u = new URL(request.url);
  if (u.host !== 'td') return new Response('Not found', { status: 404 });
  const parts = decodeURIComponent(u.pathname).split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p.includes('\\') || p.includes(':'))) return new Response('Bad path', { status: 400 });
  const rootKey = parts[0] === 'vendor' || parts[0] === 'shared' ? parts.shift() : '';
  if (rootKey === 'vendor' && parts[0] === 'payload') return servePayload(parts.slice(1));
  const base = SERVE[rootKey];
  const file = path.join(base, ...(parts.length ? parts : ['index.html']));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file)) return new Response('Not found', { status: 404 });
  return net.fetch(pathToFileURL(file).toString());
}

// Squirrel install/update events: create or remove shortcuts and exit quickly.
(function handleSquirrel() {
  if (process.platform !== 'win32') return;
  const cmd = process.argv[1];
  if (!cmd || !/^--squirrel-/.test(cmd)) return;
  const update = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const exe = path.basename(process.execPath);
  const run = (args) => { try { spawn(update, args, { detached: true }); } catch (e) { /* ignore */ } };
  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') run(['--createShortcut', exe]);
  if (cmd === '--squirrel-uninstall') run(['--removeShortcut', exe]);
  setTimeout(() => app.quit(), 1000);
  process.squirrelEvent = true;
})();

const BUILD = (() => { try { return require('../vendor/build-info.json'); } catch (e) { return { version: app.getVersion(), commit: 'dev', builtUtc: 'not built' }; } })();
const RES = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..', '..');
const ENGINE = app.isPackaged ? path.join(RES, 'engine', 'Invoke-TempDeskDeploy.ps1') : path.resolve(__dirname, '..', '..', '..', 'engine', 'Invoke-TempDeskDeploy.ps1');
const PAYLOAD = app.isPackaged ? path.join(RES, 'payload') : path.resolve(__dirname, '..', '..', '..', '..');
const DOCS = app.isPackaged ? path.join(RES, 'docs') : path.resolve(__dirname, '..', '..', '..', '..');

let win = null;
let store = null;
let workspace = null;
const runs = new Map();
const jobs = new Map();
const updater = new Updater();

if (!process.squirrelEvent && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

function send(channel, payload) { if (win && !win.isDestroyed()) win.webContents.send(channel, payload); }

function createWindow() {
  const s = store.settings();
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 720, minHeight: 540, frame: false, show: false,
    backgroundColor: s.theme === 'light' ? '#F4F8F7' : '#0B1110', title: s.appName,
    icon: path.join(__dirname, '..', 'renderer', 'img', 'tempdesk.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, spellcheck: false, devTools: !app.isPackaged
    }
  });
  win.removeMenu();
  win.loadURL('app://td/index.html');
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));
  // Never navigate away or open new windows from the renderer.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

function hardenSession() {
  // Block all network requests from the renderer except bundled files. Docs links open in the
  // system browser; the update check runs in the main process through Update.exe.
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const u = details.url;
    cb({ cancel: !(u.startsWith('app://td/') || u.startsWith('devtools:') || u.startsWith('data:') || u.startsWith('blob:')) });
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));
}

const OPEN_EXTERNAL = [/^https:\/\/github\.com\/Ding-Ding-Projects\/tempdesk-(\/|$)/, /^https:\/\/ding-ding-projects\.github\.io\/tempdesk-\//, /^https:\/\/learn\.microsoft\.com\//, /^http:\/\/(\d{1,3}\.){3}\d{1,3}:\d{2,5}\/$/, /^http:\/\/[A-Za-z0-9.-]{1,253}:\d{2,5}\/$/];

function animationsEnabled() {
  try { return systemPreferences.getAnimationSettings ? systemPreferences.getAnimationSettings().shouldRenderRichAnimation : true; } catch (e) { return true; }
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (ev, ...args) => {
    if (!win || ev.sender !== win.webContents) throw new Error('Unknown sender');
    return fn(...args);
  });
}

function registerIpc() {
  handle('app:info', async () => ({
    build: BUILD, platform: process.platform, versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
    animations: animationsEnabled(), highContrast: nativeTheme.shouldUseHighContrastColors, dark: nativeTheme.shouldUseDarkColors,
    dataRoot: store.root, workspace: workspace ? { kind: workspace.kind, gitError: workspace.gitError || null } : null,
    updates: updater.available()
  }));
  handle('win:minimize', () => win.minimize());
  handle('win:maximize', () => (win.isMaximized() ? win.unmaximize() : win.maximize()));
  handle('win:close', () => win.close());
  handle('win:title', (t) => { if (typeof t === 'string' && t.length <= 40) win.setTitle(t); });

  // Settings
  handle('settings:get', () => store.settings());
  handle('settings:set', async (patch, label) => {
    const next = Object.assign({}, store.settings(), patch);
    const saved = store.saveSettings(next);
    if (workspace) await workspace.save('settings.json', redact(Object.assign({}, saved, { logo: saved.logo ? '(image)' : '' })), label || 'Change settings', patch && Object.keys(patch).length === 1 ? 'settings.' + Object.keys(patch)[0] : undefined);
    return saved;
  });
  handle('settings:export', async () => {
    const r = await dialog.showSaveDialog(win, { defaultPath: 'tempdesk-deployer-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { ok: false, cancelled: true };
    fs.writeFileSync(r.filePath, JSON.stringify(store.settings(), null, 2) + '\n');
    return { ok: true, path: r.filePath };
  });
  handle('settings:import', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { ok: false, cancelled: true };
    let j;
    try { j = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch (e) { return { ok: false, error: 'json' }; }
    const v = validateSettings(j);
    if (!v.ok) return v;
    const saved = store.saveSettings(v.settings);
    if (workspace) await workspace.save('settings.json', redact(Object.assign({}, saved, { logo: saved.logo ? '(image)' : '' })), 'Import settings');
    return { ok: true, settings: saved };
  });

  // School mode (convenience lock, not security)
  handle('school:get', () => school.publicView(school.load(store.root)));
  handle('school:enable', (pin, name) => school.enable(store.root, pin, name));
  handle('school:disable', (pin) => school.disable(store.root, pin));

  // Personal wording: validated in full here before anything is stored; never logged.
  handle('wording:get', () => store.vocabulary());
  handle('wording:apply', (bytes) => {
    const buf = Buffer.from(bytes);
    try { Wording.validate(new Uint8Array(buf)); } catch (e) { return { ok: false, code: e.code || 'json', entry: e.entry || null }; }
    store.saveVocabulary(buf.toString('utf8'));
    return { ok: true };
  });
  handle('wording:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return { cancelled: true };
    const st = fs.statSync(r.filePaths[0]);
    if (st.size > 256 * 1024) return { bytes: null, tooLarge: true };
    return { bytes: new Uint8Array(fs.readFileSync(r.filePaths[0])) };
  });
  handle('wording:clear', () => { store.clearVocabulary(); return { ok: true }; });

  // Windows sounds (read through the main process; the renderer plays them from a data URL)
  handle('sound:get', (name) => {
    const map = { tada: 'tada.wav', invalid: 'Windows Critical Stop.wav', click: 'Windows Navigation Start.wav', done: 'Windows Notify System Generic.wav', error: 'Windows Foreground.wav' };
    if (!map[name] || process.platform !== 'win32') return null;
    const f = path.join(process.env.SystemRoot || 'C:\\Windows', 'Media', map[name]);
    try { return 'data:audio/wav;base64,' + fs.readFileSync(f).toString('base64'); } catch (e) { return null; }
  });

  // Deployments
  handle('dep:list', () => store.deployments().map((d) => Object.assign({}, d, { agent: store.agentInfo(d.name) })));
  handle('dep:get', (name) => store.deployment(name));
  handle('dep:save', async (d, label) => {
    const saved = store.saveDeployment(d);
    if (workspace) await workspace.save('deployments/' + saved.name + '.json', saved, label || ('Save deployment ' + saved.name));
    return saved;
  });
  handle('dep:delete', async (name, confirmName) => {
    if (name !== confirmName) throw new Error('Confirmation did not match.');
    store.deleteDeployment(name);
    if (workspace) await workspace.save('deployments/' + name + '.json', null, 'Delete deployment ' + name);
    return { ok: true };
  });
  handle('dep:openFolder', (name) => { const d = store.deploymentDir(name); if (fs.existsSync(d)) shell.openPath(d); });
  handle('dep:envFiles', (name) => {
    const d = store.deploymentDir(name);
    return ['portal/.env.guest', 'portal/.env.admin', 'streaming/.env'].filter((f) => fs.existsSync(path.join(d, f)));
  });
  handle('tabs:get', () => store.tabs());
  handle('tabs:set', (t) => store.saveTabs(t));

  // Engine runs
  handle('engine:start', (opts) => {
    const id = 'run-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const run = new EngineRun({ phase: opts.phase, config: opts.config, secrets: opts.secrets, script: ENGINE, payloadRoot: PAYLOAD, outDir: opts.outDir, reset: !!opts.reset, noIso: !!opts.noIso });
    run.on((ev) => send('engine:event', Object.assign({ run: id }, ev)));
    run.start();
    runs.set(id, run);
    run.done.then(() => runs.delete(id));
    return id;
  });
  handle('engine:cancel', (id) => { const r = runs.get(id); if (r) r.cancel(); });
  handle('engine:trust', (address) => runElevatedTrust(ENGINE, address));
  handle('engine:sshConsole', (target) => {
    // Visible console for the first connection: confirms the host key and accepts a password the
    // user types into ssh itself. Nothing is captured by the app.
    if (process.platform !== 'win32') return { ok: false };
    if (!/^[a-z_][a-z0-9_.-]{0,31}@[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(target.userHost) || !(target.port >= 1 && target.port <= 65535)) return { ok: false, error: 'target' };
    spawn('cmd.exe', ['/c', 'start', 'TempDesk SSH', 'ssh.exe', '-p', String(target.port), target.userHost], { detached: true, windowsHide: false }).unref();
    return { ok: true };
  });
  handle('engine:sshKey', async () => {
    const dir = path.join(store.root, 'ssh');
    fs.mkdirSync(dir, { recursive: true });
    const key = path.join(dir, 'id_ed25519');
    if (!fs.existsSync(key)) {
      const kg = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh-keygen.exe') : 'ssh-keygen';
      await new Promise((res, rej) => { const p = spawn(kg, ['-q', '-t', 'ed25519', '-N', '', '-C', 'tempdesk-deployer', '-f', key], { windowsHide: true }); p.on('error', rej); p.on('close', (c) => c === 0 ? res() : rej(new Error('ssh-keygen exited with ' + c))); });
    }
    return { publicKey: fs.readFileSync(key + '.pub', 'utf8').trim(), identityFile: key };
  });
  handle('engine:prereqs', async () => {
    const check = (exe, args) => new Promise((res) => { try { const p = spawn(exe, args, { windowsHide: true }); let o = ''; p.stdout.on('data', (d) => { o += d; }); p.stderr.on('data', (d) => { o += d; }); p.on('error', () => res(null)); p.on('close', (c) => res(c === 0 ? o.trim().split(/\r?\n/)[0] : null)); } catch (e) { res(null); } });
    const sys = process.env.SystemRoot || 'C:\\Windows';
    const ps = process.platform === 'win32' ? path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'pwsh';
    const ssh = process.platform === 'win32' ? path.join(sys, 'System32', 'OpenSSH', 'ssh.exe') : 'ssh';
    const nets = os.networkInterfaces();
    const ipv4 = Object.values(nets).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n.address);
    return {
      powershell: await check(ps, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']),
      openssh: await check(ssh, ['-V']),
      docker: await check('docker', ['version', '--format', '{{.Server.Version}}']),
      git: workspace && workspace.kind === 'git' ? 'available' : null,
      network: ipv4
    };
  });
  handle('engine:health', async (url) => {
    if (!/^https?:\/\/[A-Za-z0-9.-]{1,253}:\d{2,5}\/api\/v1$/.test(url)) return { ok: false, error: 'url' };
    if (url.startsWith('https:')) return { ok: false, error: 'https', message: 'HTTPS agents use a self-signed certificate: run the check from the admin console, which pins it.' };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url + '/health', { signal: ctl.signal });
      const j = await r.json();
      return { ok: r.ok, status: j.status, version: j.version, domain: j.domain, backend: j.backend, capabilities: j.capabilities };
    } catch (e) { return { ok: false, error: 'unreachable', message: e.message }; } finally { clearTimeout(timer); }
  });

  // Files
  handle('file:save', async (opts) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: opts.name, filters: opts.filters || [] });
    if (r.canceled) return { ok: false, cancelled: true };
    const data = opts.base64 ? Buffer.from(opts.base64, 'base64') : Buffer.from(String(opts.text), 'utf8');
    fs.writeFileSync(r.filePath, data);
    return { ok: true, path: r.filePath };
  });
  handle('file:open', async (opts) => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: opts && opts.filters || [] });
    if (r.canceled) return { cancelled: true };
    const f = r.filePaths[0], st = fs.statSync(f);
    if (st.size > (opts && opts.maxBytes || 4 * 1024 * 1024)) return { tooLarge: true, path: f, size: st.size };
    return { path: f, name: path.basename(f), size: st.size, bytes: new Uint8Array(fs.readFileSync(f)) };
  });
  handle('file:pickFolder', async () => { const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  handle('file:reveal', (p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });
  handle('file:zip', async (opts) => {
    const r = await dialog.showSaveDialog(win, { defaultPath: opts.name, filters: [{ name: 'Zip', extensions: ['zip'] }] });
    if (r.canceled) return { ok: false, cancelled: true };
    fs.writeFileSync(r.filePath, makeZip(opts.files.map((f) => ({ name: f.name, data: f.base64 !== undefined ? Buffer.from(f.base64, 'base64') : f.text }))));
    return { ok: true, path: r.filePath };
  });
  handle('docs:list', () => {
    const out = [];
    const add = (rel) => { const f = path.join(DOCS, rel); if (fs.existsSync(f)) out.push({ path: rel, title: (fs.readFileSync(f, 'utf8').match(/^#\s+(.+)$/m) || [null, rel])[1] }); };
    add('README.md'); add('CHANGELOG.md');
    const d = path.join(DOCS, 'docs');
    if (fs.existsSync(d)) fs.readdirSync(d).filter((f) => f.endsWith('.md')).sort().forEach((f) => add('docs/' + f));
    ['agent/README.md', 'samba/README.md', 'portal/README.md', 'streaming/README.md', 'server/apphost/README.md', 'deployer/FEATURES.md'].forEach(add);
    return out;
  });
  handle('docs:read', (rel) => {
    if (typeof rel !== 'string' || !/^[A-Za-z0-9_/.-]+\.md$/.test(rel) || rel.includes('..')) throw new Error('Bad path');
    return fs.readFileSync(path.join(DOCS, rel), 'utf8');
  });
  handle('shell:open', (url) => { if (OPEN_EXTERNAL.some((re) => re.test(url))) shell.openExternal(url); else throw new Error('Link not allowed'); });
  handle('clipboard:write', (text) => clipboard.writeText(String(text)));
  handle('clipboard:read', () => clipboard.readText());

  // Media from the answer file builder: the renderer generates the XML with the shared generator,
  // the main process writes the kit folder and runs the engine for the ISO.
  handle('media:writeKit', async (kit) => {
    const dir = await dialog.showOpenDialog(win, { title: 'Choose a folder for the media', properties: ['openDirectory', 'createDirectory'] });
    if (dir.canceled) return { ok: false, cancelled: true };
    const out = path.join(dir.filePaths[0], 'TempDesk-media');
    if (fs.existsSync(out) && fs.readdirSync(out).length && !kit.overwrite) return { ok: false, exists: true, path: out };
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(path.join(out, 'TempDesk'), { recursive: true });
    for (const f of kit.files) {
      const rel = f.name.replace(/\\/g, '/');
      if (!/^[A-Za-z0-9][A-Za-z0-9._ /-]{0,200}$/.test(rel) || rel.includes('..')) throw new Error('Bad kit path');
      const abs = path.join(out, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.text);
    }
    if (kit.mode === 'server') {
      for (const s of ['FirstLogon.ps1', 'Continue-Setup.ps1', 'SetupStatus.ps1']) fs.copyFileSync(path.join(PAYLOAD, 'server', 'firstboot', s), path.join(out, 'TempDesk', s));
      for (const f of ['server', 'agent', 'client'].concat(kit.native ? ['portal'] : [])) copyPayload(path.join(PAYLOAD, f), path.join(out, 'TempDesk', f));
    }
    return { ok: true, path: out };
  });
  handle('media:kitPayload', () => {
    // Payload files for the zip kit (text only), with local secrets and caches excluded.
    const files = [];
    for (const s of ['FirstLogon.ps1', 'Continue-Setup.ps1', 'SetupStatus.ps1']) files.push({ name: 'TempDesk/' + s, base64: fs.readFileSync(path.join(PAYLOAD, 'server', 'firstboot', s)).toString('base64') });
    for (const f of ['server', 'agent', 'client', 'portal']) walkPayload(path.join(PAYLOAD, f), 'TempDesk/' + f, files);
    return files;
  });
  handle('media:iso', async (folder) => {
    return new Promise((resolve) => {
      const iso = path.join(path.dirname(folder), 'TempDesk-answer.iso');
      const script = "Import-Module '" + path.join(path.dirname(ENGINE), 'AnswerFile.psm1').replace(/'/g, "''") + "'; New-TdIso -Folder '" + folder.replace(/'/g, "''") + "' -IsoPath '" + iso.replace(/'/g, "''") + "' | Out-Null";
      const p = spawn(process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'pwsh', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('close', (c) => resolve(c === 0 ? { ok: true, path: iso } : { ok: false, error: err.slice(0, 500) }));
      p.on('error', (e) => resolve({ ok: false, error: e.message }));
    });
  });
  // Real disk sizes from a connected USB stick or VHD (for the disk layout canvas).
  handle('disks:list', () => new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve({ ok: false, error: 'windows' });
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const p = spawn(ps, ['-NoProfile', '-NonInteractive', '-Command', 'Get-Disk | Select-Object Number,FriendlyName,BusType,Size,PartitionStyle,IsBoot,IsSystem | ConvertTo-Json -Compress'], { windowsHide: true });
    let o = '';
    p.stdout.on('data', (d) => { o += d; });
    p.on('close', () => { try { const j = JSON.parse(o || '[]'); resolve({ ok: true, disks: [].concat(j).map((d) => ({ number: d.Number, name: d.FriendlyName, bus: String(d.BusType), sizeMB: Math.floor(d.Size / 1048576), style: String(d.PartitionStyle), system: !!(d.IsBoot || d.IsSystem) })) }); } catch (e) { resolve({ ok: false, error: 'parse' }); } });
    p.on('error', () => resolve({ ok: false, error: 'spawn' }));
  }));

  // Workspace history (Git or JSON lines)
  handle('ws:info', async () => ({ kind: workspace.kind, gitError: workspace.gitError || null, canUndo: await workspace.canUndo(), canRedo: await workspace.canRedo() }));
  handle('ws:save', (rel, doc, title, key) => workspace.save(rel, doc, title, key));
  handle('ws:get', (rel) => workspace.get(rel));
  handle('ws:flush', () => workspace.flush());
  handle('ws:undo', () => workspace.undo());
  handle('ws:redo', () => workspace.redo());
  handle('ws:restore', (id, when) => workspace.restore(id, when));
  handle('ws:log', (limit) => workspace.log(limit));
  handle('ws:diff', (a, b, file) => workspace.diff(a, b, file));
  handle('ws:filesAt', (id) => workspace.filesAt(id));
  handle('ws:snapshot', () => workspace.snapshot());
  handle('ws:setRemote', (url) => workspace.setRemote(url));
  handle('ws:push', () => workspace.push());

  // Backup everything and restore (validated in full before anything is written)
  handle('backup:export', async () => {
    const files = [];
    const add = (name, obj) => files.push({ name, data: JSON.stringify(obj, null, 2) + '\n' });
    add('settings.json', store.settings());
    const vocab = store.vocabulary();
    if (vocab) files.push({ name: 'vocabulary.json', data: vocab });
    add('tabs.json', store.tabs());
    for (const d of store.deployments()) add('deployments/' + d.name + '.json', Core.stripSecrets(d));
    const snap = workspace.snapshot();
    for (const k of Object.keys(snap)) add('workspace/' + k, snap[k]);
    const manifest = { schema: 'tempdesk-backup', version: 1, created: new Date().toISOString(), app: BUILD.version, files: files.map((f) => f.name) };
    files.unshift({ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) + '\n' });
    const r = await dialog.showSaveDialog(win, { defaultPath: 'tempdesk-backup-' + new Date().toISOString().slice(0, 10) + '.zip', filters: [{ name: 'Zip', extensions: ['zip'] }] });
    if (r.canceled) return { ok: false, cancelled: true };
    fs.writeFileSync(r.filePath, makeZip(files));
    return { ok: true, path: r.filePath, count: files.length - 1 };
  });
  handle('backup:import', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Zip', extensions: ['zip'] }] });
    if (r.canceled) return { ok: false, cancelled: true };
    let entries;
    try { entries = readZip(fs.readFileSync(r.filePaths[0]), { maxTotal: 32 * 1024 * 1024 }); } catch (e) { return { ok: false, error: e.code || 'zip.format' }; }
    let manifest;
    try { manifest = JSON.parse(entries.get('manifest.json').toString('utf8')); } catch (e) { return { ok: false, error: 'backup.schema' }; }
    const v = Core.validateBackup(manifest, Array.from(entries.keys()));
    if (!v.ok) return v;
    // Parse and validate every file before applying any of them.
    const plan = { settings: null, vocab: null, tabs: null, deployments: [], workspace: {} };
    for (const name of manifest.files) {
      const text = entries.get(name).toString('utf8');
      if (name === 'vocabulary.json') { try { Wording.validate(text); } catch (e) { return { ok: false, error: 'backup.vocabulary' }; } plan.vocab = text; continue; }
      let j; try { j = JSON.parse(text); } catch (e) { return { ok: false, error: 'backup.json', file: name }; }
      if (name === 'settings.json') { const s = validateSettings(j); if (!s.ok) return { ok: false, error: 'backup.settings' }; plan.settings = s.settings; }
      else if (name === 'tabs.json') plan.tabs = j;
      else if (name.startsWith('deployments/')) { const clean = Core.stripSecrets(j); if (Object.keys(Core.validateDeployment(clean)).length) return { ok: false, error: 'backup.deployment', file: name }; plan.deployments.push(clean); }
      else if (name.startsWith('workspace/')) plan.workspace[name.slice(10)] = Core.stripSecrets(j);
    }
    if (plan.settings) store.saveSettings(plan.settings);
    if (plan.vocab) store.saveVocabulary(plan.vocab);
    if (plan.tabs) store.saveTabs(plan.tabs);
    for (const d of plan.deployments) store.saveDeployment(d);
    for (const k of Object.keys(plan.workspace)) await workspace.save(k, plan.workspace[k], 'Restore backup: ' + k);
    return { ok: true, count: manifest.files.length };
  });

  // Base64 file jobs (streamed in the main process, constant memory)
  handle('b64:pick', async () => {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile'] });
    if (r.canceled) return null;
    const f = r.filePaths[0];
    return { path: f, name: path.basename(f), size: fs.statSync(f).size, head: sniff(f, 65536) };
  });
  handle('b64:stat', (p) => { const st = fs.statSync(p); return { path: p, name: path.basename(p), size: st.size, head: sniff(p, 65536) }; });
  handle('b64:start', async (o) => {
    const id = 'b64-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const dest = o.dest || outputPath(o.source, o.mode, o.outDir, o.name);
    if (fs.existsSync(dest) && !o.overwrite) return { exists: true, dest };
    const job = new Job(Object.assign({}, o, { dest }));
    job.on((ev) => send('b64:event', Object.assign({ job: id }, ev)));
    jobs.set(id, job);
    job.start().catch(() => {}).finally(() => jobs.delete(id));
    return { id, dest };
  });
  handle('b64:pause', (id) => { const j = jobs.get(id); if (j) j.pause(); });
  handle('b64:resume', (id) => { const j = jobs.get(id); if (j) j.resume(); });
  handle('b64:cancel', (id) => { const j = jobs.get(id); if (j) j.cancel(); });

  // Updates
  handle('update:check', () => updater.check());
  handle('update:restart', () => { if (updater.state.state === 'ready' && updater.restart()) app.quit(); });
}

function walkPayload(src, prefix, files) {
  if (!fs.existsSync(src)) return;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (['__pycache__', '.pytest_cache', 'bin', 'obj', 'secrets', 'tests', 'node_modules'].includes(e.name)) continue;
    if (/^\.env(\.|$)/.test(e.name) && e.name !== '.env.example') continue;
    if (e.name.endsWith('.pyc')) continue;
    const p = path.join(src, e.name);
    if (e.isDirectory()) walkPayload(p, prefix + '/' + e.name, files);
    else files.push({ name: prefix + '/' + e.name, base64: fs.readFileSync(p).toString('base64') });
  }
}
function copyPayload(src, dst) {
  const files = [];
  walkPayload(src, '', files);
  for (const f of files) { const p = path.join(dst, f.name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(f.base64, 'base64')); }
}

if (!process.squirrelEvent) {
  app.whenReady().then(async () => {
    protocol.handle('app', serveApp);
    store = new Store(dataRoot());
    workspace = await openWorkspace(path.join(store.root, 'workspace'));
    hardenSession();
    registerIpc();
    createWindow();
    nativeTheme.on('updated', () => send('theme:system', { dark: nativeTheme.shouldUseDarkColors, highContrast: nativeTheme.shouldUseHighContrastColors }));
    updater.on((s) => send('update:state', s));
    if (store.settings().updates) setTimeout(() => updater.check().catch(() => {}), 15000);
  });
  app.on('window-all-closed', async () => { try { if (workspace) await workspace.flush(); } catch (e) { /* ignore */ } app.quit(); });
}
Menu.setApplicationMenu(null);
