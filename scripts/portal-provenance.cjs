'use strict';

const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { readFileSync, readdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const filename = 'build-provenance.json';
const versionPattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:[-+][0-9A-Za-z.-]+)?$/;
const sources = ['portal/app', 'portal/Dockerfile', 'portal/Dockerfile.dockerignore', 'site/assets/base64.js',
  'site/assets/zip.js', 'site/assets/regex-builder.js', 'deployer/app/package.json',
  'scripts/portal-provenance.cjs', 'site/build.mjs', 'deployer/app/scripts/prepare-bundle.js'];

function applicationDigest(root) {
  const files = [];
  function visit(relative) {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const name = entry.name;
      const file = path.posix.join(relative, name);
      if (name === '__pycache__' || file === filename || /\.py[co]$/.test(name)) continue;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files.push(file);
      else throw new Error('Invalid staged portal source: ' + file);
    }
  }
  visit('');
  const digest = createHash('sha256');
  for (const file of files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) {
    const hash = createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex');
    digest.update(file + '\0' + hash + '\n');
  }
  return digest.digest('hex');
}

function writePortalProvenance(repository, root, { version, updatedUtc, expectedRevision } = {}) {
  const git = (...args) => execFileSync('git', args, {
    cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  let revision;
  try {
    if (git('rev-parse', '--show-prefix') || git('status', '--porcelain', '--untracked-files=all', '--', ...sources)) return null;
    revision = git('rev-parse', 'HEAD');
    if (expectedRevision !== undefined && revision !== expectedRevision) return null;
    if (version === undefined) {
      const tags = git('tag', '--points-at', revision).split('\n')
        .map(tag => tag.trim()).filter(tag => tag.startsWith('v') && versionPattern.test(tag.slice(1)));
      const packageInfo = JSON.parse(readFileSync(path.join(repository, 'deployer/app/package.json'), 'utf8'));
      version = tags.length === 1 ? tags[0].slice(1) : packageInfo.version;
    }
  } catch {
    return null;
  }
  if (typeof version !== 'string' || version.length > 64 || !versionPattern.test(version) || !/^[0-9a-f]{40}$/.test(revision)) {
    return null;
  }
  const stamp = {
    schema: 1, version, revision,
    updated_utc: (updatedUtc ?? new Date().toISOString()).replace(/\.\d{3}Z$/, 'Z'),
    application_sha256: applicationDigest(root),
  };
  const bytes = Buffer.from(JSON.stringify(stamp) + '\n');
  writeFileSync(path.join(root, filename), bytes, { flag: 'wx' });
  return bytes;
}

module.exports = { filename, writePortalProvenance };
