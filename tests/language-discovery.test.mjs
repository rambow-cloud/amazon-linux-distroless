import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newerReleases, nodeReleases, pythonDirectories } from '../scripts/upstream/language-discovery-lib.mjs';

test('CPython selects newer final patch directories in the exact minor line', () => {
  const index = ['3.14.9', '3.14.10', '3.14.8', '3.15.1', '3.14.11rc1', '03.14.12']
    .map(version => '<a href="' + version + '/">').join('\n');
  const config = { variant: 'python', version: '3.14', upstreamVersion: '3.14.9' };
  assert.deepEqual(newerReleases(config, pythonDirectories(index)), ['3.14.10']);
  assert.throws(() => newerReleases(config, ['3.14.10']), /does not contain/);
});

test('Node keeps the major line and requires both binary architectures and source', () => {
  const files = ['src', 'linux-arm64', 'linux-x64'];
  const rows = [{ version: 'v22.9.1', files }, { version: 'v22.10.0', files, security: true },
    { version: 'v22.11.0-rc.1', files }, { version: 'v22.11.0', files: ['linux-x64', 'src'] },
    { version: 'v24.1.0', files }];
  const releases = nodeReleases(rows);
  const config = { variant: 'nodejs', version: '22', upstreamVersion: '22.9.1' };
  assert.deepEqual(newerReleases(config, releases.keys()), ['22.10.0']);
  assert.equal(releases.get('22.10.0').security, true);
});
