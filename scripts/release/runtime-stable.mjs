import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { validateIndex } from './java21-policy.mjs';
import { alasScanner } from './alas-scan.mjs';
import { upstreamScanner } from './upstream-scan.mjs';
import { sha256File as hash } from './file-digest.mjs';
import { vulnerabilityGate } from './vulnerability-policy.mjs';
import {
  architectures, attestedPredicates, checksumManifest, compareStableReleases, issuer, latestStableRelease,
  repository, stableIdentity, stablePlan, stablePredicate, verifyAdvance, verifyNativeEvidence,
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

function writeTag(tag, plan, reference = plan.reference) {
  execute('docker', ['buildx', 'imagetools', 'create', '--tag', tag, reference]);
  assert.equal(tagDigest(tag), plan.digest, 'Promoted digest differs');
}

function registryLogin() {
  execute('docker', ['login', 'ghcr.io', '--username', process.env.GITHUB_ACTOR, '--password-stdin'],
    { input: process.env.GH_TOKEN, stdio: ['pipe', 'pipe', 'inherit'] });
}

function packageVisibility(name) {
  const output = optional('gh', ['api', 'orgs/rambow-cloud/packages/container/' +
    encodeURIComponent(name)], /HTTP 404/);
  return output === null ? null : JSON.parse(output).visibility;
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
const mirror = process.env.STABLE_MODE === 'mirror';
assert.ok(publish || mirror || process.env.STABLE_MODE === 'check', 'Expected check, publish, or mirror');
const destination = process.env.STABLE_MIRROR_REGISTRY || 'both';
assert.ok(['both', 'ghcr', 'quay'].includes(destination), 'Unknown mirror registry');
assert.ok(!publish || destination === 'both', 'Registry selection only applies to mirror mode');
const mirrorGHCR = destination !== 'quay';
const mirrorQuay = destination !== 'ghcr' && (mirror || process.env.QUAY_RUNTIME_MIRROR_ENABLED === 'true');
if (publish || mirror) {
  assert.ok(process.env.DOCKER_CONFIG && process.env.GH_TOKEN, 'Missing publishing configuration');
  if (mirrorQuay) assert.ok(process.env.QUAY_ROBOT_TOKEN, 'Missing Quay publishing credential');
  fs.mkdirSync(process.env.DOCKER_CONFIG, { recursive: true });
}
if (publish) assert.equal(packageVisibility(plan.variant), 'public', 'The short GHCR package must be public');
execute('git', ['merge-base', '--is-ancestor', plan.sourceCommit, head]);
assert.equal(capture('git', ['rev-parse', 'refs/tags/' + plan.previewTag + '^{commit}']), plan.sourceCommit);
const preview = JSON.parse(capture('gh', ['api', releaseAPI(plan.previewTag)]));
assert.ok(preview.prerelease && !preview.draft && preview.tag_name === plan.previewTag, 'Expected published preview');
assert.equal(packageVisibility('amazon-linux-distroless/' + runtime), 'public');

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
if (existingCommit) execute('git', ['merge-base', '--is-ancestor', existingCommit, head]);
const required = {
  schemaVersion: 1, runtime, version: plan.version, revision: plan.revision, reference: plan.reference,
  sourceCommit: plan.sourceCommit, immutable: plan.immutable, alias: plan.alias, releaseTag: plan.releaseTag,
  previewRelease: releaseURL(plan.previewTag), previewEvidenceSHA256: provenance.evidenceSHA256,
  leaves: provenance.leaves,
};

function publishedStableRecord() {
  const released = JSON.parse(capture('gh', ['api', releaseAPI(plan.releaseTag)]));
  assert.ok(!released.draft && !released.prerelease, 'Expected published stable release');
  assert.equal(existingDigest, plan.digest, 'Published stable release is missing its immutable image');
  releaseDownload(plan.releaseTag, input, ['stable.json']);
  const record = read(input + '/stable.json');
  for (const [key, value] of Object.entries(required)) assert.deepEqual(record[key], value, 'Stable record differs: ' + key);
  assert.ok(existingCommit && record.releaseCommit === existingCommit, 'Published stable Git tag differs from the signed record');
  verifyAttestations(plan.reference, stablePredicate, stableIdentity, plan.digest, record);
  assetMatches(released.assets, 'stable.json', 'sha256:' + hash(input + '/stable.json'));
  for (const [name, checksum] of Object.entries(record.scanHashes)) assetMatches(released.assets, name, checksum);
  return record;
}

function verifyMirror(base, record) {
  const ref = base + '@' + plan.digest;
  validateIndex(JSON.parse(capture('docker', ['buildx', 'imagetools', 'inspect', '--raw', ref])), record.leaves);
  execute('cosign', ['verify', '--certificate-identity', plan.previewIdentity,
    '--certificate-oidc-issuer', issuer, ref]);
  verifyAttestations(ref, plan.previewPredicate, plan.previewIdentity, plan.digest, provenance);
  verifyAttestations(ref, stablePredicate, stableIdentity, plan.digest, record);
  for (const arch of architectures) {
    const leaf = record.leaves[arch];
    verifyAttestations(base + '@' + leaf, 'cyclonedx', plan.previewIdentity, leaf,
      read(input + '/' + arch + '-sbom.cdx.json'));
  }
}

function copyMirror(base) {
  // Copy the OCI index, platform manifests, and their referrers before exposing any version tag.
  execute('oras', ['cp', '--recursive', '--concurrency', '1', '--to-registry-config',
    process.env.DOCKER_CONFIG + '/config.json', plan.reference, base]);
}

function publishChannel(record) {
  const legacyName = 'amazon-linux-distroless/' + plan.variant;
  const visibility = packageVisibility(legacyName);
  const current = visibility === null ? null : tagDigest(plan.channel);
  if (current) {
    const { statements } = verifyAttestations(plan.channelBase + '@' + current, stablePredicate, stableIdentity, current);
    const known = statements.filter(item => item.runtime === runtime && item.alias === plan.alias &&
      item.reference === plan.base + '@' + current);
    assert.ok(known.length, 'The shared channel has no matching stable record');
    assert.ok(known.every(item => item.version === known[0].version && item.revision === known[0].revision),
      'Conflicting stable records for the shared channel');
    verifyAdvance(plan, known[0]);
  }
  if (current !== plan.digest) copyMirror(plan.channelBase);
  assert.equal(packageVisibility(legacyName), 'public', 'The shared channel package must be public');
  verifyMirror(plan.channelBase, record);
  if (current !== plan.digest) {
    assert.equal(tagDigest(plan.channel), current, 'The shared channel changed during promotion');
    writeTag(plan.channel, plan, plan.channelReference);
  }
  write(out + '/published-channel.json', {
    runtime, alias: plan.channel, reference: plan.channelReference, leaves: record.leaves,
    releaseUrl: record.releaseUrl,
  });
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, 'Stable channel ' + plan.channel + '\n\n' +
    plan.channelReference + '\n');
}

function publishedMirrorRecord(base, digest, plans) {
  const { statements } = verifyAttestations(base + '@' + digest, stablePredicate, stableIdentity, digest);
  const records = statements.filter(record => plans.some(line => record.runtime === line.runtime &&
    record.alias === line.alias && record.reference === line.base + '@' + digest &&
    record.version?.startsWith(line.line + '.')));
  assert.ok(records.length, 'A mirror tag points to an unrecognized stable release');
  assert.ok(records.every(record => compareStableReleases(record, records[0]) === 0), 'Conflicting stable mirror records');
  return records[0];
}

function publishShortChannel(base, record, exists) {
  const fixed = base + ':' + plan.version + '-r' + plan.revision;
  const patch = base + ':' + plan.version;
  const rolling = base + ':' + plan.line;
  const latest = base + ':latest';
  const reference = base + '@' + plan.digest;
  const current = tag => exists ? tagDigest(tag) : null;
  const fixedDigest = current(fixed);
  const patchDigest = current(patch);
  const lineDigest = current(rolling);
  const latestDigest = current(latest);
  assert.ok(fixedDigest === null || fixedDigest === plan.digest, 'Immutable mirror tag collision');
  for (const [tag, digest] of [[patch, patchDigest], [rolling, lineDigest]]) {
    if (!digest || digest === plan.digest) continue;
    const previous = publishedMirrorRecord(base, digest, [plan]);
    if (tag === patch) assert.equal(previous.version, plan.version, 'Mirror patch tag has the wrong version');
    assert.ok(compareStableReleases(record, previous) > 0, 'Stable mirror rollback is blocked');
  }

  const familyPlans = Object.entries(candidates).map(([runtime, candidate]) => stablePlan(runtime, candidate))
    .filter(other => other.variant === plan.variant);
  const available = [record];
  for (const other of familyPlans) {
    if (other.runtime === plan.runtime) continue;
    const digest = current(base + ':' + other.line);
    if (digest) available.push(publishedMirrorRecord(base, digest, [other]));
  }
  const newest = latestStableRelease(available);
  if (latestDigest) {
    const previous = publishedMirrorRecord(base, latestDigest, familyPlans);
    assert.ok(compareStableReleases(newest, previous) >= 0, 'Latest mirror rollback is blocked');
  }
  const newestDigest = newest.reference.split('@')[1];

  if (!fixedDigest) copyMirror(base);
  verifyMirror(base, record);
  for (const [tag, before] of [[fixed, fixedDigest], [patch, patchDigest], [rolling, lineDigest]]) {
    if (before === plan.digest) continue;
    assert.equal(tagDigest(tag), before, 'A mirror version tag changed during publication');
    writeTag(tag, plan, reference);
  }
  if (latestDigest !== newestDigest) {
    assert.equal(tagDigest(latest), latestDigest, 'The latest tag changed during publication');
    writeTag(latest, { digest: newestDigest }, base + '@' + newestDigest);
  }
  return { reference, fixed, patch, rolling, latest, latestDigest: newestDigest };
}

function distribute(record) {
  const published = {};
  registryLogin();
  if (mirrorGHCR) {
    publishChannel(record);
    published.ghcr = publishShortChannel('ghcr.io/rambow-cloud/' + plan.variant, record, packageVisibility(plan.variant) !== null);
  }
  if (mirrorQuay) {
    execute('docker', ['login', 'quay.io', '--username', 'rambow-cloud+runtime_publisher', '--password-stdin'],
      { input: process.env.QUAY_ROBOT_TOKEN, stdio: ['pipe', 'pipe', 'inherit'] });
    published.quay = publishShortChannel('quay.io/rambow-cloud/' + plan.variant, record, true);
  }
  write(out + '/published-mirrors.json', { runtime, leaves: record.leaves, releaseUrl: record.releaseUrl, ...published });
  for (const image of Object.values(published)) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '\n' + image.rolling + '\n\n' + image.reference +
      '\n\n' + image.latest + ' → ' + image.latestDigest + '\n');
  }
}

if (mirror) {
  assert.equal(oldDigest, plan.digest, 'Complete the approved stable release before mirroring');
  distribute(publishedStableRecord());
  process.exit(0);
}

const gate = vulnerabilityGate(read('releases/vulnerability-exceptions.json'));
const assess = scanner => (arch, matches) => gate({ scanner, runtime, arch }, matches);
const alas = alasScanner(out, execute, read, hash, assess('alas'));
const grype = upstream ? upstreamScanner(out, execute, capture, hash, assess('grype')) : null;
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
let record = {
  ...required, previousReference: oldReference,
  promotionRun: 'https://github.com/' + repository + '/actions/runs/' + process.env.GITHUB_RUN_ID,
  promotionCommit: head, releaseCommit: existingCommit ?? head, releaseUrl: releaseURL(plan.releaseTag),
  imageBytes: Object.fromEntries(architectures.map(arch => [arch, records[arch].image.size])),
  maxImageMiB: plan.maxImageMiB,
  scanHashes: Object.fromEntries(fs.readdirSync(out).sort().map(name => [name, 'sha256:' + hash(out + '/' + name)])),
};

if (publish) {
  const release = optional('gh', ['release', 'view', plan.releaseTag, '--repo', repository,
    '--json', 'isDraft,isPrerelease,body,targetCommitish'], /release not found|HTTP 404/i);
  const existing = release === null ? null : JSON.parse(release);
  if (existing && !existing.isDraft) {
    record = publishedStableRecord();
  } else {
    const marker = '<!-- stable-candidate ' + plan.reference + ' -->';
    if (existing) assert.ok(existing.body.includes(marker), 'Draft belongs to a different promotion');
    if (existingCommit) assert.equal(existing?.targetCommitish, existingCommit, 'Immutable Git tag collision');
    const notes = out + '/release-notes.md';
    fs.writeFileSync(notes, [
      '# ' + runtime + ' ' + plan.version + '-r' + plan.revision + ' stable', '',
      marker, '', 'Image digest ' + plan.reference + '.', '',
      'Build source commit `' + plan.sourceCommit + '`. The release Git tag identifies the promotion commit.', '',
      'Native amd64 and arm64 evidence, corresponding source and SBOMs are attached to the [qualified preview](' +
        record.previewRelease + '). This release attaches the fresh scan results and signed promotion record.', '',
      'Rolling stable tags `ghcr.io/rambow-cloud/' + plan.variant + ':' + plan.line +
        '` and `quay.io/rambow-cloud/' + plan.variant + ':' + plan.line + '`.', '',
    ].join('\n'));
    if (!existing) ghRelease('create', plan.releaseTag, '--draft', '--target', head,
      '--title', runtime + ' ' + plan.version + '-r' + plan.revision + ' stable', '--notes-file', notes);
    else if (!existingCommit && existing.targetCommitish !== head) ghRelease('edit', plan.releaseTag, '--target', head);
    write(out + '/stable.json', record);
    registryLogin();
    execute('cosign', ['attest', '--yes', '--type', stablePredicate, '--predicate', out + '/stable.json', plan.reference]);
    const verified = verifyAttestations(plan.reference, stablePredicate, stableIdentity, plan.digest, record);
    fs.writeFileSync(out + '/stable-attestation-verification.json', verified.raw + '\n');
    ghRelease('upload', plan.releaseTag, '--clobber', out + '/stable.json', out + '/stable-attestation-verification.json',
      ...Object.keys(record.scanHashes).map(name => out + '/' + name));
    if (existingDigest === null) writeTag(plan.immutable, plan);
    ghRelease('edit', plan.releaseTag, '--draft=false', '--latest=false');
    const released = JSON.parse(capture('gh', ['api', releaseAPI(plan.releaseTag)]));
    assert.ok(!released.draft && !released.prerelease, 'Expected published stable release');
    assert.equal(gitTagCommit(plan.releaseTag), record.releaseCommit, 'Stable Git tag differs from the promotion record');
    assetMatches(released.assets, 'stable.json', 'sha256:' + hash(out + '/stable.json'));
    for (const [name, checksum] of Object.entries(record.scanHashes)) assetMatches(released.assets, name, checksum);
  }
  if (oldDigest !== plan.digest) {
    assert.equal(tagDigest(plan.alias), oldDigest, 'The stable alias changed during promotion');
    if (existing && !existing.isDraft) registryLogin();
    writeTag(plan.alias, plan);
  }
  write(out + '/published-stable.json', record);
  distribute(record);
}
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '# ' + (publish ? 'Published stable ' : 'Validated stable candidate ') + runtime + '\n\n' +
  plan.reference + '\n\n' + (publish ? record.releaseUrl + '\n' : 'Stable promotion checks passed.\n'));
