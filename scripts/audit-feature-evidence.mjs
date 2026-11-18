import { parseArgs } from 'node:util';
import { auditCoverage } from './feature-coverage.mjs';
import { readInventory } from '../site/feature-inventory.mjs';

try {
  const { values } = parseArgs({
    options: {
      surface: { type: 'string' },
      source: { type: 'string' },
      'artifact-sha256': { type: 'string' },
    },
  });
  const repository = new URL('../', import.meta.url);
  const inventory = await readInventory(repository);
  const audit = await auditCoverage(inventory, repository, values.surface, {
    sourceCommit: values.source,
    artifactSha256: values['artifact-sha256'],
  });
  process.stdout.write(JSON.stringify(audit, null, 2) + '\n');
  if (!audit.complete) process.exitCode = 1;
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 2;
}
