'use strict';

const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const identity = require('./source.json');
const { absoluteField, addresses, optionsFrom, readJson, receiptAt, writeAtomic, checkDocker, deploy,
  recoverDeployment, saveDeployment } = require('./hosting.cjs');

const activePhases = new Set(['preparing', 'pulling', 'starting', 'checking']);
const pickerKinds = new Set(['receipt', 'configuration', 'overlay']);
let window, root, settingsFile, deploymentFile, runtime, draft, lastDeployment, active, pickerOpen;
let saving = Promise.resolve();
let docker = 'unchecked';
let run = idleRun();
let recheckSaveFailed = false;

function idleRun() {
  return { phase: 'idle', code: null, reason: '', startedAt: null, cancelRequested: false, endpoints: [] };
}

function snapshot() {
  const { version, revision } = identity;
  const { receiptPath, ...visible } = draft;
  const recheckTarget = lastDeployment && {
    project: lastDeployment.project, releaseTag: lastDeployment.receipt.releaseTag,
  };
  return { version, revision, addresses: addresses(), docker, draft: visible, run, recheckTarget, recheckSaveFailed };
}

function publish() {
  const state = snapshot();
  if (window && !window.isDestroyed()) window.webContents.send('portal-host:state-changed', state);
  return state;
}

function updateRun(change) {
  run = { ...run, ...change };
  return publish();
}

async function readSettings() {
  const found = await readJson(settingsFile, 32768).catch(() => null);
  const saved = found && typeof found === 'object' && !Array.isArray(found) ? found : {};
  const available = addresses();
  const defaults = { project: 'tempdesk-portals', address: available[0] || '', guestPort: 8080, managementPort: 8081 };
  let options;
  try { options = optionsFrom(saved, available); } catch { options = defaults; }
  const receiptPath = absoluteField(saved.receiptPath);
  const receipt = receiptPath ? await receiptAt(receiptPath).catch(() => null) : null;
  return { ...options, configuration: absoluteField(saved.configuration), overlay: absoluteField(saved.overlay),
    receipt, receiptPath: receipt ? receiptPath : '' };
}

function saveSettings() {
  const { receipt, ...record } = draft;
  const data = JSON.stringify(record);
  const writing = saving.then(() => writeAtomic(settingsFile, data));
  saving = writing.catch(() => {});
  return writing;
}

async function choose(kind) {
  if (!pickerKinds.has(kind) || pickerOpen || active) return snapshot();
  pickerOpen = true;
  try {
    const isDirectory = kind === 'configuration';
    const filters = kind === 'receipt' ? [{ name: 'Portal publication receipt', extensions: ['json'] }] :
      [{ name: 'Compose configuration', extensions: ['yaml', 'yml'] }];
    const selected = await dialog.showOpenDialog(window, {
      properties: [isDirectory ? 'openDirectory' : 'openFile'],
      ...(isDirectory ? {} : { filters }),
    });
    if (selected.canceled || !selected.filePaths.length) return snapshot();
    const chosen = absoluteField(selected.filePaths[0]);
    if (!chosen || (kind === 'overlay' && chosen.includes(';'))) {
      return updateRun({ ...idleRun(), reason: 'configuration' });
    }
    if (kind === 'receipt') {
      const receipt = await receiptAt(chosen).catch(() => null);
      if (!receipt) return updateRun({ ...idleRun(), reason: 'receipt' });
      draft.receiptPath = chosen;
      draft.receipt = receipt;
    } else {
      draft[kind] = chosen;
    }
    await saveSettings();
    return updateRun(idleRun());
  } catch { return updateRun({ ...idleRun(), reason: 'configuration' }); }
  finally { pickerOpen = false; }
}

async function start(recheck) {
  if (active || pickerOpen || docker === 'checking') return snapshot();
  if (docker !== 'ready') return updateRun({ ...idleRun(), phase: 'failed', reason: 'dependency' });
  const selected = recheck ? lastDeployment : { ...draft };
  if (!selected?.receipt || !selected.receiptPath) return updateRun({ ...idleRun(), phase: 'failed', reason: 'receipt' });
  if (!selected.configuration) return updateRun({ ...idleRun(), phase: 'failed', reason: 'configuration' });
  try { optionsFrom(selected); }
  catch { return updateRun({ ...idleRun(), phase: 'failed', reason: 'configuration' }); }

  const job = { marker: path.join(root, 'cancel-' + randomUUID()), cancelRequested: false, recheck };
  active = job;
  const state = updateRun({ ...idleRun(), phase: 'preparing', startedAt: Date.now() });
  void (async () => {
    let saved;
    try {
      const result = await deploy({ draft: selected, job, identity, runtime, previous: lastDeployment,
        bundled: path.join(process.resourcesPath, 'portal-runtime'), recheck, progress: change => {
          if (!recheck && !saved && change.phase === 'starting') {
            lastDeployment = selected;
            saved = saveDeployment(deploymentFile, selected).then(() => true, () => false);
          }
          updateRun(change);
        } });
      let phase = 'failed';
      if (result.code === 3 && job.cancelRequested) phase = 'cancelled';
      else if (result.code === 0 && result.endpoints.length === 2) phase = 'succeeded';
      else if (result.endpoints.length) phase = 'partial';
      updateRun({ phase, code: result.code, reason: ['succeeded', 'cancelled'].includes(phase) ? '' : result.reason,
        endpoints: result.endpoints });
    } catch (error) {
      updateRun({ phase: 'failed', reason: error.reason || 'startup', code: null });
    } finally {
      if (saved) recheckSaveFailed = !await saved;
      await fs.rm(job.marker, { force: true }).catch(() => {});
      active = null;
      publish();
    }
  })();
  return state;
}

function handle(name, action) {
  ipcMain.handle('portal-host:' + name, (event, value) => {
    if (!window || event.senderFrame !== window.webContents.mainFrame) return null;
    return action(value);
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.whenReady().then(async () => {
    root = app.getPath('userData');
    await fs.mkdir(root, { recursive: true });
    settingsFile = path.join(root, 'hosting-settings.json');
    deploymentFile = path.join(root, 'hosting-last-deployment.json');
    runtime = path.join(root, 'hosting-runtime');
    [draft, lastDeployment] = await Promise.all([readSettings(), recoverDeployment(deploymentFile, runtime).catch(() => null)]);
    window = new BrowserWindow({ width: 1120, height: 820, minWidth: 360, minHeight: 540, useContentSize: true, autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('close', event => {
      if (active || activePhases.has(run.phase)) event.preventDefault();
    });
    handle('state', snapshot);
    handle('check', async () => {
      if (active || docker === 'checking') return snapshot();
      docker = 'checking';
      publish();
      docker = await checkDocker() ? 'ready' : 'unavailable';
      return publish();
    });
    handle('choose', choose);
    handle('clear-overlay', async () => {
      if (active || pickerOpen) return snapshot();
      draft = { ...draft, overlay: '' };
      try {
        await saveSettings();
        return updateRun(idleRun());
      } catch { return updateRun({ ...idleRun(), reason: 'configuration' }); }
    });
    handle('configure', async value => {
      if (active || pickerOpen) return snapshot();
      try {
        draft = { ...draft, ...optionsFrom(value) };
        await saveSettings();
        return updateRun(idleRun());
      } catch { return updateRun({ ...idleRun(), reason: 'configuration' }); }
    });
    handle('start', () => start(false));
    handle('recheck', () => start(true));
    handle('cancel', async () => {
      if (!active || active.recheck || active.cancelRequested) return snapshot();
      const job = active;
      try { await fs.writeFile(job.marker, '', { flag: 'wx', mode: 0o600 }); }
      catch { return snapshot(); }
      if (active !== job) {
        await fs.rm(job.marker, { force: true }).catch(() => {});
        return snapshot();
      }
      job.cancelRequested = true;
      return updateRun({ cancelRequested: true });
    });
    handle('open', async role => {
      const endpoint = run.endpoints.find(item => item.role === role);
      if (endpoint) await shell.openExternal(endpoint.url).catch(() => {});
      return snapshot();
    });
    await window.loadFile(path.join(__dirname, 'index.html'));
  }).catch(() => app.exit(1));
  app.on('window-all-closed', () => app.quit());
}
