import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { newerReleases } from './language-discovery-lib.mjs';
import { compareVersions } from '../release/stable-policy.mjs';

export const requiredChecks = ['Issue policy', 'Repository checks', 'Java 21 gate', 'Language runtime gate', 'Foundation gate'];
export const versionsFile = 'images/upstream/versions.json';
export const lockFile = (runtime, arch) => 'locks/upstream/' + runtime + '-' + arch + '.json';
export const stableFile = 'releases/stable-candidates.json';

export function updateStage({ locked, planned, lockApproved, stableApproved, published, originCurrent, mirrorsCurrent, candidate }) {
  const order = compareVersions(locked, planned);
  assert.ok(order >= 0, 'The stable plan is newer than the committed lock');
  if (order > 0) return lockApproved ? 'preview' : null;
  if (stableApproved) {
    if (!published || !originCurrent) return 'publish';
    if (!mirrorsCurrent) return 'mirror';
  }
  return candidate ? 'lock' : null;
}

export function verifyProposedLocks(runtime, config, observed, diff, readCurrent, readCandidate) {
  assert.equal(observed.locked, config.upstreamVersion);
  assert.deepEqual(newerReleases(config, [observed.locked, observed.candidate]), [observed.candidate]);
  const updated = {};
  for (const arch of ['amd64', 'arm64']) {
    const file = lockFile(runtime, arch);
    const before = readCurrent(file);
    const next = readCandidate(file);
    assert.ok(isDeepStrictEqual(before, diff[arch].old) && isDeepStrictEqual(next, diff[arch].candidate));
    assert.equal(before.version, observed.locked);
    assert.equal(next.version, observed.candidate);
    for (const field of ['sha256', 'sourceSha256']) assert.match(next[field], /^[a-f0-9]{64}$/);
    const origin = config.variant === 'python' ? 'https://www.python.org' : 'https://nodejs.org';
    for (const field of ['url', 'sourceUrl']) {
      assert.equal(new URL(next[field]).origin, origin);
      assert.ok(next[field].includes(observed.candidate));
    }
    assert.equal(next.signature.type, config.variant === 'python' ? 'sigstore' : 'openpgp');
    updated[file] = next;
  }
  const [amd64, arm64] = Object.values(updated);
  for (const field of ['sourceUrl', 'sourceSha256']) assert.equal(amd64[field], arm64[field]);
  if (config.variant === 'python') assert.deepEqual(amd64, arm64);
  return updated;
}

export function checkState(rollup, extraChecks = []) {
  const byName = new Map([...requiredChecks, ...extraChecks].map(name => [name, []]));
  for (const row of rollup) byName.get(row.name ?? row.context)?.push(row);
  for (const [name, rows] of byName) {
    if (rows.some(row => row.status === 'COMPLETED' && row.conclusion !== 'SUCCESS' ||
        ['FAILURE', 'ERROR'].includes(row.state))) throw new Error('Required check failed: ' + name);
  }
  return [...byName.values()].every(rows => rows.length === 1 &&
    (rows[0].status === 'COMPLETED' && rows[0].conclusion === 'SUCCESS' || rows[0].state === 'SUCCESS'));
}
