import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SocialEventPublisher } from '../common/social-event-publisher.service';
import { StorageService } from '../storage/storage.service';
import { InitiateAssetPackDto } from './dto/initiate-asset-pack.dto';
import { UpsertCompanionDto } from './dto/upsert-companion.dto';
import { validateManifest } from './asset-manifest';
import { VisitService } from '../visit/visit.service';

const PUBLIC_SELECT = { id: true, ownerUserId: true, name: true, publicDescription: true, publicTags: true, visibility: true, published: true, activeAssetPackId: true, createdAt: true, updatedAt: true, publishedAt: true } as const;
const PACK_SELECT = { id: true, companionId: true, manifestHash: true, schemaVersion: true, status: true, totalFiles: true, totalBytes: true, failureCode: true, createdAt: true, updatedAt: true, completedAt: true, activatedAt: true, supersededAt: true } as const;
const UPLOAD_URL_EXPIRY_SKEW_MS = 5_000;
export interface CompleteAssetPackResult { assetPack: Record<string, unknown>; companion: Record<string, unknown>; }

@Injectable()
export class CompanionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: SocialEventPublisher,
    @Optional() private readonly visits?: VisitService,
  ) {}

  async getMine(userId: string) {
    const [companions, user] = await Promise.all([
      this.prisma.networkCompanion.findMany({ where: { ownerUserId: userId }, select: { ...PUBLIC_SELECT, assetPacks: { select: PACK_SELECT, orderBy: { createdAt: 'desc' } } }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { activeNetworkCompanionId: true } }),
    ]);
    return { activeNetworkCompanionId: user?.activeNetworkCompanionId ?? undefined, companions: companions.map(companion => ({ ...this.publicProfile(companion), assetPacks: companion.assetPacks.map(pack => this.pack(pack)) })) };
  }

  async create(userId: string, dto: UpsertCompanionDto) {
    const profile = this.normalizeProfile(dto);
    const companion = await this.prisma.networkCompanion.create({ data: { ownerUserId: userId, ...profile, visibility: 'friends_only' }, select: PUBLIC_SELECT });
    return { networkCompanionId: companion.id, companion: this.publicProfile(companion) };
  }

  async update(userId: string, companionId: string, dto: UpsertCompanionDto) {
    await this.requireOwnedCompanion(userId, companionId);
    const companion = await this.prisma.networkCompanion.update({ where: { id: companionId }, data: this.normalizeProfile(dto), select: PUBLIC_SELECT });
    await this.publishInvalidation(companion.ownerUserId, 'companion.profile.updated', { ownerUserId: companion.ownerUserId, companionId });
    return this.publicProfile(companion);
  }

  async activate(userId: string, companionId: string) {
    const companion = await this.requireOwnedCompanion(userId, companionId);
    if (companion.id === (await this.prisma.user.findUnique({ where: { id: userId }, select: { activeNetworkCompanionId: true } }))?.activeNetworkCompanionId) {
      return { activeNetworkCompanionId: companionId, changed: false };
    }
    await this.prisma.user.update({ where: { id: userId }, data: { activeNetworkCompanionId: companionId } });
    await this.publishInvalidation(userId, 'companion.profile.updated', { ownerUserId: userId, companionId });
    return { activeNetworkCompanionId: companionId, changed: true };
  }

  async publish(userId: string, companionId: string) {
    const companion = await this.requireOwnedCompanion(userId, companionId);
    if (!companion.activeAssetPackId) throw new ConflictException({ code: 'ASSET_PACK_NOT_COMPLETE', message: 'An active Asset Pack is required before publishing' });
    const published = await this.prisma.networkCompanion.update({ where: { id: companion.id }, data: { published: true, publishedAt: new Date() }, select: PUBLIC_SELECT });
    await this.publishInvalidation(userId, 'companion.profile.updated', { ownerUserId: userId, companionId });
    return this.publicProfile(published);
  }

  async unpublish(userId: string, companionId: string) {
    const companion = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "NetworkCompanion" WHERE "id" = ${companionId} FOR UPDATE`;
      const owned = await tx.networkCompanion.findUnique({ where: { id: companionId }, select: { ownerUserId: true } });
      if (!owned) throw new NotFoundException({ code: 'COMPANION_NOT_FOUND', message: 'Companion was not found' });
      if (owned.ownerUserId !== userId) throw new ForbiddenException({ code: 'COMPANION_NOT_OWNED', message: 'Companion is not available' });
      return tx.networkCompanion.update({ where: { id: companionId }, data: { published: false, publishedAt: null }, select: PUBLIC_SELECT });
    });
    await this.visits?.revokeCompanionVisits(companionId, 'companion_unpublished');
    await this.publishInvalidation(userId, 'companion.profile.unpublished', { ownerUserId: userId, companionId });
    return this.publicProfile(companion);
  }

  async getFriendCompanion(requesterId: string, friendUserId: string) {
    if (!(await this.areEligibleFriends(requesterId, friendUserId))) this.notAvailable();
    const user = await this.prisma.user.findUnique({ where: { id: friendUserId }, select: { accountStatus: true, activeNetworkCompanion: { select: PUBLIC_SELECT } } });
    const companion = user?.activeNetworkCompanion;
    if (user?.accountStatus !== 'ACTIVE' || !companion || !companion.published || companion.visibility !== 'friends_only' || !companion.activeAssetPackId) this.notAvailable();
    return this.publicProfile(companion);
  }

  async initiateAssetPack(userId: string, companionId: string, dto: InitiateAssetPackDto) {
    this.requireStorage();
    const validated = validateManifest(dto.manifest, dto.manifestHash, this.storage.limits);
    if (dto.schemaVersion !== 1 || dto.totalFiles !== validated.manifest.files.length || dto.totalBytes !== validated.totalBytes) {
      throw new BadRequestException({ code: 'ASSET_PACK_MANIFEST_INVALID', message: 'Asset pack totals do not match its manifest' });
    }
    return this.prisma.$transaction(async tx => {
      await this.lockActiveAccountForAssetMutation(tx, userId);
      const companion = await tx.networkCompanion.findUnique({
        where: { id: companionId },
        select: { ownerUserId: true },
      });
      if (!companion) throw new NotFoundException({ code: 'COMPANION_NOT_FOUND', message: 'Companion was not found' });
      if (companion.ownerUserId !== userId) throw new ForbiddenException({ code: 'COMPANION_NOT_OWNED', message: 'Companion is not owned by this account' });

      const existing = await tx.companionAssetPack.findUnique({
        where: { companionId_manifestHash: { companionId, manifestHash: dto.manifestHash } },
        select: { ...PACK_SELECT, companion: { select: { activeAssetPackId: true } } },
      });
      if (existing) {
        const { companion: existingCompanion, ...existingPack } = existing;
        if (existing.status === 'active' || existing.status === 'superseded') {
          return {
            reused: true,
            requiresActivation: existing.status === 'superseded' || existingCompanion.activeAssetPackId !== existing.id,
            assetPack: this.pack(existingPack),
          };
        }
        if (existing.status === 'uploading' || existing.status === 'verifying') {
          this.assertUploadSessionCurrent(existing);
          let resumed: any = existingPack;
          if (existing.status === 'verifying') {
            const claimed = await tx.companionAssetPack.updateMany({ where: { id: existing.id, status: 'verifying' }, data: { status: 'uploading', failureCode: null, updatedAt: new Date() } });
            if (claimed.count !== 1) throw new ConflictException({ code: 'ASSET_PACK_STATE_CHANGED', message: 'Asset Pack state changed before resuming upload' });
            resumed = await tx.companionAssetPack.findUniqueOrThrow({ where: { id: existing.id }, select: PACK_SELECT });
          }
          const files = await tx.companionAssetFile.findMany({ where: { assetPackId: existing.id }, select: { id: true } });
          return { reused: false, resumed: true, assetPack: this.pack(resumed), fileIds: files.map(file => file.id) };
        }
        throw new ConflictException({ code: 'ASSET_PACK_ALREADY_EXISTS', message: 'An Asset Pack with this manifest already exists' });
      }
      const usage = await tx.companionAssetPack.aggregate({ where: { companion: { ownerUserId: userId }, status: { in: ['uploading', 'verifying', 'active', 'superseded'] } }, _sum: { totalBytes: true } });
      if ((usage._sum.totalBytes ?? BigInt(0)) + BigInt(validated.totalBytes) > BigInt(this.storage.limits.maxUserStorageBytes)) {
        throw new ConflictException({ code: 'ASSET_PACK_STORAGE_QUOTA_EXCEEDED', message: 'Network asset storage quota would be exceeded' });
      }
      const prefix = `companion-assets/${userId}/${companionId}/${dto.manifestHash}`;
      const assetPack = await tx.companionAssetPack.create({
        data: {
          companionId, manifestHash: dto.manifestHash, schemaVersion: 1, manifest: validated.manifest as any, status: 'uploading', objectPrefix: prefix,
          totalFiles: validated.manifest.files.length, totalBytes: BigInt(validated.totalBytes),
          files: { create: validated.manifest.files.map(file => ({ relativePath: file.relativePath, objectKey: `${prefix}/files/${file.relativePath}`, mimeType: file.mimeType, sizeBytes: BigInt(file.sizeBytes), sha256: file.sha256, category: file.category })) },
        },
        include: { files: true },
      });
      return { reused: false, assetPack: this.pack(assetPack), fileIds: assetPack.files.map(file => file.id) };
    });
  }

  async getAssetPacks(userId: string, companionId: string) {
    await this.requireOwnedCompanion(userId, companionId);
    const packs = await this.prisma.companionAssetPack.findMany({ where: { companionId }, select: PACK_SELECT, orderBy: { createdAt: 'desc' } });
    return packs.map(pack => this.pack(pack));
  }

  async createUploadUrls(userId: string, assetPackId: string, fileIds: string[]) {
    this.requireStorage();
    const pack = await this.requireOwnedPack(userId, assetPackId, true);
    this.assertUploadable(pack);
    if (!fileIds.length || fileIds.length > 50 || new Set(fileIds).size !== fileIds.length) throw new BadRequestException({ code: 'ASSET_PACK_FILE_INVALID', message: 'Upload URL requests require up to 50 unique files' });
    const files = await this.prisma.companionAssetFile.findMany({ where: { assetPackId, id: { in: fileIds } } });
    if (files.length !== fileIds.length) throw new NotFoundException({ code: 'ASSET_PACK_FILE_MISSING', message: 'Asset Pack file was not found' });
    const issuedAt = new Date();
    await this.prisma.$transaction(async tx => {
      await this.lockActiveAccountForAssetMutation(tx, userId);
      const issued = await tx.companionAssetPack.updateMany({
        where: {
          id: assetPackId,
          status: 'uploading',
          companion: { ownerUserId: userId },
        },
        data: { lastUploadUrlIssuedAt: issuedAt },
      });
      if (issued.count !== 1) {
        throw new ConflictException({
          code: 'ASSET_PACK_STATE_CHANGED',
          message: 'Asset Pack state changed before upload URLs were issued',
        });
      }
    });
    const urls = await Promise.all(files.map(async file => {
      const signed = await this.storage.createPutUrl(
        this.stagingObjectKey(pack.objectPrefix, file.id),
        file.mimeType,
        issuedAt,
      );
      return {
        fileId: file.id,
        relativePath: file.relativePath,
        uploadUrl: signed.url,
        expiresAt: signed.expiresAt,
        requiredHeaders: { 'content-type': file.mimeType },
      };
    }));
    return { uploads: urls };
  }

  async completeAssetPack(userId: string, assetPackId: string): Promise<CompleteAssetPackResult> {
    const ownedPack = await this.requireOwnedPack(userId, assetPackId, true);
    if (ownedPack.status === 'active') return this.completeEnvelopeForActivePack(ownedPack);
    this.requireStorage();
    if (!['uploading', 'verifying'].includes(ownedPack.status)) throw new ConflictException({ code: 'ASSET_PACK_NOT_UPLOADABLE', message: 'Asset Pack cannot be completed' });
    this.assertUploadSessionCurrent(ownedPack);

    if (ownedPack.status === 'uploading') {
      const claimed = await this.prisma.companionAssetPack.updateMany({
        where: { id: assetPackId, status: 'uploading' },
        data: { status: 'verifying', failureCode: null, updatedAt: new Date() },
      });
      if (claimed.count !== 1) {
        const latestAfterClaim = await this.requireOwnedPack(userId, assetPackId, true);
        if (latestAfterClaim.status === 'active') return this.completeEnvelopeForActivePack(latestAfterClaim);
        if (latestAfterClaim.status !== 'verifying') {
          throw new ConflictException({ code: 'ASSET_PACK_STATE_CHANGED', message: 'Asset Pack state changed before verification' });
        }
      }
    }

    const started = await this.requireOwnedPack(userId, assetPackId, true);
    if (started.status === 'active') return this.completeEnvelopeForActivePack(started);
    if (started.status !== 'verifying') throw new ConflictException({ code: 'ASSET_PACK_NOT_UPLOADABLE', message: 'Asset Pack cannot be completed' });
    try {
      for (const file of started.files) {
        const expectedSize = Number(file.sizeBytes);
        const stagingKey = this.stagingObjectKey(started.objectPrefix, file.id);
        const staging = await this.storage.inspectObjectSha256(stagingKey, expectedSize);
        if (!staging) throw new Error('ASSET_PACK_FILE_MISSING');
        if (
          staging.sizeBytes !== expectedSize
          || staging.mimeType !== file.mimeType
          || staging.sha256 !== file.sha256
        ) {
          throw new Error('ASSET_INTEGRITY_FAILED');
        }
        if (!staging.etag) throw new Error('ASSET_STORAGE_SOURCE_ETAG_MISSING');
        await this.storage.copyVerifiedObject(
          stagingKey,
          file.objectKey,
          staging.etag,
          file.mimeType,
          file.sha256,
        );
        const published = await this.storage.inspectObjectSha256(file.objectKey, expectedSize);
        if (
          !published
          || published.sizeBytes !== expectedSize
          || published.mimeType !== file.mimeType
          || published.sha256 !== file.sha256
        ) {
          throw new Error('ASSET_INTEGRITY_FAILED');
        }
      }
      const manifest = this.manifestFromPack(started);
      const validated = validateManifest(manifest, started.manifestHash, this.storage.limits);
      await this.storage.putManifest(`${started.objectPrefix}/manifest.json`, validated.canonicalJson);
      const completedAt = new Date();
      const result = await this.withActivePackUniqueRetry(() => this.prisma.$transaction(tx => this.activateVerifiedPackInTransaction(tx, {
        companionId: started.companionId,
        targetPackId: started.id,
        allowedTargetStatuses: ['verifying'],
        completedAt,
        afterTargetActivated: async transaction => {
          await transaction.companionAssetFile.updateMany({ where: { assetPackId: started.id }, data: { uploaded: true, verifiedAt: completedAt } });
        },
      })));
      await this.publishInvalidation(userId, 'companion.asset_pack.activated', { ownerUserId: userId, companionId: started.companionId, assetPackId: started.id });
      return { assetPack: this.pack(await this.prisma.companionAssetPack.findUniqueOrThrow({ where: { id: assetPackId }, select: PACK_SELECT })), companion: this.publicProfile(result) };
    } catch (error) {
      if (error instanceof ServiceUnavailableException || error instanceof ConflictException) throw error;
      if (error instanceof Error && error.message === 'ASSET_INTEGRITY_FAILED') {
        await this.prisma.companionAssetPack.updateMany({ where: { id: assetPackId, status: 'verifying' }, data: { status: 'failed', failureCode: 'ASSET_INTEGRITY_FAILED' } });
        throw new BadRequestException({ code: 'ASSET_INTEGRITY_FAILED', message: 'Uploaded Asset Pack could not be verified' });
      }
      await this.prisma.companionAssetPack.updateMany({ where: { id: assetPackId, status: 'verifying' }, data: { failureCode: 'ASSET_VERIFICATION_RETRYABLE' } });
      throw new ServiceUnavailableException({ code: 'ASSET_VERIFICATION_RETRYABLE', message: 'Asset verification can be retried shortly' });
    }
  }

  async activateAssetPack(userId: string, assetPackId: string) {
    const ownedPack = await this.requireOwnedPack(userId, assetPackId, true);
    const companion = await this.withActivePackUniqueRetry(() => this.prisma.$transaction(tx => this.activateVerifiedPackInTransaction(tx, {
      companionId: ownedPack.companionId,
      targetPackId: assetPackId,
      allowedTargetStatuses: ['superseded'],
    })));
    await this.publishInvalidation(userId, 'companion.asset_pack.activated', { ownerUserId: userId, companionId: ownedPack.companionId, assetPackId });
    return this.publicProfile(companion);
  }

  async deleteAssetPack(userId: string, assetPackId: string) {
    const pack = await this.requireOwnedPack(userId, assetPackId, true);
    if (!['draft', 'failed', 'abandoned'].includes(pack.status)) throw new ConflictException({ code: 'ASSET_PACK_NOT_UPLOADABLE', message: 'This Asset Pack cannot be deleted' });
    this.requireStorage();
    this.assertUploadUrlsExpired(pack.lastUploadUrlIssuedAt);
    const claimed = await this.prisma.companionAssetPack.updateMany({
      where: { id: assetPackId, status: pack.status, companion: { ownerUserId: userId } },
      data: { status: 'deleting', failureCode: null },
    });
    if (claimed.count !== 1) throw new ConflictException({ code: 'ASSET_PACK_STATE_CHANGED', message: 'Asset Pack state changed before deletion' });
    const files = await this.prisma.companionAssetFile.findMany({
      where: { assetPackId },
      select: { id: true, objectKey: true },
    });
    try {
      await this.storage.deleteObjects(this.objectKeysForDeletion(pack.objectPrefix, files));
      await this.storage.assertObjectPrefixDeleted(pack.objectPrefix);
    } catch (error) {
      await this.prisma.companionAssetPack.updateMany({
        where: { id: assetPackId, status: 'deleting' },
        data: { failureCode: 'ASSET_CLEANUP_FAILED' },
      }).catch(() => undefined);
      throw error;
    }
    await this.prisma.companionAssetPack.deleteMany({ where: { id: assetPackId, status: 'deleting' } });
    return { deleted: true };
  }

  async getManifest(userId: string, assetPackId: string) {
    const pack = await this.requireDownloadablePack(userId, assetPackId);
    return { manifest: this.manifestFromPack(pack), files: pack.files.map((file: any) => ({ id: file.id, relativePath: file.relativePath, sizeBytes: Number(file.sizeBytes), sha256: file.sha256, mimeType: file.mimeType })) };
  }

  async createDownloadUrls(userId: string, assetPackId: string, fileIds: string[]) {
    this.requireStorage();
    const pack = await this.requireDownloadablePack(userId, assetPackId);
    if (!fileIds.length || fileIds.length > 50 || new Set(fileIds).size !== fileIds.length) throw new BadRequestException({ code: 'ASSET_PACK_FILE_INVALID', message: 'Download URL requests require up to 50 unique files' });
    const files = await this.prisma.companionAssetFile.findMany({ where: { assetPackId: pack.id, id: { in: fileIds } } });
    if (files.length !== fileIds.length) this.notAvailable();
    return { downloads: await Promise.all(files.map(async file => {
      const signed = await this.storage.createGetUrl(file.objectKey);
      return { fileId: file.id, relativePath: file.relativePath, downloadUrl: signed.url, expiresAt: signed.expiresAt, sizeBytes: Number(file.sizeBytes), sha256: file.sha256, mimeType: file.mimeType };
    })) };
  }

  async abandonExpiredUploads(limit = 100) {
    const before = new Date(Date.now() - this.storage.limits.uploadSessionTtlHours * 3_600_000);
    const expired = { OR: [{ status: 'uploading', createdAt: { lt: before } }, { status: 'verifying', updatedAt: { lt: before } }] };
    const uploadUrlsExpired = this.uploadUrlsExpiredWhere();
    const packs = await this.prisma.companionAssetPack.findMany({
      take: limit,
      where: { AND: [{ OR: [expired, { status: 'abandoning' }] }, uploadUrlsExpired] },
      include: { files: { select: { id: true, objectKey: true } } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });
    let abandoned = 0;
    for (const pack of packs) {
      if (!this.storage.capability.uploadsEnabled) break;
      if (pack.status !== 'abandoning') {
        const claimed = await this.prisma.companionAssetPack.updateMany({
          where: { id: pack.id, AND: [expired, uploadUrlsExpired] },
          data: { status: 'abandoning', failureCode: null },
        });
        if (claimed.count !== 1) continue;
      }
      try {
        await this.storage.deleteObjects(this.objectKeysForDeletion(pack.objectPrefix, pack.files));
        await this.storage.assertObjectPrefixDeleted(pack.objectPrefix);
      } catch {
        await this.prisma.companionAssetPack.updateMany({
          where: { id: pack.id, status: 'abandoning' },
          data: { failureCode: 'ASSET_CLEANUP_FAILED' },
        }).catch(() => undefined);
        await this.refreshStorageAfterCleanupFailure();
        continue;
      }
      await this.prisma.companionAssetPack.update({ where: { id: pack.id }, data: { status: 'abandoned' } });
      abandoned++;
    }
    return abandoned;
  }

  async cleanupActivePackStaging(limit = 100) {
    const now = new Date();
    const cleanupBefore = this.activeStagingCleanupBefore(now);
    // A crashed worker can leave a running claim. One presigned-URL interval
    // is a conservative lease before another worker retries its idempotent delete.
    const staleClaimBefore = this.uploadUrlExpiredBefore(now);
    const eligibleClaim = {
      OR: [
        { failureCode: null },
        { failureCode: 'ASSET_STAGING_CLEANUP_RETRYABLE' },
        {
          failureCode: 'ASSET_STAGING_CLEANUP_RUNNING',
          updatedAt: { lt: staleClaimBefore },
        },
      ],
    };
    const cleanupFence = {
      status: 'active',
      stagingCleanedAt: null,
      activatedAt: { lt: cleanupBefore },
      AND: [this.uploadUrlsExpiredWhere(now), eligibleClaim],
    };
    const packs = await this.prisma.companionAssetPack.findMany({
      take: limit,
      where: cleanupFence,
      select: { id: true, objectPrefix: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });
    let cleaned = 0;
    for (const pack of packs) {
      if (!this.storage.capability.uploadsEnabled) break;
      const claimed = await this.prisma.companionAssetPack.updateMany({
        where: { id: pack.id, ...cleanupFence },
        data: { failureCode: 'ASSET_STAGING_CLEANUP_RUNNING' },
      });
      if (claimed.count !== 1) continue;
      try {
        await this.storage.deleteObjectPrefix(`${pack.objectPrefix}/staging`);
      } catch {
        await this.prisma.companionAssetPack.updateMany({
          where: {
            id: pack.id,
            status: 'active',
            stagingCleanedAt: null,
            failureCode: 'ASSET_STAGING_CLEANUP_RUNNING',
          },
          data: { failureCode: 'ASSET_STAGING_CLEANUP_RETRYABLE' },
        }).catch(() => undefined);
        await this.refreshStorageAfterCleanupFailure();
        continue;
      }
      const completed = await this.prisma.companionAssetPack.updateMany({
        where: {
          id: pack.id,
          status: 'active',
          stagingCleanedAt: null,
          failureCode: 'ASSET_STAGING_CLEANUP_RUNNING',
        },
        data: { stagingCleanedAt: new Date(), failureCode: null },
      });
      if (completed.count === 1) cleaned++;
    }
    return cleaned;
  }

  async cleanupSupersededPacks(limit = 100) {
    const before = new Date(Date.now() - this.storage.limits.supersededPackRetentionDays * 24 * 3_600_000);
    const noLiveVisit = {
      visitInvitationRefs: { none: { status: 'pending', assetPackRefId: { not: null } } },
      visitSessionRefs: { none: { state: { in: ['preparing', 'ready', 'active', 'ending'] }, assetPackRefId: { not: null } } },
    };
    const uploadUrlsExpired = this.uploadUrlsExpiredWhere();
    const packs = await this.prisma.companionAssetPack.findMany({
      take: limit,
      where: {
        AND: [
          { OR: [{ status: 'superseded', supersededAt: { lt: before }, ...noLiveVisit }, { status: 'deleting' }] },
          uploadUrlsExpired,
        ],
      },
      include: { files: { select: { id: true, objectKey: true } } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });
    let removed = 0;
    for (const pack of packs) {
      if (!this.storage.capability.uploadsEnabled) break;
      if (pack.status !== 'deleting') {
        const claimed = await this.prisma.companionAssetPack.updateMany({
          where: {
            id: pack.id,
            AND: [{ status: 'superseded', supersededAt: { lt: before }, ...noLiveVisit }, uploadUrlsExpired],
          },
          data: { status: 'deleting', failureCode: null },
        });
        if (claimed.count !== 1) continue;
      }
      try {
        await this.storage.deleteObjects(this.objectKeysForDeletion(pack.objectPrefix, pack.files));
        await this.storage.assertObjectPrefixDeleted(pack.objectPrefix);
      } catch {
        await this.prisma.companionAssetPack.updateMany({
          where: { id: pack.id, status: 'deleting' },
          data: { failureCode: 'ASSET_CLEANUP_FAILED' },
        }).catch(() => undefined);
        await this.refreshStorageAfterCleanupFailure();
        continue;
      }
      await this.prisma.companionAssetPack.delete({ where: { id: pack.id } });
      removed++;
    }
    return removed;
  }

  private async activateVerifiedPackInTransaction(
    tx: Prisma.TransactionClient,
    input: {
      companionId: string;
      targetPackId: string;
      allowedTargetStatuses: readonly string[];
      completedAt?: Date;
      afterTargetActivated?: (transaction: Prisma.TransactionClient) => Promise<unknown>;
    },
  ): Promise<any> {
    await tx.$queryRaw`
      SELECT "id"
      FROM "NetworkCompanion"
      WHERE "id" = ${input.companionId}
      FOR UPDATE
    `;

    const current = await tx.networkCompanion.findUnique({
      where: { id: input.companionId },
      select: { activeAssetPackId: true },
    });
    if (!current) throw new NotFoundException({ code: 'COMPANION_NOT_FOUND', message: 'Companion was not found' });

    const target = await tx.companionAssetPack.findUnique({
      where: { id: input.targetPackId },
      select: { id: true, companionId: true, status: true },
    });
    if (!target) throw new NotFoundException({ code: 'ASSET_PACK_NOT_FOUND', message: 'Asset Pack was not found' });
    if (target.companionId !== input.companionId) {
      throw new ConflictException({ code: 'ASSET_PACK_STATE_CHANGED', message: 'Asset Pack state changed' });
    }

    if (target.status === 'active') {
      if (current.activeAssetPackId === target.id) {
        return tx.networkCompanion.findUniqueOrThrow({ where: { id: input.companionId }, select: PUBLIC_SELECT });
      }

      // Repair a legacy/orphan active Pack deterministically while holding the same lock
      // used by normal activation. The partial index ensures this path cannot create a
      // second active Pack once the migration is installed.
      await tx.companionAssetPack.updateMany({
        where: { companionId: input.companionId, status: 'active', id: { not: target.id } },
        data: { status: 'superseded', supersededAt: new Date() },
      });
      return tx.networkCompanion.update({
        where: { id: input.companionId },
        data: { activeAssetPackId: target.id },
        select: PUBLIC_SELECT,
      });
    }

    if (!input.allowedTargetStatuses.includes(target.status)) {
      throw new ConflictException({ code: 'ASSET_PACK_STATE_CHANGED', message: 'Asset Pack state changed before activation' });
    }

    const activatedAt = input.completedAt ?? new Date();
    await tx.companionAssetPack.updateMany({
      where: { companionId: input.companionId, status: 'active', id: { not: target.id } },
      data: { status: 'superseded', supersededAt: activatedAt },
    });

    const claimed = await tx.companionAssetPack.updateMany({
      where: { id: target.id, companionId: input.companionId, status: target.status },
      data: {
        status: 'active',
        activatedAt,
        supersededAt: null,
        failureCode: null,
        ...(input.completedAt ? { completedAt: input.completedAt } : {}),
      },
    });
    if (claimed.count !== 1) {
      throw new ConflictException({ code: 'ASSET_PACK_STATE_CHANGED', message: 'Asset Pack state changed before activation' });
    }

    await input.afterTargetActivated?.(tx);
    return tx.networkCompanion.update({
      where: { id: input.companionId },
      data: { activeAssetPackId: target.id },
      select: PUBLIC_SELECT,
    });
  }

  private async withActivePackUniqueRetry<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (!this.isActivePackUniqueConflict(error)) throw error;
    }

    try {
      return await operation();
    } catch (error) {
      if (this.isActivePackUniqueConflict(error)) {
        throw new ConflictException({ code: 'ASSET_PACK_STATE_CHANGED', message: 'Asset Pack activation conflicted with another request' });
      }
      throw error;
    }
  }

  private isActivePackUniqueConflict(error: unknown): boolean {
    if (!error || typeof error !== 'object' || (error as { code?: string }).code !== 'P2002') return false;
    const target = (error as { meta?: { target?: unknown } }).meta?.target;
    // Prisma can report either the partial-index name or its constrained column.
    // This path only mutates Pack state, never the manifest uniqueness pair.
    return String(target).includes('CompanionAssetPack_one_active_per_companion')
      || (Array.isArray(target) && target.includes('companionId'));
  }

  private async requireOwnedCompanion(userId: string, companionId: string) {
    const companion = await this.prisma.networkCompanion.findUnique({ where: { id: companionId } });
    if (!companion) throw new NotFoundException({ code: 'COMPANION_NOT_FOUND', message: 'Companion was not found' });
    if (companion.ownerUserId !== userId) throw new ForbiddenException({ code: 'COMPANION_NOT_OWNED', message: 'Companion is not owned by this account' });
    return companion;
  }

  private async lockActiveAccountForAssetMutation(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { accountStatus: true, deletionRequestedAt: true },
    });
    if (!user || user.accountStatus !== 'ACTIVE' || user.deletionRequestedAt) {
      throw new ConflictException({
        code: 'ACCOUNT_DELETION_PENDING',
        message: 'Account deletion is already pending',
      });
    }
  }

  private async requireOwnedPack(userId: string, assetPackId: string, includeFiles = false): Promise<any> {
    const pack = await this.prisma.companionAssetPack.findUnique({ where: { id: assetPackId }, include: { companion: true, ...(includeFiles ? { files: true } : {}) } });
    if (!pack) throw new NotFoundException({ code: 'ASSET_PACK_NOT_FOUND', message: 'Asset Pack was not found' });
    if (pack.companion.ownerUserId !== userId) throw new ForbiddenException({ code: 'ASSET_PACK_NOT_OWNED', message: 'Asset Pack is not owned by this account' });
    return pack;
  }

  private async requireDownloadablePack(userId: string, assetPackId: string): Promise<any> {
    const pack = await this.prisma.companionAssetPack.findUnique({ where: { id: assetPackId }, include: { files: true, companion: true } });
    if (!pack || pack.status !== 'active' || pack.companion.activeAssetPackId !== pack.id) this.notAvailable();
    if (pack.companion.ownerUserId !== userId && (!pack.companion.published || !(await this.areEligibleFriends(userId, pack.companion.ownerUserId)))) this.notAvailable();
    return pack;
  }

  private assertUploadable(pack: { status: string; createdAt: Date }) {
    this.assertUploadSessionCurrent(pack);
    if (pack.status !== 'uploading') throw new ConflictException({ code: 'ASSET_PACK_NOT_UPLOADABLE', message: 'Asset Pack cannot accept uploads' });
  }
  private assertUploadUrlsExpired(lastIssuedAt?: Date | null) {
    if (!lastIssuedAt) return;
    const expiresAt = lastIssuedAt.getTime()
      + (this.storage.limits.uploadUrlTtlSeconds ?? 900) * 1_000
      + UPLOAD_URL_EXPIRY_SKEW_MS;
    if (Date.now() < expiresAt) {
      throw new ConflictException({
        code: 'ASSET_UPLOAD_URLS_ACTIVE',
        message: 'Asset Pack cleanup can begin after issued upload URLs expire',
      });
    }
  }
  private uploadUrlExpiredBefore(now = new Date()) {
    return new Date(
      now.getTime()
      - (this.storage.limits.uploadUrlTtlSeconds ?? 900) * 1_000
      - UPLOAD_URL_EXPIRY_SKEW_MS,
    );
  }
  private activeStagingCleanupBefore(now = new Date()) {
    const uploadUrlTtlMs = (this.storage.limits.uploadUrlTtlSeconds ?? 900) * 1_000;
    const uploadSessionTtlMs = (this.storage.limits.uploadSessionTtlHours ?? 24)
      * 3_600_000;
    return new Date(
      now.getTime()
      - Math.max(uploadUrlTtlMs, uploadSessionTtlMs)
      - UPLOAD_URL_EXPIRY_SKEW_MS,
    );
  }
  private uploadUrlsExpiredWhere(now = new Date()) {
    const expiredBefore = this.uploadUrlExpiredBefore(now);
    return {
      OR: [
        { lastUploadUrlIssuedAt: null },
        { lastUploadUrlIssuedAt: { lt: expiredBefore } },
      ],
    };
  }
  private async refreshStorageAfterCleanupFailure() {
    try {
      await this.storage.refreshCapability();
    } catch {
      // The next scheduled pass will retry capability recovery.
    }
  }
  private assertUploadSessionCurrent(pack: { createdAt: Date }) { if (Date.now() - pack.createdAt.getTime() > this.storage.limits.uploadSessionTtlHours * 3_600_000) throw new ConflictException({ code: 'ASSET_UPLOAD_SESSION_EXPIRED', message: 'Asset Pack upload session has expired' }); }
  private requireStorage() { if (!this.storage.capability.uploadsEnabled) throw new ServiceUnavailableException({ code: 'ASSET_STORAGE_UNAVAILABLE', message: 'Asset storage is currently unavailable' }); }
  private async completeEnvelopeForActivePack(pack: any): Promise<CompleteAssetPackResult> {
    const companion = await this.prisma.networkCompanion.findUniqueOrThrow({ where: { id: pack.companionId }, select: PUBLIC_SELECT });
    return { assetPack: this.pack(pack), companion: this.publicProfile(companion) };
  }
  private normalizeProfile(dto: UpsertCompanionDto) {
    const name = dto.name?.trim();
    const publicDescription = dto.publicDescription?.trim() || undefined;
    const tags = [...new Set((dto.publicTags ?? []).map(tag => tag.trim().toLowerCase()).filter(Boolean))];
    if (!name || name.length > 60 || (publicDescription && publicDescription.length > 500) || tags.length > 10 || tags.some(tag => tag.length > 30 || /[\x00-\x1F\x7F]/.test(tag))) throw new BadRequestException({ code: 'PUBLIC_PROFILE_INVALID', message: 'Public Companion profile is invalid' });
    return { name, publicDescription, publicTags: tags };
  }
  private publicProfile(companion: any) { return { ...companion, activeAssetPackId: companion.activeAssetPackId ?? undefined, publicDescription: companion.publicDescription ?? undefined, publishedAt: companion.publishedAt?.toISOString(), createdAt: companion.createdAt.toISOString(), updatedAt: companion.updatedAt.toISOString() }; }
  private pack(pack: any) {
    // File rows are internal upload bookkeeping and contain Prisma BigInt values.
    // API callers receive their IDs separately, so never serialize these rows here.
    const { files: _files, ...publicPack } = pack;
    return { ...publicPack, totalBytes: Number(publicPack.totalBytes), createdAt: publicPack.createdAt.toISOString(), updatedAt: publicPack.updatedAt.toISOString(), completedAt: publicPack.completedAt?.toISOString(), activatedAt: publicPack.activatedAt?.toISOString(), supersededAt: publicPack.supersededAt?.toISOString() };
  }
  private stagingObjectKey(objectPrefix: string, fileId: string): string {
    return `${objectPrefix}/staging/${fileId}`;
  }
  private objectKeysForDeletion(
    objectPrefix: string,
    files: Array<{ id?: string; objectKey: string }>,
  ): string[] {
    return [
      ...files.map(file => file.objectKey),
      ...files.filter(file => file.id).map(file =>
        this.stagingObjectKey(objectPrefix, file.id!)),
      `${objectPrefix}/manifest.json`,
    ];
  }
  private manifestFromPack(pack: any) { return pack.manifest; }
  private async areEligibleFriends(userId: string, otherUserId: string): Promise<boolean> { if (userId === otherUserId) return true; const [friendship, block] = await Promise.all([this.prisma.friendship.findUnique({ where: { userId_friendId: { userId, friendId: otherUserId } } }), this.prisma.blockedUser.findFirst({ where: { OR: [{ blockerId: userId, blockedId: otherUserId }, { blockerId: otherUserId, blockedId: userId }] } })]); return Boolean(friendship) && !block; }
  private async publishInvalidation(ownerUserId: string, event: string, payload: Record<string, string>) { this.events.publishToUser(ownerUserId, event, payload); const friends = await this.prisma.friendship.findMany({ where: { userId: ownerUserId }, select: { friendId: true } }); for (const friend of friends) if (await this.areEligibleFriends(ownerUserId, friend.friendId)) this.events.publishToUser(friend.friendId, event, payload); }
  private notAvailable(): never { throw new NotFoundException({ code: 'COMPANION_NOT_AVAILABLE', message: 'Companion is not available' }); }
}
