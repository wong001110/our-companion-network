import { ConflictException, ForbiddenException } from '@nestjs/common';
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
});
