#!/usr/bin/env node
// Rebuilds site/assets/vendor/codemirror.js from the pinned npm packages (dev dependencies).
//   cd site && npm ci && node build-vendor.mjs
// The output is committed, so building and serving the site needs no network and no npm.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, 'vendor-src', 'codemirror-entry.mjs')],
  outfile: path.join(here, 'assets', 'vendor', 'codemirror.js'),
  bundle: true, format: 'esm', minify: true, target: ['es2020'], legalComments: 'eof',
  banner: { js: '// CodeMirror 6 (MIT licence, https://codemirror.net), bundled with esbuild by site/build-vendor.mjs. Do not edit.' },
});
console.log('Wrote assets/vendor/codemirror.js');
