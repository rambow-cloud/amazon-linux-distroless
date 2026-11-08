import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { attestedPredicates, issuer, repository } from './stable-policy.mjs';
import { mirrorHosts, registryDigest } from './stable-registry.mjs';
import { validateIndex } from './java21-policy.mjs';

const capture = (command, args) => execFileSync(command, args, {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'], timeout: 90_000,
});

const base = 'ghcr.io/' + repository;
export const foundationIdentity = 'https://github.com/' + repository + '/.github/workflows/foundation-release.yml@refs/heads/main';
export const foundationPredicate = 'https://rambow-cloud.github.io/amazon-linux-distroless/foundation-stable/v1';

export function releaseAsset(tag, name) {
  return capture('gh', ['release', 'download', tag, '--repo', repository, '--pattern', name, '--output', '-']);
}

export function publishedRelease(tag) {
  const response = spawnSync('gh', ['api', 'repos/' + repository + '/releases/tags/' + tag],
    { encoding: 'utf8', timeout: 90_000 });
  if (response.status > 0 && /HTTP 404/.test(response.stderr)) return null;
  if (response.status !== 0) throw response.error ?? new Error(response.stderr);
  const release = JSON.parse(response.stdout);
  return release.draft ? null : release;
}

export function signedPredicates(reference, type, identity) {
  const raw = capture('cosign', ['verify-attestation', '--type', type, '--certificate-identity', identity,
    '--certificate-oidc-issuer', issuer, reference]);
  return attestedPredicates(raw, type, reference.split('@')[1]);
}

export function signedFoundation(tag, record = JSON.parse(releaseAsset(tag, 'foundation-release.json'))) {
  assert.match(tag, /^foundation-2023\.\d+\.\d{8}-r[1-9]\d*$/);
  assert.equal(record.releaseTag, tag);
  assert.deepEqual(Object.keys(record.images).sort(), ['base', 'static']);
  for (const [variant, image] of Object.entries(record.images)) {
    assert.equal(image.reference, base + '/' + variant + '@' + image.digest);
    assert.equal(image.alias, base + '/' + variant + ':2023');
    assert.match(image.digest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(signedPredicates(image.reference, foundationPredicate, foundationIdentity)
      .some(signed => isDeepStrictEqual(signed, record)), 'Unverified foundation release: ' + variant);
  }
  return record;
}

export function currentFoundation() {
  const baseDigest = registryDigest(base + '/base:2023');
  const reference = base + '/base@' + baseDigest;
  const records = signedPredicates(reference, foundationPredicate, foundationIdentity)
    .filter(record => record.images?.base?.reference === reference);
  const record = records.find(record => registryDigest(base + '/static:2023') === record.images?.static?.digest);
  assert.ok(record, 'The current foundation aliases do not share a signed release');
  const published = JSON.parse(releaseAsset(record.releaseTag, 'foundation-release.json'));
  assert.deepEqual(record, published);
  return signedFoundation(record.releaseTag, record);
}

export function foundationPublished(tag) {
  const release = publishedRelease(tag);
  if (!release) return false;
  assert.ok(!release.prerelease);
  const record = signedFoundation(tag);
  return Object.values(record.images).every(image =>
    registryDigest(image.immutable) === image.digest && registryDigest(image.alias) === image.digest);
}

export function foundationMirror(host, image) {
  assert.ok(mirrorHosts.includes(host));
  assert.ok(['static', 'base'].includes(image.runtime));
  const destination = host + '/rambow-cloud/' + image.runtime;
  const tags = [image.version + '-r' + image.revision, image.version, '2023', 'latest'];
  return { destination, reference: destination + '@' + image.digest, tags: tags.map(tag => destination + ':' + tag) };
}

export function verifyFoundationMirror(reference, image, record) {
  const trust = ['--certificate-identity', foundationIdentity, '--certificate-oidc-issuer', issuer];
  validateIndex(JSON.parse(capture('docker', ['buildx', 'imagetools', 'inspect', '--raw', reference])), image.leaves);
  capture('cosign', ['verify', ...trust, reference]);
  assert.ok(signedPredicates(reference, foundationPredicate, foundationIdentity)
    .some(value => isDeepStrictEqual(value, record)), 'Foundation mirror record differs: ' + reference);
  const destination = reference.split('@')[0];
  for (const leaf of Object.values(image.leaves)) {
    signedPredicates(destination + '@' + leaf, 'cyclonedx', foundationIdentity);
  }
}

export function foundationMirrorsPublished(tag) {
  const record = signedFoundation(tag);
  return Object.values(record.images).every(image => mirrorHosts.every(host => {
    const mirror = foundationMirror(host, image);
    if (!mirror.tags.every(ref => registryDigest(ref, { allowMissing: true }) === image.digest)) return false;
    verifyFoundationMirror(mirror.reference, image, record);
    return true;
  }));
}
