import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = /^[a-f\d]{64}$/;
const revision = /^[a-f\d]{40}$/;
const pathPattern = /^(?:[\w.-]+\/)*[\w.-]+$/;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');
const isText = value => typeof value === 'string' && value.trim().length > 0;

export function isSourcePath(path) {
  return typeof path === 'string' && pathPattern.test(path)
    && path.split('/').every(segment => segment !== '.' && segment !== '..');
}

export async function readSource(repository, path) {
  if (!isSourcePath(path)) throw new Error('Invalid relative source path: ' + path);
  const root = await realpath(fileURLToPath(repository));
  const source = await realpath(new URL(path, repository));
  const within = relative(root, source);
  if (!within || within === '..' || within.startsWith('..' + sep) || isAbsolute(within)) {
    throw new Error('Source path escaped the repository: ' + path);
  }
  return readFile(source);
}

export async function readCaptureReceipts(repository, groups, candidate) {
  if (!revision.test(candidate?.sourceCommit ?? '') || !sha.test(candidate?.artifactSha256 ?? '')) {
    throw new Error('A candidate source revision and artifact SHA-256 are required');
  }

  const results = [];
  const paths = new Set();
  for (const { manifest, records } of groups) {
    const receipt = JSON.parse(await readSource(repository, manifest));
    if ((receipt.version ?? receipt.schemaVersion ?? (manifest.endsWith('/offline-reader-inventory.json') ? 1 : null)) !== 1 || !Array.isArray(receipt.records)
        || receipt.records.length !== records.length) {
      throw new Error('Receipt inventory changed: ' + manifest);
    }
    for (const id of records) {
      const matches = receipt.records.filter(record => record.id === id);
      if (matches.length !== 1) throw new Error('Missing or duplicate capture: ' + manifest + '#' + id);
      const [record] = matches;
      const identity = manifest + '#' + id;
      if (!revision.test(record.sourceCommit ?? '') || !sha.test(record.artifactSha256 ?? '')
          || !sha.test(record.captureSha256 ?? '') || !sha.test(record.interactionReceiptSha256 ?? '')
          || ![record.screen, record.state, record.theme, record.interactionProofId].every(isText)
          || ![record.viewportWidth, record.viewportHeight, record.scale].every(size => Number.isFinite(size) && size > 0)
          || record.inspectionStatus !== 'inspected' || typeof record.active !== 'boolean'
          || !isSourcePath(record.path) || !record.path.startsWith('docs/evidence/')
          || paths.has(record.path)) {
        throw new Error('Incomplete or duplicate capture receipt: ' + identity);
      }
      paths.add(record.path);
      const image = await readSource(repository, record.path);
      if (!image.subarray(0, 8).equals(pngSignature)
          || createHash('sha256').update(image).digest('hex') !== record.captureSha256) {
        throw new Error('Capture format or digest mismatch: ' + record.path);
      }
      const matchesCandidate = record.active && candidate.sourceCommit === record.sourceCommit
        && candidate.artifactSha256 === record.artifactSha256;
      results.push({
        identity,
        path: record.path,
        sourceCommit: record.sourceCommit,
        artifactSha256: record.artifactSha256,
        classification: matchesCandidate ? 'candidate-match' : 'historical',
      });
    }
  }
  return results;
}
