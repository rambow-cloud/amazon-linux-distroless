import assert from 'node:assert/strict';
import { test } from 'node:test';
import { affectsFoundation, requireFoundation } from '../scripts/foundation/ci.mjs';

test('foundation CI runs for changed and moved build inputs and skips documentation', () => {
  assert.equal(affectsFoundation([{ filename: 'locks/foundation/linux-arm64.json' }]), true);
  assert.equal(affectsFoundation([{ filename: 'new-path.py', previous_filename: 'scripts/prototype/assemble.py' }]), true);
  assert.equal(affectsFoundation([{ filename: 'docs/FOUNDATION.md' }]), false);
});

test('missing, failed or cancelled evidence blocks a relevant pull request', () => {
  assert.doesNotThrow(() => requireFoundation('success', 'false', 'skipped', 'skipped'));
  assert.doesNotThrow(() => requireFoundation('success', 'true', 'success', 'success'));
  for (const failure of ['failure', 'cancelled', 'skipped']) {
    assert.throws(() => requireFoundation('success', 'true', failure, 'skipped'), /must pass/);
    assert.throws(() => requireFoundation('success', 'true', 'success', failure), /must pass/);
  }
  assert.throws(() => requireFoundation('failure', '', 'skipped', 'skipped'), /scope/);
});
