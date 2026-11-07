import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { architectures, compareVersions } from '../release/stable-policy.mjs';
import { snapshot, validateRef } from './discovery-lib.mjs';

export const refreshFile = 'releases/al2023-refresh.json';
export const families = ['foundation', 'java17', 'java21', 'java25', 'python', 'nodejs'];
export const refreshGate = 'Full native runtime matrix and reproducibility gate';
export const specPath = family => 'images/' + (family.startsWith('java') ? family : 'upstream') + '/packages.json';
export const lockPath = (family, arch) => family === 'python' || family === 'nodejs'
  ? 'locks/upstream/' + family + '-linux-' + arch + '.json' : 'locks/' + family + '/linux-' + arch + '.json';

export function newerSnapshot(current, candidate) {
  validateRef(current.builder);
  validateRef(candidate.builder);
  const [oldSeries, oldDate] = snapshot(current.releasever);
  const [nextSeries, nextDate] = snapshot(candidate.releasever);
  const order = nextSeries - oldSeries || nextDate - oldDate;
  return order > 0 || order === 0 && candidate.builder !== current.builder;
}

export function verifyRefresh(plan, current, artifact, foundationRevision) {
  const before = current(lockPath('foundation', 'amd64'));
  assert.ok(newerSnapshot(before, plan), 'AL2023 refresh is unchanged or older');
  assert.equal(plan.rehearse, false);
  assert.equal(plan.eligible, true);
  assert.ok(Number.isSafeInteger(foundationRevision) && foundationRevision > 0 && foundationRevision <= 999999);
  const changes = {};
  const reports = [];
  for (const family of families) {
    const spec = specPath(family);
    const expected = { ...current(spec), releasever: plan.releasever, builder_tag: plan.builder };
    for (const arch of architectures) {
      const lock = lockPath(family, arch);
      const old = current(lock);
      const read = file => artifact(family, arch, file);
      const next = read(lock);
      assert.equal(old.builder, before.builder, 'Current locks use different builders');
      assert.equal(old.releasever, before.releasever, 'Current locks use different repository snapshots');
      assert.equal(next.builder, plan.builder);
      assert.equal(next.releasever, plan.releasever);
      assert.equal(next.platform, 'linux/' + arch);
      assert.deepEqual(read(spec), expected);
      assert.deepEqual(Object.keys(next.variants).sort(), Object.keys(old.variants).sort());
      for (const [name, group] of Object.entries(next.variants)) {
        assert.deepEqual(group.roots, old.variants[name].roots);
        assert.ok(group.packages.length);
      }
      const report = read('changes.json');
      assert.deepEqual(report.plan, plan);
      assert.deepEqual([report.family, report.arch, report.lock], [family, arch, lock]);
      reports.push(report);
      changes[spec] = expected;
      changes[lock] = next;
    }
  }
  for (const [file, data] of Object.entries(changes)) {
    if (isDeepStrictEqual(data, current(file))) delete changes[file];
  }
  changes[refreshFile] = { builder: plan.builder, releasever: plan.releasever, foundationRevision };
  return { changes, reports };
}

export function nextStableCandidate(previous, preview) {
  const order = compareVersions(preview.version, previous.version);
  assert.ok(order >= 0, 'The refreshed runtime is older than stable');
  if (preview.reference === previous.reference) {
    assert.equal(order, 0, 'A changed runtime version must have a new image');
    return previous;
  }
  return { ...preview, revision: order === 0 ? previous.revision + 1 : 1, maxImageMiB: previous.maxImageMiB };
}

export function foundationTag({ releasever, foundationRevision }) {
  snapshot(releasever);
  assert.ok(Number.isSafeInteger(foundationRevision) && foundationRevision > 0 && foundationRevision <= 999999);
  return 'foundation-' + releasever + '-r' + foundationRevision;
}
