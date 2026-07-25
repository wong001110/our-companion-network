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
