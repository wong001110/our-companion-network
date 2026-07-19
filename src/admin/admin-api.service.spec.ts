import { UserAccountStatus } from '@prisma/client';
import { AdminApiService } from './admin-api.service';

describe('AdminApiService audited state changes', () => {
  it('searches Accounts and Companions with bounded safe projections', async () => {
    const userFindMany = jest.fn().mockReturnValue('user-query');
    const userCount = jest.fn().mockReturnValue('user-count');
    const companionFindMany = jest.fn().mockReturnValue('companion-query');
    const companionCount = jest.fn().mockReturnValue('companion-count');
    const transaction = jest.fn()
      .mockResolvedValueOnce([[], 0])
      .mockResolvedValueOnce([[], 0]);
    const service = new AdminApiService(
      {
        user: { findMany: userFindMany, count: userCount },
        networkCompanion: {
          findMany: companionFindMany,
          count: companionCount,
        },
        $transaction: transaction,
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
      search: 'OC-KEEPER',
      page: 1,
      limit: 20,
      direction: 'desc',
    } as never);
    await service.listCompanions({
      search: 'Mochi',
      page: 1,
      limit: 20,
      direction: 'desc',
    } as never);

    expect(userFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 20,
      where: {
        OR: expect.arrayContaining([
          { uid: { contains: 'OC-KEEPER', mode: 'insensitive' } },
          { email: { contains: 'OC-KEEPER', mode: 'insensitive' } },
          { friendCode: { contains: 'OC-KEEPER', mode: 'insensitive' } },
        ]),
      },
    }));
    expect(companionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 20,
      where: {
        OR: expect.arrayContaining([
          { name: { contains: 'Mochi', mode: 'insensitive' } },
          {
            owner: {
              uid: { contains: 'Mochi', mode: 'insensitive' },
            },
          },
        ]),
      },
    }));
    const projections = JSON.stringify([
      userFindMany.mock.calls,
      companionFindMany.mock.calls,
    ]);
    expect(projections).not.toMatch(
      /passwordHash|refreshTokenHash|previousRefreshTokenHash|csrfTokenHash|objectKey/,
    );
  });

  it('inspects Accounts, Companions, and Visit Sessions without serializing secrets', async () => {
    const userFindUnique = jest.fn().mockResolvedValue({
      id: 'user-1',
      uid: 'OC-USER0001',
      friendships: [],
      blockedUsers: [],
      blockedBy: [],
      visitInvitationsOwned: [],
      visitInvitationsHosted: [],
      visitSessionsOwned: [],
      visitSessionsHosted: [],
      notifications: [],
      _count: { notifications: 0 },
    });
    const companionFindUnique = jest.fn().mockResolvedValue({
      id: 'companion-1',
      name: 'Mochi',
      totalBytes: 25n,
    });
    const sessionFindUnique = jest.fn().mockResolvedValue({
      id: 'session-1',
      visitorOwnerUserId: 'user-1',
      hostUserId: 'user-2',
      networkCompanionId: 'companion-1',
      assetPackSnapshotId: 'pack-1',
      assetPackRefId: 'pack-1',
      state: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
      invitation: { status: 'accepted', respondedAt: new Date() },
    });
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new AdminApiService(
      {
        user: { findUnique: userFindUnique },
        notification: { count: jest.fn().mockResolvedValue(0) },
        adminAuditLog: { findMany: jest.fn().mockResolvedValue([]) },
        networkCompanion: { findUnique: companionFindUnique },
        companionAssetPack: {
          findMany: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
          findUnique: jest.fn().mockResolvedValue({
            id: 'pack-1',
            companionId: 'companion-1',
            status: 'active',
          }),
        },
        visitSession: {
          findUnique: sessionFindUnique,
          findFirst: jest.fn().mockResolvedValue(null),
        },
      } as never,
      audit as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.getUser('admin-1', 'user-1'))
      .resolves.toMatchObject({ id: 'user-1' });
    await expect(service.getCompanion('companion-1'))
      .resolves.toMatchObject({ id: 'companion-1', totalBytes: 25 });
    await expect(service.getVisitSession('session-1'))
      .resolves.toMatchObject({ id: 'session-1', state: 'active' });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'VIEW_SENSITIVE_ACCOUNT',
      targetId: 'user-1',
    }));

    const projections = JSON.stringify([
      userFindUnique.mock.calls,
      companionFindUnique.mock.calls,
      sessionFindUnique.mock.calls,
    ]);
    expect(projections).not.toMatch(
      /passwordHash|refreshTokenHash|previousRefreshTokenHash|csrfTokenHash|JWT|DATABASE_URL|objectKey/,
    );
  });

  it('requires reasons and audits ending a Session and cancelling an Invitation', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      visitSession: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'session-1',
          visitorOwnerUserId: 'visitor-1',
          hostUserId: 'host-1',
          state: 'active',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'session-1',
          visitorOwnerUserId: 'visitor-1',
          hostUserId: 'host-1',
          state: 'ended',
        }),
      },
      visitInvitation: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'invitation-1',
          visitorOwnerUserId: 'visitor-1',
          hostUserId: 'host-1',
          status: 'pending',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'invitation-1',
          visitorOwnerUserId: 'visitor-1',
          hostUserId: 'host-1',
          status: 'cancelled',
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: unknown) => unknown) => operation(tx),
      ),
    };
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const events = { publishToUser: jest.fn() };
    const service = new AdminApiService(
      prisma as never,
      audit as never,
      {} as never,
      {} as never,
      events as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(service.endVisitSession(
      'admin-1',
      'session-1',
      ' ',
    )).rejects.toMatchObject({
      response: { code: 'ADMIN_REASON_REQUIRED' },
    });
    await expect(service.cancelVisitInvitation(
      'admin-1',
      'invitation-1',
      'no',
    )).rejects.toMatchObject({
      response: { code: 'ADMIN_REASON_REQUIRED' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();

    await expect(service.endVisitSession(
      'admin-1',
      'session-1',
      'Session heartbeat is stale',
    )).resolves.toMatchObject({ id: 'session-1', state: 'ended' });
    await expect(service.cancelVisitInvitation(
      'admin-1',
      'invitation-1',
      'Invitation references a missing Pack',
    )).resolves.toMatchObject({
      id: 'invitation-1',
      status: 'cancelled',
    });
    expect(tx.visitSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-1' },
      data: expect.objectContaining({
        state: 'ended',
        endReason: 'admin:Session heartbeat is stale',
        assetPackRefId: null,
      }),
    }));
    expect(tx.visitInvitation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'invitation-1' },
      data: expect.objectContaining({
        status: 'cancelled',
        assetPackRefId: null,
      }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'END_VISIT_SESSION',
      targetId: 'session-1',
      reason: 'Session heartbeat is stale',
    }), tx);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'CANCEL_VISIT_INVITATION',
      targetId: 'invitation-1',
      reason: 'Invitation references a missing Pack',
    }), tx);
    expect(events.publishToUser).toHaveBeenCalledWith(
      'visitor-1',
      'visit.session.ended',
      { sessionId: 'session-1', state: 'ended' },
    );
    expect(events.publishToUser).toHaveBeenCalledWith(
      'host-1',
      'visit.invitation.updated',
      { invitationId: 'invitation-1' },
    );
  });

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

  it('does not restore an account while deferred deletion is pending', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'user-1',
          uid: 'OC-USER0001',
          accountStatus: 'SUSPENDED',
          deletionRequestedAt: new Date('2026-07-19T00:00:00.000Z'),
        }),
        update: jest.fn(),
      },
      deviceSession: { updateMany: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(
        (operation: (client: typeof tx) => unknown) => operation(tx),
      ),
    };
    const audit = { record: jest.fn() };
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
      UserAccountStatus.ACTIVE,
      'Deletion request needs review',
    )).rejects.toMatchObject({
      response: { code: 'ACCOUNT_DELETION_PENDING' },
    });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.deviceSession.updateMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
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
        .mockResolvedValueOnce({ sizeBytes: 10 })
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
