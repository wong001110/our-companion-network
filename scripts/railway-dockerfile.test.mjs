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
