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
  it('fails a bulk delete with per-object errors and marks storage unavailable for recovery', async () => {
    const service = new StorageService(config() as never);
    (service as any)._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: true, downloadsEnabled: true };
    (service as any).client = { send: jest.fn().mockResolvedValue({ Errors: [{ Code: 'InternalError' }] }) };
    await expect(service.deleteObjects(['opaque-key'])).rejects.toThrow('ASSET_STORAGE_DELETE_INCOMPLETE');
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
});
