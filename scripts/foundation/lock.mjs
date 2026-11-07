import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { configuration, nativeArchitecture } from '../runtime/config.mjs';
import { dockerfile } from '../runtime/dockerfile.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Resolve foundation RPMs only in GitHub Actions');
const arch = nativeArchitecture(process.argv[2]);
const mode = process.argv[3];
assert.ok(['check', 'resolve'].includes(mode));
const platform = 'linux/' + arch;
const lockPath = 'locks/foundation/linux-' + arch + '.json';
const current = JSON.parse(fs.readFileSync(lockPath));
assert.equal(current.platform, platform);
const candidatePath = 'out/foundation-lock/' + lockPath;
const spec = JSON.parse(fs.readFileSync('images/upstream/packages.json'));
const inputs = { ...spec, platform, roots: { base: spec.roots.base } };
assert.match(inputs.releasever, /^2023\.\d+\.\d{8}$/);
assert.match(inputs.builder_tag, /^public\.ecr\.aws\/amazonlinux\/amazonlinux(?::2023\.\d+\.\d{8}\.\d+|@sha256:[a-f0-9]{64})$/);
fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
fs.writeFileSync('out/foundation-lock/inputs.json', JSON.stringify(inputs));

const run = (...args) => execFileSync('docker', args, { stdio: 'inherit' });
const capture = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
let builder = current.builder;
if (mode === 'resolve') {
  run('pull', '--platform', platform, inputs.builder_tag);
  const [image] = JSON.parse(capture('image', 'inspect', inputs.builder_tag));
  assert.equal(image.Architecture, arch);
  builder = image.RepoDigests.find(ref => /^public\.ecr\.aws\/amazonlinux\/amazonlinux@sha256:[a-f0-9]{64}$/.test(ref));
  if (inputs.builder_tag.includes('@')) assert.equal(builder, inputs.builder_tag);
} else {
  assert.equal(current.releasever, inputs.releasever);
  assert.deepEqual(current.variants.base.roots, inputs.roots.base);
}
assert.match(builder, /^public\.ecr\.aws\/amazonlinux\/amazonlinux@sha256:[a-f0-9]{64}$/);

const tools = 'foundation-tools:resolve';
execFileSync('docker', ['build', '--platform', platform, '-f', '-', '--target', 'tools',
  '--build-arg', 'AL2023_BASE=' + builder, '--build-arg', 'AL2023_RELEASE=' + inputs.releasever,
  '-t', tools, '.'], { input: dockerfile(configuration('python314')), stdio: ['pipe', 'inherit', 'inherit'] });
const epoch = mode === 'check' ? String(current.source_date_epoch) :
  execFileSync('git', ['log', '-1', '--format=%ct'], { encoding: 'utf8' }).trim();
run('run', '--rm', '--mount', 'type=bind,src=' + process.cwd() + ',dst=/workspace',
  '--entrypoint', '/usr/bin/python3', tools, '/tools/resolve.py',
  '--inputs', '/workspace/out/foundation-lock/inputs.json', '--builder', builder,
  '--epoch', epoch, '--output', '/workspace/' + candidatePath);
const candidate = JSON.parse(fs.readFileSync(candidatePath));
if (mode === 'check') assert.deepEqual(candidate, current, 'Fresh RPM resolution differs from the committed lock');
run('run', '--rm', '--network', 'none',
  '--mount', 'type=bind,src=' + process.cwd() + ',dst=/workspace,readonly',
  '--entrypoint', '/usr/bin/python3',
  tools, '/workspace/scripts/foundation/test_lock.py', '/workspace/' + candidatePath);
