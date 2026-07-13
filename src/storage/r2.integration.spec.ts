import { createHash, randomUUID } from 'node:crypto';
import { StorageService } from './storage.service';

const enabled = process.env.RUN_R2_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;

describeIntegration('private Cloudflare R2 integration', () => {
  const prefix = `integration-tests/${randomUUID()}`;
  const objectKey = `${prefix}/fixture.png`;
  const manifestKey = `${prefix}/manifest.json`;
  const fixture = Buffer.from('s3-r2-integration-fixture');
  const sha256 = createHash('sha256').update(fixture).digest('hex');
  const storage = new StorageService({ get: (key: string, fallback?: string) => process.env[key] ?? fallback } as never);

  beforeAll(async () => { await storage.onModuleInit(); });
  afterAll(async () => { await storage.deleteObjects([objectKey, manifestKey]).catch(() => undefined); storage.onModuleDestroy(); });

  it('uploads, heads, downloads, writes a manifest and cleans up through private presigned URLs', async () => {
    expect(storage.capability.uploadsEnabled).toBe(true);
    const upload = await storage.createPutUrl(objectKey, 'image/png', sha256);
    const put = await fetch(upload.url, { method: 'PUT', headers: { 'content-type': 'image/png', 'x-amz-meta-sha256': sha256 }, body: fixture.buffer.slice(fixture.byteOffset, fixture.byteOffset + fixture.byteLength) as ArrayBuffer });
    if (!put.ok) {
      const body = await put.text();
      const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1] ?? 'unknown';
      const signedHeaders = new URL(upload.url).searchParams.get('X-Amz-SignedHeaders') ?? 'unknown';
      throw new Error(`presigned upload returned HTTP ${put.status} (${code}; signed headers: ${signedHeaders})`);
    }
    expect(await storage.headObject(objectKey)).toMatchObject({ sizeBytes: fixture.byteLength, mimeType: 'image/png', sha256 });
    const download = await storage.createGetUrl(objectKey);
    const get = await fetch(download.url);
    const bytes = Buffer.from(await get.arrayBuffer());
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
    await storage.putManifest(manifestKey, JSON.stringify({ fixture: objectKey, sha256 }));
    await storage.deleteObjects([objectKey, manifestKey]);
    expect(await storage.headObject(objectKey)).toBeNull();
  });
});
