import { CompanionService } from './companion.service';
import { createHash } from 'node:crypto';
import { canonicalJsonStringify, canonicalManifest } from './asset-manifest';

// Upload-session tests must remain within their configured TTL regardless of
// when the suite is run.
const now = new Date();
const activePack = { id: 'pack-1', companionId: 'companion-1', status: 'active', manifestHash: 'a'.repeat(64), schemaVersion: 1, totalFiles: 1, totalBytes: BigInt(1), createdAt: now, updatedAt: now, completedAt: now, activatedAt: now, supersededAt: null, failureCode: null, companion: { ownerUserId: 'user-1' }, files: [] };

function uploadPack(status: 'uploading' | 'verifying' | 'abandoning' = 'uploading') {
  const files = ['Idle_Neutral', 'Enter', 'Leave'].map(name => ({ relativePath: `assets/animations/${name}.png`, category: 'animation' as const, mimeType: 'image/png', sizeBytes: 1, sha256: 'a'.repeat(64) }));
  const manifest = { format: 'our-companion-asset-pack' as const, schemaVersion: 1 as const, runtime: { defaultAnimation: 'Idle_Neutral' as const, animations: ['Idle_Neutral', 'Enter', 'Leave'].map(name => ({ name, format: 'sprite_sheet' as const, files: [`assets/animations/${name}.png`], frameWidth: 300, frameHeight: 300, frameCount: 1, frameDurationMs: 180, loop: name === 'Idle_Neutral' })) }, files };
  const manifestHash = createHash('sha256').update(canonicalJsonStringify(canonicalManifest(manifest)), 'utf8').digest('hex');
  return {
    id: 'pack-upload', companionId: 'companion-1', status, manifestHash, schemaVersion: 1, manifest, totalFiles: files.length, totalBytes: BigInt(files.length),
    createdAt: now, updatedAt: now, completedAt: null, activatedAt: null, supersededAt: null, failureCode: null,
    objectPrefix: 'redacted', companion: { ownerUserId: 'user-1', activeAssetPackId: null },
    files: files.map((file, index) => ({ ...file, id: `file-${index}`, assetPackId: 'pack-upload', objectKey: `redacted/${index}`, sizeBytes: BigInt(file.sizeBytes) })),
  };
}

describe('CompanionService final asset-pack lifecycle', () => {
  it('keeps internal asset file BigInts out of public Pack responses', () => {
    const service = new CompanionService({} as never, {} as never, {} as never);
    const pack = (service as any).pack({
      id: 'pack-1', totalBytes: BigInt(300), createdAt: now, updatedAt: now,
      files: [{ id: 'file-1', sizeBytes: BigInt(300) }],
    });
    expect(pack.files).toBeUndefined();
    expect(JSON.stringify(pack)).toContain('"totalBytes":300');
  });

  it('returns the stable completion envelope when an active completion is retried', async () => {
    const prisma = { companionAssetPack: { findUnique: jest.fn().mockResolvedValue(activePack) }, networkCompanion: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'companion-1', ownerUserId: 'user-1', name: 'Ann', publicDescription: null, publicTags: [], visibility: 'friends_only', published: false, activeAssetPackId: 'pack-1', createdAt: now, updatedAt: now, publishedAt: null }) } };
    const service = new CompanionService(prisma as never, { capability: { uploadsEnabled: true }, limits: {} } as never, {} as never);
    await expect(service.completeAssetPack('user-1', 'pack-1')).resolves.toMatchObject({ assetPack: { id: 'pack-1' }, companion: { id: 'companion-1' } });
  });

  it('returns an active retry envelope even while R2 is temporarily unavailable', async () => {
    const prisma = { companionAssetPack: { findUnique: jest.fn().mockResolvedValue(activePack) }, networkCompanion: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'companion-1', ownerUserId: 'user-1', name: 'Ann', publicDescription: null, publicTags: [], visibility: 'friends_only', published: false, activeAssetPackId: 'pack-1', createdAt: now, updatedAt: now, publishedAt: null }) } };
    const service = new CompanionService(prisma as never, { capability: { uploadsEnabled: false }, limits: {} } as never, {} as never);
    await expect(service.completeAssetPack('user-1', 'pack-1')).resolves.toMatchObject({ assetPack: { id: 'pack-1' }, companion: { id: 'companion-1' } });
  });

  it('requires activation when an otherwise reusable active pack is orphaned from its companion pointer', async () => {
    const orphan = { ...uploadPack('uploading'), status: 'active', companion: { activeAssetPackId: 'other-pack' } };
    const tx = {
      $queryRaw: jest.fn(),
      user: { findUnique: jest.fn().mockResolvedValue({ accountStatus: 'ACTIVE', deletionRequestedAt: null }) },
      networkCompanion: { findUnique: jest.fn().mockResolvedValue({ id: orphan.companionId, ownerUserId: 'user-1' }) },
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue(orphan) },
    };
    const prisma = {
      $transaction: jest.fn((operation) => operation(tx)),
    };
    const storage = { capability: { uploadsEnabled: true }, limits: { maxFileBytes: 10, maxPackBytes: 10, maxPackFiles: 10 } };
    const service = new CompanionService(prisma as never, storage as never, {} as never);

    await expect(service.initiateAssetPack('user-1', orphan.companionId, {
      manifest: orphan.manifest,
      manifestHash: orphan.manifestHash,
      schemaVersion: 1,
      totalFiles: orphan.totalFiles,
      totalBytes: Number(orphan.totalBytes),
    })).resolves.toMatchObject({ reused: true, requiresActivation: true, assetPack: { id: orphan.id } });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('does not initiate an Asset Pack after account deletion has been requested', async () => {
    const pack = uploadPack();
    const tx = {
      $queryRaw: jest.fn(),
      user: { findUnique: jest.fn().mockResolvedValue({ accountStatus: 'ACTIVE', deletionRequestedAt: new Date() }) },
      networkCompanion: { findUnique: jest.fn() },
      companionAssetPack: { findUnique: jest.fn(), aggregate: jest.fn(), create: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((operation) => operation(tx)) };
    const storage = {
      capability: { uploadsEnabled: true },
      limits: { maxFileBytes: 10, maxPackBytes: 10, maxPackFiles: 10, maxUserStorageBytes: 100 },
    };
    const service = new CompanionService(prisma as never, storage as never, {} as never);

    await expect(service.initiateAssetPack('user-1', pack.companionId, {
      manifest: pack.manifest,
      manifestHash: pack.manifestHash,
      schemaVersion: 1,
      totalFiles: pack.totalFiles,
      totalBytes: Number(pack.totalBytes),
    })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ACCOUNT_DELETION_PENDING' }) });
    expect(tx.networkCompanion.findUnique).not.toHaveBeenCalled();
    expect(tx.companionAssetPack.create).not.toHaveBeenCalled();
  });

  it('persists the exact upload signing time before issuing staging URLs', async () => {
    const pack = uploadPack();
    const file = pack.files[0];
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn(),
      user: { findUnique: jest.fn().mockResolvedValue({ accountStatus: 'ACTIVE', deletionRequestedAt: null }) },
      companionAssetPack: { updateMany },
    };
    const createPutUrl = jest.fn().mockResolvedValue({
      url: 'https://upload.invalid/staging',
      expiresAt: new Date(now.getTime() + 900_000).toISOString(),
    });
    const prisma = {
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue(pack) },
      companionAssetFile: { findMany: jest.fn().mockResolvedValue([file]) },
      $transaction: jest.fn((operation) => operation(tx)),
    };
    const storage = {
      capability: { uploadsEnabled: true },
      limits: { uploadSessionTtlHours: 24 },
      createPutUrl,
    };
    const service = new CompanionService(prisma as never, storage as never, {} as never);

    await expect(service.createUploadUrls('user-1', pack.id, [file.id])).resolves.toEqual({
      uploads: [{
        fileId: file.id,
        relativePath: file.relativePath,
        uploadUrl: 'https://upload.invalid/staging',
        expiresAt: expect.any(String),
        requiredHeaders: { 'content-type': file.mimeType },
      }],
    });

    const issuedAt = updateMany.mock.calls[0][0].data.lastUploadUrlIssuedAt;
    expect(issuedAt).toBeInstanceOf(Date);
    expect(createPutUrl).toHaveBeenCalledWith(
      `${pack.objectPrefix}/staging/${file.id}`,
      file.mimeType,
      issuedAt,
    );
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(createPutUrl.mock.invocationCallOrder[0]);
  });

  it('does not sign staging URLs after account deletion has been requested', async () => {
    const pack = uploadPack();
    const file = pack.files[0];
    const updateMany = jest.fn();
    const createPutUrl = jest.fn();
    const tx = {
      $queryRaw: jest.fn(),
      user: { findUnique: jest.fn().mockResolvedValue({ accountStatus: 'ACTIVE', deletionRequestedAt: new Date() }) },
      companionAssetPack: { updateMany },
    };
    const prisma = {
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue(pack) },
      companionAssetFile: { findMany: jest.fn().mockResolvedValue([file]) },
      $transaction: jest.fn((operation) => operation(tx)),
    };
    const service = new CompanionService(prisma as never, {
      capability: { uploadsEnabled: true },
      limits: { uploadSessionTtlHours: 24 },
      createPutUrl,
    } as never, {} as never);

    await expect(service.createUploadUrls('user-1', pack.id, [file.id]))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'ACCOUNT_DELETION_PENDING' }) });
    expect(updateMany).not.toHaveBeenCalled();
    expect(createPutUrl).not.toHaveBeenCalled();
  });

  it('skips cleanup when reactivation wins the superseded claim', async () => {
    const deleteObjects = jest.fn();
    const prisma = { companionAssetPack: { findMany: jest.fn().mockResolvedValue([{ id: 'pack-1', status: 'superseded', supersededAt: new Date('2026-06-01'), objectPrefix: 'redacted', files: [] }]), updateMany: jest.fn().mockResolvedValue({ count: 0 }), delete: jest.fn() } };
    const service = new CompanionService(prisma as never, { capability: { uploadsEnabled: true }, limits: { supersededPackRetentionDays: 30 }, deleteObjects } as never, { publishToUser: jest.fn() } as never);
    await expect(service.cleanupSupersededPacks()).resolves.toBe(0);
    expect(deleteObjects).not.toHaveBeenCalled();
    expect(prisma.companionAssetPack.delete).not.toHaveBeenCalled();
  });

  it('excludes superseded Packs pinned by a non-terminal Visit before cleanup can claim them', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CompanionService({ companionAssetPack: { findMany } } as never, { capability: { uploadsEnabled: true }, limits: { supersededPackRetentionDays: 30 } } as never, {} as never);
    await service.cleanupSupersededPacks();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ visitInvitationRefs: { none: { status: 'pending', assetPackRefId: { not: null } } }, visitSessionRefs: { none: { state: { in: ['preparing', 'ready', 'active', 'ending'] }, assetPackRefId: { not: null } } } })]) }) }));
  });

  it('keeps a claimed deleting pack for a later retry when R2 deletion fails', async () => {
    const prisma = { companionAssetPack: { findMany: jest.fn().mockResolvedValue([{ id: 'pack-1', status: 'deleting', objectPrefix: 'redacted', files: [] }]), updateMany: jest.fn().mockResolvedValue({ count: 1 }), delete: jest.fn() } };
    const service = new CompanionService(prisma as never, { capability: { uploadsEnabled: true }, limits: { supersededPackRetentionDays: 30 }, deleteObjects: jest.fn().mockRejectedValue(new Error('unavailable')) } as never, {} as never);
    await expect(service.cleanupSupersededPacks()).rejects.toThrow('unavailable');
    expect(prisma.companionAssetPack.updateMany).toHaveBeenCalledWith({
      where: { id: 'pack-1', status: 'deleting' },
      data: { failureCode: 'ASSET_CLEANUP_FAILED' },
    });
    expect(prisma.companionAssetPack.delete).not.toHaveBeenCalled();
  });

  it('never deletes objects for an active pack, even if a stale cleanup read includes it', async () => {
    const deleteObjects = jest.fn();
    const prisma = { companionAssetPack: { findMany: jest.fn().mockResolvedValue([{ id: 'pack-1', status: 'active', objectPrefix: 'redacted', files: [] }]), updateMany: jest.fn().mockResolvedValue({ count: 0 }), delete: jest.fn() } };
    const service = new CompanionService(prisma as never, { capability: { uploadsEnabled: true }, limits: { supersededPackRetentionDays: 30 }, deleteObjects } as never, {} as never);

    await expect(service.cleanupSupersededPacks()).resolves.toBe(0);
    expect(deleteObjects).not.toHaveBeenCalled();
  });

  it('rejects activation when cleanup claimed the stale superseded pack as deleting', async () => {
    const owned = { ...activePack, status: 'superseded' };
    const tx = {
      $queryRaw: jest.fn(),
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue({ id: owned.id, companionId: owned.companionId, status: 'deleting' }), updateMany: jest.fn() },
      networkCompanion: { findUnique: jest.fn().mockResolvedValue({ activeAssetPackId: 'other-pack' }), update: jest.fn() },
    };
    const prisma = { companionAssetPack: { findUnique: jest.fn().mockResolvedValue(owned) }, $transaction: jest.fn((operation) => operation(tx)) };
    const service = new CompanionService(prisma as never, {} as never, {} as never);

    await expect(service.activateAssetPack('user-1', owned.id)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ASSET_PACK_STATE_CHANGED' }) });
    expect(tx.companionAssetPack.updateMany).not.toHaveBeenCalled();
  });

  it('reactivates superseded packs with a transactional compare-and-swap claim', async () => {
    const owned = { ...activePack, status: 'superseded' };
    const publicCompanion = { id: owned.companionId, ownerUserId: 'user-1', name: 'Ann', publicDescription: null, publicTags: [], visibility: 'friends_only', published: false, activeAssetPackId: owned.id, createdAt: now, updatedAt: now, publishedAt: null };
    const tx = {
      $queryRaw: jest.fn(),
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue({ id: owned.id, companionId: owned.companionId, status: 'superseded' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      networkCompanion: { findUnique: jest.fn().mockResolvedValue({ activeAssetPackId: 'other-pack' }), update: jest.fn().mockResolvedValue(publicCompanion) },
    };
    const prisma = { companionAssetPack: { findUnique: jest.fn().mockResolvedValue(owned) }, friendship: { findMany: jest.fn().mockResolvedValue([]) }, $transaction: jest.fn((operation) => operation(tx)) };
    const service = new CompanionService(prisma as never, {} as never, { publishToUser: jest.fn() } as never);

    await expect(service.activateAssetPack('user-1', owned.id)).resolves.toMatchObject({ id: owned.companionId, activeAssetPackId: owned.id });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.companionAssetPack.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: expect.objectContaining({ companionId: owned.companionId, status: 'active', id: { not: owned.id } }), data: expect.objectContaining({ status: 'superseded' }) }));
    expect(tx.companionAssetPack.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ id: owned.id, status: 'superseded' }), data: expect.objectContaining({ status: 'active' }) }));
  });

  it('repairs an orphan active pack under the Companion lock', async () => {
    const owned = { ...activePack, companion: { ownerUserId: 'user-1' } };
    const publicCompanion = { id: owned.companionId, ownerUserId: 'user-1', name: 'Ann', publicDescription: null, publicTags: [], visibility: 'friends_only', published: false, activeAssetPackId: owned.id, createdAt: now, updatedAt: now, publishedAt: null };
    const tx = {
      $queryRaw: jest.fn(),
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue({ id: owned.id, companionId: owned.companionId, status: 'active' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      networkCompanion: { findUnique: jest.fn().mockResolvedValue({ activeAssetPackId: 'stale-pointer' }), findUniqueOrThrow: jest.fn(), update: jest.fn().mockResolvedValue(publicCompanion) },
    };
    const prisma = { companionAssetPack: { findUnique: jest.fn().mockResolvedValue(owned) }, friendship: { findMany: jest.fn().mockResolvedValue([]) }, $transaction: jest.fn((operation) => operation(tx)) };
    const service = new CompanionService(prisma as never, {} as never, { publishToUser: jest.fn() } as never);

    await expect(service.activateAssetPack('user-1', owned.id)).resolves.toMatchObject({ activeAssetPackId: owned.id });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.companionAssetPack.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companionId: owned.companionId, status: 'active', id: { not: owned.id } },
      data: expect.objectContaining({ status: 'superseded' }),
    }));
    expect(tx.networkCompanion.update).toHaveBeenCalledWith(expect.objectContaining({ data: { activeAssetPackId: owned.id } }));
  });

  it('retries a partial-active-index conflict once and maps a repeated conflict to a stable response', async () => {
    const service = new CompanionService({} as never, {} as never, {} as never);
    const uniqueConflict = { code: 'P2002', meta: { target: ['companionId'] } };
    const retryOnce = jest.fn().mockRejectedValueOnce(uniqueConflict).mockResolvedValueOnce('ok');
    await expect((service as any).withActivePackUniqueRetry(retryOnce)).resolves.toBe('ok');
    expect(retryOnce).toHaveBeenCalledTimes(2);

    await expect((service as any).withActivePackUniqueRetry(jest.fn().mockRejectedValue(uniqueConflict))).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ASSET_PACK_STATE_CHANGED' }) });
  });

  it('does not let Complete revive an upload cleanup claim to abandoning', async () => {
    const uploading = uploadPack('uploading');
    const abandoning = uploadPack('abandoning');
    const headObject = jest.fn();
    const prisma = {
      companionAssetPack: { findUnique: jest.fn().mockResolvedValueOnce(uploading).mockResolvedValueOnce(abandoning), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const service = new CompanionService(prisma as never, { capability: { uploadsEnabled: true }, limits: { uploadSessionTtlHours: 24 }, headObject } as never, {} as never);

    await expect(service.completeAssetPack('user-1', uploading.id)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ASSET_PACK_STATE_CHANGED' }) });
    expect(prisma.companionAssetPack.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: uploading.id, status: 'uploading' } }));
    expect(headObject).not.toHaveBeenCalled();
  });

  it('rejects Complete immediately for an already abandoning pack', async () => {
    const abandoning = uploadPack('abandoning');
    const updateMany = jest.fn();
    const prisma = { companionAssetPack: { findUnique: jest.fn().mockResolvedValue(abandoning), updateMany } };
    const service = new CompanionService(prisma as never, { capability: { uploadsEnabled: true }, limits: { uploadSessionTtlHours: 24 } } as never, {} as never);

    await expect(service.completeAssetPack('user-1', abandoning.id)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'ASSET_PACK_NOT_UPLOADABLE' }) });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('claims uploading to verifying before verification and activates only with a verifying CAS', async () => {
    const uploading = uploadPack('uploading');
    const verifying = uploadPack('verifying');
    const publicCompanion = { id: verifying.companionId, ownerUserId: 'user-1', name: 'Ann', publicDescription: null, publicTags: [], visibility: 'friends_only', published: false, activeAssetPackId: verifying.id, createdAt: now, updatedAt: now, publishedAt: null };
    const tx = {
      $queryRaw: jest.fn(),
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue({ id: verifying.id, companionId: verifying.companionId, status: 'verifying' }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      companionAssetFile: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
      networkCompanion: { findUnique: jest.fn().mockResolvedValue({ activeAssetPackId: null }), update: jest.fn().mockResolvedValue(publicCompanion) },
    };
    const prisma = {
      companionAssetPack: {
        findUnique: jest.fn().mockResolvedValueOnce(uploading).mockResolvedValueOnce(verifying),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ ...verifying, status: 'active' }),
      },
      friendship: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((operation) => operation(tx)),
    };
    const storage = {
      capability: { uploadsEnabled: true }, limits: { uploadSessionTtlHours: 24, maxFileBytes: 10, maxPackBytes: 10, maxPackFiles: 10 },
      inspectObjectSha256: jest.fn().mockResolvedValue({ sizeBytes: 1, mimeType: 'image/png', sha256: 'a'.repeat(64), etag: '"fixture-etag"' }),
      copyVerifiedObject: jest.fn(),
      putManifest: jest.fn(),
      deleteObjectPrefix: jest.fn(),
    };
    const service = new CompanionService(prisma as never, storage as never, { publishToUser: jest.fn() } as never);

    await expect(service.completeAssetPack('user-1', uploading.id)).resolves.toMatchObject({ assetPack: { id: uploading.id }, companion: { id: verifying.companionId } });
    expect(prisma.companionAssetPack.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: uploading.id, status: 'uploading' }, data: expect.objectContaining({ status: 'verifying' }) }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.companionAssetPack.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: expect.objectContaining({ id: verifying.id, status: 'verifying' }), data: expect.objectContaining({ status: 'active' }) }));
    expect(storage.copyVerifiedObject).toHaveBeenCalledTimes(verifying.files.length);
    expect(storage.deleteObjectPrefix).toHaveBeenCalledWith(`${verifying.objectPrefix}/staging`);
    expect(storage.deleteObjectPrefix.mock.invocationCallOrder[0]).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
  });

  it('rejects same-size staging bytes with the wrong SHA-256 before publishing', async () => {
    const uploading = uploadPack('uploading');
    const verifying = uploadPack('verifying');
    const copyVerifiedObject = jest.fn();
    const prisma = {
      companionAssetPack: {
        findUnique: jest.fn().mockResolvedValueOnce(uploading).mockResolvedValueOnce(verifying),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const storage = {
      capability: { uploadsEnabled: true },
      limits: { uploadSessionTtlHours: 24 },
      inspectObjectSha256: jest.fn().mockResolvedValue({
        sizeBytes: 1,
        mimeType: 'image/png',
        sha256: 'b'.repeat(64),
        etag: '"wrong-bytes"',
      }),
      copyVerifiedObject,
    };
    const service = new CompanionService(prisma as never, storage as never, {} as never);

    await expect(service.completeAssetPack('user-1', uploading.id))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'ASSET_INTEGRITY_FAILED' }) });
    expect(copyVerifiedObject).not.toHaveBeenCalled();
    expect(prisma.companionAssetPack.updateMany).toHaveBeenLastCalledWith({
      where: { id: uploading.id, status: 'verifying' },
      data: { status: 'failed', failureCode: 'ASSET_INTEGRITY_FAILED' },
    });
  });

  it('does not claim a recently started verification for abandonment cleanup', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CompanionService({ companionAssetPack: { findMany } } as never, { capability: { uploadsEnabled: true }, limits: { uploadSessionTtlHours: 24 } } as never, {} as never);

    await service.abandonExpiredUploads();

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ OR: expect.arrayContaining([expect.objectContaining({ status: 'verifying', updatedAt: expect.anything() })]) })]) }) }));
  });
});
