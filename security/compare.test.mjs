import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCoverage, findings, inventorySbom, metrics } from './compare-lib.mjs';

test('deduplicates repeated package/advisory matches while retaining different affected packages', () => {
  const v = { VulnerabilityID: 'CVE-2026-1000', PkgName: 'libc', InstalledVersion: '1', Severity: 'HIGH', FixedVersion: '2' };
  const report = { Results: [{ Class: 'os-pkgs', Type: 'debian', Vulnerabilities: [v, v, { ...v, PkgName: 'libm' }] }] };
  assert.equal(findings(report).length, 2);
  assert.equal(metrics(report).uniqueCves, 1);
  assert.equal(metrics(report).bySeverity.HIGH, 2);
  assert.equal(metrics(report).fixAvailablePairs, 2);
});
test('distinguishes no fix listed from no finding, and CVEs from other advisory IDs', () => {
  const report = { Results: [{ Vulnerabilities: [
    { VulnerabilityID: 'CVE-2026-1000', PkgName: 'a', InstalledVersion: '1', Severity: 'LOW' },
    { VulnerabilityID: 'GHSA-example', PkgName: 'b', InstalledVersion: '1', Severity: 'HIGH' },
  ] }] };
  const result = metrics(report);
  assert.equal(result.noFixListedPairs, 2);
  assert.equal(result.uniqueCves, 1);
  assert.equal(result.uniqueAdvisories, 2);
});
test('inventory adapter excludes notice-only and unshipped RPMs', () => {
  const p = name => ({ name, epoch: '0', version: '1', release: '1.amzn2023', arch: 'x86_64',
    license: 'MIT', sha256: '0'.repeat(64), source_rpm: name + '.src.rpm' });
  const packages = ['runtime', 'notice', 'unshipped'].map(p);
  const inventory = { packages, files: [
    { path: 'usr/lib64/runtime.so', kind: 'file', sha256: '1'.repeat(64), packages: ['runtime'] },
    { path: 'usr/share/licenses/notice/LICENSE', kind: 'file', packages: ['notice'] },
    { path: 'usr/lib/jvm/jre/legal/java.base/LICENSE', kind: 'file', packages: ['notice'] },
    { path: 'usr/bin/link-only', kind: 'symlink', packages: ['notice'] },
  ] };
  const lock = { sources: packages.map(p => ({ filename: p.source_rpm, name: p.name, epoch: '0', version: '1', release: '1.amzn2023' })) };
  const result = inventorySbom(inventory, lock, 'sha256:' + '0'.repeat(64));
  assert.deepEqual(result.coverage.selected.map(p => p.name), ['runtime']);
  assert.deepEqual(result.coverage.excludedInputs, ['notice', 'unshipped']);
  assert.equal(result.bom.components[0].name, 'amazon');
  assert.match(result.bom.components[1].purl, /pkg:rpm\/amazon\/runtime/);
});
test('coverage assertion rejects zero-package and wrong-distribution scans', () => {
  assert.throws(() => assertCoverage({ Metadata: { OS: { Family: 'amazon', Name: '2023' } } }, [{ name: 'glibc' }]), /coverage differs/);
  assert.throws(() => assertCoverage({ Metadata: { OS: { Family: 'debian', Name: '13' } } }, []), /matcher/);
  assert.doesNotThrow(() => assertCoverage({ Metadata: { OS: { Family: 'amazon', Name: '2023' } },
    Results: [{ Class: 'os-pkgs', Packages: [{ Name: 'glibc', Version: '2.34' }] }] }, [{ name: 'glibc' }]));
});
test('adapter rejects a payload owner with no locked provenance', () => {
  assert.throws(() => inventorySbom({ packages: [], files: [{ kind: 'file', path: 'usr/lib64/missing.so', packages: ['missing'] }] }, { sources: [] }, 'test'), /metadata/);
});
