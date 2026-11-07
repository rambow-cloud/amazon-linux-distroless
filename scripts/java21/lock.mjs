import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { javaMajor } from './config.mjs';
const major = javaMajor(), line = 'java' + major;
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Resolve Java inputs in Actions');
const arch = process.argv[2];
if (!['amd64', 'arm64'].includes(arch)) throw new Error('Expected amd64 or arm64');
const inputs = JSON.parse(fs.readFileSync('images/' + line + '/packages.json'));
inputs.platform = 'linux/' + arch;
fs.mkdirSync('out/' + line + '-lock', { recursive: true });
fs.writeFileSync('out/' + line + '-lock/inputs.json', JSON.stringify(inputs));
const docker = (...args) => execFileSync('docker', args, { stdio: 'inherit' });
const capture = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
docker('pull', '--platform', inputs.platform, inputs.builder_tag);
const image = JSON.parse(capture('image', 'inspect', inputs.builder_tag))[0];
if (image.Architecture !== arch) throw new Error('Native runner/image architecture mismatch');
const builder = image.RepoDigests.find(ref => ref.startsWith('public.ecr.aws/amazonlinux/amazonlinux@sha256:'));
if (!builder) throw new Error('Missing official immutable builder digest');
docker('build', '--platform', inputs.platform, '-f', 'images/java21/Dockerfile', '--target', 'tools',
  '--build-arg', 'JAVA_MAJOR=' + major, '--build-arg', 'AL2023_BASE=' + builder, '--build-arg', 'AL2023_RELEASE=' + inputs.releasever,
  '-t', line + '-tools:locked', '.');
docker('run', '--rm', '--platform', inputs.platform, '--mount', 'type=bind,src=' + process.cwd() + ',dst=/workspace',
  '--entrypoint', '/usr/bin/python3', line + '-tools:locked', '/tools/resolve.py',
  '--inputs', '/workspace/out/' + line + '-lock/inputs.json', '--builder', builder,
  '--epoch', execFileSync('git', ['log', '-1', '--format=%ct'], { encoding: 'utf8' }).trim(),
  '--output', '/workspace/out/' + line + '-lock/linux-' + arch + '.json');

const javaHome = '/usr/lib/jvm/java-' + major + '-amazon-corretto.' + (arch === 'amd64' ? 'x86_64' : 'aarch64');
fs.writeFileSync('out/' + line + '-lock/modules-' + arch + '.txt',capture('run','--rm','--entrypoint',javaHome + '/bin/java',line + '-tools:locked','--list-modules') + '\n');
