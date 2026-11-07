import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { inventorySbom } from '../../security/compare-lib.mjs';
import { alasScanner } from './alas-scan.mjs';
import { sha256File } from './file-digest.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Run the ALAS backport check in Actions');
const out = 'out/alas-backport';
fs.mkdirSync(out, { recursive: true });
const execute = (command, args) => execFileSync(command, args, { stdio: 'inherit' });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const advisory = 'CVE-2023-0464';
const actual = {};
const scanner = alasScanner(out, execute, read, sha256File, (_sample, findings) => findings);
for (const [sample, release] of [['before', '1.amzn2023.0.1'], ['fixed', '1.amzn2023.0.2']]) {
  const name = 'openssl-libs';
  const identity = { name, epoch: '1', version: '3.0.8', release, arch: 'x86_64',
    source_rpm: 'openssl-3.0.8-' + release + '.src.rpm', license: 'Apache-2.0', sha256: '0'.repeat(64) };
  const source = { ...identity, name: 'openssl', arch: 'src', filename: identity.source_rpm };
  const { bom, coverage } = inventorySbom({ packages: [identity], files: [{
    kind: 'file', path: 'usr/lib64/libcrypto.so.3', packages: [name], sha256: '0'.repeat(64),
  }] }, { sources: [source] }, 'sha256:' + '0'.repeat(64));
  write(out + '/' + sample + '-sbom.json', bom);
  write(out + '/' + sample + '-coverage.json', coverage);
  actual[sample] = scanner.scan(out + '/' + sample + '-sbom.json', out + '/' + sample + '-coverage.json', sample)
    .stableGate.find(finding => finding.id === advisory) || null;
}
scanner.verifyDatabase();
assert.ok(actual.before, 'Expected the older AL2023 RPM to match the advisory');
assert.match(actual.before.fixed, /3\.0\.8-1\.amzn2023\.0\.2/);
assert.equal(actual.fixed, null, 'The exact AL2023 backport still matched the advisory');
write(out + '/comparison.json', { advisory, reference: 'https://alas.aws.amazon.com/AL2023/ALAS-2023-181.html',
  scanner: scanner.scanner, database: scanner.database, syntheticPackageInputs: true, findings: actual });
