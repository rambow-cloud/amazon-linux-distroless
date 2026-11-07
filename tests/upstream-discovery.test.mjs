import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, ensureProposal, markerRelease, proposalKey, snapshot, trustedProposalEvent } from '../scripts/upstream/discovery-lib.mjs';
const ref = digit => 'public.ecr.aws/amazonlinux/amazonlinux@sha256:' + digit.repeat(64);
const current = { builder: ref('1'), releasever: '2023.12.20261102' };
const candidate = { ref: ref('2'), platform: 'linux/amd64', releasever: '2023.12.20261105' };
const report = () => ({ source: 'public.ecr.aws/amazonlinux/amazonlinux:2023', runUrl: 'https://github.com/example/repo/actions/runs/1', ...decide(current, candidate) });
test('unchanged digest suppresses proposals and same-release digest changes remain visible', () => {
  assert.equal(decide(current, { ...candidate, ref: current.builder }).changed, false);
  assert.equal(decide(current, { ...candidate, releasever: current.releasever }).status, 'digest-refresh');
});
test('snapshot comparison is numeric and flags older candidates for review', () => {
  assert.equal(report().status, 'newer-release');
  assert.equal(decide(current, { ...candidate, releasever: '2023.9.20251101' }).status, 'older-release-review');
  assert.equal(decide({ ...current, releasever: '2023.9.20251101' }, candidate).status, 'newer-release');
});
test('only an explicit AL2023 marker, valid date, official digest and expected platform are accepted', () => {
  assert.equal(markerRelease('Amazon Linux release 2023.12.20261105 (Amazon Linux)\n'), candidate.releasever);
  assert.throws(() => markerRelease('Amazon Linux release 2027.0.20261105 (Amazon Linux)'));
  assert.throws(() => snapshot('2023.12.20260230'));
  assert.throws(() => decide(current, { ...candidate, ref: 'other@sha256:' + '2'.repeat(64) }));
  assert.throws(() => decide(current, { ...candidate, platform: 'linux/arm64' }));
});
test('only scheduled/manual events on the default branch may propose writes', () => {
  assert.equal(trustedProposalEvent('schedule', 'refs/heads/main', 'main'), true);
  assert.equal(trustedProposalEvent('workflow_dispatch', 'refs/heads/main', 'main'), true);
  assert.equal(trustedProposalEvent('push', 'refs/heads/main', 'main'), false);
  assert.equal(trustedProposalEvent('workflow_dispatch', 'refs/heads/preview', 'main'), false);
});
for (const state of ['open', 'closed']) test('preserves an existing ' + state + ' proposal without duplicate writes', async () => {
  const r = report();
  const result = await ensureProposal(r, 4, { listIssues: async () => [{ number: 7, state, body: proposalKey(r), html_url: 'https://github.com/example/repo/issues/7' }],
    getMilestone: async () => { throw new Error('Should not create'); }, createIssue: async () => { throw new Error('Duplicate write'); } });
  assert.equal(result.action, 'exists'); assert.equal(result.state, state);
});
test('creates metadata-complete proposal once and ignores PR markers in issue listings', async () => {
  const r = report(); let writes = 0;
  const result = await ensureProposal(r, 4, { listIssues: async () => [{ pull_request: {}, body: proposalKey(r) }],
    getMilestone: async () => ({ state: 'open' }), createIssue: async request => {
      writes++; assert.equal(request.milestone, 4); assert.ok(request.labels.includes('status:triage'));
      assert.match(request.body, /## Acceptance criteria\n- \[ \]/); return { number: 9, html_url: 'https://github.com/example/repo/issues/9' };
    } });
  assert.equal(result.action, 'created'); assert.equal(writes, 1);
});
test('no write occurs for unchanged input or a closed milestone', async () => {
  assert.equal((await ensureProposal({ changed: false }, 4, {})).action, 'unchanged');
  await assert.rejects(() => ensureProposal(report(), 4, { listIssues: async () => [],
    getMilestone: async () => ({ state: 'closed' }), createIssue: async () => { throw new Error('Unexpected write'); } }), /open proposal milestone/);
});
