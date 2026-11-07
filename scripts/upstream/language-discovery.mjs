import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runtimes } from '../runtime/config.mjs';
import { fetchUpstream, preserveUpstreamSource } from '../runtime/upstream.mjs';
import { newerReleases, nodeReleases, pythonDirectories } from './language-discovery-lib.mjs';

if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Resolve release candidates only in GitHub Actions');
const commit = process.env.GITHUB_SHA;
assert.match(commit, /^[a-f0-9]{40}$/);
const directory = 'out/language-updates';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
};
const nodeIndex = 'https://nodejs.org/dist/index.json';
const pythonIndex = 'https://www.python.org/ftp/python/';
const pythonArchive = version => pythonIndex + version + '/Python-' + version + '.tar.xz';
const observations = directory + '/observations.json';
const versionsFile = 'images/upstream/versions.json';
const lockFile = (line, arch) => 'locks/upstream/' + line + '-' + arch + '.json';
const request = (url, method = 'GET') => fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(60_000) });
async function index(url, format) {
  const response = await request(url);
  if (!response.ok) throw new Error('Official release index returned HTTP ' + response.status + ': ' + url);
  return response[format]();
}

if (process.argv[2] === 'observe') {
  const [nodes, pythons] = await Promise.all([index(nodeIndex, 'json'), index(pythonIndex, 'text')]);
  const node = nodeReleases(nodes);
  const python = pythonDirectories(pythons);
  const results = {};
  for (const [line, config] of Object.entries(runtimes)) {
    const available = newerReleases(config, config.variant === 'python' ? python : node.keys());
    let candidate = null;
    for (const version of available) {
      if (config.variant === 'python') {
        // CPython can create a version directory before the final archive is available.
        const response = await request(pythonArchive(version), 'HEAD');
        if (response.status === 404) continue;
        if (!response.ok) throw new Error('Could not inspect the final CPython archive: HTTP ' + response.status);
      }
      candidate = version;
      break;
    }
    results[line] = { locked: config.upstreamVersion, candidate,
      source: config.variant === 'python' ? pythonIndex : nodeIndex,
      ...(candidate && config.variant === 'nodejs' && node.get(candidate)) };
    console.log(line, config.upstreamVersion, candidate ?? 'unchanged');
  }
  const hasCandidates = Object.values(results).some(row => row.candidate);
  write(observations, { commit, results });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, 'candidates=' + hasCandidates + '\n');
} else if (process.argv[2] === 'lock') {
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main');
  assert.equal(process.env.GITHUB_REPOSITORY, 'rambow-cloud/amazon-linux-distroless');
  assert.ok(['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME));
  const { commit: observed, results } = read(observations);
  assert.equal(observed, commit);
  const versions = read(versionsFile);
  const diffs = {};
  for (const [line, row] of Object.entries(results)) {
    if (!row.candidate) continue;
    const config = runtimes[line];
    assert.equal(config.upstreamVersion, row.locked);
    assert.deepEqual(newerReleases(config, [row.locked, row.candidate]), [row.candidate]);
    const next = { ...config, upstreamVersion: row.candidate };
    const downloads = directory + '/downloads/' + line;
    const amd64 = await fetchUpstream(next, 'amd64', downloads + '/amd64');
    const arm64 = config.variant === 'python' ? amd64 : await fetchUpstream(next, 'arm64', downloads + '/arm64');
    for (const field of ['sourceUrl', 'sourceSha256']) assert.equal(amd64[field], arm64[field]);
    const sources = downloads + '/sources';
    fs.mkdirSync(sources, { recursive: true });
    await preserveUpstreamSource(amd64, downloads + '/amd64', sources);
    diffs[line] = {};
    for (const [arch, record] of Object.entries({ amd64, arm64 })) {
      const file = lockFile(line, arch);
      const old = read(file);
      assert.equal(old.version, row.locked);
      write(directory + '/candidate/' + file, record);
      diffs[line][arch] = { old, candidate: record };
    }
    versions[line] = row.candidate;
  }
  assert.ok(Object.keys(diffs).length, 'No candidate locks generated');
  write(directory + '/candidate/' + versionsFile, versions);
  write(directory + '/lock-diffs.json', { sourceCommit: commit, diffs });
} else {
  throw new Error('Expected observe or lock');
}
