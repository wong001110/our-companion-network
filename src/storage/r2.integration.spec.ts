import { createHash, randomUUID } from 'node:crypto';
import 'dotenv/config';
import { StorageService } from './storage.service';

const enabled = process.env.RUN_R2_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration('private Cloudflare R2 integration', () => {
  const prefix = `integration-tests/${randomUUID()}`;
  const stagingKey = `${prefix}/staging/fixture`;
  const objectKey = `${prefix}/files/fixture.png`;
  const manifestKey = `${prefix}/manifest.json`;
  const fixture = Buffer.from('s3-r2-integration-fixture');
  const wrongFixture = Buffer.from(fixture);
  wrongFixture[0] ^= 0xff;
  const sha256 = createHash('sha256').update(fixture).digest('hex');
  const storage = new StorageService({ get: (key: string, fallback?: string) => process.env[key] ?? fallback } as never);

  beforeAll(async () => { await storage.onModuleInit(); });
  afterAll(async () => { await storage.deleteObjectPrefix(prefix).catch(() => undefined); storage.onModuleDestroy(); });

  it('detects wrong staging bytes, conditionally publishes verified bytes, and isolates the final key', async () => {
    expect(storage.capability.uploadsEnabled).toBe(true);
    const upload = await storage.createPutUrl(stagingKey, 'image/png');
    const putBytes = async (bytes: Buffer) => {
      const put = await fetch(upload.url, {
        method: 'PUT',
        headers: { 'content-type': 'image/png' },
        body: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      });
      if (!put.ok) {
        const body = await put.text();
        const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? 'unknown';
        const signedHeaders = new URL(upload.url).searchParams.get('X-Amz-SignedHeaders') ?? 'unknown';
        throw new Error(`presigned upload returned HTTP ${put.status} (${code}; signed headers: ${signedHeaders})`);
      }
    };

    await putBytes(wrongFixture);
    expect(await storage.inspectObjectSha256(stagingKey, fixture.byteLength)).toMatchObject({
      sizeBytes: fixture.byteLength,
      mimeType: 'image/png',
      sha256: createHash('sha256').update(wrongFixture).digest('hex'),
    });

    await putBytes(fixture);
    const verified = await storage.inspectObjectSha256(stagingKey, fixture.byteLength);
    expect(verified).toMatchObject({ sizeBytes: fixture.byteLength, mimeType: 'image/png', sha256 });
    expect(verified?.etag).toBeTruthy();

    // A still-valid bearer URL can overwrite staging, but the conditional copy
    // rejects the stale ETag instead of publishing the changed bytes.
    await putBytes(wrongFixture);
    await expect(storage.copyVerifiedObject(
      stagingKey,
      objectKey,
      verified!.etag!,
      'image/png',
      sha256,
    )).rejects.toThrow('ASSET_INTEGRITY_FAILED');

    await putBytes(fixture);
    const current = await storage.inspectObjectSha256(stagingKey, fixture.byteLength);
    await storage.copyVerifiedObject(stagingKey, objectKey, current!.etag!, 'image/png', sha256);
    expect(await storage.inspectObjectSha256(objectKey, fixture.byteLength)).toMatchObject({
      sizeBytes: fixture.byteLength,
      mimeType: 'image/png',
      sha256,
    });
    expect(await storage.headObject(objectKey)).toMatchObject({
      sizeBytes: fixture.byteLength,
      mimeType: 'image/png',
      sha256,
    });

    await putBytes(wrongFixture);
    expect(await storage.inspectObjectSha256(stagingKey, fixture.byteLength)).toMatchObject({
      sha256: createHash('sha256').update(wrongFixture).digest('hex'),
    });
    expect(await storage.inspectObjectSha256(objectKey, fixture.byteLength)).toMatchObject({ sha256 });

    const download = await storage.createGetUrl(objectKey);
    const get = await fetch(download.url);
    const bytes = Buffer.from(await get.arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
    await storage.putManifest(manifestKey, JSON.stringify({ fixture: objectKey, sha256 }));
    await storage.deleteObjectPrefix(prefix);
    expect(await storage.headObject(objectKey)).toBeNull();
  });
});
