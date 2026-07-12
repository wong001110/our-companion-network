import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PresenceService {
  constructor(private prisma: PrismaService) {}

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
      },
    });

    return presence || { status: 'offline', lastSeenAt: null };
  }

  async getFriendsPresence(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: { userId },
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
      },
    });

    return presences;
  }

  async getOnlineFriends(userId: string) {
    const friendships = await this.prisma.friendship.findMany({
      where: { userId },
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
