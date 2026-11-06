import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertMetadataOverlay, assertNativePackages, compareRepresentations } from './rpmdb-lib.mjs';

test('metadata overlays preserve every original layer and the complete runtime configuration', () => {
  const original = { RootFS: { Layers: ['runtime-a', 'runtime-b'] },
    Config: { User: '65532:65532', Entrypoint: ['/usr/bin/java'], Env: ['TZ=UTC'] }, Architecture: 'amd64', Os: 'linux' };
  const overlay = { ...original, RootFS: { Layers: [...original.RootFS.Layers, 'metadata'] } };
  assert.doesNotThrow(() => assertMetadataOverlay(original, overlay));
  assert.throws(() => assertMetadataOverlay(original, { ...overlay, RootFS: { Layers: ['changed', 'runtime-b', 'metadata'] } }), /runtime layer/);
  assert.throws(() => assertMetadataOverlay(original, { ...overlay, Config: { ...overlay.Config, User: '0' } }), /runtime configuration/);
});

test('native scan verification rejects wrong RPM epoch, version, release, architecture or OS', () => {
  const p = { Name: 'java', Epoch: 1, Version: '21', Release: '1.amzn2023', Arch: 'x86_64' };
  const expected = [{ name: 'java', epoch: '1', version: '21', release: '1.amzn2023', arch: 'x86_64' }];
  const report = pkg => ({ Metadata: { OS: { Family: 'amazon', Name: '2023.12.20261102 (Amazon Linux)' } },
    Results: [{ Class: 'os-pkgs', Packages: [pkg] }] });
  assert.doesNotThrow(() => assertNativePackages(report(p), expected));
  for (const [key, value] of [['Epoch', 0], ['Version', '17'], ['Release', '2.amzn2023'], ['Arch', 'aarch64']]) {
    assert.throws(() => assertNativePackages(report({ ...p, [key]: value }), expected), /NEVRA/);
  }
  assert.throws(() => assertNativePackages({ ...report(p), Metadata: {} }, expected), /Amazon Linux/);
});

test('representation comparison exposes added/lost findings and distinguishes unshipped dependencies', () => {
  const vuln = (name, id = 'CVE-2026-1000', severity = 'HIGH') => ({ PkgName: name, VulnerabilityID: id,
    InstalledVersion: '1', Severity: severity });
  const report = values => ({ Results: [{ Class: 'os-pkgs', Type: 'amazon', Vulnerabilities: values }] });
  const native = report([vuln('glibc')]);
  const full = report([vuln('glibc'), vuln('bash')]);
  const equal = compareRepresentations(native, native, full, new Set(['glibc']));
  assert.equal(equal.payloadFindingsIdentical, true);
  assert.deepEqual(equal.fullDatabaseAdditionalNonPayloadFindings.map(f => f.package), ['bash']);
  const different = compareRepresentations(native, report([vuln('glibc', 'CVE-2026-1000', 'MEDIUM')]), full, new Set(['glibc']));
  assert.equal(different.payloadFindingsIdentical, false);
  assert.equal(different.nativeOnly.length, 1);
  assert.equal(different.sbomOnly.length, 1);
});
