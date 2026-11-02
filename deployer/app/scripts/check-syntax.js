// Parse-checks every JavaScript file of the desktop app (node --check), including the bundled
// shared modules. Exit code 1 on any syntax error.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules') continue;
    // Minified third-party builds copied from the website (site/assets/vendor) are not our source.
    if (e.name === 'vendor' && path.basename(d) === 'vendor') continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(c|m)?js$/.test(e.name)) files.push(p);
  }
})(path.join(APP, 'src'));
['scripts', 'test'].forEach((d) => fs.readdirSync(path.join(APP, d)).filter((f) => f.endsWith('.js')).forEach((f) => files.push(path.join(APP, d, f))));
let bad = 0;
// ES modules (import/export at top level) are checked as modules; classic scripts as CommonJS.
const ESM = /(^|[;}\s])(import\s*[{*\w][^(]*?from\s*['"]|export\s*(\{|default|const|let|var|function|class|async))/m;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const args = ESM.test(src) || f.endsWith('.mjs') ? ['--input-type=module', '--check'] : ['--check', f];
  try { execFileSync(process.execPath, args, { stdio: ['pipe', 'pipe', 'pipe'], input: ESM.test(src) || f.endsWith('.mjs') ? src : undefined }); } catch (e) { bad++; process.stdout.write(f + '\n' + String(e.stderr || e.message)); }
}
console.log('Checked ' + files.length + ' JavaScript files, ' + bad + ' with errors.');
process.exit(bad ? 1 : 0);
