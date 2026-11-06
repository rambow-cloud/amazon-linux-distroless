import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Execute the actual inline workflow script against an in-memory GitHub API.
// No contributor code, checkout, network access, or GitHub credentials are used.
const workflow = readFileSync(new URL('../.github/workflows/issue-policy.yml', import.meta.url), 'utf8');
const lines = workflow.split('\n');
const start = lines.findIndex(line => /^\s+script: \|$/.test(line));
assert.notEqual(start, -1, 'The workflow must contain an inline script');
const scriptLines = [];
for (const line of lines.slice(start + 1)) {
  if (line.trim() && !line.startsWith('            ')) break;
  scriptLines.push(line.slice(12));
}
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const evaluate = new AsyncFunction('context', 'github', 'core', scriptLines.join('\n'));

function readyIssue(overrides = {}) {
  return {
    state: 'open',
    labels: ['type:task', 'area:build', 'priority:p1', 'status:ready'].map(name => ({ name })),
    milestone: { state: 'open', number: 2 },
    body: '## Acceptance criteria\n- [ ] The static workload runs.\n\n## Dependencies\nNone.\n',
    ...overrides,
  };
}

async function check(body = 'Closes #2', issue = readyIssue(), additionalIssues = {}) {
  const failures = [];
  const requests = [];
  const issues = { 2: issue, ...additionalIssues };
  const context = { repo: { owner: 'rambow-cloud', repo: 'amazon-linux-distroless' }, payload: { pull_request: { body } } };
  const github = { rest: { issues: { get: async ({ owner, repo, issue_number }) => {
    assert.equal(owner, context.repo.owner);
    assert.equal(repo, context.repo.repo);
    requests.push(issue_number);
    if (!issues[issue_number]) throw Object.assign(new Error('Not found'), { status: 404 });
    return { data: issues[issue_number] };
  } } } };
  const core = { setFailed: text => failures.push(text), error: () => {}, info: () => {} };
  await evaluate(context, github, core);
  return { ok: failures.length === 0, failures, requests };
}

test('accepts a ready issue with an open milestone and actionable criteria', async () => {
  assert.equal((await check()).ok, true);
});

test('validates every unique linked issue and supports closing keywords', async () => {
  const result = await check('Fixes #2.\nResolves #3\nCloses #2', readyIssue(), { 3: readyIssue() });
  assert.equal(result.ok, true);
  assert.deepEqual(result.requests, [2, 3]);
});

test('accepts form-generated level-three headings, checked criteria, and in-progress work', async () => {
  assert.equal((await check('closes #2', readyIssue({
    labels: ['type:rfc', 'area:runtime', 'priority:p0', 'status:in-progress'],
    body: '### Acceptance criteria\n- [x] Record the accepted contract.\n### Dependencies\nNone.',
  }))).ok, true);
});

for (const [name, body] of [
  ['references without a closing keyword', 'Refs #2'],
  ['closing references in HTML comments', '<!--\nCloses #2\n-->'],
  ['closing references inside fenced examples', '```md\nCloses #2\n```'],
  ['cross-repository references', 'Closes another/repo#2'],
  ['URL closing references', 'Closes https://github.com/rambow-cloud/amazon-linux-distroless/issues/2'],
]) {
  test(`rejects ${name}`, async () => assert.equal((await check(body)).ok, false));
}

for (const [name, override] of [
  ['closed issues', { state: 'closed' }],
  ['pull request numbers', { pull_request: { url: 'https://example.invalid/pr/2' } }],
  ['missing milestones', { milestone: null }],
  ['closed milestones', { milestone: { state: 'closed' } }],
  ['missing label families', { labels: ['type:task', 'area:build', 'status:ready'] }],
  ['duplicate label families', { labels: ['type:task', 'type:bug', 'area:build', 'priority:p1', 'status:ready'] }],
  ['unsupported label values', { labels: ['type:unknown', 'area:build', 'priority:p1', 'status:ready'] }],
  ['triage issues', { labels: ['type:task', 'area:build', 'priority:p1', 'status:triage'] }],
  ['blocked issues', { labels: ['type:task', 'area:build', 'priority:p1', 'status:blocked'] }],
  ['empty criteria', { body: '## Acceptance criteria\n- [ ] \n' }],
  ['checkboxes outside the acceptance section', { body: '## Acceptance criteria\nTBD\n## Other\n- [ ] This is not acceptance.\n' }],
  ['criteria hidden in comments', { body: '## Acceptance criteria\n<!-- - [ ] Hidden task. -->' }],
]) {
  test(`rejects ${name}`, async () => assert.equal((await check('Closes #2', readyIssue(override))).ok, false));
}

test('fails if any referenced issue is missing or unready', async () => {
  assert.equal((await check('Closes #2\nCloses #404')).ok, false);
  assert.equal((await check('Closes #2\nCloses #3', readyIssue(), { 3: readyIssue({ state: 'closed' }) })).ok, false);
});

test('API failures fail closed rather than passing the gate', async () => {
  const context = { repo: { owner: 'owner', repo: 'repo' }, payload: { pull_request: { body: 'Closes #2' } } };
  const github = { rest: { issues: { get: async () => { throw Object.assign(new Error('Unavailable'), { status: 503 }); } } } };
  await assert.rejects(evaluate(context, github, {}), /Unavailable/);
});
