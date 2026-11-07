import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { configuration, nativeArchitecture, rpmLock } from './config.mjs';
import { dockerfile } from './dockerfile.mjs';
import { fetchUpstream } from './upstream.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Build runtimes only in GitHub Actions');
const config = configuration(process.argv[2]);
const arch = nativeArchitecture(process.argv[3]);
const { id, variant, version, executable } = config;
const lockFile = rpmLock(variant, arch);
const lock = JSON.parse(fs.readFileSync(lockFile));
const upstreamLock = JSON.parse(fs.readFileSync('locks/upstream/' + id + '-' + arch + '.json'));
const inputs = JSON.parse(fs.readFileSync('images/upstream/packages.json'));
assert.equal(lock.platform, 'linux/' + arch);
assert.equal(lock.releasever, inputs.releasever);
for (const name of ['base', variant]) assert.deepEqual(lock.variants[name].roots, inputs.roots[name]);
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const out = 'out/' + id + '/' + arch;
const input = out + '/input';
await fetchUpstream(config, arch, input, upstreamLock);

const python = variant === 'python';
const runtime = {
  id,
  variant,
  identity_packages: [],
  directories: ['app', 'tmp', ...(python ? ['opt/python/site-packages'] : [])],
  seeds: python ? [
    '/opt/cpython/bin/python' + version,
    '/opt/cpython/lib/python' + version,
    '/usr/share/licenses/python' + version + '-upstream',
    '/etc/pki/tls/openssl.cnf',
    '/etc/crypto-policies/back-ends/opensslcnf.config',
    '/usr/lib64/ossl-modules',
  ] : [executable, '/usr/share/licenses/nodejs' + version + '-upstream'],
  aliases: python ? {
    [executable]: '/opt/cpython/bin/python' + version,
    '/usr/bin/python3': '/opt/cpython/bin/python' + version,
  } : { '/usr/bin/node': executable },
  allowed_paths: python ? ['usr/bin/python3'] : [],
  excluded_names: python ? [
    '__pycache__', 'ensurepip', 'idlelib', 'tkinter', 'turtledemo', 'test', 'tests', 'site-packages',
    'config-' + version + '-' + (arch === 'amd64' ? 'x86_64' : 'aarch64') + '-linux-gnu',
  ] : [],
};
fs.writeFileSync(input + '/runtime.json', JSON.stringify(runtime));

const args = ['build', '--platform', lock.platform, '-f', '-',
  '--build-context', 'upstream=' + input,
  '--build-arg', 'AL2023_BASE=' + lock.builder,
  '--build-arg', 'AL2023_RELEASE=' + lock.releasever,
  '--build-arg', 'LOCK_FILE=' + lockFile,
  '--build-arg', 'RUNTIME_VARIANT=' + variant,
  '--build-arg', 'RUNTIME_LINE=' + version,
  '--build-arg', 'ARCHIVE_SHA256=' + upstreamLock.sha256,
  '--build-arg', 'SOURCE_DATE_EPOCH=' + lock.source_date_epoch,
  '--build-arg', 'SOURCE_REVISION=' + sha,
  '--build-arg', 'RELEASE_VERSION=' + id + '-' + sha.slice(0, 12)];
const definition = dockerfile(config);
const build = (...target) => execFileSync('docker', [...args, ...target, '.'], {
  input: definition, stdio: ['pipe', 'inherit', 'inherit'],
});
build('--target', 'tools', '-t', id + '-tools:locked');
if (arch === 'amd64') {
  execFileSync('docker', ['run', '--rm', '--entrypoint', '/usr/bin/python3',
    id + '-tools:locked', '/tools/test_assemble.py'], { stdio: 'inherit' });
}
for (const target of ['runtime', 'fixture']) {
  build('--target', target, '-t', 'al2023-' + id + '-' + target + ':candidate');
}
build('--target', 'evidence', '--output', 'type=local,dest=' + out);
