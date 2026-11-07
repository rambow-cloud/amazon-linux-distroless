import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { validateIndex, validateScan } from './java21-policy.mjs';

// Profile identity/validator comes from a reviewed language-specific entry point.
export function publish(profile) {
  const line=profile.id;
  assert.match(line,/^[a-z][a-z0-9]*$/);
  assert.match(profile.workflow,/^[a-z0-9-]+\.yml$/);
  assert.match(profile.alias,/^[a-zA-Z0-9_.-]+$/);
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Publication requires a manual trusted main run');
  const repo = process.env.GITHUB_REPOSITORY;
  assert.equal(repo, 'rambow-cloud/amazon-linux-distroless');
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(commit, process.env.GITHUB_SHA);
  const run = process.env.GITHUB_RUN_ID;
  const out = 'out/publication', input = 'out/release-inputs';
  fs.mkdirSync(out, { recursive: true });
  const read = file => JSON.parse(fs.readFileSync(file));
  const write = (name, data) => fs.writeFileSync(out + '/' + name, JSON.stringify(data, null, 2) + '\n');
  const execute = (command, args, options = {}) => execFileSync(command, args, { stdio: 'inherit', ...options });
  const capture = (command, args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] }).trim();
  function hash(file) {
    const h = crypto.createHash('sha256'), fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(4 * 1024 * 1024);
    try { let n; while ((n = fs.readSync(fd, bytes, 0, bytes.length, null))) h.update(bytes.subarray(0,n)); }
    finally { fs.closeSync(fd); } return h.digest('hex');
  }
  const records = Object.fromEntries(['amd64','arm64'].map(a => [a, read(input + '/' + line + '-' + a + '-evidence/verification.json')]));
  profile.validateReports(records, commit);
  const base = 'ghcr.io/' + repo + '/' + line, tag = line + '-' + commit.slice(0,12), immutable = base + ':' + tag;
  // An immutable release is never overwritten by an automatic rerun.
  const existing = spawnSync('gh', ['release', 'view', tag, '--repo', repo, '--json', 'tagName'], { encoding: 'utf8' });
  if (existing.status === 0) throw new Error('This immutable preview release already exists; inspect it before deliberate recovery');
  if (!/not found|release not found|HTTP 404/i.test(existing.stderr || '')) throw new Error('Could not establish release-tag availability: ' + existing.stderr);

  const scanner = 'aquasec/trivy@sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb';
  execute('docker', ['pull', '--platform', 'linux/amd64', scanner]);
  fs.mkdirSync('out/' + line + '-trivy-cache', { recursive: true });
  const common = ['run','--rm','--user',process.getuid()+':'+process.getgid(),'--tmpfs','/tmp:rw,nosuid,nodev,mode=1777',
    '--mount','type=bind,src='+process.cwd()+',dst=/work','--mount','type=bind,src='+process.cwd()+'/out/' + line + '-trivy-cache,dst=/cache',
    '-e','HOME=/tmp','-e','TRIVY_SKIP_VERSION_CHECK=true'];
  execute('docker', [...common,scanner,'--cache-dir','/cache','image','--download-db-only']);
  const database = { sha256: hash('out/' + line + '-trivy-cache/db/trivy.db'), metadata: read('out/' + line + '-trivy-cache/db/metadata.json') };
  const scans = {};
  for (const arch of ['amd64','arm64']) {
    const evidence = input + '/' + line + '-' + arch + '-evidence';
    execute('docker', [...common,'--network','none',scanner,'--cache-dir','/cache','sbom','--skip-db-update','--skip-java-db-update',
      '--offline-scan','--scanners','vuln','--severity','UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL','--ignore-unfixed=false','--ignorefile','/dev/null',
      '--format','json','--list-all-pkgs','--exit-code','0','--output','/work/'+out+'/scan-'+arch+'.json','/work/'+evidence+'/sbom.cdx.json']);
    scans[arch] = validateScan(read(out+'/scan-'+arch+'.json'), read(evidence+'/payload-packages.json').selected);
    for (const file of ['inventory.json','sbom.cdx.json','payload-packages.json','lock.json','verification.json','project-source.tar.gz']) {
      fs.copyFileSync(evidence+'/'+file,out+'/'+arch+'-'+file);
    }
    fs.renameSync(input+'/' + line + '-'+arch+'-image/image.tar.gz',out+'/' + line + '-'+arch+'-image.tar.gz');
    fs.renameSync(input+'/' + line + '-'+arch+'-sources/sources.tar.gz',out+'/' + line + '-'+arch+'-sources.tar.gz');
  }
  assert.equal(hash('out/' + line + '-trivy-cache/db/trivy.db'),database.sha256,'Scanner database changed');
  write('security.json',{scanner,database,scans,policy:'Block fixable High/Critical ALAS findings; retain all findings and document unfixed/JVM coverage limitations'});
  const assets = fs.readdirSync(out).filter(n=>!n.endsWith('.md')).sort();
  fs.writeFileSync(out+'/SHA256SUMS',assets.map(n=>hash(out+'/'+n)+'  '+n).join('\n')+'\n');
  const initialNotes = '# ' + profile.title + ' qualified preview\n\nNative amd64/arm64 qualification passed at source '+commit+'.\n\n'+
    'This prerelease includes exact Docker image archives, payload SBOMs/file maps/locks, verification reports, matching source RPM bundles and project source. Component licenses remain individual. Registry signing/publication is being finalized by [Actions run](https://github.com/'+repo+'/actions/runs/'+run+').\n\n'+
    'This is a runtime preview, not a declaration that the project-wide Java/Python/Node.js v1 milestone is complete.\n';
  fs.writeFileSync(out+'/release-notes.md',initialNotes);
  execute('gh',['release','create',tag,'--repo',repo,'--target',commit,'--title',profile.title + ' preview '+commit.slice(0,12),'--draft','--prerelease','--notes-file',out+'/release-notes.md']);
  execute('gh',['release','upload',tag,'--repo',repo,...assets.map(n=>out+'/'+n),out+'/SHA256SUMS']);
  execute('gh',['release','edit',tag,'--repo',repo,'--draft=false','--prerelease']);

  const auth = path.resolve('out/' + line + '-registry-auth'); fs.mkdirSync(auth,{recursive:true}); process.env.DOCKER_CONFIG=auth;
  assert.ok(process.env.GH_TOKEN,'Missing publication token');
  execute('docker',['login','ghcr.io','--username',process.env.GITHUB_ACTOR,'--password-stdin'],{input:process.env.GH_TOKEN,stdio:['pipe','pipe','inherit']});
  const leaves = {};
  for (const arch of ['amd64','arm64']) {
    execute('docker',['load','--input',out+'/' + line + '-'+arch+'-image.tar.gz']);
    const image = JSON.parse(capture('docker',['image','inspect','al2023-' + line + '-runtime:candidate']))[0];
    assert.equal(image.Id,records[arch].image.id); assert.equal(image.Architecture,arch);
    const leaf = immutable+'-'+arch;
    execute('docker',['tag',image.Id,leaf]);
    const pushed = capture('docker',['push',leaf]);
    const digest = /digest:\s*(sha256:[a-f0-9]{64})/.exec(pushed)?.[1]; assert.ok(digest,'Missing pushed manifest digest'); leaves[arch]=digest;
  }
  execute('docker',['buildx','imagetools','create','--tag',immutable,...Object.values(leaves).map(d=>base+'@'+d)]);
  validateIndex(JSON.parse(capture('docker',['buildx','imagetools','inspect','--raw',immutable])),leaves);
  const description = capture('docker',['buildx','imagetools','inspect',immutable]);
  const digest = /^Digest:\s*(sha256:[a-f0-9]{64})$/m.exec(description)?.[1]; assert.ok(digest,'Missing index digest');
  const reference = base+'@'+digest;
  const identity = 'https://github.com/'+repo+'/.github/workflows/' + profile.workflow + '@refs/heads/main';
  execute('cosign',['sign','--yes',reference]);
  for (const arch of ['amd64','arm64']) execute('cosign',['attest','--yes','--type','cyclonedx','--predicate',out+'/'+arch+'-sbom.cdx.json',base+'@'+leaves[arch]]);
  const provenance = { schema_version:1, ...profile.metadata, sourceCommit:commit, workflow:profile.workflow, runUrl:'https://github.com/'+repo+'/actions/runs/'+run,
    reference, leaves, verification:Object.fromEntries(Object.entries(records).map(([a,r])=>[a,{image:r.image.id,checks:r.checks,runtimeModules:r.runtimeModules,sample:r.sample,nativeFixture:r.nativeFixture}])),
    evidenceSHA256:hash(out+'/SHA256SUMS'), security:scans };
  write('provenance.json',provenance);
  const predicateType='https://rambow-cloud.github.io/amazon-linux-distroless/' + line + '-qualified-build/v1';
  execute('cosign',['attest','--yes','--type',predicateType,'--predicate',out+'/provenance.json',reference]);
  fs.writeFileSync(out+'/cosign-verification.json',capture('cosign',['verify','--certificate-identity',identity,'--certificate-oidc-issuer','https://token.actions.githubusercontent.com',reference])+'\n');
  fs.writeFileSync(out+'/attestation-verification.json',capture('cosign',['verify-attestation','--type',predicateType,'--certificate-identity',identity,
    '--certificate-oidc-issuer','https://token.actions.githubusercontent.com',reference])+'\n');
  // Advance the rolling preview alias only after signature verification.
  execute('docker',['buildx','imagetools','create','--tag',base+':' + profile.alias,reference]);
  let visibility='unknown';
  const metadata=spawnSync('gh',['api','orgs/rambow-cloud/packages/container/'+encodeURIComponent('amazon-linux-distroless/' + line)],{encoding:'utf8'});
  if(metadata.status===0)visibility=JSON.parse(metadata.stdout).visibility;
  const published={...provenance,tag:immutable,alias:base+':' + profile.alias,predicateType,certificateIdentity:identity,signatureVerified:true,provenanceVerified:true,
    registryVisibilityAtPublication:visibility,releaseUrl:'https://github.com/'+repo+'/releases/tag/'+tag};
  write('published.json',published);
  const completedIntro=initialNotes.replace('Registry signing/publication is being finalized by','Registry signatures and provenance were verified by');
  fs.writeFileSync(out+'/release-notes.md',completedIntro+'\n## Published image\n\n'+immutable+'\n\n'+reference+'\n\nRolling preview: '+base+':' + profile.alias + '\n\n'+
    'Architectures: linux/amd64, linux/arm64. Cosign keyless signature and qualified-build provenance verification passed. Registry visibility at publication: '+visibility+'.\n\n'+
    'Certificate identity: '+identity+'\nOIDC issuer: https://token.actions.githubusercontent.com\n\n'+
    'ALAS unfixed/language-runtime coverage remains limited; zero scanner findings is not a no-risk guarantee. Production applications require their own dependency and workload qualification.\n');
  execute('gh',['release','upload',tag,'--repo',repo,out+'/published.json',out+'/provenance.json',out+'/cosign-verification.json',out+'/attestation-verification.json']);
  execute('gh',['release','edit',tag,'--repo',repo,'--notes-file',out+'/release-notes.md']);
  if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'# Published ' + profile.title + ' preview\n\n'+reference+'\n\n'+published.releaseUrl+'\n\nRegistry visibility: '+visibility+'\n');
  console.log(JSON.stringify(published,null,2));

}
