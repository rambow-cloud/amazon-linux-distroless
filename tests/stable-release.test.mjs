import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { attestedPredicates, checksumManifest, stablePlan, verifyAdvance } from '../scripts/release/stable-policy.mjs';

const candidates = JSON.parse(fs.readFileSync(new URL('../releases/stable-candidates.json', import.meta.url)));
const candidate = candidates.nodejs26;
const plan = stablePlan('nodejs26', candidate);

test('approved candidates bind the exact preview commit, registry digest and version line', () => {
  for (const [runtime, candidate] of Object.entries(candidates)) stablePlan(runtime, candidate);
  assert.throws(() => stablePlan('nodejs26', { ...candidate, version: '24.22.2' }), /crosses/);
  assert.throws(() => stablePlan('nodejs26', { ...candidate, reference: candidate.reference.replace('/nodejs26@', '/nodejs24@') }), /different registry/);
  assert.throws(() => stablePlan('nodejs26', { ...candidate, previewTag: 'nodejs26-preview' }));
});

test('stable aliases advance by version and revision with safe replay', () => {
  const old = { ...plan, version: '26.12.9', reference: plan.base + '@sha256:' + '1'.repeat(64) };
  assert.doesNotThrow(() => verifyAdvance(plan));
  assert.doesNotThrow(() => verifyAdvance(plan, old));
  assert.doesNotThrow(() => verifyAdvance(plan, plan));
  assert.throws(() => verifyAdvance({ ...old, revision: 2 }, plan), /rollback/);
  assert.throws(() => verifyAdvance({ ...plan, revision: 2 }, plan), /already/);
  assert.throws(() => verifyAdvance({ ...plan, reference: old.reference, revision: 3 }, plan), /revision/);
  assert.doesNotThrow(() => verifyAdvance({ ...plan, reference: old.reference, revision: 2 }, plan));
});

test('signed evidence must name the selected digest and each asset exactly once', () => {
  const statement = { subject: [{ digest: { sha256: plan.digest.slice(7) } }],
    predicateType: plan.previewPredicate, predicate: { sourceCommit: plan.sourceCommit } };
  const envelope = JSON.stringify({ payload: Buffer.from(JSON.stringify(statement)).toString('base64') });
  assert.deepEqual(attestedPredicates(envelope, plan.previewPredicate, plan.digest), [statement.predicate]);
  assert.throws(() => attestedPredicates(envelope, plan.previewPredicate, 'sha256:' + '1'.repeat(64)), /matching subject/);
  const line = 'a'.repeat(64) + '  file.json';
  assert.equal(checksumManifest(line + '\n').size, 1);
  assert.throws(() => checksumManifest(line + '\n' + line), /duplicate/);
  assert.throws(() => checksumManifest(line.replace('file.json', '../file.json')), /Invalid/);
});
