import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { rpmLock, runtimes } from '../runtime/config.mjs';
import { architectures, attestedPredicates, compareVersions, issuer, latestStableRelease, previewReleaseTag,
  repository, stablePlan } from '../release/stable-policy.mjs';
import { mirrorHosts, registryDigest, stableMirror } from '../release/stable-registry.mjs';
import { foundationPublished } from '../release/refresh-baseline.mjs';
import { foundationTag, refreshFile } from './al2023-refresh-policy.mjs';
import { lockFile, stableFile, updateStage, verifyProposedLocks, versionsFile } from './automation-policy.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
import { protectedUpdateClient } from './protected-update.mjs';
const event = read(process.env.GITHUB_EVENT_PATH).workflow_run;
assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_run');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.equal(process.env.GITHUB_REPOSITORY, repository);
assert.equal(event.head_repository.full_name, repository);
assert.equal(event.head_branch, 'main');
assert.equal(event.conclusion, 'success');
assert.equal(event.path.split('@')[0], '.github/workflows/language-update-discovery.yml');
assert.ok(['schedule', 'workflow_dispatch'].includes(event.event));
assert.ok(process.env.GH_TOKEN && process.env.ACTION_TOKEN);
assert.match(process.env.UPDATE_APP_SLUG, /^[a-z0-9-]+$/);

const { run, git, gh, summary, commitJSON, approvedCommit, verifyMain, submit, dispatch } = protectedUpdateClient();
const sha = /^[a-f0-9]{40}$/;
const branchPrefix = (runtime, version, stage) => 'automation/' + runtime + '-' + version + '-' + stage;
function release(tag) {
  const result = spawnSync('gh', ['api', 'repos/' + repository + '/releases/tags/' + tag],
    { encoding: 'utf8', env: { ...process.env, GH_TOKEN: process.env.ACTION_TOKEN }, timeout: 90_000 });
  if (result.status === 0) return JSON.parse(result.stdout);
  if (!result.error && result.status > 0 && /HTTP 404/.test(result.stderr)) return null;
  throw new Error('Could not inspect release ' + tag + ': ' + (result.error?.message ?? result.stderr));
}

const candidateDir = 'out/automated-input';
const observations = read(candidateDir + '/observations.json');
let base = git('rev-parse', 'HEAD');
assert.equal(base, process.env.GITHUB_SHA);
assert.equal(observations.commit, event.head_sha);
verifyMain(base);
if (fs.existsSync(refreshFile) && !foundationPublished(foundationTag(read(refreshFile)))) {
  summary('The AL2023 snapshot refresh is still publishing. Defer independent language updates.');
  process.exit(0);
}
const diffFile = candidateDir + '/lock-diffs.json';
const changes = base === observations.commit && fs.existsSync(diffFile) ? read(diffFile) : null;
if (changes) assert.equal(base, changes.sourceCommit);
const plans = read(stableFile);
const hosts = mirrorHosts.filter(host => host !== 'quay.io' || process.env.QUAY_RUNTIME_MIRROR_ENABLED === 'true');
const branch = (runtime, version, stage, head) => branchPrefix(runtime, version, stage) + '-' + head.slice(0, 12);
const isCurrent = (tag, digest) => registryDigest(tag, { allowMissing: true }) === digest;
const locksAt = (commit, runtime) => architectures.map(arch => commitJSON(commit, lockFile(runtime, arch)));

function isAncestor(commit, head) {
  const { status, error } = spawnSync('git', ['merge-base', '--is-ancestor', commit, head]);
  if (error || ![0, 1].includes(status)) throw error ?? new Error('Cannot establish commit ancestry');
  return status === 0;
}

function previewCandidate(runtime, version, tag, lockCommit, previous, expectedRun) {
  const info = release(tag);
  if (!info || !info.prerelease || info.draft ||
      !info.assets.some(asset => asset.name === 'published.json' && asset.state === 'uploaded')) return null;
  const published = JSON.parse(gh('release', 'download', tag, '--repo', repository, '--pattern', 'published.json', '--output', '-'));
  assert.match(published.sourceCommit, sha);
  const { sourceCommit } = published;
  if (!isAncestor(sourceCommit, base) || !isAncestor(lockCommit, sourceCommit) ||
      !isDeepStrictEqual(locksAt(sourceCommit, runtime), locksAt(base, runtime))) return null;
  const buildPaths = ['images/upstream/Dockerfile', 'images/upstream/packages.json', 'scripts/runtime/',
    ...architectures.map(arch => rpmLock(runtimes[runtime].variant, arch))];
  if (git('diff', '--name-only', sourceCommit, base, '--', ...buildPaths)) return null;
  const candidate = { version, revision: 1, sourceCommit, previewTag: tag,
    reference: published.reference, maxImageMiB: previous.maxImageMiB };
  const plan = stablePlan(runtime, candidate);
  assert.equal(published.certificateIdentity, plan.previewIdentity);
  assert.equal(published.releaseUrl, info.html_url);
  if (expectedRun) assert.equal(published.runUrl, expectedRun.html_url);
  const proof = run('cosign', ['verify-attestation', '--type', plan.previewPredicate, '--certificate-identity',
    plan.previewIdentity, '--certificate-oidc-issuer', issuer, plan.reference]);
  const locks = locksAt(base, runtime);
  assert.ok(attestedPredicates(proof, plan.previewPredicate, plan.digest).some(record =>
    record.reference === plan.reference && record.sourceCommit === sourceCommit && record.runUrl === published.runUrl &&
    architectures.every((arch, index) => isDeepStrictEqual(record.verification[arch].upstream, locks[index]))),
  'Preview provenance does not match the committed runtime locks');
  return candidate;
}

function recoverableUpdate() {
  for (const [runtime, config] of Object.entries(runtimes)) {
    const locked = config.upstreamVersion;
    const plan = stablePlan(runtime, plans[runtime]);
    const order = compareVersions(locked, plan.version);
    assert.ok(order >= 0, 'The stable plan is newer than the committed lock');
    if (order > 0) {
      const lockCommit = approvedCommit(branchPrefix(runtime, locked, 'lock'), base, commit =>
        commitJSON(commit, versionsFile)[runtime] === locked && isDeepStrictEqual(locksAt(commit, runtime), locksAt(base, runtime)));
      const stage = updateStage({ locked, planned: plan.version, lockApproved: Boolean(lockCommit) });
      if (stage) return { runtime, version: locked, plan, stage, lockCommit };
      continue;
    }
    const approval = approvedCommit(branchPrefix(runtime, locked, 'stable'), base,
      commit => isDeepStrictEqual(commitJSON(commit, stableFile)[runtime], plans[runtime]));
    if (!approval) continue;
    const originCurrent = isCurrent(plan.alias, plan.digest);
    const published = release(plan.releaseTag);
    const latest = latestStableRelease(Object.entries(plans).map(([id, candidate]) => stablePlan(id, candidate))
      .filter(candidate => candidate.variant === plan.variant));
    const mirrorsCurrent = originCurrent && isCurrent(plan.channel, plan.digest) && hosts.every(host => {
      const mirror = stableMirror(host, plan);
      const tags = latest.runtime === runtime ? [...mirror.tags, mirror.base + ':latest'] : mirror.tags;
      return tags.every(tag => isCurrent(tag, plan.digest));
    });
    const stage = updateStage({ locked, planned: plan.version, stableApproved: true, originCurrent, mirrorsCurrent,
      published: published && !published.draft && !published.prerelease &&
        published.assets.some(asset => asset.name === 'stable.json' && asset.state === 'uploaded') });
    if (stage) return { runtime, version: locked, plan, stage };
  }
  return null;
}

let update = recoverableUpdate();
if (!update && changes) {
  const runtime = Object.keys(runtimes).find(id => Object.hasOwn(changes.diffs, id) &&
    updateStage({ locked: runtimes[id].upstreamVersion, planned: plans[id].version, candidate: true }) === 'lock');
  if (runtime) update = { runtime, version: observations.results[runtime].candidate, stage: 'lock' };
}
if (!update) {
  summary('No new or unfinished unattended language release on the current protected main.');
  process.exit(0);
}

const { runtime, version } = update;
summary('Language update stage: ' + runtime + ' ' + version + ' — ' + update.stage);
if (update.stage === 'publish' || update.stage === 'mirror') {
  const inputs = { runtime, mode: update.stage };
  if (update.stage === 'mirror' && !hosts.includes('quay.io')) inputs.registry = 'ghcr';
  await dispatch('runtime-stable.yml', inputs, base);
  process.exit(0);
}

assert.equal(git('remote', 'get-url', 'origin').replace(/\.git$/, ''), 'https://github.com/' + repository);
gh('auth', 'setup-git');
const previous = plans[runtime];
let { lockCommit } = update;
if (update.stage === 'lock') {
  const row = observations.results[runtime];
  const locks = verifyProposedLocks(runtime, runtimes[runtime], row, changes.diffs[runtime], read,
    file => read(candidateDir + '/candidate/' + file));
  const versions = read(versionsFile);
  assert.equal(read(candidateDir + '/candidate/' + versionsFile)[runtime], version);
  lockCommit = await submit(base, branch(runtime, version, 'lock', base), 'Update ' + runtime + ' to ' + version,
    'The official index announced a newer same-line release. Verified locks: ' + event.html_url,
    { [versionsFile]: { ...versions, [runtime]: version }, ...locks });
  git('fetch', 'origin', 'main');
  git('switch', '--detach', lockCommit);
  base = lockCommit;
}

const prefix = runtime + '-';
const knownPreviews = JSON.parse(gh('release', 'list', '--repo', repository, '--exclude-drafts', '--limit', '100',
  '--json', 'tagName,isPrerelease')).filter(info => info.isPrerelease && info.tagName.startsWith(prefix) &&
    /^[a-f0-9]{12}(?:-run[1-9]\d*)?$/.test(info.tagName.slice(prefix.length)));
let candidate;
for (const { tagName } of knownPreviews) {
  candidate = previewCandidate(runtime, version, tagName, lockCommit, previous);
  if (candidate) break;
}
if (!candidate) {
  const preview = await dispatch('runtime-publish.yml', { runtime, unique_preview: 'true' }, base);
  const tag = previewReleaseTag(runtime, base, String(preview.id));
  candidate = previewCandidate(runtime, version, tag, lockCommit, previous, preview);
  assert.ok(candidate, 'The completed preview did not produce a verified release');
}

const stable = read(stableFile);
assert.deepEqual(stable[runtime], previous);
const promoted = await submit(base, branch(runtime, version, 'stable', base), 'Promote ' + runtime + ' ' + version + ' to stable',
  'The trusted preview qualified the signed index ' + candidate.reference + '. Evidence: ' +
    'https://github.com/' + repository + '/releases/tag/' + candidate.previewTag,
  { [stableFile]: { ...stable, [runtime]: candidate } });
await dispatch('runtime-stable.yml', { runtime, mode: 'publish' }, promoted);
summary('Published ' + runtime + ' at ' + candidate.reference);
