'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const app = path.join(root, 'deployer/app');
const requireApp = createRequire(path.join(app, 'package.json'));
const { build, Arch, Platform } = requireApp('electron-builder');
const metadata = requireApp('./package.json');
const ui = path.join(root, 'deployer/portal-host');
const runtimeFiles = ['scripts/host-portals.ps1', 'portal/compose.yaml', 'portal/compose.published.yaml'];
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const revision = git('rev-parse', 'HEAD');
  const version = process.env.TEMPDESK_VERSION || metadata.version;
  if (!/^[0-9a-f]{40}$/.test(revision) || !/^\d+\.\d+\.\d+$/.test(version) ||
      (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== revision) ||
      git('status', '--porcelain', '--untracked-files=all')) {
    throw new Error('Build the portal host from a clean checkout at the selected revision.');
  }

  const bundle = path.join(root, '.bundle');
  fs.mkdirSync(bundle, { recursive: true });
  const stagingRoot = fs.realpathSync(bundle);
  const project = path.relative(fs.realpathSync(root), stagingRoot);
  if (project !== '.bundle') throw new Error('The staging directory must belong to this checkout.');
  const stage = fs.mkdtempSync(path.join(stagingRoot, 'portal-host-'));
  try {
    const runtime = {};
    for (const relative of runtimeFiles) {
      const bytes = fs.readFileSync(path.join(root, relative));
      const target = path.join(stage, 'portal-runtime', relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
      runtime[relative] = hash(bytes);
    }
    const rendererFiles = ['index.html', 'ui.js', 'ui.css'];
    for (const file of [...rendererFiles, 'main.cjs', 'preload.cjs', 'hosting.cjs']) {
      fs.copyFileSync(path.join(ui, file), path.join(stage, file));
    }
    const localizations = fs.readdirSync(ui).filter(file => /^(?:en|zh-HK)\.json$/.test(file));
    for (const file of localizations) fs.copyFileSync(path.join(ui, file), path.join(stage, file));
    fs.copyFileSync(path.join(root, 'portal/app/static/css/tokens.css'), path.join(stage, 'tokens.css'));
    fs.writeFileSync(path.join(stage, 'source.json'), JSON.stringify({ revision, version, runtime }));
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
      name: 'tempdesk-portal-host', version, main: 'main.cjs', productName: 'TempDesk Portal Host',
      description: 'Configure and verify TempDesk portals', author: metadata.author, license: metadata.license,
    }));
    const outputs = await build({
      projectDir: stage, targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64), publish: 'never',
      config: {
        appId: 'org.tempdesk.portal-host', productName: 'TempDesk Portal Host', executableName: 'TempDeskPortalHost',
        electronVersion: metadata.devDependencies.electron, npmRebuild: false, publish: null,
        directories: { output: path.join(root, 'deployer/bin/portal-host') },
        files: [...rendererFiles, ...localizations, 'main.cjs', 'preload.cjs', 'hosting.cjs', 'tokens.css', 'source.json', 'package.json'],
        extraResources: [{ from: path.join(stage, 'portal-runtime'), to: 'portal-runtime' }],
        win: { icon: path.join(root, 'deployer/assets/tempdesk.ico'), forceCodeSigning: false },
        portable: { artifactName: 'TempDeskPortalHost-${version}-portable.exe' },
      },
    });
    const portable = outputs.find(file => path.basename(file) === 'TempDeskPortalHost-' + version + '-portable.exe');
    if (!portable || !fs.statSync(portable).size) throw new Error('The portable portal host was not produced.');
    console.log(portable + ' SHA-256 ' + hash(fs.readFileSync(portable)));
  } finally {
    if (path.dirname(stage) === stagingRoot) fs.rmSync(stage, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
