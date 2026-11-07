import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { validateIndex } from './java21-policy.mjs';
import { attestedPredicates, issuer, latestStableRelease, repository, stableIdentity,
  stablePlan, stablePredicate } from './stable-policy.mjs';

const capture = (command, args) => execFileSync(command, args, {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
const docker = (...args) => capture('docker', args);
const cosign = (verb, identity, ref, ...args) => capture('cosign', [verb,
  '--certificate-identity', identity, '--certificate-oidc-issuer', issuer, ...args, ref]);
const digestFor = ref => /^Digest:\s*(sha256:[a-f0-9]{64})$/m.exec(docker('buildx', 'imagetools', 'inspect', ref))?.[1];

assert.equal(process.env.GITHUB_ACTIONS, 'true');
assert.equal(process.env.GITHUB_REPOSITORY, repository);
assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch');
const registry = process.env.MIRROR_REGISTRY;
assert.ok(['both', 'ghcr', 'quay'].includes(registry));
const arch = process.env.MIRROR_ARCH;
assert.ok(['amd64', 'arm64'].includes(arch));
assert.equal(docker('info', '--format', '{{.Architecture}}'), arch === 'amd64' ? 'x86_64' : 'aarch64');
const platform = 'linux/' + arch;
const candidates = JSON.parse(fs.readFileSync('releases/stable-candidates.json'));
const plans = Object.entries(candidates).map(([runtime, candidate]) => stablePlan(runtime, candidate));

for (const host of [
  ...(registry !== 'quay' ? ['ghcr.io'] : []),
  ...(registry !== 'ghcr' ? ['quay.io'] : []),
]) {
  for (const plan of plans) {
    const base = host + '/rambow-cloud/' + plan.variant;
    const ref = base + '@' + plan.digest;
    for (const tag of [plan.line, plan.version, plan.version + '-r' + plan.revision]) {
      assert.equal(digestFor(base + ':' + tag), plan.digest, 'Unexpected digest for ' + base + ':' + tag);
    }
    cosign('verify', plan.previewIdentity, ref);
    const [record] = attestedPredicates(cosign('verify-attestation', stableIdentity, ref, '--type', stablePredicate),
      stablePredicate, plan.digest).filter(record => record.runtime === plan.runtime &&
        record.version === plan.version && record.revision === plan.revision && record.reference === plan.reference);
    assert.ok(record, 'The mirror does not have the reviewed stable promotion');
    validateIndex(JSON.parse(docker('buildx', 'imagetools', 'inspect', '--raw', ref)), record.leaves);
    const leaf = record.leaves[arch];
    attestedPredicates(cosign('verify-attestation', plan.previewIdentity, base + '@' + leaf, '--type', 'cyclonedx'), null, leaf);
    docker('pull', '--platform', platform, ref);
    assert.equal(docker('image', 'inspect', '--format', '{{.Os}}/{{.Architecture}} {{.Config.User}}', ref),
      platform + ' 65532:65532');
    const version = docker('run', '--rm', '--platform', platform, '--read-only', '--network', 'none',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', ref, '--version');
    assert.ok(version.split(/[^.\d]+/).includes(plan.version), 'Unexpected native runtime version: ' + version);
    console.log(base + ':' + plan.line + ' → ' + plan.digest + ' (' + platform + ')');
  }
  for (const family of new Set(plans.map(plan => plan.variant))) {
    const best = latestStableRelease(plans.filter(plan => plan.variant === family));
    const latest = host + '/rambow-cloud/' + family + ':latest';
    assert.equal(digestFor(latest), best.digest, 'Unexpected highest stable release for ' + latest);
    console.log(latest + ' → ' + best.version + '-r' + best.revision);
  }
}
