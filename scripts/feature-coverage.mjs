import { isSourcePath, readCaptureReceipts, readSource } from './feature-evidence.mjs';

const proofFields = ['implementation', 'documentation', 'localization', 'persistence', 'focusedCheck', 'interaction', 'captures'];

export const coverageFeatureIds = [
  'completeness-parity', 'front-provenance', 'product-evidence', 'screen-recording',
  'design-reference-parity', 'design-folder', 'layout-verification-matrix', 'public-screenshot-gallery',
];

const isText = value => typeof value === 'string' && value.trim().length > 0;

export function validateCoverage(inventory) {
  const expected = new Set(inventory.surfaces.map(surface => surface.id));
  for (const id of coverageFeatureIds) {
    const feature = inventory.features.find(row => row.id === id);
    const rows = feature?.coverage;
    if (!rows || Object.keys(rows).length !== expected.size || [...expected].some(surface => !Object.hasOwn(rows, surface))) {
      throw new Error('Feature inventory: missing or unknown coverage surface for ' + id);
    }

    for (const [surface, row] of Object.entries(rows)) {
      const applicable = inventory.scopes[feature.scope].appliesTo.includes(surface);
      const label = id + ' on ' + surface;
      if (row.applicable !== applicable || !isText(row.remaining)) {
        throw new Error('Feature inventory: incomplete applicability or gap statement for ' + label);
      }
      if (!applicable) continue;
      for (const field of proofFields) {
        const path = row[field];
        if (path !== null && !isSourcePath(path)) {
          throw new Error('Feature inventory: missing or invalid ' + field + ' for ' + label);
        }
      }
    }
  }

  if (!Array.isArray(inventory.captureReceipts) || !inventory.captureReceipts.length) {
    throw new Error('Feature inventory: capture receipt inventory is required');
  }
  const manifests = new Set();
  for (const { manifest, records, surfaces } of inventory.captureReceipts) {
    if (!isSourcePath(manifest) || !manifest.startsWith('docs/evidence/') || manifests.has(manifest)
        || !Array.isArray(records) || !records.length || !records.every(isText)
        || new Set(records).size !== records.length || !Array.isArray(surfaces) || !surfaces.length
        || new Set(surfaces).size !== surfaces.length || surfaces.some(surface => !expected.has(surface))) {
      throw new Error('Feature inventory: invalid capture receipt group for ' + manifest);
    }
    manifests.add(manifest);
  }
}

export async function auditCoverage(inventory, repository, surface, candidate) {
  if (!inventory.surfaces.some(item => item.id === surface)) throw new Error('Unknown surface: ' + surface);
  validateCoverage(inventory);
  const captures = await readCaptureReceipts(repository, inventory.captureReceipts, candidate);

  const results = [];
  for (const feature of inventory.features.filter(item => coverageFeatureIds.includes(item.id))) {
    const row = feature.coverage[surface];
    if (!row.applicable) {
      results.push({ feature: feature.id, state: 'inapplicable', reason: row.remaining });
      continue;
    }
    const missing = proofFields.filter(field => row[field] === null);
    for (const field of proofFields) {
      if (row[field] !== null) await readSource(repository, row[field]);
    }
    if (row.captures !== null) {
      const groups = inventory.captureReceipts.filter(group => group.manifest === row.captures
        && group.surfaces.includes(surface));
      if (!groups.some(group => captures.some(capture => capture.identity.startsWith(group.manifest + '#')
        && capture.classification === 'candidate-match'))) {
        missing.push('candidate capture binding');
      }
    }
    if (row.interaction !== null && (missing.includes('candidate capture binding') || row.captures !== row.interaction)) {
      missing.push('candidate interaction binding');
    }
    const state = missing.length ? 'incomplete' : 'evidence-linked';
    results.push({ feature: feature.id, state, missing, remaining: row.remaining });
  }
  return { surface, candidate, complete: !results.some(row => row.state === 'incomplete'), results, captures };
}
