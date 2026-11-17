import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { upstreamScanner } from '../scripts/release/upstream-scan.mjs';
import { vulnerabilityGate } from '../scripts/release/vulnerability-policy.mjs';

const exceptions = JSON.parse(fs.readFileSync(new URL('../releases/vulnerability-exceptions.json', import.meta.url)));
const now = Date.parse('2026-11-18T00:00:00Z');
const finding = { package: 'python', installed: '3.14.10', id: 'CVE-2026-119170', severity: 'High' };
const scope = { scanner: 'grype', runtime: 'python314', arch: 'amd64' };

test('the approved Python exception matches only its CVE, package, version, runtime, scanner and two architectures', () => {
  assert.equal(exceptions.length, 2);
  const gate = vulnerabilityGate(exceptions, now);
  for (const arch of ['amd64', 'arm64']) {
    const result = gate({ ...scope, arch }, [finding]);
    assert.equal(result.appliedExceptions.length, 1);
    assert.equal(result.appliedExceptions[0].arch, arch);
    assert.equal(result.appliedExceptions[0].review,
      'https://github.com/rambow-cloud/amazon-linux-distroless/issues/145');
  }
  for (const changed of [{ id: 'CVE-2026-119171' }, { package: 'openssl' }, { installed: '3.14.11' }]) {
    assert.throws(() => gate(scope, [{ ...finding, ...changed }]), /High\/Critical/);
  }
  for (const changed of [{ runtime: 'python313' }, { scanner: 'alas' }]) {
    assert.throws(() => gate({ ...scope, ...changed }, [finding]), /High\/Critical/);
  }
  assert.throws(() => gate(scope, [finding, { ...finding, id: 'CVE-2026-99999', severity: 'Critical' }]), /99999/);
  const expired = vulnerabilityGate(exceptions, Date.parse('2026-12-08T00:00:00Z'));
  assert.throws(() => expired(scope, [finding]), /exception expired/);
});

for (const fixableOnly of [true, false]) {
  test((fixableOnly ? 'preview' : 'stable') + ' scanner retains raw matches and records the exact applied exception', t => {
    for (const name of ['getuid', 'getgid']) {
      const descriptor = Object.getOwnPropertyDescriptor(process, name);
      Object.defineProperty(process, name, { value: () => 1000, configurable: true });
      t.after(() => { if (descriptor) Object.defineProperty(process, name, descriptor); else delete process[name]; });
    }
    const output = new Map();
    const bom = { components: [{ type: 'application', name: 'python', version: '3.14.10',
      cpe: 'cpe:2.3:a:python:python:3.14.10:*:*:*:*:*:*:*' }] };
    let matches = [{ artifact: { name: finding.package, version: finding.installed },
      vulnerability: { id: finding.id, severity: finding.severity, fix: { state: 'fixed', versions: ['3.14.11'] } } }];
    t.mock.method(fs, 'mkdirSync', () => {});
    t.mock.method(fs, 'readdirSync', () => ['vulnerability.db']);
    t.mock.method(fs, 'readFileSync', () => JSON.stringify(bom));
    t.mock.method(fs, 'writeFileSync', (file, content) => output.set(file, content));
    const execute = (command, args) => {
      assert.equal(command, 'docker');
      assert.ok(args[0] === 'pull' || args.at(-1) === 'update');
    };
    const capture = (command, args) => {
      assert.equal(command, 'docker');
      if (args.at(-1) === 'status') return 'Status: valid\nBuilt: ' + new Date().toISOString();
      return JSON.stringify({ matches });
    };
    const gate = vulnerabilityGate(exceptions, now);
    const scanner = upstreamScanner('out/test', execute, capture, () => 'database-digest', {
      fixableOnly, assessment: (arch, findings) => gate({ ...scope, arch }, findings),
    });
    for (const arch of ['amd64', 'arm64']) {
      const result = scanner.scan('runtime-sbom.json', arch, { version: finding.installed });
      assert.equal(result.findings, 1);
      assert.equal(result.fixableHighCritical, 1, 'The raw High finding must stay visible');
      const decision = result[fixableOnly ? 'previewGate' : 'stableGate'];
      assert.equal(decision.appliedExceptions.length, 1);
      assert.deepEqual(JSON.parse(output.get('out/test/upstream-scan-' + arch + '.json')).matches, matches);
    }
    matches.push({ ...matches[0], vulnerability: { ...matches[0].vulnerability, id: 'CVE-2026-99999' } });
    assert.throws(() => scanner.scan('runtime-sbom.json', 'amd64', { version: finding.installed }), /99999/);
    assert.equal(JSON.parse(output.get('out/test/upstream-scan-amd64.json')).matches.length, 2,
      'Reports survive a failed gate');
    matches = [{ ...matches[1], vulnerability: { ...matches[1].vulnerability, fix: { state: 'not-fixed' } } }];
    if (fixableOnly) {
      assert.equal(scanner.scan('runtime-sbom.json', 'amd64', { version: finding.installed }).findings, 1);
    } else {
      assert.throws(() => scanner.scan('runtime-sbom.json', 'amd64', { version: finding.installed }), /99999/);
    }
  });
}
