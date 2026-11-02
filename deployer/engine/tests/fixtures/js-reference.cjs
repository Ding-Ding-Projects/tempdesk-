// Prints the shared JavaScript generator's output for the fixtures as JSON, for the parity test.
'use strict';
const path = require('path');
const fs = require('fs');
const A = require(path.join(__dirname, '..', '..', '..', '..', 'site', 'assets', 'answer.js'));
const forms = JSON.parse(fs.readFileSync(path.join(__dirname, 'forms.json'), 'utf8'));
const out = {};
for (const [name, form] of Object.entries(forms)) {
  if (name === 'commands') continue;
  const mode = name.startsWith('server') ? 'server' : name;
  const model = A.defaultModel();
  model.mode = mode;
  model[mode] = Object.assign({}, model[mode], form);
  const commands = mode === 'custom' ? forms.commands : null;
  if (commands) model.commands = commands;
  out[name] = { mode, form: model[mode], commands, xml: A.buildXml(model), firstboot: mode === 'server' ? A.buildFirstboot(model.server) : null };
}
process.stdout.write(JSON.stringify(out));
