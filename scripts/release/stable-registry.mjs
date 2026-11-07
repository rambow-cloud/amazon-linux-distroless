import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateIndex } from './java21-policy.mjs';
import { attestedPredicates, issuer, stableIdentity, stablePredicate } from './stable-policy.mjs';

export const mirrorHosts = ['ghcr.io', 'quay.io'];
const options = { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 90_000 };
const run = (command, args) => execFileSync(command, args, { ...options, stdio: ['ignore', 'pipe', 'inherit'] });

export function stableMirror(host, plan) {
  assert.ok(mirrorHosts.includes(host));
  const base = host + '/rambow-cloud/' + plan.variant;
  return {
    base,
    reference: base + '@' + plan.digest,
    tags: [plan.line, plan.version, plan.version + '-r' + plan.revision].map(tag => base + ':' + tag),
  };
}

export function registryDigest(reference, { allowMissing = false } = {}) {
  const result = spawnSync('docker', ['buildx', 'imagetools', 'inspect', reference], options);
  if (result.status !== 0) {
    if (!result.error && result.status > 0 && allowMissing && /not found|manifest unknown|name unknown/i.test(result.stderr)) return null;
    throw new Error('Cannot inspect ' + reference + ': ' + (result.error?.message ?? result.stderr));
  }
  const digest = /^Digest:\s*(sha256:[a-f0-9]{64})$/m.exec(result.stdout)?.[1];
  assert.ok(digest, 'Missing digest for ' + reference);
  return digest;
}

export function verifyStableRegistry(plan, { reference, tags }, { digest = registryDigest, execute = run } = {}) {
  for (const tag of tags) assert.equal(digest(tag), plan.digest, 'Unexpected digest for ' + tag);
  const verify = (verb, identity, extra = []) => execute('cosign', [verb, '--certificate-identity', identity,
    '--certificate-oidc-issuer', issuer, ...extra, reference]);
  verify('verify', plan.previewIdentity);
  const output = verify('verify-attestation', stableIdentity, ['--type', stablePredicate]);
  const record = attestedPredicates(output, stablePredicate, plan.digest).find(row =>
    row.runtime === plan.runtime && row.reference === plan.reference && row.alias === plan.alias &&
    row.releaseTag === plan.releaseTag && row.version === plan.version && row.revision === plan.revision &&
    row.sourceCommit === plan.sourceCommit);
  assert.ok(record, 'No matching stable promotion evidence: ' + reference);
  validateIndex(JSON.parse(execute('docker', ['buildx', 'imagetools', 'inspect', '--raw', reference])), record.leaves);
  return record;
}

export function verifyPublicStableMirrors(plan, options) {
  const mirrors = mirrorHosts.map(host => stableMirror(host, plan));
  const [record, ...others] = mirrors.map(mirror => verifyStableRegistry(plan, mirror, options));
  for (const other of others) assert.deepEqual(other, record, 'Public mirrors disagree: ' + plan.runtime);
  return { record, mirrors };
}
