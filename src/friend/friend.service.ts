import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FriendRequestDto } from './dto/friend-request.dto';
import { SocialEventPublisher } from '../common/social-event-publisher.service';

@Injectable()
export class FriendService {
  constructor(private prisma: PrismaService, private readonly events: SocialEventPublisher) {}

  async lookupByFriendCode(code: string, requesterId?: string) {
    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(normalizedCode)) {
      throw new NotFoundException({ code: 'INVALID_FRIEND_CODE', message: 'Friend code was not found' });
    }
    const user = await this.prisma.user.findUnique({
      where: { friendCode: normalizedCode },
      select: {
        id: true,
        username: true,
        friendCode: true,
      },
    });

    if (!user) {
      throw new NotFoundException({ code: 'INVALID_FRIEND_CODE', message: 'Friend code was not found' });
    }
    if (!requesterId || requesterId === user.id) return { ...user, relationship: 'none' };
    const [friendship, outgoing, incoming, blocked] = await Promise.all([
      this.prisma.friendship.findUnique({ where: { userId_friendId: { userId: requesterId, friendId: user.id } } }),
      this.prisma.friendRequest.findUnique({ where: { senderId_receiverId: { senderId: requesterId, receiverId: user.id } } }),
      this.prisma.friendRequest.findUnique({ where: { senderId_receiverId: { senderId: user.id, receiverId: requesterId } } }),
      this.prisma.blockedUser.findFirst({ where: { OR: [{ blockerId: requesterId, blockedId: user.id }, { blockerId: user.id, blockedId: requesterId }] } }),
    ]);
    if (blocked) throw new NotFoundException({ code: 'INVALID_FRIEND_CODE', message: 'Friend code was not found' });
    const relationship = friendship ? 'friend' : outgoing?.status === 'pending' ? 'outgoing_request' : incoming?.status === 'pending' ? 'incoming_request' : 'none';
    return { ...user, relationship };
  }

  async sendFriendRequest(senderId: string, dto: FriendRequestDto) {
    if (senderId === dto.receiverId) {
      throw new ForbiddenException({ code: 'CANNOT_FRIEND_SELF', message: 'Social action is not allowed' });
    }

    const receiver = await this.prisma.user.findUnique({
      where: { id: dto.receiverId },
    });

    if (!receiver) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found' });
    }

    const existingFriendship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { userId: senderId, friendId: dto.receiverId },
          { userId: dto.receiverId, friendId: senderId },
        ],
      },
    });

    if (existingFriendship) {
      throw new ConflictException({ code: 'FRIENDSHIP_ALREADY_EXISTS', message: 'Friendship already exists' });
    }

    const blocked = await this.prisma.blockedUser.findFirst({
      where: {
        OR: [
          { blockerId: senderId, blockedId: dto.receiverId },
          { blockerId: dto.receiverId, blockedId: senderId },
        ],
      },
    });

    if (blocked) {
      throw new ForbiddenException({ code: 'SOCIAL_ACTION_NOT_ALLOWED', message: 'Social action is not allowed' });
    }

    const [direct, reverse] = await Promise.all([
      this.prisma.friendRequest.findUnique({ where: { senderId_receiverId: { senderId, receiverId: dto.receiverId } } }),
      this.prisma.friendRequest.findUnique({ where: { senderId_receiverId: { senderId: dto.receiverId, receiverId: senderId } } }),
    ]);
    if (reverse?.status === 'pending') return this.acceptFriendRequest(senderId, reverse.id);
    if (direct?.status === 'pending') throw new ConflictException({ code: 'FRIEND_REQUEST_ALREADY_EXISTS', message: 'Friend request already exists' });

    const request = await this.prisma.friendRequest.upsert({
      where: { senderId_receiverId: { senderId, receiverId: dto.receiverId } },
      create: { senderId, receiverId: dto.receiverId, status: 'pending' },
      update: { status: 'pending', updatedAt: new Date() },
      include: {
        sender: {
          select: { id: true, username: true },
        },
        receiver: {
          select: { id: true, username: true },
        },
      },
    });

    this.events.publishToUser(dto.receiverId, 'friend.request.created', { requestId: request.id });
    return request;
  }

  async getIncomingRequests(userId: string) {
    const requests = await this.prisma.friendRequest.findMany({
      where: {
        receiverId: userId,
        status: 'pending',
      },
      include: {
        sender: { select: { id: true, username: true, friendCode: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return requests;
  }

  async getOutgoingRequests(userId: string) {
    return this.prisma.friendRequest.findMany({
      where: { senderId: userId, status: 'pending' },
      include: { receiver: { select: { id: true, username: true, friendCode: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async acceptFriendRequest(userId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException({ code: 'FRIEND_REQUEST_NOT_FOUND', message: 'Friend request was not found' });
    }

    if (request.receiverId !== userId) {
      throw new ForbiddenException({ code: 'SOCIAL_ACTION_NOT_ALLOWED', message: 'Social action is not allowed' });
    }

    if (request.status !== 'pending') {
      throw new ConflictException({ code: 'FRIEND_REQUEST_NOT_PENDING', message: 'Friend request is not pending' });
    }

    try {
      await this.prisma.$transaction([
        this.prisma.friendRequest.update({
          where: { id: requestId },
          data: { status: 'accepted' },
        }),
        this.prisma.friendship.create({
          data: {
            userId: request.senderId,
            friendId: request.receiverId,
          },
        }),
        this.prisma.friendship.create({
          data: {
            userId: request.receiverId,
            friendId: request.senderId,
          },
        }),
      ]);
    } catch (error) {
      // A parallel acceptance can race after both requests observed pending. Keep the API stable.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException({ code: 'FRIENDSHIP_ALREADY_EXISTS', message: 'Friendship already exists' });
      }
      throw error;
    }

    this.events.publishToUser(request.senderId, 'friend.request.updated', { requestId, status: 'accepted' });
    this.events.publishToUser(request.receiverId, 'friend.request.updated', { requestId, status: 'accepted' });
    this.events.publishToUser(request.senderId, 'friendship.created', { userId: request.receiverId });
    this.events.publishToUser(request.receiverId, 'friendship.created', { userId: request.senderId });
    return { message: 'Friend request accepted' };
  }

  async rejectFriendRequest(userId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException({ code: 'FRIEND_REQUEST_NOT_FOUND', message: 'Friend request was not found' });
    }

    if (request.receiverId !== userId) {
      throw new ForbiddenException({ code: 'SOCIAL_ACTION_NOT_ALLOWED', message: 'Social action is not allowed' });
    }

    if (request.status !== 'pending') {
      throw new ConflictException({ code: 'FRIEND_REQUEST_NOT_PENDING', message: 'Friend request is not pending' });
    }

    await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: 'rejected' },
    });

    this.events.publishToUser(request.senderId, 'friend.request.updated', { requestId, status: 'rejected' });
    this.events.publishToUser(request.receiverId, 'friend.request.updated', { requestId, status: 'rejected' });
    return { message: 'Friend request rejected' };
  }

  async cancelFriendRequest(userId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException({ code: 'FRIEND_REQUEST_NOT_FOUND', message: 'Friend request was not found' });
    if (request.senderId !== userId || request.status !== 'pending') throw new ForbiddenException({ code: 'SOCIAL_ACTION_NOT_ALLOWED', message: 'Social action is not allowed' });
    await this.prisma.friendRequest.update({ where: { id: requestId }, data: { status: 'cancelled' } });
    this.events.publishToUser(request.receiverId, 'friend.request.updated', { requestId, status: 'cancelled' });
    return { message: 'Friend request cancelled' };
  }

  async getFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: { userId },
      include: {
        friend: {
          select: {
            id: true,
            username: true,
            friendCode: true,
            profile: {
              select: {
                displayName: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    return friendships.map((f) => ({ ...f.friend, userId: f.friend.id }));
  }

  async removeFriend(userId: string, friendId: string) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        userId,
        friendId,
      },
    });

    if (!friendship) {
      throw new NotFoundException({ code: 'FRIENDSHIP_NOT_FOUND', message: 'Friendship was not found' });
    }

    await this.prisma.$transaction([
      this.prisma.friendship.deleteMany({
        where: {
          OR: [
            { userId, friendId },
            { userId: friendId, friendId: userId },
          ],
        },
      }),
    ]);

    this.events.publishToUser(userId, 'friendship.removed', { userId: friendId });
    this.events.publishToUser(friendId, 'friendship.removed', { userId });
    return { message: 'Friend removed' };
  }

  async blockUser(userId: string, blockedId: string) {
    if (userId === blockedId) {
      throw new ForbiddenException({ code: 'SOCIAL_ACTION_NOT_ALLOWED', message: 'Social action is not allowed' });
    }

    const target = await this.prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!target) throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found' });

    const blocked = await this.prisma.blockedUser.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId: userId,
          blockedId,
        },
      },
    });

    if (blocked) {
      throw new ConflictException({ code: 'SOCIAL_ACTION_NOT_ALLOWED', message: 'Social action is not allowed' });
    }

    await this.prisma.$transaction([
      this.prisma.blockedUser.create({
        data: {
          blockerId: userId,
          blockedId,
        },
      }),
      this.prisma.friendship.deleteMany({
        where: {
          OR: [
            { userId, friendId: blockedId },
            { userId: blockedId, friendId: userId },
          ],
        },
      }),
      this.prisma.friendRequest.updateMany({
        where: { status: 'pending', OR: [{ senderId: userId, receiverId: blockedId }, { senderId: blockedId, receiverId: userId }] },
        data: { status: 'cancelled' },
      }),
    ]);

    this.events.publishToUser(userId, 'block.created', { userId: blockedId });
    this.events.publishToUser(blockedId, 'friendship.removed', { userId });
    return { message: 'User blocked' };
  }

  async unblockUser(userId: string, blockedId: string) {
    const blocked = await this.prisma.blockedUser.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId: userId,
          blockedId,
        },
      },
    });

    if (!blocked) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'Blocked user was not found' });
    }

    await this.prisma.blockedUser.delete({
      where: {
        blockerId_blockedId: {
          blockerId: userId,
          blockedId,
        },
      },
    });

    this.events.publishToUser(userId, 'block.removed', { userId: blockedId });
    return { message: 'User unblocked' };
  }

  async getBlockedUsers(userId: string) {
    const records = await this.prisma.blockedUser.findMany({
      where: { blockerId: userId },
      include: { blocked: { select: { id: true, username: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => ({ userId: record.blocked.id, username: record.blocked.username, blockedAt: record.createdAt }));
  }
}
