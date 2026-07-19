import { AdminApiService } from './admin-api.service';
import { AuditService } from './audit.service';

describe('Admin Portal acceptance regressions', () => {
  it('uses an inclusive date-only upper bound on admin lists', async () => {
    const findMany = jest.fn().mockReturnValue('users-query');
    const service = new AdminApiService(
      {
        user: {
          findMany,
          count: jest.fn().mockReturnValue('count-query'),
        },
        $transaction: jest.fn().mockResolvedValue([[], 0]),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await service.listUsers({
      page: 1,
      limit: 20,
      direction: 'desc',
      dateTo: '2026-07-19',
    } as never);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        createdAt: {
          lte: new Date('2026-07-19T23:59:59.999Z'),
        },
      },
    }));
  });

  it('uses an inclusive date-only upper bound on Audit Log lists', async () => {
    const findMany = jest.fn().mockReturnValue('audit-query');
    const service = new AuditService({
      adminAuditLog: {
        findMany,
        count: jest.fn().mockReturnValue('count-query'),
      },
      $transaction: jest.fn().mockResolvedValue([[], 0]),
    } as never);

    await service.list({
      page: 1,
      limit: 20,
      direction: 'desc',
      dateTo: '2026-07-19',
    } as never);

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        createdAt: {
          lte: new Date('2026-07-19T23:59:59.999Z'),
        },
      },
    }));
  });

  it('loads the full valid 1,000-file inspector window', async () => {
    const now = new Date('2026-07-19T00:00:00.000Z');
    const files = Array.from({ length: 101 }, (_, index) => ({
      id: `file-${index}`,
      relativePath: `assets/${index}.png`,
      objectKey: `packs/owner/pack/assets/${index}.png`,
      mimeType: 'image/png',
      sizeBytes: 1n,
      sha256: 'a'.repeat(64),
      category: 'animation',
      uploaded: true,
      verifiedAt: now,
    }));
    const findUnique = jest.fn().mockResolvedValue({
      id: 'pack-1',
      companionId: 'companion-1',
      manifestHash: 'b'.repeat(64),
      schemaVersion: 1,
      manifest: { malformed: true },
      status: 'active',
      objectPrefix: 'packs/owner/pack',
      totalFiles: files.length,
      totalBytes: BigInt(files.length),
      failureCode: null,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      activatedAt: now,
      supersededAt: null,
      files,
      _count: {
        files: files.length,
        visitInvitationRefs: 0,
        visitSessionRefs: 0,
      },
    });
    const actualKeys = [
      'packs/owner/pack/manifest.json',
      ...files.map((file) => file.objectKey),
    ];
    const storage = {
      capability: { downloadsEnabled: true },
      limits: {
        maxFileBytes: 10,
        maxPackBytes: 2_000,
        maxPackFiles: 1_000,
      },
      listObjectKeys: jest.fn().mockResolvedValue(actualKeys),
      headObject: jest.fn((key: string) => Promise.resolve(
        key.endsWith('manifest.json')
          ? { sizeBytes: 1, mimeType: 'application/json' }
          : { sizeBytes: 1, mimeType: 'image/png', sha256: 'a'.repeat(64) },
      )),
    };
    const service = new AdminApiService(
      { companionAssetPack: { findUnique } } as never,
      {} as never,
      storage as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await service.getAssetPack('pack-1');

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        files: expect.objectContaining({ take: 1_000 }),
      }),
    }));
    expect(result.files).toHaveLength(101);
    expect(result.storageInspection).toMatchObject({
      missingObjects: [],
      orphanObjects: [],
      shaMismatches: [],
      metadataMismatches: [],
      fileInspectionTruncated: false,
    });
  });
});
