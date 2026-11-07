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

const nodeRecords=()=>Object.fromEntries(Object.entries(records()).map(([arch,r])=>[arch,{...r,runtime:'nodejs24',
  image:{config:{User:'65532:65532',Entrypoint:['/usr/bin/node-24']}},
  sample:{node:'24.22.1',arch:arch==='amd64'?'x64':'arm64',pid:1,uid:65532,readOnlyRootfs:true,installersAbsent:true,nativeAnswer:42,timezone:'UTC',trustAnchors:135,
    napi:'10',moduleABI:'137',icu:'78.3',intlLocales:['de-DE','es-ES','zh-CN','ar-EG'],compileCacheDisabled:true,caPolicy:'openssl-system'},
  nativeFixture:{node:'24.22.1',arch:arch==='amd64'?'x64':'arm64',napiTarget:8,moduleABI:'137',icu:'78.3'},
  networkProbes:{...r.networkProbes,http:{plainHTTP:true}}}]));
test('Node publication rejects native ABI/architecture drift, wrong CA policy and partial ICU',()=>{
  assert.doesNotThrow(()=>validateRuntimeReports(nodeRecords(),'abc','nodejs24'));
  for(const mutation of ['abi','arch','ca','icu','napi']) {
    const r=nodeRecords();
    if(mutation==='abi')r.arm64.nativeFixture.moduleABI='136';
    if(mutation==='arch')r.arm64.nativeFixture.arch='x64';
    if(mutation==='ca')r.amd64.sample.caPolicy='bundled-only';
    if(mutation==='icu')r.amd64.sample.intlLocales.pop();
    if(mutation==='napi')r.amd64.sample.napi='7';
    assert.throws(()=>validateRuntimeReports(r,'abc','nodejs24'));
  }
});
