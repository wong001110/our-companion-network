import { NotFoundException } from '@nestjs/common';
import { SmokeController } from './smoke.controller';

describe('SmokeController', () => {
  const controller = (env: Record<string, string>, objects: string[] = []) => new SmokeController(
    { get: (key: string) => env[key] } as never,
    { user: { findMany: jest.fn().mockResolvedValue([{ id: 'owner' }, { id: 'host' }]), updateMany: jest.fn(), deleteMany: jest.fn() }, companionAssetPack: { findMany: jest.fn().mockResolvedValue([{ files: objects.map((objectKey) => ({ objectKey })) }]) }, networkCompanion: { updateMany: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'companion' }]) }, visitSession: { deleteMany: jest.fn() }, visitInvitation: { deleteMany: jest.fn() }, $transaction: async (fn: (tx: any) => Promise<void>) => fn({ user: { updateMany: jest.fn(), deleteMany: jest.fn() }, networkCompanion: { updateMany: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn().mockResolvedValue([{ id: 'companion' }]) }, visitSession: { deleteMany: jest.fn() }, visitInvitation: { deleteMany: jest.fn() } }) } as never,
    { deleteObjects: jest.fn().mockResolvedValue(undefined) } as never,
  );

  it('is unavailable unless both smoke flags are explicit', async () => {
    await expect(controller({ OUR_COMPANION_SMOKE_TEST: '1' }).cleanup({ runId: '123456789012' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes only selected smoke-run objects and records', async () => {
    const instance = controller({ OUR_COMPANION_SMOKE_TEST: '1', SMOKE_TEST_ALLOW_DESTRUCTIVE_ENDPOINTS: '1' }, ['smoke-a']);
    await expect(instance.cleanup({ runId: '123456789012' })).resolves.toEqual({ cleaned: true, users: 2 });
  });
});
