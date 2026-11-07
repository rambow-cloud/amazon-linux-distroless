import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { latestStableRelease, repository, stablePlan } from './stable-policy.mjs';
import { mirrorHosts, registryDigest, stableMirror, verifyPublicStableMirrors } from './stable-registry.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const run = (command, args) => execFileSync(command, args, {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
});
const plan = read('releases/stable-candidates.json');
const targets = Object.entries(plan).map(([runtime, candidate]) => stablePlan(runtime, candidate));
const lifecycle = read('releases/runtime-support.json');
assert.deepEqual(Object.keys(lifecycle.runtimeThrough).sort(), Object.keys(plan).sort());
const today = new Date().toISOString().slice(0, 10);
const date = value => assert.match(value, /^\d{4}-\d{2}-\d{2}$/);
date(lifecycle.al2023Through);
assert.ok(today <= lifecycle.al2023Through, 'The AL2023 support boundary has passed');
const result = {};
for (const target of targets) {
  const { runtime } = target;
  const support = lifecycle.runtimeThrough[runtime];
  date(support);
  assert.ok(today <= support && support <= lifecycle.al2023Through, 'Runtime support boundary: ' + runtime);
  assert.equal(registryDigest(target.channel), target.digest, 'Compatibility channel drift');
  const { record, mirrors } = verifyPublicStableMirrors(target);
  const release = JSON.parse(run('gh', ['api', 'repos/' + repository + '/releases/tags/' + target.releaseTag]));
  assert.ok(!release.prerelease && !release.draft && release.html_url === record.releaseUrl);
  assert.match(record.scanHashes['security.json'], /^sha256:[a-f0-9]{64}$/);
  for (const [name, digest] of Object.entries(record.scanHashes)) {
    assert.ok(release.assets.some(asset => asset.name === name && asset.digest === digest &&
      asset.state === 'uploaded' && asset.size > 0), 'Signed security evidence missing: ' + runtime + '/' + name);
  }
  result[runtime] = { reference: mirrors[0].reference, mirrors, release: record.releaseUrl, supportThrough: support };
  console.log(runtime, ...mirrors.map(mirror => mirror.reference), support);
}
for (const family of new Set(targets.map(target => target.variant))) {
  const latest = latestStableRelease(targets.filter(target => target.variant === family));
  for (const host of mirrorHosts) {
    const tag = stableMirror(host, latest).base + ':latest';
    assert.equal(registryDigest(tag), latest.digest, 'Unexpected digest for ' + tag);
  }
}
fs.writeFileSync(process.argv[2], JSON.stringify({ observed: today, runtimes: result }, null, 2) + '\n');
