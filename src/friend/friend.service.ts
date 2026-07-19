import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FriendRequestDto } from './dto/friend-request.dto';
import { SocialEventPublisher } from '../common/social-event-publisher.service';
import { VisitService } from '../visit/visit.service';

@Injectable()
export class FriendService {
  private readonly logger = new Logger(FriendService.name);

  constructor(
    private prisma: PrismaService,
    private readonly events: SocialEventPublisher,
    @Optional() private readonly visits?: VisitService,
  ) {}

  async lookupByUid(uid: string, requesterId?: string) {
    const normalizedUid = uid.trim().toUpperCase();
    if (!/^OC-[A-Z0-9]{8}$/.test(normalizedUid)) {
      throw new NotFoundException({ code: 'SOCIAL_UID_NOT_FOUND', message: 'UID was not found' });
    }
    const user = await this.prisma.user.findUnique({
      where: { uid: normalizedUid },
      select: {
        id: true,
        uid: true,
        username: true,
        friendCode: true,
        accountStatus: true,
        deletionRequestedAt: true,
      },
    });
    if (
      !user
      || user.accountStatus !== 'ACTIVE'
      || user.deletionRequestedAt
    ) {
      throw new NotFoundException({ code: 'SOCIAL_UID_NOT_FOUND', message: 'UID was not found' });
    }
    const {
      accountStatus: _accountStatus,
      deletionRequestedAt: _deletionRequestedAt,
      ...safeUser
    } = user;
    this.logger.log(JSON.stringify({
      event: 'social-uid:lookup',
      requesterId: requesterId ?? null,
      resolvedUserId: user.id,
      uid: normalizedUid,
    }));
    return this.withRelationship(safeUser, requesterId, 'SOCIAL_UID_NOT_FOUND');
  }

  async lookupByFriendCode(code: string, requesterId?: string) {
    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(normalizedCode)) {
      throw new NotFoundException({ code: 'INVALID_FRIEND_CODE', message: 'Friend code was not found' });
    }
    const user = await this.prisma.user.findUnique({
      where: { friendCode: normalizedCode },
      select: {
        id: true,
        uid: true,
        username: true,
        friendCode: true,
        accountStatus: true,
        deletionRequestedAt: true,
      },
    });

    if (
      !user
      || user.accountStatus !== 'ACTIVE'
      || user.deletionRequestedAt
    ) {
      throw new NotFoundException({ code: 'INVALID_FRIEND_CODE', message: 'Friend code was not found' });
    }
    const {
      accountStatus: _accountStatus,
      deletionRequestedAt: _deletionRequestedAt,
      ...safeUser
    } = user;
    return this.withRelationship(safeUser, requesterId, 'INVALID_FRIEND_CODE');
  }

  private async withRelationship<T extends { id: string }>(
    user: T,
    requesterId: string | undefined,
    notFoundCode: 'SOCIAL_UID_NOT_FOUND' | 'INVALID_FRIEND_CODE',
  ) {
    if (!requesterId || requesterId === user.id) return { ...user, relationship: 'none' };
    const [friendship, outgoing, incoming, blocked] = await Promise.all([
      this.prisma.friendship.findUnique({ where: { userId_friendId: { userId: requesterId, friendId: user.id } } }),
      this.prisma.friendRequest.findUnique({ where: { senderId_receiverId: { senderId: requesterId, receiverId: user.id } } }),
      this.prisma.friendRequest.findUnique({ where: { senderId_receiverId: { senderId: user.id, receiverId: requesterId } } }),
      this.prisma.blockedUser.findFirst({ where: { OR: [{ blockerId: requesterId, blockedId: user.id }, { blockerId: user.id, blockedId: requesterId }] } }),
    ]);
    if (blocked) throw new NotFoundException({
      code: notFoundCode,
      message: notFoundCode === 'SOCIAL_UID_NOT_FOUND' ? 'UID was not found' : 'Friend code was not found',
    });
    const relationship = friendship ? 'friend' : outgoing?.status === 'pending' ? 'outgoing_request' : incoming?.status === 'pending' ? 'incoming_request' : 'none';
    return { ...user, relationship };
  }

  async sendFriendRequest(senderId: string, dto: FriendRequestDto) {
    if (senderId === dto.receiverId) {
      throw new ForbiddenException({ code: 'CANNOT_FRIEND_SELF', message: 'Social action is not allowed' });
    }

    const result = await this.prisma.$transaction(async tx => {
      await this.lockActiveParticipants(tx, senderId, dto.receiverId);
      const existingFriendship = await tx.friendship.findFirst({
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

      const blocked = await tx.blockedUser.findFirst({
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
        tx.friendRequest.findUnique({ where: { senderId_receiverId: { senderId, receiverId: dto.receiverId } } }),
        tx.friendRequest.findUnique({ where: { senderId_receiverId: { senderId: dto.receiverId, receiverId: senderId } } }),
      ]);
      if (reverse?.status === 'pending') {
        return {
          accepted: true as const,
          request: await this.acceptFriendRequestInTransaction(
            tx,
            senderId,
            reverse.id,
          ),
        };
      }
      if (direct?.status === 'pending') {
        throw new ConflictException({ code: 'FRIEND_REQUEST_ALREADY_EXISTS', message: 'Friend request already exists' });
      }
      return {
        accepted: false as const,
        request: await tx.friendRequest.upsert({
          where: { senderId_receiverId: { senderId, receiverId: dto.receiverId } },
          create: { senderId, receiverId: dto.receiverId, status: 'pending' },
          update: { status: 'pending', updatedAt: new Date() },
          include: {
            sender: {
              select: { id: true, uid: true, username: true },
            },
            receiver: {
              select: { id: true, uid: true, username: true },
            },
          },
        }),
      };
    });

    if (result.accepted) {
      this.publishFriendRequestAccepted(result.request);
      return { message: 'Friend request accepted' };
    }
    this.events.publishToUser(dto.receiverId, 'friend.request.created', {
      requestId: result.request.id,
    });
    return result.request;
  }

  async getIncomingRequests(userId: string) {
    const requests = await this.prisma.friendRequest.findMany({
      where: {
        receiverId: userId,
        status: 'pending',
        sender: {
          accountStatus: 'ACTIVE',
          deletionRequestedAt: null,
        },
      },
      include: {
        sender: { select: { id: true, uid: true, username: true, friendCode: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return requests;
  }

  async getOutgoingRequests(userId: string) {
    return this.prisma.friendRequest.findMany({
      where: {
        senderId: userId,
        status: 'pending',
        receiver: {
          accountStatus: 'ACTIVE',
          deletionRequestedAt: null,
        },
      },
      include: { receiver: { select: { id: true, uid: true, username: true, friendCode: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async acceptFriendRequest(userId: string, requestId: string) {
    const initial = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
    });
    if (!initial) {
      throw new NotFoundException({ code: 'FRIEND_REQUEST_NOT_FOUND', message: 'Friend request was not found' });
    }
    if (initial.receiverId !== userId) {
      throw new ForbiddenException({ code: 'SOCIAL_ACTION_NOT_ALLOWED', message: 'Social action is not allowed' });
    }
    let request: {
      id: string;
      senderId: string;
      receiverId: string;
      status: string;
    };
    try {
      request = await this.prisma.$transaction(async tx => {
        await this.lockActiveParticipants(
          tx,
          initial.senderId,
          initial.receiverId,
        );
        return this.acceptFriendRequestInTransaction(tx, userId, requestId);
      });
    } catch (error) {
      // A parallel acceptance can race after both requests observed pending. Keep the API stable.
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException({ code: 'FRIENDSHIP_ALREADY_EXISTS', message: 'Friendship already exists' });
      }
      throw error;
    }

    this.publishFriendRequestAccepted(request);
    return { message: 'Friend request accepted' };
  }

  private async lockActiveParticipants(
    tx: any,
    firstUserId: string,
    secondUserId: string,
  ): Promise<void> {
    const participantIds = [firstUserId, secondUserId].sort();
    await tx.$queryRaw`
      SELECT "id"
      FROM "User"
      WHERE "id" IN (${participantIds[0]}, ${participantIds[1]})
      ORDER BY "id"
      FOR UPDATE
    `;
    const activeParticipants = await tx.user.count({
      where: {
        id: { in: participantIds },
        accountStatus: 'ACTIVE',
        deletionRequestedAt: null,
      },
    });
    if (activeParticipants !== 2) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User was not found',
      });
    }
  }

  private async acceptFriendRequestInTransaction(
    tx: any,
    receiverId: string,
    requestId: string,
  ) {
    await tx.$queryRaw`
      SELECT "id"
      FROM "FriendRequest"
      WHERE "id" = ${requestId}
      FOR UPDATE
    `;
    const request = await tx.friendRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException({
        code: 'FRIEND_REQUEST_NOT_FOUND',
        message: 'Friend request was not found',
      });
    }
    if (request.receiverId !== receiverId) {
      throw new ForbiddenException({
        code: 'SOCIAL_ACTION_NOT_ALLOWED',
        message: 'Social action is not allowed',
      });
    }
    if (request.status !== 'pending') {
      throw new ConflictException({
        code: 'FRIEND_REQUEST_NOT_PENDING',
        message: 'Friend request is not pending',
      });
    }
    await tx.friendRequest.update({
      where: { id: requestId },
      data: { status: 'accepted' },
    });
    await tx.friendship.create({
      data: { userId: request.senderId, friendId: request.receiverId },
    });
    await tx.friendship.create({
      data: { userId: request.receiverId, friendId: request.senderId },
    });
    return request;
  }

  private publishFriendRequestAccepted(request: {
    id: string;
    senderId: string;
    receiverId: string;
  }) {
    this.events.publishToUser(request.senderId, 'friend.request.updated', {
      requestId: request.id,
      status: 'accepted',
    });
    this.events.publishToUser(request.receiverId, 'friend.request.updated', {
      requestId: request.id,
      status: 'accepted',
    });
    this.events.publishToUser(request.senderId, 'friendship.created', {
      userId: request.receiverId,
    });
    this.events.publishToUser(request.receiverId, 'friendship.created', {
      userId: request.senderId,
    });
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
      where: { userId, friend: { accountStatus: 'ACTIVE' } },
      include: {
        friend: {
          select: {
            id: true,
            uid: true,
            username: true,
            friendCode: true,
            activeNetworkCompanion: {
              select: {
                published: true,
                visibility: true,
                activeAssetPackId: true,
              },
            },
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

    return friendships.map(({ friend }) => {
      const companion = friend.activeNetworkCompanion;
      return {
        id: friend.id,
        uid: friend.uid,
        username: friend.username,
        friendCode: friend.friendCode,
        profile: friend.profile,
        userId: friend.id,
        // This is intentionally only a boolean: the friend must still pass the
        // authorization check when their Companion is opened.
        hasPublishedCompanion: Boolean(
          companion?.published
          && companion.visibility === 'friends_only'
          && companion.activeAssetPackId,
        ),
      };
    });
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

    await this.visits?.endSessionsBetween(userId, friendId, 'friendship_removed');
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

    await this.visits?.endSessionsBetween(userId, blockedId, 'user_blocked');
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
      include: { blocked: { select: { id: true, uid: true, username: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return records.map((record) => ({ userId: record.blocked.id, uid: record.blocked.uid, username: record.blocked.username, blockedAt: record.createdAt }));
  }
}
