import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validateScan } from './java21-policy.mjs';

export function alasScanner(out, execute, read, hash) {
  const scanner = 'aquasec/trivy@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb';
  const cache = out + '-trivy-cache';
  const databaseFile = cache + '/db/trivy.db';
  fs.mkdirSync(cache, { recursive: true });
  const common = ['run', '--rm', '--user', process.getuid() + ':' + process.getgid(),
    '--tmpfs', '/tmp:rw,nosuid,nodev,mode=1777', '--mount', 'type=bind,src=' + process.cwd() + ',dst=/work',
    '--mount', 'type=bind,src=' + process.cwd() + '/' + cache + ',dst=/cache',
    '-e', 'HOME=/tmp', '-e', 'TRIVY_SKIP_VERSION_CHECK=true'];
  execute('docker', ['pull', '--platform', 'linux/amd64', scanner]);
  execute('docker', [...common, scanner, '--cache-dir', '/cache', 'image', '--download-db-only']);
  const database = { sha256: hash(databaseFile), metadata: read(cache + '/db/metadata.json') };
  return {
    scanner,
    database,
    scan(file, coverage, arch) {
      const report = out + '/scan-' + arch + '.json';
      execute('docker', [...common, '--network', 'none', scanner, '--cache-dir', '/cache', 'sbom',
        '--skip-db-update', '--skip-java-db-update', '--offline-scan', '--scanners', 'vuln',
        '--severity', 'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL', '--ignore-unfixed=false', '--ignorefile', '/dev/null',
        '--format', 'json', '--list-all-pkgs', '--exit-code', '0', '--output', '/work/' + report, '/work/' + file]);
      return validateScan(read(report), read(coverage).selected);
    },
    verifyDatabase() {
      assert.equal(hash(databaseFile), database.sha256, 'Scanner database changed');
    },
  };
}
