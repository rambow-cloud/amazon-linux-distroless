import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { nativeArchitecture } from '../runtime/config.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Verify foundation images only in GitHub Actions');
const arch = nativeArchitecture(process.argv[2]);
const output = path.resolve('out/foundation');
const fixture = path.join(output, 'fixture');
const evidence = path.join(output, 'evidence');
const build = JSON.parse(fs.readFileSync(path.join(evidence, 'build.json')));
assert.equal(build.platform, 'linux/' + arch);
const capture = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 60_000 }).trim();
const run = (cmd, args, options) => execFileSync(cmd, args, { stdio: 'inherit', timeout: 120_000, ...options });
const docker = (...args) => capture('docker', args);
const bind = (source, destination, readonly = true) => ['--mount',
  'type=bind,src=' + source + ',dst=' + destination + (readonly ? ',readonly' : '')];

fs.mkdirSync(fixture, { recursive: true });
run('go', ['build', '-trimpath', '-o', path.join(fixture, 'go-probe'), 'examples/foundation/probe.go'],
  { env: { ...process.env, CGO_ENABLED: '0', GOTOOLCHAIN: 'local', GOPROXY: 'off' } });
assert.doesNotMatch(capture('readelf', ['-l', path.join(fixture, 'go-probe')]), /INTERP/, 'Go fixture must be static');
run('docker', ['run', '--rm', '--network', 'none', ...bind(path.resolve('examples/foundation'), '/source'),
  ...bind(fixture, '/fixture', false), '--entrypoint', '/usr/bin/gcc', 'foundation-tools:locked',
  '-Wall', '-Wextra', '-Werror', '-o', '/fixture/c-probe', '/source/probe.c']);
const interpreter = arch === 'amd64' ? '/lib64/ld-linux-x86-64.so.2' : '/lib/ld-linux-aarch64.so.1';
assert.ok(capture('readelf', ['-l', path.join(fixture, 'c-probe')]).includes('interpreter: ' + interpreter + ']'));
run('openssl', ['req', '-new', '-x509', '-newkey', 'rsa:2048', '-noenc', '-days', '1',
  '-subj', '/CN=fixture.test', '-addext', 'subjectAltName=DNS:fixture.test',
  '-keyout', path.join(fixture, 'key.pem'), '-out', path.join(fixture, 'cert.pem')]);
fs.chmodSync(path.join(fixture, 'key.pem'), 0o644);

const network = docker('network', 'create', '--internal', 'foundation-contract');
const containers = [];
const hardening = ['--network', network, '--read-only', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:rw,nosuid,nodev,noexec,size=16m,mode=1777',
  ...bind(fixture, '/fixture')];
const entry = (tag, probe, ...args) => [...hardening, '--entrypoint', '/fixture/' + probe, tag, ...args];
const launch = args => {
  const id = docker('run', '--detach', ...args);
  containers.push(id);
  return id;
};
async function ready(id) {
  for (let n = 0; n < 20; n++) {
    if (docker('logs', id).includes('READY')) return;
    if (docker('inspect', '--format', '{{.State.Running}}', id) !== 'true') break;
    await setTimeout(500);
  }
  throw new Error('Fixture failed to start: ' + docker('logs', id));
}
const results = {};
try {
  const server = launch([...hardening, '--network-alias', 'fixture.test', '--network-alias', 'other.test',
    '--entrypoint', '/fixture/go-probe', build.images.static.tag, 'serve']);
  await ready(server);
  for (const [variant, { tag, id }] of Object.entries(build.images)) {
    const probe = variant === 'static' ? 'go-probe' : 'c-probe';
    const probeOutput = docker('run', '--rm', ...entry(tag, probe, 'check'));
    const tlsOutput = variant === 'static' ? probeOutput : docker('run', '--rm', ...entry(tag, 'go-probe', 'check'));
    const child = launch(entry(tag, probe, 'signal'));
    await ready(child);
    docker('kill', '--signal=TERM', child);
    assert.equal(docker('wait', child), '42', 'The exec-form PID 1 must receive SIGTERM');
    const exit = spawnSync('docker', ['run', '--rm', ...entry(tag, probe, 'exit')], { encoding: 'utf8', timeout: 20_000 });
    assert.equal(exit.status, 37, exit.error?.message || exit.stderr);
    for (const missing of ['/bin/sh', '/usr/bin/rpm', '/usr/bin/dnf']) {
      const denied = spawnSync('docker', ['run', '--rm', ...hardening, '--entrypoint', missing, tag],
        { encoding: 'utf8', timeout: 20_000 });
      assert.equal(denied.status, 127, denied.error?.message || denied.stderr);
      assert.match(denied.stderr, /no such file or directory/);
    }
    results[variant] = { image: id, probeOutput, tlsOutput, sigtermExit: 42, directExit: 37, absentTools: true };
    console.log(variant + ': ' + probeOutput);
  }
} finally {
  if (containers.length) docker('rm', '-f', ...containers);
  docker('network', 'rm', network);
}
fs.writeFileSync(path.join(evidence, 'verification.json'), JSON.stringify({
  commit: build.commit, platform: build.platform, execution: 'native',
  go: capture('go', ['version']), tlsFixture: capture('openssl', ['version']), results,
}, null, 2) + '\n');
