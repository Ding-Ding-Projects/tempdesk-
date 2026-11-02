// Local data under %LOCALAPPDATA%\TempDesk: settings, saved deployments (no secrets), tabs,
// personal wording. Writes are atomic (temp file + rename). Imports validate fully first.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Core = require('../shared/core.js');

function dataRoot() {
  const base = process.env.LOCALAPPDATA || (process.platform === 'win32' ? path.join(require('os').homedir(), 'AppData', 'Local') : path.join(require('os').homedir(), '.local', 'share'));
  return path.join(base, 'TempDesk');
}

const DEFAULT_SETTINGS = {
  schema: 'tempdesk-deployer-settings', version: 1,
  onboarded: false, onboarding: { step: 0, path: 'server', skipped: [] },
  language: 'en', funny: 1, theme: 'dark', motion: 'system', sounds: true, volume: 60,
  appName: 'TempDesk Deployer', accent: '#7CF3E6', radius: 20, density: 'comfortable', textScale: 100, highContrast: 'system',
  logo: '', schoolName: 'School mode', updates: true, gitRemote: '', helpBubbles: true
};

const ALLOWED = {
  language: (v) => ['en', 'zh-HK', 'bilingual'].includes(v),
  funny: (v) => Number.isInteger(v) && v >= 0 && v <= 3,
  theme: (v) => ['dark', 'light', 'system'].includes(v),
  motion: (v) => ['system', 'on', 'off'].includes(v),
  sounds: (v) => typeof v === 'boolean',
  volume: (v) => Number.isInteger(v) && v >= 0 && v <= 100,
  appName: (v) => typeof v === 'string' && v.trim().length >= 1 && v.length <= 40 && !/[\x00-\x1f<>]/.test(v),
  accent: (v) => typeof v === 'string' && /^#[0-9A-Fa-f]{6}$/.test(v),
  radius: (v) => Number.isInteger(v) && v >= 8 && v <= 32,
  density: (v) => ['compact', 'comfortable', 'spacious'].includes(v),
  textScale: (v) => Number.isInteger(v) && v >= 90 && v <= 160,
  highContrast: (v) => ['system', 'on', 'off'].includes(v),
  logo: (v) => typeof v === 'string' && (v === '' || (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(v) && v.length <= 300000)),
  schoolName: (v) => typeof v === 'string' && v.trim().length >= 1 && v.length <= 40 && !/[\x00-\x1f<>]/.test(v),
  updates: (v) => typeof v === 'boolean',
  gitRemote: (v) => typeof v === 'string' && (v === '' || (/^(https:\/\/|ssh:\/\/|git@)[^\s]{3,300}$/.test(v) && !/https:\/\/[^/]*@/.test(v))),
  helpBubbles: (v) => typeof v === 'boolean',
  onboarded: (v) => typeof v === 'boolean',
  onboarding: (v) => v && typeof v === 'object' && Number.isInteger(v.step) && v.step >= 0 && v.step <= 10 && ['server', 'lite'].includes(v.path) && Array.isArray(v.skipped) && v.skipped.every((s) => typeof s === 'string' && s.length < 40)
};

function validateSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'settings.shape' };
  if (input.schema !== undefined && input.schema !== 'tempdesk-deployer-settings') return { ok: false, error: 'settings.schema' };
  const out = Object.assign({}, DEFAULT_SETTINGS);
  for (const k of Object.keys(input)) {
    if (k === 'schema' || k === 'version') continue;
    if (!(k in ALLOWED)) return { ok: false, error: 'settings.unknown', key: k };
    if (!ALLOWED[k](input[k])) return { ok: false, error: 'settings.value', key: k };
    out[k] = input[k];
  }
  return { ok: true, settings: out };
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomBytes(4).toString('hex') + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }

class Store {
  constructor(root) { this.root = root || dataRoot(); fs.mkdirSync(this.root, { recursive: true }); }
  p(...x) { return path.join(this.root, ...x); }
  settings() { const r = validateSettings(readJson(this.p('settings.json'), {})); return r.ok ? r.settings : Object.assign({}, DEFAULT_SETTINGS); }
  saveSettings(s) { const r = validateSettings(s); if (!r.ok) throw Object.assign(new Error(r.error), r); writeAtomic(this.p('settings.json'), JSON.stringify(r.settings, null, 2) + '\n'); return r.settings; }
  deployments() {
    const dir = this.p('deployments');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(dir, f), null)).filter(Boolean).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  deployment(name) { return readJson(this.p('deployments', name + '.json'), null); }
  saveDeployment(d) {
    const clean = Core.stripSecrets(d);
    const e = Core.validateDeployment(clean);
    if (Object.keys(e).length) throw Object.assign(new Error('Deployment settings are not valid.'), { fields: e });
    clean.updated = new Date().toISOString();
    writeAtomic(this.p('deployments', clean.name + '.json'), JSON.stringify(clean, null, 2) + '\n');
    return clean;
  }
  deleteDeployment(name) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(name)) throw new Error('Bad name');
    fs.rmSync(this.p('deployments', name + '.json'), { force: true });
  }
  deploymentDir(name) { return this.p('deployments', name); }
  agentInfo(name) {
    const a = readJson(path.join(this.deploymentDir(name), 'agent.json'), null);
    if (!a) return null;
    return { hasKeys: !!(a.guestKey && a.adminKey), tls: !!a.tls, port: a.port || (a.tls ? 8443 : 8080), domainDn: a.domainDn || '' };
  }
  tabs() { const t = readJson(this.p('tabs.json'), { open: [], active: null }); return Array.isArray(t.open) ? t : { open: [], active: null }; }
  saveTabs(t) {
    const open = (t.open || []).filter((n) => typeof n === 'string' && /^[A-Za-z0-9][A-Za-z0-9._ -]{0,63}$/.test(n)).slice(0, 30);
    writeAtomic(this.p('tabs.json'), JSON.stringify({ open, active: open.includes(t.active) ? t.active : null }) + '\n');
  }
  vocabulary() { return readJson(this.p('vocabulary.json'), null); }
  saveVocabulary(text) { writeAtomic(this.p('vocabulary.json'), text); }
  clearVocabulary() { fs.rmSync(this.p('vocabulary.json'), { force: true }); }
}

module.exports = { Store, dataRoot, validateSettings, DEFAULT_SETTINGS, writeAtomic };
