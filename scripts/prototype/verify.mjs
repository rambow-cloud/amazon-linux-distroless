import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Run verification in GitHub Actions');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
process.chdir(root);
const command = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const docker = (...args) => execFileSync('docker', args, { stdio: 'inherit' });
const mountedTools = ['run', '--rm', '--mount', 'type=bind,src=' + root + ',dst=/workspace',
  '--entrypoint', '/usr/bin/python3', 'al2023-prototype-tools:local'];
docker(...mountedTools, '/tools/test_assemble.py');
const images = {};
for (const variant of ['base', 'java', 'demo']) {
  const name = 'al2023-distroless-' + variant + ':prototype';
  const image = JSON.parse(command('image', 'inspect', name))[0];
  if (image.Config.User !== '65532:65532' || image.Architecture !== 'amd64' || image.Os !== 'linux') {
    throw new Error('Wrong runtime user/platform: ' + variant);
  }
  images[variant] = { name, id: image.Id, size: image.Size, user: image.Config.User,
    platform: image.Os + '/' + image.Architecture, entrypoint: image.Config.Entrypoint, cmd: image.Config.Cmd };
  if (variant !== 'demo') {
    const container = command('create', '--entrypoint', '/not-executed', name);
    try {
      docker('export', '--output', 'out/prototype/' + variant + '-rootfs.tar', container);
    } finally {
      docker('rm', container);
    }
  }
}
docker(...mountedTools, '/tools/check_export.py');
const hardened = ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges:true',
  '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=16m'];
const sample = JSON.parse(command(...hardened, images.demo.name));
if (sample.uid !== 65532 || sample.trustAnchors <= 0 || !sample.readOnlyRootfs ||
    !sample.tmpfs || !sample.java.startsWith('21.')) throw new Error('Java demo contract failed');
const exit = spawnSync('docker', [...hardened, images.demo.name, '--exit-17'], { encoding: 'utf8' });
if (exit.status !== 17) throw new Error('Application exit code was not preserved');
const shell = spawnSync('docker', [...hardened, '--entrypoint', '/bin/sh', images.java.name, '-c', 'true'],
  { encoding: 'utf8' });
if (shell.status === 0 || !shell.stderr.includes('/bin/sh')) throw new Error('Shell absence probe failed');
docker(...mountedTools, '/tools/assemble.py', 'fetch-sources',
  '/workspace/locks/linux-amd64.json', '/workspace/out/prototype/sources');
fs.copyFileSync('locks/linux-amd64.json', 'out/prototype/linux-amd64.json');
for (const variant of ['base', 'java']) fs.unlinkSync('out/prototype/' + variant + '-rootfs.tar');
const report = { prototype: true, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runner: process.platform + '/' + process.arch, images, sample,
  checks: ['assembler trust-boundary tests', 'final filesystem inventory equality', 'non-root execution',
    'read-only rootfs', 'tmpfs writes', 'JVM trust anchors', 'UTC', 'application exit code', 'shell absence',
    'verified matching source RPMs'],
  limits: ['amd64 prototype only', 'no DNS/TLS handshake test yet', 'no vulnerability/release-signing gate yet',
    'not jlink module-minimized', 'reproducible inputs; bit-identical rebuilds not yet measured'] };
fs.writeFileSync('out/prototype/verification.json', JSON.stringify(report, null, 2) + '\n');
const fence = String.fromCharCode(96).repeat(3);
const summary = '# AL2023 Java prototype\n\n' +
  '| Image | Uncompressed image bytes | Runtime user |\n| --- | ---: | --- |\n' +
  Object.entries(images).map(([key, value]) => '| ' + key + ' | ' + value.size + ' | ' + value.user + ' |').join('\n') +
  '\n\nJava demo output:\n\n' + fence + 'json\n' + JSON.stringify(sample, null, 2) + '\n' + fence + '\n\n' +
  'Download includes Docker images, matching source RPMs, project source, lock, inventories, and verification evidence. This is an experimental amd64 preview.\n';
fs.writeFileSync('out/prototype/summary.md', summary);
console.log(summary);
