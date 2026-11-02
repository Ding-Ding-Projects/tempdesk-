// School mode PIN: stored as a salted PBKDF2-SHA256 hash in %LOCALAPPDATA%\TempDesk\shared\school.json.
// This is a convenience lock that keeps playful features out of the way in classrooms. It is not
// a security boundary: anyone who can edit files in the user's profile can remove it.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ITERATIONS = 210000;

function hashPin(pin, salt, iterations) {
  if (!/^\d{4,12}$/.test(String(pin))) throw new Error('The PIN must be 4 to 12 digits.');
  const s = salt ? Buffer.from(salt, 'base64') : crypto.randomBytes(16);
  const it = iterations || ITERATIONS;
  const h = crypto.pbkdf2Sync(String(pin), s, it, 32, 'sha256');
  return { algorithm: 'PBKDF2-SHA256', iterations: it, salt: s.toString('base64'), hash: h.toString('base64') };
}
function verifyPin(pin, rec) {
  if (!rec || rec.algorithm !== 'PBKDF2-SHA256' || !/^\d{4,12}$/.test(String(pin))) return false;
  const h = crypto.pbkdf2Sync(String(pin), Buffer.from(rec.salt, 'base64'), rec.iterations, 32, 'sha256');
  const want = Buffer.from(rec.hash, 'base64');
  return want.length === h.length && crypto.timingSafeEqual(h, want);
}
function load(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'shared', 'school.json'), 'utf8')); } catch (e) { return { enabled: false }; }
}
function save(dir, rec) {
  fs.mkdirSync(path.join(dir, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'shared', 'school.json'), JSON.stringify(rec, null, 2) + '\n');
}
function enable(dir, pin, name) {
  const rec = Object.assign({ enabled: true, name: String(name || 'School mode').slice(0, 40) }, { pin: hashPin(pin) });
  save(dir, rec);
  return publicView(rec);
}
function disable(dir, pin) {
  const rec = load(dir);
  if (!rec.enabled) return { ok: true };
  if (!verifyPin(pin, rec.pin)) return { ok: false };
  save(dir, { enabled: false, name: rec.name });
  return { ok: true };
}
function publicView(rec) { return { enabled: !!rec.enabled, name: rec.name || 'School mode' }; }

module.exports = { hashPin, verifyPin, load, save, enable, disable, publicView, ITERATIONS };
