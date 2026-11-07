import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { verifyDatabaseAge } from './vulnerability-policy.mjs';

const scanner = 'anchore/grype@sha256:6a36234da13f9faa327306ac0b3dab3405cfa2b4eb20c8f904125a8707863913';

export function upstreamScanner(out, execute, capture, hash, assessment) {
  const cache = path.resolve('out/upstream-grype-cache');
  fs.mkdirSync(cache, { recursive: true });
  const args = ['run', '--rm', '--platform', 'linux/amd64',
    '--user', process.getuid() + ':' + process.getgid(), '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777',
    '--mount', 'type=bind,src=' + process.cwd() + ',dst=/work',
    '--mount', 'type=bind,src=' + cache + ',dst=/cache',
    '-e', 'HOME=/tmp', '-e', 'GRYPE_DB_CACHE_DIR=/cache', '-e', 'GRYPE_DB_AUTO_UPDATE=false',
    '-e', 'GRYPE_DB_VALIDATE_AGE=true', '-e', 'GRYPE_DB_MAX_ALLOWED_BUILT_AGE=48h',
    '-e', 'GRYPE_CHECK_FOR_APP_UPDATE=false', '-e', 'GRYPE_MATCH_STOCK_USING_CPES=true'];
  execute('docker', ['pull', '--platform', 'linux/amd64', scanner]);
  execute('docker', [...args, scanner, 'db', 'update']);
  const offline = [...args, '--network', 'none', scanner];
  const status = capture('docker', [...offline, 'db', 'status']);
  assert.match(status, /^Status:\s*valid\s*$/mi, 'Invalid Grype database status');
  const built = verifyDatabaseAge('Grype', /^Built:\s*(\S+)$/m.exec(status)?.[1]);
  const files = fs.readdirSync(cache, { recursive: true }).filter(file => file.endsWith('.db'));
  assert.ok(files.length, 'No upstream scanner database');
  const snapshot = () => Object.fromEntries(files.map(file => [file, hash(path.join(cache, file))]));
  const database = { status, built, files: snapshot() };

  return {
    scanner,
    database,
    scan(file, arch, upstream) {
      const bom = JSON.parse(fs.readFileSync(file));
      const runtime = bom.components.find(component => component.type === 'application');
      assert.equal(runtime?.version, upstream.version);
      assert.match(runtime?.cpe, /^cpe:2\.3:a:/);
      const report = capture('docker', [...offline, 'sbom:/work/' + file, '-o', 'json']);
      fs.writeFileSync(out + '/upstream-scan-' + arch + '.json', report + '\n');
      const { matches } = JSON.parse(report);
      assert.ok(Array.isArray(matches), 'Invalid upstream vulnerability report');
      const blockers = matches.filter(({ vulnerability }) =>
        ['high', 'critical'].includes(vulnerability.severity.toLowerCase()) && vulnerability.fix?.state === 'fixed');
      if (!assessment) assert.equal(blockers.length, 0, 'Fixable High/Critical upstream findings: ' +
        blockers.map(({ artifact, vulnerability }) => artifact.name + '/' + vulnerability.id).join(', '));
      assert.deepEqual(snapshot(), database.files, 'Upstream scan database changed');
      return {
        runtime: { name: runtime.name, version: runtime.version, cpe: runtime.cpe },
        findings: matches.length,
        fixableHighCritical: blockers.length,
        ...(assessment && { stableGate: assessment(arch, matches.map(({ artifact, vulnerability }) => ({
          package: artifact.name, installed: artifact.version, id: vulnerability.id, severity: vulnerability.severity,
        }))) }),
        limitation: 'Core CPE and bundled component matches depend on the vulnerability database. Review vendor advisories and embedded dependency applicability separately.',
      };
    },
  };
}
