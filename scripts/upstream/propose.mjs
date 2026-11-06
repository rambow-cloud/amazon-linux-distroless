import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ensureProposal, trustedProposalEvent } from './discovery-lib.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || !trustedProposalEvent(process.env.GITHUB_EVENT_NAME,
  process.env.GITHUB_REF, process.env.DEFAULT_BRANCH)) throw new Error('Proposal writes require a trusted default-branch schedule/manual run');
const repository = process.env.GITHUB_REPOSITORY;
assert.match(repository || '', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const config = JSON.parse(fs.readFileSync('.github/al2023-discovery.json'));
const report = JSON.parse(fs.readFileSync('out/upstream/discovery.json'));
assert.equal(report.source, config.source);
function api(endpoint, method = 'GET', body, paginate = false) {
  const args = ['api', endpoint, '--method', method];
  if (paginate) args.push('--paginate', '--slurp');
  if (body) args.push('--input', '-');
  const text = execFileSync('gh', args, { input: body ? JSON.stringify(body) : undefined,
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['pipe', 'pipe', 'inherit'] });
  return JSON.parse(text);
}
const result = await ensureProposal(report, config.proposal_milestone, {
  listIssues: async () => api('repos/' + repository + '/issues?state=all&per_page=100', 'GET', null, true).flat(),
  getMilestone: async number => api('repos/' + repository + '/milestones/' + number),
  createIssue: async body => api('repos/' + repository + '/issues', 'POST', body),
});
console.log(JSON.stringify(result));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '# AL2023 builder proposal\n\n' + result.action + (result.url ? ': ' + result.url : '') + '\n');
