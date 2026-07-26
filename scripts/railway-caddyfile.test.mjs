import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const caddyfile = fs.readFileSync('deploy/railway/Caddyfile', 'utf8');

test('Portal proxies API and Socket.IO before the SPA fallback', () => {
  const routeIndex = caddyfile.indexOf('route {');
  const apiProxyIndex = caddyfile.indexOf('reverse_proxy /api/*');
  const socketProxyIndex = caddyfile.indexOf('reverse_proxy /socket.io/*');
  const tryFilesIndex = caddyfile.indexOf('try_files {path} /index.html');

  assert.ok(routeIndex >= 0, 'Caddyfile must use a route block to preserve handler order');
  assert.ok(apiProxyIndex > routeIndex, 'API reverse proxy must be inside the ordered route');
  assert.ok(socketProxyIndex > apiProxyIndex, 'Socket.IO reverse proxy must be inside the ordered route');
  assert.ok(tryFilesIndex > socketProxyIndex, 'SPA fallback must run after API and Socket.IO proxying');
});

test('Portal API proxy preserves the /api prefix', () => {
  assert.doesNotMatch(
    caddyfile,
    /handle_path\s+\/api/,
    'handle_path would strip the /api prefix expected by the NestJS server',
  );
});
