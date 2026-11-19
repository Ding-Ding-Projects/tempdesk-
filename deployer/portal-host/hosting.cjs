'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

const runtimeFiles = ['scripts/host-portals.ps1', 'portal/compose.yaml', 'portal/compose.published.yaml'];
const image = 'ghcr.io/ding-ding-projects/tempdesk-portal';
const sourceUrl = 'https://github.com/Ding-Ding-Projects/tempdesk-';
const engine = 'npipe:////./pipe/dockerDesktopLinuxEngine';
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

class HostError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function addresses() {
  const privateAddress = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/;
  return Array.from(new Set(Object.values(os.networkInterfaces()).flat().filter(entry =>
    entry.family === 'IPv4' && !entry.internal && privateAddress.test(entry.address)).map(entry => entry.address)));
}

function optionsFrom(value, available = addresses()) {
  if (!value || typeof value !== 'object' || typeof value.project !== 'string' ||
      !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(value.project) || !available.includes(value.address) ||
      !Number.isInteger(value.guestPort) || value.guestPort < 1 || value.guestPort > 65535 ||
      !Number.isInteger(value.managementPort) || value.managementPort < 1 || value.managementPort > 65535 ||
      value.guestPort === value.managementPort) throw new HostError('configuration');
  return { project: value.project, address: value.address, guestPort: value.guestPort, managementPort: value.managementPort };
}

async function readJson(file, maximum) {
  const handle = await fs.open(file, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Expected a regular file.');
    const bytes = Buffer.alloc(maximum + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead > maximum) throw new Error('File exceeds the input limit.');
    return JSON.parse(bytes.toString('utf8', 0, bytesRead).replace(/^\uFEFF/, ''));
  } finally { await handle.close(); }
}

async function receiptAt(file) {
  try {
    const value = await readJson(file, 16384);
    if (value.schemaVersion !== 1 || value.image !== image || value.source !== sourceUrl ||
        !['published', 'already-published'].includes(value.state) || typeof value.version !== 'string' ||
        value.version.length > 64 || !versionPattern.test(value.version) || !/^[a-f0-9]{40}$/.test(value.revision) ||
        !/^sha256:[a-f0-9]{64}$/.test(value.digest) || value.releaseTag !== 'v' + value.version ||
        value.tag !== 'sha-' + value.revision || value.immutableReference !== image + '@' + value.digest) {
      throw new Error('Receipt identity mismatch.');
    }
    const { version, revision, releaseTag, digest } = value;
    return { name: path.basename(file), version, revision, releaseTag, digest };
  } catch { throw new HostError('receipt'); }
}

async function writeAtomic(file, data) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fs.writeFile(temporary, data, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

async function prepareRuntime(root, bundled, identity) {
  const marker = path.join(root, 'runtime.json');
  const prior = await readJson(marker, 8192).catch(error => {
    if (error.code === 'ENOENT') return {};
    throw new HostError('runtime');
  });
  const staged = [];
  for (const relative of runtimeFiles) {
    const data = await fs.readFile(path.join(bundled, relative));
    const expected = identity.runtime[relative];
    if (expected !== sha256(data)) throw new HostError('runtime');
    const destination = path.join(root, relative);
    const current = await fs.readFile(destination).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const hash = current && sha256(current);
    if (hash && hash !== expected && hash !== prior[relative]) throw new HostError('runtime');
    staged.push({ destination, data, needsWrite: hash !== expected });
  }
  for (const entry of staged) {
    if (!entry.needsWrite) continue;
    await fs.mkdir(path.dirname(entry.destination), { recursive: true });
    await writeAtomic(entry.destination, entry.data);
  }
  await writeAtomic(marker, JSON.stringify(identity.runtime));
}

function childProcess(file, args, { env, line = () => {}, diagnostic = () => {}, timeout = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    function consume(stream, deliver) {
      const decoder = new StringDecoder('utf8');
      let pending = '';
      stream.on('data', data => {
        const lines = (pending + decoder.write(data)).split(/\r?\n/);
        pending = lines.pop().slice(0, 8192);
        for (const item of lines) deliver(item.slice(0, 8192));
      });
      stream.on('end', () => {
        const remainder = pending + decoder.end();
        if (remainder) deliver(remainder.slice(0, 8192));
      });
    }
    consume(child.stdout, line);
    consume(child.stderr, diagnostic);
    // Only the read-only prerequisite probes use a forced timeout.
    const timer = timeout ? setTimeout(() => child.kill(), timeout) : null;
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve(code); });
  });
}

async function checkDocker() {
  if (process.platform !== 'win32') return false;
  let platform = '';
  try {
    const docker = ['--host', engine];
    const info = await childProcess('docker.exe', [...docker, 'info', '--format', '{{.OSType}}|{{.OperatingSystem}}'],
      { timeout: 15000, line: value => { platform = value.trim(); } });
    return info === 0 && platform === 'linux|Docker Desktop' &&
      await childProcess('docker.exe', [...docker, 'compose', 'version', '--short'], { timeout: 15000 }) === 0;
  } catch { return false; }
}

function binding(options) {
  return [
    'services:',
    '  tempdesk-guest:',
    '    ports: !override ["' + options.address + ':' + options.guestPort + ':8080"]',
    '  tempdesk-admin:',
    '    ports: !override ["' + options.address + ':' + options.managementPort + ':8081"]',
    '',
  ].join('\n');
}

function parseEndpoint(line, version, options) {
  const match = /^(Guest kiosk|Management) (\d+\.\d+\.\d+) \| (http:\/\/[0-9.]+:\d+\/(?:login)?) \| Started ([\d :\-]+ UTC) \| Verified ([\d :\-]+ UTC)$/.exec(line);
  if (!match || match[2] !== version) return null;
  const guest = match[1] === 'Guest kiosk';
  const expected = 'http://' + options.address + ':' + (guest ? options.guestPort + '/' : options.managementPort + '/login');
  return match[3] === expected ? { role: guest ? 'guest' : 'management', url: match[3], started: match[4], verified: match[5] } : null;
}

async function deploy({ draft, job, identity, runtime, bundled, recheck, progress }) {
  const options = optionsFrom(draft);
  const receipt = await receiptAt(draft.receiptPath);
  const config = await fs.stat(draft.configuration).catch(() => null);
  if (!config?.isDirectory()) throw new HostError('configuration');
  if (draft.overlay && (!(await fs.stat(draft.overlay).catch(() => null))?.isFile() || draft.overlay.includes(';'))) {
    throw new HostError('configuration');
  }
  if (job.cancelRequested) return { code: 3, endpoints: [], reason: '' };
  await prepareRuntime(runtime, bundled, identity);
  const project = path.join(runtime, 'projects', options.project);
  const overlay = path.join(project, 'binding.yaml');
  if (overlay.includes(';')) throw new HostError('configuration');
  if (recheck) {
    const previous = await fs.readFile(overlay, 'utf8').catch(() => '');
    if (previous !== binding(options)) throw new HostError('configuration');
  } else {
    await fs.mkdir(project, { recursive: true });
    await writeAtomic(overlay, binding(options));
  }
  if (job.cancelRequested) return { code: 3, endpoints: [], reason: '' };

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(COMPOSE_|DOCKER_(HOST|CONTEXT)|TEMPDESK_PORTAL_|TEMPDESK_LAN_ADDRESS)/i.test(key)) delete env[key];
  }
  env.COMPOSE_PROJECT_NAME = options.project;
  env.TEMPDESK_PORTAL_CONFIG_DIR = draft.configuration;
  env.TEMPDESK_PORTAL_RECEIPT = draft.receiptPath;
  env.TEMPDESK_PORTAL_COMPOSE_OVERRIDES = [draft.overlay, overlay].filter(Boolean).join(';');
  env.TEMPDESK_LAN_ADDRESS = options.address;
  env.TEMPDESK_PORTAL_CANCEL_FILE = job.marker;
  if (job.cancelRequested) return { code: 3, endpoints: [], reason: '' };

  let phase = 'preparing';
  let reason = 'startup';
  const endpoints = new Map();
  const code = await childProcess(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(runtime, runtimeFiles[0]),
      '-Mode', recheck ? 'verify' : 'detached'], {
      env,
      line(value) {
        if (value.startsWith('Pulling TempDesk ')) phase = 'pulling';
        if (value === 'Starting both portals and waiting for health...') phase = 'starting';
        if (value === 'Checking the published portal endpoints...') phase = 'checking';
        const endpoint = parseEndpoint(value, receipt.version, options);
        if (endpoint) endpoints.set(endpoint.role, endpoint);
        progress({ phase, endpoints: Array.from(endpoints.values()) });
      },
      diagnostic(value) {
        if (/Docker Desktop|Docker Compose plugin/.test(value)) reason = 'dependency';
        else if (/Cannot pull/.test(value)) reason = 'pull';
        else if (/publication receipt|pulled image differs|pulled digest/.test(value)) reason = 'receipt';
        else if (/project has containers|configuration|port mapping|already has a TempDesk/.test(value)) reason = 'configuration';
        else if (/endpoint|portal health|running portal/.test(value)) reason = 'verify';
      },
    });
  return { code, endpoints: Array.from(endpoints.values()), reason };
}

module.exports = { HostError, addresses, optionsFrom, readJson, receiptAt, writeAtomic, checkDocker, deploy };
