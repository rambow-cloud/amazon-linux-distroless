import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { nativeArchitecture } from '../runtime/config.mjs';
import { attestedPredicates, issuer, stableIdentity, stablePlan, stablePredicate } from './stable-policy.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Build consumer examples only in GitHub Actions');
const runtime = process.argv[2];
const arch = nativeArchitecture(process.argv[3]);
const examples = {
  java21: ['examples/java-app/Dockerfile', 'examples/java-app', 'JAVA_RUNTIME'],
  python314: ['examples/python-app/Dockerfile', '.', 'PYTHON_RUNTIME'],
  nodejs24: ['examples/node-app/Dockerfile', '.', 'NODE_RUNTIME'],
};
assert.ok(Object.hasOwn(examples, runtime));
const plan = stablePlan(runtime, JSON.parse(fs.readFileSync('releases/stable-candidates.json'))[runtime]);
const base = 'ghcr.io/rambow-cloud/' + plan.variant;
const reference = base + '@' + plan.digest;
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const capture = (cmd, args) => execFileSync(cmd, args, {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
const trusted = id => ['--certificate-identity', id, '--certificate-oidc-issuer', issuer];
run('cosign', ['verify', ...trusted(plan.previewIdentity), reference]);
const envelope = capture('cosign', ['verify-attestation', '--type', stablePredicate,
  ...trusted(stableIdentity), reference]);
const record = attestedPredicates(envelope, stablePredicate, plan.digest).find(candidate =>
  candidate.reference === plan.reference && candidate.runtime === runtime && candidate.releaseTag === plan.releaseTag);
assert.ok(record, 'Example pin must match an accepted stable release');
const leaf = record.leaves[arch];
assert.match(leaf, /^sha256:[a-f0-9]{64}$/);
run('cosign', ['verify-attestation', '--type', 'cyclonedx',
  ...trusted(plan.previewIdentity), base + '@' + leaf]);

const [dockerfile, context, argument] = examples[runtime];
const platform = 'linux/' + arch;
const tag = 'al2023-consumer-' + runtime + ':tested';
run('docker', ['build', '--platform', platform, '--build-arg', argument + '=' + reference,
  '-f', dockerfile, '-t', tag, context]);
const [image] = JSON.parse(capture('docker', ['image', 'inspect', tag]));
assert.equal(image.Architecture, arch);
assert.equal(image.Os, 'linux');
assert.equal(image.Config.User, '65532:65532');
assert.ok(image.Config.Entrypoint[0].startsWith('/usr/bin/'));
const hardened = ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=32m', tag];
const standard = capture('docker', hardened);
const commonjs = runtime === 'nodejs24' ? capture('docker', [...hardened, '/app/main.cjs']) : null;
if (runtime === 'java21') assert.ok(standard.includes('AL2023 Java ' + plan.version));
if (runtime === 'python314') assert.match(standard, /'nativeAnswer': 42/);
if (runtime === 'nodejs24') {
  assert.match(standard, /nativeAnswer: 42/);
  assert.match(commonjs, /nativeAnswer: 42/);
}
fs.mkdirSync('out/consumer', { recursive: true });
fs.writeFileSync('out/consumer/verification.json', JSON.stringify({
  runtime, version: plan.version, platform, reference, leaf,
  applicationImage: image.Id, release: record.releaseUrl, standard, commonjs,
  nonroot: image.Config.User, readOnly: true, tmpfs: '/tmp', capabilities: [],
}, null, 2) + '\n');
console.log(standard);
