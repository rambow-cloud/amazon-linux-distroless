import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { alasScanner } from './alas-scan.mjs';
import { sha256File as hash } from './file-digest.mjs';
import { vulnerabilityGate } from './vulnerability-policy.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Scan foundation evidence only in GitHub Actions');
const [input, out] = process.argv.slice(2);
assert.match(input, /^out\/[a-z0-9/-]+$/);
assert.match(out, /^out\/[a-z0-9/-]+$/);
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const execute = (program, args) => execFileSync(program, args, { stdio: 'inherit' });
const index = read(input + '/indexes.json');
const evidence = read(input + '/evidence/provenance.json');
assert.equal(evidence.sourceCommit, index.commit);
assert.equal(index.commit, process.env.GITHUB_SHA, 'Scan only the current qualified candidate');
assert.equal(evidence.execution, 'native');
const gate = vulnerabilityGate(read('releases/vulnerability-exceptions.json'));
fs.mkdirSync(out, { recursive: true });
const scanner = alasScanner(out, execute, read, hash, (key, findings) => {
  const [runtime, arch] = key.split('-');
  return gate({ scanner: 'alas', runtime, arch }, findings);
});
const variants = {};
for (const runtime of ['static', 'base']) {
  const tested = index.variants[runtime];
  assert.equal(tested.index, evidence.indexes[runtime]);
  variants[runtime] = { index: tested.index, scans: {} };
  for (const arch of ['amd64', 'arm64']) {
    const platform = 'linux/' + arch;
    const leaf = tested.manifests.find(item => item.platform.os === 'linux' && item.platform.architecture === arch);
    const record = evidence.leaves[arch].variants[runtime];
    assert.equal(record.manifest, leaf.digest);
    const key = runtime + '-' + arch;
    const sbom = input + '/evidence/' + key + '-sbom.cdx.json';
    const coverage = input + '/evidence/' + key + '-payload-packages.json';
    assert.equal('sha256:' + hash(sbom), record.sbomSHA256);
    assert.equal('sha256:' + hash(coverage), record.payloadSHA256);
    const { component } = read(sbom).metadata;
    assert.ok(component.hashes.some(x => x.alg === 'SHA-256' && 'sha256:' + x.content === leaf.digest));
    assert.ok(component.properties.some(x => x.name === 'rambow:oci-platform' && x.value === platform));
    const scan = scanner.scan(sbom, coverage, key);
    variants[runtime].scans[arch] = { manifest: leaf.digest, sbom: record.sbomSHA256,
      coverage: record.payloadSHA256, report: 'sha256:' + hash(out + '/scan-' + key + '.json'), ...scan };
    console.log(runtime, platform, 'ALAS findings:', scan.total, 'exceptions:', scan.stableGate.appliedExceptions.length);
  }
}
scanner.verifyDatabase();
fs.writeFileSync(out + '/security.json', JSON.stringify({
  sourceCommit: index.commit, scanner: scanner.scanner, database: scanner.database, variants,
}, null, 2) + '\n');
