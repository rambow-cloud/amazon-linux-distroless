import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { runtimes } from '../runtime/config.mjs';
import { attestedPredicates, issuer, repository, stablePlan } from '../release/stable-policy.mjs';
import { checkState, verifyProposedLocks, versionsFile } from './automation-policy.mjs';

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
const summary = message => fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, message + '\n');
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
  assert.equal(git('ls-remote', '--heads', 'origin', 'refs/heads/' + branch), '', 'Candidate branch already exists; investigate its issue');
  const issue = actionAPI('issues', 'POST', { title: '[Maintenance] ' + title,
    body: '## Context\n' + context + '\n\n## Acceptance criteria\n- [ ] Verify the exact locked update through all required checks.\n- [ ] Merge the qualified commit without bypassing main protection.\n\nPart of #12.',
    labels: ['type:maintenance', 'area:release', 'priority:p1', 'status:in-progress'], milestone: 4 });
  assert.ok(Number.isSafeInteger(issue.number));
  summary('Tracking issue: ' + issue.html_url);
  git('switch', '-c', branch, base);
  for (const [path, data] of Object.entries(changes)) write(path, data);
  const paths = Object.keys(changes).sort();
  git('add', '--', ...paths);
  assert.deepEqual(git('diff', '--cached', '--name-only').split('\n').sort(), paths, 'Unexpected staged paths');
  git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit', '-m', title);
  const head = git('rev-parse', 'HEAD');
  git('push', '--force-with-lease=refs/heads/' + branch + ':', 'origin', 'HEAD:refs/heads/' + branch);
  const pr = appAPI('pulls', 'POST', { title, body: context + '\n\nCloses #' + issue.number, head: branch, base: 'main' });
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
    { ref: 'main', inputs, return_run_details: true });
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
const changes = read(candidateDir + '/lock-diffs.json');
const base = git('rev-parse', 'HEAD');
assert.equal(base, observations.commit);
assert.equal(base, changes.sourceCommit);
assert.equal(base, event.head_sha);
const runtime = Object.keys(runtimes).find(name => Object.hasOwn(changes.diffs, name));
assert.ok(runtime, 'No verified language candidate');
const row = observations.results[runtime];
const locks = verifyProposedLocks(runtime, runtimes[runtime], row, changes.diffs[runtime], read,
  file => read(candidateDir + '/candidate/' + file));
const versions = read(versionsFile);
assert.equal(read(candidateDir + '/candidate/' + versionsFile)[runtime], row.candidate);
const previous = read('releases/stable-candidates.json')[runtime];
assert.equal(previous.version, row.locked, 'The previous locked runtime has not reached stable');
assert.equal(git('remote', 'get-url', 'origin').replace(/\.git$/, ''), 'https://github.com/' + repository);
gh('auth', 'setup-git');
const prefix = 'automation/' + runtime + '-' + row.candidate;
const next = await submit(base, prefix + '-lock', 'Update ' + runtime + ' to ' + row.candidate,
  'The official ' + row.source + ' index announced a newer release in the same supported line. Verified source and architecture locks are attached to the discovery run: ' + event.html_url,
  { [versionsFile]: { ...versions, [runtime]: row.candidate }, ...locks });
const preview = await dispatch('runtime-publish.yml', { runtime }, next);
const previewTag = runtime + '-' + next.slice(0, 12);
const path = 'out/automation-preview';
gh('release', 'download', previewTag, '--repo', repository, '--dir', path, '--pattern', 'published.json');
const published = read(path + '/published.json');
assert.equal(published.sourceCommit, next);
assert.equal(published.runUrl, preview.html_url);
const candidate = { version: row.candidate, revision: 1, sourceCommit: next, previewTag,
  reference: published.reference, maxImageMiB: previous.maxImageMiB };
const plan = stablePlan(runtime, candidate);
assert.equal(published.certificateIdentity, plan.previewIdentity);
const proof = run('cosign', ['verify-attestation', '--type', plan.previewPredicate, '--certificate-identity',
  plan.previewIdentity, '--certificate-oidc-issuer', issuer, plan.reference]);
assert.ok(attestedPredicates(proof, plan.previewPredicate, plan.digest).some(record =>
  record.reference === plan.reference && record.sourceCommit === next && record.runUrl === preview.html_url));
git('fetch', 'origin', 'main');
assert.equal(git('rev-parse', 'origin/main'), next);
git('switch', '--detach', next);
const stableFile = 'releases/stable-candidates.json';
const stable = read(stableFile);
assert.deepEqual(stable[runtime], previous);
const promoted = await submit(next, prefix + '-stable', 'Promote ' + runtime + ' ' + row.candidate + ' to stable',
  'The trusted preview qualified the signed index ' + plan.reference + '. Release evidence: ' + published.releaseUrl,
  { [stableFile]: { ...stable, [runtime]: candidate } });
await dispatch('runtime-stable.yml', { runtime, mode: 'publish' }, promoted);
summary('Promoted ' + plan.channel + ' at ' + plan.channelReference);
