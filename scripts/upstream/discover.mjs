import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { decide, markerRelease, repository, snapshot } from './discovery-lib.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Run upstream image discovery in GitHub Actions');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const config = read('.github/al2023-discovery.json');
assert.equal(config.schema_version, 1); assert.equal(config.source, repository + ':2023');
assert.equal(config.platform, 'linux/amd64');
assert.equal(config.input_spec, 'images/java21/packages.json');
assert.equal(config.lock_file, 'locks/java21/linux-amd64.json');
const lock = read(config.lock_file);
const inputs = read(config.input_spec);
assert.equal(inputs.releasever, lock.releasever, 'Committed input specification and RPM lock differ');
const docker = (...args) => execFileSync('docker', args, { stdio: 'inherit' });
const capture = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();
docker('pull', '--platform', config.platform, config.source);
const image = JSON.parse(capture('image', 'inspect', config.source))[0];
assert.equal(image.Os, 'linux'); assert.equal(image.Architecture, 'amd64');
assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
const ref = image.RepoDigests.find(ref => ref.startsWith(repository + '@sha256:'));
const marker = capture('run', '--rm', '--platform', config.platform, '--network', 'none', '--read-only',
  '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--user', '65532:65532',
  '--entrypoint', '/usr/bin/cat', image.Id, '/usr/lib/system-release');
const imageReleasever = markerRelease(marker);
const releasever = capture('run', '--rm', '--platform', config.platform, '--security-opt', 'no-new-privileges:true',
  '--entrypoint', '/usr/bin/dnf', image.Id, '--releasever=latest', '--refresh', '--quiet', '--disablerepo=*',
  '--enablerepo=amazonlinux', 'repoquery', '--latest-limit=1', '--queryformat=%{version}', 'system-release');
snapshot(releasever);
const candidate = { ref, imageId: image.Id, platform: config.platform, releasever, imageReleasever,
  releaseMarker: marker, imageCreated: image.Created, imageBytes: image.Size };
const result = { schema_version: 1, observedAt: new Date().toISOString(), source: config.source,
  runUrl: process.env.GITHUB_SERVER_URL + '/' + process.env.GITHUB_REPOSITORY + '/actions/runs/' + process.env.GITHUB_RUN_ID,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  ...decide(lock, candidate) };
fs.mkdirSync('out/upstream', { recursive: true });
fs.writeFileSync('out/upstream/discovery.json', JSON.stringify(result, null, 2) + '\n');
const summary = '# Official AL2023 builder discovery\n\n' +
  '- Status: ' + result.status + '\n- Source: ' + config.source + '\n- Platform: ' + config.platform +
  '\n- Observed digest: ' + ref + '\n- Observed image ID: ' + image.Id +
  '\n- Observed builder release: ' + candidate.imageReleasever + '\n- Observed RPM repository: ' + candidate.releasever +
  '\n- Current locked builder: ' + lock.builder +
  '\n- Current locked RPM snapshot: ' + lock.releasever + '\n\n' +
  'Discovery only: committed inputs/locks, runtime images and release tags are unchanged. The moving tag is used to discover an immutable candidate; builds continue to consume the reviewed lock. Release relation is against the locked RPM snapshot. Proposal writes are eligible only for scheduled/manual runs on the trusted default branch; feature-branch previews are read-only.\n';
fs.writeFileSync('out/upstream/summary.md', summary);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, 'changed=' + result.changed + '\n');
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
