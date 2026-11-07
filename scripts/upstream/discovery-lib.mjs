import assert from 'node:assert/strict';

export const repository = 'public.ecr.aws/amazonlinux/amazonlinux';
export function snapshot(value) {
  const m = /^2023\.(\d+)\.(\d{8})$/.exec(value || '');
  if (!m) throw new Error('Explicit AL2023 repository snapshot required');
  const date = m[2], year = Number(date.slice(0, 4)), month = Number(date.slice(4, 6)), day = Number(date.slice(6));
  const actual = new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10).replaceAll('-', '');
  if (year < 2023 || actual !== date) throw new Error('Invalid AL2023 snapshot date');
  return [Number(m[1]), Number(date)];
}
export function validateRef(ref) {
  assert.match(ref || '', /^public\.ecr\.aws\/amazonlinux\/amazonlinux@sha256:[a-f0-9]{64}$/);
}
export function markerRelease(marker) {
  const release = /^Amazon Linux release (2023\.\d+\.\d{8}) \(Amazon Linux\)$/.exec(marker.trim())?.[1];
  snapshot(release); return release;
}
export function decide(current, upstream) {
  validateRef(current.builder); validateRef(upstream.ref);
  assert.equal(upstream.platform, 'linux/amd64');
  const old = snapshot(current.releasever), next = snapshot(upstream.releasever);
  const relation = Math.sign(next[0] - old[0] || next[1] - old[1]);
  const changed = current.builder !== upstream.ref || relation !== 0;
  const status = !changed ? 'unchanged' : relation < 0 ? 'older-release-review' : relation > 0 ? 'newer-release' : 'digest-refresh';
  return { changed, status, releaseRelationToLockedRepository: relation,
    current: { builder: current.builder, repositoryRelease: current.releasever }, candidate: upstream };
}
export function proposalKey(report) {
  validateRef(report.candidate.ref);
  assert.equal(report.candidate.platform, 'linux/amd64');
  snapshot(report.candidate.releasever);
  return '<!-- al2023-builder-discovery:' + report.candidate.platform + ':' + report.candidate.ref.split('@')[1] +
    ':' + report.candidate.releasever + ' -->';
}
export function matchesProposal(report, issue) {
  if (issue.pull_request) return false;
  const key = proposalKey(report);
  const legacy = key.replace(':' + report.candidate.releasever + ' -->', ' -->');
  return (issue.body || '').includes(key) || ((issue.body || '').includes(legacy) &&
    (issue.body || '').includes('Builder release marker: ' + report.candidate.releasever + '\n'));
}
export function proposalRequest(report, milestone) {
  if (!report.changed) throw new Error('Unchanged builder does not need an update issue');
  snapshot(report.candidate.releasever);
  assert.ok(Number.isSafeInteger(milestone) && milestone > 0);
  const digest = report.candidate.ref.split('@')[1];
  const key = proposalKey(report);
  return {
    title: '[Maintenance] Review AL2023 builder ' + report.candidate.releasever + ' (' + digest.slice(7, 19) + ')',
    labels: ['type:maintenance', 'area:build', 'priority:p1', 'status:triage'], milestone,
    body: key + '\n\n## Context\nThe upstream detector observed a changed official AL2023 builder digest or repository snapshot. This proposal tracks the protected refresh.\n\n' +
      '- Discovery source: ' + report.source + '\n- Platform: ' + report.candidate.platform +
      '\n- Current locked builder: ' + report.current.builder + '\n- Current locked RPM repository: ' + report.current.repositoryRelease +
      '\n- Observed builder: ' + report.candidate.ref + '\n- Observed builder release marker: ' +
      (report.candidate.imageReleasever ?? report.candidate.releasever) + '\n- Observed RPM repository: ' + report.candidate.releasever +
      '\n- Classification: ' + report.status + '\n- Evidence: ' + report.runUrl + '\n\n' +
      'Release comparison is against the locked RPM snapshot. The builder marker alone does not prove that a particular RPM update is qualified. An older-release-review candidate needs explicit review; never downgrade inputs automatically.\n\n' +
      '## Acceptance criteria\n- [ ] Review the upstream builder/snapshot and relevant advisories; accept or reject the candidate\n' +
      '- [ ] If accepted, regenerate and review complete binary/source RPM locks through Actions\n' +
      '- [ ] Validate the supported runtime matrix and inspect payload/package/license changes\n' +
      '- [ ] Publish only after the applicable evidence and release gates pass\n\n' +
      '## Validation plan\nFollow docs/UPDATING.md. Eligible candidates enter the protected lock PR and release gates automatically. Closing an unmerged proposal records a maintainer decision. The detector deduplicates by platform, digest and snapshot. References #12 and #35.\n',
  };
}
export async function ensureProposal(report, milestone, api) {
  if (!report.changed) return { action: 'unchanged' };
  const existing = (await api.listIssues()).find(issue => matchesProposal(report, issue));
  if (existing) return { action: 'exists', number: existing.number, state: existing.state, url: existing.html_url };
  const selected = await api.getMilestone(milestone);
  assert.equal(selected.state, 'open', 'Configure an open proposal milestone before creating update issues');
  const issue = await api.createIssue(proposalRequest(report, milestone));
  return { action: 'created', number: issue.number, url: issue.html_url };
}
export function trustedProposalEvent(event, ref, defaultBranch) {
  return ['schedule', 'workflow_dispatch'].includes(event) && !!defaultBranch && ref === 'refs/heads/' + defaultBranch;
}
