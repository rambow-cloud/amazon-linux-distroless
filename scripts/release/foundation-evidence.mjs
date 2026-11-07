import assert from 'node:assert/strict';
import fs from 'node:fs';
import { inventorySbom } from '../../security/compare-lib.mjs';
import { sha256File } from './file-digest.mjs';

const [native, combined] = process.argv.slice(2);
const out = combined + '/evidence';
fs.mkdirSync(out, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const hash = file => 'sha256:' + sha256File(file);
const index = read(combined + '/indexes.json');
const leaves = {};
for (const arch of ['amd64', 'arm64']) {
  const path = native + '/foundation-candidate-' + arch;
  const lock = read(path + '/lock.json');
  const build = read(path + '/build.json');
  const verified = read(path + '/verification.json');
  const platform = 'linux/' + arch;
  assert.equal(lock.platform, platform);
  assert.equal(verified.commit, index.commit);
  assert.equal(verified.execution, 'native');
  const files = fs.readdirSync(path).sort();
  const hashes = Object.fromEntries(files.map(file => [file, hash(path + '/' + file)]));
  leaves[arch] = { platform, builder: lock.builder, releasever: lock.releasever,
    toolPackages: lock.tool_packages, artifacts: hashes, variants: {} };
  for (const variant of ['static', 'base']) {
    const leaf = index.variants[variant].manifests.find(x => x.platform.architecture === arch);
    assert.match(leaf.digest, /^sha256:[a-f0-9]{64}$/);
    const inventory = read(path + '/' + variant + '-inventory.json');
    assert.equal(inventory.variant, variant);
    assert.equal(inventory.platform, platform);
    assert.equal(verified.results[variant].image, build.images[variant].id);
    assert.equal(inventory.builder, lock.builder);
    assert.equal(inventory.releasever, lock.releasever);
    // The inventory names selected owners; the lock also contains build-time
    // transaction inputs. Including the complete input list here makes the
    // coverage report explicitly identify what was omitted.
    const { bom, coverage } = inventorySbom({
      ...inventory, packages: lock.variants.base.packages,
    }, lock, build.images[variant].id);
    for (const component of bom.components) {
      const selected = coverage.selected.find(x => x.purl === component.purl);
      if (!selected) continue;
      const source = lock.sources.find(x => x.filename === selected.source_rpm);
      component.externalReferences = [{
        type: 'distribution', url: source.url, hashes: [{ alg: 'SHA-256', content: source.sha256 }],
      }];
    }
    bom.metadata.component.hashes = [{ alg: 'SHA-256', content: leaf.digest.slice(7) }];
    bom.metadata.component.properties.push({ name: 'rambow:oci-platform', value: platform });
    const prefix = out + '/' + variant + '-' + arch;
    write(prefix + '-sbom.cdx.json', bom);
    write(prefix + '-payload-packages.json', coverage);
    leaves[arch].variants[variant] = { manifest: leaf.digest, imageConfig: build.images[variant].id,
      sbomSHA256: hash(prefix + '-sbom.cdx.json'), payloadSHA256: hash(prefix + '-payload-packages.json') };
  }
}
write(out + '/provenance.json', {
  schemaVersion: 1, sourceCommit: index.commit, execution: 'native',
  indexes: Object.fromEntries(Object.entries(index.variants).map(([variant, value]) => [variant, value.index])),
  leaves,
});
