// Copies the shared modules the desktop app reuses from the website and the answer file
// generator into src/vendor/, writes build-info.json (version, commit, build UTC time), copies the
// i18n catalogs, and stages the payload (server/, agent/, client/, samba/, portal/, streaming/)
// and the docs into .bundle/ for packaging. One code path for the website and the desktop app.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const crypto = require('crypto');

const APP = path.resolve(__dirname, '..');
const REPO = path.resolve(APP, '..', '..');
const VENDOR = path.join(APP, 'src', 'vendor');
const BUNDLE = path.join(REPO, '.bundle');

function copy(src, dst, required) {
  if (!fs.existsSync(src)) { if (required) throw new Error('Missing shared module: ' + path.relative(REPO, src)); console.warn('skip (not present yet): ' + path.relative(REPO, src)); return false; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
  return true;
}
const SKIP_DIR = new Set(['__pycache__', '.pytest_cache', 'node_modules', 'bin', 'obj', 'secrets', '.venv']);
function copyTree(src, dst) {
  if (!fs.existsSync(src)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    if (/^\.env(\.|$)/.test(e.name) && e.name !== '.env.example') continue;
    if (e.name.endsWith('.pyc')) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) n += copyTree(s, d);
    else { fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); n++; }
  }
  return n;
}

function main() {
  fs.rmSync(VENDOR, { recursive: true, force: true });
  fs.mkdirSync(VENDOR, { recursive: true });
  // Shared with the website (same code path).
  // Every website asset (scripts, styles, canvases), so new shared files are picked up without
  // changing this script. Website-only page scripts are harmless: the desktop pages do not load them.
  const SITE = path.join(REPO, 'site', 'assets');
  for (const req of ['answer.js', 'base64.js', 'wording.js']) if (!fs.existsSync(path.join(SITE, req))) throw new Error('Missing shared module: site/assets/' + req);
  for (const e of fs.readdirSync(SITE, { withFileTypes: true })) {
    if (e.isDirectory() || /\.(js|css|svg)$/.test(e.name)) copy(path.join(SITE, e.name), path.join(VENDOR, e.name), false);
  }
  copy(path.join(REPO, 'site', 'i18n'), path.join(VENDOR, 'site-i18n'), false);
  // The website's answer file builder page logic, hosted unchanged in the desktop app. One line is
  // appended so the desktop extras (ISO, media folder, Git history) can read the current model.
  if (copy(path.join(REPO, 'site', 'assets', 'builder.js'), path.join(VENDOR, 'builder.js'), false)) {
    fs.appendFileSync(path.join(VENDOR, 'builder.js'), [
      '', '// Added by deployer/app/scripts/prepare-bundle.js for the desktop host (guarded: the page may rename these).',
      'window.TempDeskBuilderHost = {',
      "  getModel: () => { try { return model; } catch (e) { return null; } },",
      "  getHistory: () => { try { return history; } catch (e) { return null; } },",
      "  addDriverPath: (p) => { try { const f = model.custom; const lines = String(f.driversPE || '').split(/\\r?\\n/).filter(Boolean); if (lines.includes(p)) return 'exists'; lines.push(p); f.driversPE = lines.join('\\n'); commit({ key: 'hist.set', args: ['@f.driversPE', p] }); renderView(); return 'ok'; } catch (e) { return 'unsupported'; } },",
      "  importText: (text, name) => { try { if (typeof importFile === 'function') { importFile(new File([text], name || 'autounattend.xml', { type: 'application/xml' })); return true; } } catch (e) { /* fall through */ } return false; }",
      '};', ''].join('\n'));
  }
  // Answer File Studio page: the website's page with site.js replaced by the desktop shim.
  const pageSrc = path.join(REPO, 'site', 'answer-file.html');
  if (fs.existsSync(pageSrc)) {
    let page = fs.readFileSync(pageSrc, 'utf8');
    page = page.replace(/<script>\/\* apply saved theme[^<]*<\/script>/, '');
    page = page.replace(/<meta name="td-root" content="[^"]*">/, '<meta name="td-root" content="vendor/">');
    page = page.replace(/<link rel="(icon|canonical)"[^>]*>/g, '').replace(/<meta (property|name)="(og|twitter):[^>]*>/g, '');
    page = page.replace(/(href|src)="\.?\/?assets\//g, '$1="vendor/');
    page = page.replace('<script src="vendor/site.js"></script>', '<script src="js/site-shim.js"></script>');
    page = page.replace('<script src="vendor/history.js"></script>', '<script src="vendor/history.js"></script>\n<script src="js/history-mirror.js"></script>');
    page = page.replace('</head>', '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; connect-src \'self\'; font-src \'self\'; base-uri \'none\'; form-action \'none\'; object-src \'none\'">\n<link rel="stylesheet" href="css/builder-host.css">\n</head>');
    // Website-only chrome (top bar links to other pages) stays out of the desktop window.
    page = page.replace(/<header class="topbar">[\s\S]*?<\/header>/, '');
    fs.writeFileSync(path.join(APP, 'src', 'renderer', 'studio.html'), page);
    if (!page.includes('js/site-shim.js')) throw new Error('studio.html: could not swap site.js for the desktop shim');
  } else console.warn('skip (not present yet): site/answer-file.html');
  copy(path.join(REPO, 'answerfile', 'generate.mjs'), path.join(VENDOR, 'answerfile', 'generate.mjs'), false);
  copy(path.join(REPO, 'answerfile', 'rules.mjs'), path.join(VENDOR, 'answerfile', 'rules.mjs'), false);
  copy(path.join(REPO, 'answerfile', 'unattend-catalog.json'), path.join(VENDOR, 'answerfile', 'unattend-catalog.json'), false);
  // The canvas modules are ES modules; the classic scripts load as globals.
  fs.writeFileSync(path.join(VENDOR, 'package.json'), '{ "type": "commonjs" }\n');
  if (fs.existsSync(path.join(VENDOR, 'canvas'))) fs.writeFileSync(path.join(VENDOR, 'canvas', 'package.json'), '{ "type": "module" }\n');
  copy(path.join(REPO, 'deployer', 'i18n'), path.join(VENDOR, 'i18n'), true);
  copy(path.join(REPO, 'CHANGELOG.md'), path.join(VENDOR, 'CHANGELOG.md'), false);

  // Provenance baked at build time.
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  let commit = process.env.GITHUB_SHA || '';
  if (!commit) { try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO }).toString().trim(); } catch (e) { commit = 'unknown'; } }
  const info = { version: process.env.TEMPDESK_VERSION || pkg.version, commit: commit.slice(0, 40), builtUtc: new Date().toISOString().replace(/\.\d+Z$/, 'Z'), runNumber: process.env.GITHUB_RUN_NUMBER || '' };
  fs.writeFileSync(path.join(VENDOR, 'build-info.json'), JSON.stringify(info, null, 2) + '\n');

  // Payload and docs for packaging.
  fs.rmSync(BUNDLE, { recursive: true, force: true });
  let n = 0;
  for (const f of ['server', 'agent', 'client', 'samba', 'portal', 'streaming']) n += copyTree(path.join(REPO, f), path.join(BUNDLE, 'payload', f));
  for (const f of ['README.md', 'CHANGELOG.md', 'LICENSE']) if (fs.existsSync(path.join(REPO, f))) { fs.mkdirSync(path.join(BUNDLE, 'docs'), { recursive: true }); fs.copyFileSync(path.join(REPO, f), path.join(BUNDLE, 'docs', f)); }
  copyTree(path.join(REPO, 'docs'), path.join(BUNDLE, 'docs', 'docs'));
  for (const f of ['agent/README.md', 'samba/README.md', 'portal/README.md', 'streaming/README.md', 'server/apphost/README.md', 'deployer/FEATURES.md']) {
    const s = path.join(REPO, f);
    if (fs.existsSync(s)) { const d = path.join(BUNDLE, 'docs', f); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(s, d); }
  }
  const hash = crypto.createHash('sha256').update(JSON.stringify(info)).digest('hex').slice(0, 12);
  console.log('Bundle ready: version ' + info.version + ', commit ' + info.commit.slice(0, 12) + ', ' + n + ' payload files (' + hash + ')');
}

main();
