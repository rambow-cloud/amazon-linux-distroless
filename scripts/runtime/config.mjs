import fs from 'node:fs';

const versions = JSON.parse(fs.readFileSync(new URL('../../images/upstream/versions.json', import.meta.url)));
export const runtimes = Object.fromEntries(Object.entries(versions).map(([id, upstreamVersion]) => {
  if (!/^\d+\.\d+\.\d+$/.test(upstreamVersion)) throw new Error('Expected an exact upstream release');
  const parts = upstreamVersion.split('.');
  if (id === 'python' + parts.slice(0, 2).join('')) {
    const version = parts.slice(0, 2).join('.');
    return [id, { variant: 'python', version, upstreamVersion, executable: '/usr/bin/python' + version }];
  }
  if (id === 'nodejs' + parts[0]) {
    return [id, { variant: 'nodejs', version: parts[0], upstreamVersion, executable: '/usr/bin/node-' + parts[0] }];
  }
  throw new Error('Runtime identifier and release disagree: ' + id);
}));
export function configuration(id) {
  if (!Object.hasOwn(runtimes,id)) throw new Error('Unsupported runtime: ' + id);
  return { id, ...runtimes[id] };
}
export function nativeArchitecture(arch) {
  if (!['amd64','arm64'].includes(arch) || process.arch !== (arch === 'amd64' ? 'x64' : 'arm64')) throw new Error('Native amd64/arm64 runner required');
  return arch;
}

export function rpmLock(variant, arch) {
  return 'locks/upstream/' + variant + '-linux-' + arch + '.json';
}
