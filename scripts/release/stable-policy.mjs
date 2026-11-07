import assert from 'node:assert/strict';
import { configuration } from '../runtime/config.mjs';
import { validateReports } from './java21-policy.mjs';
import { validateRuntimeReports } from './runtime-policy.mjs';

export const repository = 'rambow-cloud/amazon-linux-distroless';
export const issuer = 'https://token.actions.githubusercontent.com';
export const architectures = ['amd64', 'arm64'];
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const identity = workflow => 'https://github.com/' + repository + '/.github/workflows/' + workflow + '@refs/heads/main';
export const stableIdentity = identity('runtime-stable.yml');
export const stablePredicate = 'https://rambow-cloud.github.io/amazon-linux-distroless/runtime-stable/v1';

export function stablePlan(runtime, candidate) {
  assert.match(candidate.version, versionPattern, 'Expected an exact release version');
  assert.ok(Number.isSafeInteger(candidate.revision) && candidate.revision >= 1, 'Invalid stable revision');
  assert.ok(Number.isSafeInteger(candidate.maxImageMiB) && candidate.maxImageMiB > 0, 'Invalid image size ceiling');
  assert.match(candidate.sourceCommit, /^[a-f0-9]{40}$/);
  assert.equal(candidate.previewTag, runtime + '-' + candidate.sourceCommit.slice(0, 12));
  const major = /^java(17|21|25)$/.exec(runtime)?.[1];
  const config = major ? { version: major, variant: 'java' } : configuration(runtime);
  assert.ok(candidate.version.startsWith(config.version + '.'), 'Candidate crosses the version line');
  const base = 'ghcr.io/' + repository + '/' + runtime;
  const [image, digest, ...extra] = candidate.reference.split('@');
  assert.equal(image, base, 'Candidate belongs to a different registry package');
  assert.match(digest, digestPattern);
  assert.equal(extra.length, 0);
  const tag = candidate.version + '-r' + candidate.revision;
  const channelBase = 'ghcr.io/' + repository + '/' + config.variant;
  return {
    ...candidate,
    runtime,
    variant: config.variant,
    line: config.version,
    base,
    digest,
    immutable: base + ':' + tag,
    alias: base + ':' + config.version,
    channelBase,
    channel: channelBase + ':' + config.version,
    channelReference: channelBase + '@' + digest,
    releaseTag: runtime + '-' + tag,
    previewIdentity: identity(major ? 'java21-publish.yml' : 'runtime-publish.yml'),
    previewPredicate: 'https://rambow-cloud.github.io/amazon-linux-distroless/' + runtime + '-qualified-build/v1',
  };
}

export function verifyNativeEvidence(plan, records, provenance) {
  if (plan.variant === 'java') validateReports(records, plan.sourceCommit, Number(plan.runtime.slice(4)));
  else validateRuntimeReports(records, plan.sourceCommit, plan.runtime);
  assert.deepEqual(Object.keys(provenance.leaves).sort(), architectures);
  for (const arch of architectures) {
    const report = records[arch];
    const signed = provenance.verification[arch];
    assert.match(provenance.leaves[arch], digestPattern);
    assert.equal(report.sample[plan.variant === 'nodejs' ? 'node' : plan.variant], plan.version, 'Native version differs');
    if (plan.variant !== 'java') assert.equal(report.upstream?.version, plan.version, 'Expected upstream release evidence');
    assert.ok(Number.isSafeInteger(report.image.size) && report.image.size > 0 &&
      report.image.size <= plan.maxImageMiB * 1048576, 'Runtime exceeds its stable size ceiling');
    assert.equal(report.image.id, signed.image);
    for (const field of ['checks', 'sample', 'runtimeModules', 'nativeFixture', 'upstream']) {
      // Early Java attestations bind the complete report through the signed
      // evidence manifest and omit the inline sample projection.
      if (field === 'sample' && plan.variant === 'java' && !Object.hasOwn(signed, field)) continue;
      assert.deepEqual(report[field], signed[field], 'Native report differs from signed provenance: ' + field);
    }
  }
}

export function attestedPredicates(output, predicateType, digest) {
  const envelopes = output.trim().split('\n').flatMap(line => JSON.parse(line));
  const predicates = envelopes.map(envelope => JSON.parse(Buffer.from(envelope.payload, 'base64').toString('utf8')))
    .filter(statement => (!predicateType || statement.predicateType === predicateType) &&
      statement.subject?.some(subject => 'sha256:' + subject.digest?.sha256 === digest))
    .map(statement => statement.predicate);
  assert.ok(predicates.length, 'Verified attestation has no matching subject and predicate');
  return predicates;
}

export function checksumManifest(text) {
  const entries = new Map();
  for (const line of text.trimEnd().split('\n')) {
    const match = /^([a-f0-9]{64})  ([a-zA-Z0-9_.-]+)$/.exec(line);
    assert.ok(match && !entries.has(match[2]), 'Invalid or duplicate evidence checksum');
    entries.set(match[2], 'sha256:' + match[1]);
  }
  return entries;
}

export function compareVersions(left, right) {
  assert.match(left, versionPattern);
  assert.match(right, versionPattern);
  const a = left.split('.').map(BigInt);
  const b = right.split('.').map(BigInt);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

export function compareStableReleases(left, right) {
  for (const record of [left, right]) {
    assert.ok(Number.isSafeInteger(record.revision) && record.revision >= 1, 'Invalid stable revision');
  }
  const order = compareVersions(left.version, right.version) || Math.sign(left.revision - right.revision);
  if (order === 0) assert.equal(left.reference, right.reference, 'Conflicting digests for the same release');
  return order;
}

export function latestStableRelease(records) {
  assert.ok(records.length, 'No published version lines');
  return records.reduce((best, record) => compareStableReleases(record, best) > 0 ? record : best);
}

export function verifyAdvance(plan, previous) {
  if (!previous) {
    assert.equal(plan.revision, 1, 'First stable release must use revision 1');
    return;
  }
  assert.equal(previous.runtime, plan.runtime);
  assert.equal(previous.alias, plan.alias);
  assert.ok(Number.isSafeInteger(previous.revision) && previous.revision >= 1);
  const order = compareVersions(plan.version, previous.version);
  assert.ok(order >= 0, 'Stable version rollback is blocked');
  const unchanged = previous.reference === plan.reference;
  if (unchanged) {
    assert.ok(order === 0 && plan.revision === previous.revision, 'The current digest already has a stable revision');
  } else {
    assert.equal(plan.revision, order === 0 ? previous.revision + 1 : 1, 'Unexpected stable revision');
  }
}
