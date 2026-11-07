import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { assertMetadataOverlay } from './rpmdb-lib.mjs';

export function rpmdbOverlays(root, lock, prototype, tag) {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Run RPM database reconstruction in Actions');
  const docker = (...args) => execFileSync('docker', args, { stdio: 'inherit' });
  const inspect = image => JSON.parse(execFileSync('docker', ['image', 'inspect', image], { encoding: 'utf8' }))[0];
  docker('build', '--platform', 'linux/amd64', '-f', 'prototype/Dockerfile', '--target', 'tools',
    '--build-arg', 'AL2023_BASE=' + lock.builder, '--build-arg', 'AL2023_RELEASE=' + lock.releasever,
    '-t', 'al2023-rpmdb-tools:scan', '.');
  const common = ['run', '--rm', '--platform', 'linux/amd64', '-e', 'GITHUB_ACTIONS=true',
    '--mount', 'type=bind,src=' + root + ',dst=/work', '--entrypoint', '/usr/bin/python3'];
  docker(...common, 'al2023-rpmdb-tools:scan', '/work/security/rpmdb.py', 'fetch');
  docker(...common, '--network', 'none', 'al2023-rpmdb-tools:scan', '/work/security/rpmdb.py', 'reconstruct');
  const result = JSON.parse(fs.readFileSync('out/cve/rpmdb-evidence.json', 'utf8'));
  result.overlays = {};
  for (const variant of ['full', 'payload']) {
    const imageTag = 'al2023-java-rpmdb:scan-' + variant;
    docker('build', '--platform', 'linux/amd64', '--network', 'none', '--pull=false',
      '-f', 'security/rpmdb.Dockerfile', '--build-arg', 'BASE=' + tag, '-t', imageTag,
      'out/cve/rpmdb/' + variant);
    const image = inspect(imageTag);
    assertMetadataOverlay(prototype, image);
    result.overlays[variant] = { id: image.Id, tag: imageTag, size: image.Size,
      originalLayerPrefixVerified: true, runtimeConfigVerified: true, layers: image.RootFS.Layers };
  }
  if (inspect(tag).Id !== prototype.Id) throw new Error('Original prototype tag changed');
  // Keep the container-owned reconstruction evidence intact. Write runner-owned
  // image evidence separately instead of overwriting the root-owned JSON file.
  fs.writeFileSync('out/cve/rpmdb-overlays.json', JSON.stringify(result.overlays, null, 2) + '\n');
  return result;
}
