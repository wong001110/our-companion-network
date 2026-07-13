import { CompanionService } from './companion.service';

const now = new Date('2026-07-13T00:00:00.000Z');
const activePack = { id: 'pack-1', companionId: 'companion-1', status: 'active', manifestHash: 'a'.repeat(64), schemaVersion: 1, totalFiles: 1, totalBytes: BigInt(1), createdAt: now, updatedAt: now, completedAt: now, activatedAt: now, supersededAt: null, failureCode: null, companion: { ownerUserId: 'user-1' }, files: [] };

describe('CompanionService final asset-pack lifecycle', () => {
  it('returns the stable completion envelope when an active completion is retried', async () => {
    const prisma = { companionAssetPack: { findUnique: jest.fn().mockResolvedValue(activePack) }, networkCompanion: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'companion-1', ownerUserId: 'user-1', name: 'Ann', publicDescription: null, publicTags: [], visibility: 'friends_only', published: false, activeAssetPackId: 'pack-1', createdAt: now, updatedAt: now, publishedAt: null }) } };
    const service = new CompanionService(prisma as never, { capability: { uploadsEnabled: true }, limits: {} } as never, {} as never);
    await expect(service.completeAssetPack('user-1', 'pack-1')).resolves.toMatchObject({ assetPack: { id: 'pack-1' }, companion: { id: 'companion-1' } });
  });

  it('returns an active retry envelope even while R2 is temporarily unavailable', async () => {
    const prisma = { companionAssetPack: { findUnique: jest.fn().mockResolvedValue(activePack) }, networkCompanion: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'companion-1', ownerUserId: 'user-1', name: 'Ann', publicDescription: null, publicTags: [], visibility: 'friends_only', published: false, activeAssetPackId: 'pack-1', createdAt: now, updatedAt: now, publishedAt: null }) } };
    const service = new CompanionService(prisma as never, { capability: { uploadsEnabled: false }, limits: {} } as never, {} as never);
    await expect(service.completeAssetPack('user-1', 'pack-1')).resolves.toMatchObject({ assetPack: { id: 'pack-1' }, companion: { id: 'companion-1' } });
  });

  it('skips cleanup when reactivation wins the superseded claim', async () => {
    const deleteObjects = jest.fn();
    const prisma = { companionAssetPack: { findMany: jest.fn().mockResolvedValue([{ id: 'pack-1', status: 'superseded', supersededAt: new Date('2026-06-01'), objectPrefix: 'redacted', files: [] }]), updateMany: jest.fn().mockResolvedValue({ count: 0 }), delete: jest.fn() } };
    const service = new CompanionService(prisma as never, { capability: { uploadsEnabled: true }, limits: { supersededPackRetentionDays: 30 }, deleteObjects } as never, { publishToUser: jest.fn() } as never);
    await expect(service.cleanupSupersededPacks()).resolves.toBe(0);
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(prisma.companionAssetPack.delete).not.toHaveBeenCalled();
  });

  it('keeps a claimed deleting pack for a later retry when R2 deletion fails', async () => {
    const prisma = { companionAssetPack: { findMany: jest.fn().mockResolvedValue([{ id: 'pack-1', status: 'deleting', objectPrefix: 'redacted', files: [] }]), delete: jest.fn() } };
    const service = new CompanionService(prisma as never, { capability: { uploadsEnabled: true }, limits: { supersededPackRetentionDays: 30 }, deleteObjects: jest.fn().mockRejectedValue(new Error('unavailable')) } as never, {} as never);
    await expect(service.cleanupSupersededPacks()).rejects.toThrow('unavailable');
    expect(prisma.companionAssetPack.delete).not.toHaveBeenCalled();
  });
});
