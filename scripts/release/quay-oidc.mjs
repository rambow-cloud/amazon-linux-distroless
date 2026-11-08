import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { issuer, repository } from './stable-policy.mjs';

export async function quayLogin(workflow) {
  const robot = 'rambow-cloud+runtime_publisher';
  const audience = 'https://quay.io';
  const request = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  assert.ok(request.protocol === 'https:' && request.hostname.endsWith('.actions.githubusercontent.com'),
    'Unexpected GitHub OIDC endpoint');
  request.searchParams.set('audience', audience);
  const issued = await fetch(request, {
    headers: { Authorization: 'Bearer ' + process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  assert.ok(issued.ok, 'GitHub OIDC request failed: ' + issued.status);
  const { value } = await issued.json();
  assert.ok(typeof value === 'string' && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value), 'Expected a GitHub OIDC token');
  const claims = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(claims.iss, issuer);
  assert.equal(claims.aud, audience);
  assert.equal(claims.sub, 'repo:rambow-cloud@333554680/amazon-linux-distroless@1448396331:environment:quay-runtime-publish');
  assert.equal(claims.ref, 'refs/heads/main');
  assert.equal(claims.workflow_ref, repository + '/.github/workflows/' + workflow + '@refs/heads/main');

  const exchange = await fetch(audience + '/oauth2/federation/robot/token', {
    headers: { Authorization: 'Basic ' + Buffer.from(robot + ':' + value).toString('base64') },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  assert.ok(exchange.ok, 'Quay OIDC token exchange failed: ' + exchange.status);
  const { token } = await exchange.json();
  assert.ok(typeof token === 'string' && token.length > 0 && !/\s/.test(token), 'Missing temporary Quay token');
  execFileSync('docker', ['login', 'quay.io', '--username', robot, '--password-stdin'],
    { input: token, stdio: ['pipe', 'pipe', 'inherit'] });
  console.log('Authenticated to Quay with a temporary OIDC credential.');
}
