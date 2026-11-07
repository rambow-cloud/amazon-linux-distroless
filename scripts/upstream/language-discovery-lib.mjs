import assert from 'node:assert/strict';

const final = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function pythonDirectories(index) {
  const names = [...index.matchAll(/\bhref=["']([^/"']+)\/["']/gi)].map(match => match[1]);
  return [...new Set(names.filter(name => final.test(name)))];
}

export function nodeReleases(index) {
  assert.ok(Array.isArray(index), 'Invalid Node.js release index');
  const result = new Map();
  for (const row of index) {
    if (typeof row?.version !== 'string' || !row.version.startsWith('v')) continue;
    const version = row.version.slice(1);
    if (!final.test(version) || !Array.isArray(row.files) ||
        !['linux-arm64', 'linux-x64', 'src'].every(file => row.files.includes(file))) continue;
    result.set(version, { security: row.security === true });
  }
  return result;
}

function compare(left, right) {
  const l = left.split('.').map(BigInt);
  const r = right.split('.').map(BigInt);
  for (let i = 0; i < 3; i++) {
    if (l[i] < r[i]) return -1;
    if (l[i] > r[i]) return 1;
  }
  return 0;
}

export function newerReleases(config, releases) {
  assert.match(config.upstreamVersion, final);
  assert.ok(['python', 'nodejs'].includes(config.variant));
  const names = [...releases];
  assert.ok(names.includes(config.upstreamVersion), 'Official index does not contain the current locked release');
  return names.filter(name => final.test(name) && name.startsWith(config.version + '.') &&
    compare(name, config.upstreamVersion) > 0).sort((a, b) => compare(b, a));
}
