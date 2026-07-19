import { PortalService } from './portal.service';
import { validate } from 'class-validator';
import {
  PortalAccountDeleteDto,
  PortalDataDeleteDto,
} from './dto/portal-auth.dto';

describe('PortalService security projections', () => {
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
    const service = new PortalService({
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-1',
          role: 'SUPERADMIN',
        }),
      },
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

  it('builds an owned export with safe projections and no secret fields', async () => {
    const calls: unknown[] = [];
    const model = (name: string) => ({
      findMany: jest.fn((args) => {
        calls.push({ name, args });
        return `${name}-query`;
      }),
    });
    const user = {
      findUnique: jest.fn((args) => {
        calls.push({ name: 'user', args });
        return 'account-query';
      }),
    };
    const prisma = {
      user,
      friendship: model('friendship'),
      friendRequest: model('friendRequest'),
      blockedUser: model('blockedUser'),
      networkCompanion: model('networkCompanion'),
      visitInvitation: model('visitInvitation'),
      visitSession: model('visitSession'),
      notification: model('notification'),
      discovery: model('discovery'),
      deviceSession: model('deviceSession'),
      $transaction: jest.fn().mockResolvedValue([
        {
          id: 'user-1',
          uid: 'OC-USER0001',
          role: 'USER',
          createdAt: new Date('2026-07-19T00:00:00Z'),
        },
        [], [], [], [], [], [], [], [], [],
      ]),
    };
    const service = new PortalService(
      prisma as never,
      {} as never,
      {} as never,
    );
    const result = await service.dataExport('user-1');
    expect(result.account).toMatchObject({ id: 'user-1' });
    const projections = JSON.stringify(calls);
    expect(projections).not.toContain('passwordHash');
    expect(projections).not.toContain('refreshTokenHash');
    expect(projections).not.toContain('previousRefreshTokenHash');
    expect(projections).not.toContain('csrfTokenHash');
    expect(projections).not.toContain('objectKey');
    expect(projections).toContain('"userId":"user-1"');
  });
});
