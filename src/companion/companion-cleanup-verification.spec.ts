import { CompanionService } from './companion.service';

describe('Companion Asset Pack cleanup verification', () => {
  it('verifies the R2 prefix before deleting the database row', async () => {
    const deleteRow = jest.fn().mockResolvedValue(undefined);
    const storage = {
      capability: { uploadsEnabled: true },
      limits: { supersededPackRetentionDays: 30 },
      deleteObjects: jest.fn().mockResolvedValue(undefined),
      assertObjectPrefixDeleted: jest.fn().mockResolvedValue(undefined),
    };
    const service = new CompanionService({
      companionAssetPack: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'pack-1',
          status: 'deleting',
          objectPrefix: 'packs/owner/pack-1',
          files: [],
        }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: deleteRow,
      },
    } as never, storage as never, {} as never);

    await expect(service.cleanupSupersededPacks()).resolves.toBe(1);
    expect(storage.deleteObjects.mock.invocationCallOrder[0])
      .toBeLessThan(storage.assertObjectPrefixDeleted.mock.invocationCallOrder[0]);
    expect(storage.assertObjectPrefixDeleted.mock.invocationCallOrder[0])
      .toBeLessThan(deleteRow.mock.invocationCallOrder[0]);
  });

  it('keeps and marks the deleting row when prefix verification fails without aborting cleanup', async () => {
    const deleteRow = jest.fn();
    const prisma = {
      companionAssetPack: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'pack-1',
          status: 'deleting',
          objectPrefix: 'packs/owner/pack-1',
          files: [{ objectKey: 'packs/owner/pack-1/animation.png' }],
        }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: deleteRow,
      },
    };
    const storage = {
      capability: { uploadsEnabled: true },
      limits: { supersededPackRetentionDays: 30 },
      deleteObjects: jest.fn().mockResolvedValue(undefined),
      assertObjectPrefixDeleted: jest.fn()
        .mockRejectedValue(new Error('ASSET_STORAGE_DELETE_INCOMPLETE')),
    };
    const service = new CompanionService(
      prisma as never,
      storage as never,
      {} as never,
    );

    await expect(service.cleanupSupersededPacks()).resolves.toBe(0);
    expect(storage.deleteObjects).toHaveBeenCalled();
    expect(storage.assertObjectPrefixDeleted)
      .toHaveBeenCalledWith('packs/owner/pack-1');
    expect(prisma.companionAssetPack.updateMany).toHaveBeenCalledWith({
      where: { id: 'pack-1', status: 'deleting' },
      data: { failureCode: 'ASSET_CLEANUP_FAILED' },
    });
    expect(deleteRow).not.toHaveBeenCalled();
  });
});
