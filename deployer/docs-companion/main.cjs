'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, protocol, session, shell } = require('electron');

const scheme = 'tempdesk-docs';
const host = 'guide';
const home = scheme + '://' + host + '/';
const audioScheme = 'tempdesk-docs-audio';
const audioFiles = new Map([
  ['/tada.wav', 'tada.wav'],
  ['/invalid.wav', 'Windows Critical Stop.wav'],
]);
const policy = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src tempdesk-docs-audio:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

protocol.registerSchemesAsPrivileged([
  { scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: audioScheme, privileges: { standard: true, secure: true, stream: true } },
]);

function localDocument(url) {
  const parsed = URL.parse(url);
  return parsed?.protocol === scheme + ':' && parsed.host === host && !parsed.username && !parsed.password;
}

function localAudioFile(url) {
  const parsed = URL.parse(url);
  if (parsed?.protocol !== audioScheme + ':' || parsed.host !== 'local' ||
      parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
  return audioFiles.get(parsed.pathname);
}

async function serveLocalAudio(request) {
  const name = localAudioFile(request.url);
  if (!name || request.method !== 'GET' || process.platform !== 'win32') return new Response(null, { status: 404 });
  try {
    const sound = await fs.open(path.join(process.env.SystemRoot || 'C:\\Windows', 'Media', name), 'r');
    try {
      const info = await sound.stat();
      if (!info.isFile() || info.size < 12 || info.size > 2 * 1024 * 1024) return new Response(null, { status: 404 });
      const bytes = Buffer.alloc(info.size);
      const { bytesRead } = await sound.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== bytes.length || bytes.toString('ascii', 0, 4) !== 'RIFF' ||
          bytes.toString('ascii', 8, 12) !== 'WAVE') return new Response(null, { status: 404 });
      return new Response(bytes, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } });
    } finally {
      await sound.close();
    }
  } catch {
    return new Response(null, { status: 404 });
  }
}

function openReference(url) {
  const parsed = URL.parse(url);
  if (parsed?.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port) {
    void shell.openExternal(parsed.href).catch(error => console.error('Could not open the reference link:', error.message));
  }
}

app.whenReady().then(() => {
  const docsSession = session.fromPartition('persist:tempdesk-docs');
  docsSession.protocol.registerSource(scheme, {
    routes: [{
      match: { host },
      source: {
        type: 'directory',
        root: path.join(process.resourcesPath, 'website'),
        index: 'index.html',
        headers: { 'Content-Security-Policy': policy },
      },
    }],
  });
  docsSession.protocol.handle(audioScheme, serveLocalAudio);
  docsSession.webRequest.onBeforeRequest(({ url }, respond) => {
    const protocolName = URL.parse(url)?.protocol;
    respond({ cancel: !localDocument(url) && !localAudioFile(url) && protocolName !== 'data:' && protocolName !== 'blob:' });
  });
  docsSession.setPermissionRequestHandler((_contents, permission, respond) => respond(permission === 'clipboard-sanitized-write'));

  const window = new BrowserWindow({
    title: 'TempDesk Docs',
    width: 1200,
    height: 860,
    minWidth: 340,
    minHeight: 480,
    webPreferences: { session: docsSession, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  window.removeMenu();
  const contents = window.webContents;
  contents.on('will-navigate', event => {
    if (localDocument(event.url)) return;
    event.preventDefault();
    openReference(event.url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (localDocument(url)) void contents.loadURL(url).catch(error => console.error(error.message));
    else openReference(url);
    return { action: 'deny' };
  });
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.alt || input.control || input.shift || input.meta) return;
    const history = contents.navigationHistory;
    if (input.key === 'ArrowLeft' && history.canGoBack()) {
      event.preventDefault();
      history.goBack();
    } else if (input.key === 'ArrowRight' && history.canGoForward()) {
      event.preventDefault();
      history.goForward();
    }
  });
  return window.loadURL(home);
}).catch(error => {
  console.error('Could not open the bundled documentation:', error.message);
  app.exit(1);
});

app.on('window-all-closed', () => app.quit());
