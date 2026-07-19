import { PresenceService } from './presence.service';

describe('PresenceService recovery and REST contract', () => {
  it('resets volatile online and idle Presence during single-instance startup', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const service = new PresenceService({ presence: { updateMany } } as never);
    await service.onModuleInit();
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: { in: ['online', 'idle'] } },
      data: expect.objectContaining({ status: 'offline', lastSeenAt: expect.any(Date) }),
    }));
  });

  it('maps Presence snapshots to the public updatedAt contract', async () => {
    const updatedAt = new Date('2026-07-13T00:00:00.000Z');
    const service = new PresenceService({
      friendship: { findMany: jest.fn().mockResolvedValue([{ friendId: 'friend-a' }, { friendId: 'friend-b' }]) },
      presence: { findMany: jest.fn().mockResolvedValue([{ userId: 'friend-a', status: 'idle', lastSeenAt: updatedAt, updatedAt }]) },
    } as never);
    await expect(service.getFriendsPresence('user-a')).resolves.toEqual([
      { userId: 'friend-a', status: 'idle', updatedAt: updatedAt.toISOString() },
      { userId: 'friend-b', status: 'offline', updatedAt: null },
    ]);
    expect((service as any).prisma.friendship.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        user: { accountStatus: 'ACTIVE', deletionRequestedAt: null },
        friend: { accountStatus: 'ACTIVE', deletionRequestedAt: null },
      },
      select: { friendId: true },
    });
  });

  it('only returns active, non-deleting users as presence recipients', async () => {
    const findMany = jest.fn().mockResolvedValue([{ friendId: 'friend-a' }]);
    const service = new PresenceService({
      friendship: { findMany },
    } as never);

    await expect(service.getFriendIds('user-a')).resolves.toEqual(['friend-a']);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-a',
        friend: { accountStatus: 'ACTIVE', deletionRequestedAt: null },
      },
      select: { friendId: true },
    });
  });
});
