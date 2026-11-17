import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { repository } from '../scripts/release/stable-policy.mjs';
import { requiredChecks } from '../scripts/upstream/automation-policy.mjs';
import { protectedUpdateClient } from '../scripts/upstream/protected-update.mjs';

function tokens(t) {
  for (const [name, value] of Object.entries({ GH_TOKEN: 'test-app-token', ACTION_TOKEN: 'test-actions-token' })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
}

test('workflow polling waits through HTTP 404 without redispatching and preserves identity checks', t => {
  tokens(t);
  const expected = 'e'.repeat(40);
  let response = 404;
  const execute = (command, args, options) => {
    assert.equal(command, 'gh');
    if (args.includes('--paginate')) return '';
    assert.ok(args.includes('repos/' + repository + '/actions/runs/99'));
    assert.equal(args[args.indexOf('--method') + 1], 'GET');
    assert.equal(options.env.GH_TOKEN, 'test-actions-token');
    assert.equal(options.stdio[2], 'pipe');
    if (typeof response === 'number') {
      throw Object.assign(new Error('GitHub API failed'), { status: 1, stderr: Buffer.from('gh: HTTP ' + response) });
    }
    return JSON.stringify(response);
  };
  const client = protectedUpdateClient({ execute });
  assert.equal(client.workflowResult(99, expected), false);
  response = { head_branch: 'main', head_sha: expected, event: 'workflow_dispatch', status: 'queued' };
  assert.equal(client.workflowResult(99, expected), false);
  response = { ...response, status: 'completed', conclusion: 'success' };
  assert.deepEqual(client.workflowResult(99, expected), response);
  for (const changed of [{ head_sha: 'f'.repeat(40) }, { head_branch: 'other' }, { event: 'pull_request' },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }]) {
    const valid = response;
    response = { ...valid, ...changed };
    assert.throws(() => client.workflowResult(99, expected));
    response = valid;
  }
  for (const code of [403, 429, 500]) {
    response = code;
    assert.throws(() => client.workflowResult(99, expected), /GitHub API failed/);
  }
  assert.throws(() => client.workflowResult('99', expected), /workflow run ID/);
});

for (const scenario of ['success', 'unexpected-content', 'merge-failure', 'check-failure', 'deferred', 'completion-recovery']) {
  test('resumed protected update: ' + scenario, async t => {
    tokens(t);
    const changed = scenario === 'unexpected-content';
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'protected-update-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    t.mock.method(fs, 'appendFileSync', () => {});
    const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
    const put = (name, content) => fs.writeFileSync(path.join(directory, name), content);
    git('init', '-q', '-b', 'main');
    git('config', 'user.name', 'Release test');
    git('config', 'user.email', 'release@example.test');
    git('config', 'commit.gpgsign', 'false');
    put('candidate.json', '{"revision":1}\n');
    git('add', 'candidate.json');
    git('commit', '-qm', 'Start on main');
    const oldBase = git('rev-parse', 'HEAD');
    const prefix = 'automation/nodejs26-26.13.1-stable';
    const branch = prefix + '-' + oldBase.slice(0, 12);
    git('switch', '-qc', branch);
    put('candidate.json', changed ? '{"revision":3}\n' : '{"revision":2}\n');
    git('commit', '-qam', 'Update candidate');
    const oldHead = git('rev-parse', 'HEAD');
    git('switch', '-q', 'main');
    put('notes.md', 'An unrelated change\n');
    git('add', 'notes.md');
    git('commit', '-qm', 'Advance main');
    const base = git('rev-parse', 'HEAD');
    const pr = { number: 42, title: 'Update candidate', body: 'Closes #41', state: 'open',
      user: { login: process.env.UPDATE_APP_SLUG + '[bot]' },
      head: { ref: branch, sha: oldHead, repo: { full_name: repository } }, base: { ref: 'main' }, html_url: 'https://example.test/42' };
    const issue = { number: 41, title: '[Maintenance] Update candidate', state: 'open',
      html_url: 'https://example.test/41', labels: [{ name: 'type:maintenance' }, { name: 'status:in-progress' }],
      body: scenario === 'deferred' ? '<!-- al2023-builder-discovery:pending -->\n- [ ] Publish images' :
        '## Acceptance criteria\n- [ ] Verify the exact locked update through all required checks.\n' +
        '- [ ] Merge the qualified commit without bypassing main protection.\n' };
    let pushedHead;
    let didMerge = false;
    let completions = 0;
    let completionFailure = scenario === 'completion-recovery';
    const merged = 'a'.repeat(40);
    const execute = (command, args, options) => {
      if (command === 'git') {
        if (args[0] === 'merge-base' && args[2] === merged && didMerge) return '';
        if (args[0] === 'ls-remote') {
          assert.equal(args.at(-1), 'refs/heads/' + branch);
          return oldHead + '\trefs/heads/' + branch;
        }
        if (args[0] === 'fetch') return '';
        if (args[0] === 'rev-parse' && args[1] === 'FETCH_HEAD') return oldHead;
        if (args[0] === 'push') {
          assert.deepEqual(args, ['push', 'origin', 'HEAD:refs/heads/' + branch]);
          pushedHead = git('rev-parse', 'HEAD');
          git('merge-base', '--is-ancestor', base, pushedHead);
          git('merge-base', '--is-ancestor', oldHead, pushedHead);
          return '';
        }
        return git(...args);
      }
      assert.equal(command, 'gh');
      if (args.includes('repos/' + repository + '/git/ref/heads/main')) return JSON.stringify({ object: { sha: base } });
      if (args.includes('repos/' + repository + '/pulls?state=all&base=main&per_page=100')) return JSON.stringify(pr);
      if (args.includes('repos/' + repository + '/issues?state=open&per_page=100&page=1')) {
        assert.equal(options.env.GH_TOKEN, process.env.ACTION_TOKEN);
        return JSON.stringify(issue.state === 'open' ? [issue, { ...issue, number: 99, title: 'Unrelated work' }] : []);
      }
      if (args[0] === 'pr' && args[1] === 'view') {
        if (args.at(-1) === 'mergeCommit') return JSON.stringify({ mergeCommit: { oid: merged } });
        assert.ok(pushedHead);
        return JSON.stringify({ state: 'OPEN', baseRefName: 'main', headRefName: branch, headRefOid: pushedHead,
          files: [{ path: 'candidate.json' }],
          statusCheckRollup: requiredChecks.map(name => ({ name, status: 'COMPLETED',
            conclusion: scenario === 'check-failure' ? 'FAILURE' : 'SUCCESS' })) });
      }
      if (args.includes('repos/' + repository + '/issues/41')) {
        assert.ok(didMerge, 'An unmerged update must not complete its issue');
        assert.equal(options.env.GH_TOKEN, process.env.ACTION_TOKEN);
        if (args[args.indexOf('--method') + 1] === 'GET') return JSON.stringify(issue);
        assert.equal(args[args.indexOf('--method') + 1], 'PATCH');
        if (completionFailure) { completionFailure = false; throw new Error('Issue API unavailable after merge'); }
        const patch = JSON.parse(options.input);
        assert.equal(patch.state, 'closed');
        assert.equal(patch.state_reason, 'completed');
        assert.deepEqual(patch.labels, ['type:maintenance']);
        assert.equal(patch.body.match(/- \[x\]/g).length, 2);
        Object.assign(issue, patch, { labels: patch.labels.map(name => ({ name })) });
        completions++;
        return JSON.stringify(issue);
      }
      assert.ok(args.includes('repos/' + repository + '/pulls/42/merge'), 'Unexpected GitHub call: ' + args.join(' '));
      assert.equal(options.env.GH_TOKEN, 'test-app-token');
      assert.deepEqual(JSON.parse(options.input), { sha: pushedHead, merge_method: 'squash' });
      didMerge = scenario !== 'merge-failure';
      if (didMerge) pr.merged_at = '2026-11-17T00:00:00Z';
      return JSON.stringify({ merged: didMerge, sha: merged, message: 'Protected merge rejected' });
    };
    const pending = protectedUpdateClient({ execute }).submit(base, prefix, 'Update candidate', '', { 'candidate.json': { revision: 2 } });
    if (changed) {
      await assert.rejects(pending, /Unexpected update content: candidate\.json/);
      assert.equal(pushedHead, undefined);
    } else if (scenario === 'merge-failure' || scenario === 'check-failure') {
      await assert.rejects(pending, scenario === 'merge-failure' ? /Protected merge rejected/ : /Required check failed/);
      assert.equal(didMerge, false);
    } else if (scenario === 'completion-recovery') {
      await assert.rejects(pending, /Issue API unavailable after merge/);
      const client = protectedUpdateClient({ execute });
      assert.equal(client.approvedCommit(prefix, base, () => false), null);
      assert.equal(completions, 0, 'Unmatched merged contents must not complete an issue');
      assert.equal(client.approvedCommit(prefix, base, () => true), merged);
      assert.equal(completions, 0, 'Approval lookup does not change issue state');
      client.reconcileIssues(base);
      assert.equal(completions, 1);
      client.reconcileIssues(base);
      assert.equal(completions, 1, 'Completion is idempotent');
    } else {
      assert.equal(await pending, merged);
      assert.ok(pushedHead);
    }
    if (scenario !== 'completion-recovery') assert.equal(completions, scenario === 'success' ? 1 : 0);
  });
}

test('new update PRs close their stage issue and only reference the publication proposal', async t => {
  tokens(t);
  t.mock.method(fs, 'appendFileSync', () => {});
  t.mock.method(fs, 'writeFileSync', () => {});
  const base = 'b'.repeat(40), head = 'c'.repeat(40), merged = 'd'.repeat(40);
  const context = 'Regenerate AL2023 locks.\n\nPart of #135.';
  let issue, pr, didMerge = false, completed = false;
  const execute = (command, args, options) => {
    if (command === 'git') {
      if (args[0] === 'ls-remote') return '';
      if (args[0] === 'rev-parse') return head;
      if (args[0] === 'diff') return 'candidate.json';
      return '';
    }
    if (args.includes('repos/' + repository + '/pulls?state=all&base=main&per_page=100')) return '';
    if (args.includes('repos/' + repository + '/git/ref/heads/main')) return JSON.stringify({ object: { sha: base } });
    const endpoint = args.find(arg => arg.startsWith('repos/'));
    const body = options.input && JSON.parse(options.input);
    if (endpoint === 'repos/' + repository + '/issues') {
      issue = { ...body, number: 51, html_url: 'https://example.test/51', labels: body.labels.map(name => ({ name })) };
      return JSON.stringify(issue);
    }
    if (endpoint === 'repos/' + repository + '/pulls') {
      assert.equal(body.body, context + '\n\nCloses #51');
      assert.doesNotMatch(body.body, /Closes #135/);
      pr = { ...body, number: 52, html_url: 'https://example.test/52' };
      return JSON.stringify(pr);
    }
    if (args[0] === 'pr') return JSON.stringify({ state: 'OPEN', baseRefName: 'main', headRefName: pr.head,
      headRefOid: head, files: [{ path: 'candidate.json' }],
      statusCheckRollup: requiredChecks.map(name => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' })) });
    if (endpoint === 'repos/' + repository + '/pulls/52/merge') {
      assert.equal(body.sha, head);
      didMerge = true;
      return JSON.stringify({ merged: true, sha: merged });
    }
    assert.equal(endpoint, 'repos/' + repository + '/issues/51');
    assert.ok(didMerge);
    assert.equal(options.env.GH_TOKEN, process.env.ACTION_TOKEN);
    if (!body) return JSON.stringify(issue);
    assert.equal(body.state, 'closed');
    assert.equal(body.state_reason, 'completed');
    assert.ok(!body.labels.some(label => label.startsWith('status:')));
    assert.doesNotMatch(body.body, /- \[ \]/);
    completed = true;
    return JSON.stringify(body);
  };
  assert.equal(await protectedUpdateClient({ execute }).submit(base, 'automation/al2023-test-lock',
    'Refresh AL2023 locks', context, { 'candidate.json': { revision: 2 } }), merged);
  assert.ok(completed);
});
