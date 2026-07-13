import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SocialEventPublisher } from '../common/social-event-publisher.service';
import { StorageService } from '../storage/storage.service';
import { InitiateAssetPackDto } from './dto/initiate-asset-pack.dto';
import { UpsertCompanionDto } from './dto/upsert-companion.dto';
import { validateManifest } from './asset-manifest';

const PUBLIC_SELECT = { id: true, ownerUserId: true, name: true, publicDescription: true, publicTags: true, visibility: true, published: true, activeAssetPackId: true, createdAt: true, updatedAt: true, publishedAt: true } as const;
const PACK_SELECT = { id: true, companionId: true, manifestHash: true, schemaVersion: true, status: true, totalFiles: true, totalBytes: true, failureCode: true, createdAt: true, updatedAt: true, completedAt: true, activatedAt: true, supersededAt: true } as const;

@Injectable()
export class CompanionService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly events: SocialEventPublisher) {}

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
      throw new ConflictException({ code: 'COMPANION_ALREADY_ACTIVE', message: 'This Companion is already active' });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { activeNetworkCompanionId: companionId } });
    await this.publishInvalidation(userId, 'companion.profile.updated', { ownerUserId: userId, companionId });
    return { activeNetworkCompanionId: companionId };
  }

  async publish(userId: string, companionId: string) {
    const companion = await this.requireOwnedCompanion(userId, companionId);
    if (!companion.activeAssetPackId) throw new ConflictException({ code: 'ASSET_PACK_NOT_COMPLETE', message: 'An active Asset Pack is required before publishing' });
    const published = await this.prisma.networkCompanion.update({ where: { id: companion.id }, data: { published: true, publishedAt: new Date() }, select: PUBLIC_SELECT });
    await this.publishInvalidation(userId, 'companion.profile.updated', { ownerUserId: userId, companionId });
    return this.publicProfile(published);
  }

  async unpublish(userId: string, companionId: string) {
    await this.requireOwnedCompanion(userId, companionId);
    const companion = await this.prisma.networkCompanion.update({ where: { id: companionId }, data: { published: false, publishedAt: null }, select: PUBLIC_SELECT });
    await this.publishInvalidation(userId, 'companion.profile.unpublished', { ownerUserId: userId, companionId });
    return this.publicProfile(companion);
  }

  async getFriendCompanion(requesterId: string, friendUserId: string) {
    if (!(await this.areEligibleFriends(requesterId, friendUserId))) this.notAvailable();
    const user = await this.prisma.user.findUnique({ where: { id: friendUserId }, select: { activeNetworkCompanion: { select: PUBLIC_SELECT } } });
    const companion = user?.activeNetworkCompanion;
    if (!companion || !companion.published || companion.visibility !== 'friends_only' || !companion.activeAssetPackId) this.notAvailable();
    return this.publicProfile(companion);
  }

  async initiateAssetPack(userId: string, companionId: string, dto: InitiateAssetPackDto) {
    const companion = await this.requireOwnedCompanion(userId, companionId);
    this.requireStorage();
    const validated = validateManifest(dto.manifest, dto.manifestHash, this.storage.limits);
    if (dto.schemaVersion !== 1 || dto.totalFiles !== validated.manifest.files.length || dto.totalBytes !== validated.totalBytes) {
      throw new BadRequestException({ code: 'ASSET_PACK_MANIFEST_INVALID', message: 'Asset pack totals do not match its manifest' });
    }
    const existing = await this.prisma.companionAssetPack.findUnique({ where: { companionId_manifestHash: { companionId, manifestHash: dto.manifestHash } }, select: PACK_SELECT });
    if (existing) {
      if (existing.status === 'active') return { reused: true, assetPack: this.pack(existing) };
      throw new ConflictException({ code: 'ASSET_PACK_ALREADY_EXISTS', message: 'An Asset Pack with this manifest already exists' });
    }
    const usage = await this.prisma.companionAssetPack.aggregate({ where: { companion: { ownerUserId: userId }, status: { in: ['uploading', 'verifying', 'active', 'superseded'] } }, _sum: { totalBytes: true } });
    if ((usage._sum.totalBytes ?? BigInt(0)) + BigInt(validated.totalBytes) > BigInt(this.storage.limits.maxUserStorageBytes)) {
      throw new ConflictException({ code: 'ASSET_PACK_STORAGE_QUOTA_EXCEEDED', message: 'Network asset storage quota would be exceeded' });
    }
    const prefix = `companion-assets/${userId}/${companionId}/${dto.manifestHash}`;
    const assetPack = await this.prisma.companionAssetPack.create({
      data: {
        companionId, manifestHash: dto.manifestHash, schemaVersion: 1, manifest: validated.manifest as any, status: 'uploading', objectPrefix: prefix,
        totalFiles: validated.manifest.files.length, totalBytes: BigInt(validated.totalBytes),
        files: { create: validated.manifest.files.map(file => ({ relativePath: file.relativePath, objectKey: `${prefix}/files/${file.relativePath}`, mimeType: file.mimeType, sizeBytes: BigInt(file.sizeBytes), sha256: file.sha256, category: file.category })) },
      },
      include: { files: true },
    });
    return { reused: false, assetPack: this.pack(assetPack), fileIds: assetPack.files.map(file => file.id) };
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
    const urls = await Promise.all(files.map(async file => {
      const signed = await this.storage.createPutUrl(file.objectKey, file.mimeType, file.sha256);
      return { fileId: file.id, relativePath: file.relativePath, uploadUrl: signed.url, expiresAt: signed.expiresAt, requiredHeaders: { 'content-type': file.mimeType, 'x-amz-meta-sha256': file.sha256 } };
    }));
    return { uploads: urls };
  }

  async completeAssetPack(userId: string, assetPackId: string) {
    this.requireStorage();
    const pack = await this.requireOwnedPack(userId, assetPackId, true);
    if (pack.status === 'active') return this.pack(pack);
    this.assertUploadable(pack);
    const started = await this.prisma.companionAssetPack.update({ where: { id: assetPackId }, data: { status: 'verifying' }, include: { files: true, companion: true } });
    try {
      for (const file of started.files) {
        const metadata = await this.storage.headObject(file.objectKey);
        if (!metadata || metadata.sizeBytes !== Number(file.sizeBytes) || metadata.mimeType !== file.mimeType || metadata.sha256 !== file.sha256) {
          throw new Error('ASSET_INTEGRITY_FAILED');
        }
      }
      const manifest = this.manifestFromPack(started);
      const validated = validateManifest(manifest, started.manifestHash, this.storage.limits);
      await this.storage.putManifest(`${started.objectPrefix}/manifest.json`, validated.canonicalJson);
      const result = await this.prisma.$transaction(async tx => {
        const oldId = started.companion.activeAssetPackId;
        if (oldId && oldId !== started.id) await tx.companionAssetPack.update({ where: { id: oldId }, data: { status: 'superseded', supersededAt: new Date() } });
        await tx.companionAssetPack.update({ where: { id: started.id }, data: { status: 'active', completedAt: new Date(), activatedAt: new Date(), failureCode: null, files: { updateMany: { where: {}, data: { uploaded: true, verifiedAt: new Date() } } } } });
        return tx.networkCompanion.update({ where: { id: started.companionId }, data: { activeAssetPackId: started.id }, select: PUBLIC_SELECT });
      });
      await this.publishInvalidation(userId, 'companion.asset_pack.activated', { ownerUserId: userId, companionId: started.companionId, assetPackId: started.id });
      return { assetPack: this.pack(await this.prisma.companionAssetPack.findUniqueOrThrow({ where: { id: assetPackId }, select: PACK_SELECT })), companion: this.publicProfile(result) };
    } catch (error) {
      await this.prisma.companionAssetPack.update({ where: { id: assetPackId }, data: { status: 'failed', failureCode: error instanceof Error && error.message === 'ASSET_INTEGRITY_FAILED' ? 'ASSET_INTEGRITY_FAILED' : 'ASSET_PACK_FILE_MISSING' } });
      throw new BadRequestException({ code: 'ASSET_INTEGRITY_FAILED', message: 'Uploaded Asset Pack could not be verified' });
    }
  }

  async activateAssetPack(userId: string, assetPackId: string) {
    const pack = await this.requireOwnedPack(userId, assetPackId, true);
    if (pack.status !== 'active') throw new ConflictException({ code: 'ASSET_PACK_NOT_COMPLETE', message: 'Only verified Asset Packs can be activated' });
    const companion = await this.prisma.networkCompanion.update({ where: { id: pack.companionId }, data: { activeAssetPackId: assetPackId }, select: PUBLIC_SELECT });
    return this.publicProfile(companion);
  }

  async deleteAssetPack(userId: string, assetPackId: string) {
    const pack = await this.requireOwnedPack(userId, assetPackId, true);
    if (!['draft', 'failed', 'abandoned'].includes(pack.status)) throw new ConflictException({ code: 'ASSET_PACK_NOT_UPLOADABLE', message: 'This Asset Pack cannot be deleted' });
    const files = await this.prisma.companionAssetFile.findMany({ where: { assetPackId }, select: { objectKey: true } });
    if (this.storage.capability.uploadsEnabled) await this.storage.deleteObjects([...files.map(file => file.objectKey), `${pack.objectPrefix}/manifest.json`]);
    await this.prisma.companionAssetPack.delete({ where: { id: assetPackId } });
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

  async abandonExpiredUploads() {
    const before = new Date(Date.now() - this.storage.limits.uploadSessionTtlHours * 3_600_000);
    const packs = await this.prisma.companionAssetPack.findMany({ where: { status: { in: ['uploading', 'verifying'] }, createdAt: { lt: before } }, include: { files: { select: { objectKey: true } } } });
    for (const pack of packs) {
      if (this.storage.capability.uploadsEnabled) await this.storage.deleteObjects([...pack.files.map(file => file.objectKey), `${pack.objectPrefix}/manifest.json`]);
      await this.prisma.companionAssetPack.update({ where: { id: pack.id }, data: { status: 'abandoned' } });
    }
    return packs.length;
  }

  private async requireOwnedCompanion(userId: string, companionId: string) {
    const companion = await this.prisma.networkCompanion.findUnique({ where: { id: companionId } });
    if (!companion) throw new NotFoundException({ code: 'COMPANION_NOT_FOUND', message: 'Companion was not found' });
    if (companion.ownerUserId !== userId) throw new ForbiddenException({ code: 'COMPANION_NOT_OWNED', message: 'Companion is not owned by this account' });
    return companion;
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
    if (Date.now() - pack.createdAt.getTime() > this.storage.limits.uploadSessionTtlHours * 3_600_000) throw new ConflictException({ code: 'ASSET_UPLOAD_SESSION_EXPIRED', message: 'Asset Pack upload session has expired' });
    if (pack.status !== 'uploading') throw new ConflictException({ code: 'ASSET_PACK_NOT_UPLOADABLE', message: 'Asset Pack cannot accept uploads' });
  }
  private requireStorage() { if (!this.storage.capability.uploadsEnabled) throw new ServiceUnavailableException({ code: 'ASSET_STORAGE_UNAVAILABLE', message: 'Asset storage is currently unavailable' }); }
  private normalizeProfile(dto: UpsertCompanionDto) {
    const name = dto.name?.trim();
    const publicDescription = dto.publicDescription?.trim() || undefined;
    const tags = [...new Set((dto.publicTags ?? []).map(tag => tag.trim().toLowerCase()).filter(Boolean))];
    if (!name || name.length > 60 || (publicDescription && publicDescription.length > 500) || tags.length > 10 || tags.some(tag => tag.length > 30 || /[\x00-\x1F\x7F]/.test(tag))) throw new BadRequestException({ code: 'PUBLIC_PROFILE_INVALID', message: 'Public Companion profile is invalid' });
    return { name, publicDescription, publicTags: tags };
  }
  private publicProfile(companion: any) { return { ...companion, activeAssetPackId: companion.activeAssetPackId ?? undefined, publicDescription: companion.publicDescription ?? undefined, publishedAt: companion.publishedAt?.toISOString(), createdAt: companion.createdAt.toISOString(), updatedAt: companion.updatedAt.toISOString() }; }
  private pack(pack: any) { return { ...pack, totalBytes: Number(pack.totalBytes), createdAt: pack.createdAt.toISOString(), updatedAt: pack.updatedAt.toISOString(), completedAt: pack.completedAt?.toISOString(), activatedAt: pack.activatedAt?.toISOString(), supersededAt: pack.supersededAt?.toISOString() }; }
  private manifestFromPack(pack: any) { return pack.manifest; }
  private async areEligibleFriends(userId: string, otherUserId: string): Promise<boolean> { if (userId === otherUserId) return true; const [friendship, block] = await Promise.all([this.prisma.friendship.findUnique({ where: { userId_friendId: { userId, friendId: otherUserId } } }), this.prisma.blockedUser.findFirst({ where: { OR: [{ blockerId: userId, blockedId: otherUserId }, { blockerId: otherUserId, blockedId: userId }] } })]); return Boolean(friendship) && !block; }
  private async publishInvalidation(ownerUserId: string, event: string, payload: Record<string, string>) { this.events.publishToUser(ownerUserId, event, payload); const friends = await this.prisma.friendship.findMany({ where: { userId: ownerUserId }, select: { friendId: true } }); for (const friend of friends) if (await this.areEligibleFriends(ownerUserId, friend.friendId)) this.events.publishToUser(friend.friendId, event, payload); }
  private notAvailable(): never { throw new NotFoundException({ code: 'COMPANION_NOT_AVAILABLE', message: 'Companion is not available' }); }
}
