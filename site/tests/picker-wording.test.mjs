import assert from 'node:assert/strict';
import test from 'node:test';

import withEditionProductName from '../../portal/app/static/js/picker-wording.js';
import wording from '../../portal/app/static/js/wording.js';

test('wording limits count Unicode code points', () => {
  const sample = '🌿';
  const file = (key, value) => JSON.stringify({ schemaVersion: 1, entries: { [key]: value } });
  assert.equal(wording.validate(file(sample.repeat(160), sample.repeat(1000))).size, 1);
  assert.throws(() => wording.validate(file(sample.repeat(161), 'x')), {code: 'keyLength'});
  assert.throws(() => wording.validate(file('x', sample.repeat(1001))), {code: 'valueLength'});
});

const editions = ['Windows Server with GUI', 'Windows Server without GUI'];

test('edition labels use the full product name from a local wording file', () => {
  const entries = wording.validate(JSON.stringify({ schemaVersion: 1, entries: { 'Microsoft Windows': 'Lab OS' } }));
  const translate = wording.buildTranslator(withEditionProductName(entries));
  assert.deepEqual(editions.map(translate), ['Lab OS Server with GUI', 'Lab OS Server without GUI']);
  assert.equal(translate('有圖形介面嘅 Windows Server'), '有圖形介面嘅 Lab OS Server');
  assert.equal(entries.has('Windows'), false);
});

test('specific imported edition or short name takes precedence over the product fallback', () => {
  const entries = new Map([
    ['microsoft windows', 'Product wording'],
    ['windows', 'Short wording'],
    ['Windows Server with GUI', 'Desktop session'],
  ]);
  const translate = wording.buildTranslator(withEditionProductName(entries));
  assert.deepEqual(editions.map(translate), ['Desktop session', 'Short wording Server without GUI']);
});

test('a file without a matching product name leaves both edition labels intact', () => {
  const translate = wording.buildTranslator(withEditionProductName(new Map([['Microsoft', 'Example company']])));
  assert.deepEqual(editions.map(translate), editions);
});
