import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateDiscoveryDto } from './dto/create-discovery.dto';

@Injectable()
export class CommunityService {
  constructor(private prisma: PrismaService) {}

  async getPublicProfile(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            createdAt: true,
          },
        },
      },
    });

    if (!profile || !profile.isPublic) {
      throw new NotFoundException('Public profile not found');
    }

    return {
      id: profile.user.id,
      username: profile.user.username,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      bio: profile.bio,
      createdAt: profile.user.createdAt,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const profile = await this.prisma.profile.upsert({
      where: { userId },
      update: {
        displayName: dto.displayName,
        avatarUrl: dto.avatarUrl,
        bio: dto.bio,
        isPublic: dto.isPublic,
      },
      create: {
        userId,
        displayName: dto.displayName,
        avatarUrl: dto.avatarUrl,
        bio: dto.bio,
        isPublic: dto.isPublic ?? false,
      },
    });

    return profile;
  }

  async createDiscovery(userId: string, dto: CreateDiscoveryDto) {
    const discovery = await this.prisma.discovery.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        metadata: dto.metadata,
      },
      include: {
        user: {
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

    return discovery;
  }

  async getPublicDiscoveries(page = 1, limit = 20) {
    const skip = (page - 1) * limit;

    const discoveries = await this.prisma.discovery.findMany({
      where: {
        user: {
          profile: {
            isPublic: true,
          },
        },
      },
      include: {
        user: {
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
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });

    const total = await this.prisma.discovery.count({
      where: {
        user: {
          profile: {
            isPublic: true,
          },
        },
      },
    });

    return {
      discoveries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getUserDiscoveries(userId: string) {
    const discoveries = await this.prisma.discovery.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return discoveries;
  }

  async deleteDiscovery(userId: string, discoveryId: string) {
    const discovery = await this.prisma.discovery.findUnique({
      where: { id: discoveryId },
    });

    if (!discovery) {
      throw new NotFoundException('Discovery not found');
    }

    if (discovery.userId !== userId) {
      throw new NotFoundException('Discovery not found');
    }

    await this.prisma.discovery.delete({
      where: { id: discoveryId },
    });

    return { message: 'Discovery deleted' };
  }
}
