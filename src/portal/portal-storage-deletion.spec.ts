import { PortalService } from './portal.service';

describe('Portal staged R2 deletion', () => {
  const pack = {
    id: 'pack-1',
    status: 'deleting',
    objectPrefix: 'packs/owner/pack-1',
    files: [{ objectKey: 'packs/owner/pack-1/animation.png' }],
  };

  it('verifies a superseded Pack prefix before deleting its row', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const storage = {
      limits: { supersededPackRetentionDays: 30 },
      deleteObjects: jest.fn().mockResolvedValue(undefined),
      assertObjectPrefixDeleted: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PortalService({
      companionAssetPack: {
        findMany: jest.fn().mockResolvedValue([pack]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany,
      },
    } as never, {} as never, storage as never);

    await expect(service.deleteSupersededAssetPacks('user-1'))
      .resolves.toEqual({ deleted: 1 });
    expect(storage.assertObjectPrefixDeleted.mock.invocationCallOrder[0])
      .toBeLessThan(deleteMany.mock.invocationCallOrder[0]);
  });

  it('preserves a superseded Pack row when prefix verification fails', async () => {
    const deleteMany = jest.fn();
    const prisma = {
      companionAssetPack: {
        findMany: jest.fn().mockResolvedValue([pack]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany,
      },
    };
    const storage = {
      limits: { supersededPackRetentionDays: 30 },
      deleteObjects: jest.fn().mockResolvedValue(undefined),
      assertObjectPrefixDeleted: jest.fn()
        .mockRejectedValue(new Error('ASSET_STORAGE_DELETE_INCOMPLETE')),
    };
    const service = new PortalService(
      prisma as never,
      {} as never,
      storage as never,
    );

    await expect(service.deleteSupersededAssetPacks('user-1'))
      .rejects.toThrow('ASSET_STORAGE_DELETE_INCOMPLETE');
    expect(prisma.companionAssetPack.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pack-1',
        status: 'deleting',
        companion: { ownerUserId: 'user-1' },
      },
      data: { failureCode: 'ASSET_CLEANUP_FAILED' },
    });
    expect(deleteMany).not.toHaveBeenCalled();
  });

  it('accepts a durable pending deletion when R2 cleanup must retry', async () => {
    const requestedAt = new Date('2026-07-19T00:00:00.000Z');
    const tx = {
      $queryRaw: jest.fn(),
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'user-1',
            role: 'USER',
            deletionRequestedAt: requestedAt,
            suspendedAt: null,
          }),
        update: jest.fn(),
        delete: jest.fn(),
      },
      networkCompanion: { updateMany: jest.fn() },
      friendRequest: { updateMany: jest.fn() },
      companionAssetPack: {
        updateMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      deviceSession: { updateMany: jest.fn() },
      visitSession: { deleteMany: jest.fn(), updateMany: jest.fn() },
      visitInvitation: { deleteMany: jest.fn(), updateMany: jest.fn() },
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ deletionAttemptCount: 0 }),
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      companionAssetPack: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { id: 1 },
          _max: { lastUploadUrlIssuedAt: null },
        }),
        findMany: jest.fn().mockResolvedValue([{
          ...pack,
          lastUploadUrlIssuedAt: null,
        }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      visitInvitation: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'invitation-1',
          visitorOwnerUserId: 'user-1',
          hostUserId: 'friend-1',
        }]),
      },
      visitSession: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'session-1',
          visitorOwnerUserId: 'user-1',
          hostUserId: 'friend-1',
          state: 'ended',
        }]),
      },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx)),
    };
    const storage = {
      limits: { uploadUrlTtlSeconds: 900 },
      deleteObjectPrefix: jest.fn()
        .mockRejectedValue(new Error('ASSET_STORAGE_DELETE_INCOMPLETE')),
    };
    const presence = { disconnectUser: jest.fn().mockResolvedValue(undefined) };
    const events = { publishToUser: jest.fn() };
    const service = new PortalService(
      prisma as never,
      {} as never,
      storage as never,
      presence as never,
      events as never,
    );

    await expect(service.deleteAccount('user-1')).resolves.toEqual({
      deleted: false,
      pending: true,
      deleteAfter: expect.any(String),
    });
    expect(tx.companionAssetPack.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'deleting', failureCode: null } }),
    );
    expect(prisma.companionAssetPack.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'pack-1',
        status: 'deleting',
        companion: { ownerUserId: 'user-1' },
      },
      data: { failureCode: 'ASSET_CLEANUP_FAILED' },
    });
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        accountStatus: 'SUSPENDED',
        deletionRequestedAt: requestedAt,
      }),
    }));
    expect(tx.visitInvitation.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'pending',
        OR: [
          { visitorOwnerUserId: 'user-1' },
          { hostUserId: 'user-1' },
        ],
      },
      data: {
        status: 'cancelled',
        cancelledAt: requestedAt,
        assetPackRefId: null,
      },
    });
    expect(tx.visitSession.updateMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          state: { in: ['preparing', 'ready'] },
        }),
        data: expect.objectContaining({
          state: 'cancelled',
          endReason: 'account_deletion_requested',
          assetPackRefId: null,
        }),
      }),
    );
    expect(tx.visitInvitation.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(tx.networkCompanion.updateMany.mock.invocationCallOrder[0]);
    expect(tx.visitSession.updateMany.mock.invocationCallOrder[1])
      .toBeLessThan(tx.networkCompanion.updateMany.mock.invocationCallOrder[0]);
    expect(tx.visitSession.updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          state: { in: ['active', 'ending'] },
        }),
        data: expect.objectContaining({
          state: 'ended',
          endReason: 'account_deletion_requested',
          assetPackRefId: null,
        }),
      }),
    );
    expect(presence.disconnectUser).toHaveBeenCalledWith('user-1');
    expect(events.publishToUser).toHaveBeenCalledWith(
      'friend-1',
      'visit.invitation.updated',
      { invitationId: 'invitation-1' },
    );
    expect(events.publishToUser).toHaveBeenCalledWith(
      'friend-1',
      'visit.session.ended',
      { sessionId: 'session-1', state: 'ended' },
    );
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('verifies every Account prefix before hard-deleting an immediately eligible Account', async () => {
    const requestedAt = new Date('2026-07-19T00:00:00.000Z');
    const tx = {
      $queryRaw: jest.fn(),
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'user-1',
            role: 'USER',
            deletionRequestedAt: requestedAt,
            suspendedAt: null,
          })
          .mockResolvedValueOnce({ deletionRequestedAt: requestedAt }),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      networkCompanion: { updateMany: jest.fn() },
      friendRequest: { updateMany: jest.fn() },
      companionAssetPack: {
        updateMany: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({
          _count: { id: 1 },
          _max: { lastUploadUrlIssuedAt: null },
        }),
      },
      deviceSession: { updateMany: jest.fn() },
      visitSession: { deleteMany: jest.fn(), updateMany: jest.fn() },
      visitInvitation: { deleteMany: jest.fn(), updateMany: jest.fn() },
    };
    const storage = {
      limits: { uploadUrlTtlSeconds: 900 },
      deleteObjectPrefix: jest.fn().mockResolvedValue(undefined),
    };
    const service = new PortalService({
      user: {
        findMany: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      companionAssetPack: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { id: 1 },
          _max: { lastUploadUrlIssuedAt: null },
        }),
        findMany: jest.fn().mockResolvedValue([{
          id: pack.id,
          objectPrefix: pack.objectPrefix,
          lastUploadUrlIssuedAt: null,
        }]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx)),
    } as never, {} as never, storage as never);

    await expect(service.deleteAccount('user-1'))
      .resolves.toEqual({ deleted: true, pending: false });
    expect(storage.deleteObjectPrefix.mock.invocationCallOrder[0])
      .toBeLessThan(tx.user.delete.mock.invocationCallOrder[0]);
  });

  it('defers hard deletion until every issued PUT URL has expired', async () => {
    const requestedAt = new Date();
    const issuedAt = new Date(requestedAt.getTime() - 1_000);
    const tx = {
      $queryRaw: jest.fn(),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          role: 'USER',
          deletionRequestedAt: requestedAt,
          suspendedAt: null,
        }),
        update: jest.fn(),
        delete: jest.fn(),
      },
      networkCompanion: { updateMany: jest.fn() },
      friendRequest: { updateMany: jest.fn() },
      companionAssetPack: {
        updateMany: jest.fn(),
        findMany: jest.fn(),
      },
      deviceSession: { updateMany: jest.fn() },
      visitSession: { deleteMany: jest.fn(), updateMany: jest.fn() },
      visitInvitation: { deleteMany: jest.fn(), updateMany: jest.fn() },
    };
    const prisma = {
      user: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      companionAssetPack: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { id: 1 },
          _max: { lastUploadUrlIssuedAt: issuedAt },
        }),
      },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx)),
    };
    const storage = {
      limits: { uploadUrlTtlSeconds: 900 },
      deleteObjectPrefix: jest.fn(),
    };
    const service = new PortalService(
      prisma as never,
      {} as never,
      storage as never,
    );

    const result = await service.deleteAccount('user-1');

    expect(result).toEqual({
      deleted: false,
      pending: true,
      deleteAfter: new Date(
        issuedAt.getTime() + 900_000 + 5_000,
      ).toISOString(),
    });
    expect(storage.deleteObjectPrefix).not.toHaveBeenCalled();
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('backs off a failed deletion without blocking later due accounts', async () => {
    const requestedAt = new Date('2026-07-19T00:00:00.000Z');
    const tx = {
      $queryRaw: jest.fn(),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          deletionRequestedAt: requestedAt,
        }),
        delete: jest.fn(),
      },
      companionAssetPack: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { id: 0 },
          _max: { lastUploadUrlIssuedAt: null },
        }),
      },
      visitSession: { deleteMany: jest.fn() },
      visitInvitation: { deleteMany: jest.fn() },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'poison', deletionRequestedAt: requestedAt },
          { id: 'healthy', deletionRequestedAt: requestedAt },
        ]),
        findUnique: jest.fn().mockResolvedValue({
          deletionAttemptCount: 4,
        }),
        updateMany,
      },
      companionAssetPack: {
        aggregate: jest.fn()
          .mockRejectedValueOnce(new Error('R2 unavailable'))
          .mockResolvedValue({
            _count: { id: 0 },
            _max: { lastUploadUrlIssuedAt: null },
          }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx)),
    };
    const service = new PortalService(
      prisma as never,
      {} as never,
      { limits: { uploadUrlTtlSeconds: 900 } } as never,
    );

    await expect(service.finalizePendingAccountDeletions()).resolves.toEqual({
      processed: 2,
      deleted: 1,
      pending: 0,
      failed: 1,
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        deletionRequestedAt: { not: null },
        OR: [
          { deletionNextAttemptAt: null },
          { deletionNextAttemptAt: { lte: expect.any(Date) } },
        ],
      },
      take: 100,
    }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'poison', deletionRequestedAt: { not: null } },
      data: expect.objectContaining({
        deletionAttemptCount: { increment: 1 },
        deletionNextAttemptAt: expect.any(Date),
      }),
    }));
    expect(tx.user.delete).toHaveBeenCalledWith({
      where: { id: 'healthy' },
    });
  });
});
