import assert from 'node:assert/strict';
import { findings, scanPackages } from '../../security/compare-lib.mjs';

export function validateReports(records, commit, major = 21) {
  assert.deepEqual(Object.keys(records).sort(), ['amd64', 'arm64']);
  let modules;
  for (const [arch, record] of Object.entries(records)) {
    assert.equal(record.sourceCommit, commit, 'Build/source revision mismatch');
    assert.equal(record.javaMajor, major, 'Reported Java major differs');
    assert.ok(record.sample.java.startsWith(major + '.'), 'Observed runtime has wrong Java major');
    assert.equal(record.platform, 'linux/' + arch);
    assert.equal(record.image.config.User, '65532:65532');
    assert.deepEqual(record.image.config.Entrypoint, ['/usr/bin/java']);
    assert.equal(record.sample.compilerAbsent, true);
    assert.equal(record.networkProbes.hostname.tlsRejected, true);
    assert.equal(record.networkProbes.untrusted.tlsRejected, true);
    assert.equal(record.networkProbes.tls.tlsRejected, false);
    assert.ok(record.checks.includes('SIGTERM shutdown hook/143'));
    assert.ok(record.runtimeModules.includes('java.base'));
    assert.ok(!record.runtimeModules.includes('jdk.compiler'));
    if (modules) assert.deepEqual(record.runtimeModules, modules, 'Architecture module contracts differ');
    modules = record.runtimeModules;
  }
}
export function validateScan(report, packages) {
  assert.equal(report.Metadata?.OS?.Family, 'amazon', 'Scanner did not select AL2023');
  assert.equal(report.Metadata?.OS?.Name, '2023');
  const key = p => [p.name ?? p.Name, Number(p.epoch ?? p.Epoch ?? 0), p.version ?? p.Version, p.release ?? p.Release].join('|');
  assert.deepEqual(scanPackages(report, true).map(key).sort(), packages.map(key).sort(), 'Scanner payload package coverage differs');
  const blockers = findings(report).filter(f => ['HIGH', 'CRITICAL'].includes(f.severity) && f.fixed);
  assert.equal(blockers.length, 0, 'Fixable High/Critical ALAS findings block preview publication: ' + blockers.map(f => f.package + '/' + f.id).join(', '));
  return { total: findings(report).length, fixableHighCritical: blockers.length,
    limitation: 'ALAS unfixed and language-runtime advisory coverage remain limited; zero findings is not proof of no risk' };
}
export function validateIndex(index, leaves) {
  assert.equal(index.manifests?.length, 2, 'Expected a two-platform index');
  for (const arch of ['amd64', 'arm64']) {
    const m = index.manifests.find(m => m.platform?.architecture === arch && m.platform?.os === 'linux');
    assert.equal(m?.digest, leaves[arch], 'Published platform digest differs from the verified leaf');
  }
}
