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
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], gitOptions).trim();
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).trim();
    if (path.relative(cwd, root) !== '' || !/^[a-f0-9]{40}$/.test(commit)) throw new Error('Unexpected source identity');
    const modified = !!execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], gitOptions).trim();
    return { commit, modified };
  } catch {
    throw new Error('Build TempDesk Docs from the top of a versioned source checkout so its file inventory can be verified');
  }
}

async function snapshotSource(root, staging, source) {
  const destination = path.join(staging, 'source');
  await fs.mkdir(destination);
  if (source.modified === false) {
    const archive = path.join(staging, 'source.tar');
    execFileSync('git', ['archive', '--format=tar', '-o', archive, source.commit], { cwd: root });
    execFileSync('tar.exe', ['-xf', archive, '-C', destination]);
    return destination;
  }

  // A development build can include local changes to project files. Ignore runtime
  // state and use only regular files contained in the source directory.
  const names = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  }).split('\0').filter(Boolean);
  const canonicalRoot = await fs.realpath(root);
  for (const name of new Set(names)) {
    const input = path.join(canonicalRoot, name);
    let attributes;
    try { attributes = await fs.lstat(input); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    const relative = path.relative(canonicalRoot, await fs.realpath(input));
    if (!attributes.isFile() || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
      throw new Error('The documentation source contains a file outside the project inventory');
    }
    const target = path.join(destination, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(input, target);
  }
  return destination;
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
    const input = await snapshotSource(root, staging, source);
    const { build } = await import(pathToFileURL(path.join(input, 'site', 'build.mjs')).href);
    const website = path.join(staging, 'website');
    const info = { version, ...source, builtUtc: new Date().toISOString() };
    const { edition, docs: guideCount, features: featureCount } = await build({
      outputDirectory: website,
      referenceRevision: source.modified === false ? source.commit : 'main',
      provenance: { version, updatedUtc: info.builtUtc, revision: source.modified ? null : source.commit },
      includeDocumentEdition: true,
    });
    const index = JSON.parse(await fs.readFile(path.join(website, 'search-index.json'), 'utf8'));
    const pages = new Set(index.pages.map(page => page.url));
    for (const url of ['docs/index.html', 'docs/virtual-commons.html', 'docs/wiki-pending-home.html']) {
      if (!pages.has(url)) throw new Error('The bundled document index is missing ' + url);
    }
    const printed = new Set();
    for (const article of edition.articles) {
      if (!pages.has(article.url) || printed.has(article.url)) throw new Error('Unexpected PDF article: ' + article.url);
      printed.add(article.url);
    }
    if (printed.size !== guideCount + featureCount || !edition.articles.some(article => article.kind === 'wiki')) {
      throw new Error('The PDF must include every published article and the operator wiki');
    }
    const labels = JSON.parse(await fs.readFile(path.join(input, 'site', 'i18n', 'en.json'), 'utf8'));
    const pdf = path.join(staging, 'edition.pdf');
    const options = path.join(staging, 'print-options.json');
    const profile = path.join(staging, 'pdf-profile');
    await fs.mkdir(profile);
    await fs.writeFile(options, JSON.stringify({
      website, edition, info, labels, output: pdf,
      style: path.join(input, 'design', 'guided-documentation', 'phone-edition.css'),
    }));
    const printEnvironment = { ...process.env };
    delete printEnvironment.ELECTRON_RUN_AS_NODE;
    execFileSync(require('electron'), [path.join(input, 'deployer', 'app', 'scripts', 'print-docs-pdf.cjs'), options], {
      windowsHide: true, stdio: 'inherit', env: printEnvironment, timeout: 180000,
    });
    await fs.writeFile(path.join(website, 'build-info.json'), JSON.stringify(info) + '\n');
    await fs.copyFile(path.join(input, 'deployer', 'docs-companion', 'main.cjs'), path.join(staging, 'main.cjs'));
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
    await fs.rename(pdf, path.join(output, 'TempDeskDocs-' + version + '-phone.pdf'));
    console.log('Built TempDesk Docs ' + version + ' from ' + source.commit + (source.modified ? ' with local changes' : ''));
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
