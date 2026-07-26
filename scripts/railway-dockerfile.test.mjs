import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

for (const dockerfile of ['Dockerfile.api', 'Dockerfile.portal']) {
  test(`${dockerfile} avoids Railway service-ID-coupled cache mounts`, () => {
    const content = fs.readFileSync(dockerfile, 'utf8');

    assert.doesNotMatch(
      content,
      /--mount=type=cache/,
      `${dockerfile} must not use Railway cache mounts unless a real service ID is intentionally hardcoded`,
    );
    assert.match(content, /RUN npm ci/, `${dockerfile} must still install dependencies deterministically`);
  });
}

test('Dockerfile.api installs OpenSSL before generating Prisma Client', () => {
  const content = fs.readFileSync('Dockerfile.api', 'utf8');
  const installIndex = content.indexOf('apt-get install -y --no-install-recommends ca-certificates openssl');
  const generateIndex = content.indexOf('RUN npx prisma generate');

  assert.ok(installIndex >= 0, 'Dockerfile.api must install OpenSSL in the Prisma generation stage');
  assert.ok(generateIndex >= 0, 'Dockerfile.api must generate Prisma Client');
  assert.ok(
    installIndex < generateIndex,
    'OpenSSL must be installed before Prisma Client generation so Bookworm selects debian-openssl-3.0.x',
  );
});

test('Railway API runtime paths match the Docker build output', () => {
  const dockerfile = fs.readFileSync('Dockerfile.api', 'utf8');
  const config = JSON.parse(fs.readFileSync('deploy/railway/api.railway.json', 'utf8'));
  const preDeployCommand = config.deploy?.preDeployCommand?.[0];

  assert.match(dockerfile, /CMD \["node", "dist\/main\.js"\]/);
  assert.equal(config.deploy?.startCommand, 'node dist/main.js');
  assert.match(preDeployCommand, /node dist\/admin\/initial-superadmin\.cli\.js/);
  assert.doesNotMatch(config.deploy?.startCommand ?? '', /dist\/src\//);
  assert.doesNotMatch(preDeployCommand ?? '', /dist\/src\//);
});
