import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PresenceService implements OnModuleInit {
  constructor(private prisma: PrismaService) {}

  /** Single-instance MVP Presence recovery. Horizontal scaling needs a shared lease/coordinator. */
  async onModuleInit(): Promise<void> {
    await this.prisma.presence.updateMany({
      where: { status: { in: ['online', 'idle'] } },
      data: { status: 'offline', lastSeenAt: new Date() },
    });
  }

  async setOnline(userId: string) {
    const presence = await this.prisma.presence.upsert({
      where: { userId },
      update: {
        status: 'online',
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        status: 'online',
      },
    });

    return presence;
  }

  async setOffline(userId: string) {
    const presence = await this.prisma.presence.upsert({
      where: { userId },
      update: {
        status: 'offline',
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        status: 'offline',
      },
    });

    return presence;
  }

  async setIdle(userId: string) {
    const presence = await this.prisma.presence.upsert({
      where: { userId },
      update: {
        status: 'idle',
        lastSeenAt: new Date(),
      },
      create: {
        userId,
        status: 'idle',
      },
    });

    return presence;
  }

  async getPresence(userId: string) {
    const presence = await this.prisma.presence.findUnique({
      where: { userId },
      select: {
        status: true,
        lastSeenAt: true,
        updatedAt: true,
      },
    });

    return presence
      ? { status: presence.status, updatedAt: presence.updatedAt.toISOString() }
      : { status: 'offline', updatedAt: null };
  }

  async getFriendsPresence(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        userId,
        user: { accountStatus: 'ACTIVE', deletionRequestedAt: null },
        friend: { accountStatus: 'ACTIVE', deletionRequestedAt: null },
      },
      select: { friendId: true },
    });

    const friendIds = friendships.map((f) => f.friendId);

    const presences = await this.prisma.presence.findMany({
      where: {
        userId: { in: friendIds },
      },
      select: {
        userId: true,
        status: true,
        lastSeenAt: true,
        updatedAt: true,
      },
    });

    const byUser = new Map(presences.map((presence) => [presence.userId, presence]));
    return friendIds.map((friendId) => {
      const presence = byUser.get(friendId);
      return {
        userId: friendId,
        status: presence?.status ?? 'offline',
        updatedAt: presence?.updatedAt?.toISOString() ?? presence?.lastSeenAt?.toISOString() ?? null,
      };
    });
  }

  async getFriendIds(userId: string): Promise<string[]> {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        userId,
        friend: { accountStatus: 'ACTIVE', deletionRequestedAt: null },
      },
      select: { friendId: true },
    });
    return friendships.map((friendship) => friendship.friendId);
  }

  async getOnlineFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: {
        userId,
        user: { accountStatus: 'ACTIVE', deletionRequestedAt: null },
        friend: { accountStatus: 'ACTIVE', deletionRequestedAt: null },
      },
      select: { friendId: true },
    });

    const friendIds = friendships.map((f) => f.friendId);

    const presences = await this.prisma.presence.findMany({
      where: {
        userId: { in: friendIds },
        status: 'online',
      },
      select: {
        userId: true,
        status: true,
        lastSeenAt: true,
      },
    });

    return presences;
  }
}
