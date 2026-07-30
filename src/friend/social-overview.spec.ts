import { FriendService } from './friend.service';

describe('FriendService Social overview', () => {
  it('aggregates Social domains into one privacy-safe response', async () => {
    const prisma = {
      blockedUser: {
        findMany: jest.fn().mockResolvedValue([{
          createdAt: new Date('2026-07-31T00:00:00.000Z'),
          blocked: { id: 'blocked-1', uid: 'OC-BLOCKED1', username: 'Blocked' },
        }]),
      },
      presence: {
        findMany: jest.fn().mockResolvedValue([{
          userId: 'friend-1', status: 'online', updatedAt: new Date('2026-07-31T00:00:00.000Z'),
        }]),
      },
    };
    const visits = {
      listInvitations: jest.fn()
        .mockResolvedValueOnce([{ id: 'incoming-visit' }])
        .mockResolvedValueOnce([{ id: 'outgoing-visit' }]),
      listSessions: jest.fn().mockResolvedValue([{ id: 'session-1' }]),
    };
    const service = new FriendService(prisma as never, { publishToUser: jest.fn() } as never, visits as never);
    jest.spyOn(service, 'getFriends').mockResolvedValue([{
      id: 'friendship-1',
      userId: 'friend-1',
      username: 'Friend',
      uid: 'OC-FRIEND01',
      friendCode: 'FRIEND01',
      profile: null,
      hasPublishedCompanion: true,
    }]);
    jest.spyOn(service, 'getIncomingRequests').mockResolvedValue([{
      id: 'request-in', createdAt: new Date('2026-07-30T00:00:00.000Z'),
      sender: { id: 'sender-1', username: 'Sender', uid: 'OC-SENDER01', friendCode: 'SENDER01' },
    }] as never);
    jest.spyOn(service, 'getOutgoingRequests').mockResolvedValue([{
      id: 'request-out', createdAt: new Date('2026-07-30T00:00:00.000Z'),
      receiver: { id: 'receiver-1', username: 'Receiver', uid: 'OC-RECEIVE1', friendCode: 'RECEIVE1' },
    }] as never);

    const overview = await service.getSocialOverview('user-1');

    expect(overview.friends).toEqual([
      expect.objectContaining({ userId: 'friend-1', presence: 'online', hasPublishedCompanion: true }),
    ]);
    expect(overview.incomingRequests).toEqual([
      expect.objectContaining({ id: 'request-in', direction: 'incoming', userId: 'sender-1' }),
    ]);
    expect(overview.outgoingRequests).toEqual([
      expect.objectContaining({ id: 'request-out', direction: 'outgoing', userId: 'receiver-1' }),
    ]);
    expect(overview.blockedUsers).toEqual([
      expect.objectContaining({ userId: 'blocked-1', username: 'Blocked' }),
    ]);
    expect(overview.visitInvitations).toEqual({
      incoming: [{ id: 'incoming-visit' }],
      outgoing: [{ id: 'outgoing-visit' }],
    });
    expect(overview.visitSessions).toEqual([{ id: 'session-1' }]);
    expect(overview.synchronizedAt).toEqual(expect.any(String));
    expect(visits.listInvitations).toHaveBeenNthCalledWith(1, 'user-1', 'incoming');
    expect(visits.listInvitations).toHaveBeenNthCalledWith(2, 'user-1', 'outgoing');
    expect(visits.listSessions).toHaveBeenCalledWith('user-1');
    expect(prisma.presence.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: { in: ['friend-1'] } },
    }));
  });
});
