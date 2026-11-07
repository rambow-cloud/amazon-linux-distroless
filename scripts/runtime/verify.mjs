import { execFileSync, spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { configuration, nativeArchitecture } from './config.mjs';
import { inventorySbom } from '../../security/compare-lib.mjs';
if(process.env.GITHUB_ACTIONS!=='true') throw new Error('Verify runtimes only in GitHub Actions');
const config=configuration(process.argv[2]), arch=nativeArchitecture(process.argv[3]), id=config.id;
const out='out/'+id+'/'+arch, runtime='al2023-'+id+'-runtime:candidate', fixture='al2023-'+id+'-fixture:candidate';
const read=p=>JSON.parse(fs.readFileSync(p)), write=(n,v)=>fs.writeFileSync(out+'/'+n,JSON.stringify(v,null,2)+'\n');
const lock=read('locks/'+id+'/linux-'+arch+'.json'), inventory=read(out+'/inventory.json'), native=read(out+'/fixture-build.json');
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
assert.equal(sample.arch,arch==='amd64'?'x86_64':'aarch64');
assert.equal(sample.python,lock.variants.python.packages.find(p=>p.name==='python3.14').version);
assert.equal(sample.SOABI,native.SOABI); assert.equal(sample.nativeAnswer,42);
assert.equal(sample.installersAbsent,true); assert.equal(sample.bytecodeDisabled,true); assert.equal(sample.readOnlyRootfs,true);
const module=JSON.parse(capture(...hardened,'--network','none','--entrypoint',config.executable,fixture,'-m','contract_fixture'));
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
  for(const mode of ['tls','hostname','untrusted']) networkProbes[mode]=JSON.parse(capture(...hardened,'--network',network,fixture,mode));
  assert.equal(networkProbes.tls.tlsRejected,false); assert.equal(networkProbes.hostname.tlsRejected,true); assert.equal(networkProbes.untrusted.tlsRejected,true);
  docker('stop','--time','10',server); assert.equal(JSON.parse(capture('inspect',server))[0].State.ExitCode,143);
  assert.match(capture('logs',server),/shutdown-hook-ran/);
} finally {docker('rm','-f',server);docker('network','rm',network);}
const sbom=inventorySbom(inventory,lock,image.Id); write('sbom.cdx.json',sbom.bom); write('payload-packages.json',sbom.coverage);
fs.copyFileSync('locks/'+id+'/linux-'+arch+'.json',out+'/lock.json');
const report={schema_version:1,runtime:id,sourceCommit,platform:lock.platform,image:{id:image.Id,size:image.Size,tag:runtime,config:image.Config},
  sample,nativeFixture:native,networkProbes,checks:['native architecture','exact final filesystem inventory','PID 1 and non-root','read-only rootfs/tmpfs',
    'versioned interpreter and module entrypoint','matching CPython native wheel ABI','deterministic application package path','stdlib SSL/ctypes/compression/SQLite',
    'UTF-8 Unicode filenames/UTC','system trust anchors','installer modules and bytecode cache absent','controlled service-name resolution','TLS trust',
    'TLS hostname rejection','TLS untrusted-root rejection','SIGTERM shutdown hook/143','application exit 17','shell absent'],
  limitations:['Application native dependencies need independent matching ABI/library qualification','ALAS unfixed coverage is limited','No FIPS claim']};
write('verification.json',report);
fs.writeFileSync(out+'/summary.md','# '+id+' '+arch+'\n\n- Python: '+sample.python+'\n- Bytes: '+image.Size+'\n- Payload RPMs: '+sbom.coverage.selected.length+
  '\n- Native wheel: '+native.wheel+'\n- Runtime checks: '+report.checks.join(', ')+'\n');
docker(...tools,'/tools/assemble.py','fetch-sources','/workspace/locks/'+id+'/linux-'+arch+'.json','/workspace/'+out+'/sources');
execFileSync('tar',['-czf',out+'/sources.tar.gz','-C',out,'sources'],{stdio:'inherit'});
execFileSync('gzip',['-n',out+'/image.tar'],{stdio:'inherit'});
execFileSync('git',['archive','--format=tar.gz','--output='+out+'/project-source.tar.gz','HEAD']);
console.log(fs.readFileSync(out+'/summary.md','utf8'));
