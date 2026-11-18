'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { Arch, Platform, build: packageDesktop } = require('electron-builder');
const appPackage = require('../package.json');

function sourceRevision(cwd) {
  const gitOptions = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
    const modified = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], gitOptions).trim();
    return { commit, modified };
  } catch {
    return { commit: null, modified: null };
  }
}

async function main() {
  const root = path.resolve(__dirname, '../../..');
  const version = process.env.TEMPDESK_VERSION ?? appPackage.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a three-part documentation version');
  const source = sourceRevision(root);
  if (process.env.GITHUB_SHA && (source.commit !== process.env.GITHUB_SHA || source.modified !== false)) {
    throw new Error('Release documentation requires the exact workflow source with no local changes');
  }

  const bundle = path.join(root, '.bundle');
  await fs.mkdir(bundle, { recursive: true });
  const staging = await fs.mkdtemp(path.join(bundle, 'docs-companion-'));
  try {
    const { build } = await import(pathToFileURL(path.join(root, 'site', 'build.mjs')).href);
    const website = path.join(staging, 'website');
    await build({ outputDirectory: website });
    const index = JSON.parse(await fs.readFile(path.join(website, 'search-index.json'), 'utf8'));
    const pages = new Set(index.pages.map(page => page.url));
    for (const url of ['docs/index.html', 'docs/virtual-commons.html', 'docs/wiki-pending-home.html']) {
      if (!pages.has(url)) throw new Error('The bundled document index is missing ' + url);
    }
    const info = { version, ...source, builtUtc: new Date().toISOString() };
    await fs.writeFile(path.join(website, 'build-info.json'), JSON.stringify(info) + '\n');
    await fs.copyFile(path.join(root, 'deployer', 'docs-companion', 'main.cjs'), path.join(staging, 'main.cjs'));
    await fs.writeFile(path.join(staging, 'package.json'), JSON.stringify({
      name: 'tempdesk-docs', productName: 'TempDesk Docs', version, main: 'main.cjs',
      description: 'Offline documentation for TempDesk', author: appPackage.author, license: appPackage.license,
    }));

    const output = path.join(root, 'deployer', 'bin', 'docs');
    await packageDesktop({
      projectDir: staging,
      targets: Platform.WINDOWS.createTarget(['portable'], Arch.x64),
      publish: 'never',
      config: {
        appId: 'org.tempdesk.docs',
        executableName: 'TempDeskDocs',
        electronVersion: appPackage.devDependencies.electron,
        npmRebuild: false,
        directories: { output },
        files: ['main.cjs', 'package.json'],
        extraResources: [{ from: website, to: 'website' }],
        win: { icon: path.join(root, 'deployer', 'assets', 'tempdesk.ico'), forceCodeSigning: false },
        portable: { artifactName: 'TempDeskDocs-${version}-portable.exe' },
        publish: null,
      },
    });
    const artifact = path.join(output, 'TempDeskDocs-' + version + '-portable.exe');
    if (!(await fs.stat(artifact)).size) throw new Error('The portable documentation executable is empty');
    const revision = source.commit ?? 'an unversioned source export';
    console.log('Built TempDesk Docs ' + version + ' from ' + revision + (source.modified ? ' with local changes' : ''));
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
