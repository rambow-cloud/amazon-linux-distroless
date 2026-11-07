import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { markerRelease, snapshot, validateRef } from './discovery-lib.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Prepare AL2023 candidates only in Actions');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
const [mode, family, arch] = process.argv.slice(2);
const out = 'out/al2023-candidate';
const planFile = out + '/plan.json';
if (mode === 'plan') {
  const old = read('locks/foundation/linux-amd64.json');
  const rehearse = process.env.GITHUB_EVENT_NAME !== 'workflow_run';
  let next = { ref: old.builder, releasever: old.releasever };
  let changed = false;
  if (!rehearse) {
    const discovered = read('out/al2023-discovery/discovery.json');
    const run = read(process.env.GITHUB_EVENT_PATH).workflow_run;
    assert.equal(run.head_repository.full_name, process.env.GITHUB_REPOSITORY);
    assert.equal(run.path.split('@')[0], '.github/workflows/al2023-discovery.yml');
    assert.equal(discovered.sourceCommit, run.head_sha);
    assert.equal(run.head_sha, process.env.GITHUB_SHA);
    next = discovered.candidate;
    assert.equal(markerRelease(next.releaseMarker), next.releasever);
    changed = discovered.changed;
  }
  validateRef(next.ref);
  const [major, date] = snapshot(next.releasever);
  const [oldMajor, oldDate] = snapshot(old.releasever);
  const eligible = rehearse || changed && (major > oldMajor || major === oldMajor && date >= oldDate);
  write(planFile, { sourceCommit: process.env.GITHUB_SHA, rehearse, eligible,
    builder: next.ref, releasever: next.releasever });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, 'eligible=' + eligible + '\n');
  process.exit(0);
}
assert.ok(['foundation', 'java17', 'java21', 'java25', 'python', 'nodejs'].includes(family));
assert.ok(['amd64', 'arm64'].includes(arch));
const plan = read(planFile);
assert.equal(plan.sourceCommit, process.env.GITHUB_SHA);
assert.equal(plan.eligible, true);
validateRef(plan.builder);
const isJava = family.startsWith('java');
const spec = 'images/' + (isJava ? family : 'upstream') + '/packages.json';
const lock = family === 'foundation' || isJava
  ? 'locks/' + family + '/linux-' + arch + '.json' : 'locks/upstream/' + family + '-linux-' + arch + '.json';
const resolved = family === 'foundation' ? 'out/foundation-lock/' + lock :
  isJava ? 'out/' + family + '-lock/linux-' + arch + '.json' : 'out/resolved/' + lock;
if (mode === 'stage') {
  const before = read(spec);
  write(spec, { ...before, releasever: plan.releasever, builder_tag: plan.builder });
} else if (mode === 'collect') {
  const before = read(lock);
  const after = read(resolved);
  assert.equal(after.platform, 'linux/' + arch);
  assert.equal(after.builder, plan.builder);
  assert.equal(after.releasever, plan.releasever);
  assert.deepEqual(Object.keys(after.variants).sort(), Object.keys(before.variants).sort());
  const changes = {};
  for (const [name, group] of Object.entries(after.variants)) {
    assert.deepEqual(group.roots, before.variants[name].roots);
    const map = packages => Object.fromEntries(packages.map(p => [p.name + '.' + p.arch, p]));
    const old = map(before.variants[name].packages);
    const next = map(group.packages);
    changes[name] = [...new Set([...Object.keys(old), ...Object.keys(next)])].sort()
      .filter(key => !isDeepStrictEqual(old[key], next[key]))
      .map(key => ({ package: key, before: old[key] ?? null, after: next[key] ?? null }));
  }
  if (plan.rehearse) assert.ok(Object.values(changes).every(group => group.length === 0),
    'The pinned current snapshot resolved a different RPM transaction');
  write(out + '/delivery/' + lock, after);
  write(out + '/delivery/' + spec, read(spec));
  write(out + '/delivery/changes.json', { plan, family, arch, lock, changes,
    toolsChanged: !isDeepStrictEqual(before.tool_packages, after.tool_packages),
    matchingSourcesChanged: !isDeepStrictEqual(before.sources, after.sources) });
} else {
  throw new Error('Expected plan, stage or collect');
}
