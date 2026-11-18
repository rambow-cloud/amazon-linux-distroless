import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sha256File } from './file-digest.mjs';
import { verifyDatabaseAge } from './vulnerability-policy.mjs';
import { architectures } from './stable-policy.mjs';

const files = plan => ['security.json', ...architectures.flatMap(arch => [
  'scan-' + arch + '.json', ...(plan.variant === 'java' ? [] : ['upstream-scan-' + arch + '.json']),
])];

export function stableScanHashes(directory, plan) {
  return Object.fromEntries(files(plan).map(file => [file, 'sha256:' + sha256File(directory + '/' + file)]));
}

export function reuseStableScan(directory, output, plan, identity, now = Date.now()) {
  const read = file => JSON.parse(fs.readFileSync(directory + '/' + file, 'utf8'));
  const evidence = read('preflight.json');
  assert.deepEqual(evidence.identity, identity, 'Stable scan is from a different run or candidate');
  const checked = Date.parse(evidence.checkedAt);
  assert.ok(checked <= now && now - checked < 4 * 60 * 60_000, 'Stable scan preflight expired');
  const hashes = stableScanHashes(directory, plan);
  assert.deepEqual(evidence.scanHashes, hashes, 'Stable scan files differ from preflight');
  const security = read('security.json');
  verifyDatabaseAge('ALAS', security.alas.database.metadata.UpdatedAt, now);
  if (plan.variant !== 'java') verifyDatabaseAge('Grype', security.upstream.database.built, now);
  for (const scanner of plan.variant === 'java' ? [security.alas] : [security.alas, security.upstream]) {
    for (const arch of architectures) {
      for (const exception of scanner.scans[arch].stableGate.appliedExceptions) {
        assert.ok(Date.parse(exception.expires) > now, 'Stable scan exception expired: ' + exception.id);
      }
    }
  }
  for (const file of files(plan)) fs.copyFileSync(directory + '/' + file, output + '/' + file);
  return hashes;
}
