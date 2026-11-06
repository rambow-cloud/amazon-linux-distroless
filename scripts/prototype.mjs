import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const output = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const docker = (...args) => execFileSync('docker', args, { stdio: 'inherit' });
const inputs = JSON.parse(fs.readFileSync('prototype/inputs.json', 'utf8'));
function tools(builder, releasever) {
  docker('build', '--platform', 'linux/amd64', '-f', 'prototype/Dockerfile',
    '--target', 'tools', '--build-arg', 'AL2023_BASE=' + builder,
    '--build-arg', 'AL2023_RELEASE=' + releasever, '-t', 'al2023-prototype-tools:local', '.');
}
if (process.argv[2] === 'lock') {
  docker('pull', '--platform', 'linux/amd64', inputs.builder_tag);
  const image = JSON.parse(output('image', 'inspect', inputs.builder_tag))[0];
  const builder = image.RepoDigests.find(ref => ref.startsWith('public.ecr.aws/amazonlinux/amazonlinux@sha256:'));
  if (!builder) throw new Error('No official builder digest returned');
  tools(builder, inputs.releasever);
  const epoch = execFileSync('git', ['log', '-1', '--format=%ct'], { encoding: 'utf8' }).trim();
  docker('run', '--rm', '--platform', 'linux/amd64',
    '--mount', 'type=bind,src=' + root + ',dst=/workspace',
    '--workdir', '/workspace', '--entrypoint', '/usr/bin/python3',
    'al2023-prototype-tools:local', '/tools/resolve.py',
    '--inputs', '/workspace/prototype/inputs.json', '--builder', builder,
    '--epoch', epoch, '--output', '/workspace/out/linux-amd64.json');
} else if (process.argv[2] === 'build') {
  const lock = JSON.parse(fs.readFileSync('locks/linux-amd64.json', 'utf8'));
  if (!/@sha256:[a-f0-9]{64}$/.test(lock.builder)) throw new Error('Builder digest required');
  const args = ['build', '--platform', 'linux/amd64', '-f', 'prototype/Dockerfile',
    '--build-arg', 'AL2023_BASE=' + lock.builder,
    '--build-arg', 'AL2023_RELEASE=' + lock.releasever,
    '--build-arg', 'SOURCE_DATE_EPOCH=' + lock.source_date_epoch];
  for (const variant of ['base', 'java', 'demo']) {
    docker(...args, '--target', variant, '-t', 'al2023-distroless-' + variant + ':prototype', '.');
  }
  fs.mkdirSync('out/prototype', { recursive: true });
  docker(...args, '--target', 'evidence', '--output', 'type=local,dest=out/prototype', '.');
} else {
  throw new Error('Usage: node scripts/prototype.mjs lock|build (GitHub Actions runner)');
}
