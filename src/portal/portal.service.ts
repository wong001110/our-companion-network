import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { Readable } from 'node:stream';
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
import { PresenceGateway } from '../presence/presence.gateway';
import { SocialEventPublisher } from '../common/social-event-publisher.service';

@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companions: CompanionService,
    private readonly storage: StorageService,
    @Optional() private readonly presence?: PresenceGateway,
    @Optional() private readonly events?: SocialEventPublisher,
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
          activeForUser: { select: { id: true } },
        },
      }),
      this.prisma.networkCompanion.count({ where }),
    ]);
    return pageEnvelope(items.map(({ activeForUser, ...companion }) =>
      normalizeBigInts({
        ...companion,
        isActive: Boolean(activeForUser),
      })), total, page);
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
        activeForUser: { select: { id: true } },
      },
    });
    if (!companion) throw new NotFoundException('Companion not found');
    const { activeForUser, ...profile } = companion;
    return { ...profile, isActive: Boolean(activeForUser) };
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
      friend: {
        accountStatus: 'ACTIVE',
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
      [incoming ? 'sender' : 'receiver']: {
        accountStatus: 'ACTIVE',
        deletionRequestedAt: null,
        ...(query.search ? {
          OR: [
            { id: { contains: query.search.trim(), mode: 'insensitive' } },
            { uid: { contains: query.search.trim(), mode: 'insensitive' } },
            { username: { contains: query.search.trim(), mode: 'insensitive' } },
            { profile: { displayName: { contains: query.search.trim(), mode: 'insensitive' } } },
          ],
        } : {}),
      },
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
    await this.presence?.disconnectDevice(userId, session.deviceId);
    return {
      revoked: true,
      revokedCurrent: session.deviceId === currentDeviceId,
    };
  }

  async revokeOtherDevices(userId: string, currentDeviceId: string) {
    const revokedAt = new Date();
    const result = await this.prisma.deviceSession.updateMany({
      where: { userId, deviceId: { not: currentDeviceId }, revokedAt: null },
      data: { revokedAt, csrfTokenHash: null },
    });
    const sessions = await this.prisma.deviceSession.findMany({
      where: {
        userId,
        deviceId: { not: currentDeviceId },
        revokedAt,
      },
      select: { deviceId: true },
    });
    await Promise.all(sessions.map((session) =>
      this.presence?.disconnectDevice(userId, session.deviceId)
        .catch(() => undefined)));
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
    const revokedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash },
      }),
      this.prisma.deviceSession.updateMany({
        where: { userId, deviceId: { not: currentDeviceId }, revokedAt: null },
        data: { revokedAt, csrfTokenHash: null },
      }),
    ]);
    const sessions = await this.prisma.deviceSession.findMany({
      where: {
        userId,
        deviceId: { not: currentDeviceId },
        revokedAt,
      },
      select: { deviceId: true },
    });
    await Promise.all(sessions.map((session) =>
      this.presence?.disconnectDevice(userId, session.deviceId)
        .catch(() => undefined)));
    return { changed: true, otherDevicesRevoked: true };
  }

  async dataExport(userId: string) {
    const account = await this.prisma.user.findUnique({
      where: { id: userId },
      select: EXPORT_ACCOUNT_SELECT,
    });
    if (!account) throw new UnauthorizedException();
    return Readable.from(this.generateDataExport(userId, account), {
      objectMode: false,
      highWaterMark: 16 * 1024,
    });
  }

  private async *generateDataExport(
    userId: string,
    account: Record<string, unknown>,
  ): AsyncGenerator<string> {
    yield `{"schemaVersion":2,"generatedAt":${safeExportJson(new Date())}`;
    yield `,"account":${safeExportJson(account)}`;
    yield ',"friends":';
    yield* this.streamExportArray((cursor) =>
      this.prisma.friendship.findMany({
        where: { userId },
        ...exportCursorPage(cursor),
        select: EXPORT_FRIENDSHIP_SELECT,
      }));
    yield ',"friendRequests":';
    yield* this.streamExportArray((cursor) =>
      this.prisma.friendRequest.findMany({
        where: { OR: [{ senderId: userId }, { receiverId: userId }] },
        ...exportCursorPage(cursor),
        select: EXPORT_FRIEND_REQUEST_SELECT,
      }));
    yield ',"blockedUsers":';
    yield* this.streamExportArray((cursor) =>
      this.prisma.blockedUser.findMany({
        where: { blockerId: userId },
        ...exportCursorPage(cursor),
        select: EXPORT_BLOCKED_USER_SELECT,
      }));
    yield ',"companions":';
    yield* this.streamExportCompanions(userId);
    yield ',"visitInvitations":';
    yield* this.streamExportArray((cursor) =>
      this.prisma.visitInvitation.findMany({
        where: {
          OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
        },
        ...exportCursorPage(cursor),
        select: PORTAL_INVITATION_SELECT,
      }));
    yield ',"visitSessions":';
    yield* this.streamExportArray(
      (cursor) => this.prisma.visitSession.findMany({
        where: {
          OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
        },
        ...exportCursorPage(cursor),
        select: PORTAL_SESSION_SELECT,
      }),
      withDuration,
    );
    yield ',"notifications":';
    yield* this.streamExportArray((cursor) =>
      this.prisma.notification.findMany({
        where: { userId },
        ...exportCursorPage(cursor),
        select: EXPORT_NOTIFICATION_SELECT,
      }));
    yield ',"sharedDiscoveries":';
    yield* this.streamExportArray((cursor) =>
      this.prisma.discovery.findMany({
        where: { userId },
        ...exportCursorPage(cursor),
        select: EXPORT_DISCOVERY_SELECT,
      }));
    yield ',"deviceSessions":';
    yield* this.streamExportArray((cursor) =>
      this.prisma.deviceSession.findMany({
        where: { userId },
        ...exportCursorPage(cursor),
        select: SAFE_DEVICE_SELECT,
      }));
    yield ',"neverStored":';
    yield safeExportJson([
      'Local Chat',
      'Local Memory',
      'Local API Keys',
      'Local private Discovery',
      'Desktop activity history',
    ]);
    yield ',"complete":true}';
  }

  private async *streamExportCompanions(userId: string): AsyncGenerator<string> {
    let first = true;
    yield '[';
    for await (const companion of this.exportRows((cursor) =>
      this.prisma.networkCompanion.findMany({
        where: { ownerUserId: userId },
        ...exportCursorPage(cursor),
        select: EXPORT_COMPANION_SELECT,
      }))) {
      if (!first) yield ',';
      first = false;
      yield `${safeExportJson(companion).slice(0, -1)},"assetPacks":`;
      yield* this.streamExportAssetPacks(companion.id);
      yield '}';
    }
    yield ']';
  }

  private async *streamExportAssetPacks(
    companionId: string,
  ): AsyncGenerator<string> {
    let first = true;
    yield '[';
    for await (const pack of this.exportRows((cursor) =>
      this.prisma.companionAssetPack.findMany({
        where: { companionId },
        ...exportCursorPage(cursor),
        select: EXPORT_ASSET_PACK_SELECT,
      }))) {
      if (!first) yield ',';
      first = false;
      yield `${safeExportJson(pack).slice(0, -1)},"files":`;
      yield* this.streamExportArray((cursor) =>
        this.prisma.companionAssetFile.findMany({
          where: { assetPackId: pack.id },
          ...exportCursorPage(cursor),
          select: EXPORT_ASSET_FILE_SELECT,
        }));
      yield '}';
    }
    yield ']';
  }

  private async *streamExportArray<T extends { id: string }>(
    fetchBatch: (cursor?: string) => Promise<T[]>,
    map: (item: T) => unknown = (item) => item,
  ): AsyncGenerator<string> {
    let first = true;
    yield '[';
    for await (const item of this.exportRows(fetchBatch)) {
      if (!first) yield ',';
      first = false;
      yield safeExportJson(map(item));
    }
    yield ']';
  }

  private async *exportRows<T extends { id: string }>(
    fetchBatch: (cursor?: string) => Promise<T[]>,
  ): AsyncGenerator<T> {
    let cursor: string | undefined;
    do {
      const batch = await fetchBatch(cursor);
      for (const item of batch) yield item;
      if (batch.length < EXPORT_BATCH_SIZE) return;
      cursor = batch[batch.length - 1]?.id;
      if (!cursor) return;
    } while (cursor);
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
          data: { status: 'deleting', failureCode: null },
        });
        if (claim.count !== 1) continue;
      }
      try {
        await this.storage.deleteObjects([
          ...pack.files.map((file) => file.objectKey),
          `${pack.objectPrefix}/manifest.json`,
        ]);
        await this.storage.assertObjectPrefixDeleted(pack.objectPrefix);
      } catch (error) {
        await this.prisma.companionAssetPack.updateMany({
          where: { id: pack.id, status: 'deleting', companion: { ownerUserId: userId } },
          data: { failureCode: 'ASSET_CLEANUP_FAILED' },
        }).catch(() => undefined);
        throw error;
      }
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
    const requestedAt = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const account = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          deletionRequestedAt: true,
          suspendedAt: true,
        },
      });
      if (!account) throw new UnauthorizedException();
      if (account.role === 'SUPERADMIN') {
        throw new ForbiddenException({
          code: 'SUPERADMIN_SELF_DELETE_FORBIDDEN',
          message: 'Superadmin accounts must be demoted through the controlled CLI before deletion',
        });
      }

      const deletionRequestedAt = account.deletionRequestedAt ?? new Date();
      await tx.user.update({
        where: { id: userId },
        data: {
          activeNetworkCompanionId: null,
          accountStatus: 'SUSPENDED',
          suspendedAt: account.suspendedAt ?? deletionRequestedAt,
          deletionRequestedAt,
          deletionNextAttemptAt: deletionRequestedAt,
          deletionAttemptCount: 0,
        },
      });
      await tx.visitInvitation.updateMany({
        where: {
          status: 'pending',
          OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
        },
        data: {
          status: 'cancelled',
          cancelledAt: deletionRequestedAt,
          assetPackRefId: null,
        },
      });
      await tx.visitSession.updateMany({
        where: {
          state: { in: ['preparing', 'ready'] },
          OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
        },
        data: {
          state: 'cancelled',
          endedAt: deletionRequestedAt,
          endReason: 'account_deletion_requested',
          assetPackRefId: null,
        },
      });
      await tx.visitSession.updateMany({
        where: {
          state: { in: ['active', 'ending'] },
          OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
        },
        data: {
          state: 'ended',
          endingAt: deletionRequestedAt,
          endedAt: deletionRequestedAt,
          endReason: 'account_deletion_requested',
          assetPackRefId: null,
        },
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
        data: { status: 'deleting', failureCode: null },
      });
      await tx.friendRequest.updateMany({
        where: {
          status: 'pending',
          OR: [{ senderId: userId }, { receiverId: userId }],
        },
        data: { status: 'cancelled' },
      });
      await tx.deviceSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), csrfTokenHash: null },
      });
      return deletionRequestedAt;
    });
    await this.presence?.disconnectUser(userId).catch(() => undefined);
    await this.publishAccountDeletionTerminalEvents(userId, requestedAt);

    try {
      const result = await this.finalizePendingAccountDeletion(
        userId,
        requestedAt,
      );
      if (!result.deleted) {
        await this.deferAccountDeletion(
          userId,
          new Date(result.deleteAfter),
          false,
        );
      }
      return result;
    } catch {
      const deleteAfter = await this.deferAccountDeletion(
        userId,
        new Date(),
        true,
      );
      return {
        deleted: false,
        pending: true,
        deleteAfter: deleteAfter.toISOString(),
      };
    }
  }

  private async publishAccountDeletionTerminalEvents(
    userId: string,
    requestedAt: Date,
  ): Promise<void> {
    if (!this.events) return;
    let invitationCursor: string | undefined;
    for (;;) {
      const invitations = await this.prisma.visitInvitation.findMany({
        where: {
          status: 'cancelled',
          cancelledAt: requestedAt,
          OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
        },
        select: {
          id: true,
          visitorOwnerUserId: true,
          hostUserId: true,
        },
        orderBy: { id: 'asc' },
        take: 100,
        ...(invitationCursor
          ? { cursor: { id: invitationCursor }, skip: 1 }
          : {}),
      });
      for (const invitation of invitations) {
        const counterpart = invitation.visitorOwnerUserId === userId
          ? invitation.hostUserId
          : invitation.visitorOwnerUserId;
        this.events.publishToUser(counterpart, 'visit.invitation.updated', {
          invitationId: invitation.id,
        });
      }
      if (invitations.length < 100) break;
      invitationCursor = invitations[invitations.length - 1].id;
    }

    let sessionCursor: string | undefined;
    for (;;) {
      const sessions = await this.prisma.visitSession.findMany({
        where: {
          endedAt: requestedAt,
          endReason: 'account_deletion_requested',
          OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }],
        },
        select: {
          id: true,
          visitorOwnerUserId: true,
          hostUserId: true,
          state: true,
        },
        orderBy: { id: 'asc' },
        take: 100,
        ...(sessionCursor
          ? { cursor: { id: sessionCursor }, skip: 1 }
          : {}),
      });
      for (const session of sessions) {
        const counterpart = session.visitorOwnerUserId === userId
          ? session.hostUserId
          : session.visitorOwnerUserId;
        this.events.publishToUser(counterpart, 'visit.session.ended', {
          sessionId: session.id,
          state: session.state,
        });
      }
      if (sessions.length < 100) break;
      sessionCursor = sessions[sessions.length - 1].id;
    }
  }

  async finalizePendingAccountDeletions(limit = 100) {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const now = new Date();
    const accounts = await this.prisma.user.findMany({
      where: {
        deletionRequestedAt: { not: null },
        OR: [
          { deletionNextAttemptAt: null },
          { deletionNextAttemptAt: { lte: now } },
        ],
      },
      take: boundedLimit,
      orderBy: [
        { deletionRequestedAt: 'asc' },
        { id: 'asc' },
      ],
      select: { id: true, deletionRequestedAt: true },
    });
    let deleted = 0;
    let pending = 0;
    let failed = 0;
    for (const account of accounts) {
      try {
        const result = await this.finalizePendingAccountDeletion(
          account.id,
          account.deletionRequestedAt!,
        );
        if (result.deleted) {
          deleted += 1;
        } else {
          pending += 1;
          await this.deferAccountDeletion(
            account.id,
            new Date(result.deleteAfter),
            false,
          );
        }
      } catch {
        failed += 1;
        await this.deferAccountDeletion(account.id, new Date(), true)
          .catch(() => undefined);
      }
    }
    return {
      processed: accounts.length,
      deleted,
      pending,
      failed,
    };
  }

  private async finalizePendingAccountDeletion(
    userId: string,
    requestedAt: Date,
  ): Promise<
    | { deleted: true; pending: false }
    | { deleted: false; pending: true; deleteAfter: string }
  > {
    const packSummary = await this.prisma.companionAssetPack.aggregate({
      where: { companion: { ownerUserId: userId } },
      _count: { id: true },
      _max: { lastUploadUrlIssuedAt: true },
    });
    const deleteAfter = accountDeletionNotBefore(
      requestedAt,
      packSummary._max.lastUploadUrlIssuedAt,
      this.storage.limits.uploadUrlTtlSeconds,
    );
    if (deleteAfter > new Date()) {
      return {
        deleted: false,
        pending: true,
        deleteAfter: deleteAfter.toISOString(),
      };
    }

    let cursor: string | undefined;
    let processedPacks = 0;
    do {
      const packs = await this.prisma.companionAssetPack.findMany({
        where: { companion: { ownerUserId: userId } },
        take: ACCOUNT_DELETION_PACK_BATCH_SIZE,
        orderBy: { id: 'asc' },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, objectPrefix: true },
      });
      for (const pack of packs) {
        try {
          await this.storage.deleteObjectPrefix(pack.objectPrefix);
        } catch (error) {
          await this.prisma.companionAssetPack.updateMany({
            where: {
              id: pack.id,
              status: 'deleting',
              companion: { ownerUserId: userId },
            },
            data: { failureCode: 'ASSET_CLEANUP_FAILED' },
          }).catch(() => undefined);
          throw error;
        }
      }
      processedPacks += packs.length;
      if (packs.length < ACCOUNT_DELETION_PACK_BATCH_SIZE) break;
      cursor = packs[packs.length - 1]?.id;
    } while (cursor);

    const finalized = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const account = await tx.user.findUnique({
        where: { id: userId },
        select: { deletionRequestedAt: true },
      });
      if (!account?.deletionRequestedAt) return { deleted: true } as const;
      const latestPackSummary = await tx.companionAssetPack.aggregate({
        where: { companion: { ownerUserId: userId } },
        _count: { id: true },
        _max: { lastUploadUrlIssuedAt: true },
      });
      const latestDeleteAfter = accountDeletionNotBefore(
        account.deletionRequestedAt,
        latestPackSummary._max.lastUploadUrlIssuedAt,
        this.storage.limits.uploadUrlTtlSeconds,
      );
      if (
        latestDeleteAfter > new Date()
        || latestPackSummary._count.id !== processedPacks
        || packSummary._count.id !== processedPacks
      ) {
        return {
          deleted: false,
          deleteAfter: latestDeleteAfter,
        } as const;
      }

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
      return { deleted: true } as const;
    });
    if (!finalized.deleted) {
      return {
        deleted: false,
        pending: true,
        deleteAfter: finalized.deleteAfter.toISOString(),
      };
    }
    return { deleted: true, pending: false };
  }

  private async deferAccountDeletion(
    userId: string,
    requestedNextAttempt: Date,
    failed: boolean,
  ): Promise<Date> {
    let nextAttemptAt = requestedNextAttempt;
    if (failed) {
      const account = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { deletionAttemptCount: true },
      });
      const attempt = Math.min(
        (account?.deletionAttemptCount ?? 0) + 1,
        ACCOUNT_DELETION_MAX_BACKOFF_EXPONENT,
      );
      nextAttemptAt = new Date(
        Date.now() + Math.min(
          ACCOUNT_DELETION_MAX_BACKOFF_MS,
          ACCOUNT_DELETION_RETRY_BASE_MS * 2 ** (attempt - 1),
        ),
      );
    }
    await this.prisma.user.updateMany({
      where: { id: userId, deletionRequestedAt: { not: null } },
      data: {
        deletionNextAttemptAt: nextAttemptAt,
        ...(failed
          ? { deletionAttemptCount: { increment: 1 } }
          : { deletionAttemptCount: 0 }),
      },
    });
    return nextAttemptAt;
  }

  private async requireOwnedCompanion(userId: string, companionId: string) {
    const companion = await this.prisma.networkCompanion.findFirst({
      where: { id: companionId, ownerUserId: userId },
      select: { id: true },
    });
    if (!companion) throw new NotFoundException('Companion not found');
  }
}

const ACCOUNT_DELETION_EXPIRY_SAFETY_MS = 5_000;
const ACCOUNT_DELETION_PACK_BATCH_SIZE = 100;
const ACCOUNT_DELETION_RETRY_BASE_MS = 60_000;
const ACCOUNT_DELETION_MAX_BACKOFF_MS = 60 * 60_000;
const ACCOUNT_DELETION_MAX_BACKOFF_EXPONENT = 10;

function accountDeletionNotBefore(
  requestedAt: Date,
  lastUploadUrlIssuedAt: Date | null,
  uploadUrlTtlSeconds: number,
): Date {
  let notBefore = requestedAt.getTime();
  if (lastUploadUrlIssuedAt) {
    notBefore = Math.max(
      notBefore,
      lastUploadUrlIssuedAt.getTime()
        + uploadUrlTtlSeconds * 1_000
        + ACCOUNT_DELETION_EXPIRY_SAFETY_MS,
    );
  }
  return new Date(notBefore);
}

const EXPORT_BATCH_SIZE = 100;

const EXPORT_ACCOUNT_SELECT = {
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
} as const;

const EXPORT_FRIENDSHIP_SELECT = {
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
} as const;

const EXPORT_FRIEND_REQUEST_SELECT = {
  id: true,
  senderId: true,
  receiverId: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const EXPORT_BLOCKED_USER_SELECT = {
  id: true,
  blockedId: true,
  createdAt: true,
} as const;

const EXPORT_COMPANION_SELECT = {
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
} as const;

const EXPORT_ASSET_PACK_SELECT = {
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
} as const;

const EXPORT_ASSET_FILE_SELECT = {
  id: true,
  relativePath: true,
  mimeType: true,
  sizeBytes: true,
  sha256: true,
  category: true,
  uploaded: true,
  verifiedAt: true,
} as const;

const EXPORT_NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  message: true,
  data: true,
  read: true,
  createdAt: true,
} as const;

const EXPORT_DISCOVERY_SELECT = {
  id: true,
  title: true,
  description: true,
  metadata: true,
  createdAt: true,
} as const;

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

function exportCursorPage(cursor?: string) {
  return {
    take: EXPORT_BATCH_SIZE,
    orderBy: { id: 'asc' as const },
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

function safeExportJson(value: unknown): string {
  return JSON.stringify(sanitizeExportValue(value), (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item);
}

function sanitizeExportValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeExportValue);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) =>
    isSecretExportKey(key)
      ? []
      : [[key, sanitizeExportValue(item)]]));
}

function isSecretExportKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return SECRET_EXPORT_KEYS.has(normalized);
}

const SECRET_EXPORT_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'tokenhash',
  'refreshtoken',
  'refreshtokenhash',
  'previousrefreshtoken',
  'previousrefreshtokenhash',
  'csrftoken',
  'csrftokenhash',
  'accesstoken',
  'apikey',
  'credential',
  'credentials',
  'clientsecret',
  'privatekey',
  'signingkey',
  'secret',
  'secrets',
  'objectkey',
  'objectprefix',
]);

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
