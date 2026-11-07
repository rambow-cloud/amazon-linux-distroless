import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { configuration, nativeArchitecture } from '../runtime/config.mjs';
import { dockerfile } from '../runtime/dockerfile.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Build foundation images only in GitHub Actions');
const arch = nativeArchitecture(process.argv[2]);
const platform = 'linux/' + arch;
const lockFile = 'locks/foundation/linux-' + arch + '.json';
const lock = JSON.parse(fs.readFileSync(lockFile));
const spec = JSON.parse(fs.readFileSync('images/upstream/packages.json'));
assert.equal(lock.platform, platform);
assert.equal(lock.releasever, spec.releasever);
assert.match(lock.builder, /^public\.ecr\.aws\/amazonlinux\/amazonlinux@sha256:[a-f0-9]{64}$/);
assert.deepEqual(lock.variants.base.roots, spec.roots.base);
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const output = path.resolve('out/foundation');
const candidate = path.join(output, 'candidate');
fs.mkdirSync(candidate, { recursive: true });
const tools = 'foundation-tools:locked';
const run = (program, args, options = {}) => execFileSync(program, args, { stdio: 'inherit', ...options });
const docker = (...args) => run('docker', args);
run('docker', ['build', '--platform', platform, '-f', '-', '--target', 'tools',
  '--build-arg', 'AL2023_BASE=' + lock.builder, '--build-arg', 'AL2023_RELEASE=' + lock.releasever,
  '-t', tools, '.'], { input: dockerfile(configuration('python314')), stdio: ['pipe', 'inherit', 'inherit'] });
for (const mode of ['fetch', 'assemble', 'sources']) {
  docker('run', '--rm', ...(mode === 'assemble' ? ['--network', 'none'] : []),
    '--mount', 'type=bind,src=' + process.cwd() + ',dst=/workspace,readonly',
    '--mount', 'type=bind,src=' + candidate + ',dst=/candidate',
    '--entrypoint', '/usr/bin/python3', tools, '/workspace/scripts/foundation/assemble.py',
    mode, '/workspace/' + lockFile, '/candidate/rpms', '/candidate');
}
const evidence = path.join(output, 'evidence');
fs.mkdirSync(evidence, { recursive: true });
const imageReports = {};
for (const variant of ['static', 'base']) {
  const tag = 'al2023-foundation-' + variant + ':candidate';
  const archive = path.join(evidence, variant + '-image.tar');
  const inventory = path.join(evidence, variant + '-inventory.json');
  docker('build', '--platform', platform, '-f', 'images/foundation/Dockerfile',
    '--build-arg', 'SOURCE_DATE_EPOCH=' + lock.source_date_epoch,
    '--build-arg', 'SOURCE_REVISION=' + commit, '--build-arg', 'FOUNDATION_VARIANT=' + variant,
    '-t', tag, path.join(candidate, variant));
  const [image] = JSON.parse(execFileSync('docker', ['image', 'inspect', tag], { encoding: 'utf8' }));
  assert.equal(image.Architecture, arch);
  assert.equal(image.Os, 'linux');
  assert.equal(image.Config.User, '65532:65532');
  assert.equal(image.Config.WorkingDir, '/app');
  assert.ok(!image.Config.Entrypoint?.length && !image.Config.Cmd?.length);
  docker('save', '-o', archive, tag);
  fs.copyFileSync(path.join(candidate, variant, 'inventory.json'), inventory);
  run('python3', ['scripts/foundation/check_image.py', archive, tag, inventory]);
  run('gzip', ['-n', archive]);
  imageReports[variant] = { tag, id: image.Id, unpackedImageBytes: image.Size,
    gzipDockerArchiveBytes: fs.statSync(archive + '.gz').size };
}
fs.copyFileSync(lockFile, path.join(evidence, 'lock.json'));
run('git', ['archive', '--format=tar.gz', '--output=' + path.join(evidence, 'project-source.tar.gz'), commit]);
run('tar', ['-czf', path.join(evidence, 'sources.tar.gz'), '-C', candidate, 'sources']);
fs.writeFileSync(path.join(evidence, 'build.json'), JSON.stringify({ commit, platform, images: imageReports }, null, 2) + '\n');
