import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { sha256File } from './file-digest.mjs';
import { validateIndex } from './java21-policy.mjs';
import { architectures, attestedPredicates, issuer, repository, verifyAdvance } from './stable-policy.mjs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== repository) {
  throw new Error('Publish only from the protected main workflow');
}
const input = 'out/release-inputs';
const out = 'out/foundation-release';
const bundle = input + '/foundation-oci-indexes';
const scans = input + '/fresh-foundation-scans';
const recordFile = 'foundation-release.json';
const identity = 'https://github.com/' + repository + '/.github/workflows/foundation-release.yml@refs/heads/main';
const predicate = 'https://rambow-cloud.github.io/amazon-linux-distroless/foundation-stable/v1';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const hash = file => 'sha256:' + sha256File(file);
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...options });
const capture = (cmd, args) => execFileSync(cmd, args, {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
function optional(cmd, args, absent) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status === 0) return result.stdout.trim();
  if (result.status && absent.test(result.stderr)) return null;
  throw new Error(cmd + ' lookup failed: ' + (result.error?.message || result.stderr));
}
function digestOf(reference, allowMissing = false) {
  const args = ['buildx', 'imagetools', 'inspect', reference];
  const output = allowMissing ? optional('docker', args, /not found|manifest unknown|name unknown/i) : capture('docker', args);
  if (output === null) return null;
  const digest = /^Digest:\s*(sha256:[a-f0-9]{64})$/m.exec(output)?.[1];
  assert.ok(digest, 'Cannot resolve digest: ' + reference);
  return digest;
}
function attestations(reference, type, digest) {
  return attestedPredicates(capture('cosign', ['verify-attestation', '--type', type, '--certificate-identity',
    identity, '--certificate-oidc-issuer', issuer, reference]), type === 'cyclonedx' ? null : type, digest);
}
function visibility(runtime) {
  const metadata = optional('gh', ['api', 'orgs/rambow-cloud/packages/container/' +
    encodeURIComponent('amazon-linux-distroless/' + runtime)], /HTTP 404/);
  return metadata === null ? null : JSON.parse(metadata).visibility;
}
const release = (verb, tag, ...args) => run('gh', ['release', verb, tag, '--repo', repository, ...args]);
const releaseAPI = tag => 'repos/' + repository + '/releases/tags/' + tag;
const assertSame = (file, digest) => assert.equal(hash(file), digest, 'Evidence changed: ' + file);

const head = capture('git', ['rev-parse', 'HEAD']);
assert.equal(head, process.env.GITHUB_SHA);
const provenance = read(bundle + '/evidence/provenance.json');
const indexes = read(bundle + '/indexes.json');
const qualification = read(input + '/project-qualification-report/report.json');
const security = read(scans + '/security.json');
for (const commit of [provenance.sourceCommit, indexes.commit, qualification.commit, security.sourceCommit]) assert.equal(commit, head);
assert.equal(provenance.execution, 'native');
assert.deepEqual(qualification.foundation, indexes.variants);
const languageCandidates = read('releases/stable-candidates.json');
assert.deepEqual(Object.keys(qualification.stableEvidence.runtimes).sort(), Object.keys(languageCandidates).sort());
const version = provenance.leaves.amd64.releasever;
assert.match(version, /^2023\.\d+\.\d{8}$/);
assert.equal(provenance.leaves.arm64.releasever, version);
assert.match(process.env.REVISION, /^[1-9][0-9]{0,5}$/);
const revision = Number(process.env.REVISION);
const tag = 'foundation-' + version + '-r' + revision;
const releaseUrl = 'https://github.com/' + repository + '/releases/tag/' + tag;
const variants = ['static', 'base'];
const plans = Object.fromEntries(variants.map(runtime => {
  const base = 'ghcr.io/' + repository + '/' + runtime;
  const digest = indexes.variants[runtime].index;
  const leaves = Object.fromEntries(architectures.map(arch =>
    [arch, indexes.variants[runtime].manifests.find(leaf => leaf.platform.architecture === arch).digest]));
  assert.equal(provenance.indexes[runtime], digest);
  assert.equal(security.variants[runtime].index, digest);
  return [runtime, { runtime, base, digest, leaves, version, revision, reference: base + '@' + digest,
    alias: base + ':2023', immutable: base + ':' + version + '-r' + revision }];
}));

fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(process.env.DOCKER_CONFIG, { recursive: true });
run('docker', ['login', 'ghcr.io', '--username', process.env.GITHUB_ACTOR, '--password-stdin'],
  { input: process.env.GH_TOKEN, stdio: ['pipe', 'pipe', 'inherit'] });
const old = {};
for (const plan of Object.values(plans)) {
  const status = visibility(plan.runtime);
  assert.ok(status === null || status === 'public', 'Existing foundation package is not public');
  const aliasDigest = status === null ? null : digestOf(plan.alias, true);
  const fixed = status === null ? null : digestOf(plan.immutable, true);
  assert.ok(fixed === null || fixed === plan.digest, 'Immutable foundation tag collision');
  const prior = aliasDigest ? attestations(plan.base + '@' + aliasDigest, predicate, aliasDigest)
    .map(record => record.images[plan.runtime]).find(image => image?.reference === plan.base + '@' + aliasDigest) : null;
  if (aliasDigest) assert.ok(prior, 'Current alias lacks verified foundation evidence');
  verifyAdvance(plan, prior);
  old[plan.runtime] = { aliasDigest, fixed };
}

const marker = '<!-- foundation-indexes ' + variants.map(runtime => plans[runtime].digest).join(' ') + ' -->';
const known = optional('gh', ['release', 'view', tag, '--repo', repository,
  '--json', 'body,isDraft,isPrerelease,targetCommitish'], /release not found|HTTP 404/i);
const existing = known === null ? null : JSON.parse(known);
const verifyAssets = record => {
  const payload = JSON.parse(capture('gh', ['api', releaseAPI(tag)]));
  assert.ok(!payload.draft && !payload.prerelease);
  assert.equal(payload.html_url, releaseUrl);
  const ref = JSON.parse(capture('gh', ['api', 'repos/' + repository + '/git/ref/tags/' + tag]));
  assert.equal(ref.object.type, 'commit');
  assert.equal(ref.object.sha, record.sourceCommit);
  for (const [name, digest] of Object.entries({ ...record.assets, [recordFile]: hash(out + '/' + recordFile) })) {
    assert.ok(payload.assets.some(asset => asset.name === name && asset.state === 'uploaded' && asset.digest === digest),
      'Published evidence differs: ' + name);
  }
};
function verifyRegistry(plan, record) {
  validateIndex(JSON.parse(capture('docker', ['buildx', 'imagetools', 'inspect', '--raw', plan.reference])), plan.leaves);
  run('cosign', ['verify', '--certificate-identity', identity, '--certificate-oidc-issuer', issuer, plan.reference]);
  const wrong = spawnSync('cosign', ['verify', '--certificate-identity', identity.replace('@refs/heads/main', '@refs/heads/untrusted'),
    '--certificate-oidc-issuer', issuer, plan.reference], { encoding: 'utf8' });
  assert.ok(!wrong.error && wrong.status > 0, 'An unexpected signing identity passed verification');
  assert.ok(attestations(plan.reference, predicate, plan.digest).some(value => isDeepStrictEqual(value, record)));
  for (const [arch, leaf] of Object.entries(plan.leaves)) {
    const expected = read(bundle + '/evidence/' + plan.runtime + '-' + arch + '-sbom.cdx.json');
    const results = attestations(plan.base + '@' + leaf, 'cyclonedx', leaf);
    if (existing && !existing.isDraft) {
      assert.ok(results.some(bom => bom.metadata.component.hashes.some(x => 'sha256:' + x.content === leaf)));
    } else {
      assert.ok(results.some(value => isDeepStrictEqual(value, expected)), 'Leaf SBOM differs from evidence');
    }
  }
}
function setTag(tagRef, plan) {
  run('docker', ['buildx', 'imagetools', 'create', '--tag', tagRef, plan.reference]);
  assert.equal(digestOf(tagRef), plan.digest);
}

let record;
if (existing && !existing.isDraft) {
  release('download', tag, '--pattern', recordFile, '--dir', out);
  record = read(out + '/' + recordFile);
  assert.deepEqual(record.images, plans, 'Published revision cannot be replaced');
  assert.equal(record.sourceCommit, head);
  verifyAssets(record);
  for (const plan of Object.values(plans)) {
    assert.equal(old[plan.runtime].fixed, plan.digest);
    verifyRegistry(plan, record);
  }
} else {
  if (existing) {
    assert.ok(existing.body.includes(marker), 'Draft belongs to a different set of digests');
    assert.equal(existing.targetCommitish, head, 'Draft belongs to another commit');
  } else {
    const notes = 'Verified native static and base images for AL2023 ' + version + ', revision ' + revision + '.\n\n' +
      variants.map(runtime => '- ' + plans[runtime].immutable + ' (' + plans[runtime].reference + ')').join('\n') +
      '\n\nThe source RPMs, build inputs, SBOMs, scans and project qualification are attached.\n\n' + marker;
    release('create', tag, '--draft', '--target', head, '--title', 'AL2023 foundation ' + version + '-r' + revision, '--notes', notes);
  }
  const assets = {};
  function asset(file, name) {
    assert.ok(!assets[name], 'Duplicate asset: ' + name);
    fs.copyFileSync(file, out + '/' + name);
    assets[name] = hash(out + '/' + name);
  }
  for (const arch of architectures) {
    for (const [name, digest] of Object.entries(provenance.leaves[arch].artifacts)) {
      const file = input + '/foundation-candidate-' + arch + '/' + name;
      assertSame(file, digest);
      asset(file, arch + '-' + name);
    }
  }
  for (const plan of Object.values(plans)) {
    asset(bundle + '/' + plan.runtime + '.oci.tar.gz', plan.runtime + '.oci.tar.gz');
    for (const [arch, leaf] of Object.entries(plan.leaves)) {
      const name = plan.runtime + '-' + arch;
      const scan = security.variants[plan.runtime].scans[arch];
      assert.equal(scan.manifest, leaf);
      assertSame(bundle + '/evidence/' + name + '-sbom.cdx.json', scan.sbom);
      assertSame(bundle + '/evidence/' + name + '-payload-packages.json', scan.coverage);
      assertSame(scans + '/scan-' + name + '.json', scan.report);
      for (const suffix of ['-sbom.cdx.json', '-payload-packages.json']) asset(bundle + '/evidence/' + name + suffix, name + suffix);
      asset(scans + '/scan-' + name + '.json', name + '-alas-scan.json');
    }
  }
  asset(bundle + '/evidence/provenance.json', 'provenance.json');
  asset(scans + '/security.json', 'security.json');
  asset(input + '/project-qualification-report/report.json', 'project-qualification.json');
  const scanFolders = Object.keys(languageCandidates).map(line => 'fresh-language-scan-' + line);
  for (const name of scanFolders) assert.ok(read(input + '/' + name + '/security.json').alas);
  run('tar', ['-czf', 'out/fresh-language-scans.tar.gz', '-C', input, ...scanFolders]);
  asset('out/fresh-language-scans.tar.gz', 'fresh-language-scans.tar.gz');
  record = { schemaVersion: 1, releaseTag: tag, releaseUrl, sourceCommit: head,
    run: 'https://github.com/' + repository + '/actions/runs/' + process.env.GITHUB_RUN_ID, images: plans, assets };
  write(out + '/' + recordFile, record);
  for (const plan of Object.values(plans)) {
    const layout = out + '/layout-' + plan.runtime;
    fs.mkdirSync(layout);
    run('tar', ['-xzf', bundle + '/' + plan.runtime + '.oci.tar.gz', '--no-same-owner', '-C', layout]);
    run('oras', ['cp', '--from-oci-layout', '--concurrency', '1', '--to-registry-config',
      process.env.DOCKER_CONFIG + '/config.json', layout + ':candidate', plan.base]);
    assert.equal(digestOf(plan.reference), plan.digest);
    assert.equal(visibility(plan.runtime), 'public');
    run('cosign', ['sign', '--yes', plan.reference]);
    run('cosign', ['attest', '--yes', '--type', predicate, '--predicate', out + '/' + recordFile, plan.reference]);
    for (const [arch, leaf] of Object.entries(plan.leaves)) {
      run('cosign', ['attest', '--yes', '--type', 'cyclonedx', '--predicate',
        out + '/' + plan.runtime + '-' + arch + '-sbom.cdx.json', plan.base + '@' + leaf]);
    }
    verifyRegistry(plan, record);
    if (!old[plan.runtime].fixed) setTag(plan.immutable, plan);
  }
  release('upload', tag, '--clobber', ...[recordFile, ...Object.keys(assets)].map(name => out + '/' + name));
  release('edit', tag, '--draft=false', '--latest=false');
  verifyAssets(record);
}
for (const plan of Object.values(plans)) {
  assert.equal(digestOf(plan.alias, true), old[plan.runtime].aliasDigest, 'Rolling tag changed during promotion');
  if (old[plan.runtime].aliasDigest !== plan.digest) setTag(plan.alias, plan);
}
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '# Published foundation images\n\n' + releaseUrl + '\n\n' +
  variants.map(runtime => '- ' + plans[runtime].alias + ': ' + plans[runtime].digest).join('\n') + '\n');
