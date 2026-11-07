const prefixes = ['images/foundation/', 'locks/foundation/', 'scripts/foundation/', 'examples/foundation/'];
const exact = new Set([
  '.dockerignore', '.github/workflows/foundation-build.yml',
  'images/upstream/Dockerfile', 'images/upstream/packages.json',
  'scripts/prototype/assemble.py', 'scripts/runtime/config.mjs', 'scripts/runtime/dockerfile.mjs',
  'scripts/release/foundation-evidence.mjs', 'scripts/release/file-digest.mjs', 'security/compare-lib.mjs',
]);

export function affectsFoundation(files) {
  return files.some(file => [file.filename, file.previous_filename].some(
    path => path && (exact.has(path) || prefixes.some(prefix => path.startsWith(prefix))),
  ));
}

export function requireFoundation(scope, required, builds, index) {
  if (scope !== 'success' || !['true', 'false'].includes(required)) {
    throw new Error('Could not determine the foundation validation scope');
  }
  if (required === 'true' && (builds !== 'success' || index !== 'success')) {
    throw new Error('Native foundation workload checks and OCI index verification must pass');
  }
}
