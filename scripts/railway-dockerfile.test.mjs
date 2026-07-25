import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

for (const dockerfile of ['Dockerfile.api', 'Dockerfile.portal']) {
  test(`${dockerfile} uses Railway-compatible cache mount ids`, () => {
    const content = fs.readFileSync(dockerfile, 'utf8');
    const cacheMounts = [...content.matchAll(/--mount=([^\s]+)/g)]
      .map((match) => match[1])
      .filter((mount) => mount.includes('type=cache'));

    assert.ok(cacheMounts.length > 0, `${dockerfile} should contain an npm cache mount`);
    for (const mount of cacheMounts) {
      assert.match(
        mount,
        /(?:^|,)id=[^,]+(?:,|$)/,
        `${dockerfile} cache mounts require an explicit id for Railway Metal builders`,
      );
    }
  });
}
