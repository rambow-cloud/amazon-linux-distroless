import assert from 'node:assert/strict';
import fs from 'node:fs';
import { configuration } from '../runtime/config.mjs';
import { validateRuntimeReports } from './runtime-policy.mjs';
import { publish } from './publish.mjs';
const config=configuration(process.env.RUNTIME_ID || 'python314');
publish({
  id: config.id,
  title: (config.variant === 'python' ? 'Python ' : 'Node.js ') + config.upstreamVersion,
  alias: config.version + '-preview',
  workflow: 'runtime-publish.yml',
  metadata: { runtime: config.id },
  upstream: true,
  validateReports(records, commit) {
    validateRuntimeReports(records, commit, config.id);
    for (const [arch, record] of Object.entries(records)) {
      const lock = JSON.parse(fs.readFileSync('locks/upstream/' + config.id + '-' + arch + '.json'));
      assert.deepEqual(record.upstream, lock, 'Upstream evidence differs from lock');
      assert.equal(lock.version, config.upstreamVersion);
      assert.equal(record.sample[config.variant === 'python' ? 'python' : 'node'], lock.version);
    }
  },
});
