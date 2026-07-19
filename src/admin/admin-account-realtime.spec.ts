import { AdminApiService } from './admin-api.service';

function createService(
  prisma: Record<string, unknown>,
  audit: Record<string, unknown> = { record: jest.fn().mockResolvedValue({}) },
  presence: Record<string, unknown> = {
    getOperationalSnapshot: jest.fn().mockReturnValue({
      status: 'ok',
      connectionCount: 0,
      connectedUsers: 0,
      reconnectCount: 0,
      reconnectWindowMinutes: 15,
    }),
  },
) {
  return new AdminApiService(
    prisma as never,
    audit as never,
    { capability: { uploadsEnabled: true } } as never,
    {
      protocolVersion: '2',
      serverVersion: '1.0.0',
      minimumClientVersion: '1.0.0',
    } as never,
    {} as never,
    {} as never,
    {} as never,
    presence as never,
  );
}

describe('AdminApiService bounded account and realtime inspection', () => {
  it('returns bounded relationship, visit, notification, and audit rows without secret fields', async () => {
    const userFindUnique = jest.fn().mockResolvedValue({
      id: 'user-1',
      uid: 'OC-USER0001',
      friendships: [{
        id: 'friendship-1',
        createdAt: new Date(),
        friend: { id: 'friend-1', uid: 'OC-FRIEND01', username: 'friend' },
      }],
      blockedUsers: [],
      blockedBy: [],
      visitInvitationsOwned: [],
      visitInvitationsHosted: [],
      visitSessionsOwned: [],
      visitSessionsHosted: [],
      notifications: [{
        id: 'notification-1',
        type: 'visit',
        title: 'Visit ready',
        message: 'Mochi is ready.',
        read: false,
        createdAt: new Date(),
      }],
      _count: { notifications: 4 },
    });
    const assetPackFindMany = jest.fn().mockResolvedValue([{
      id: 'pack-1',
      companionId: 'companion-1',
      manifestHash: 'manifest-hash',
      schemaVersion: 2,
      status: 'active',
      totalFiles: 29,
      totalBytes: 4096n,
      failureCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: new Date(),
      activatedAt: new Date(),
      supersededAt: null,
      companion: { id: 'companion-1', name: 'Mochi', published: true },
    }]);
    const assetPackCount = jest.fn().mockResolvedValue(72);
    const notificationCount = jest.fn().mockResolvedValue(2);
    const auditFindMany = jest.fn().mockResolvedValue([{
      id: 'audit-1',
      adminUserId: 'admin-1',
      action: 'VIEW_SENSITIVE_ACCOUNT',
      targetType: 'User',
      targetId: 'user-1',
      reason: null,
      createdAt: new Date(),
    }]);
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = createService({
      user: { findUnique: userFindUnique },
      notification: { count: notificationCount },
      companionAssetPack: {
        findMany: assetPackFindMany,
        count: assetPackCount,
      },
      adminAuditLog: { findMany: auditFindMany },
    }, audit);

    const result = await service.getUser('admin-1', 'user-1');

    expect(result).toMatchObject({
      id: 'user-1',
      detailLimit: 50,
      friends: [{ id: 'friendship-1', user: { id: 'friend-1' } }],
      notifications: { summary: { total: 4, unread: 2 } },
      assetPacks: {
        total: 72,
        truncated: true,
        items: [{
          id: 'pack-1',
          totalBytes: 4096,
          companion: { name: 'Mochi' },
        }],
      },
      auditRelatedEvents: [{ id: 'audit-1' }],
    });
    const userProjection = userFindUnique.mock.calls[0][0].select;
    for (const relation of [
      'deviceSessions',
      'networkCompanions',
      'friendships',
      'blockedUsers',
      'blockedBy',
      'visitInvitationsOwned',
      'visitInvitationsHosted',
      'visitSessionsOwned',
      'visitSessionsHosted',
      'notifications',
    ]) {
      expect(userProjection[relation].take).toBe(50);
    }
    expect(auditFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 50,
      where: {
        OR: [
          { targetId: 'user-1' },
          { adminUserId: 'user-1' },
        ],
      },
    }));
    expect(assetPackFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 50,
      where: { companion: { ownerUserId: 'user-1' } },
    }));
    expect(assetPackCount).toHaveBeenCalledWith({
      where: { companion: { ownerUserId: 'user-1' } },
    });
    expect(JSON.stringify([
      userFindUnique.mock.calls,
      notificationCount.mock.calls,
      assetPackFindMany.mock.calls,
      assetPackCount.mock.calls,
      auditFindMany.mock.calls,
      result,
    ])).not.toMatch(
      /passwordHash|refreshTokenHash|previousRefreshTokenHash|csrfTokenHash|ipAddressHash|metadata|objectKey/,
    );
  });

  it('reports bounded operational presence, active devices, visit participants, and reconnects', async () => {
    const raw = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ migration_name: '20260719_acceptance' }]);
    const presenceCount = jest.fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const presenceFindMany = jest.fn().mockResolvedValue([{
      userId: 'user-1',
      status: 'offline',
      lastSeenAt: new Date('2026-07-19T00:00:00.000Z'),
      updatedAt: new Date('2026-07-19T00:00:00.000Z'),
      user: {
        uid: 'OC-USER0001',
        username: 'caretaker',
        profile: { displayName: 'Caretaker' },
      },
    }]);
    const deviceCount = jest.fn().mockResolvedValue(6);
    const visitFindMany = jest.fn().mockResolvedValue([
      { visitorOwnerUserId: 'user-1', hostUserId: 'user-2' },
      { visitorOwnerUserId: 'user-1', hostUserId: 'user-3' },
    ]);
    const websocket = {
      status: 'ok',
      connectionCount: 4,
      connectedUsers: 3,
      reconnectCount: 2,
      reconnectWindowMinutes: 15,
    };
    const service = createService({
      $queryRaw: raw,
      user: { count: jest.fn().mockResolvedValue(12) },
      presence: { count: presenceCount, findMany: presenceFindMany },
      deviceSession: { count: deviceCount },
      visitSession: { findMany: visitFindMany },
    }, undefined, {
      getOperationalSnapshot: jest.fn().mockReturnValue(websocket),
    });

    await expect(service.systemHealth()).resolves.toMatchObject({
      database: 'ok',
      migrationVersion: '20260719_acceptance',
      websocket,
      realtime: {
        presence: { online: 3, idle: 2, offline: 7, stale: 1 },
        activeDeviceCount: 6,
        activeVisitParticipants: 3,
        activeVisitParticipantsCapped: false,
        lastSeen: [{
          userId: 'user-1',
          displayName: 'Caretaker',
          status: 'offline',
        }],
      },
    });
    expect(presenceFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 50,
    }));
    expect(visitFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 1_000,
    }));
  });
});
