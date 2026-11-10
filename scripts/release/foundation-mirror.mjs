import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { compareStableReleases, repository } from './stable-policy.mjs';
import { mirrorHosts, registryDigest } from './stable-registry.mjs';
import {
  currentFoundation, foundationIdentity, foundationMirror, foundationPredicate, publishedFoundation,
  signedPredicates, verifyFoundationMirror,
} from './refresh-baseline.mjs';
import { quayLogin } from './quay-oidc.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.equal(process.env.GITHUB_REPOSITORY, repository);
if (process.env.EXPECTED_COMMIT) assert.equal(process.env.GITHUB_SHA, process.env.EXPECTED_COMMIT);
const registry = process.env.FOUNDATION_MIRROR_REGISTRY;
assert.ok(['both', 'ghcr', 'quay'].includes(registry));
const hosts = registry === 'both' ? mirrorHosts : [registry + '.io'];
const run = (command, args, options = {}) =>
  execFileSync(command, args, { timeout: 180_000, stdio: 'inherit', ...options });

function ghcrPackageExists(runtime) {
  const response = spawnSync('gh', ['api', 'orgs/rambow-cloud/packages/container/' + runtime],
    { encoding: 'utf8', timeout: 90_000 });
  if (response.status === 0) return true;
  if (response.status > 0 && /HTTP 404/.test(response.stderr)) return false;
  throw response.error ?? new Error(response.stderr);
}

const current = tag => registryDigest(tag, { allowMissing: true });
function inspectTags(image, destination, tags, exists = true) {
  const [fixed, ...rolling] = tags.map(tag => [tag, exists ? current(tag) : null]);
  assert.ok(fixed[1] === null || fixed[1] === image.digest, 'Immutable foundation tag collision: ' + fixed[0]);
  for (const [tag, digest] of rolling) {
    if (!digest || digest === image.digest) continue;
    const previous = signedPredicates(destination + '@' + digest, foundationPredicate, foundationIdentity)
      .map(record => record.images?.[image.runtime])
      .find(row => row?.reference === image.base + '@' + digest && row.alias === image.alias);
    assert.ok(previous && compareStableReleases(image, previous) > 0, 'Foundation rollback blocked: ' + tag);
  }
  return [fixed, ...rolling];
}

function publishTags(tags, reference, digest) {
  for (const [tag, before] of tags) {
    if (before === digest) continue;
    assert.equal(current(tag), before, 'Foundation tag changed during publication: ' + tag);
    run('docker', ['buildx', 'imagetools', 'create', '--tag', tag, reference]);
    assert.equal(registryDigest(tag), digest, 'Foundation tag digest differs: ' + tag);
  }
}

const releaseTag = process.env.FOUNDATION_RELEASE_TAG;
const record = releaseTag ? publishedFoundation(releaseTag) : currentFoundation();
assert.ok(record, 'Expected a published signed foundation release: ' + releaseTag);
fs.mkdirSync(process.env.DOCKER_CONFIG, { recursive: true });
if (hosts.includes('ghcr.io')) {
  run('docker', ['login', 'ghcr.io', '--username', process.env.GITHUB_ACTOR, '--password-stdin'],
    { input: process.env.GH_TOKEN, stdio: ['pipe', 'pipe', 'inherit'] });
}
if (hosts.includes('quay.io')) await quayLogin('foundation-release.yml');

const images = Object.values(record.images);
if (releaseTag) {
  const compatibility = images.map(image => {
    verifyFoundationMirror(image.reference, image, record);
    return { image, tags: inspectTags(image, image.base, [image.immutable, image.alias]) };
  });
  for (const { image, tags } of compatibility) {
    if (hosts.includes('ghcr.io')) publishTags(tags, image.reference, image.digest);
    else assert.ok(tags.every(([, digest]) => digest === image.digest), 'Repair the compatibility GHCR tags first');
  }
}

const summary = ['# Foundation mirrors', '', record.releaseUrl, ''];
for (const image of images) {
  for (const host of hosts) {
    const mirror = foundationMirror(host, image);
    const exists = host !== 'ghcr.io' || ghcrPackageExists(image.runtime);
    const tags = inspectTags(image, mirror.destination, mirror.tags, exists);
    run('oras', ['cp', '--recursive', '--concurrency', '1', '--to-registry-config',
      process.env.DOCKER_CONFIG + '/config.json', image.reference, mirror.destination]);
    verifyFoundationMirror(mirror.reference, image, record);
    publishTags(tags, mirror.reference, image.digest);
    summary.push('- `' + mirror.tags[2] + '` and `' + mirror.tags[3] + '` → `' + mirror.reference + '`');
  }
}
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary.join('\n') + '\n');
