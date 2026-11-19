// School mode PIN: stored as a salted PBKDF2-SHA256 hash in %LOCALAPPDATA%\TempDesk\shared\school.json.
// This is a convenience lock that keeps playful features out of the way in classrooms. It is not
// a security boundary: anyone who can edit files in the user's profile can remove it.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ITERATIONS = 210000;
const MAX_RECORD_BYTES = 8192;
const DEFAULT_NAME = 'School mode';

function sharedRoot() {
  const base = process.env.LOCALAPPDATA || (process.platform === 'win32'
    ? path.join(os.homedir(), 'AppData', 'Local')
    : path.join(os.homedir(), '.local', 'share'));
  return path.join(base, 'TempDesk');
}

function recordPath(dir) { return path.join(dir, 'shared', 'school.json'); }
function validName(name) {
  return typeof name === 'string' && name.trim().length > 0
    && name.length <= 40 && !/[\x00-\x1f\x7f-\x9f]/.test(name);
}

function hashPin(pin, salt, iterations) {
  if (!/^\d{4,12}$/.test(String(pin))) throw new Error('The PIN must be 4 to 12 digits.');
  const s = salt ? Buffer.from(salt, 'base64') : crypto.randomBytes(16);
  const it = iterations || ITERATIONS;
  const h = crypto.pbkdf2Sync(String(pin), s, it, 32, 'sha256');
  return { algorithm: 'PBKDF2-SHA256', iterations: it, salt: s.toString('base64'), hash: h.toString('base64') };
}
function verifyPin(pin, rec) {
  if (!validPinRecord(rec) || !/^\d{4,12}$/.test(String(pin))) return false;
  const h = crypto.pbkdf2Sync(String(pin), Buffer.from(rec.salt, 'base64'), rec.iterations, 32, 'sha256');
  return crypto.timingSafeEqual(h, Buffer.from(rec.hash, 'base64'));
}

function validPinRecord(record) {
  return record?.algorithm === 'PBKDF2-SHA256' && Number.isInteger(record.iterations)
    && record.iterations >= 1 && record.iterations <= 1000000
    && typeof record.salt === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(record.salt)
    && typeof record.hash === 'string' && /^[A-Za-z0-9+/]{43}=$/.test(record.hash);
}

function read(dir) {
  const file = recordPath(dir);
  try {
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.size > MAX_RECORD_BYTES) return null;
    const rec = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!rec || typeof rec.enabled !== 'boolean' || (rec.name !== undefined && !validName(rec.name))
        || (rec.enabled && !validPinRecord(rec.pin))) return null;
    return rec;
  } catch (error) {
    return error.code === 'ENOENT' ? { enabled: false } : null;
  }
}

function load(dir) { return read(dir) || { enabled: false }; }

function save(dir, rec) {
  const file = recordPath(dir);
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temporary, JSON.stringify(rec, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

function update(dir, change) {
  const lock = recordPath(dir) + '.lock';
  try { fs.mkdirSync(path.dirname(lock), { recursive: true }); } catch { return { ok: false, reason: 'unavailable' }; }
  let descriptor;
  try { descriptor = fs.openSync(lock, 'wx', 0o600); }
  catch (error) { return { ok: false, reason: error.code === 'EEXIST' ? 'busy' : 'unavailable' }; }
  try {
    const current = read(dir);
    return current ? change(current) : { ok: false, reason: 'unavailable' };
  } catch {
    return { ok: false, reason: 'unavailable' };
  } finally {
    fs.closeSync(descriptor);
    try { fs.unlinkSync(lock); } catch {}
  }
}

function setEnabled(dir, pin, name) {
  if (!validName(name) || !/^\d{4,12}$/.test(String(pin))) return { ok: false, reason: 'invalid' };
  const identity = hashPin(pin);
  return update(dir, rec => {
    if (rec.enabled) return { ok: false, reason: 'alreadyEnabled' };
    save(dir, { enabled: true, name, pin: identity });
    return { ok: true };
  });
}

function enable(dir, pin, name) {
  const result = setEnabled(dir, pin, String(name || DEFAULT_NAME).slice(0, 40));
  return result.ok ? status(dir) : statusAfterFailure(dir, result);
}

function statusAfterFailure(dir, result) {
  return { ...status(dir), operationError: result.reason };
}

function disable(dir, pin) {
  return update(dir, rec => {
    if (!rec.enabled) return { ok: true };
    if (!verifyPin(pin, rec.pin)) return { ok: false, reason: 'wrongPin' };
    save(dir, { enabled: false, name: rec.name });
    return { ok: true };
  });
}

function rename(dir, pin, name) {
  if (!validName(name)) return { ok: false, reason: 'invalid' };
  return update(dir, rec => {
    if (!rec.enabled) return { ok: false, reason: 'notEnabled' };
    if (!verifyPin(pin, rec.pin)) return { ok: false, reason: 'wrongPin' };
    save(dir, { ...rec, name });
    return { ok: true };
  });
}

function publicView(rec) { return { enabled: !!rec.enabled, name: rec.name || DEFAULT_NAME }; }
function unavailable() { return { available: false, enabled: true, name: DEFAULT_NAME }; }
function status(dir) {
  const record = read(dir);
  return record ? { available: true, ...publicView(record) } : unavailable();
}

function watch(dir, notify) {
  const file = recordPath(dir);
  let previous = JSON.stringify(status(dir));
  const listener = () => {
    const current = status(dir);
    const next = JSON.stringify(current);
    if (next !== previous) {
      previous = next;
      notify(current);
    }
  };
  try {
    fs.watchFile(file, { persistent: false, interval: 350 }, listener);
    return { available: true, stop: () => fs.unwatchFile(file, listener) };
  } catch {
    return { available: false, stop: () => {} };
  }
}

module.exports = { hashPin, verifyPin, load, save, enable, setEnabled, disable, rename, publicView, status, unavailable, watch, sharedRoot, ITERATIONS };
