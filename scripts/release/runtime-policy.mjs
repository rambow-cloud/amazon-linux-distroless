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
    }
  }
}
