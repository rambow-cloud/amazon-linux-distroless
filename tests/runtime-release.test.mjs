import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeReports } from '../scripts/release/runtime-policy.mjs';
const records=()=>Object.fromEntries(['amd64','arm64'].map(arch=>{
  const abi='cpython-314-'+(arch==='amd64'?'x86_64':'aarch64')+'-linux-gnu';
  return [arch,{runtime:'python314',sourceCommit:'abc',platform:'linux/'+arch,image:{config:{User:'65532:65532',Entrypoint:['/usr/bin/python3.14']}},
    sample:{python:'3.14.8',SOABI:abi,pid:1,uid:65532,readOnlyRootfs:true,installersAbsent:true,nativeAnswer:42,timezone:'UTC',trustAnchors:135,bytecodeDisabled:true},
    nativeFixture:{SOABI:abi},networkProbes:{tls:{tlsRejected:false},hostname:{tlsRejected:true},untrusted:{tlsRejected:true}},checks:['SIGTERM shutdown hook/143']}];
}));
test('Python publication rejects source, runtime and native ABI mismatches',()=>{
  assert.doesNotThrow(()=>validateRuntimeReports(records(),'abc','python314'));
  for(const mutation of ['commit','version','abi']) {
    const r=records();
    if(mutation==='commit')r.arm64.sourceCommit='other';
    if(mutation==='version')r.amd64.sample.python='3.13.1';
    if(mutation==='abi')r.arm64.nativeFixture.SOABI=r.amd64.sample.SOABI;
    assert.throws(()=>validateRuntimeReports(r,'abc','python314'));
  }
});
test('a zero-finding scan cannot substitute for Python runtime and TLS qualification',()=>{
  for(const mutation of ['installer','root','hostname','bytecode']) {
    const r=records();
    if(mutation==='installer')r.amd64.sample.installersAbsent=false;
    if(mutation==='root')r.amd64.sample.readOnlyRootfs=false;
    if(mutation==='hostname')r.amd64.networkProbes.hostname.tlsRejected=false;
    if(mutation==='bytecode')r.amd64.sample.bytecodeDisabled=false;
    assert.throws(()=>validateRuntimeReports(r,'abc','python314'));
  }
});
