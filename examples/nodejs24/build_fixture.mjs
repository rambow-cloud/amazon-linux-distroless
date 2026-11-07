import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const nodeHome = process.env.NODE_HOME;
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const native='/src/vendor/native-contract/native.node';
const headers = nodeHome ? nodeHome + '/include/node' : '/usr/include/node';
execFileSync('gcc',['-shared','-fPIC','-O2','-DNAPI_VERSION=8','-I'+headers,'/src/native.c','-o',native],{stdio:'inherit'});
const npm = ['ci','--omit=dev','--ignore-scripts','--offline','--install-links','--cache','/tmp/npm-cache'];
if (nodeHome) {
  execFileSync(process.execPath, [nodeHome + '/lib/node_modules/npm/bin/npm-cli.js', ...npm], {cwd:'/src',stdio:'inherit'});
} else {
  execFileSync('/usr/bin/npm-24', npm, {cwd:'/src',stdio:'inherit'});
}
const installed='/src/node_modules/native-contract/native.node';
assert.equal(hash(installed),hash(native));
fs.mkdirSync('/fixture',{recursive:true});
fs.writeFileSync('/fixture/build.json',JSON.stringify({node:process.versions.node,arch:process.arch,icu:process.versions.icu,napiTarget:8,runtimeNapi:process.versions.napi,
  moduleABI:process.versions.modules,lockSHA256:hash('/src/package-lock.json'),nativeSHA256:hash(installed),
  source:'Project-owned N-API C addon built natively in AL2023 and installed from a committed local-source npm lockfile'},null,2)+'\n');
