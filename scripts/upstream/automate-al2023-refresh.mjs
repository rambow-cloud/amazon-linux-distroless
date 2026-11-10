import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { currentFoundation, foundationMirrorsPublished, foundationPublished, publishedRelease, releaseAsset, signedPredicates } from '../release/refresh-baseline.mjs';
import { architectures, compareVersions, latestStableRelease, previewReleaseTag, repository, stablePlan } from '../release/stable-policy.mjs';
import { mirrorHosts, registryDigest, stableMirror } from '../release/stable-registry.mjs';
import { runtimes } from '../runtime/config.mjs';
import { families, foundationTag, lockPath, nextStableCandidate, refreshFile, refreshGate, specPath,
  verifyRefresh } from './al2023-refresh-policy.mjs';
import { stableFile } from './automation-policy.mjs';
import { matchesProposal } from './discovery-lib.mjs';
import { protectedUpdateClient } from './protected-update.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const event = read(process.env.GITHUB_EVENT_PATH).workflow_run;
assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_run');
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.equal(process.env.GITHUB_REPOSITORY, repository);
assert.equal(event.head_repository.full_name, repository);
assert.equal(event.head_branch, 'main');
assert.equal(event.path.split('@')[0], '.github/workflows/al2023-discovery.yml');
assert.equal(event.conclusion, 'success');
assert.ok(['schedule', 'workflow_dispatch'].includes(event.event));
assert.ok(process.env.GH_TOKEN && process.env.ACTION_TOKEN);
assert.match(process.env.UPDATE_APP_SLUG, /^[a-z0-9-]+$/);
assert.equal(process.env.QUAY_RUNTIME_MIRROR_ENABLED, 'true', 'Both public mirror registries are required');

const { run, git, gh, summary, commitJSON, approvedCommit, verifyMain, submit, start, workflowResult, waitFor,
  actionAPI } = protectedUpdateClient();
let base = git('rev-parse', 'HEAD');
assert.equal(base, process.env.GITHUB_SHA);
verifyMain(base);
assert.equal(git('remote', 'get-url', 'origin').replace(/\.git$/, ''), 'https://github.com/' + repository);
gh('auth', 'setup-git');

const plan = read('out/al2023-candidate/plan.json');
const discovery = read('out/al2023-discovery/discovery.json');
assert.equal(discovery.sourceCommit, event.head_sha);
assert.equal(plan.sourceCommit, base);
const pinnedPaths = [...new Set(families.flatMap(family =>
  [specPath(family), ...architectures.map(arch => lockPath(family, arch))]))];
const previewPaths = [...pinnedPaths, 'images/', 'locks/upstream/', 'scripts/java21/', 'scripts/runtime/',
  'scripts/release/publish.mjs', 'security/'];
const deadline = Date.now() + 49 * 60_000;
const minutesLeft = () => Math.max(1, Math.floor((deadline - Date.now()) / 60_000));
let refresh = fs.existsSync(refreshFile) ? read(refreshFile) : null;
let lockCommit;
const prefix = (state, target) => 'automation/al2023-' + target.releasever + '-' + target.builder.split('@sha256:')[1] + '-' + state;
const branch = (state, target) => prefix(state, target) + '-' + base.slice(0, 12);
const matches = (commit, file, expected) => isDeepStrictEqual(commitJSON(commit, file), expected);
const sameFiles = (first, second, files) => !git('diff', '--name-only', first, second, '--', ...files);
function adopt(commit) {
  git('fetch', 'origin', 'main');
  git('switch', '--detach', commit);
  base = commit;
  verifyMain(base);
}

function trackingIssue(target, advance = false) {
  const report = { candidate: { ref: target.builder, platform: 'linux/amd64', releasever: target.releasever } };
  const issues = JSON.parse(run('gh', ['api', '--paginate', '--slurp',
    'repos/' + repository + '/issues?state=all&per_page=100'], {
    env: { ...process.env, GH_TOKEN: process.env.ACTION_TOKEN },
  })).flat();
  const found = issues.filter(issue => matchesProposal(report, issue));
  assert.equal(found.length, 1, 'Expected one deduplicated discovery proposal for the snapshot');
  const [issue] = found;
  if (advance && issue.state === 'open') {
    const labels = issue.labels.map(label => label.name);
    assert.equal(issue.milestone?.number, 4);
    assert.ok(['type:maintenance', 'area:build', 'priority:p1'].every(label => labels.includes(label)));
    assert.ok(['status:triage', 'status:ready', 'status:in-progress'].some(label => labels.includes(label)));
    return actionAPI('issues/' + issue.number, 'PATCH', {
      labels: [...labels.filter(label => !label.startsWith('status:')), 'status:in-progress'],
    });
  }
  return issue;
}

if (refresh && !foundationPublished(foundationTag(refresh))) {
  lockCommit = approvedCommit(prefix('lock', refresh), base, commit =>
    matches(commit, refreshFile, refresh) && sameFiles(commit, base, pinnedPaths));
  assert.ok(lockCommit, 'Pending refresh lacks an exact protected lock PR');
} else if (plan.eligible && !plan.rehearse) {
  assert.equal(process.env.RESOLVE_RESULT, 'success', 'The complete native lock matrix did not resolve');
  assert.equal(event.head_sha, base, 'The discovery run is stale');
  assert.equal(plan.builder, discovery.candidate.ref);
  assert.equal(plan.releasever, discovery.candidate.releasever);
  const plans = read(stableFile);
  for (const [id, config] of Object.entries(runtimes)) {
    assert.equal(config.upstreamVersion, plans[id].version, 'Complete the pending upstream language update first');
  }
  const issue = trackingIssue(plan, true);
  if (issue.state !== 'open') {
    summary('The existing discovery proposal is closed. AL2023 refresh will not proceed.');
    process.exit(0);
  }
  const previous = currentFoundation().images.base;
  const order = compareVersions(plan.releasever, previous.version);
  assert.ok(order >= 0, 'The foundation snapshot would go backwards');
  const { changes, reports } = verifyRefresh(plan, read, (family, arch, file) =>
    read('out/al2023-refresh-input/al2023-lock-' + family + '-' + arch + '/' + file),
  order === 0 ? previous.revision + 1 : 1);
  refresh = changes[refreshFile];
  const evidence = 'https://github.com/' + repository + '/actions/runs/' + process.env.GITHUB_RUN_ID;
  const context = 'Refresh all AL2023-derived locks from the official immutable builder `' + plan.builder + '`.\n\n' +
    'The [native lock resolution](' + evidence + ') includes binary/source RPM, version and license diffs across ' +
    reports.length + ' native transactions. The project qualification check on this PR records the actual payload, ' +
    'size and ALAS differences against the signed public baseline.\n\nPart of #12.';
  lockCommit = await submit(base, branch('lock', refresh), 'Refresh AL2023 to ' + plan.releasever, context, changes, {
    issue, extraChecks: [refreshGate], minutes: minutesLeft(),
    async onQualified(pr, rollup) {
      const gate = rollup.find(check => check.name === refreshGate);
      const match = /\/actions\/runs\/(\d+)\/job\/\d+$/.exec(gate.detailsUrl);
      assert.ok(match, 'The refresh gate lacks a GitHub Actions run');
      const run = await waitFor(() => {
        const info = actionAPI('actions/runs/' + match[1]);
        assert.equal(info.path.split('@')[0], '.github/workflows/project-qualification.yml');
        assert.equal(info.event, 'pull_request');
        assert.equal(info.head_sha, pr.head.sha);
        assert.equal(info.head_repository.full_name, repository);
        if (info.status !== 'completed') return false;
        assert.equal(info.conclusion, 'success');
        return info;
      }, 'refresh qualification evidence', Math.min(3, minutesLeft()));
      summary('Signed-baseline comparison and native gate: ' + run.html_url);
      assert.equal(actionAPI('issues/' + issue.number).state, 'open', 'The refresh proposal was closed before merge');
    },
  });
  adopt(lockCommit);
} else {
  summary('No eligible or unfinished AL2023 snapshot refresh on protected main.');
  process.exit(0);
}

const isAncestor = (first, second) => {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', first, second]);
  if (result.error || ![0, 1].includes(result.status)) throw result.error ?? new Error('Cannot verify commit ancestry');
  return result.status === 0;
};
function recentRuns(workflow, title) {
  const rows = JSON.parse(gh('run', 'list', '--repo', repository, '--workflow', workflow, '--branch', 'main',
    '--commit', base, '--event', 'workflow_dispatch', '--limit', '30',
    '--json', 'databaseId,status,displayTitle,conclusion,updatedAt'));
  return rows.filter(row => row.displayTitle === title);
}
function pendingRun(workflow, title) {
  return recentRuns(workflow, title).find(row => row.status !== 'completed')?.databaseId;
}
function waitRuns(runs, name) {
  return waitFor(() => {
    const results = Object.fromEntries(Object.entries(runs).map(([key, id]) => [key, workflowResult(id, base)]));
    return Object.values(results).every(Boolean) && results;
  }, name, minutesLeft());
}

const previous = read(stableFile);
const approved = approvedCommit(prefix('stable', refresh), base, commit => matches(commit, stableFile, previous));
if (!approved) {
  const previews = JSON.parse(gh('release', 'list', '--repo', repository, '--exclude-drafts', '--limit', '100',
    '--json', 'tagName,isPrerelease')).filter(item => item.isPrerelease).map(item => item.tagName);
  function preview(runtime, tag, expectedRun) {
    const match = /^([a-f0-9]{12})(?:-run[1-9]\d*)?$/.exec(tag.slice(runtime.length + 1));
    if (!tag.startsWith(runtime + '-') || !match) return null;
    if (!ancestors.has(match[1])) return null;
    const release = publishedRelease(tag);
    if (!release?.prerelease || !release.assets.some(asset => asset.name === 'published.json' && asset.state === 'uploaded')) return null;
    const published = JSON.parse(releaseAsset(tag, 'published.json'));
    const source = published.sourceCommit;
    assert.match(source, /^[a-f0-9]{40}$/);
    if (!isAncestor(lockCommit, source) || !isAncestor(source, base) || !sameFiles(source, base, previewPaths)) return null;
    if (expectedRun) assert.equal(published.runUrl, expectedRun.html_url);
    const language = runtime.startsWith('java') ? 'java' : runtimes[runtime].variant === 'nodejs' ? 'node' : 'python';
    const version = published.verification.amd64.sample[language];
    assert.equal(published.verification.arm64.sample[language], version);
    if (language !== 'java') assert.equal(version, runtimes[runtime].upstreamVersion);
    const candidate = { version, sourceCommit: source, previewTag: tag, reference: published.reference };
    const next = nextStableCandidate(previous[runtime], candidate);
    const expected = stablePlan(runtime, { ...candidate, revision: next.revision, maxImageMiB: next.maxImageMiB });
    assert.equal(published.certificateIdentity, expected.previewIdentity);
    assert.equal(published.releaseUrl, release.html_url);
    assert.ok(signedPredicates(expected.reference, expected.previewPredicate, expected.previewIdentity).some(record =>
      record.reference === expected.reference && record.sourceCommit === source && record.runUrl === published.runUrl &&
      isDeepStrictEqual(record.verification, published.verification)), 'Unverified preview evidence: ' + runtime);
    return next;
  }
  const ancestors = new Set(git('log', '--format=%H', '--ancestry-path', lockCommit + '..' + base)
    .split('\n').filter(Boolean).concat(lockCommit).map(commit => commit.slice(0, 12)));
  const selected = {};
  const runs = {};
  for (const runtime of Object.keys(previous)) {
    const available = previews.find(tag => {
      const candidate = preview(runtime, tag);
      if (candidate) selected[runtime] = candidate;
      return Boolean(candidate);
    });
    if (available) continue;
    const java = runtime.startsWith('java');
    const workflow = java ? 'java21-publish.yml' : 'runtime-publish.yml';
    const inputs = java ? { major: runtime.slice(4) } : { runtime };
    runs[runtime] = pendingRun(workflow, 'Preview ' + runtime) ??
      start(workflow, { ...inputs, unique_preview: 'true' }, base);
  }
  for (const [runtime, run] of Object.entries(await waitRuns(runs, 'qualified runtime previews'))) {
    const tag = previewReleaseTag(runtime, base, String(run.id));
    selected[runtime] = preview(runtime, tag, run) ?? preview(runtime, previewReleaseTag(runtime, base), run);
    assert.ok(selected[runtime], 'Missing verified preview: ' + runtime);
  }
  const next = Object.fromEntries(Object.keys(previous).map(runtime => [runtime, selected[runtime]]));
  if (!isDeepStrictEqual(previous, next)) {
    const context = 'Promote the native, signed runtime previews for AL2023 ' + refresh.releasever + '.\n\n' +
      Object.entries(next).map(([runtime, row]) => '- ' + runtime + ': `' + row.reference + '`').join('\n') +
      '\n\nThe refreshed foundation is published after both public runtime mirrors are current. Part of #12.';
    adopt(await submit(base, branch('stable', refresh), 'Promote runtime rebuilds for AL2023 ' + refresh.releasever,
      context, { [stableFile]: next }, { minutes: Math.min(15, minutesLeft()) }));
  }
}

function languagesPublished() {
  const plans = Object.entries(read(stableFile)).map(([runtime, candidate]) => stablePlan(runtime, candidate));
  return plans.every(plan => {
    const release = publishedRelease(plan.releaseTag);
    if (!release || release.prerelease || !release.assets.some(asset => asset.name === 'stable.json' && asset.state === 'uploaded')) return false;
    if (![plan.alias, plan.channel].every(tag => registryDigest(tag, { allowMissing: true }) === plan.digest)) return false;
    const latest = latestStableRelease(plans.filter(candidate => candidate.variant === plan.variant));
    return mirrorHosts.every(host => {
      const { tags, base } = stableMirror(host, plan);
      return (latest.runtime === plan.runtime ? [...tags, base + ':latest'] : tags)
        .every(tag => registryDigest(tag, { allowMissing: true }) === plan.digest);
    });
  });
}
if (!languagesPublished()) {
  const workflow = 'runtime-stable.yml';
  let id = pendingRun(workflow, 'Stable publish all');
  if (!id) {
    const checked = recentRuns(workflow, 'Stable check all').find(row => row.status !== 'completed' ||
      row.conclusion === 'success' && Date.now() - Date.parse(row.updatedAt) < 4 * 60 * 60_000);
    const preflight = checked?.databaseId ?? start(workflow, { runtime: 'all', mode: 'check' }, base);
    await waitRuns({ preflight }, 'fresh stable preflight for every runtime');
    id = start(workflow, { runtime: 'all', mode: 'publish' }, base);
  }
  await waitRuns({ stable: id }, 'signed stable promotion');
}

const workflow = 'foundation-release.yml';
const tag = foundationTag(refresh);
const revision = String(refresh.foundationRevision);
if (!foundationPublished(tag)) {
  const id = pendingRun(workflow, 'Foundation revision ' + revision) ?? start(workflow, { revision }, base);
  await waitRuns({ foundation: id }, 'signed foundation publication');
}
assert.ok(foundationPublished(tag), 'Foundation tags do not match the signed release');
if (!foundationMirrorsPublished(tag)) {
  const id = pendingRun(workflow, 'Mirror foundation (both)') ?? start(workflow, { mode: 'mirror', registry: 'both' }, base);
  await waitRuns({ foundation: id }, 'signed foundation mirror repair');
  assert.ok(foundationMirrorsPublished(tag), 'Public foundation mirrors do not match the signed release');
}
const issue = trackingIssue(refresh);
const labels = issue.labels.map(label => label.name).filter(label => !label.startsWith('status:'));
actionAPI('issues/' + issue.number, 'PATCH', { labels: [...labels, 'status:done'] });
summary('Published AL2023 ' + refresh.releasever + ' with all language lines and the foundation: https://github.com/' +
  repository + '/releases/tag/' + tag);
