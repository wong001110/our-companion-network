import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CompanionService } from '../companion/companion.service';
import { UpdateProfileDto } from '../community/dto/update-profile.dto';
import { ChangePasswordDto } from './dto/portal-auth.dto';
import {
  FriendRequestQueryDto,
  PortalListQueryDto,
  PortalVisitQueryDto,
} from './dto/portal-query.dto';
import { boundedPage, pageEnvelope, stableOrderBy } from '../common/pagination';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companions: CompanionService,
    private readonly storage: StorageService,
  ) {}

  async summary(userId: string) {
    const [
      user,
      friends,
      pendingRequests,
      recentVisits,
      unreadNotifications,
      activeDevices,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          presence: { select: { status: true, lastSeenAt: true } },
          activeNetworkCompanion: {
            select: {
              id: true,
              name: true,
              published: true,
              activeAssetPack: {
                select: { id: true, status: true, failureCode: true },
              },
            },
          },
        },
      }),
      this.prisma.friendship.count({ where: { userId } }),
      this.prisma.friendRequest.count({
        where: { receiverId: userId, status: 'pending' },
      }),
      this.prisma.visitSession.findMany({
        where: {
          OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
        },
        take: 5,
        orderBy: stableOrderBy('updatedAt'),
        select: {
          id: true,
          state: true,
          networkCompanion: { select: { name: true } },
          startedAt: true,
          endedAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.notification.count({ where: { userId, read: false } }),
      this.prisma.deviceSession.count({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    if (!user) throw new UnauthorizedException();
    return {
      presence: user.presence ?? { status: 'offline', lastSeenAt: null },
      friends,
      pendingRequests,
      publishedCompanion: user.activeNetworkCompanion ?? null,
      recentVisits,
      unreadNotifications,
      activeDevices,
    };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        uid: true,
        email: true,
        username: true,
        friendCode: true,
        role: true,
        createdAt: true,
        profile: true,
      },
    });
    if (!user) throw new UnauthorizedException();
    return user;
  }

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.profile.upsert({
      where: { userId },
      update: dto,
      create: {
        userId,
        ...dto,
        isPublic: dto.isPublic ?? false,
      },
    });
  }

  async listCompanions(userId: string, query: PortalListQueryDto) {
    requireStatus(query.status, ['published', 'unpublished']);
    const page = boundedPage(query);
    const where: Prisma.NetworkCompanionWhereInput = {
      ownerUserId: userId,
      ...dateWhere(query),
      ...(query.status ? { published: query.status === 'published' } : {}),
      ...(query.search ? {
        name: { contains: query.search.trim(), mode: 'insensitive' as const },
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.networkCompanion.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('updatedAt', query.direction),
        select: {
          id: true,
          name: true,
          publicDescription: true,
          publicTags: true,
          visibility: true,
          published: true,
          activeAssetPackId: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
          activeAssetPack: {
            select: {
              status: true,
              totalFiles: true,
              totalBytes: true,
              failureCode: true,
            },
          },
        },
      }),
      this.prisma.networkCompanion.count({ where }),
    ]);
    return pageEnvelope(items.map(normalizeBigInts), total, page);
  }

  async getCompanion(userId: string, companionId: string) {
    const companion = await this.prisma.networkCompanion.findFirst({
      where: { id: companionId, ownerUserId: userId },
      select: {
        id: true,
        name: true,
        publicDescription: true,
        publicTags: true,
        visibility: true,
        published: true,
        activeAssetPackId: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!companion) throw new NotFoundException('Companion not found');
    return companion;
  }

  async listAssetPacks(
    userId: string,
    companionId: string,
    query: PortalListQueryDto,
  ) {
    requireStatus(query.status, [
      'uploading', 'verifying', 'active', 'superseded', 'failed',
      'abandoning', 'abandoned', 'deleting',
    ]);
    await this.requireOwnedCompanion(userId, companionId);
    const page = boundedPage(query);
    const where: Prisma.CompanionAssetPackWhereInput = {
      companionId,
      ...dateWhere(query),
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? {
        OR: [
          { id: { contains: query.search.trim(), mode: 'insensitive' } },
          { manifestHash: { contains: query.search.trim(), mode: 'insensitive' } },
        ],
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.companionAssetPack.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('createdAt', query.direction),
        select: {
          id: true,
          companionId: true,
          manifestHash: true,
          schemaVersion: true,
          status: true,
          totalFiles: true,
          totalBytes: true,
          failureCode: true,
          createdAt: true,
          updatedAt: true,
          completedAt: true,
          activatedAt: true,
          supersededAt: true,
          _count: { select: { files: true } },
        },
      }),
      this.prisma.companionAssetPack.count({ where }),
    ]);
    return pageEnvelope(items.map(normalizeBigInts), total, page);
  }

  publishCompanion(userId: string, companionId: string) {
    return this.companions.publish(userId, companionId);
  }

  unpublishCompanion(userId: string, companionId: string) {
    return this.companions.unpublish(userId, companionId);
  }

  async listFriends(userId: string, query: PortalListQueryDto) {
    requireStatus(query.status, ['online', 'idle', 'offline', 'published']);
    const page = boundedPage(query);
    const where: Prisma.FriendshipWhereInput = {
      userId,
      ...dateWhere(query),
      ...((query.status || query.search) ? {
        friend: {
          ...(query.status && query.status !== 'published'
            ? { presence: { status: query.status } }
            : {}),
          ...(query.status === 'published' ? {
          activeNetworkCompanion: {
            is: {
              published: true,
              visibility: 'friends_only',
              activeAssetPackId: { not: null },
            },
          },
          } : {}),
          ...(query.search ? { OR: [
            { uid: { contains: query.search, mode: 'insensitive' as const } },
            { username: { contains: query.search, mode: 'insensitive' as const } },
            { profile: { displayName: { contains: query.search, mode: 'insensitive' as const } } },
          ] } : {}),
        },
      } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.friendship.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('createdAt', query.direction),
        select: {
          id: true,
          createdAt: true,
          friend: {
            select: {
              id: true,
              uid: true,
              username: true,
              friendCode: true,
              profile: { select: { displayName: true, avatarUrl: true } },
              presence: { select: { status: true, lastSeenAt: true } },
              activeNetworkCompanion: {
                select: {
                  published: true,
                  visibility: true,
                  activeAssetPackId: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.friendship.count({ where }),
    ]);
    const items = rows.map(({ friend, ...row }) => ({
      ...row,
      ...friend,
      hasPublishedCompanion: Boolean(
        friend.activeNetworkCompanion?.published
        && friend.activeNetworkCompanion.visibility === 'friends_only'
        && friend.activeNetworkCompanion.activeAssetPackId,
      ),
      activeNetworkCompanion: undefined,
    }));
    return pageEnvelope(items, total, page);
  }

  async listFriendRequests(userId: string, query: FriendRequestQueryDto) {
    requireStatus(query.status, [
      'pending', 'accepted', 'rejected', 'cancelled',
    ]);
    const page = boundedPage(query);
    const incoming = query.direction === 'incoming';
    const where: Prisma.FriendRequestWhereInput = {
      ...(incoming ? { receiverId: userId } : { senderId: userId }),
      ...(query.status ? { status: query.status } : {}),
      ...dateWhere(query),
    };
    const relation = {
      select: {
        id: true,
        uid: true,
        username: true,
        profile: { select: { displayName: true, avatarUrl: true } },
      },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.friendRequest.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('updatedAt', query.sortDirection),
        select: {
          id: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          ...(incoming ? { sender: relation } : { receiver: relation }),
        },
      }),
      this.prisma.friendRequest.count({ where }),
    ]);
    return pageEnvelope(items, total, page);
  }

  async listBlocks(userId: string, query: PortalListQueryDto) {
    const page = boundedPage(query);
    const where: Prisma.BlockedUserWhereInput = {
      blockerId: userId,
      ...dateWhere(query),
      ...(query.search ? {
        blocked: {
          OR: [
            { uid: { contains: query.search.trim(), mode: 'insensitive' } },
            { username: { contains: query.search.trim(), mode: 'insensitive' } },
          ],
        },
      } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.blockedUser.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('createdAt', query.direction),
        select: {
          id: true,
          createdAt: true,
          blocked: { select: { id: true, uid: true, username: true } },
        },
      }),
      this.prisma.blockedUser.count({ where }),
    ]);
    return pageEnvelope(rows.map(({ blocked, ...row }) => ({
      ...row,
      user: blocked,
    })), total, page);
  }

  async listVisits(userId: string, query: PortalVisitQueryDto) {
    requireStatus(
      query.status,
      query.kind === 'invitations'
        ? ['pending', 'accepted', 'declined', 'cancelled', 'expired']
        : ['preparing', 'ready', 'active', 'ending', 'ended', 'cancelled', 'failed'],
    );
    const page = boundedPage(query);
    if (query.kind === 'invitations') {
      const where: Prisma.VisitInvitationWhereInput = {
        OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
        ...(query.status ? { status: query.status } : {}),
        ...dateWhere(query),
        ...(query.search ? {
          AND: [{
            OR: [
              { id: { contains: query.search.trim(), mode: 'insensitive' } },
              { companionName: { contains: query.search.trim(), mode: 'insensitive' } },
              { visitorOwnerUserId: { contains: query.search.trim(), mode: 'insensitive' } },
              { hostUserId: { contains: query.search.trim(), mode: 'insensitive' } },
            ],
          }],
        } : {}),
      };
      const [items, total] = await this.prisma.$transaction([
        this.prisma.visitInvitation.findMany({
          where,
          skip: page.skip,
          take: page.take,
          orderBy: stableOrderBy('updatedAt', query.direction),
          select: PORTAL_INVITATION_SELECT,
        }),
        this.prisma.visitInvitation.count({ where }),
      ]);
      return pageEnvelope(items, total, page);
    }
    const where: Prisma.VisitSessionWhereInput = {
      OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
      ...(query.status ? { state: query.status } : {}),
      ...dateWhere(query),
      ...(query.search ? {
        AND: [{
          OR: [
            { id: { contains: query.search.trim(), mode: 'insensitive' } },
            { invitationId: { contains: query.search.trim(), mode: 'insensitive' } },
            { visitorOwnerUserId: { contains: query.search.trim(), mode: 'insensitive' } },
            { hostUserId: { contains: query.search.trim(), mode: 'insensitive' } },
            {
              networkCompanion: {
                name: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
            },
          ],
        }],
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.visitSession.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('updatedAt', query.direction),
        select: PORTAL_SESSION_SELECT,
      }),
      this.prisma.visitSession.count({ where }),
    ]);
    return pageEnvelope(items.map(withDuration), total, page);
  }

  async getVisit(userId: string, id: string) {
    const session = await this.prisma.visitSession.findFirst({
      where: {
        id,
        OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
      },
      select: PORTAL_SESSION_SELECT,
    });
    if (session) return { kind: 'session', ...withDuration(session) };
    const invitation = await this.prisma.visitInvitation.findFirst({
      where: {
        id,
        OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
      },
      select: PORTAL_INVITATION_SELECT,
    });
    if (invitation) return { kind: 'invitation', ...invitation };
    throw new NotFoundException('Visit not found');
  }

  async listDevices(userId: string, query: PortalListQueryDto) {
    requireStatus(query.status, ['active', 'revoked', 'expired']);
    const page = boundedPage(query);
    const now = new Date();
    const where: Prisma.DeviceSessionWhereInput = {
      userId,
      ...dateWhere(query),
      ...(query.search ? {
        deviceId: { contains: query.search.trim(), mode: 'insensitive' },
      } : {}),
      ...(query.status === 'active' ? {
        revokedAt: null,
        expiresAt: { gt: now },
      } : {}),
      ...(query.status === 'revoked' ? { revokedAt: { not: null } } : {}),
      ...(query.status === 'expired' ? {
        revokedAt: null,
        expiresAt: { lte: now },
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.deviceSession.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('lastUsedAt', query.direction),
        select: SAFE_DEVICE_SELECT,
      }),
      this.prisma.deviceSession.count({ where }),
    ]);
    return pageEnvelope(items, total, page);
  }

  async revokeDevice(userId: string, sessionId: string, currentDeviceId: string) {
    const session = await this.prisma.deviceSession.findFirst({
      where: { id: sessionId, userId },
      select: { id: true, deviceId: true },
    });
    if (!session) throw new NotFoundException('Device session not found');
    await this.prisma.deviceSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date(), csrfTokenHash: null },
    });
    return {
      revoked: true,
      revokedCurrent: session.deviceId === currentDeviceId,
    };
  }

  async revokeOtherDevices(userId: string, currentDeviceId: string) {
    const result = await this.prisma.deviceSession.updateMany({
      where: { userId, deviceId: { not: currentDeviceId }, revokedAt: null },
      data: { revokedAt: new Date(), csrfTokenHash: null },
    });
    return { revoked: result.count };
  }

  async changePassword(
    userId: string,
    currentDeviceId: string,
    dto: ChangePasswordDto,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true },
    });
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new ForbiddenException({
        code: 'CURRENT_PASSWORD_INVALID',
        message: 'Current password is invalid',
      });
    }
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new ConflictException({
        code: 'PASSWORD_UNCHANGED',
        message: 'New password must be different',
      });
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.deviceSession.updateMany({
        where: { userId, deviceId: { not: currentDeviceId }, revokedAt: null },
        data: { revokedAt: new Date(), csrfTokenHash: null },
      }),
    ]);
    return { changed: true, otherDevicesRevoked: true };
  }

  async dataExport(userId: string) {
    const exportLimit = 10_000;
    const [
      account,
      friends,
      friendRequests,
      blockedUsers,
      companions,
      visitInvitations,
      visitSessions,
      notifications,
      sharedDiscoveries,
      deviceSessions,
    ] = await this.prisma.$transaction([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          uid: true,
          email: true,
          username: true,
          friendCode: true,
          role: true,
          accountStatus: true,
          createdAt: true,
          updatedAt: true,
          profile: true,
          presence: true,
        },
      }),
      this.prisma.friendship.findMany({
        where: { userId },
        take: exportLimit,
        orderBy: stableOrderBy('createdAt'),
        select: {
          id: true,
          createdAt: true,
          friend: {
            select: {
              id: true,
              uid: true,
              username: true,
              friendCode: true,
            },
          },
        },
      }),
      this.prisma.friendRequest.findMany({
        where: { OR: [{ senderId: userId }, { receiverId: userId }] },
        take: exportLimit,
        orderBy: stableOrderBy('createdAt'),
        select: {
          id: true,
          senderId: true,
          receiverId: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.blockedUser.findMany({
        where: { blockerId: userId },
        take: exportLimit,
        orderBy: stableOrderBy('createdAt'),
        select: {
          id: true,
          blockedId: true,
          createdAt: true,
        },
      }),
      this.prisma.networkCompanion.findMany({
        where: { ownerUserId: userId },
        take: exportLimit,
        orderBy: stableOrderBy('createdAt'),
        select: {
          id: true,
          name: true,
          publicDescription: true,
          publicTags: true,
          visibility: true,
          published: true,
          activeAssetPackId: true,
          createdAt: true,
          updatedAt: true,
          publishedAt: true,
          assetPacks: {
            take: exportLimit,
            orderBy: stableOrderBy('createdAt'),
            select: {
              id: true,
              manifestHash: true,
              schemaVersion: true,
              manifest: true,
              status: true,
              totalFiles: true,
              totalBytes: true,
              failureCode: true,
              createdAt: true,
              updatedAt: true,
              completedAt: true,
              activatedAt: true,
              supersededAt: true,
              files: {
                take: exportLimit,
                orderBy: stableOrderBy('relativePath'),
                select: {
                  id: true,
                  relativePath: true,
                  mimeType: true,
                  sizeBytes: true,
                  sha256: true,
                  category: true,
                  uploaded: true,
                  verifiedAt: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.visitInvitation.findMany({
        where: {
          OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
        },
        take: exportLimit,
        orderBy: stableOrderBy('createdAt'),
        select: PORTAL_INVITATION_SELECT,
      }),
      this.prisma.visitSession.findMany({
        where: {
          OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
        },
        take: exportLimit,
        orderBy: stableOrderBy('createdAt'),
        select: PORTAL_SESSION_SELECT,
      }),
      this.prisma.notification.findMany({
        where: { userId },
        take: exportLimit,
        orderBy: stableOrderBy('createdAt'),
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          data: true,
          read: true,
          createdAt: true,
        },
      }),
      this.prisma.discovery.findMany({
        where: { userId },
        take: exportLimit,
        orderBy: stableOrderBy('createdAt'),
        select: {
          id: true,
          title: true,
          description: true,
          metadata: true,
          createdAt: true,
        },
      }),
      this.prisma.deviceSession.findMany({
        where: { userId },
        take: exportLimit,
        orderBy: stableOrderBy('createdAt'),
        select: SAFE_DEVICE_SELECT,
      }),
    ]);
    if (!account) throw new UnauthorizedException();
    return normalizeBigInts({
      generatedAt: new Date(),
      exportLimitPerCategory: exportLimit,
      account,
      friends,
      friendRequests,
      blockedUsers,
      companions,
      visitInvitations,
      visitSessions: visitSessions.map(withDuration),
      notifications,
      sharedDiscoveries,
      deviceSessions,
      neverStored: [
        'Local Chat',
        'Local Memory',
        'Local API Keys',
        'Local private Discovery',
        'Desktop activity history',
      ],
    });
  }

  async deleteNotifications(userId: string) {
    const result = await this.prisma.notification.deleteMany({
      where: { userId },
    });
    return { deleted: result.count };
  }

  async deleteSharedDiscoveries(userId: string) {
    const result = await this.prisma.discovery.deleteMany({
      where: { userId },
    });
    return { deleted: result.count };
  }

  async deleteSupersededAssetPacks(userId: string) {
    const before = new Date(
      Date.now()
      - this.storage.limits.supersededPackRetentionDays * 24 * 3_600_000,
    );
    const noLiveVisit = {
      visitInvitationRefs: {
        none: { status: 'pending', assetPackRefId: { not: null } },
      },
      visitSessionRefs: {
        none: {
          state: { in: ['preparing', 'ready', 'active', 'ending'] },
          assetPackRefId: { not: null },
        },
      },
    };
    const packs = await this.prisma.companionAssetPack.findMany({
      take: 100,
      where: {
        companion: { ownerUserId: userId },
        OR: [
          {
            status: 'superseded',
            supersededAt: { lt: before },
            ...noLiveVisit,
          },
          { status: 'deleting' },
        ],
      },
      include: { files: { select: { objectKey: true } } },
    });
    let deleted = 0;
    for (const pack of packs) {
      if (pack.status !== 'deleting') {
        const claim = await this.prisma.companionAssetPack.updateMany({
          where: {
            id: pack.id,
            companion: { ownerUserId: userId },
            status: 'superseded',
            supersededAt: { lt: before },
            ...noLiveVisit,
          },
          data: { status: 'deleting' },
        });
        if (claim.count !== 1) continue;
      }
      await this.storage.deleteObjects([
        ...pack.files.map((file) => file.objectKey),
        `${pack.objectPrefix}/manifest.json`,
      ]);
      await this.prisma.companionAssetPack.deleteMany({
        where: {
          id: pack.id,
          status: 'deleting',
          companion: { ownerUserId: userId },
        },
      });
      deleted += 1;
    }
    return { deleted };
  }

  async deleteAccount(userId: string) {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!account) throw new UnauthorizedException();
    if (account.role === 'SUPERADMIN') {
      throw new ForbiddenException({
        code: 'SUPERADMIN_SELF_DELETE_FORBIDDEN',
        message: 'Superadmin accounts must be demoted through the controlled CLI before deletion',
      });
    }

    const packs = await this.prisma.companionAssetPack.findMany({
      where: { companion: { ownerUserId: userId } },
      include: { files: { select: { objectKey: true } } },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      await tx.user.update({
        where: { id: userId },
        data: { activeNetworkCompanionId: null },
      });
      await tx.networkCompanion.updateMany({
        where: { ownerUserId: userId },
        data: {
          published: false,
          publishedAt: null,
          activeAssetPackId: null,
        },
      });
      await tx.companionAssetPack.updateMany({
        where: { companion: { ownerUserId: userId } },
        data: { status: 'deleting' },
      });
      await tx.deviceSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), csrfTokenHash: null },
      });
    });

    for (const pack of packs) {
      await this.storage.deleteObjects([
        ...pack.files.map((file) => file.objectKey),
        `${pack.objectPrefix}/manifest.json`,
      ]);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.visitSession.deleteMany({
        where: {
          OR: [
            { visitorOwnerUserId: userId },
            { hostUserId: userId },
            { networkCompanion: { ownerUserId: userId } },
          ],
        },
      });
      await tx.visitInvitation.deleteMany({
        where: {
          OR: [
            { visitorOwnerUserId: userId },
            { hostUserId: userId },
            { networkCompanion: { ownerUserId: userId } },
          ],
        },
      });
      await tx.user.delete({ where: { id: userId } });
    });
    return { deleted: true };
  }

  private async requireOwnedCompanion(userId: string, companionId: string) {
    const companion = await this.prisma.networkCompanion.findFirst({
      where: { id: companionId, ownerUserId: userId },
      select: { id: true },
    });
    if (!companion) throw new NotFoundException('Companion not found');
  }
}

const SAFE_DEVICE_SELECT = {
  id: true,
  deviceId: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
} as const;

const PORTAL_INVITATION_SELECT = {
  id: true,
  visitorOwnerUserId: true,
  hostUserId: true,
  networkCompanionId: true,
  assetPackSnapshotId: true,
  companionName: true,
  companionDescription: true,
  companionTags: true,
  status: true,
  expiresAt: true,
  respondedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const PORTAL_SESSION_SELECT = {
  id: true,
  invitationId: true,
  visitorOwnerUserId: true,
  hostUserId: true,
  networkCompanionId: true,
  assetPackSnapshotId: true,
  state: true,
  readyAt: true,
  startedAt: true,
  endedAt: true,
  endReason: true,
  failureCode: true,
  createdAt: true,
  updatedAt: true,
  networkCompanion: { select: { name: true } },
} as const;

function normalizeBigInts<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    typeof item === 'bigint'
      ? Number(item)
      : Array.isArray(item)
        ? item.map((entry) => entry && typeof entry === 'object'
          ? normalizeBigInts(entry)
          : entry)
        : item && typeof item === 'object' && !(item instanceof Date)
          ? normalizeBigInts(item)
          : item,
  ])) as T;
}

function withDuration<T extends { startedAt: Date | null; endedAt: Date | null }>(
  session: T,
) {
  return {
    ...session,
    durationSeconds: session.startedAt && session.endedAt
      ? Math.max(0, Math.round(
        (session.endedAt.getTime() - session.startedAt.getTime()) / 1000,
      ))
      : null,
  };
}

function requireStatus(value: string | undefined, allowed: string[]): void {
  if (value && !allowed.includes(value)) {
    throw new BadRequestException({
      code: 'STATUS_FILTER_INVALID',
      message: 'Status filter is invalid',
    });
  }
}

function dateWhere(query: {
  dateFrom?: string;
  dateTo?: string;
}): { createdAt?: { gte?: Date; lte?: Date } } {
  if (!query.dateFrom && !query.dateTo) return {};
  return {
    createdAt: {
      ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo ? { lte: endOfDate(query.dateTo) } : {}),
    },
  };
}

function endOfDate(value: string): Date {
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}
