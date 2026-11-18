'use strict';

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

async function launch() {
  const root = path.resolve(__dirname, '..');
  const app = path.join(root, 'deployer', 'app');
  const directory = path.join(root, 'deployer', 'bin', 'win-unpacked');
  const executable = path.join(directory, 'TempDeskDeployer.exe');
  const localRequire = createRequire(path.join(app, 'package.json'));
  const asar = localRequire('@electron/asar');
  const archive = path.join(directory, 'resources', 'app.asar');
  const metadata = JSON.parse(asar.extractFile(archive, 'src/vendor/build-info.json').toString('utf8'));
  const readGit = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const head = readGit('rev-parse', 'HEAD');
  if (metadata.commit !== head || readGit('status', '--porcelain', '--untracked-files=all')) {
    throw new Error('Build and run requires a clean checkout matching the packaged commit.');
  }
  if (!fs.statSync(executable).isFile()) throw new Error('The packaged executable is missing.');
  const child = spawn(executable, [], { cwd: directory, detached: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  child.unref();
  console.log('Started ' + executable + ' from ' + head);
}

launch().catch(error => { console.error(error.message); process.exitCode = 1; });
