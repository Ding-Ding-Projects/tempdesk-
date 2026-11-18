import { readFile } from 'node:fs/promises';
import { validateCoverage } from '../scripts/feature-coverage.mjs';
import { requiredFeatureIds } from '../scripts/required-feature-identities.mjs';

export const inventoryPath = 'docs/feature-inventory.json';

const keyPattern = /^[a-z][a-z0-9-]*$/;
const revisionPattern = /^[a-f0-9]{40}$/;
const evidenceMethods = new Set(['source', 'runtime', 'release', 'deployment']);
const requiredSurfaces = ['deployer', 'management', 'guest', 'kiosk', 'hosted', 'offline', 'delivery'];
const statusOrder = ['verified', 'partial', 'pending', 'inapplicable'];

function require(condition, description) {
  if (!condition) throw new Error('Feature inventory: ' + description);
}

function text(value) {
  return typeof value === 'string' && value.trim() !== '';
}

export function validateInventory(inventory, expectedFeatures = requiredFeatureIds) {
  require(inventory?.schemaVersion === 1, 'unsupported schema version');
  require(Array.isArray(inventory.surfaces), 'surfaces are required');
  require(inventory.scopes && typeof inventory.scopes === 'object', 'scopes are required');
  require(Array.isArray(inventory.features), 'feature records are required');

  const surfaceIds = new Set();
  for (const surface of inventory.surfaces) {
    require(keyPattern.test(surface.id) && !surfaceIds.has(surface.id), 'invalid or duplicate surface ID');
    require(text(surface.title) && text(surface.titleZh), 'missing surface names for ' + surface.id);
    surfaceIds.add(surface.id);
  }
  require(requiredSurfaces.length === surfaceIds.size && requiredSurfaces.every(surface => surfaceIds.has(surface)),
    'the surface set does not match the supported product surfaces');

  for (const [id, scope] of Object.entries(inventory.scopes)) {
    require(Array.isArray(scope.appliesTo), 'missing applicability for ' + id);
    require(new Set(scope.appliesTo).size === scope.appliesTo.length, 'duplicate applicability for ' + id);
    require(scope.appliesTo.every(surface => surfaceIds.has(surface)), 'unknown surface in ' + id);
    if (scope.appliesTo.length < surfaceIds.size) require(text(scope.outside), 'missing scope explanation for ' + id);
  }

  const featureIds = new Set();
  for (const feature of inventory.features) {
    require(keyPattern.test(feature.id) && !featureIds.has(feature.id), 'invalid or duplicate feature ID');
    featureIds.add(feature.id);
    require(Object.hasOwn(inventory.scopes, feature.scope), 'unknown scope for ' + feature.id);
    const scope = inventory.scopes[feature.scope];
    for (const [surface, evidence] of Object.entries(feature.progress ?? {})) {
      const label = feature.id + ' on ' + surface;
      require(scope.appliesTo.includes(surface), 'evidence outside applicable scope for ' + label);
      require(evidence.state === 'verified' || evidence.state === 'partial', 'invalid evidence state for ' + label);
      require(evidenceMethods.has(evidence.method), 'invalid evidence method for ' + label);
      require(revisionPattern.test(evidence.revision), 'missing source revision for ' + label);
      require(text(evidence.reference) && text(evidence.observation), 'missing evidence for ' + label);
      if (evidence.state === 'partial') {
        require(text(evidence.remaining), 'missing remaining work for ' + label);
      } else {
        require(evidence.method !== 'source', 'verified status requires operational evidence for ' + label);
        require(/^\d{4}-\d{2}-\d{2}$/.test(evidence.observedOn), 'missing observation date for ' + label);
      }
    }
  }

  if (expectedFeatures) {
    const expected = new Set(expectedFeatures);
    require(expected.size === featureIds.size && [...expected].every(id => featureIds.has(id)),
      'the feature set does not match the expected catalogue');
  }
  validateCoverage(inventory);
  return inventory;
}

export async function readInventory(repository) {
  const path = new URL(inventoryPath, repository);
  return validateInventory(JSON.parse(await readFile(path, 'utf8')));
}

export function surfaceTotals(inventory) {
  return inventory.surfaces.map(surface => {
    const counts = { verified: 0, partial: 0, pending: 0, inapplicable: 0 };
    for (const feature of inventory.features) {
      if (!inventory.scopes[feature.scope].appliesTo.includes(surface.id)) {
        counts.inapplicable += 1;
        continue;
      }
      counts[feature.progress?.[surface.id]?.state ?? 'pending'] += 1;
    }
    return { ...surface, counts };
  });
}

export function inventorySummary(inventory, locale) {
  const cantonese = locale === 'zh-HK';
  const headings = cantonese
    ? ['介面', '已驗證', '部分完成', '待處理', '不適用']
    : ['Surface', 'Verified', 'Partial', 'Pending', 'Inapplicable'];
  const line = values => '| ' + values.join(' | ') + ' |';
  const rows = surfaceTotals(inventory).map(surface => line([
    cantonese ? surface.titleZh : surface.title,
    ...statusOrder.map(status => surface.counts[status]),
  ]));
  return [line(headings), line(['---', '---:', '---:', '---:', '---:']), ...rows].join('\n');
}
