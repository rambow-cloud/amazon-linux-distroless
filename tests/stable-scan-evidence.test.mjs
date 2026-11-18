import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { reuseStableScan, stableScanHashes } from '../scripts/release/stable-scan-evidence.mjs';

const now = Date.parse('2026-11-19T12:00:00Z');
const plan = { variant: 'python' };
const identity = { run: '123', commit: 'a'.repeat(40), runtime: 'python314',
  reference: 'python@sha256:' + 'b'.repeat(64), releaseTag: 'python314-3.14.10-r1' };

function fixture(t) {
  const temp = path.resolve(os.tmpdir());
  const root = fs.mkdtempSync(path.join(temp, 'stable-scan-evidence-'));
  assert.equal(path.dirname(root), temp);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = fs.mkdirSync(path.join(root, 'input'), { recursive: true });
  const output = fs.mkdirSync(path.join(root, 'output'), { recursive: true });
  const date = new Date(now - 60_000).toISOString();
  const scans = () => Object.fromEntries(['amd64', 'arm64'].map(arch => [arch, { stableGate: { appliedExceptions: [] } }]));
  const security = { alas: { database: { metadata: { UpdatedAt: date } }, scans: scans() },
    upstream: { database: { built: date }, scans: scans() } };
  const write = (name, data) => fs.writeFileSync(path.join(input, name), JSON.stringify(data));
  for (const arch of ['amd64', 'arm64']) {
    write('scan-' + arch + '.json', {});
    write('upstream-scan-' + arch + '.json', {});
  }
  const seal = (checkedAt = date) => {
    write('security.json', security);
    write('preflight.json', { identity, checkedAt, scanHashes: stableScanHashes(input, plan) });
  };
  seal();
  return { input, output, security, seal, write };
}

test('publication copies only the verified same-run candidate scans', t => {
  const { input, output } = fixture(t);
  assert.deepEqual(reuseStableScan(input, output, plan, identity, now), stableScanHashes(output, plan));
  assert.equal(fs.existsSync(path.join(output, 'preflight.json')), false);
  for (const different of [{ run: '124' }, { commit: 'c'.repeat(40) }, { runtime: 'python313' },
    { reference: 'other' }, { releaseTag: 'other' }]) {
    assert.throws(() => reuseStableScan(input, output, plan, { ...identity, ...different }, now), /different run or candidate/);
  }
});

test('publication rejects stale, incomplete, modified and expired evidence', t => {
  const { input, output, security, seal, write } = fixture(t);
  const verify = () => reuseStableScan(input, output, plan, identity, now);
  seal(new Date(now - 4 * 60 * 60_000).toISOString());
  assert.throws(verify, /preflight expired/);
  seal();
  write('scan-amd64.json', { changed: true });
  assert.throws(verify, /files differ/);
  seal();
  security.upstream.scans.arm64.stableGate.appliedExceptions = [{ id: 'CVE-example', expires: '2026-11-19' }];
  seal();
  assert.throws(verify, /exception expired/);
  security.upstream.database.built = '2026-11-16T00:00:00Z';
  seal();
  assert.throws(verify, /48 hours/);
  fs.unlinkSync(path.join(input, 'upstream-scan-arm64.json'));
  assert.throws(verify, /ENOENT/);
  assert.deepEqual(fs.readdirSync(output), []);
});
