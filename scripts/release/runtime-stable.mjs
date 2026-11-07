import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { validateIndex } from './java21-policy.mjs';
import { alasScanner } from './alas-scan.mjs';
import { upstreamScanner } from './upstream-scan.mjs';
import { sha256File as hash } from './file-digest.mjs';
import {
  architectures, attestedPredicates, checksumManifest, issuer, repository,
  stableIdentity, stablePlan, stablePredicate, verifyAdvance, verifyNativeEvidence,
} from './stable-policy.mjs';

const execute = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
const capture = (command, args) => execFileSync(command, args, {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'],
}).trim();
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const releaseAPI = tag => 'repos/' + repository + '/releases/tags/' + tag;
const releaseURL = tag => 'https://github.com/' + repository + '/releases/tag/' + tag;
const ghRelease = (verb, tag, ...args) => execute('gh', ['release', verb, tag, '--repo', repository, ...args]);
const releaseDownload = (tag, directory, files) =>
  ghRelease('download', tag, '--dir', directory, ...files.flatMap(file => ['--pattern', file]));

function optional(command, args, missing) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (result.status === 0) return result.stdout.trim();
  if (result.status && missing.test(result.stderr)) return null;
  throw new Error(command + ' lookup failed: ' + (result.error?.message || result.stderr));
}

function assetMatches(assets, name, checksum) {
  const asset = assets.find(item => item.name === name);
  assert.ok(asset?.size > 0 && asset.state === 'uploaded', 'Missing release asset: ' + name);
  assert.equal(asset.digest, checksum, 'Release asset differs from signed checksum: ' + name);
}

function verifyAttestations(ref, type, identity, digest, expected) {
  const raw = capture('cosign', ['verify-attestation', '--type', type, '--certificate-identity', identity,
    '--certificate-oidc-issuer', issuer, ref]);
  const statements = attestedPredicates(raw, type === 'cyclonedx' ? null : type, digest);
  if (expected) assert.ok(statements.some(value => isDeepStrictEqual(value, expected)),
    'Attestation predicate differs from the release evidence');
  return { raw, statements };
}

function tagDigest(ref) {
  const output = optional('docker', ['buildx', 'imagetools', 'inspect', ref], /not found|manifest unknown/i);
  if (output === null) return null;
  const digest = /^Digest:\s*(sha256:[a-f0-9]{64})$/m.exec(output)?.[1];
  assert.ok(digest, 'Cannot read image digest for ' + ref);
  return digest;
}

function writeTag(tag, plan) {
  execute('docker', ['buildx', 'imagetools', 'create', '--tag', tag, plan.reference]);
  assert.equal(tagDigest(tag), plan.digest, 'Promoted digest differs');
}

function gitTagCommit(tag) {
  const output = optional('gh', ['api', 'repos/' + repository + '/git/ref/tags/' + tag], /HTTP 404/);
  if (output === null) return null;
  const object = JSON.parse(output).object;
  assert.equal(object.type, 'commit', 'Stable releases require lightweight Git tags');
  return object.sha;
}

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_REPOSITORY !== repository) {
  throw new Error('Stable promotion requires the trusted main workflow');
}
const head = capture('git', ['rev-parse', 'HEAD']);
assert.equal(head, process.env.GITHUB_SHA);
const runtime = process.env.STABLE_RUNTIME;
const candidates = read('releases/stable-candidates.json');
assert.ok(Object.hasOwn(candidates, runtime), 'No reviewed stable candidate');
const plan = stablePlan(runtime, candidates[runtime]);
const publish = process.env.STABLE_MODE === 'publish';
assert.ok(publish || process.env.STABLE_MODE === 'check', 'Expected check or publish');
if (publish) {
  assert.ok(process.env.DOCKER_CONFIG && process.env.GH_TOKEN, 'Missing publishing configuration');
  fs.mkdirSync(process.env.DOCKER_CONFIG, { recursive: true });
}
execute('git', ['merge-base', '--is-ancestor', plan.sourceCommit, head]);
assert.equal(capture('git', ['rev-parse', 'refs/tags/' + plan.previewTag + '^{commit}']), plan.sourceCommit);
const preview = JSON.parse(capture('gh', ['api', releaseAPI(plan.previewTag)]));
assert.ok(preview.prerelease && !preview.draft && preview.tag_name === plan.previewTag, 'Expected published preview');
assert.equal(JSON.parse(capture('gh', ['api', 'orgs/rambow-cloud/packages/container/' +
  encodeURIComponent('amazon-linux-distroless/' + runtime)])).visibility, 'public');

const input = 'out/stable-input';
const out = 'out/stable-evidence';
fs.mkdirSync(input, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const upstream = plan.variant !== 'java';
const boundFiles = architectures.flatMap(arch => [
  arch + '-sbom.cdx.json', arch + '-payload-packages.json', arch + '-verification.json',
  ...(upstream ? [arch + '-runtime-sbom.cdx.json'] : []),
]);
releaseDownload(plan.previewTag, input, ['published.json', 'provenance.json', 'SHA256SUMS', ...boundFiles]);
const provenance = read(input + '/provenance.json');
const published = read(input + '/published.json');
assert.equal(provenance.reference, plan.reference, 'Preview digest differs from reviewed plan');
assert.equal(provenance.sourceCommit, plan.sourceCommit);
assert.equal(published.releaseUrl, releaseURL(plan.previewTag));
assert.equal(published.certificateIdentity, plan.previewIdentity);
assert.deepEqual(Object.fromEntries(Object.keys(provenance).map(key => [key, published[key]])), provenance);
execute('cosign', ['verify', '--certificate-identity', plan.previewIdentity, '--certificate-oidc-issuer', issuer, plan.reference]);
verifyAttestations(plan.reference, plan.previewPredicate, plan.previewIdentity, plan.digest, provenance);

const checksumFile = input + '/SHA256SUMS';
assert.equal(hash(checksumFile), provenance.evidenceSHA256, 'Evidence manifest differs from signed provenance');
const checksums = checksumManifest(fs.readFileSync(checksumFile, 'utf8'));
for (const [name, checksum] of checksums) assetMatches(preview.assets, name, checksum);
for (const name of boundFiles) {
  assert.equal('sha256:' + hash(input + '/' + name), checksums.get(name), 'Downloaded evidence differs: ' + name);
}
for (const arch of architectures) {
  for (const name of [runtime + '-' + arch + '-image.tar.gz', runtime + '-' + arch + '-sources.tar.gz',
    arch + '-project-source.tar.gz', arch + '-inventory.json', arch + '-lock.json']) {
    assert.ok(checksums.has(name), 'Incomplete source or build evidence: ' + name);
  }
}
const records = Object.fromEntries(architectures.map(arch => [arch, read(input + '/' + arch + '-verification.json')]));
verifyNativeEvidence(plan, records, provenance);
validateIndex(JSON.parse(capture('docker', ['buildx', 'imagetools', 'inspect', '--raw', plan.reference])), provenance.leaves);
for (const arch of architectures) {
  const leaf = provenance.leaves[arch];
  verifyAttestations(plan.base + '@' + leaf, 'cyclonedx', plan.previewIdentity, leaf, read(input + '/' + arch + '-sbom.cdx.json'));
}

const oldDigest = tagDigest(plan.alias);
const oldReference = oldDigest ? plan.base + '@' + oldDigest : null;
let previous;
if (oldReference) {
  const candidates = verifyAttestations(oldReference, stablePredicate, stableIdentity, oldDigest).statements
    .filter(record => record.runtime === runtime && record.alias === plan.alias && record.reference === oldReference);
  assert.ok(candidates.length, 'The current stable tag has no matching signed promotion');
  previous = candidates[0];
  assert.ok(candidates.every(record => record.version === previous.version && record.revision === previous.revision),
    'Conflicting stable records for the current digest');
}
verifyAdvance(plan, previous);
const existingDigest = tagDigest(plan.immutable);
assert.ok(existingDigest === null || existingDigest === plan.digest, 'Immutable image tag collision');
const existingCommit = gitTagCommit(plan.releaseTag);
assert.ok(existingCommit === null || existingCommit === plan.sourceCommit, 'Immutable Git tag collision');

const alas = alasScanner(out, execute, read, hash);
const grype = upstream ? upstreamScanner(out, execute, capture, hash) : null;
const scans = {};
const upstreamScans = {};
for (const arch of architectures) {
  scans[arch] = alas.scan(input + '/' + arch + '-sbom.cdx.json', input + '/' + arch + '-payload-packages.json', arch);
  if (grype) upstreamScans[arch] = grype.scan(input + '/' + arch + '-runtime-sbom.cdx.json', arch, records[arch].upstream);
}
alas.verifyDatabase();
const security = {
  alas: { scanner: alas.scanner, database: alas.database, scans },
  ...(grype ? { upstream: { scanner: grype.scanner, database: grype.database, scans: upstreamScans } } : {}),
};
write(out + '/security.json', security);
const required = {
  schemaVersion: 1, runtime, version: plan.version, revision: plan.revision, reference: plan.reference,
  sourceCommit: plan.sourceCommit, immutable: plan.immutable, alias: plan.alias, releaseTag: plan.releaseTag,
  previewRelease: releaseURL(plan.previewTag), previewEvidenceSHA256: provenance.evidenceSHA256,
  leaves: provenance.leaves,
};
const matchRecord = record => {
  for (const [key, value] of Object.entries(required)) assert.deepEqual(record[key], value, 'Stable record differs: ' + key);
};
let record = {
  ...required, previousReference: oldReference,
  promotionRun: 'https://github.com/' + repository + '/actions/runs/' + process.env.GITHUB_RUN_ID,
  promotionCommit: head, releaseUrl: releaseURL(plan.releaseTag),
  imageBytes: Object.fromEntries(architectures.map(arch => [arch, records[arch].image.size])),
  maxImageMiB: plan.maxImageMiB,
  scanHashes: Object.fromEntries(fs.readdirSync(out).sort().map(name => [name, 'sha256:' + hash(out + '/' + name)])),
};

if (publish) {
  const release = optional('gh', ['release', 'view', plan.releaseTag, '--repo', repository,
    '--json', 'isDraft,isPrerelease,body'], /release not found|HTTP 404/i);
  const existing = release === null ? null : JSON.parse(release);
  if (existing && !existing.isDraft) {
    assert.equal(existing.isPrerelease, false);
    assert.equal(existingDigest, plan.digest, 'Published stable release is missing its immutable image');
    assert.equal(existingCommit, plan.sourceCommit, 'Published stable release has the wrong Git commit');
    releaseDownload(plan.releaseTag, input, ['stable.json']);
    record = read(input + '/stable.json');
    matchRecord(record);
    verifyAttestations(plan.reference, stablePredicate, stableIdentity, plan.digest, record);
    const released = JSON.parse(capture('gh', ['api', releaseAPI(plan.releaseTag)]));
    assetMatches(released.assets, 'stable.json', 'sha256:' + hash(input + '/stable.json'));
    for (const [name, checksum] of Object.entries(record.scanHashes)) assetMatches(released.assets, name, checksum);
  } else {
    const marker = '<!-- stable-candidate ' + plan.reference + ' -->';
    if (existing) assert.ok(existing.body.includes(marker), 'Draft belongs to a different promotion');
    const notes = out + '/release-notes.md';
    fs.writeFileSync(notes, [
      '# ' + runtime + ' ' + plan.version + '-r' + plan.revision + ' stable', '',
      marker, '', 'Image digest ' + plan.reference + '.', '',
      'Native amd64 and arm64 evidence, corresponding source and SBOMs are attached to the [qualified preview](' +
        record.previewRelease + '). This release attaches the fresh scan results and signed promotion record.', '',
      'Rolling stable tag `' + plan.alias + '`.', '',
    ].join('\n'));
    if (!existing) ghRelease('create', plan.releaseTag, '--draft', '--target', plan.sourceCommit,
      '--title', runtime + ' ' + plan.version + '-r' + plan.revision + ' stable', '--notes-file', notes);
    write(out + '/stable.json', record);
    execute('docker', ['login', 'ghcr.io', '--username', process.env.GITHUB_ACTOR, '--password-stdin'],
      { input: process.env.GH_TOKEN, stdio: ['pipe', 'pipe', 'inherit'] });
    execute('cosign', ['attest', '--yes', '--type', stablePredicate, '--predicate', out + '/stable.json', plan.reference]);
    const verified = verifyAttestations(plan.reference, stablePredicate, stableIdentity, plan.digest, record);
    fs.writeFileSync(out + '/stable-attestation-verification.json', verified.raw + '\n');
    ghRelease('upload', plan.releaseTag, '--clobber', out + '/stable.json', out + '/stable-attestation-verification.json',
      ...Object.keys(record.scanHashes).map(name => out + '/' + name));
    if (existingDigest === null) writeTag(plan.immutable, plan);
    ghRelease('edit', plan.releaseTag, '--draft=false', '--latest=false');
    const released = JSON.parse(capture('gh', ['api', releaseAPI(plan.releaseTag)]));
    assert.ok(!released.draft && !released.prerelease, 'Expected published stable release');
    assert.equal(gitTagCommit(plan.releaseTag), plan.sourceCommit, 'Stable Git tag differs from candidate commit');
    assetMatches(released.assets, 'stable.json', 'sha256:' + hash(out + '/stable.json'));
    for (const [name, checksum] of Object.entries(record.scanHashes)) assetMatches(released.assets, name, checksum);
  }
  if (oldDigest !== plan.digest) {
    assert.equal(tagDigest(plan.alias), oldDigest, 'The stable alias changed during promotion');
    if (existing && !existing.isDraft) execute('docker', ['login', 'ghcr.io', '--username', process.env.GITHUB_ACTOR,
      '--password-stdin'], { input: process.env.GH_TOKEN, stdio: ['pipe', 'pipe', 'inherit'] });
    writeTag(plan.alias, plan);
  }
  write(out + '/published-stable.json', record);
}
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '# ' + (publish ? 'Published stable ' : 'Validated stable candidate ') + runtime + '\n\n' +
  plan.reference + '\n\n' + (publish ? record.releaseUrl + '\n' : 'Stable promotion checks passed.\n'));
