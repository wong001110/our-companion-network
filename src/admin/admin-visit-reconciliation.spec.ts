import { AdminApiService } from './admin-api.service';

const old = new Date(Date.now() - 20 * 60_000);
const recent = new Date();

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    invitationId: 'invitation-1',
    visitorOwnerUserId: 'visitor-1',
    hostUserId: 'host-1',
    networkCompanionId: 'companion-1',
    assetPackSnapshotId: 'pack-1',
    assetPackRefId: 'pack-1',
    state: 'active',
    visitorOwnerReadyAt: old,
    hostReadyAt: old,
    visitorOwnerSeenAt: old,
    hostSeenAt: old,
    readyAt: old,
    startedAt: old,
    endingAt: null,
    endedAt: null,
    endReason: null,
    failureCode: null,
    createdAt: old,
    updatedAt: old,
    ...overrides,
  };
}

function serviceWith(current: Record<string, unknown>) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    visitSession: {
      findUnique: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({
        ...current,
        ...data,
      })),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      (operation: (client: typeof tx) => unknown) => operation(tx),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue({ id: 'audit-1' }) };
  const events = { publishToUser: jest.fn() };
  const instance = new AdminApiService(
    prisma as never,
    audit as never,
    {} as never,
    { visitRuntimeConfig: { heartbeatTimeoutSeconds: 60 } } as never,
    events as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { instance, prisma, tx, audit, events };
}

describe('Admin Visit safe reconciliation', () => {
  it('row-locks a conservatively stale live session, clears its Pack ref, and audits atomically', async () => {
    const { instance, tx, audit, events } = serviceWith(session());

    await expect(instance.reconcileVisitSession(
      'admin-1',
      'session-1',
      'Heartbeat recovery exceeded the safe window',
    )).resolves.toMatchObject({
      id: 'session-1',
      state: 'ended',
      assetPackRefId: null,
    });

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.visitSession.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-1' },
      data: expect.objectContaining({
        state: 'ended',
        assetPackRefId: null,
        endReason: 'admin_safe_reconciliation:Heartbeat recovery exceeded the safe window',
      }),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: 'admin-1',
      action: 'RECONCILE_VISIT_SESSION',
      targetId: 'session-1',
      reason: 'Heartbeat recovery exceeded the safe window',
      metadata: expect.objectContaining({
        previousState: 'active',
        nextState: 'ended',
        hadAssetPackRef: true,
      }),
    }), tx);
    expect(events.publishToUser).toHaveBeenCalledWith(
      'visitor-1',
      'visit.session.ended',
      { sessionId: 'session-1', state: 'ended' },
    );
    expect(events.publishToUser).toHaveBeenCalledWith(
      'host-1',
      'visit.session.ended',
      { sessionId: 'session-1', state: 'ended' },
    );
  });

  it.each([
    ['healthy', session({ updatedAt: recent, hostSeenAt: recent }), 'VISIT_RECONCILIATION_NOT_STALE'],
    ['terminal', session({ state: 'ended', endedAt: old }), 'VISIT_RECONCILIATION_TERMINAL'],
  ])('refuses a %s session without mutating or auditing', async (_name, value, code) => {
    const { instance, tx, audit } = serviceWith(value);

    await expect(instance.reconcileVisitSession(
      'admin-1',
      'session-1',
      'Operator supplied reason',
    )).rejects.toMatchObject({ response: { code } });

    expect(tx.visitSession.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects a blank reason before opening a transaction', async () => {
    const { instance, prisma } = serviceWith(session());

    await expect(instance.reconcileVisitSession(
      'admin-1',
      'session-1',
      ' ',
    )).rejects.toMatchObject({
      response: { code: 'ADMIN_REASON_REQUIRED' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns explicit invitation acceptance and bounded diagnostic data', async () => {
    const record = session({
      state: 'ending',
      endingAt: old,
      failureCode: 'VISIT_RENDERER_FAILURE',
      invitation: { status: 'accepted', respondedAt: old },
    });
    const prisma = {
      visitSession: {
        findUnique: jest.fn().mockResolvedValue(record),
        findFirst: jest.fn().mockResolvedValue({ id: 'host-away-session' }),
      },
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const instance = new AdminApiService(
      prisma as never,
      {} as never,
      {} as never,
      { visitRuntimeConfig: { heartbeatTimeoutSeconds: 60 } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await instance.getVisitSession('session-1');

    expect(result.invitationAcceptedAt).toEqual(old);
    expect(result.diagnostics.filter((item) => item.active).map((item) => item.code))
      .toEqual(expect.arrayContaining([
        'HOST_AWAY_CONFLICT',
        'ASSET_AUTHORIZATION_FAILURE',
        'MISSING_ASSET_PACK',
        'STUCK_ENDING',
        'RENDERER_FAILURE',
      ]));
    expect(result.reconciliation).toMatchObject({
      eligible: true,
      code: 'STALE_LIVE_SESSION',
    });
  });

  it('does not report current host-away or missing-Pack conditions on a clean terminal session', async () => {
    const record = session({
      state: 'ended',
      endedAt: old,
      failureCode: null,
      endReason: 'completed',
      invitation: { status: 'accepted', respondedAt: old },
    });
    const prisma = {
      visitSession: {
        findUnique: jest.fn().mockResolvedValue(record),
        findFirst: jest.fn().mockResolvedValue({ id: 'current-host-away-session' }),
      },
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const instance = new AdminApiService(
      prisma as never,
      {} as never,
      {} as never,
      { visitRuntimeConfig: { heartbeatTimeoutSeconds: 60 } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await instance.getVisitSession('session-1');
    const active = result.diagnostics
      .filter((item) => item.active)
      .map((item) => item.code);

    expect(active).not.toContain('HOST_AWAY_CONFLICT');
    expect(active).not.toContain('MISSING_ASSET_PACK');
    expect(active).toContain('ENDED_WITH_LIVE_REF');
  });

  it('preserves historical terminal diagnostics recorded in failure fields', async () => {
    const record = session({
      state: 'failed',
      endedAt: old,
      failureCode: 'VISIT_HOST_COMPANION_AWAY',
      endReason: 'VISIT_ASSET_NOT_AVAILABLE',
      assetPackRefId: null,
      invitation: { status: 'accepted', respondedAt: old },
    });
    const prisma = {
      visitSession: {
        findUnique: jest.fn().mockResolvedValue(record),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const instance = new AdminApiService(
      prisma as never,
      {} as never,
      {} as never,
      { visitRuntimeConfig: { heartbeatTimeoutSeconds: 60 } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await instance.getVisitSession('session-1');
    const active = result.diagnostics
      .filter((item) => item.active)
      .map((item) => item.code);

    expect(active).toEqual(expect.arrayContaining([
      'HOST_AWAY_CONFLICT',
      'ASSET_AUTHORIZATION_FAILURE',
      'MISSING_ASSET_PACK',
    ]));
    expect(active).not.toContain('ENDED_WITH_LIVE_REF');
  });
});
