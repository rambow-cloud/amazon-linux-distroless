import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { nativeArchitecture } from '../runtime/config.mjs';
import { attestedPredicates, issuer, repository } from './stable-policy.mjs';
import { sha256File } from './file-digest.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Verify native public pulls in Actions');
const tag = process.argv[2];
const arch = nativeArchitecture(process.argv[3]);
assert.match(tag, /^foundation-2023\.\d+\.\d{8}-r[1-9]\d*$/);
const dir = 'out/foundation-pull';
const file = arch + '-build.json';
const read = name => JSON.parse(fs.readFileSync(dir + '/' + name, 'utf8'));
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });
const capture = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
run('gh', ['release', 'download', tag, '--repo', repository, '--dir', dir,
  '--pattern', 'foundation-release.json', '--pattern', file]);
const record = read('foundation-release.json');
assert.equal(record.releaseTag, tag);
const build = read(file);
assert.equal(build.commit, record.sourceCommit);
assert.equal(build.platform, 'linux/' + arch);
assert.equal('sha256:' + sha256File(dir + '/' + file), record.assets[file]);
const identity = 'https://github.com/' + repository + '/.github/workflows/foundation-release.yml@refs/heads/main';
const trust = ['--certificate-identity', identity, '--certificate-oidc-issuer', issuer];
const predicate = 'https://rambow-cloud.github.io/amazon-linux-distroless/foundation-stable/v1';
for (const variant of ['static', 'base']) {
  const image = record.images[variant];
  assert.equal(image.reference, 'ghcr.io/' + repository + '/' + variant + '@' + image.digest);
  run('cosign', ['verify', ...trust, image.reference]);
  const proof = capture('cosign', ['verify-attestation', '--type', predicate, ...trust, image.reference]);
  assert.ok(attestedPredicates(proof, predicate, image.digest).some(x => isDeepStrictEqual(x, record)));
  run('cosign', ['verify-attestation', '--type', 'cyclonedx', ...trust, image.base + '@' + image.leaves[arch]]);
  run('docker', ['pull', '--platform', 'linux/' + arch, image.reference]);
  const [downloaded] = JSON.parse(capture('docker', ['image', 'inspect', image.reference]));
  assert.equal(downloaded.Architecture, arch);
  assert.equal(downloaded.Id, build.images[variant].id);
  assert.equal(downloaded.Config.User, '65532:65532');
  console.log(variant, 'linux/' + arch, image.leaves[arch], downloaded.Id);
}
