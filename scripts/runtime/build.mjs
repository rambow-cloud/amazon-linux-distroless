import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { configuration, nativeArchitecture } from './config.mjs';
if(process.env.GITHUB_ACTIONS!=='true') throw new Error('Build runtimes only in GitHub Actions');
const config=configuration(process.argv[2]), arch=nativeArchitecture(process.argv[3]), id=config.id;
const lockFile='locks/'+id+'/linux-'+arch+'.json', lock=JSON.parse(fs.readFileSync(lockFile));
const inputs=JSON.parse(fs.readFileSync('images/'+id+'/packages.json'));
assert.equal(lock.platform,'linux/'+arch); assert.equal(lock.releasever,inputs.releasever);
for(const [variant,roots] of Object.entries(inputs.roots)) assert.deepEqual(lock.variants[variant].roots,roots);
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const args=['build','--platform',lock.platform,'-f','images/'+id+'/Dockerfile','--build-arg','AL2023_BASE='+lock.builder,
  '--build-arg','AL2023_RELEASE='+lock.releasever,'--build-arg','LOCK_FILE='+lockFile,'--build-arg','SOURCE_DATE_EPOCH='+lock.source_date_epoch,
  '--build-arg','SOURCE_REVISION='+sha,'--build-arg','RELEASE_VERSION='+id+'-'+sha.slice(0,12)];
const docker=(...args)=>execFileSync('docker',args,{stdio:'inherit'});
docker(...args,'--target','tools','-t',id+'-tools:locked','.');
if(arch==='amd64') docker('run','--rm','--mount','type=bind,src='+process.cwd()+',dst=/workspace','--entrypoint','/usr/bin/python3',
  id+'-tools:locked','/tools/test_assemble.py');
for(const target of ['runtime','fixture']) docker(...args,'--target',target,'-t','al2023-'+id+'-'+target+':candidate','.');
const out='out/'+id+'/'+arch; fs.mkdirSync(out,{recursive:true});
docker(...args,'--target','evidence','--output','type=local,dest='+out,'.');
