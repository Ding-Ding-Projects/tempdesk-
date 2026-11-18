'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');

const root = path.resolve(__dirname, '..');
const app = path.join(root, 'deployer/app');
const requireApp = createRequire(path.join(app, 'package.json'));
const { Arch, Platform, build } = requireApp('electron-builder');
const pkg = requireApp('./package.json');
const gitOptions = { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
const git = (...args) => execFileSync('git', args, gitOptions).trim();
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function main() {
  const revision = git('rev-parse', 'HEAD');
  const version = process.env.TEMPDESK_VERSION || pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[0-9a-f]{40}$/.test(revision)) throw new Error('Invalid build identity.');
  if (git('status', '--porcelain', '--untracked-files=all') || (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== revision)) {
    throw new Error('Package the build companion from a clean checkout at the selected revision.');
  }
  const base = path.join(root, '.bundle');
  fs.mkdirSync(base, { recursive: true });
  const stage = fs.mkdtempSync(path.join(base, 'build-companion-'));
  try {
    const pack = path.join(stage, 'source.pack');
    // Enumerate this tree and its commit only. No history, remotes, configuration
    // or data from the working directory belongs in a portable source package.
    const objects = git('rev-list', '--objects', '--no-object-names', revision + '^{tree}');
    const fd = fs.openSync(pack, 'wx');
    try {
      execFileSync('git', ['pack-objects', '--stdout'], { cwd: root, input: revision + '\n' + objects + '\n', stdio: ['pipe', fd, 'inherit'] });
    } finally { fs.closeSync(fd); }
    const pin = JSON.parse(fs.readFileSync(path.join(root, 'deployer/build-companion/git-tool.json'), 'utf8'));
    const tools = path.join(root, '.tools');
    fs.mkdirSync(tools, { recursive: true });
    const gitZip = path.join(tools, pin.file);
    if (!fs.existsSync(gitZip) || digest(gitZip) !== pin.sha256) {
      const response = await fetch(pin.url, { signal: AbortSignal.timeout(180000) });
      if (!response.ok) throw new Error('Portable Git acquisition failed: ' + response.status);
      const download = path.join(stage, pin.file);
      fs.writeFileSync(download, Buffer.from(await response.arrayBuffer()));
      if (digest(download) !== pin.sha256) throw new Error('Portable Git checksum mismatch.');
      fs.copyFileSync(download, gitZip);
    }
    fs.copyFileSync(gitZip, path.join(stage, 'git.zip'));
    if (digest(path.join(stage, 'git.zip')) !== pin.sha256) throw new Error('Staged Git checksum mismatch.');
    fs.writeFileSync(path.join(stage, 'source.json'), JSON.stringify({ revision, version, packHash: digest(pack), gitHash: pin.sha256 }));
    for (const file of ['main.cjs','preload.cjs','index.html','ui.js','ui.css','en.json','zh-HK.json']) {
      fs.copyFileSync(path.join(root, 'deployer/build-companion', file), path.join(stage, file));
    }
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name:'tempdesk-build', version, main:'main.cjs', description:'Build TempDesk from its bundled source', author:pkg.author, license:pkg.license }));
    const files = await build({
      projectDir:stage, targets:Platform.WINDOWS.createTarget(['portable'], Arch.x64), publish:'never',
      config:{
        appId:'org.tempdesk.build', productName:'TempDesk Build', executableName:'TempDeskBuild',
        electronVersion:pkg.devDependencies.electron, npmRebuild:false, directories:{ output:path.join(root,'deployer/bin/build-companion') },
        files:['*.cjs','index.html','ui.js','ui.css','source.json','en.json','zh-HK.json','package.json'],
        extraResources:[{ from:pack,to:'source.pack' },{ from:path.join(stage,'git.zip'),to:'git.zip' }],
        win:{ icon:path.join(root,'deployer/assets/tempdesk.ico'), forceCodeSigning:false },
        portable:{ artifactName:'TempDeskBuild-${version}-portable.exe' }, publish:null,
      },
    });
    const executable = files.find(file => path.basename(file) === 'TempDeskBuild-' + version + '-portable.exe');
    if (!executable || !fs.statSync(executable).size) throw new Error('Portable build companion was not produced.');
    console.log(executable + ' SHA-256 ' + digest(executable));
  } finally { fs.rmSync(stage, { recursive:true, force:true }); }
}
main().catch(error => { console.error(error.message); process.exitCode=1; });
