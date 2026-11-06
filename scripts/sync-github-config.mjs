#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
let repository;
let apply = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--repo') repository = args[++i];
  else if (args[i] === '--apply') apply = true;
  else throw new Error(`Unknown argument: ${args[i]}`);
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '')) {
  throw new Error('Usage: node scripts/sync-github-config.mjs --repo OWNER/REPO [--apply]');
}
const readConfig = name => JSON.parse(readFileSync(new URL(`../.github/${name}.json`, import.meta.url), 'utf8'));
const labels = readConfig('labels');
const milestones = readConfig('milestones');
for (const [name, entries, key] of [['labels', labels, 'name'], ['milestones', milestones, 'title']]) {
  if (!Array.isArray(entries) || new Set(entries.map(entry => entry[key])).size !== entries.length) {
    throw new Error(`Invalid or duplicate ${name} configuration`);
  }
  if (entries.some(entry => !entry[key] || typeof entry.description !== 'string')) {
    throw new Error(`Missing name/title or description in ${name}`);
  }
}
if (labels.some(label => !/^[a-f0-9]{6}$/i.test(label.color) || label.name.length > 50 || label.description.length > 100)) {
  throw new Error('Invalid label color or GitHub label length limit exceeded');
}

function api(endpoint, { method = 'GET', data, paginated = false } = {}) {
  const command = ['api', '--hostname', 'github.com', endpoint, '--method', method];
  if (paginated) command.push('--paginate', '--slurp');
  if (data !== undefined) command.push('--input', '-');
  const output = execFileSync('gh', command, {
    input: data === undefined ? undefined : JSON.stringify(data),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return output.trim() ? JSON.parse(output) : null;
}

const endpoint = `repos/${repository}`;
const existingLabels = api(`${endpoint}/labels?per_page=100`, { paginated: true }).flat();
const existingMilestones = api(`${endpoint}/milestones?state=all&per_page=100`, { paginated: true }).flat();
let changes = 0;
for (const label of labels) {
  const existing = existingLabels.find(item => item.name.toLowerCase() === label.name.toLowerCase());
  if (existing && ['name', 'color', 'description'].every(key => existing[key] === label[key])) continue;
  changes++;
  console.log(`${apply ? 'APPLY' : 'PREVIEW'} ${existing ? 'update' : 'create'} label ${label.name}`);
  if (apply) {
    api(existing ? `${endpoint}/labels/${encodeURIComponent(existing.name)}` : `${endpoint}/labels`, {
      method: existing ? 'PATCH' : 'POST',
      data: existing ? { new_name: label.name, color: label.color, description: label.description } : label,
    });
  }
}
for (const milestone of milestones) {
  const existing = existingMilestones.find(item => item.title === milestone.title);
  if (existing && existing.description === milestone.description) continue;
  changes++;
  console.log(`${apply ? 'APPLY' : 'PREVIEW'} ${existing ? 'update' : 'create'} milestone ${milestone.title}`);
  if (apply) {
    api(existing ? `${endpoint}/milestones/${existing.number}` : `${endpoint}/milestones`, {
      method: existing ? 'PATCH' : 'POST',
      data: milestone,
    });
  }
}
console.log(`${changes} configured change(s) ${apply ? 'applied' : 'previewed'}. Unrelated entries and existing milestone states are preserved.`);
