import assert from 'node:assert/strict';
import { configuration } from '../runtime/config.mjs';

export function validateRuntimeReports(records, commit, id) {
  const config=configuration(id);
  assert.deepEqual(Object.keys(records).sort(),['amd64','arm64']);
  for(const [arch,r] of Object.entries(records)) {
    assert.equal(r.runtime,id); assert.equal(r.sourceCommit,commit,'Build/source revision mismatch');
    assert.equal(r.platform,'linux/'+arch); assert.equal(r.image.config.User,'65532:65532');
    assert.deepEqual(r.image.config.Entrypoint,[config.executable]);
    assert.equal(r.sample.uid,65532); assert.equal(r.sample.pid,1); assert.equal(r.sample.readOnlyRootfs,true);
    assert.equal(r.sample.installersAbsent,true); assert.equal(r.sample.nativeAnswer,42);
    assert.equal(r.sample.timezone,'UTC'); assert.ok(r.sample.trustAnchors>=100);
    assert.equal(r.networkProbes.tls.tlsRejected,false);
    assert.equal(r.networkProbes.hostname.tlsRejected,true); assert.equal(r.networkProbes.untrusted.tlsRejected,true);
    assert.ok(r.checks.includes('SIGTERM shutdown hook/143'));
    if(config.variant==='python') {
      assert.ok(r.sample.python.startsWith(config.version+'.'),'Wrong Python version');
      assert.equal(r.sample.bytecodeDisabled,true);
      assert.equal(r.sample.SOABI,'cpython-314-'+(arch==='amd64'?'x86_64':'aarch64')+'-linux-gnu','Wrong native ABI');
      assert.equal(r.nativeFixture.SOABI,r.sample.SOABI,'Builder/runtime ABI mismatch');
    } else {
      assert.equal(r.sample.arch,arch==='amd64'?'x64':'arm64','Wrong Node architecture');
      assert.ok(r.sample.node.startsWith(config.version+'.'),'Wrong Node.js version');
      assert.equal(r.nativeFixture.node,r.sample.node,'Builder/runtime version mismatch');
      assert.equal(r.nativeFixture.arch,r.sample.arch,'Native addon architecture mismatch');
      assert.equal(r.nativeFixture.moduleABI,r.sample.moduleABI,'Node module ABI mismatch');
      assert.equal(r.nativeFixture.napiTarget,8); assert.ok(Number(r.sample.napi)>=8);
      assert.equal(r.sample.compileCacheDisabled,true); assert.equal(r.sample.caPolicy,'openssl-system');
      assert.equal(r.nativeFixture.icu,r.sample.icu);
      assert.deepEqual(r.sample.intlLocales,['de-DE','es-ES','zh-CN','ar-EG']);
      assert.equal(r.networkProbes.http.plainHTTP,true);
    }
  }
}
