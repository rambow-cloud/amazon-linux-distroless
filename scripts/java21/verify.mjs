import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { javaMajor } from './config.mjs';
const major = javaMajor(), line = 'java' + major;
import { inventorySbom } from '../../security/compare-lib.mjs';
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Verify Java in GitHub Actions');
const arch = process.argv[2];
const out = 'out/' + line + '/' + arch;
const docker = (...args) => execFileSync('docker', args, { stdio: 'inherit' });
const capture = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const lock = JSON.parse(fs.readFileSync('locks/' + line + '/linux-' + arch + '.json'));
const inventory = JSON.parse(fs.readFileSync(out + '/inventory.json'));
const image = JSON.parse(capture('image', 'inspect', 'al2023-' + line + '-runtime:candidate'))[0];
assert.equal(image.Architecture, arch); assert.equal(image.Os, 'linux'); assert.equal(image.Config.User, '65532:65532');
assert.deepEqual(image.Config.Entrypoint, ['/usr/bin/java']); assert.deepEqual(image.Config.Cmd, ['-version']);
assert.ok(image.Config.Env.includes('JAVA_HOME=/opt/java'));
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(image.Config.Labels['org.opencontainers.image.revision'], sourceCommit);
docker('save', '--output', out + '/image.tar', 'al2023-' + line + '-runtime:candidate');
const tools = ['run', '--rm', '--mount', 'type=bind,src=' + process.cwd() + ',dst=/workspace', '--entrypoint', '/usr/bin/python3', line + '-tools:locked'];
docker(...tools, '/java-tools/check_image.py', '/workspace/' + out + '/image.tar', 'al2023-' + line + '-runtime:candidate', '/workspace/' + out + '/inventory.json');
const hardened = ['run', '--rm', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
  '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=32m'];
assert.equal(inventory.runtime_transform.java_major, major);
const fixture = 'al2023-' + line + '-fixture:candidate';
const sample = JSON.parse(capture(...hardened, '--network', 'none', '--entrypoint', '/usr/bin/java', fixture,
  '-Dal2023.expectedMajor=' + major, '-javaagent:/fixture/probe.jar', '-jar', '/fixture/probe.jar', 'agent'));
assert.equal(sample.arch, arch === 'amd64' ? 'amd64' : 'aarch64'); assert.ok(sample.compilerAbsent); assert.ok(sample.java.startsWith(major + '.'));
const exit = spawnSync('docker', [...hardened, '--network', 'none', fixture, 'exit'], { encoding: 'utf8' });
assert.equal(exit.status, 17);
const shell = spawnSync('docker', [...hardened, '--network', 'none', '--entrypoint', '/bin/sh', 'al2023-' + line + '-runtime:candidate', '-c', 'true'], { encoding: 'utf8' });
assert.notEqual(shell.status, 0); assert.match(shell.stderr, /\/bin\/sh/);
const network = line + '-contract-' + arch, server = line + '-tls-' + arch;
const networkProbes = {};
docker('network', 'create', '--internal', network);
try {
  docker('run', '-d', '--name', server, '--network', network, '--network-alias', 'tls-fixture', '--network-alias', 'wrong-name',
    '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=32m', fixture, 'serve');
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (capture('logs', server).includes('READY')) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.ok(ready, 'Controlled TLS fixture did not start');
  for (const [mode, args] of [['tls', ['tls-fixture']], ['hostname', []], ['untrusted', []]]) {
    networkProbes[mode] = JSON.parse(capture(...hardened, '--network', network, fixture, mode, ...args));
  }
  docker('stop', '--time', '10', server);
  const state = JSON.parse(capture('inspect', server))[0].State;
  assert.equal(state.ExitCode, 143, 'SIGTERM exit status was not preserved');
  assert.match(capture('logs', server), /shutdown-hook-ran/);
} finally {
  docker('rm', '-f', server); docker('network', 'rm', network);
}
const sbom = inventorySbom(inventory, lock, image.Id);
fs.writeFileSync(out + '/sbom.cdx.json', JSON.stringify(sbom.bom, null, 2) + '\n');
fs.writeFileSync(out + '/payload-packages.json', JSON.stringify(sbom.coverage, null, 2) + '\n');
fs.copyFileSync('locks/' + line + '/linux-' + arch + '.json', out + '/lock.json');
const report = { schema_version: 1, javaMajor: major, sourceCommit, platform: 'linux/' + arch, image: { id: image.Id, size: image.Size,
  tag: 'al2023-' + line + '-runtime:candidate', config: image.Config }, sample, networkProbes,
  checks: ['native architecture', 'exact final filesystem inventory', 'PID 1 and non-root', 'read-only rootfs/tmpfs',
    'Java agent', 'JVM trust anchors', 'headless font/ImageIO', 'compiler capability absent', 'JAVA_HOME/UTF-8/UTC',
    'controlled service-name resolution', 'TLS trust', 'TLS hostname rejection', 'TLS untrusted-root rejection', 'SIGTERM shutdown hook/143', 'application exit 17', 'shell absent'],
  runtimeModules: inventory.runtime_transform.modules,
  limitations: ['Generic runtime module contract; no application-specific minimization', 'Project-wide stable release/signing/support milestones remain separate',
    'ALAS unfixed-vulnerability coverage requires separate review; a clean scan is not proof of no risk'] };
fs.writeFileSync(out + '/verification.json', JSON.stringify(report, null, 2) + '\n');
fs.writeFileSync(out + '/summary.md', '# Java ' + major + ' ' + arch + '\n\n' +
  '- Java: ' + sample.java + '\n- Runtime bytes: ' + image.Size + '\n- Selected payload packages: ' + sbom.coverage.selected.length +
  '\n- JRE modules: ' + report.runtimeModules.length + '\n- Native runtime checks passed: ' + report.checks.join(', ') + '\n');
// Matching source delivery is collected after runtime checks succeed.
docker(...tools, '/tools/assemble.py', 'fetch-sources', '/workspace/locks/' + line + '/linux-' + arch + '.json', '/workspace/' + out + '/sources');
execFileSync('tar', ['-czf', out + '/sources.tar.gz', '-C', out, 'sources'], { stdio: 'inherit' });
execFileSync('gzip', ['-n', out + '/image.tar'], { stdio: 'inherit' });
execFileSync('git', ['archive', '--format=tar.gz', '--output=' + out + '/project-source.tar.gz', 'HEAD']);
console.log(fs.readFileSync(out + '/summary.md', 'utf8'));
