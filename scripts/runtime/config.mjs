export const runtimes = {
  python314: {
    variant: 'python', version: '3.14', executable: '/usr/bin/python3.14',
    packages: ['python3.14', 'python3.14-libs', 'python3.14-devel', 'python3.14-pip'],
  },
};
export function configuration(id) {
  if (!Object.hasOwn(runtimes,id)) throw new Error('Unsupported runtime: ' + id);
  return { id, ...runtimes[id] };
}
export function nativeArchitecture(arch) {
  if (!['amd64','arm64'].includes(arch) || process.arch !== (arch === 'amd64' ? 'x64' : 'arm64')) throw new Error('Native amd64/arm64 runner required');
  return arch;
}
