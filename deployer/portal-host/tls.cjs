'use strict';

const { createPrivateKey, X509Certificate } = require('node:crypto');
const fs = require('node:fs/promises');
const { isIP } = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

const tlsFiles = Object.freeze({
  guestCertificate: 'TEMPDESK_GUEST_TLS_CERT_FILE',
  guestKey: 'TEMPDESK_GUEST_TLS_KEY_FILE',
  managementCertificate: 'TEMPDESK_MANAGEMENT_TLS_CERT_FILE',
  managementKey: 'TEMPDESK_MANAGEMENT_TLS_KEY_FILE',
  issuer: 'TEMPDESK_PORTAL_TLS_CA_FILE',
});
const maximumBytes = 256 * 1024;
const privateKeyKinds = new Set(['guestKey', 'managementKey']);
const pairs = [['guestCertificate', 'guestKey'], ['managementCertificate', 'managementKey']];

class TlsError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function certificateName(value) {
  const name = value.trim().toLowerCase();
  if (isIP(name) === 4) return name;
  if (name.length > 253 || /^[\d.]+$/.test(name) || !name.split('.').every(label =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return '';
  return name;
}

function tlsDraft(value) {
  const name = typeof value?.name === 'string' && value.name.length <= 253 && !/[\x00-\x1f\x7f]/.test(value.name)
    ? value.name : '';
  const files = Object.fromEntries(Object.keys(tlsFiles).map(kind => {
    const selected = value?.files?.[kind];
    return [kind, typeof selected === 'string' && selected.length <= 4096 && !/[\x00-\x1f\x7f]/.test(selected) &&
      path.isAbsolute(selected) ? selected : ''];
  }));
  return { enabled: value?.enabled === true, name, files };
}

function tlsVisible(value) {
  const files = Object.fromEntries(Object.entries(value.files).map(([kind, selected]) => [kind, Boolean(selected)]));
  return { enabled: value.enabled, name: value.name, files,
    ready: Boolean(certificateName(value.name)) && pairs.every(([cert, key]) => files[cert] && files[key]) };
}

function tlsPicker(kind) {
  if (privateKeyKinds.has(kind)) return [{ name: 'PEM private key', extensions: ['key', 'pem'] }];
  return [{ name: 'PEM certificate', extensions: ['pem', 'crt', 'cer'] }];
}

async function readPem(file) {
  let handle;
  const buffer = Buffer.alloc(maximumBytes + 1);
  try {
    handle = await fs.open(file, 'r');
    const info = await handle.stat();
    if (!info.isFile() || !info.size || info.size > maximumBytes) throw new TlsError('tls-files');
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead !== info.size || bytesRead > maximumBytes) throw new TlsError('tls-files');
    return buffer.subarray(0, bytesRead);
  } catch {
    buffer.fill(0);
    throw new TlsError('tls-files');
  } finally { await handle?.close(); }
}

function certificates(bytes, issuer = false) {
  const kind = issuer ? 'tls-issuer' : 'tls-certificate';
  try {
    const pem = bytes.toString('utf8').trim();
    const pattern = /-----BEGIN CERTIFICATE-----[\r\n]+[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----/g;
    const entries = pem.match(pattern);
    if (!entries?.length || pem.replace(pattern, '').trim()) throw new Error();
    const chain = entries.map(entry => new X509Certificate(entry));
    if (issuer && !chain.every(entry => entry.ca)) throw new Error();
    return { pem, leaf: chain[0] };
  } catch { throw new TlsError(kind); }
}

function privateKey(bytes) {
  try { return createPrivateKey({ key: bytes, format: 'pem' }); }
  catch { throw new TlsError('tls-pair'); }
}

async function validateSelection(kind, file) {
  if (!Object.hasOwn(tlsFiles, kind) || !tlsDraft({ files: { [kind]: file } }).files[kind]) {
    throw new TlsError('tls-files');
  }
  const bytes = await readPem(file);
  try {
    if (privateKeyKinds.has(kind)) privateKey(bytes);
    else certificates(bytes, kind === 'issuer');
  } finally { bytes.fill(0); }
}

function verifyTrust(cert, key, name, ca) {
  // A bounded loopback handshake lets the platform TLS engine validate the chain without a trust-store write.
  return new Promise((resolve, reject) => {
    const loopback = '127.0.0.1';
    const connections = new Set();
    const server = tls.createServer({ cert, key, minVersion: 'TLSv1.2' }, peer => peer.end());
    let client;
    let finished = false;
    function finish(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      client?.destroy();
      for (const connection of connections) connection.destroy();
      server.close();
      if (error) reject(new TlsError('tls-issuer'));
      else resolve();
    }
    const timer = setTimeout(() => finish(true), 5000);
    server.on('error', finish);
    server.on('connection', connection => {
      connections.add(connection);
      connection.once('close', () => connections.delete(connection));
    });
    server.listen(0, loopback, () => {
      if (finished) return;
      client = tls.connect({ host: loopback, port: server.address().port, servername: isIP(name) ? undefined : name,
        ca, rejectUnauthorized: true, checkServerIdentity: (_, peer) => tls.checkServerIdentity(name, peer) }, () => finish());
      client.once('error', finish);
    });
  });
}

async function validateTls(value) {
  if (value !== undefined && typeof value?.enabled !== 'boolean') throw new TlsError('tls-files');
  const options = tlsDraft(value);
  if (!options.enabled) return options;
  const name = certificateName(options.name);
  if (!name) throw new TlsError('tls-name');
  if (!pairs.every(([cert, key]) => options.files[cert] && options.files[key])) throw new TlsError('tls-files');
  const ca = options.files.issuer ? certificates(await readPem(options.files.issuer), true).pem :
    tls.getCACertificates('system');
  if (!ca.length) throw new TlsError('tls-issuer');
  for (const [cert, key] of pairs) {
    const { pem, leaf } = certificates(await readPem(options.files[cert]));
    const now = Date.now();
    if (now < Date.parse(leaf.validFrom) || now >= Date.parse(leaf.validTo)) throw new TlsError('tls-certificate');
    if (!(isIP(name) ? leaf.checkIP(name) : leaf.checkHost(name, { subject: 'never' }))) throw new TlsError('tls-name');
    const bytes = await readPem(options.files[key]);
    try {
      if (!leaf.checkPrivateKey(privateKey(bytes))) throw new TlsError('tls-pair');
      await verifyTrust(pem, bytes, name, ca);
    } finally { bytes.fill(0); }
  }
  return { ...options, name };
}

module.exports = { tlsFiles, tlsDraft, tlsVisible, tlsPicker, validateSelection, validateTls };
