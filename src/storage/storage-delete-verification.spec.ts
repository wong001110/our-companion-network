import { StorageService } from './storage.service';

const config = {
  get: jest.fn((key: string) => ({
    CLOUDFLARE_ACCOUNT_ID: 'account',
    R2_BUCKET_NAME: 'bucket',
    R2_ACCESS_KEY_ID: 'key',
    R2_SECRET_ACCESS_KEY: 'secret',
    R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  } as Record<string, string>)[key]),
};

describe('StorageService deletion verification', () => {
  function serviceWith(contents: Array<{ Key: string }>) {
    const service = new StorageService(config as never);
    (service as any)._capability = {
      configured: true,
      provider: 'cloudflare_r2',
      uploadsEnabled: true,
      downloadsEnabled: true,
    };
    (service as any).client = {
      send: jest.fn().mockResolvedValue({
        Contents: contents,
        IsTruncated: false,
      }),
    };
    return service;
  }

  it('accepts an empty immutable pack prefix after deletion', async () => {
    const service = serviceWith([]);

    await expect(service.assertObjectPrefixDeleted('packs/owner/pack'))
      .resolves.toBeUndefined();
  });

  it('rejects a remaining object so the deleting database claim can be retried', async () => {
    const service = serviceWith([{ Key: 'packs/owner/pack/remaining.png' }]);

    await expect(service.assertObjectPrefixDeleted('packs/owner/pack'))
      .rejects.toThrow('ASSET_STORAGE_DELETE_INCOMPLETE');
  });
});
