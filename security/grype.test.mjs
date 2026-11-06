import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSyftRpms, crossScanner, grypeFindings, grypeMetrics } from './grype-lib.mjs';
const match = { artifact: { name: 'lib', version: '1', type: 'rpm' },
  vulnerability: { id: 'ALAS-1', namespace: 'amazon:distro:amazonlinux:2023', severity: 'High', fix: { versions: ['2'], state: 'fixed' } },
  relatedVulnerabilities: [{ id: 'CVE-2026-1' }, { id: 'CVE-2026-2' }], matchDetails: [{ matcher: 'rpm-matcher' }] };
test('deduplicates matcher paths and expands ALAS CVEs without duplicating aliases', () => {
  const r = { matches: [match, { ...match, matchDetails: [{ matcher: 'other' }] }], ignoredMatches: [match] };
  assert.equal(grypeFindings(r).length, 1);
  const m = grypeMetrics(r, { artifacts: [{ type: 'rpm' }] });
  assert.equal(m.rawMatches, 2); assert.equal(m.uniqueCves, 2); assert.equal(m.cvePairs, 2);
  assert.equal(m.bySeverity.High, 1); assert.equal(m.ignoredMatches, 1); assert.equal(m.fixListed, 1);
});
test('retains different namespaces and separates OS from binary matches', () => {
  const r = { matches: [match, { ...match, artifact: { ...match.artifact, type: 'binary' },
    vulnerability: { ...match.vulnerability, namespace: 'nvd:cpe' } }] };
  const m = grypeMetrics(r, { artifacts: [{ type: 'rpm' }, { type: 'binary' }] });
  assert.equal(m.advisoryPairs, 2); assert.equal(m.osAdvisoryPairs, 1); assert.equal(m.namespaces.length, 2);
});
test('native coverage rejects missing packages and altered RPM versions or architectures', () => {
  const p = { name: 'java', epoch: '1', version: '21', release: '1', arch: 'x86_64', source_rpm: 'java.src.rpm' };
  const artifact = { name: p.name, type: 'rpm', version: '1:21-1', metadata: { epoch: 1, version: '21', release: '1', architecture: 'x86_64', sourceRpm: p.source_rpm } };
  const bom = { distro: { id: 'amzn', versionID: '2023' }, artifacts: [artifact] };
  assert.doesNotThrow(() => assertSyftRpms(bom, [p]));
  assert.throws(() => assertSyftRpms({ ...bom, artifacts: [] }, [p]), /coverage/);
  assert.throws(() => assertSyftRpms({ ...bom, artifacts: [{ ...artifact, version: '17' }] }, [p]), /display version/);
  assert.throws(() => assertSyftRpms(bom, [{ ...p, arch: 'aarch64' }]), /coverage/);
});
test('cross-scanner CVE comparison normalizes advisory aliases and retains added/lost CVEs', () => {
  const c = crossScanner({ matches: [match] }, [{ package: 'lib', id: 'CVE-2026-1' }, { package: 'other', id: 'CVE-2026-3' }]);
  assert.deepEqual(c.shared, ['lib|CVE-2026-1']); assert.deepEqual(c.grypeOnly, ['lib|CVE-2026-2']);
  assert.deepEqual(c.trivyOnly, ['other|CVE-2026-3']);
});
