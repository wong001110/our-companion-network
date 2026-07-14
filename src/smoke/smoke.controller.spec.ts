import { NotFoundException } from '@nestjs/common';
import { SmokeController } from './smoke.controller';

describe('SmokeController', () => {
  const controller = (env: Record<string, string>, packs = [{ objectPrefix: 'smoke/one', files: [{ objectKey: 'smoke/a' }] }]) => {
    const storage = { deleteObjects: jest.fn().mockResolvedValue(undefined) };
    return { storage, instance: new SmokeController(
    { get: (key: string) => env[key] } as never,
    { user: { findMany: jest.fn().mockResolvedValue([{ id: 'owner' }, { id: 'host' }]), updateMany: jest.fn(), deleteMany: jest.fn() }, companionAssetPack: { findMany: jest.fn().mockResolvedValue(packs) }, networkCompanion: { updateMany: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'companion' }]) }, visitSession: { deleteMany: jest.fn() }, visitInvitation: { deleteMany: jest.fn() }, $transaction: async (fn: (tx: any) => Promise<void>) => fn({ user: { updateMany: jest.fn(), deleteMany: jest.fn() }, networkCompanion: { updateMany: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'companion' }]) }, visitSession: { deleteMany: jest.fn() }, visitInvitation: { deleteMany: jest.fn() } }) } as never,
    storage as never,
  ) };
  };

  it('is unavailable when smoke flags or the cleanup token are absent or invalid', async () => {
    await expect(controller({ OUR_COMPANION_SMOKE_TEST: '1' }).instance.cleanup(undefined, { runId: '123456789012' })).rejects.toBeInstanceOf(NotFoundException);
    const guarded = { OUR_COMPANION_SMOKE_TEST: '1', SMOKE_TEST_ALLOW_DESTRUCTIVE_ENDPOINTS: '1', SMOKE_TEST_DATABASE: '1', DATABASE_URL: 'postgres://localhost/smoke_s5', SMOKE_TEST_CLEANUP_TOKEN: 'expected' };
    await expect(controller(guarded).instance.cleanup(undefined, { runId: '123456789012' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller(guarded).instance.cleanup('wrong', { runId: '123456789012' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(controller({ ...guarded, DATABASE_URL: 'postgres://localhost/production' }).instance.cleanup('expected', { runId: '123456789012' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes every Pack file and manifest once, then returns sanitized counts', async () => {
    const { instance, storage } = controller(
      { OUR_COMPANION_SMOKE_TEST: '1', SMOKE_TEST_ALLOW_DESTRUCTIVE_ENDPOINTS: '1', SMOKE_TEST_DATABASE: '1', DATABASE_URL: 'postgres://localhost/smoke_s5', SMOKE_TEST_CLEANUP_TOKEN: 'expected' },
      [{ objectPrefix: 'smoke/one', files: [{ objectKey: 'smoke/a' }, { objectKey: 'smoke/shared' }] }, { objectPrefix: 'smoke/two', files: [{ objectKey: 'smoke/shared' }, { objectKey: 'smoke/b' }] }],
    );
    await expect(instance.cleanup('expected', { runId: '123456789012' })).resolves.toEqual({ cleaned: true, users: 2, packs: 2, objects: 5 });
    expect(storage.deleteObjects).toHaveBeenCalledWith(['smoke/a', 'smoke/shared', 'smoke/one/manifest.json', 'smoke/b', 'smoke/two/manifest.json']);
  });
});
