import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { assertMetadataOverlay } from './rpmdb-lib.mjs';
import { assertSyftRpms, crossScanner, grypeFindings, grypeMarkdown, grypeMetrics } from './grype-lib.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Run Grype scanning only in GitHub Actions');
const root = process.cwd();
const config = JSON.parse(fs.readFileSync('security/grype-comparison.json'));
const out = 'out/grype';
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync('out/grype-cache', { recursive: true });
const read = name => JSON.parse(fs.readFileSync(name));
const write = (name, value) => fs.writeFileSync(out + '/' + name, JSON.stringify(value, null, 2) + '\n');
function sha(file) {
  const hash = crypto.createHash('sha256'); const fd = fs.openSync(file, 'r'); const buf = Buffer.alloc(4 * 1024 * 1024);
  try { let n; while ((n = fs.readSync(fd, buf, 0, buf.length, null))) hash.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); } return hash.digest('hex');
}
const docker = (...args) => execFileSync('docker', args, { stdio: 'inherit' });
const capture = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }).trim();
const inspect = tag => JSON.parse(capture('image', 'inspect', tag))[0];
const baseline = read('out/prototype-input/verification.json');
const sums = fs.readFileSync('out/prototype-input/SHA256SUMS', 'utf8').split('\n');
for (const name of ['images.tar.gz', 'verification.json']) {
  const expected = sums.map(l => l.match(/^([a-f0-9]{64})\s+\*?\.\/(.+)$/)).find(m => m?.[2] === name)?.[1];
  assert.equal(sha('out/prototype-input/' + name), expected, 'Prototype artifact checksum: ' + name);
}
docker('load', '--input', 'out/prototype-input/images.tar.gz');
const proto = inspect('al2023-distroless-java:prototype');
assert.equal(proto.Id, baseline.images.java.id);
const native = read('out/native-input/rpmdb-evidence.json');
const previous = read('out/native-input/comparison.json');
assert.equal(previous.images.prototype.id, proto.Id);
assert.equal(previous.images.official.ref, config.official);
const images = { original: { id: proto.Id, size: proto.Size } };
for (const variant of ['payload', 'full']) {
  const context = 'out/native-input/rpmdb/' + variant;
  assert.equal(sha(context + '/' + native.database_path + '/rpmdb.sqlite'), native.variants[variant].database_sha256);
  assert.equal(sha(context + '/usr/lib/system-release'), native.release_marker.sha256);
  const tag = 'al2023-java-grype:scan-' + variant;
  docker('build', '--platform', config.platform, '--network', 'none', '--pull=false', '-f', 'security/rpmdb.Dockerfile',
    '--build-arg', 'BASE=al2023-distroless-java:prototype', '-t', tag, context);
  const image = inspect(tag); assertMetadataOverlay(proto, image);
  images[variant] = { id: image.Id, size: image.Size, originalLayersAndConfigVerified: true };
}
function pull(tag) {
  docker('pull', '--platform', config.platform, tag);
  const i = inspect(tag); assert.equal(i.Architecture, 'amd64');
  const ref = i.RepoDigests.find(r => /@sha256:[a-f0-9]{64}$/.test(r));
  assert.ok(ref); return { id: i.Id, ref, size: i.Size };
}
images.official = pull(config.official);
const tools = { syft: pull(config.syft), grype: pull(config.grype) };
const shared = ['run', '--rm', '--platform', config.platform, '--mount', 'type=bind,src=' + root + ',dst=/work'];
const syft = (...args) => capture(...shared, '--network', 'none',
  '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
  '-e', 'SYFT_CHECK_FOR_APP_UPDATE=false', '-e', 'SYFT_JAVA_USE_NETWORK=false', tools.syft.ref, ...args);
const grypeArgs = [...shared, '--mount', 'type=bind,src=' + root + '/out/grype-cache,dst=/cache',
  '-e', 'GRYPE_CHECK_FOR_APP_UPDATE=false', '-e', 'GRYPE_DB_CACHE_DIR=/cache',
  '-e', 'GRYPE_DB_AUTO_UPDATE=false', '-e', 'GRYPE_ONLY_FIXED=false', '-e', 'GRYPE_ONLY_NOTFIXED=false'];
const grype = (...args) => capture(...grypeArgs, '--network', 'none', tools.grype.ref, ...args);
for (const name of ['syft', 'grype']) {
  tools[name].version = JSON.parse((name === 'syft' ? syft : grype)('version', '-o', 'json'));
  assert.equal(tools[name].version.version.replace(/^v/, ''), config[name + '_version']);
}
// Explicitly update once with networking, then run every scan without network.
docker(...grypeArgs, tools.grype.ref, 'db', 'update');
fs.writeFileSync(out + '/db-status.txt', grype('db', 'status') + '\n');
function dbSnapshot() {
  const result = {};
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (fs.statSync(file).isDirectory()) walk(file);
      else if (/\.(db|json)$/.test(name)) result[path.relative('out/grype-cache', file)] = { bytes: fs.statSync(file).size, sha256: sha(file) };
    }
  }
  walk('out/grype-cache'); assert.ok(Object.keys(result).some(k => k.endsWith('.db')), 'Missing Grype database'); return result;
}
const database = dbSnapshot(); write('database-snapshot.json', database);
const boms = {}, reports = {}, metrics = {}, differences = {};
const priorKeys = { original: 'prototypeNative', payload: 'prototypeRpmPayload', full: 'prototypeRpmFull', official: 'officialNative' };
for (const [name, image] of Object.entries(images)) {
  const bom = JSON.parse(syft('scan', 'docker:' + image.id, '--scope', 'squashed', '-o', 'syft-json'));
  write(name + '.syft.json', bom);
  if (name === 'payload' || name === 'full') assertSyftRpms(bom, native.variants[name].packages);
  if (name === 'official') assert.ok(bom.artifacts.some(a => a.type === 'deb'), 'Official package discovery empty');
  const report = JSON.parse(grype('sbom:/work/' + out + '/' + name + '.syft.json', '-o', 'json'));
  write(name + '.grype.json', report);
  boms[name] = bom; reports[name] = report; metrics[name] = grypeMetrics(report, bom);
  differences[name] = crossScanner(report, previous.findings[priorKeys[name]]);
}
assert.deepEqual(dbSnapshot(), database, 'Grype database changed across scans');
assert.equal(inspect('al2023-distroless-java:prototype').Id, proto.Id);
const result = { scannedAt: new Date().toISOString(), platform: config.platform,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  prototypeRun: config.prototype_run_id, trivyRun: config.native_run_id, images, tools, database,
  databaseUnchangedAcrossScans: true, nativeDatabaseReusedWithoutReconstruction: true,
  metrics, findings: Object.fromEntries(Object.entries(reports).map(([k, v]) => [k, grypeFindings(v)])),
  crossScanner: differences, priorTrivyMetrics: previous.scans };
write('comparison.json', result); write('cross-scanner.json', differences);
fs.writeFileSync(out + '/comparison.md', grypeMarkdown(result));
const rows = [['target','type','package','version','advisory','cve_aliases','severity','namespace','fix_state','fixed_versions']];
for (const [target, list] of Object.entries(result.findings)) for (const f of list) rows.push([target, f.type, f.package, f.version,
  f.id, f.cves.join(';'), f.severity, f.namespace, f.fixState, f.fixed.join(';')]);
fs.writeFileSync(out + '/findings.csv', rows.map(row => row.map(v => '"' + String(v).replaceAll('"', '""') + '"').join(',')).join('\n') + '\n');
console.log(grypeMarkdown(result));
