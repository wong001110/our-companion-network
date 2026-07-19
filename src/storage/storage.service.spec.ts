import { createHash } from 'node:crypto';
import { StorageService } from './storage.service';

const valid = {
  CLOUDFLARE_ACCOUNT_ID: 'account', R2_BUCKET_NAME: 'bucket', R2_ACCESS_KEY_ID: 'key', R2_SECRET_ACCESS_KEY: 'secret', R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
};
const config = (values: Record<string, string> = {}) => ({ get: jest.fn((key: string) => ({ ...valid, ...values })[key]) });

describe('StorageService configuration', () => {
  it.each(['CLOUDFLARE_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT'])('fails closed when %s is missing', (key) => {
    const service = new StorageService(config({ [key]: '' }) as never);
    expect(service.capability).toMatchObject({ configured: false, uploadsEnabled: false, downloadsEnabled: false });
  });
  it('fails closed for an invalid endpoint or TTL without exposing configuration values', () => {
    expect(new StorageService(config({ R2_ENDPOINT: 'not-a-url' }) as never).capability.configured).toBe(false);
    expect(new StorageService(config({ R2_UPLOAD_URL_TTL_SECONDS: '0' }) as never).capability.configured).toBe(false);
    expect(new StorageService(config({ R2_SUPERSEDED_PACK_RETENTION_DAYS: '0' }) as never).capability.configured).toBe(false);
  });
  it('uses the configured superseded pack retention', () => {
    expect(new StorageService(config({ R2_SUPERSEDED_PACK_RETENTION_DAYS: '7' }) as never).limits.supersededPackRetentionDays).toBe(7);
  });
  it('exposes the configured upload URL lifetime for deletion coordination', () => {
    expect(new StorageService(config({ R2_UPLOAD_URL_TTL_SECONDS: '321' }) as never).limits.uploadUrlTtlSeconds).toBe(321);
  });

  it('streams an object through SHA-256 without trusting object metadata', async () => {
    const service = new StorageService(config() as never);
    (service as any)._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: true, downloadsEnabled: true };
    const chunks = [Buffer.from('server-'), Buffer.from('verified-bytes')];
    async function* body() {
      for (const chunk of chunks) yield chunk;
    }
    (service as any).client = {
      send: jest.fn().mockResolvedValue({
        Body: body(),
        ContentType: 'image/png',
        ETag: '"source-etag"',
        Metadata: { sha256: 'client-controlled' },
      }),
    };

    await expect(service.inspectObjectSha256('staging/file', 100)).resolves.toEqual({
      sizeBytes: Buffer.concat(chunks).byteLength,
      mimeType: 'image/png',
      sha256: createHash('sha256').update(Buffer.concat(chunks)).digest('hex'),
      etag: '"source-etag"',
    });
  });

  it('aborts an oversized stream at the configured byte boundary', async () => {
    const service = new StorageService(config() as never);
    (service as any)._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: true, downloadsEnabled: true };
    async function* body() {
      yield Buffer.alloc(4);
      yield Buffer.alloc(4);
      throw new Error('the stream should have been aborted first');
    }
    (service as any).client = { send: jest.fn().mockResolvedValue({ Body: body() }) };

    await expect(service.inspectObjectSha256('staging/oversized', 5))
      .rejects.toThrow('ASSET_STORAGE_OBJECT_TOO_LARGE');
    expect(service.capability.uploadsEnabled).toBe(true);
  });

  it('conditionally copies verified bytes and replaces client metadata', async () => {
    const service = new StorageService(config() as never);
    (service as any)._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: true, downloadsEnabled: true };
    const send = jest.fn().mockResolvedValue({});
    (service as any).client = { send };
    const sha256 = 'a'.repeat(64);

    await service.copyVerifiedObject(
      'pack/staging/file id',
      'pack/files/file.png',
      '"verified-etag"',
      'image/png',
      sha256,
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input).toEqual(expect.objectContaining({
      Bucket: 'bucket',
      Key: 'pack/files/file.png',
      CopySource: 'bucket/pack/staging/file%20id',
      CopySourceIfMatch: '"verified-etag"',
      MetadataDirective: 'REPLACE',
      ContentType: 'image/png',
      Metadata: { sha256 },
    }));
  });

  it('maps a conditional-copy race to integrity failure without disabling storage', async () => {
    const service = new StorageService(config() as never);
    (service as any)._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: true, downloadsEnabled: true };
    (service as any).client = {
      send: jest.fn().mockRejectedValue({ $metadata: { httpStatusCode: 412 } }),
    };

    await expect(service.copyVerifiedObject(
      'pack/staging/file',
      'pack/files/file',
      '"stale-etag"',
      'image/png',
      'a'.repeat(64),
    )).rejects.toThrow('ASSET_INTEGRITY_FAILED');
    expect(service.capability.uploadsEnabled).toBe(true);
  });
  it('fails a bulk delete with per-object errors and marks storage unavailable for recovery', async () => {
    const service = new StorageService(config() as never);
    (service as any)._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: true, downloadsEnabled: true };
    (service as any).client = { send: jest.fn().mockResolvedValue({ Errors: [{ Code: 'InternalError' }] }) };
    await expect(service.deleteObjects(['opaque-key'])).rejects.toThrow('ASSET_STORAGE_DELETE_INCOMPLETE');
    expect(service.capability.uploadsEnabled).toBe(false);
  });

  it('deletes 1,000 asset files plus their manifest in S3-compatible batches', async () => {
    const service = new StorageService(config() as never);
    (service as any)._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: true, downloadsEnabled: true };
    const send = jest.fn().mockResolvedValue({});
    (service as any).client = { send };
    const files = Array.from({ length: 1_000 }, (_, index) => `packs/full/file-${index}.png`);
    const objectKeys = [...files, 'packs/full/manifest.json'];

    await expect(service.deleteObjects(objectKeys)).resolves.toBeUndefined();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls.map(([command]) => command.input.Delete.Objects.map(({ Key }: { Key: string }) => Key))).toEqual([
      files,
      ['packs/full/manifest.json'],
    ]);
  });

  it('validates per-object errors returned by a later delete batch', async () => {
    const service = new StorageService(config() as never);
    (service as any)._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: true, downloadsEnabled: true };
    const send = jest.fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Errors: [{ Code: 'InternalError' }] });
    (service as any).client = { send };

    await expect(service.deleteObjects(Array.from({ length: 1_001 }, (_, index) => `key-${index}`)))
      .rejects.toThrow('ASSET_STORAGE_DELETE_INCOMPLETE');

    expect(send).toHaveBeenCalledTimes(2);
    expect(service.capability.uploadsEnabled).toBe(false);
  });

  it('lists a bounded object prefix across continuation pages', async () => {
    const service = new StorageService(config() as never);
    (service as any)._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: true, downloadsEnabled: true };
    const send = jest.fn()
      .mockResolvedValueOnce({
        Contents: [{ Key: 'prefix/a' }, { Key: 'prefix/b' }],
        IsTruncated: true,
        NextContinuationToken: 'next-page',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'prefix/c' }],
        IsTruncated: false,
      });
    (service as any).client = { send };
    await expect(service.listObjectKeys('prefix/', 3)).resolves.toEqual([
      'prefix/a',
      'prefix/b',
      'prefix/c',
    ]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('deletes every object under a prefix and verifies that it is empty', async () => {
    const service = new StorageService(config() as never);
    (service as any)._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: true, downloadsEnabled: true };
    const listObjectKeys = jest.spyOn(service, 'listObjectKeys')
      .mockResolvedValueOnce(['pack/staging/a', 'pack/staging/b'])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const deleteObjects = jest.spyOn(service, 'deleteObjects').mockResolvedValue();

    await expect(service.deleteObjectPrefix('pack/staging')).resolves.toBeUndefined();

    expect(deleteObjects).toHaveBeenCalledWith(['pack/staging/a', 'pack/staging/b']);
    expect(listObjectKeys).toHaveBeenNthCalledWith(1, 'pack/staging/', 1_000);
    expect(listObjectKeys).toHaveBeenNthCalledWith(2, 'pack/staging/', 1_000);
    expect(listObjectKeys).toHaveBeenNthCalledWith(3, 'pack/staging/', 1);
  });
});
