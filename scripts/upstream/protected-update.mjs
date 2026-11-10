import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { repository } from '../release/stable-policy.mjs';
import { checkState } from './automation-policy.mjs';

const write = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const updateBranch = (name, prefix) => name.startsWith(prefix) &&
  /^(?:-[a-f0-9]{12})?$/.test(name.slice(prefix.length));

export function protectedUpdateClient({ execute = execFileSync } = {}) {
  const run = (command, args, options = {}) => execute(command, args, {
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
      if (!owned(pr) || !pr.merged_at || !updateBranch(pr.head.ref, prefix)) continue;
      const { mergeCommit } = JSON.parse(gh('pr', 'view', String(pr.number), '--repo', repository, '--json', 'mergeCommit'));
      assert.match(mergeCommit.oid, sha);
      git('merge-base', '--is-ancestor', mergeCommit.oid, base);
      if (matches(mergeCommit.oid)) return mergeCommit.oid;
    }
    return null;
  }

  function verifyMain(expected) {
    assert.match(expected, sha);
    assert.equal(actionAPI('git/ref/heads/main').object.sha, expected, 'Protected main changed; refresh the candidate');
  }
  async function waitFor(action, description, minutes = 15) {
    const end = Date.now() + minutes * 60 * 1000;
    do {
      const result = action();
      if (result) return result;
      await setTimeout(20_000);
    } while (Date.now() < end);
    throw new Error('Timed out waiting for ' + description);
  }

  async function submit(base, prefix, title, context, changes, { issue: trackedIssue, extraChecks = [], minutes, onQualified } = {}) {
    verifyMain(base);
    const tracked = pulls.filter(pr => !pr.merged_at && updateBranch(pr.head.ref, prefix) && pr.head.repo.full_name === repository);
    assert.ok(tracked.every(pr => owned(pr) && pr.state === 'open'), 'An existing update PR was closed or belongs to another author');
    assert.ok(tracked.length <= 1, 'Multiple PRs track this update');
    let [pr] = tracked;
    const branch = pr?.head.ref ?? prefix + '-' + base.slice(0, 12);
    const paths = Object.keys(changes).sort();
    let head = git('ls-remote', '--heads', 'origin', 'refs/heads/' + branch).split('\t')[0];
    let issue = trackedIssue;
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
      if (pr) assert.equal(pr.head.sha, head, 'Update PR head changed');
      const previousBase = git('merge-base', base, head);
      if (previousBase !== base) {
        assert.ok(pr, 'Only an existing update PR can be refreshed onto a newer main');
        git('switch', '--detach', head);
        git('-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com',
          'merge', '--no-ff', '--no-edit', base);
        head = git('rev-parse', 'HEAD');
      }
      assert.deepEqual(git('diff', '--name-only', base, head).split('\n').sort(), paths, 'Unexpected update branch files');
      for (const [file, data] of Object.entries(changes)) {
        assert.deepEqual(commitJSON(head, file), data, 'Unexpected update content: ' + file);
      }
      if (previousBase !== base) {
        verifyMain(base);
        git('push', 'origin', 'HEAD:refs/heads/' + branch);
      }
    } else {
      assert.ok(!pr, 'Update PR is missing its branch');
      issue ??= trackUpdate();
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
      if (now.headRefOid !== head && now.headRefOid === pr.head.sha) return null;
      assert.equal(now.headRefOid, head, 'Update PR head changed');
      assert.deepEqual(now.files.map(file => file.path).sort(), paths, 'Update PR contains unrelated files');
      return now;
    }
    const qualified = () => {
      const rollup = currentPR()?.statusCheckRollup;
      if (!rollup) return false;
      return checkState(rollup, extraChecks) && rollup;
    };
    await waitFor(qualified, 'required PR checks', minutes);
    const rollup = qualified();
    assert.ok(rollup);
    if (onQualified) await onQualified(pr, rollup);
    verifyMain(base);
    const merged = appAPI('pulls/' + pr.number + '/merge', 'PUT', { sha: head, merge_method: 'squash' });
    assert.ok(merged.merged, merged.message);
    assert.match(merged.sha, sha);
    return merged.sha;
  }

  function start(workflow, inputs, expected) {
    verifyMain(expected);
    const job = actionAPI('actions/workflows/' + workflow + '/dispatches', 'POST',
      { ref: 'main', inputs: { ...inputs, expected_commit: expected } });
    assert.ok(Number.isSafeInteger(job.workflow_run_id));
    summary('Trusted workflow: ' + job.html_url);
    return job.workflow_run_id;
  }

  function workflowResult(id, expected) {
    const info = actionAPI('actions/runs/' + id);
    assert.equal(info.head_branch, 'main');
    assert.equal(info.head_sha, expected);
    assert.equal(info.event, 'workflow_dispatch');
    if (info.status !== 'completed') return false;
    assert.equal(info.conclusion, 'success', 'Promotion workflow failed: ' + info.html_url);
    return info;
  }

  async function dispatch(workflow, inputs, expected, minutes) {
    const id = start(workflow, inputs, expected);
    return waitFor(() => workflowResult(id, expected), workflow, minutes);
  }

  return { run, git, gh, actionAPI, summary, commitJSON, approvedCommit, verifyMain, waitFor, submit, start, workflowResult, dispatch };
}
