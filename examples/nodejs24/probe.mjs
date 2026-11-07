import assert from 'node:assert/strict';
import fs from 'node:fs';
import dns from 'node:dns/promises';
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import addon from 'native-contract';
const require=createRequire(import.meta.url), mode=process.argv[2]||'check';
const certificate=()=>fs.readFileSync('/fixture/server.pem');

async function request(host,trusted,reject,plain=false) {
  const address=(await dns.lookup(host)).address;
  let rejected=false, code;
  try {
    const body=await new Promise((resolve,fail)=>{
      const client=plain?http:https;
      const req=client.get({host,port:plain?8080:8443,path:'/ping',...(trusted?{ca:certificate()}:{}),timeout:5000},response=>{
        let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);
        response.on('end',()=>response.statusCode===200?resolve(text):fail(new Error('Unexpected HTTP status')));
      });
      req.on('timeout',()=>req.destroy(new Error('Request timed out')));req.on('error',fail);
    });
    assert.equal(body,'nodejs24-ok'); assert.equal(reject,false);
  } catch(error) {
    const accepted=host==='wrong-name'?['ERR_TLS_CERT_ALTNAME_INVALID']:['DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'];
    assert.ok(reject&&accepted.includes(error.code),error); rejected=true;code=error.code;
  }
  assert.equal(rejected,reject);
  console.log(JSON.stringify({host,address,tlsRejected:rejected,plainHTTP:plain,code}));
}

if(mode==='exit') process.exit(17);
if(mode==='serve') {
  const respond=(req,res)=>{res.writeHead(200,{'content-type':'text/plain'});res.end('nodejs24-ok');};
  const secure=https.createServer({key:fs.readFileSync('/fixture/server.key'),cert:certificate()},respond);
  const plain=http.createServer(respond);
  await Promise.all([new Promise(r=>secure.listen(8443,'0.0.0.0',r)),new Promise(r=>plain.listen(8080,'0.0.0.0',r))]);
  process.on('SIGTERM',async()=>{
    await Promise.all([new Promise(r=>secure.close(r)),new Promise(r=>plain.close(r))]);
    console.log('shutdown-hook-ran');process.exit(143);
  });
  console.log('READY');
} else if(['tls','hostname','untrusted','http'].includes(mode)) {
  await request(mode==='hostname'?'wrong-name':'tls-fixture',mode==='tls'||mode==='hostname',mode==='hostname'||mode==='untrusted',mode==='http');
} else {
  assert.ok(process.versions.node.startsWith('24.'));assert.equal(process.getuid(),65532);assert.equal(process.getgid(),65532);assert.equal(process.pid,1);
  assert.equal(process.cwd(),'/app');assert.equal(process.env.NODE_DISABLE_COMPILE_CACHE,'1');
  const root=fs.readFileSync('/proc/mounts','utf8').split('\n').find(line=>line.split(' ')[1]==='/');
  assert.ok(root.split(' ')[3].split(',').includes('ro'));
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone,'UTC');
  const locales=['de-DE','es-ES','zh-CN','ar-EG'];assert.deepEqual(Intl.DateTimeFormat.supportedLocalesOf(locales),locales);
  assert.equal(new Intl.NumberFormat('de-DE').format(1234.5),'1.234,5');
  assert.equal(new Intl.DateTimeFormat('es-ES',{month:'long',timeZone:'UTC'}).format(new Date('2026-01-02')),'enero');
  const temporary=fs.mkdtempSync('/tmp/\u00e9-\u6d4b\u8bd5-'), file=temporary+'/\u00e9-\u6d4b\u8bd5.txt';
  fs.writeFileSync(file,'\u00e9-\u6d4b\u8bd5');assert.equal(fs.readFileSync(file,'utf8'),'\u00e9-\u6d4b\u8bd5');fs.unlinkSync(file);fs.rmdirSync(temporary);
  for(const name of ['npm','npm-24','npx','npx-24','corepack','gcc','sh']) assert.equal(fs.existsSync('/usr/bin/'+name),false,name);
  assert.throws(()=>require.resolve('npm'),{code:'MODULE_NOT_FOUND'});
  assert.equal(addon.add(19,23),42);
  assert.ok(require.resolve('native-contract').startsWith('/app/node_modules/'));
  assert.ok(Number(process.versions.napi)>=8);assert.equal(crypto.getFips(),0);
  assert.equal(process.env.NODE_OPTIONS,'--use-openssl-ca');
  const roots=tls.getCACertificates('system').length;assert.ok(roots>=100);
  assert.ok(fs.readFileSync(process.env.SSL_CERT_FILE,'utf8').includes('BEGIN CERTIFICATE'));
  console.log(JSON.stringify({node:process.versions.node,arch:process.arch,pid:process.pid,uid:process.getuid(),napi:process.versions.napi,moduleABI:process.versions.modules,
    nativeAnswer:42,readOnlyRootfs:true,installersAbsent:true,compileCacheDisabled:true,timezone:'UTC',icu:process.versions.icu,intlLocales:locales,trustAnchors:roots,caPolicy:'openssl-system'}));
}
