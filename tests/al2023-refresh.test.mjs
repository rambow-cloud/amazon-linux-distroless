import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { difference } from '../scripts/release/refresh-diff.mjs';
import { families, foundationTag, lockPath, newerSnapshot, nextStableCandidate, refreshFile, specPath,
  verifyRefresh } from '../scripts/upstream/al2023-refresh-policy.mjs';

const ref = digit => 'public.ecr.aws/amazonlinux/amazonlinux@sha256:' + digit.repeat(64);
const old = { builder: ref('a'), releasever: '2023.12.20261102' };
const next = { builder: ref('b'), releasever: '2023.12.20261109' };

test('AL2023 discovery accepts a newer snapshot or same-snapshot digest, and rejects repeats and rollbacks', () => {
  assert.ok(newerSnapshot(old, next));
  assert.ok(newerSnapshot(old, { ...next, builder: old.builder }));
  assert.ok(newerSnapshot(old, { ...old, builder: next.builder }));
  assert.equal(newerSnapshot(next, next), false);
  assert.equal(newerSnapshot(next, old), false);
});

test('a refresh changes only the complete native lock set and its four package specs', () => {
  const plan = { ...next, rehearse: false, eligible: true };
  const read = file => JSON.parse(fs.readFileSync(file));
  const current = file => file.startsWith('locks/') ? { ...read(file), ...old } : read(file);
  const artifact = (family, arch, file) => {
    if (file === 'changes.json') return { plan, family, arch, lock: lockPath(family, arch) };
    if (file === specPath(family)) return { ...current(file), builder_tag: next.builder, releasever: next.releasever };
    return { ...current(file), ...next };
  };
  const { changes, reports } = verifyRefresh(plan, current, artifact, 1);
  assert.deepEqual(Object.keys(changes).sort(), [...new Set(families.flatMap(family =>
    [specPath(family), lockPath(family, 'amd64'), lockPath(family, 'arm64')]).concat(refreshFile))].sort());
  assert.equal(reports.length, 12);
  assert.equal(foundationTag(changes[refreshFile]), 'foundation-2023.12.20261109-r1');
  assert.throws(() => verifyRefresh({ ...plan, rehearse: true }, current, artifact, 1));
  assert.throws(() => verifyRefresh(plan, current, (family, arch, file) => {
    const data = artifact(family, arch, file);
    return file === lockPath('java25', 'arm64') ? { ...data, platform: 'linux/amd64' } : data;
  }, 1));
});

test('a same-patch rebuild advances the revision, a new patch resets it, and rollback preserves the prior digest', () => {
  const previous = { version: '22.23.4', revision: 3, maxImageMiB: 100, reference: 'previous' };
  const refreshed = { version: previous.version, reference: 'candidate' };
  assert.equal(nextStableCandidate(previous, refreshed).revision, 4);
  assert.equal(nextStableCandidate(previous, { ...refreshed, version: '22.23.5' }).revision, 1);
  assert.equal(nextStableCandidate(previous, { ...refreshed, reference: previous.reference }), previous);
  assert.throws(() => nextStableCandidate(previous, { ...refreshed, version: '22.23.3' }), /older than stable/);
  assert.equal(previous.reference, 'previous');
});

test('proposal evidence retains changed RPM versions and licenses, added packages and cleared advisories', () => {
  const before = { name: 'glibc', version: '1', licenses: ['LGPL-2.1-or-later'] };
  const updated = { ...before, version: '2', licenses: ['LGPL-2.1-or-later', 'MIT'] };
  const added = { name: 'libx', version: '1', licenses: ['MIT'] };
  assert.deepEqual(difference([before], [updated, added], x => x.name), [
    { before, after: updated }, { before: null, after: added },
  ]);
  const advisory = { id: 'ALAS2023-example', package: 'glibc' };
  assert.deepEqual(difference([advisory], [], x => x.id), [{ before: advisory, after: null }]);
});
