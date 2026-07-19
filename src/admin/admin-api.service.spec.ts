import { UserAccountStatus } from '@prisma/client';
import { AdminApiService } from './admin-api.service';

describe('AdminApiService audited state changes', () => {
  it('suspends, revokes sessions, and audits in one transaction', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          uid: 'OC-USER0001',
          accountStatus: 'ACTIVE',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'user-1',
          accountStatus: 'SUSPENDED',
        }),
      },
      deviceSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const prisma = {
      $transaction: jest.fn((operation: (client: unknown) => unknown) => operation(tx)),
    };
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new AdminApiService(
      prisma as never,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.setAccountStatus(
      'admin-1',
      'user-1',
      UserAccountStatus.SUSPENDED,
      'Security investigation',
    )).resolves.toMatchObject({ accountStatus: 'SUSPENDED' });
    expect(tx.deviceSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: expect.any(Date), csrfTokenHash: null },
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SUSPEND_ACCOUNT',
      targetId: 'user-1',
      reason: 'Security investigation',
    }), tx);
  });

  it('requires a meaningful reason and forbids self-suspension', async () => {
    const service = new AdminApiService(
      {} as never, {} as never, {} as never, {} as never,
      {} as never, {} as never, {} as never, {} as never,
    );
    await expect(service.setAccountStatus(
      'admin-1', 'user-1', UserAccountStatus.SUSPENDED, ' ',
    )).rejects.toMatchObject({ response: { code: 'ADMIN_REASON_REQUIRED' } });
    await expect(service.setAccountStatus(
      'admin-1', 'admin-1', UserAccountStatus.SUSPENDED, 'Bad action',
    )).rejects.toMatchObject({
      response: { code: 'ADMIN_SELF_SUSPEND_FORBIDDEN' },
    });
  });

  it('writes an immutable cleanup request before destructive storage work and records the outcome', async () => {
    const audit = {
      record: jest.fn()
        .mockResolvedValueOnce({ id: 'audit-request' })
        .mockResolvedValue({ id: 'audit-outcome' }),
    };
    const companions = {
      abandonExpiredUploads: jest.fn().mockResolvedValue(2),
      cleanupSupersededPacks: jest.fn().mockResolvedValue(3),
    };
    const service = new AdminApiService(
      {} as never,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
      companions as never,
      {} as never,
      {} as never,
    );

    await expect(service.cleanupStorage(
      'admin-1',
      'Scheduled caretaker cleanup',
    )).resolves.toEqual({ abandoned: 2, removed: 3 });
    expect(audit.record.mock.invocationCallOrder[0])
      .toBeLessThan(companions.abandonExpiredUploads.mock.invocationCallOrder[0]);
    expect(companions.abandonExpiredUploads.mock.invocationCallOrder[0])
      .toBeLessThan(companions.cleanupSupersededPacks.mock.invocationCallOrder[0]);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RUN_STORAGE_CLEANUP',
      metadata: { phase: 'requested' },
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE_ASSET_PACK',
      metadata: expect.objectContaining({
        phase: 'completed',
        requestAuditId: 'audit-request',
        abandoned: 2,
        removed: 3,
      }),
    }));
  });

  it('does not begin cleanup when the prerequisite audit write fails', async () => {
    const audit = {
      record: jest.fn().mockRejectedValue(new Error('audit unavailable')),
    };
    const companions = {
      abandonExpiredUploads: jest.fn(),
      cleanupSupersededPacks: jest.fn(),
    };
    const service = new AdminApiService(
      {} as never,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
      companions as never,
      {} as never,
      {} as never,
    );

    await expect(service.cleanupStorage(
      'admin-1',
      'Scheduled caretaker cleanup',
    )).rejects.toThrow('audit unavailable');
    expect(companions.abandonExpiredUploads).not.toHaveBeenCalled();
    expect(companions.cleanupSupersededPacks).not.toHaveBeenCalled();
  });

  it('inspects bounded R2 object existence, metadata, hashes, manifest, and orphans', async () => {
    const now = new Date('2026-07-19T00:00:00.000Z');
    const pack = {
      id: 'pack-1',
      companionId: 'companion-1',
      manifestHash: '0'.repeat(64),
      schemaVersion: 1,
      manifest: { malformed: true },
      status: 'active',
      objectPrefix: 'companion-assets/user/companion/hash',
      totalFiles: 2,
      totalBytes: 30n,
      failureCode: null,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      activatedAt: now,
      supersededAt: null,
      files: [
        {
          id: 'file-a',
          relativePath: 'assets/a.png',
          objectKey: 'companion-assets/user/companion/hash/assets/a.png',
          mimeType: 'image/png',
          sizeBytes: 10n,
          sha256: 'a'.repeat(64),
          category: 'animation',
          uploaded: true,
          verifiedAt: now,
        },
        {
          id: 'file-b',
          relativePath: 'assets/b.png',
          objectKey: 'companion-assets/user/companion/hash/assets/b.png',
          mimeType: 'image/png',
          sizeBytes: 20n,
          sha256: 'b'.repeat(64),
          category: 'animation',
          uploaded: true,
          verifiedAt: now,
        },
      ],
      _count: { visitInvitationRefs: 1, visitSessionRefs: 2 },
    };
    const prisma = {
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue(pack) },
    };
    const storage = {
      capability: { downloadsEnabled: true },
      limits: { maxFileBytes: 100, maxPackBytes: 1_000, maxPackFiles: 100 },
      listObjectKeys: jest.fn().mockResolvedValue([
        `${pack.objectPrefix}/manifest.json`,
        pack.files[0].objectKey,
        `${pack.objectPrefix}/orphan.tmp`,
      ]),
      headObject: jest.fn()
        .mockResolvedValueOnce({ sizeBytes: 10, mimeType: 'application/json' })
        .mockResolvedValueOnce({ sizeBytes: 11, mimeType: 'image/png', sha256: 'c'.repeat(64) })
        .mockResolvedValueOnce(null),
    };
    const service = new AdminApiService(
      prisma as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.getAssetPack(pack.id)).resolves.toMatchObject({
      totalBytes: 30,
      files: [
        { relativePath: 'assets/a.png', r2ObjectExists: true, r2Integrity: 'mismatch' },
        { relativePath: 'assets/b.png', r2ObjectExists: false, r2Integrity: 'missing' },
      ],
      storageInspection: {
        available: true,
        manifestMismatch: true,
        manifestObjectExists: true,
        missingObjects: ['assets/b.png'],
        orphanObjects: [`${pack.objectPrefix}/orphan.tmp`],
        shaMismatches: ['assets/a.png'],
        metadataMismatches: ['assets/a.png'],
      },
    });
  });
});
