import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { configuration, nativeArchitecture } from './config.mjs';
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Resolve runtime inputs only in GitHub Actions');
const config=configuration(process.argv[2]), arch=nativeArchitecture(process.argv[3]);
const inputs=JSON.parse(fs.readFileSync('images/'+config.id+'/packages.json'));
inputs.platform='linux/'+arch;
const out='out/locks/'+config.id;
fs.mkdirSync(out,{recursive:true}); fs.writeFileSync(out+'/inputs.json',JSON.stringify(inputs));
const docker=(...args)=>execFileSync('docker',args,{stdio:'inherit'});
const capture=(...args)=>execFileSync('docker',args,{encoding:'utf8',maxBuffer:16*1024*1024}).trim();
docker('pull','--platform',inputs.platform,inputs.builder_tag);
const image=JSON.parse(capture('image','inspect',inputs.builder_tag))[0];
if(image.Architecture!==arch) throw new Error('Builder architecture mismatch');
const builder=image.RepoDigests.find(ref=>ref.startsWith('public.ecr.aws/amazonlinux/amazonlinux@sha256:'));
if(!builder) throw new Error('Official immutable builder digest missing');
const tools=config.id+'-tools:locked';
docker('build','--platform',inputs.platform,'-f','images/'+config.id+'/Dockerfile','--target','tools',
  '--build-arg','AL2023_BASE='+builder,'--build-arg','AL2023_RELEASE='+inputs.releasever,'-t',tools,'.');
docker('run','--rm','--mount','type=bind,src='+process.cwd()+',dst=/workspace','--entrypoint','/usr/bin/python3',tools,'/tools/resolve.py',
  '--inputs','/workspace/'+out+'/inputs.json','--builder',builder,'--epoch',execFileSync('git',['log','-1','--format=%ct'],{encoding:'utf8'}).trim(),
  '--output','/workspace/'+out+'/linux-'+arch+'.json');
fs.writeFileSync(out+'/files-'+arch+'.txt',capture('run','--rm','--entrypoint','/usr/bin/rpm',tools,'-ql',...config.packages)+'\n');
if(config.variant==='python') {
  const metadata="import json,sys,sysconfig,ssl; print(json.dumps({'version':sys.version,'paths':sysconfig.get_paths(),'SOABI':sysconfig.get_config_var('SOABI'),'EXT_SUFFIX':sysconfig.get_config_var('EXT_SUFFIX'),'ssl':ssl.get_default_verify_paths()._asdict()}))";
  fs.writeFileSync(out+'/runtime-'+arch+'.json',capture('run','--rm','--entrypoint',config.executable,tools,'-c',metadata)+'\n');
} else {
  const metadata="JSON.stringify({node:process.versions.node,versions:process.versions,configuration:process.config.variables})";
  fs.writeFileSync(out+'/runtime-'+arch+'.json',capture('run','--rm','--entrypoint',config.executable,tools,'-p',metadata)+'\n');
}
