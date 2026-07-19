import { PortalService } from './portal.service';
import { validate } from 'class-validator';
import {
  PortalAccountDeleteDto,
  PortalDataDeleteDto,
} from './dto/portal-auth.dto';
import { Readable } from 'node:stream';

type ExportFindManyArgs = {
  take: number;
  cursor?: { id: string };
  skip?: number;
  select?: unknown;
  where?: unknown;
};

function cursorModel<T extends { id: string }>(rows: T[]) {
  return {
    findMany: jest.fn(async (args: ExportFindManyArgs) => {
      const cursorIndex = args.cursor
        ? rows.findIndex((row) => row.id === args.cursor?.id)
        : -1;
      const start = cursorIndex + (args.cursor && args.skip ? args.skip : 1);
      return rows.slice(Math.max(0, start), Math.max(0, start) + args.take);
    }),
  };
}

async function readJsonStream(stream: Readable): Promise<Record<string, any>> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, any>;
}

describe('PortalService security projections', () => {
  it('builds the summary exclusively from the signed-in user’s records', async () => {
    const userFindUnique = jest.fn().mockResolvedValue({
      presence: { status: 'online', lastSeenAt: null },
      activeNetworkCompanion: { id: 'companion-1', name: 'Mochi' },
    });
    const friendshipCount = jest.fn().mockResolvedValue(4);
    const friendRequestCount = jest.fn().mockResolvedValue(1);
    const visitFindMany = jest.fn().mockResolvedValue([{ id: 'visit-1' }]);
    const notificationCount = jest.fn().mockResolvedValue(2);
    const deviceCount = jest.fn().mockResolvedValue(3);
    const service = new PortalService({
      user: { findUnique: userFindUnique },
      friendship: { count: friendshipCount },
      friendRequest: { count: friendRequestCount },
      visitSession: { findMany: visitFindMany },
      notification: { count: notificationCount },
      deviceSession: { count: deviceCount },
    } as never, {} as never, {} as never);

    await expect(service.summary('user-1')).resolves.toMatchObject({
      friends: 4,
      pendingRequests: 1,
      recentVisits: [{ id: 'visit-1' }],
      unreadNotifications: 2,
      activeDevices: 3,
    });
    expect(userFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1' },
    }));
    expect(friendshipCount).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(friendRequestCount).toHaveBeenCalledWith({
      where: { receiverId: 'user-1', status: 'pending' },
    });
    expect(visitFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { visitorOwnerUserId: 'user-1' },
          { hostUserId: 'user-1' },
        ],
      },
      take: 5,
    }));
    expect(notificationCount).toHaveBeenCalledWith({
      where: { userId: 'user-1', read: false },
    });
    expect(deviceCount).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'user-1', revokedAt: null }),
    }));
    expect(JSON.stringify(userFindUnique.mock.calls)).not.toMatch(
      /passwordHash|refreshTokenHash|csrfTokenHash/,
    );
  });

  it('lists only owned device sessions with bounded fields and stable sorting', async () => {
    const findMany = jest.fn().mockReturnValue('devices-query');
    const count = jest.fn().mockReturnValue('count-query');
    const prisma = {
      deviceSession: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[{
        id: 'session-1',
        deviceId: 'device-1',
      }], 1]),
    };
    const service = new PortalService(prisma as never, {} as never, {} as never);
    const result = await service.listDevices('user-1', {
      page: 1,
      limit: 500,
      direction: 'desc',
    } as never);
    expect(result.pagination.limit).toBe(100);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1' },
      take: 100,
      orderBy: [{ lastUsedAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        deviceId: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    }));
    expect(JSON.stringify(findMany.mock.calls)).not.toContain('refreshTokenHash');
    expect(JSON.stringify(findMany.mock.calls)).not.toContain('csrfTokenHash');
  });

  it('cannot revoke another user’s device session', async () => {
    const update = jest.fn();
    const service = new PortalService({
      deviceSession: {
        findFirst: jest.fn().mockResolvedValue(null),
        update,
      },
    } as never, {} as never, {} as never);
    await expect(service.revokeDevice(
      'user-1', 'other-session', 'device-1',
    )).rejects.toThrow('Device session not found');
    expect(update).not.toHaveBeenCalled();
  });

  it('revokes every other active device without touching another user or the current device', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const service = new PortalService({
      deviceSession: { updateMany },
    } as never, {} as never, {} as never);

    await expect(service.revokeOtherDevices(
      'user-1',
      'current-device',
    )).resolves.toEqual({ revoked: 2 });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        deviceId: { not: 'current-device' },
        revokedAt: null,
      },
      data: {
        revokedAt: expect.any(Date),
        csrfTokenHash: null,
      },
    });
  });

  it('lists only visits involving the signed-in user', async () => {
    const findMany = jest.fn().mockReturnValue('visit-query');
    const count = jest.fn().mockReturnValue('count-query');
    const service = new PortalService({
      visitSession: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[
        {
          id: 'visit-1',
          visitorOwnerUserId: 'user-1',
          hostUserId: 'friend-1',
          startedAt: null,
          endedAt: null,
        },
      ], 1]),
    } as never, {} as never, {} as never);

    await expect(service.listVisits('user-1', {
      kind: 'sessions',
      page: 1,
      limit: 20,
      direction: 'desc',
    } as never)).resolves.toMatchObject({
      items: [{ id: 'visit-1', durationSeconds: null }],
      pagination: { total: 1 },
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [
          { visitorOwnerUserId: 'user-1' },
          { hostUserId: 'user-1' },
        ],
      },
      take: 20,
    }));
    expect(count).toHaveBeenCalledWith({
      where: {
        OR: [
          { visitorOwnerUserId: 'user-1' },
          { hostUserId: 'user-1' },
        ],
      },
    });
  });

  it('denies cross-user Companion, Asset Pack, and Visit reads', async () => {
    const companionFindFirst = jest.fn().mockResolvedValue(null);
    const sessionFindFirst = jest.fn().mockResolvedValue(null);
    const invitationFindFirst = jest.fn().mockResolvedValue(null);
    const service = new PortalService({
      networkCompanion: { findFirst: companionFindFirst },
      visitSession: { findFirst: sessionFindFirst },
      visitInvitation: { findFirst: invitationFindFirst },
    } as never, {} as never, {} as never);

    await expect(service.getCompanion('user-1', 'other-companion'))
      .rejects.toThrow('Companion not found');
    await expect(service.listAssetPacks(
      'user-1',
      'other-companion',
      { page: 1, limit: 20 } as never,
    )).rejects.toThrow('Companion not found');
    await expect(service.getVisit('user-1', 'other-visit'))
      .rejects.toThrow('Visit not found');

    expect(companionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'other-companion', ownerUserId: 'user-1' },
    }));
    expect(sessionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'other-visit',
        OR: [
          { visitorOwnerUserId: 'user-1' },
          { hostUserId: 'user-1' },
        ],
      },
    }));
    expect(invitationFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'other-visit',
        OR: [
          { visitorOwnerUserId: 'user-1' },
          { hostUserId: 'user-1' },
        ],
      },
    }));
  });

  it('preserves timestamps while normalizing BigInt asset fields', async () => {
    const createdAt = new Date('2026-07-19T03:00:00.000Z');
    const findMany = jest.fn().mockReturnValue('pack-query');
    const service = new PortalService({
      networkCompanion: {
        findFirst: jest.fn().mockResolvedValue({ id: 'companion-1' }),
      },
      companionAssetPack: {
        findMany,
        count: jest.fn().mockReturnValue('count-query'),
      },
      $transaction: jest.fn().mockResolvedValue([[
        {
          id: 'pack-1',
          totalBytes: 123n,
          createdAt,
          _count: { files: 1 },
        },
      ], 1]),
    } as never, {} as never, {} as never);
    const result = await service.listAssetPacks('user-1', 'companion-1', {
      page: 1,
      limit: 20,
      direction: 'desc',
    } as never);
    expect(result.items[0]).toMatchObject({
      totalBytes: 123,
      createdAt,
    });
    expect(result.items[0].createdAt).toBeInstanceOf(Date);
  });

  it('applies owned date/search filters to bounded portal lists', async () => {
    const findMany = jest.fn().mockReturnValue('companions-query');
    const count = jest.fn().mockReturnValue('count-query');
    const service = new PortalService({
      networkCompanion: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    } as never, {} as never, {} as never);
    await service.listCompanions('user-1', {
      page: 1,
      limit: 20,
      direction: 'desc',
      search: 'Mochi',
      dateFrom: '2026-07-01',
      dateTo: '2026-07-19',
    } as never);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        ownerUserId: 'user-1',
        name: { contains: 'Mochi', mode: 'insensitive' },
        createdAt: {
          gte: new Date('2026-07-01'),
          lte: new Date('2026-07-19T23:59:59.999Z'),
        },
      }),
    }));
  });

  it('searches friend requests through only the signed-in user relationship', async () => {
    const findMany = jest.fn().mockReturnValue('requests-query');
    const count = jest.fn().mockReturnValue('count-query');
    const service = new PortalService({
      friendRequest: { findMany, count },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    } as never, {} as never, {} as never);

    await service.listFriendRequests('user-1', {
      direction: 'incoming',
      status: 'pending',
      search: 'Mochi',
      page: 1,
      limit: 20,
      sortDirection: 'desc',
    } as never);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        receiverId: 'user-1',
        status: 'pending',
        sender: expect.objectContaining({
          OR: expect.arrayContaining([
            { uid: { contains: 'Mochi', mode: 'insensitive' } },
            { username: { contains: 'Mochi', mode: 'insensitive' } },
          ]),
        }),
      },
      take: 20,
    }));
  });

  it('deletes only the signed-in user’s cleanup categories', async () => {
    const notificationDelete = jest.fn().mockResolvedValue({ count: 3 });
    const discoveryDelete = jest.fn().mockResolvedValue({ count: 2 });
    const service = new PortalService({
      notification: { deleteMany: notificationDelete },
      discovery: { deleteMany: discoveryDelete },
    } as never, {} as never, {} as never);
    await expect(service.deleteNotifications('user-1')).resolves.toEqual({
      deleted: 3,
    });
    await expect(service.deleteSharedDiscoveries('user-1')).resolves.toEqual({
      deleted: 2,
    });
    expect(notificationDelete).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(discoveryDelete).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
  });

  it('forbids Superadmin self-service account deletion before storage changes', async () => {
    const deleteObjects = jest.fn();
    const tx = {
      $queryRaw: jest.fn(),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-1',
          role: 'SUPERADMIN',
          deletionRequestedAt: null,
          suspendedAt: null,
        }),
      },
    };
    const service = new PortalService({
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx)),
    } as never, {} as never, {
      deleteObjects,
    } as never);
    await expect(service.deleteAccount('admin-1')).rejects.toMatchObject({
      response: { code: 'SUPERADMIN_SELF_DELETE_FORBIDDEN' },
    });
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it('requires exact destructive confirmations at the DTO boundary', async () => {
    const data = Object.assign(new PortalDataDeleteDto(), {
      confirmation: 'delete',
    });
    const account = Object.assign(new PortalAccountDeleteDto(), {
      confirmation: 'DELETE',
    });
    expect(await validate(data)).not.toHaveLength(0);
    expect(await validate(account)).not.toHaveLength(0);
    expect(await validate(Object.assign(new PortalDataDeleteDto(), {
      confirmation: 'DELETE',
    }))).toHaveLength(0);
    expect(await validate(Object.assign(new PortalAccountDeleteDto(), {
      confirmation: 'DELETE MY ACCOUNT',
    }))).toHaveLength(0);
  });

  it('streams every owned record in bounded cursor batches without eager queries', async () => {
    const notifications = Array.from({ length: 205 }, (_, index) => ({
      id: `notification-${String(index).padStart(3, '0')}`,
      type: 'visit',
      title: `Notification ${index}`,
      message: 'Complete export fixture',
      data: null,
      read: false,
      createdAt: new Date('2026-07-19T00:00:00Z'),
    }));
    const notification = cursorModel(notifications);
    const emptyModels = {
      friendship: cursorModel([]),
      friendRequest: cursorModel([]),
      blockedUser: cursorModel([]),
      networkCompanion: cursorModel([]),
      companionAssetPack: cursorModel([]),
      companionAssetFile: cursorModel([]),
      visitInvitation: cursorModel([]),
      visitSession: cursorModel([]),
      discovery: cursorModel([]),
      deviceSession: cursorModel([]),
    };
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          uid: 'OC-USER0001',
          role: 'USER',
          createdAt: new Date('2026-07-19T00:00:00Z'),
        }),
      },
      ...emptyModels,
      notification,
    };
    const service = new PortalService(
      prisma as never,
      {} as never,
      {} as never,
    );
    const stream = await service.dataExport('user-1');
    expect(notification.findMany).not.toHaveBeenCalled();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(notification.findMany).not.toHaveBeenCalled();

    const result = await readJsonStream(stream);
    expect(result).toMatchObject({
      schemaVersion: 2,
      complete: true,
      account: { id: 'user-1' },
    });
    expect(result.notifications).toHaveLength(205);
    expect(result.notifications.map((item: { id: string }) => item.id))
      .toEqual(notifications.map((item) => item.id));
    expect(notification.findMany).toHaveBeenCalledTimes(3);
    for (const [args] of notification.findMany.mock.calls) {
      expect(args).toMatchObject({
        take: 100,
        orderBy: { id: 'asc' },
        where: { userId: 'user-1' },
      });
    }
  });

  it('streams nested asset files completely without credentials, token hashes, or object keys', async () => {
    const files = Array.from({ length: 205 }, (_, index) => ({
      id: `file-${String(index).padStart(3, '0')}`,
      relativePath: `animations/${index}.png`,
      mimeType: 'image/png',
      sizeBytes: BigInt(index + 1),
      sha256: `sha-${index}`,
      category: 'animation',
      uploaded: true,
      verifiedAt: null,
      objectKey: `users/user-1/private-${index}`,
    }));
    const assetFiles = cursorModel(files);
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          uid: 'OC-USER0001',
          role: 'USER',
          passwordHash: 'password-secret',
          createdAt: new Date('2026-07-19T00:00:00Z'),
        }),
      },
      friendship: cursorModel([]),
      friendRequest: cursorModel([]),
      blockedUser: cursorModel([]),
      networkCompanion: cursorModel([{
        id: 'companion-1',
        name: 'Mochi',
        objectPrefix: 'users/user-1/companions/companion-1',
      }]),
      companionAssetPack: cursorModel([{
        id: 'pack-1',
        manifestHash: 'manifest-hash',
        totalBytes: 9_007_199_254_740_993n,
        manifest: {
          objectKey: 'manifest-object-secret',
          credentials: { apiKey: 'nested-api-secret' },
        },
        objectPrefix: 'users/user-1/packs/pack-1',
      }]),
      companionAssetFile: assetFiles,
      visitInvitation: cursorModel([]),
      visitSession: cursorModel([]),
      notification: cursorModel([{
        id: 'notification-1',
        data: {
          refreshTokenHash: 'nested-refresh-secret',
          safeValue: 'preserved',
        },
      }]),
      discovery: cursorModel([]),
      deviceSession: cursorModel([{
        id: 'session-1',
        deviceId: 'device-1',
        refreshTokenHash: 'refresh-secret',
        previousRefreshTokenHash: 'previous-refresh-secret',
        csrfTokenHash: 'csrf-secret',
      }]),
    };
    const service = new PortalService(
      prisma as never,
      {} as never,
      {} as never,
    );
    const result = await readJsonStream(await service.dataExport('user-1'));
    const pack = result.companions[0].assetPacks[0];
    expect(pack.files).toHaveLength(205);
    expect(pack.totalBytes).toBe('9007199254740993');
    expect(result.notifications[0].data).toEqual({ safeValue: 'preserved' });
    expect(assetFiles.findMany).toHaveBeenCalledTimes(3);

    const projections = JSON.stringify([
      prisma.user.findUnique.mock.calls,
      prisma.networkCompanion.findMany.mock.calls,
      prisma.companionAssetPack.findMany.mock.calls,
      prisma.companionAssetFile.findMany.mock.calls,
      prisma.deviceSession.findMany.mock.calls,
    ]);
    expect(projections).not.toContain('passwordHash');
    expect(projections).not.toContain('refreshTokenHash');
    expect(projections).not.toContain('previousRefreshTokenHash');
    expect(projections).not.toContain('csrfTokenHash');
    expect(projections).not.toContain('objectKey');
    expect(projections).toContain('"userId":"user-1"');
    expect(projections).toContain('"take":100');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /passwordHash|refreshTokenHash|previousRefreshTokenHash|csrfTokenHash|objectKey|objectPrefix/,
    );
    expect(serialized).not.toMatch(
      /password-secret|refresh-secret|previous-refresh-secret|csrf-secret|nested-api-secret|manifest-object-secret|users\/user-1\//,
    );
  });
});
