import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const keyRevision = '481637f813e912c4aa3622d7964ab426c97b8e8d';
const nodeKeys = [
  '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356',
  'DD792F5973C6DE52C432CBDAC77ABFA00DDBF2B7',
  'CC68F5A3106FF448322E48ED27F5E38D5B0A215F',
  '890C08DB8579162FEE0DF9DB8BEAB4DFCF555EF4',
  'C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C',
  '108F52B48DB57BB0CC439B2997B01419BD92F80A',
  '655F3B5C1FB3FA8D1A0CA6BDE4A7D232B936D2FD',
  'A363A499291CBBC940DD62E41F10027AF002F8B0',
];
const pythonSigners = {
  '3.11': ['pablogsal@python.org', 'https://accounts.google.com'],
  '3.12': ['thomas@python.org', 'https://accounts.google.com'],
  '3.13': ['thomas@python.org', 'https://accounts.google.com'],
  '3.14': ['hugo@python.org', 'https://github.com/login/oauth'],
};

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(url + ' returned HTTP ' + response.status);
  fs.writeFileSync(destination, Buffer.from(await response.arrayBuffer()));
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

export async function fetchUpstream(config, arch, directory, locked) {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Upstream resolution runs in GitHub Actions');
  fs.mkdirSync(directory, { recursive: true });
  const version = config.upstreamVersion;
  const archive = path.join(directory, 'archive');
  let record;
  if (config.variant === 'python') {
    const url = 'https://www.python.org/ftp/python/' + version + '/Python-' + version + '.tar.xz';
    const bundle = path.join(directory, 'release.sigstore');
    const [identity, issuer] = pythonSigners[config.version];
    await Promise.all([download(url, archive), download(url + '.sigstore', bundle)]);
    execFileSync('cosign', [
      'verify-blob', '--bundle', bundle, '--certificate-identity', identity,
      '--certificate-oidc-issuer', issuer, archive,
    ], { stdio: 'inherit' });
    record = { version, url, sha256: sha256(archive), sourceUrl: url, sourceSha256: sha256(archive),
      signature: { type: 'sigstore', identity, issuer } };
  } else {
    assert.ok(['amd64', 'arm64'].includes(arch));
    const base = 'https://nodejs.org/dist/v' + version + '/';
    const binaryName = 'node-v' + version + '-linux-' + (arch === 'amd64' ? 'x64' : 'arm64') + '.tar.xz';
    const sourceName = 'node-v' + version + '.tar.xz';
    const signature = path.join(directory, 'SHASUMS256.txt.asc');
    await download(base + 'SHASUMS256.txt.asc', signature);
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'node-release-keys-'));
    const gpg = (...args) => execFileSync('gpg', ['--batch', '--homedir', home, ...args], { encoding: 'utf8' });
    try {
      for (const fingerprint of nodeKeys) {
        const key = path.join(home, fingerprint + '.asc');
        await download('https://raw.githubusercontent.com/nodejs/release-keys/' + keyRevision + '/keys/' + fingerprint + '.asc', key);
        const primary = gpg('--with-colons', '--show-keys', key).split('\n').find(line => line.startsWith('fpr:'));
        assert.equal(primary?.split(':')[9], fingerprint, 'Node release key fingerprint differs');
        gpg('--import', key);
      }
      const status = gpg('--status-fd', '1', '--output', path.join(directory, 'SHASUMS256.txt'), '--decrypt', signature);
      const valid = status.split('\n').find(line => line.startsWith('[GNUPG:] VALIDSIG '));
      const signer = valid?.trim().split(/\s+/).at(-1);
      assert.ok(nodeKeys.includes(signer), 'Missing approved Node release signature');
      const hashes = new Map(fs.readFileSync(path.join(directory, 'SHASUMS256.txt'), 'utf8')
        .trim().split('\n').map(line => {
          const [hash, name] = line.trim().split(/\s+/);
          return [name, hash];
        }));
      record = { version, url: base + binaryName, sha256: hashes.get(binaryName),
        sourceUrl: base + sourceName, sourceSha256: hashes.get(sourceName),
        signature: { type: 'openpgp', signer, keyRevision } };
      assert.match(record.sha256, /^[a-f0-9]{64}$/);
      assert.match(record.sourceSha256, /^[a-f0-9]{64}$/);
      await download(record.url, archive);
      assert.equal(sha256(archive), record.sha256, 'Node binary differs from signed manifest');
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
  if (locked) assert.deepEqual(record, locked, 'Upstream release differs from reviewed lock');
  fs.writeFileSync(path.join(directory, 'upstream.json'), JSON.stringify(record, null, 2) + '\n');
  return record;
}

export async function preserveUpstreamSource(record, directory, sourceDirectory) {
  const name = new URL(record.sourceUrl).pathname.split('/').at(-1);
  const file = path.join(sourceDirectory, name);
  if (record.url === record.sourceUrl) fs.copyFileSync(path.join(directory, 'archive'), file);
  else await download(record.sourceUrl, file);
  assert.equal(sha256(file), record.sourceSha256, 'Corresponding upstream source checksum differs');
  for (const name of ['upstream.json', 'release.sigstore', 'SHASUMS256.txt.asc']) {
    const file = path.join(directory, name);
    if (fs.existsSync(file)) fs.copyFileSync(file, path.join(sourceDirectory, name));
  }
}
