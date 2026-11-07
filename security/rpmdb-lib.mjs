import assert from 'node:assert/strict';
import { findings, scanPackages } from './compare-lib.mjs';

export function assertMetadataOverlay(original, overlay) {
  assert.deepEqual(overlay.RootFS.Layers.slice(0, original.RootFS.Layers.length), original.RootFS.Layers,
    'Scan overlay changed an original runtime layer');
  assert.equal(overlay.RootFS.Layers.length, original.RootFS.Layers.length + 1, 'Expected exactly one metadata layer');
  assert.deepEqual(overlay.Config, original.Config, 'Scan overlay changed runtime configuration');
  assert.equal(overlay.Architecture, original.Architecture);
  assert.equal(overlay.Os, original.Os);
}

export function assertNativePackages(report, expected) {
  assert.equal(report.Metadata?.OS?.Family, 'amazon', 'Native scan did not identify Amazon Linux');
  assert.match(report.Metadata?.OS?.Name || '', /^2023(?:[.\s]|$)/, 'Native scan did not select AL2023');
  const identity = p => [p.name ?? p.Name, Number(p.epoch ?? p.Epoch ?? 0), p.version ?? p.Version,
    p.release ?? p.Release, p.arch ?? p.Arch].join('|');
  assert.deepEqual(scanPackages(report, true).map(identity).sort(), expected.map(identity).sort(),
    'Scanner did not enumerate the exact native RPM NEVRA set');
}

export function compareRepresentations(native, sbom, full, payloadNames) {
  const key = f => JSON.stringify([f.package, f.installed, f.id, f.severity, f.fixed, f.status]);
  const nativeSet = new Set(findings(native).map(key));
  const sbomSet = new Set(findings(sbom).map(key));
  return {
    payloadFindingsIdentical: nativeSet.size === sbomSet.size && [...nativeSet].every(k => sbomSet.has(k)),
    nativeOnly: findings(native).filter(f => !sbomSet.has(key(f))),
    sbomOnly: findings(sbom).filter(f => !nativeSet.has(key(f))),
    fullDatabaseAdditionalNonPayloadFindings: findings(full).filter(f => !payloadNames.has(f.package)),
    fullDatabasePayloadFindings: findings(full).filter(f => payloadNames.has(f.package)),
  };
}
