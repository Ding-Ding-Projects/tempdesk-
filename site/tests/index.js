// Entry point so that `node --test site/tests/` works: Node 22 treats a directory argument as a
// module path and loads this file, which loads every *.test.mjs file next to it.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
for (const f of fs.readdirSync(__dirname).filter((n) => n.endsWith('.test.mjs')).sort()) {
  import(pathToFileURL(path.join(__dirname, f)).href);
}
