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
  });
});
