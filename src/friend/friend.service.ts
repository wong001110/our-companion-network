import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FriendRequestDto } from './dto/friend-request.dto';

@Injectable()
export class FriendService {
  constructor(private prisma: PrismaService) {}

  async lookupByFriendCode(code: string) {
    const user = await this.prisma.user.findUnique({
      where: { friendCode: code },
      select: {
        id: true,
        username: true,
        friendCode: true,
        profile: {
          select: {
            displayName: true,
            avatarUrl: true,
            isPublic: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found with this friend code');
    }

    return user;
  }

  async sendFriendRequest(senderId: string, dto: FriendRequestDto) {
    if (senderId === dto.receiverId) {
      throw new ForbiddenException('Cannot send friend request to yourself');
    }

    const receiver = await this.prisma.user.findUnique({
      where: { id: dto.receiverId },
    });

    if (!receiver) {
      throw new NotFoundException('User not found');
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
      throw new ConflictException('Already friends with this user');
    }

    const existingRequest = await this.prisma.friendRequest.findFirst({
      where: {
        OR: [
          { senderId, receiverId: dto.receiverId, status: 'pending' },
          { senderId: dto.receiverId, receiverId: senderId, status: 'pending' },
        ],
      },
    });

    if (existingRequest) {
      throw new ConflictException('Friend request already pending');
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
      throw new ForbiddenException('Cannot send friend request to this user');
    }

    const request = await this.prisma.friendRequest.create({
      data: {
        senderId,
        receiverId: dto.receiverId,
      },
      include: {
        sender: {
          select: { id: true, username: true },
        },
        receiver: {
          select: { id: true, username: true },
        },
      },
    });

    return request;
  }

  async getPendingRequests(userId: string) {
    const requests = await this.prisma.friendRequest.findMany({
      where: {
        receiverId: userId,
        status: 'pending',
      },
      include: {
        sender: {
          select: { id: true, username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests;
  }

  async acceptFriendRequest(userId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.receiverId !== userId) {
      throw new ForbiddenException('Not authorized to accept this request');
    }

    if (request.status !== 'pending') {
      throw new ConflictException('Friend request already processed');
    }

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

    return { message: 'Friend request accepted' };
  }

  async rejectFriendRequest(userId: string, requestId: string) {
    const request = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new NotFoundException('Friend request not found');
    }

    if (request.receiverId !== userId) {
      throw new ForbiddenException('Not authorized to reject this request');
    }

    if (request.status !== 'pending') {
      throw new ConflictException('Friend request already processed');
    }

    await this.prisma.friendRequest.update({
      where: { id: requestId },
      data: { status: 'rejected' },
    });

    return { message: 'Friend request rejected' };
  }

  async getFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: { userId },
      include: {
        friend: {
          select: {
            id: true,
            username: true,
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

    return friendships.map((f) => f.friend);
  }

  async removeFriend(userId: string, friendId: string) {
    const friendship = await this.prisma.friendship.findFirst({
      where: {
        userId,
        friendId,
      },
    });

    if (!friendship) {
      throw new NotFoundException('Friendship not found');
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

    return { message: 'Friend removed' };
  }

  async blockUser(userId: string, blockedId: string) {
    if (userId === blockedId) {
      throw new ForbiddenException('Cannot block yourself');
    }

    const blocked = await this.prisma.blockedUser.findUnique({
      where: {
        blockerId_blockedId: {
          blockerId: userId,
          blockedId,
        },
      },
    });

    if (blocked) {
      throw new ConflictException('User already blocked');
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
    ]);

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
      throw new NotFoundException('User not blocked');
    }

    await this.prisma.blockedUser.delete({
      where: {
        blockerId_blockedId: {
          blockerId: userId,
          blockedId,
        },
      },
    });

    return { message: 'User unblocked' };
  }
}
