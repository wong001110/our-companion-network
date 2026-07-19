import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FriendService } from './friend.service';

function withTransaction(
  prisma: Record<string, any>,
  activeParticipants = 2,
) {
  const tx = {
    ...prisma,
    $queryRaw: jest.fn(),
    user: {
      ...(prisma.user ?? {}),
      count: jest.fn().mockResolvedValue(activeParticipants),
    },
  };
  return {
    ...prisma,
    $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
      operation(tx)),
  };
}

describe('FriendService S2 rules', () => {
  const eventPublisher = { publishToUser: jest.fn() };

  beforeEach(() => eventPublisher.publishToUser.mockReset());

  it('looks up UID case-insensitively without exposing email', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'user-b', uid: 'OC-7K4M92QX', username: 'Same Name', friendCode: 'ABCDEF12',
      accountStatus: 'ACTIVE', deletionRequestedAt: null,
    });
    const service = new FriendService({ user: { findUnique } } as never, eventPublisher as never);
    const result = await service.lookupByUid(' oc-7k4m92qx ');
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { uid: 'OC-7K4M92QX' } }));
    expect(result).toEqual(expect.objectContaining({ uid: 'OC-7K4M92QX', username: 'Same Name' }));
    expect(result).not.toHaveProperty('email');
  });

  it('returns the same privacy-safe not-found response for unknown and malformed UIDs', async () => {
    const service = new FriendService(
      { user: { findUnique: jest.fn().mockResolvedValue(null) } } as never,
      eventPublisher as never,
    );
    await expect(service.lookupByUid('oc-xxxxxxxx')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SOCIAL_UID_NOT_FOUND' }),
    });
    await expect(service.lookupByUid('bad')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SOCIAL_UID_NOT_FOUND' }),
    });
  });

  it('hides deletion-pending accounts from lookup and new requests', async () => {
    const pending = {
      id: 'user-b',
      uid: 'OC-7K4M92QX',
      username: 'Leaving',
      friendCode: 'ABCDEF12',
      accountStatus: 'SUSPENDED',
      deletionRequestedAt: new Date(),
    };
    const lookupService = new FriendService({
      user: { findUnique: jest.fn().mockResolvedValue(pending) },
    } as never, eventPublisher as never);

    await expect(lookupService.lookupByUid(pending.uid)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SOCIAL_UID_NOT_FOUND' }),
    });
    const requestService = new FriendService(withTransaction({
      user: { findUnique: jest.fn().mockResolvedValue(pending) },
      friendship: { findFirst: jest.fn() },
      blockedUser: { findFirst: jest.fn() },
      friendRequest: { findUnique: jest.fn(), upsert: jest.fn() },
    }, 1) as never, eventPublisher as never);
    await expect(requestService.sendFriendRequest('user-a', {
      receiverId: pending.id,
    })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'USER_NOT_FOUND' }),
    });
  });

  it('rejects a request to oneself with the stable social code', async () => {
    const service = new FriendService({} as never, eventPublisher as never);
    await expect(service.sendFriendRequest('user-a', { receiverId: 'user-a' })).rejects.toMatchObject<Partial<ForbiddenException>>({});
  });

  it('reopens a terminal directed request so a rejected request can be resent', async () => {
    const request = { id: 'request-1', senderId: 'user-a', receiverId: 'user-b', status: 'pending', sender: { id: 'user-a', username: 'a' }, receiver: { id: 'user-b', username: 'b' } };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-b', accountStatus: 'ACTIVE', deletionRequestedAt: null }) },
      friendship: { findFirst: jest.fn().mockResolvedValue(null) },
      blockedUser: { findFirst: jest.fn().mockResolvedValue(null) },
      friendRequest: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 'old', status: 'rejected' }).mockResolvedValueOnce(null),
        upsert: jest.fn().mockResolvedValue(request),
      },
    };
    const service = new FriendService(withTransaction(prisma) as never, eventPublisher as never);
    await expect(service.sendFriendRequest('user-a', { receiverId: 'user-b' })).resolves.toEqual(request);
    expect(prisma.friendRequest.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: 'pending', updatedAt: expect.any(Date) }) }));
    expect(eventPublisher.publishToUser).toHaveBeenCalledWith('user-b', 'friend.request.created', { requestId: 'request-1' });
  });

  it('cancels pending requests in both directions when blocking', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-b', accountStatus: 'ACTIVE', deletionRequestedAt: null }) },
      blockedUser: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({}) },
      friendship: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      friendRequest: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    const service = new FriendService(prisma as never, eventPublisher as never);
    await service.blockUser('user-a', 'user-b');
    expect(prisma.friendRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'cancelled' } }));
    expect(eventPublisher.publishToUser).toHaveBeenCalledWith('user-a', 'block.created', { userId: 'user-b' });
  });

  it('rejects requests to nonexistent users before creating social records', async () => {
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new FriendService(withTransaction(prisma, 1) as never, eventPublisher as never);
    await expect(service.sendFriendRequest('user-a', { receiverId: 'user-b' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marks a friend as viewable only when their active Companion is published with an asset pack', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        friend: {
          id: 'friend-published', username: 'published', friendCode: 'PUBLISHED', profile: null,
          activeNetworkCompanion: { published: true, visibility: 'friends_only', activeAssetPackId: 'pack-1' },
        },
      },
      {
        friend: {
          id: 'friend-draft', username: 'draft', friendCode: 'DRAFT123', profile: null,
          activeNetworkCompanion: { published: false, visibility: 'friends_only', activeAssetPackId: 'pack-2' },
        },
      },
    ]);
    const service = new FriendService({ friendship: { findMany } } as never, eventPublisher as never);

    await expect(service.getFriends('user-a')).resolves.toEqual([
      expect.objectContaining({ userId: 'friend-published', hasPublishedCompanion: true }),
      expect.objectContaining({ userId: 'friend-draft', hasPublishedCompanion: false }),
    ]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ friend: expect.objectContaining({ select: expect.objectContaining({ activeNetworkCompanion: expect.anything() }) }) }),
    }));
  });

  it('rejects an existing friendship and a duplicate directed pending request', async () => {
    const base = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-b', accountStatus: 'ACTIVE', deletionRequestedAt: null }) },
      blockedUser: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const existingFriendService = new FriendService(withTransaction({ ...base, friendship: { findFirst: jest.fn().mockResolvedValue({}) } }) as never, eventPublisher as never);
    await expect(existingFriendService.sendFriendRequest('user-a', { receiverId: 'user-b' })).rejects.toBeInstanceOf(ConflictException);
    const duplicateRequestService = new FriendService(withTransaction({
      ...base,
      friendship: { findFirst: jest.fn().mockResolvedValue(null) },
      friendRequest: { findUnique: jest.fn().mockResolvedValueOnce({ id: 'request-1', status: 'pending' }).mockResolvedValueOnce(null) },
    }) as never, eventPublisher as never);
    await expect(duplicateRequestService.sendFriendRequest('user-a', { receiverId: 'user-b' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('allows only the request receiver to accept and maps a parallel uniqueness conflict', async () => {
    const request = { id: 'request-1', senderId: 'user-a', receiverId: 'user-b', status: 'pending' };
    const forbidden = new FriendService({ friendRequest: { findUnique: jest.fn().mockResolvedValue(request) } } as never, eventPublisher as never);
    await expect(forbidden.acceptFriendRequest('user-a', request.id)).rejects.toBeInstanceOf(ForbiddenException);

    const prisma = {
      friendRequest: { findUnique: jest.fn().mockResolvedValue(request), update: jest.fn() },
      friendship: { create: jest.fn() },
      $transaction: jest.fn().mockRejectedValue({ code: 'P2002' }),
    };
    const service = new FriendService(prisma as never, eventPublisher as never);
    await expect(service.acceptFriendRequest('user-b', request.id)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FRIENDSHIP_ALREADY_EXISTS' }) });
  });

  it('does not accept an old request after either participant starts deletion', async () => {
    const request = {
      id: 'request-1',
      senderId: 'user-a',
      receiverId: 'user-b',
      status: 'pending',
    };
    const friendshipCreate = jest.fn();
    const tx = {
      $queryRaw: jest.fn(),
      user: { count: jest.fn().mockResolvedValue(1) },
      friendRequest: {
        findUnique: jest.fn().mockResolvedValue(request),
        update: jest.fn(),
      },
      friendship: { create: friendshipCreate },
    };
    const service = new FriendService({
      friendRequest: { findUnique: jest.fn().mockResolvedValue(request) },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) =>
        operation(tx)),
    } as never, eventPublisher as never);

    await expect(service.acceptFriendRequest('user-b', request.id))
      .rejects.toMatchObject({
        response: expect.objectContaining({ code: 'USER_NOT_FOUND' }),
      });
    expect(friendshipCreate).not.toHaveBeenCalled();
  });

  it('hides pending requests whose counterpart is no longer active', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new FriendService({
      friendRequest: { findMany },
    } as never, eventPublisher as never);

    await service.getIncomingRequests('user-b');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        receiverId: 'user-b',
        status: 'pending',
        sender: {
          accountStatus: 'ACTIVE',
          deletionRequestedAt: null,
        },
      },
    }));
  });

  it('allows only the sender to cancel a pending request', async () => {
    const request = { id: 'request-1', senderId: 'user-a', receiverId: 'user-b', status: 'pending' };
    const service = new FriendService({ friendRequest: { findUnique: jest.fn().mockResolvedValue(request) } } as never, eventPublisher as never);
    await expect(service.cancelFriendRequest('user-b', request.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
