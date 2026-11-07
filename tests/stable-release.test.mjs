import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { attestedPredicates, checksumManifest, latestStableRelease, stablePlan, verifyAdvance, verifyNativeEvidence } from '../scripts/release/stable-policy.mjs';
import { stableMirror, verifyPublicStableMirrors } from '../scripts/release/stable-registry.mjs';

const candidates = JSON.parse(fs.readFileSync(new URL('../releases/stable-candidates.json', import.meta.url)));
const candidate = candidates.nodejs26;
const plan = stablePlan('nodejs26', candidate);

test('approved candidates bind the exact preview commit, registry digest and version line', () => {
  for (const [runtime, candidate] of Object.entries(candidates)) stablePlan(runtime, candidate);
  assert.throws(() => stablePlan('nodejs26', { ...candidate, version: '24.22.2' }), /crosses/);
  assert.throws(() => stablePlan('nodejs26', { ...candidate, reference: candidate.reference.replace('/nodejs26@', '/nodejs24@') }), /different registry/);
  assert.throws(() => stablePlan('nodejs26', { ...candidate, previewTag: 'nodejs26-preview' }));
  const retry = candidate.previewTag + '-run12345';
  assert.equal(stablePlan('nodejs26', { ...candidate, previewTag: retry }).previewTag, retry);
  assert.throws(() => stablePlan('nodejs26', { ...candidate, previewTag: retry.replace(candidate.sourceCommit.slice(0, 12), '0'.repeat(12)) }));
});

test('project mirror evidence rejects drift at Quay after GHCR has succeeded', () => {
  const record = { runtime: plan.runtime, reference: plan.reference, alias: plan.alias, releaseTag: plan.releaseTag,
    version: plan.version, revision: plan.revision, sourceCommit: plan.sourceCommit,
    leaves: { amd64: 'sha256:' + '1'.repeat(64), arm64: 'sha256:' + '2'.repeat(64) } };
  const statement = { subject: [{ digest: { sha256: plan.digest.slice(7) } }],
    predicateType: 'https://rambow-cloud.github.io/amazon-linux-distroless/runtime-stable/v1', predicate: record };
  const execute = (command, args) => {
    if (command === 'docker') return JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json',
      manifests: Object.entries(record.leaves).map(([arch, digest]) => ({ digest, platform: { os: 'linux', architecture: arch } })) });
    return args[0] === 'verify-attestation'
      ? JSON.stringify({ payload: Buffer.from(JSON.stringify(statement)).toString('base64') }) : '';
  };
  const options = { digest: () => plan.digest, execute };
  assert.deepEqual(verifyPublicStableMirrors(plan, options).record, record);
  const stale = stableMirror('quay.io', plan).tags[0];
  assert.throws(() => verifyPublicStableMirrors(plan, { ...options,
    digest: tag => tag === stale ? 'sha256:' + '3'.repeat(64) : plan.digest }), /Unexpected digest for quay\.io/);
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

test('stable channels use shared language packages and keep existing revision references', () => {
  for (const [id, family, line] of [
    ['java21', 'java', '21'], ['python314', 'python', '3.14'], ['nodejs22', 'nodejs', '22'],
  ]) {
    const plan = stablePlan(id, candidates[id]);
    const base = 'ghcr.io/rambow-cloud/amazon-linux-distroless/';
    assert.equal(plan.channel, base + family + ':' + line);
    assert.equal(plan.channelReference, base + family + '@' + plan.digest);
    assert.equal(plan.alias, base + id + ':' + line);
    assert.equal(plan.immutable, base + id + ':' + plan.version + '-r' + plan.revision);
  }
});

test('latest follows the highest published version, then its highest revision', () => {
  const low = { version: '3.9.99', revision: 5, reference: 'low' };
  const high = { version: '3.10.1', revision: 1, reference: 'high' };
  const rebuilt = { ...high, revision: 2, reference: 'rebuilt' };
  assert.equal(latestStableRelease([rebuilt, high, low]), rebuilt);
  assert.equal(latestStableRelease([low, high]), high);
  assert.equal(latestStableRelease([low]), low);
  assert.throws(() => latestStableRelease([high, { ...high, reference: 'collision' }]), /Conflicting digests/);
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

test('legacy Java evidence still requires the native version and checks', () => {
  const plan = stablePlan('java21', candidates.java21);
  const records = Object.fromEntries(['amd64', 'arm64'].map(arch => [arch, {
    sourceCommit: plan.sourceCommit,
    javaMajor: 21,
    platform: 'linux/' + arch,
    image: { id: 'sha256:' + '1'.repeat(64), size: 1, config: { User: '65532:65532', Entrypoint: ['/usr/bin/java'] } },
    sample: { java: plan.version, compilerAbsent: true },
    networkProbes: { tls: { tlsRejected: false }, hostname: { tlsRejected: true }, untrusted: { tlsRejected: true } },
    runtimeModules: ['java.base'],
    checks: ['SIGTERM shutdown hook/143'],
  }]));
  const provenance = {
    leaves: { amd64: 'sha256:' + '2'.repeat(64), arm64: 'sha256:' + '3'.repeat(64) },
    verification: Object.fromEntries(Object.entries(records).map(([arch, r]) => [arch, {
      image: r.image.id, checks: r.checks, runtimeModules: r.runtimeModules,
    }])),
  };
  assert.doesNotThrow(() => verifyNativeEvidence(plan, records, provenance));
  records.amd64.sample.java = '21.0.1';
  assert.throws(() => verifyNativeEvidence(plan, records, provenance), /Native version differs/);
});
