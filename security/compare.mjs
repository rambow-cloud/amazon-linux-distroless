import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCoverage, comparisonMarkdown, findings, inventorySbom, metrics, scanPackages } from './compare-lib.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Run the comparison in GitHub Actions');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const config = JSON.parse(fs.readFileSync('security/comparison.json', 'utf8'));
const input = 'out/prototype-input';
const out = 'out/cve';
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync('out/cve-cache', { recursive: true });
const read = name => JSON.parse(fs.readFileSync(name, 'utf8'));
const write = (name, value) => fs.writeFileSync(name, JSON.stringify(value, null, 2) + '\n');
const digest = name => crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex');
const docker = (...args) => execFileSync('docker', args, { stdio: 'inherit' });
const capture = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
const shaEntries = fs.readFileSync(input + '/SHA256SUMS', 'utf8').split('\n');
for (const name of ['images.tar.gz', 'java-inventory.json', 'linux-amd64.json', 'verification.json']) {
  const expected = shaEntries.map(line => line.match(/^([a-f0-9]{64})\s+\*?\.\/(.+)$/))
    .find(match => match?.[2] === name)?.[1];
  if (!expected || digest(input + '/' + name) !== expected) throw new Error('Baseline artifact mismatch: ' + name);
}
const baseline = read(input + '/verification.json');
docker('load', '--input', input + '/images.tar.gz');
const proto = JSON.parse(capture('image', 'inspect', config.prototype_tag))[0];
if (proto.Id !== baseline.images.java.id || proto.Architecture !== 'amd64' || proto.Config.User !== '65532:65532') {
  throw new Error('Loaded prototype identity/platform/user differs from the tested artifact');
}
function pull(tag) {
  docker('pull', '--platform', config.platform, tag);
  const image = JSON.parse(capture('image', 'inspect', tag))[0];
  const ref = image.RepoDigests.find(value => /@sha256:[a-f0-9]{64}$/.test(value));
  if (!ref || image.Architecture !== 'amd64') throw new Error('Expected immutable amd64 image: ' + tag);
  return { ref, image };
}
const official = pull(config.official_tag);
const scanner = pull(config.scanner_tag);
const mounted = ['run', '--rm', '--platform', config.platform,
  '--mount', 'type=bind,src=' + root + ',dst=/work',
  '--mount', 'type=bind,src=' + root + '/out/cve-cache,dst=/cache',
  '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
  '-e', 'TRIVY_SKIP_VERSION_CHECK=true', scanner.ref, '--cache-dir', '/cache'];
const trivy = (...args) => docker(...mounted, ...args);
const version = capture(...mounted, '--version');
if (!version.includes('Version: ' + config.scanner_version)) throw new Error('Unexpected Trivy version');
fs.writeFileSync(out + '/scanner-version.txt', version + '\n');
trivy('image', '--download-db-only');
trivy('image', '--download-java-db-only');
function databaseFiles() {
  const snapshot = {};
  for (const directory of ['db', 'java-db']) {
    const folder = 'out/cve-cache/' + directory;
    for (const name of fs.readdirSync(folder).sort()) {
      if (!name.endsWith('.db') && !name.endsWith('.json')) continue;
      const file = folder + '/' + name;
      snapshot[directory + '/' + name] = { sha256: digest(file), bytes: fs.statSync(file).size };
      if (name.endsWith('.json')) snapshot[directory + '/' + name].metadata = read(file);
    }
  }
  if (!Object.keys(snapshot).some(name => name.startsWith('db/') && name.endsWith('.db')) ||
      !Object.keys(snapshot).some(name => name.startsWith('java-db/') && name.endsWith('.db'))) {
    throw new Error('Both database snapshots must exist');
  }
  return snapshot;
}
const databases = databaseFiles();
write(out + '/database-snapshot.json', databases);
const common = ['--skip-db-update', '--skip-java-db-update', '--scanners', 'vuln',
  '--severity', 'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL', '--ignore-unfixed=false',
  '--ignorefile', '/dev/null', '--list-all-pkgs', '--format', 'json', '--exit-code', '0', '--timeout', '10m'];
trivy('image', ...common, '--offline-scan', '--image-src', 'docker', '--platform', config.platform,
  '--output', '/work/' + out + '/prototype-native.json', proto.Id);
trivy('image', ...common, '--offline-scan', '--image-src', 'docker', '--platform', config.platform,
  '--output', '/work/' + out + '/official-native.json', official.ref);
const inventory = read(input + '/java-inventory.json');
const lock = read(input + '/linux-amd64.json');
const adapted = inventorySbom(inventory, lock, proto.Id);
for (const required of ['glibc', 'java-21-amazon-corretto-headless', 'libstdc++']) {
  if (!adapted.coverage.selected.some(p => p.name === required)) throw new Error('Missing payload package: ' + required);
}
write(out + '/prototype-inventory.cdx.json', adapted.bom);
write(out + '/prototype-coverage.json', adapted.coverage);
trivy('sbom', ...common, '--output', '/work/' + out + '/prototype-inventory.json',
  '/work/' + out + '/prototype-inventory.cdx.json');
const reports = {
  prototypeNative: read(out + '/prototype-native.json'),
  prototypeInventory: read(out + '/prototype-inventory.json'),
  officialNative: read(out + '/official-native.json'),
};
assertCoverage(reports.prototypeInventory, adapted.coverage.selected);
if (!scanPackages(reports.officialNative, true).length) throw new Error('Official OS package discovery is empty');
const after = databaseFiles();
if (JSON.stringify(after) !== JSON.stringify(databases)) throw new Error('Scanner databases changed during the comparison');
function javaVersion(image) {
  const result = spawnSync('docker', ['run', '--rm', '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--tmpfs', '/tmp:rw,nosuid,nodev,size=16m',
    '--entrypoint', '/usr/bin/java', image, '-version'], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot identify Java runtime: ' + result.stderr);
  return (result.stdout + result.stderr).trim();
}
const result = {
  scannedAt: new Date().toISOString(), platform: config.platform, prototypeRun: config.prototype_run_id,
  prototypeArtifact: config.prototype_artifact, prototypeBuildCommit: baseline.sourceCommit,
  comparisonCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  images: {
    prototype: { id: proto.Id, tag: config.prototype_tag, size: proto.Size, javaVersion: javaVersion(proto.Id) },
    official: { id: official.image.Id, ref: official.ref, requestedTag: config.official_tag,
      size: official.image.Size, javaVersion: javaVersion(official.ref), user: official.image.Config.User },
  },
  scanner: { ref: scanner.ref, requestedTag: config.scanner_tag, version },
  databases, databaseUnchangedAcrossScans: true, coverage: adapted.coverage,
  scans: Object.fromEntries(Object.entries(reports).map(([key, report]) => [key, metrics(report)])),
  findings: Object.fromEntries(Object.entries(reports).map(([key, report]) => [key, findings(report)])),
};
write(out + '/comparison.json', result);
fs.writeFileSync(out + '/comparison.md', comparisonMarkdown(result));
const rows = [['image', 'severity', 'package', 'advisory', 'installed', 'fixed', 'status', 'severity_source', 'data_source', 'url']];
for (const [label, list] of Object.entries(result.findings)) {
  for (const f of list) rows.push([label, f.severity, f.package, f.id, f.installed, f.fixed, f.status,
    f.severitySource, f.dataSource?.ID || '', f.url]);
}
fs.writeFileSync(out + '/findings.csv', rows.map(row => row.map(value =>
  '"' + String(value).replaceAll('"', '""') + '"').join(',')).join('\n') + '\n');
console.log(comparisonMarkdown(result));
