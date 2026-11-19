#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { filename, writePortalProvenance } = require('./portal-provenance.cjs');

const repository = path.resolve(__dirname, '..');
const assets = ['base64.js', 'zip.js', 'regex-builder.js'];
const inputs = [
  'portal/Dockerfile', 'portal/Dockerfile.dockerignore', 'portal/requirements.txt', 'portal/app',
  'docs', 'CHANGELOG.md', ...assets.map(asset => 'site/assets/' + asset),
];
const confidentialPath = /(?:^|\/)(?:\.git(?:\/|$)|\.env(?:\.|\/|$))|\.(?:key|pem|pfx)$/i;

function git(...args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
}

function buildPortalImage(image) {
  const revision = git('rev-parse', 'HEAD');
  if (!/^[0-9a-f]{40}$/.test(revision) || git('rev-parse', '--show-prefix')) {
    throw new Error('Use a TempDesk checkout with an available source revision.');
  }
  const files = git('ls-tree', '-r', '-z', revision, '--', ...inputs).split('\0').filter(Boolean);
  for (const entry of files) {
    const separator = entry.indexOf('\t');
    const [mode, type] = entry.slice(0, separator).split(' ');
    const name = entry.slice(separator + 1);
    if (type !== 'blob' || !['100644', '100755'].includes(mode)
        || confidentialPath.test(name) || name === 'portal/app/' + filename) {
      throw new Error('The approved source paths must contain only regular, non-confidential tracked files.');
    }
  }

  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'tempdesk-portal-'));
  try {
    const context = path.join(temporary, 'context');
    const archive = path.join(temporary, 'source.tar');
    fs.mkdirSync(context);
    const archivedInputs = inputs.filter(input => files.some(entry => {
      const name = entry.slice(entry.indexOf('\t') + 1);
      return name === input || name.startsWith(input + '/');
    }));
    git('archive', '--format=tar', '--output', archive, revision, '--', ...archivedInputs);
    execFileSync('tar', ['-xf', archive, '-C', context], { stdio: 'inherit' });

    const app = path.join(context, 'portal', 'app');
    for (const asset of assets) {
      fs.copyFileSync(path.join(context, 'site', 'assets', asset), path.join(app, 'static', 'js', asset));
    }
    const provenance = writePortalProvenance(repository, app, {
      expectedRevision: revision,
      version: process.env.TEMPDESK_PORTAL_VERSION,
    });
    if (!provenance) {
      throw new Error('Cannot record the source version. Use a clean checkout with available Git metadata.');
    }
    const { version } = JSON.parse(provenance);
    const labels = [
      '--label', 'org.opencontainers.image.source=https://github.com/Ding-Ding-Projects/tempdesk-',
      '--label', 'org.opencontainers.image.revision=' + revision,
      '--label', 'org.opencontainers.image.version=' + version,
    ];
    const layout = process.env.TEMPDESK_PORTAL_OCI_LAYOUT;
    const target = layout
      ? ['buildx', 'build', '--platform', 'linux/amd64,linux/arm64', '--provenance=false', '--sbom=false',
        '--output', 'type=oci,tar=false,dest=' + path.resolve(layout)]
      : ['build'];
    execFileSync('docker', [...target, '--file', path.join(context, 'portal', 'Dockerfile'),
      ...labels, '--tag', image, context], { cwd: repository, stdio: 'inherit' });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  const image = process.argv[2] ?? process.env.TEMPDESK_PORTAL_BUILD_IMAGE ?? 'tempdesk-portal:latest';
  if (process.argv.length > 3 || !image || image.startsWith('-')) {
    throw new Error('Usage: node scripts/build-portal-image.cjs [image:tag]');
  }
  buildPortalImage(image);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
