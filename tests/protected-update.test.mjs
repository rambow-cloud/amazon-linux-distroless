import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { repository } from '../scripts/release/stable-policy.mjs';
import { requiredChecks } from '../scripts/upstream/automation-policy.mjs';
import { protectedUpdateClient } from '../scripts/upstream/protected-update.mjs';

for (const changed of [false, true]) {
  test(changed ? 'a stale PR with unexpected content is not pushed' :
    'main advancing refreshes the existing PR and merges its checked head', async t => {
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
    const pr = { number: 42, state: 'open', user: { login: process.env.UPDATE_APP_SLUG + '[bot]' },
      head: { ref: branch, sha: oldHead, repo: { full_name: repository } }, base: { ref: 'main' }, html_url: 'https://example.test/42' };
    let pushedHead;
    const merged = 'a'.repeat(40);
    const execute = (command, args, options) => {
      if (command === 'git') {
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
      if (args[0] === 'pr' && args[1] === 'view') {
        assert.ok(pushedHead);
        return JSON.stringify({ state: 'OPEN', baseRefName: 'main', headRefName: branch, headRefOid: pushedHead,
          files: [{ path: 'candidate.json' }],
          statusCheckRollup: requiredChecks.map(name => ({ name, status: 'COMPLETED', conclusion: 'SUCCESS' })) });
      }
      assert.ok(args.includes('repos/' + repository + '/pulls/42/merge'), 'Unexpected GitHub call: ' + args.join(' '));
      assert.deepEqual(JSON.parse(options.input), { sha: pushedHead, merge_method: 'squash' });
      return JSON.stringify({ merged: true, sha: merged });
    };
    const pending = protectedUpdateClient({ execute }).submit(base, prefix, 'Update candidate', '', { 'candidate.json': { revision: 2 } });
    if (changed) {
      await assert.rejects(pending, /Unexpected update content: candidate\.json/);
      assert.equal(pushedHead, undefined);
    } else {
      assert.equal(await pending, merged);
      assert.ok(pushedHead);
    }
  });
}
