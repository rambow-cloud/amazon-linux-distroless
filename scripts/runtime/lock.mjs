import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { nativeArchitecture, runtimes, rpmLock } from './config.mjs';
import { dockerfile } from './dockerfile.mjs';
import { fetchUpstream } from './upstream.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Resolve runtime inputs only in GitHub Actions');
const variant = process.argv[2];
const arch = nativeArchitecture(process.argv[3]);
const rpmOnly = process.argv[4] === '--rpm-only';
assert.ok(process.argv[4] === undefined || rpmOnly);
const configs = Object.entries(runtimes).filter(([, config]) => config.variant === variant);
assert.ok(configs.length, 'Unsupported language family');

const platform = 'linux/' + arch;
const spec = JSON.parse(fs.readFileSync('images/upstream/packages.json'));
const inputs = { ...spec, platform, roots: { base: spec.roots.base, [variant]: spec.roots[variant] } };
const output = 'out/resolved';
fs.mkdirSync(output + '/locks/upstream', { recursive: true });
fs.writeFileSync(output + '/inputs.json', JSON.stringify(inputs));
const docker = (...args) => execFileSync('docker', args, { stdio: 'inherit' });
const capture = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
docker('pull', '--platform', platform, inputs.builder_tag);
const [image] = JSON.parse(capture('image', 'inspect', inputs.builder_tag));
assert.equal(image.Architecture, arch);
const builder = image.RepoDigests.find(ref => /^public\.ecr\.aws\/amazonlinux\/amazonlinux@sha256:[a-f0-9]{64}$/.test(ref));
assert.ok(builder, 'Official immutable builder digest missing');
const tools = 'upstream-tools:resolve';
execFileSync('docker', ['build', '--platform', platform, '-f', '-', '--target', 'tools',
  '--build-arg', 'AL2023_BASE=' + builder, '--build-arg', 'AL2023_RELEASE=' + inputs.releasever,
  '-t', tools, '.'], { input: dockerfile(configs[0][1]), stdio: ['pipe', 'inherit', 'inherit'] });
const lockFile = output + '/' + rpmLock(variant, arch);
const epoch = execFileSync('git', ['log', '-1', '--format=%ct'], { encoding: 'utf8' }).trim();
docker('run', '--rm', '--mount', 'type=bind,src=' + process.cwd() + ',dst=/workspace',
  '--entrypoint', '/usr/bin/python3', tools, '/tools/resolve.py',
  '--inputs', '/workspace/' + output + '/inputs.json', '--builder', builder,
  '--epoch', epoch, '--output', '/workspace/' + lockFile);
for (const [id, config] of rpmOnly ? [] : configs) {
  const directory = output + '/downloads/' + id;
  const record = await fetchUpstream(config, arch, directory);
  fs.writeFileSync(output + '/locks/upstream/' + id + '-' + arch + '.json', JSON.stringify(record, null, 2) + '\n');
}
