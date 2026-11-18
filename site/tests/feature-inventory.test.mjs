import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { inventorySummary, surfaceTotals, validateInventory } from '../feature-inventory.mjs';

const expectedFeatures = `
job-experience-document-label language funny-emoji personal-vocabulary vocabulary-drop-apply
school-mode narration action-sound-effects scheduled-settings display-name
adhd-modes dim-sum dim-sum-photo-source material-design workflow-navigation
motion live-charts update-coming-soon appearance-editor color-picker
logo-customization overlay-panels collapse-filters accessibility-sizing functional-ui
onboarding-wizard extension-support tabs regex-search command-palette
context-menus menu-shortcuts rich-controls guided-forms info-icon-guidance
settings-explanations blank-editors super-confirmation element-locks support-tickets
unlock-ladder authenticator qr-pairing honest-monetization local-history
exports bulk-actions changelog offline-docs rendered-provider-text
notifications file-converter base64-tools quicktype-studio virtual-disk-manager
minecraft-server-manager minecraft-world-generator ollama-suite external-editor download-handoff
forge-publishing progress-recovery drawesome-drawing completeness-parity front-provenance
product-evidence screen-recording design-reference-parity design-folder layout-verification-matrix
public-screenshot-gallery landing-site mobile-website installer-download-button feature-articles
vendored-fonts shared-link-embed homepage-link vocabulary-unlock-boundary documentation-companion
status-hub discord-status-bridge panic-webhooks tidbyt-displays build-entrypoints
fresh-build-run-command dependency-fetcher bundled-dependencies squirrel-installer self-signing
auto-updates app-icon release-workflow release-timing release-line-counts
release-dim-sum-photo dim-sum-code-names ci-bootstrap runner-selection encrypted-public-builder
tabbed-readme human-time-estimate sanitized-instruction-copy agents-md-vocabulary-block vocabulary-hash-lock
roadmap-checklist feature-docs postman-collections published-documentation-wiki handoff-record
closeout-prompt discussion-records project-board operational-skill readme-prompt-banner
portable-maintainer-instructions project-profile roblox-model-catalogue roblox-visual-realism
`.trim().split(/\s+/);
const expectedSurfaces = ['deployer', 'management', 'guest', 'kiosk', 'hosted', 'offline', 'delivery'];
const source = new URL('../../docs/feature-inventory.json', import.meta.url);
const inventory = JSON.parse(await readFile(source, 'utf8'));

test('required feature identities and all seven surfaces are accounted for', () => {
  assert.deepEqual(inventory.surfaces.map(surface => surface.id), expectedSurfaces);
  assert.equal(new Set(expectedFeatures).size, 119);
  validateInventory(inventory, expectedFeatures);
  for (const { counts } of surfaceTotals(inventory)) {
    assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), expectedFeatures.length);
  }
});

test('an omitted identity or duplicate identity fails validation', () => {
  const missing = structuredClone(inventory);
  missing.features = missing.features.filter(feature => feature.id !== 'language');
  assert.throws(() => validateInventory(missing, expectedFeatures), /feature set/);
  const duplicate = structuredClone(inventory);
  duplicate.features.push(duplicate.features[0]);
  assert.throws(() => validateInventory(duplicate, expectedFeatures), /duplicate feature ID/);
});

test('source-only work cannot be listed as operationally verified', () => {
  const claimed = structuredClone(inventory);
  const row = claimed.features.find(feature => feature.id === 'homepage-link');
  row.progress.hosted.method = 'source';
  assert.throws(() => validateInventory(claimed), /operational evidence/);
});

test('every scope exclusion has a stated reason and its own zero count', () => {
  const bad = structuredClone(inventory);
  bad.scopes.gameAsset.outside = '';
  assert.throws(() => validateInventory(bad), /missing scope explanation/);
  const totals = surfaceTotals(inventory);
  assert.ok(totals.every(surface => surface.counts.inapplicable > 0));
});

test('the documentation summary renders all surfaces in both article languages', () => {
  const english = inventorySummary(inventory, 'en');
  const cantonese = inventorySummary(inventory, 'zh-HK');
  assert.equal(english.split('\n').length, expectedSurfaces.length + 2);
  assert.equal(cantonese.split('\n').length, expectedSurfaces.length + 2);
  assert.match(english, /Public website and tools/);
  assert.match(cantonese, /離線文件閱讀器/);
});
