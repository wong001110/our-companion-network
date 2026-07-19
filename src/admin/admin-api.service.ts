import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserAccountStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { boundedPage, pageEnvelope, stableOrderBy } from '../common/pagination';
import { StorageService } from '../storage/storage.service';
import { ProtocolConfigService } from '../common/protocol-config.service';
import { SocialEventPublisher } from '../common/social-event-publisher.service';
import { CompanionService } from '../companion/companion.service';
import { VisitService } from '../visit/visit.service';
import { PresenceGateway } from '../presence/presence.gateway';
import { validateManifest } from '../companion/asset-manifest';
import { AdminListQueryDto } from './dto/admin-api.dto';
import { ADMIN_AUDIT_ACTIONS, AuditService } from './audit.service';

@Injectable()
export class AdminApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly protocol: ProtocolConfigService,
    private readonly events: SocialEventPublisher,
    private readonly companions: CompanionService,
    private readonly visits: VisitService,
    private readonly presence: PresenceGateway,
  ) {}

  async overview() {
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const week = new Date(now.getTime() - 7 * 86_400_000);
    const staleSession = new Date(now.getTime() - 15 * 60_000);
    const [
      totalAccounts,
      newToday,
      newWeek,
      online,
      idle,
      publishedCompanions,
      totalPacks,
      totalFiles,
      storedBytes,
      activeSessions,
      pendingInvitations,
      failedPacks,
      stuckSessions,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: today } } }),
      this.prisma.user.count({ where: { createdAt: { gte: week } } }),
      this.prisma.presence.count({ where: { status: 'online' } }),
      this.prisma.presence.count({ where: { status: 'idle' } }),
      this.prisma.networkCompanion.count({ where: { published: true } }),
      this.prisma.companionAssetPack.count(),
      this.prisma.companionAssetFile.count(),
      this.prisma.companionAssetPack.aggregate({ _sum: { totalBytes: true } }),
      this.prisma.visitSession.count({ where: { state: 'active' } }),
      this.prisma.visitInvitation.count({ where: { status: 'pending' } }),
      this.prisma.companionAssetPack.count({ where: { status: 'failed' } }),
      this.prisma.visitSession.count({
        where: {
          state: { in: ['preparing', 'ready', 'active', 'ending'] },
          updatedAt: { lt: staleSession },
        },
      }),
    ]);
    return {
      totalAccounts,
      newAccounts: { today: newToday, sevenDays: newWeek },
      presence: { online, idle },
      publishedCompanions,
      totalAssetPacks: totalPacks,
      totalAssetFiles: totalFiles,
      r2StoredBytes: Number(storedBytes._sum.totalBytes ?? 0n),
      activeVisitSessions: activeSessions,
      pendingInvitations,
      failedAssetPacks: failedPacks,
      stuckSessions,
    };
  }

  async listUsers(query: AdminListQueryDto) {
    requireStatus(query.status, ['ACTIVE', 'SUSPENDED']);
    const page = boundedPage(query);
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { accountStatus: query.status as UserAccountStatus } : {}),
      ...dateWhere(query),
      ...(query.search ? {
        OR: [
          { id: { contains: query.search, mode: 'insensitive' } },
          { uid: { contains: query.search, mode: 'insensitive' } },
          { username: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
          { friendCode: { contains: query.search, mode: 'insensitive' } },
        ],
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('createdAt', query.direction),
        select: ADMIN_USER_SUMMARY,
      }),
      this.prisma.user.count({ where }),
    ]);
    return pageEnvelope(items, total, page);
  }

  async getUser(adminUserId: string, userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        ...ADMIN_USER_SUMMARY,
        profile: true,
        presence: true,
        deviceSessions: {
          orderBy: stableOrderBy('lastUsedAt'),
          take: 100,
          select: SAFE_DEVICE_SELECT,
        },
        networkCompanions: {
          orderBy: stableOrderBy('updatedAt'),
          take: 100,
          select: ADMIN_COMPANION_SUMMARY,
        },
        _count: {
          select: {
            friendships: true,
            blockedUsers: true,
            blockedBy: true,
            notifications: true,
            visitInvitationsOwned: true,
            visitInvitationsHosted: true,
            visitSessionsOwned: true,
            visitSessionsHosted: true,
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    await this.audit.record({
      adminUserId,
      action: ADMIN_AUDIT_ACTIONS.VIEW_SENSITIVE_ACCOUNT,
      targetType: 'User',
      targetId: user.id,
    });
    return user;
  }

  async setAccountStatus(
    adminUserId: string,
    userId: string,
    status: UserAccountStatus,
    reason: string,
  ) {
    this.requireReason(reason);
    if (adminUserId === userId && status === UserAccountStatus.SUSPENDED) {
      throw new ForbiddenException({
        code: 'ADMIN_SELF_SUSPEND_FORBIDDEN',
        message: 'A Superadmin cannot suspend their current account',
      });
    }
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, uid: true, accountStatus: true },
      });
      if (!current) throw new NotFoundException('User not found');
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          accountStatus: status,
          suspendedAt: status === UserAccountStatus.SUSPENDED ? new Date() : null,
        },
        select: {
          id: true,
          uid: true,
          accountStatus: true,
          suspendedAt: true,
        },
      });
      if (status === UserAccountStatus.SUSPENDED) {
        await tx.deviceSession.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date(), csrfTokenHash: null },
        });
      }
      await this.audit.record({
        adminUserId,
        action: status === UserAccountStatus.SUSPENDED
          ? ADMIN_AUDIT_ACTIONS.SUSPEND_ACCOUNT
          : ADMIN_AUDIT_ACTIONS.RESTORE_ACCOUNT,
        targetType: 'User',
        targetId: userId,
        reason,
        metadata: { previousStatus: current.accountStatus, status },
      }, tx);
      return updated;
    });
    return user;
  }

  async revokeDevice(
    adminUserId: string,
    userId: string,
    sessionId: string,
    reason: string,
  ) {
    this.requireReason(reason);
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.deviceSession.findFirst({
        where: { id: sessionId, userId },
        select: { id: true, deviceId: true, revokedAt: true },
      });
      if (!session) throw new NotFoundException('Device session not found');
      await tx.deviceSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), csrfTokenHash: null },
      });
      await this.audit.record({
        adminUserId,
        action: ADMIN_AUDIT_ACTIONS.REVOKE_DEVICE_SESSION,
        targetType: 'DeviceSession',
        targetId: session.id,
        reason,
        metadata: { userId },
      }, tx);
      return { revoked: true };
    });
  }

  async listCompanions(query: AdminListQueryDto) {
    requireStatus(query.status, ['published', 'unpublished']);
    const page = boundedPage(query);
    const where: Prisma.NetworkCompanionWhereInput = {
      ...(query.status ? { published: query.status === 'published' } : {}),
      ...dateWhere(query),
      ...(query.search ? {
        OR: [
          { id: { contains: query.search, mode: 'insensitive' } },
          { name: { contains: query.search, mode: 'insensitive' } },
          { owner: { uid: { contains: query.search, mode: 'insensitive' } } },
        ],
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.networkCompanion.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('updatedAt', query.direction),
        select: {
          ...ADMIN_COMPANION_SUMMARY,
          owner: { select: { id: true, uid: true, username: true } },
        },
      }),
      this.prisma.networkCompanion.count({ where }),
    ]);
    return pageEnvelope(items, total, page);
  }

  async getCompanion(id: string) {
    const companion = await this.prisma.networkCompanion.findUnique({
      where: { id },
      select: {
        ...ADMIN_COMPANION_SUMMARY,
        owner: { select: { id: true, uid: true, username: true } },
        activeAssetPack: {
          select: {
            id: true,
            manifestHash: true,
            status: true,
            totalFiles: true,
            totalBytes: true,
          },
        },
        _count: {
          select: {
            assetPacks: true,
            visitInvitations: true,
            visitSessions: true,
          },
        },
      },
    });
    if (!companion) throw new NotFoundException('Companion not found');
    return normalizeBigInts(companion);
  }

  async unpublishCompanion(
    adminUserId: string,
    id: string,
    reason: string,
  ) {
    this.requireReason(reason);
    const companion = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "NetworkCompanion" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.networkCompanion.findUnique({
        where: { id },
        select: { id: true, ownerUserId: true, published: true },
      });
      if (!current) throw new NotFoundException('Companion not found');
      const updated = await tx.networkCompanion.update({
        where: { id },
        data: { published: false, publishedAt: null },
        select: ADMIN_COMPANION_SUMMARY,
      });
      await this.audit.record({
        adminUserId,
        action: ADMIN_AUDIT_ACTIONS.UNPUBLISH_COMPANION,
        targetType: 'NetworkCompanion',
        targetId: id,
        reason,
        metadata: { ownerUserId: current.ownerUserId, wasPublished: current.published },
      }, tx);
      return { updated, ownerUserId: current.ownerUserId };
    });
    await this.visits.revokeCompanionVisits(id, 'admin_unpublished');
    this.events.publishToUser(companion.ownerUserId, 'companion.profile.unpublished', {
      ownerUserId: companion.ownerUserId,
      companionId: id,
    });
    return companion.updated;
  }

  async listAssetPacks(query: AdminListQueryDto) {
    requireStatus(query.status, [
      'uploading', 'verifying', 'active', 'superseded', 'failed',
      'abandoning', 'abandoned', 'deleting',
    ]);
    const page = boundedPage(query);
    const where: Prisma.CompanionAssetPackWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...dateWhere(query),
      ...(query.search ? {
        OR: [
          { id: { contains: query.search, mode: 'insensitive' } },
          { manifestHash: { contains: query.search, mode: 'insensitive' } },
          { companion: { name: { contains: query.search, mode: 'insensitive' } } },
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
          status: true,
          totalFiles: true,
          totalBytes: true,
          failureCode: true,
          createdAt: true,
          updatedAt: true,
          companion: {
            select: {
              name: true,
              owner: { select: { id: true, uid: true } },
            },
          },
        },
      }),
      this.prisma.companionAssetPack.count({ where }),
    ]);
    return pageEnvelope(items.map(normalizeBigInts), total, page);
  }

  async getAssetPack(id: string) {
    const pack = await this.prisma.companionAssetPack.findUnique({
      where: { id },
      select: {
        id: true,
        companionId: true,
        manifestHash: true,
        schemaVersion: true,
        manifest: true,
        status: true,
        objectPrefix: true,
        totalFiles: true,
        totalBytes: true,
        failureCode: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
        activatedAt: true,
        supersededAt: true,
        files: {
          orderBy: stableOrderBy('relativePath', undefined),
          take: 100,
          select: {
            id: true,
            relativePath: true,
            objectKey: true,
            mimeType: true,
            sizeBytes: true,
            sha256: true,
            category: true,
            uploaded: true,
            verifiedAt: true,
          },
        },
        _count: {
          select: { visitInvitationRefs: true, visitSessionRefs: true },
        },
      },
    });
    if (!pack) throw new NotFoundException('Asset Pack not found');
    let manifestMismatch = false;
    try {
      validateManifest(pack.manifest, pack.manifestHash, this.storage.limits);
    } catch {
      manifestMismatch = true;
    }
    const normalized = normalizeBigInts(pack);
    if (!this.storage.capability.downloadsEnabled) {
      return {
        ...normalized,
        storageInspection: {
          available: false,
          manifestMismatch,
          manifestObjectExists: null,
          missingObjects: null,
          orphanObjects: null,
          shaMismatches: null,
          metadataMismatches: null,
        },
      };
    }

    const manifestObjectKey = `${pack.objectPrefix}/manifest.json`;
    const expectedKeys = new Set([
      manifestObjectKey,
      ...pack.files.map((file) => file.objectKey),
    ]);
    const [actualKeys, manifestMetadata, ...fileMetadata] = await Promise.all([
      this.storage.listObjectKeys(`${pack.objectPrefix}/`, 10_000),
      this.storage.headObject(manifestObjectKey),
      ...pack.files.map((file) => this.storage.headObject(file.objectKey)),
    ]);
    const missingObjects: string[] = [];
    const shaMismatches: string[] = [];
    const metadataMismatches: string[] = [];
    const inspectedFiles = normalized.files.map((file, index) => {
      const metadata = fileMetadata[index];
      const relativePath = String(file.relativePath);
      if (!metadata) missingObjects.push(relativePath);
      if (metadata?.sha256 && metadata.sha256 !== file.sha256) {
        shaMismatches.push(relativePath);
      }
      if (metadata && (
        metadata.sizeBytes !== Number(file.sizeBytes)
        || (metadata.mimeType && metadata.mimeType !== file.mimeType)
      )) {
        metadataMismatches.push(relativePath);
      }
      return {
        ...file,
        r2ObjectExists: Boolean(metadata),
        r2Integrity: !metadata
          ? 'missing'
          : shaMismatches.includes(relativePath)
            || metadataMismatches.includes(relativePath)
            ? 'mismatch'
            : 'verified',
      };
    });
    if (!manifestMetadata) missingObjects.push('manifest.json');
    const orphanObjects = actualKeys.filter((key) => !expectedKeys.has(key));
    return {
      ...normalized,
      files: inspectedFiles,
      storageInspection: {
        available: true,
        manifestMismatch,
        manifestObjectExists: Boolean(manifestMetadata),
        missingObjects,
        orphanObjects,
        shaMismatches,
        metadataMismatches,
      },
    };
  }

  async listVisitInvitations(query: AdminListQueryDto) {
    return this.listVisits('invitation', query);
  }

  async listVisitSessions(query: AdminListQueryDto) {
    return this.listVisits('session', query);
  }

  async getVisitSession(id: string) {
    const session = await this.prisma.visitSession.findUnique({
      where: { id },
      select: ADMIN_SESSION_SELECT,
    });
    if (!session) throw new NotFoundException('Visit Session not found');
    return session;
  }

  async endVisitSession(
    adminUserId: string,
    id: string,
    reason: string,
  ) {
    this.requireReason(reason);
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VisitSession" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.visitSession.findUnique({
        where: { id },
        select: ADMIN_SESSION_SELECT,
      });
      if (!current) throw new NotFoundException('Visit Session not found');
      if (['ended', 'cancelled', 'failed'].includes(current.state)) {
        throw new ConflictException('Visit Session is already terminal');
      }
      const updated = await tx.visitSession.update({
        where: { id },
        data: {
          state: current.state === 'active' ? 'ended' : 'cancelled',
          endingAt: current.state === 'active' ? new Date() : null,
          endedAt: new Date(),
          endReason: `admin:${reason}`,
          assetPackRefId: null,
        },
        select: ADMIN_SESSION_SELECT,
      });
      await this.audit.record({
        adminUserId,
        action: ADMIN_AUDIT_ACTIONS.END_VISIT_SESSION,
        targetType: 'VisitSession',
        targetId: id,
        reason,
      }, tx);
      return updated;
    });
    this.events.publishToUser(session.visitorOwnerUserId, 'visit.session.ended', {
      sessionId: session.id,
      state: session.state,
    });
    this.events.publishToUser(session.hostUserId, 'visit.session.ended', {
      sessionId: session.id,
      state: session.state,
    });
    return session;
  }

  async cancelVisitInvitation(
    adminUserId: string,
    id: string,
    reason: string,
  ) {
    this.requireReason(reason);
    const invitation = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VisitInvitation" WHERE "id" = ${id} FOR UPDATE`;
      const current = await tx.visitInvitation.findUnique({
        where: { id },
        select: ADMIN_INVITATION_SELECT,
      });
      if (!current) throw new NotFoundException('Visit Invitation not found');
      if (current.status !== 'pending') {
        throw new ConflictException('Visit Invitation is not pending');
      }
      const updated = await tx.visitInvitation.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledAt: new Date(),
          assetPackRefId: null,
        },
        select: ADMIN_INVITATION_SELECT,
      });
      await this.audit.record({
        adminUserId,
        action: ADMIN_AUDIT_ACTIONS.CANCEL_VISIT_INVITATION,
        targetType: 'VisitInvitation',
        targetId: id,
        reason,
      }, tx);
      return updated;
    });
    for (const userId of [
      invitation.visitorOwnerUserId,
      invitation.hostUserId,
    ]) {
      this.events.publishToUser(userId, 'visit.invitation.updated', {
        invitationId: invitation.id,
      });
    }
    return invitation;
  }

  async systemHealth() {
    let database = 'ok';
    let migrationVersion: string | null = null;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const migrations = await this.prisma.$queryRaw<Array<{
        migration_name: string;
      }>>`
        SELECT "migration_name"
        FROM "_prisma_migrations"
        WHERE "finished_at" IS NOT NULL
          AND "rolled_back_at" IS NULL
        ORDER BY "finished_at" DESC, "migration_name" DESC
        LIMIT 1
      `;
      migrationVersion = migrations[0]?.migration_name ?? null;
    } catch {
      database = 'unavailable';
    }
    return {
      api: 'ok',
      database,
      r2: this.storage.capability,
      websocket: this.presence.getOperationalSnapshot(),
      migrationVersion,
      protocolVersion: this.protocol.protocolVersion,
      serverVersion: this.protocol.serverVersion,
      compatibleClientVersion: this.protocol.minimumClientVersion,
    };
  }

  async cleanupStorage(
    adminUserId: string,
    reason: string,
  ) {
    this.requireReason(reason);
    const requestAudit = await this.audit.record({
      adminUserId,
      action: ADMIN_AUDIT_ACTIONS.RUN_STORAGE_CLEANUP,
      targetType: 'Storage',
      reason,
      metadata: { phase: 'requested' },
    });
    try {
      // Run the two destructive passes sequentially. Each pass is independently
      // retryable, while the immutable request audit above always precedes any
      // R2 or database deletion.
      const abandoned = await this.companions.abandonExpiredUploads(100);
      const removed = await this.companions.cleanupSupersededPacks(100);
      if (abandoned > 0 || removed > 0) {
        await this.audit.record({
          adminUserId,
          action: ADMIN_AUDIT_ACTIONS.DELETE_ASSET_PACK,
          targetType: 'CompanionAssetPackBatch',
          reason,
          metadata: {
            phase: 'completed',
            requestAuditId: requestAudit.id,
            abandoned,
            removed,
          },
        });
      }
      await this.audit.record({
        adminUserId,
        action: ADMIN_AUDIT_ACTIONS.RUN_STORAGE_CLEANUP,
        targetType: 'Storage',
        reason,
        metadata: {
          phase: 'completed',
          requestAuditId: requestAudit.id,
          abandoned,
          removed,
        },
      });
      return { abandoned, removed };
    } catch (error) {
      await this.audit.record({
        adminUserId,
        action: ADMIN_AUDIT_ACTIONS.RUN_STORAGE_CLEANUP,
        targetType: 'Storage',
        reason,
        metadata: {
          phase: 'failed',
          requestAuditId: requestAudit.id,
          errorCode: error instanceof Error ? error.name : 'UNKNOWN',
        },
      }).catch(() => undefined);
      throw error;
    }
  }

  private async listVisits(
    kind: 'invitation' | 'session',
    query: AdminListQueryDto,
  ) {
    requireStatus(
      query.status,
      kind === 'invitation'
        ? ['pending', 'accepted', 'declined', 'cancelled', 'expired']
        : ['preparing', 'ready', 'active', 'ending', 'ended', 'cancelled', 'failed'],
    );
    const page = boundedPage(query);
    if (kind === 'invitation') {
      const where = {
        ...(query.status ? { status: query.status } : {}),
        ...dateWhere(query),
        ...(query.search ? {
          OR: [
            { id: { contains: query.search, mode: 'insensitive' as const } },
            { companionName: { contains: query.search, mode: 'insensitive' as const } },
            { visitorOwnerUserId: { contains: query.search, mode: 'insensitive' as const } },
            { hostUserId: { contains: query.search, mode: 'insensitive' as const } },
          ],
        } : {}),
      };
      const [items, total] = await this.prisma.$transaction([
        this.prisma.visitInvitation.findMany({
          where,
          skip: page.skip,
          take: page.take,
          orderBy: stableOrderBy('updatedAt', query.direction),
          select: ADMIN_INVITATION_SELECT,
        }),
        this.prisma.visitInvitation.count({ where }),
      ]);
      return pageEnvelope(items, total, page);
    }
    const where = {
      ...(query.status ? { state: query.status } : {}),
      ...dateWhere(query),
      ...(query.search ? {
        OR: [
          { id: { contains: query.search, mode: 'insensitive' as const } },
          { invitationId: { contains: query.search, mode: 'insensitive' as const } },
          { visitorOwnerUserId: { contains: query.search, mode: 'insensitive' as const } },
          { hostUserId: { contains: query.search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.visitSession.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('updatedAt', query.direction),
        select: ADMIN_SESSION_SELECT,
      }),
      this.prisma.visitSession.count({ where }),
    ]);
    return pageEnvelope(items, total, page);
  }

  private requireReason(reason: string): void {
    const length = reason.trim().length;
    if (length < 4 || length > 500) {
      throw new BadRequestException({
        code: 'ADMIN_REASON_REQUIRED',
        message: 'Reason must contain between 4 and 500 characters',
      });
    }
  }
}

const ADMIN_USER_SUMMARY = {
  id: true,
  uid: true,
  email: true,
  username: true,
  friendCode: true,
  role: true,
  accountStatus: true,
  suspendedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SAFE_DEVICE_SELECT = {
  id: true,
  deviceId: true,
  createdAt: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
} as const;

const ADMIN_COMPANION_SUMMARY = {
  id: true,
  ownerUserId: true,
  name: true,
  publicDescription: true,
  publicTags: true,
  visibility: true,
  published: true,
  activeAssetPackId: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ADMIN_INVITATION_SELECT = {
  id: true,
  visitorOwnerUserId: true,
  hostUserId: true,
  networkCompanionId: true,
  assetPackSnapshotId: true,
  assetPackRefId: true,
  companionName: true,
  status: true,
  expiresAt: true,
  respondedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const ADMIN_SESSION_SELECT = {
  id: true,
  invitationId: true,
  visitorOwnerUserId: true,
  hostUserId: true,
  networkCompanionId: true,
  assetPackSnapshotId: true,
  assetPackRefId: true,
  state: true,
  visitorOwnerReadyAt: true,
  hostReadyAt: true,
  visitorOwnerSeenAt: true,
  hostSeenAt: true,
  readyAt: true,
  startedAt: true,
  endingAt: true,
  endedAt: true,
  endReason: true,
  failureCode: true,
  createdAt: true,
  updatedAt: true,
} as const;

function dateWhere(query: AdminListQueryDto) {
  if (!query.dateFrom && !query.dateTo) return {};
  return {
    createdAt: {
      ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
    },
  };
}

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

function requireStatus(value: string | undefined, allowed: string[]): void {
  if (value && !allowed.includes(value)) {
    throw new BadRequestException({
      code: 'STATUS_FILTER_INVALID',
      message: 'Status filter is invalid',
    });
  }
}
