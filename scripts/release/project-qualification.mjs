import assert from 'node:assert/strict';
import fs from 'node:fs';
import { supportedMajors } from '../java21/config.mjs';
import { runtimes } from '../runtime/config.mjs';

const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const plan = read('releases/stable-candidates.json');
const versions = [...supportedMajors.map(n => 'java' + n), ...Object.keys(runtimes)].sort();
assert.deepEqual(Object.keys(plan).sort(), versions, 'Stable plan must cover the full runtime matrix');
const [source, output] = process.argv.slice(2);
const commit = process.env.GITHUB_SHA;
assert.match(commit, /^[a-f0-9]{40}$/);
const foundation = read(source + '/foundation-oci-indexes/indexes.json');
const stable = read(source + '/stable-language-evidence/stable-language-evidence.json');
assert.deepEqual(Object.keys(stable.runtimes).sort(), versions);
assert.equal(foundation.commit, commit);
assert.equal(foundation.execution, 'native');
assert.deepEqual(Object.keys(foundation.variants).sort(), ['base', 'static']);
for (const { index, manifests } of Object.values(foundation.variants)) {
  assert.match(index, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(manifests.map(leaf => leaf.platform), [
    { os: 'linux', architecture: 'amd64' }, { os: 'linux', architecture: 'arm64' },
  ]);
}
const results = {};
let mismatch = false;
for (const runtime of versions) {
  results[runtime] = {};
  for (const arch of ['amd64', 'arm64']) {
    const get = sample => {
      const row = read(source + '/language-' + runtime + '-' + arch + '-' + sample + '/language-metrics.json');
      assert.equal(row.runtime, runtime);
      assert.equal(row.platform, 'linux/' + arch);
      assert.equal(row.commit, commit);
      assert.equal(row.ceilingMiB, plan[runtime].maxImageMiB);
      assert.ok(row.unpackedBytes <= row.ceilingMiB * 1048576, 'Measured image exceeds its reviewed budget');
      return row;
    };
    const { files: aFiles, ...a } = get('a');
    const { files: bFiles, ...b } = get('b');
    assert.equal(a.lockSHA256, b.lockSHA256, 'Samples do not use identical locks');
    const changedFiles = [...new Set([...Object.keys(aFiles), ...Object.keys(bFiles)])]
      .filter(path => aFiles[path] !== bFiles[path]).sort();
    const sameFiles = a.inventorySHA256 === b.inventorySHA256;
    mismatch ||= !sameFiles;
    results[runtime][arch] = { sameFiles, sameOCIManifest: a.manifestDigest === b.manifestDigest,
      sameOCILayers: JSON.stringify(a.layerDigests) === JSON.stringify(b.layerDigests),
      changedFiles, sampleA: a, sampleB: b };
    console.log(runtime, arch, sameFiles ? 'same files' : 'different files: ' + changedFiles.slice(0, 8).join(', '),
      a.manifestDigest === b.manifestDigest ? 'same manifest' : 'different manifest');
  }
}
fs.writeFileSync(output, JSON.stringify({ commit, foundation: foundation.variants, languages: results,
  stableEvidence: stable }, null, 2) + '\n');
assert.ok(!mismatch, 'Paired builds disagree on the normalized runtime file inventory');
