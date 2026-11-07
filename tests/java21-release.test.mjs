import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIndex, validateReports, validateScan } from '../scripts/release/java21-policy.mjs';
const records = () => Object.fromEntries(['amd64','arm64'].map(arch => [arch, { javaMajor: 21, sourceCommit: 'abc', platform: 'linux/' + arch,
  image: { config: { User: '65532:65532', Entrypoint: ['/usr/bin/java'] } }, sample: { compilerAbsent: true, java: '21.0.13' },
  networkProbes: { tls: { tlsRejected: false }, hostname: { tlsRejected: true }, untrusted: { tlsRejected: true } },
  checks: ['SIGTERM shutdown hook/143'], runtimeModules: ['java.base', 'java.logging'] }]));
test('publication rejects mismatched revisions, unqualified TLS and module drift', () => {
  assert.doesNotThrow(() => validateReports(records(), 'abc'));
  const wrong = records(); wrong.arm64.sourceCommit = 'other'; assert.throws(() => validateReports(wrong, 'abc'), /revision/);
  const tls = records(); tls.amd64.networkProbes.hostname.tlsRejected = false; assert.throws(() => validateReports(tls, 'abc'));
  const modules = records(); modules.arm64.runtimeModules.push('java.xml'); assert.throws(() => validateReports(modules, 'abc'), /module contracts/);
});
test('publication rejects reports from a different Java major', () => {
  assert.throws(() => validateReports(records(), 'abc', 17), /major/);
  const observed = records(); observed.arm64.sample.java = '25.0.1';
  assert.throws(() => validateReports(observed, 'abc', 21), /major/);
});

test('a zero-finding scan with missing/wrong RPM coverage cannot pass', () => {
  const scan = { Metadata: { OS: { Family: 'amazon', Name: '2023' } }, Results: [] };
  assert.throws(() => validateScan(scan, [{ name: 'glibc', epoch: 0, version: '2', release: '1' }]), /coverage/);
  assert.throws(() => validateScan({ Metadata: {} }, []), /AL2023/);
});
test('fixable high findings block publication while all raw findings remain visible', () => {
  const report = { Metadata: { OS: { Family: 'amazon', Name: '2023' } }, Results: [{ Class: 'os-pkgs',
    Packages: [{ Name: 'glibc', Version: '2', Release: '1' }], Vulnerabilities: [
      { PkgName: 'glibc', VulnerabilityID: 'CVE-2026-1', InstalledVersion: '2-1', Severity: 'HIGH', FixedVersion: '3' }] }] };
  const expected = [{ name: 'glibc', epoch: '0', version: '2', release: '1' }];
  assert.throws(() => validateScan(report, expected), /block preview/);
  report.Results[0].Vulnerabilities[0].Severity = 'LOW'; assert.equal(validateScan(report, expected).total, 1);
});
test('index validation rejects wrong architecture and unverified leaf digests', () => {
  const leaves = { amd64: 'sha256:a', arm64: 'sha256:b' };
  const index = { manifests: Object.entries(leaves).map(([architecture,digest]) => ({ platform: { os: 'linux', architecture }, digest })) };
  assert.doesNotThrow(() => validateIndex(index, leaves));
  index.manifests[1].digest = 'sha256:changed'; assert.throws(() => validateIndex(index, leaves), /verified leaf/);
});
