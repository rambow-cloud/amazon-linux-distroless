import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Build Java only in GitHub Actions');
const arch = process.argv[2];
if (!['amd64', 'arm64'].includes(arch) || process.arch !== (arch === 'amd64' ? 'x64' : 'arm64')) throw new Error('Native architecture required');
const lockFile = 'locks/java21/linux-' + arch + '.json';
const lock = JSON.parse(fs.readFileSync(lockFile));
const inputs = JSON.parse(fs.readFileSync('images/java21/packages.json'));
if (lock.platform !== 'linux/' + arch || lock.releasever !== inputs.releasever ||
    !Object.entries(inputs.roots).every(([v, roots]) => JSON.stringify(lock.variants[v].roots) === JSON.stringify(roots))) throw new Error('Input specification differs from lock');
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const args = ['build', '--platform', lock.platform, '-f', 'images/java21/Dockerfile',
  '--build-arg', 'AL2023_BASE=' + lock.builder, '--build-arg', 'AL2023_RELEASE=' + lock.releasever,
  '--build-arg', 'LOCK_FILE=' + lockFile, '--build-arg', 'SOURCE_DATE_EPOCH=' + lock.source_date_epoch,
  '--build-arg', 'SOURCE_REVISION=' + sha, '--build-arg', 'RELEASE_VERSION=java21-' + sha.slice(0, 12)];
const docker = (...args) => execFileSync('docker', args, { stdio: 'inherit' });
docker(...args, '--target', 'tools', '-t', 'java21-tools:locked', '.');
if (arch === 'amd64') docker('run', '--rm', '--mount', 'type=bind,src=' + process.cwd() + ',dst=/workspace',
  '--entrypoint', '/usr/bin/python3', 'java21-tools:locked', '/tools/test_assemble.py');
for (const target of ['runtime', 'fixture']) docker(...args, '--target', target, '-t', 'al2023-java21-' + target + ':candidate', '.');
fs.mkdirSync('out/java21/' + arch, { recursive: true });
docker(...args, '--target', 'evidence', '--output', 'type=local,dest=out/java21/' + arch, '.');
