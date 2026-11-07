import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkState, requiredChecks, updateStage, verifyProposedLocks } from '../scripts/upstream/automation-policy.mjs';

test('an interrupted update resumes at the first unfinished protected stage without a new upstream candidate', () => {
  const base = { locked: '22.1.1', planned: '22.1.0' };
  assert.equal(updateStage({ ...base, lockApproved: true }), 'preview');
  assert.equal(updateStage({ ...base, candidate: true }), null);
  const approved = { ...base, planned: base.locked, stableApproved: true };
  assert.equal(updateStage(approved), 'publish');
  assert.equal(updateStage({ ...approved, published: true }), 'publish');
  assert.equal(updateStage({ ...approved, published: true, originCurrent: true }), 'mirror');
  const complete = { ...approved, published: true, originCurrent: true, mirrorsCurrent: true };
  assert.equal(updateStage(complete), null);
  assert.equal(updateStage({ ...complete, candidate: true }), 'lock');
});

test('all protected checks must exist and succeed before automatic merge', () => {
  const ready = requiredChecks.map(name => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' }));
  assert.equal(checkState(ready), true);
  assert.equal(checkState(ready.slice(1)), false);
  assert.equal(checkState([...ready, ready[0]]), false);
  assert.throws(() => checkState([...ready.slice(1), { ...ready[0], conclusion: 'CANCELLED' }]), /Required check failed/);
});

test('a release proposal cannot replace one architecture or use an unrelated source', () => {
  const config = { variant: 'nodejs', version: '22', upstreamVersion: '22.1.0' };
  const observed = { locked: '22.1.0', candidate: '22.1.1' };
  const old = { version: observed.locked };
  const next = { version: observed.candidate, sha256: '1'.repeat(64), sourceSha256: '2'.repeat(64),
    url: 'https://nodejs.org/dist/v22.1.1/node-v22.1.1-linux-x64.tar.xz',
    sourceUrl: 'https://nodejs.org/dist/v22.1.1/node-v22.1.1.tar.xz', signature: { type: 'openpgp' } };
  const arm = { ...next, url: next.url.replace('-x64', '-arm64') };
  const choose = file => file.includes('arm64') ? arm : next;
  const diff = { amd64: { old, candidate: next }, arm64: { old, candidate: arm } };
  assert.equal(Object.keys(verifyProposedLocks('nodejs22', config, observed, diff, () => old, choose)).length, 2);
  assert.throws(() => verifyProposedLocks('nodejs22', config, observed, diff, () => old, () => next));
  const untrusted = { ...next, sourceUrl: next.sourceUrl.replace('nodejs.org', 'example.org') };
  assert.throws(() => verifyProposedLocks('nodejs22', config, observed,
    { ...diff, amd64: { old, candidate: untrusted } }, () => old, file => file.includes('arm64') ? arm : untrusted));
});
