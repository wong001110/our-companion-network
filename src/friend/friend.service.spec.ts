import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FriendService } from './friend.service';

describe('FriendService S2 rules', () => {
  const eventPublisher = { publishToUser: jest.fn() };

  beforeEach(() => eventPublisher.publishToUser.mockReset());

  it('rejects a request to oneself with the stable social code', async () => {
    const service = new FriendService({} as never, eventPublisher as never);
    await expect(service.sendFriendRequest('user-a', { receiverId: 'user-a' })).rejects.toMatchObject<Partial<ForbiddenException>>({});
  });

  it('reopens a terminal directed request so a rejected request can be resent', async () => {
    const request = { id: 'request-1', senderId: 'user-a', receiverId: 'user-b', status: 'pending', sender: { id: 'user-a', username: 'a' }, receiver: { id: 'user-b', username: 'b' } };
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-b' }) },
      friendship: { findFirst: jest.fn().mockResolvedValue(null) },
      blockedUser: { findFirst: jest.fn().mockResolvedValue(null) },
      friendRequest: {
        findUnique: jest.fn().mockResolvedValueOnce({ id: 'old', status: 'rejected' }).mockResolvedValueOnce(null),
        upsert: jest.fn().mockResolvedValue(request),
      },
    };
    const service = new FriendService(prisma as never, eventPublisher as never);
    await expect(service.sendFriendRequest('user-a', { receiverId: 'user-b' })).resolves.toEqual(request);
    expect(prisma.friendRequest.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ status: 'pending', updatedAt: expect.any(Date) }) }));
    expect(eventPublisher.publishToUser).toHaveBeenCalledWith('user-b', 'friend.request.created', { requestId: 'request-1' });
  });

  it('cancels pending requests in both directions when blocking', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-b' }) },
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
    const service = new FriendService(prisma as never, eventPublisher as never);
    await expect(service.sendFriendRequest('user-a', { receiverId: 'user-b' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects an existing friendship and a duplicate directed pending request', async () => {
    const base = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-b' }) },
      blockedUser: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const existingFriendService = new FriendService({ ...base, friendship: { findFirst: jest.fn().mockResolvedValue({}) } } as never, eventPublisher as never);
    await expect(existingFriendService.sendFriendRequest('user-a', { receiverId: 'user-b' })).rejects.toBeInstanceOf(ConflictException);
    const duplicateRequestService = new FriendService({
      ...base,
      friendship: { findFirst: jest.fn().mockResolvedValue(null) },
      friendRequest: { findUnique: jest.fn().mockResolvedValueOnce({ id: 'request-1', status: 'pending' }).mockResolvedValueOnce(null) },
    } as never, eventPublisher as never);
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

  it('allows only the sender to cancel a pending request', async () => {
    const request = { id: 'request-1', senderId: 'user-a', receiverId: 'user-b', status: 'pending' };
    const service = new FriendService({ friendRequest: { findUnique: jest.fn().mockResolvedValue(request) } } as never, eventPublisher as never);
    await expect(service.cancelFriendRequest('user-b', request.id)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
