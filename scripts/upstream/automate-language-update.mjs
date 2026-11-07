import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { rpmLock, runtimes } from '../runtime/config.mjs';
import { architectures, attestedPredicates, compareVersions, issuer, latestStableRelease, previewReleaseTag,
  repository, stablePlan } from '../release/stable-policy.mjs';
import { mirrorHosts, registryDigest, stableMirror } from '../release/stable-registry.mjs';
import { checkState, lockFile, stableFile, updateStage, verifyProposedLocks, versionsFile } from './automation-policy.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, json) => fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
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

const run = (command, args, options = {}) => execFileSync(command, args, {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 90_000,
  stdio: ['ignore', 'pipe', 'inherit'], ...options,
}).trim();
const git = (...args) => run('git', args);
const gh = (...args) => run('gh', args);
const appAPI = (endpoint, method = 'GET', body) => api(endpoint, method, body, process.env.GH_TOKEN);
const actionAPI = (endpoint, method = 'GET', body) => api(endpoint, method, body, process.env.ACTION_TOKEN);
function api(endpoint, method, body, token) {
  const args = ['api', '-H', 'X-GitHub-Api-Version: 2026-03-10', '--method', method, 'repos/' + repository + '/' + endpoint];
  return JSON.parse(run('gh', [...args, ...(body ? ['--input', '-'] : [])], {
    env: { ...process.env, GH_TOKEN: token },
    ...(body && { stdio: ['pipe', 'pipe', 'inherit'], input: JSON.stringify(body) }),
  }));
}
const sha = /^[a-f0-9]{40}$/;
const bot = process.env.UPDATE_APP_SLUG + '[bot]';
const branchPrefix = (runtime, version, stage) => 'automation/' + runtime + '-' + version + '-' + stage;
const summary = message => fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n');
const commitJSON = (commit, file) => JSON.parse(git('show', commit + ':' + file));
const pullRows = gh('api', '--paginate', '-H', 'X-GitHub-Api-Version: 2026-03-10',
  'repos/' + repository + '/pulls?state=all&base=main&per_page=100', '--jq',
  '.[] | select(.head.ref | startswith("automation/")) | {number,state,merged_at,user:{login:.user.login},' +
    'head:{ref:.head.ref,sha:.head.sha,repo:{full_name:.head.repo.full_name}},base:{ref:.base.ref},html_url}');
const pulls = pullRows ? pullRows.split('\n').map(line => JSON.parse(line)) : [];
const owned = pr => pr.user.login === bot && pr.head.repo.full_name === repository && pr.base.ref === 'main';

function approvedCommit(prefix, base, matches) {
  for (const pr of pulls) {
    const suffix = pr.head.ref.slice(prefix.length);
    if (!owned(pr) || !pr.merged_at || !pr.head.ref.startsWith(prefix) ||
        !/^(?:-[a-f0-9]{12})?$/.test(suffix)) continue;
    const { mergeCommit } = JSON.parse(gh('pr', 'view', String(pr.number), '--repo', repository, '--json', 'mergeCommit'));
    assert.match(mergeCommit.oid, sha);
    git('merge-base', '--is-ancestor', mergeCommit.oid, base);
    if (matches(mergeCommit.oid)) return mergeCommit.oid;
  }
  return null;
}

function release(tag) {
  const result = spawnSync('gh', ['api', 'repos/' + repository + '/releases/tags/' + tag],
    { encoding: 'utf8', env: { ...process.env, GH_TOKEN: process.env.ACTION_TOKEN }, timeout: 90_000 });
  if (result.status === 0) return JSON.parse(result.stdout);
  if (!result.error && result.status > 0 && /HTTP 404/.test(result.stderr)) return null;
  throw new Error('Could not inspect release ' + tag + ': ' + (result.error?.message ?? result.stderr));
}

function verifyMain(expected) {
  assert.match(expected, sha);
  assert.equal(actionAPI('git/ref/heads/main').object.sha, expected, 'Protected main changed; refresh the candidate');
}
async function waitFor(action, description) {
  const end = Date.now() + 15 * 60 * 1000;
  do {
    const result = action();
    if (result) return result;
    await setTimeout(20_000);
  } while (Date.now() < end);
  throw new Error('Timed out waiting for ' + description);
}

async function submit(base, branch, title, context, changes) {
  verifyMain(base);
  const tracked = pulls.filter(pr => pr.head.ref === branch && pr.head.repo.full_name === repository);
  assert.ok(tracked.every(pr => owned(pr) && pr.state === 'open'), 'An existing update PR was closed or belongs to another author');
  assert.ok(tracked.length <= 1, 'Multiple PRs use the update branch');
  let [pr] = tracked;
  const paths = Object.keys(changes).sort();
  let head = git('ls-remote', '--heads', 'origin', 'refs/heads/' + branch).split('\t')[0];
  let issue;
  const trackUpdate = () => {
    const result = actionAPI('issues', 'POST', { title: '[Maintenance] ' + title,
      body: '## Context\n' + context + '\n\n## Acceptance criteria\n- [ ] Verify the exact locked update through all required checks.\n- [ ] Merge the qualified commit without bypassing main protection.\n\nPart of #12.',
      labels: ['type:maintenance', 'area:release', 'priority:p1', 'status:in-progress'], milestone: 4 });
    assert.ok(Number.isSafeInteger(result.number));
    summary('Tracking issue: ' + result.html_url);
    return result;
  };
  if (head) {
    assert.match(head, sha);
    git('fetch', 'origin', 'refs/heads/' + branch);
    assert.equal(git('rev-parse', 'FETCH_HEAD'), head, 'Update branch moved while resuming');
    assert.equal(git('rev-list', '--parents', '-n', '1', head), head + ' ' + base, 'Unexpected update branch parent');
    assert.deepEqual(git('diff', '--name-only', base, head).split('\n').sort(), paths, 'Unexpected update branch files');
    for (const [file, data] of Object.entries(changes)) assert.deepEqual(commitJSON(head, file), data);
    if (pr) assert.equal(pr.head.sha, head, 'Update PR head changed');
  } else {
    assert.ok(!pr, 'Update PR is missing its branch');
    issue = trackUpdate();
    git('switch', '-c', branch, base);
    for (const [file, data] of Object.entries(changes)) write(file, data);
    git('add', '--', ...paths);
    assert.deepEqual(git('diff', '--cached', '--name-only').split('\n').sort(), paths, 'Unexpected staged paths');
    git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'commit', '-m', title);
    head = git('rev-parse', 'HEAD');
    git('push', '--force-with-lease=refs/heads/' + branch + ':', 'origin', 'HEAD:refs/heads/' + branch);
  }
  if (!pr) {
    issue ??= trackUpdate();
    pr = appAPI('pulls', 'POST', { title, body: context + '\n\nCloses #' + issue.number, head: branch, base: 'main' });
  }
  assert.ok(Number.isSafeInteger(pr.number));
  summary('Update PR: ' + pr.html_url);
  function currentPR() {
    const now = JSON.parse(gh('pr', 'view', String(pr.number), '--repo', repository,
      '--json', 'state,baseRefName,headRefName,headRefOid,files,statusCheckRollup'));
    assert.equal(now.state, 'OPEN');
    assert.equal(now.baseRefName, 'main');
    assert.equal(now.headRefName, branch);
    assert.equal(now.headRefOid, head);
    assert.deepEqual(now.files.map(file => file.path).sort(), paths, 'Update PR contains unrelated files');
    return now;
  }
  await waitFor(() => checkState(currentPR().statusCheckRollup), 'required PR checks');
  assert.ok(checkState(currentPR().statusCheckRollup));
  verifyMain(base);
  const merged = appAPI('pulls/' + pr.number + '/merge', 'PUT', { sha: head, merge_method: 'squash' });
  assert.ok(merged.merged, merged.message);
  assert.match(merged.sha, sha);
  return merged.sha;
}

async function dispatch(workflow, inputs, expected) {
  verifyMain(expected);
  const job = actionAPI('actions/workflows/' + workflow + '/dispatches', 'POST',
    { ref: 'main', inputs: { ...inputs, expected_commit: expected } });
  assert.ok(Number.isSafeInteger(job.workflow_run_id));
  summary('Trusted workflow: ' + job.html_url);
  return waitFor(() => {
    const info = actionAPI('actions/runs/' + job.workflow_run_id);
    assert.equal(info.head_branch, 'main');
    assert.equal(info.head_sha, expected);
    assert.equal(info.event, 'workflow_dispatch');
    if (info.status !== 'completed') return false;
    assert.equal(info.conclusion, 'success', 'Promotion workflow failed: ' + info.html_url);
    return info;
  }, workflow);
}

const candidateDir = 'out/automated-input';
const observations = read(candidateDir + '/observations.json');
let base = git('rev-parse', 'HEAD');
assert.equal(base, process.env.GITHUB_SHA);
assert.equal(observations.commit, event.head_sha);
verifyMain(base);
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
