import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { configuration, nativeArchitecture, rpmLock } from './config.mjs';
import { preserveUpstreamSource } from './upstream.mjs';
import { addUpstreamSbom } from './upstream-sbom.mjs';
import { inventorySbom } from '../../security/compare-lib.mjs';
if(process.env.GITHUB_ACTIONS!=='true') throw new Error('Verify runtimes only in GitHub Actions');
const config=configuration(process.argv[2]), arch=nativeArchitecture(process.argv[3]), id=config.id;
const out='out/'+id+'/'+arch, runtime='al2023-'+id+'-runtime:candidate', fixture='al2023-'+id+'-fixture:candidate';
const read=p=>JSON.parse(fs.readFileSync(p)), write=(n,v)=>fs.writeFileSync(out+'/'+n,JSON.stringify(v,null,2)+'\n');
const lockFile=rpmLock(config.variant,arch), lock=read(lockFile);
const upstream=read('locks/upstream/'+id+'-'+arch+'.json');
const inventory=read(out+'/inventory.json'), native=read(out+'/fixture-build.json');
assert.deepEqual(inventory.upstream,upstream);
const docker=(...args)=>execFileSync('docker',args,{stdio:'inherit'});
const capture=(...args)=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:16*1024*1024}).trim();
const image=JSON.parse(capture('image','inspect',runtime))[0];
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(image.Os,'linux'); assert.equal(image.Architecture,arch); assert.equal(image.Config.User,'65532:65532');
assert.deepEqual(image.Config.Entrypoint,[config.executable]); assert.deepEqual(image.Config.Cmd,['--version']);
assert.equal(image.Config.Labels['org.opencontainers.image.revision'],sourceCommit);
assert.equal(inventory.runtime,id); assert.equal(inventory.platform,lock.platform);
docker('save','--output',out+'/image.tar',runtime);
const tools=['run','--rm','--mount','type=bind,src='+process.cwd()+',dst=/workspace','--entrypoint','/usr/bin/python3',id+'-tools:locked'];
docker(...tools,'/runtime-tools/check_image.py','/workspace/'+out+'/image.tar',runtime,'/workspace/'+out+'/inventory.json',config.variant);
const hardened=['run','--rm','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=32m'];
const sample=JSON.parse(capture(...hardened,'--network','none',fixture));
assert.equal(sample.arch,config.variant==='python'?(arch==='amd64'?'x86_64':'aarch64'):(arch==='amd64'?'x64':'arm64'));
if(config.variant==='python') {
  assert.equal(sample.python,upstream.version);
  assert.equal(sample.SOABI,native.SOABI); assert.equal(sample.bytecodeDisabled,true);
} else {
  assert.equal(sample.node,upstream.version);
  assert.equal(sample.moduleABI,native.moduleABI); assert.equal(sample.node,native.node); assert.equal(sample.icu,native.icu);
  assert.ok(Number(sample.napi)>=native.napiTarget); assert.equal(sample.compileCacheDisabled,true);
}
assert.equal(sample.nativeAnswer,42); assert.equal(sample.installersAbsent,true); assert.equal(sample.readOnlyRootfs,true);
const moduleArgs=config.variant==='python'?['-m','contract_fixture']:['/app/commonjs.cjs'];
const module=JSON.parse(capture(...hardened,'--network','none','--entrypoint',config.executable,fixture,...moduleArgs));
assert.equal(module.nativeAnswer,42);
const exit=spawnSync('docker',[...hardened,'--network','none',fixture,'exit'],{encoding:'utf8'}); assert.equal(exit.status,17);
const shell=spawnSync('docker',[...hardened,'--network','none','--entrypoint','/bin/sh',runtime,'-c','true'],{encoding:'utf8'});
assert.notEqual(shell.status,0); assert.match(shell.stderr,/\/bin\/sh/);
const network=id+'-contract-'+arch, server=id+'-tls-'+arch, networkProbes={};
docker('network','create','--internal',network);
try {
  docker('run','-d','--name',server,'--network',network,'--network-alias','tls-fixture','--network-alias','wrong-name',
    '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,nosuid,nodev,noexec,size=32m',fixture,'serve');
  let ready=false;
  for(let i=0;i<50;i++) {if(capture('logs',server).includes('READY')) {ready=true;break;} await new Promise(r=>setTimeout(r,200));}
  assert.ok(ready,'Controlled TLS fixture did not start');
  const modes=config.variant==='python'?['tls','hostname','untrusted']:['tls','hostname','untrusted','http'];
  for(const mode of modes) networkProbes[mode]=JSON.parse(capture(...hardened,'--network',network,fixture,mode));
  assert.equal(networkProbes.tls.tlsRejected,false); assert.equal(networkProbes.hostname.tlsRejected,true); assert.equal(networkProbes.untrusted.tlsRejected,true);
  docker('stop','--time','10',server); assert.equal(JSON.parse(capture('inspect',server))[0].State.ExitCode,143);
  assert.match(capture('logs',server),/shutdown-hook-ran/);
} finally {docker('rm','-f',server);docker('network','rm',network);}
const sbom=inventorySbom(inventory,lock,image.Id);
const runtimeBom=addUpstreamSbom(sbom.bom,config,upstream,sample);
write('sbom.cdx.json',sbom.bom); write('runtime-sbom.cdx.json',runtimeBom); write('payload-packages.json',sbom.coverage);
fs.copyFileSync(lockFile,out+'/lock.json');
const report={schema_version:1,runtime:id,sourceCommit,platform:lock.platform,image:{id:image.Id,size:image.Size,tag:runtime,config:image.Config},
  sample,upstream,nativeFixture:native,networkProbes,checks:['native architecture','exact final filesystem inventory','PID 1 and non-root','read-only rootfs/tmpfs',
    ...(config.variant==='python'?['versioned interpreter and module entrypoint','matching CPython native wheel ABI','deterministic application package path','stdlib SSL/ctypes/compression/SQLite']:
      ['CommonJS and ESM entrypoints','matching N-API native addon','lockfile-installed production node_modules','full ICU locales and formatting']),
    'UTF-8 Unicode filenames/UTC','system trust anchors',config.variant==='python'?'installer modules and bytecode cache absent':'package tooling and compile cache absent','controlled service-name resolution','TLS trust',
    'TLS hostname rejection','TLS untrusted-root rejection','SIGTERM shutdown hook/143','application exit 17','shell absent'],
  limitations:['Application native dependencies need independent matching ABI/library qualification','ALAS unfixed coverage is limited','No FIPS claim']};
if(config.variant==='nodejs') {assert.equal(networkProbes.http.plainHTTP,true); report.checks.push('plain HTTP service');}
write('verification.json',report);
fs.writeFileSync(out+'/summary.md','# '+id+' '+arch+'\n\n- Runtime: '+(sample.python||sample.node)+'\n- Bytes: '+image.Size+'\n- Payload RPMs: '+sbom.coverage.selected.length+
  '\n- Native dependency: '+(native.wheel||('N-API '+native.napiTarget))+'\n- Runtime checks: '+report.checks.join(', ')+'\n');
docker(...tools,'/tools/assemble.py','fetch-sources','/workspace/'+lockFile,'/workspace/'+out+'/sources');
await preserveUpstreamSource(upstream,out+'/input',out+'/sources');
execFileSync('tar',['-czf',out+'/sources.tar.gz','-C',out,'sources'],{stdio:'inherit'});
execFileSync('gzip',['-n',out+'/image.tar'],{stdio:'inherit'});
execFileSync('git',['archive','--format=tar.gz','--output='+out+'/project-source.tar.gz','HEAD']);
console.log(fs.readFileSync(out+'/summary.md','utf8'));
