import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { findings } from '../../security/compare-lib.mjs';
import { alasScanner } from './alas-scan.mjs';
import { sha256File } from './file-digest.mjs';
import { currentFoundation, releaseAsset, signedPredicates } from './refresh-baseline.mjs';
import { difference } from './refresh-diff.mjs';
import { architectures, checksumManifest, stablePlan } from './stable-policy.mjs';
import { vulnerabilityGate } from './vulnerability-policy.mjs';

assert.equal(process.env.GITHUB_ACTIONS, 'true');
const input = 'out/refresh-inputs';
const out = 'out/refresh-evidence';
fs.mkdirSync(out, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const hash = file => 'sha256:' + sha256File(file);
const digest = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
const execute = (program, args) => execFileSync(program, args, { stdio: 'inherit' });
const plans = read('releases/stable-candidates.json');
const foundation = currentFoundation();
const native = input + '/foundation-oci-indexes/evidence';
const provenance = read(native + '/provenance.json');
assert.equal(provenance.sourceCommit, process.env.GITHUB_SHA);
const gate = vulnerabilityGate(read('releases/vulnerability-exceptions.json'));
const scanner = alasScanner(out, execute, read, sha256File, (_scope, rows) => rows);
const report = {};

function asset(tag, name, checksum) {
  assert.match(checksum, /^sha256:[a-f0-9]{64}$/, 'Missing signed baseline checksum: ' + name);
  const data = releaseAsset(tag, name);
  assert.equal(digest(data), checksum, 'Baseline asset differs from signed evidence: ' + name);
  return data;
}
function packageRows(bom, coverage) {
  return coverage.selected.map(({ files, ...rpm }) => {
    const component = bom.components.find(row => row.purl === rpm.purl);
    assert.ok(component?.licenses?.length && files.length);
    return { ...rpm, licenses: component.licenses };
  });
}
function compare(runtime, arch, oldSize, size, oldBom, oldCoverage, newBom, newCoverage) {
  assert.ok(Number.isSafeInteger(oldSize) && oldSize > 0 && Number.isSafeInteger(size) && size > 0);
  const key = runtime + '-' + arch;
  const baseline = out + '/' + key;
  fs.writeFileSync(baseline + '-previous-sbom.json', oldBom);
  fs.writeFileSync(baseline + '-previous-coverage.json', oldCoverage);
  scanner.scan(baseline + '-previous-sbom.json', baseline + '-previous-coverage.json', key + '-previous');
  scanner.scan(newBom, newCoverage, key + '-candidate');
  const oldFindings = findings(read(out + '/scan-' + key + '-previous.json'));
  const newFindings = findings(read(out + '/scan-' + key + '-candidate.json'));
  report[key] = {
    runtime, arch, unpackedBytes: { before: oldSize, after: size, delta: size - oldSize },
    payloadRPMs: difference(packageRows(JSON.parse(oldBom), JSON.parse(oldCoverage)),
      packageRows(read(newBom), read(newCoverage)), row => row.name + '.' + row.arch),
    alas: { before: oldFindings.length, after: newFindings.length,
      changes: difference(oldFindings, newFindings, row => JSON.stringify([row.type, row.class, row.package, row.id])) },
  };
}

for (const arch of architectures) {
  const metrics = native + '/' + arch + '-metrics.json';
  const leaf = provenance.leaves[arch];
  assert.equal(hash(metrics), leaf.artifacts['metrics.json']);
  const before = JSON.parse(asset(foundation.releaseTag, arch + '-metrics.json', foundation.assets[arch + '-metrics.json']));
  for (const runtime of ['base', 'static']) {
    const prefix = runtime + '-' + arch;
    const sbom = prefix + '-sbom.cdx.json';
    const coverage = prefix + '-payload-packages.json';
    assert.equal(hash(native + '/' + sbom), leaf.variants[runtime].sbomSHA256);
    assert.equal(hash(native + '/' + coverage), leaf.variants[runtime].payloadSHA256);
    compare(runtime, arch, before.variants[runtime].unpackedBytes, read(metrics).variants[runtime].unpackedBytes,
      asset(foundation.releaseTag, sbom, foundation.assets[sbom]),
      asset(foundation.releaseTag, coverage, foundation.assets[coverage]), native + '/' + sbom, native + '/' + coverage);
  }
}

for (const [runtime, candidate] of Object.entries(plans)) {
  const plan = stablePlan(runtime, candidate);
  const proofs = signedPredicates(plan.reference, plan.previewPredicate, plan.previewIdentity);
  const checksums = releaseAsset(plan.previewTag, 'SHA256SUMS');
  assert.ok(proofs.some(row => row.sourceCommit === plan.sourceCommit && row.reference === plan.reference &&
    'sha256:' + row.evidenceSHA256 === digest(checksums)), 'Invalid signed baseline: ' + runtime);
  const expected = checksumManifest(checksums);
  for (const arch of architectures) {
    const file = name => asset(plan.previewTag, arch + '-' + name, expected.get(arch + '-' + name));
    const before = JSON.parse(file('verification.json'));
    const next = input + '/refresh-language-' + runtime + '-' + arch;
    const metrics = read(next + '/language-metrics.json');
    assert.equal(metrics.commit, process.env.GITHUB_SHA);
    assert.equal(metrics.runtime, runtime);
    assert.equal(metrics.platform, 'linux/' + arch);
    compare(runtime, arch, before.image.size, metrics.unpackedBytes, file('sbom.cdx.json'), file('payload-packages.json'),
      next + '/sbom.cdx.json', next + '/payload-packages.json');
  }
}
scanner.verifyDatabase();
fs.writeFileSync(out + '/changes.json', JSON.stringify({
  sourceCommit: process.env.GITHUB_SHA, baselineFoundation: foundation.releaseTag, baselineRuntimes: plans,
  scanner: scanner.scanner, database: scanner.database, images: report,
}, null, 2) + '\n');
const rows = ['# AL2023 refresh evidence', '', '| Image | Architecture | Previous bytes | Candidate bytes | Δ bytes | Payload RPM changes | ALAS before → after |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: |'];
for (const { runtime, arch, unpackedBytes, payloadRPMs, alas } of Object.values(report)) {
  rows.push('| ' + [runtime, arch, unpackedBytes.before, unpackedBytes.after, unpackedBytes.delta,
    payloadRPMs.length, alas.before + ' → ' + alas.after].join(' | ') + ' |');
}
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, rows.join('\n') + '\n');
for (const [key, { runtime, arch }] of Object.entries(report)) {
  gate({ scanner: 'alas', runtime, arch }, findings(read(out + '/scan-' + key + '-candidate.json')));
}
