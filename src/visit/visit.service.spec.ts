import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { VisitService } from './visit.service';
import { VISUAL_VISIT_REQUIRED_ANIMATIONS } from '../companion/asset-manifest';

const now = new Date('2026-07-13T12:00:00.000Z');
const owner = '11111111-1111-4111-8111-111111111111';
const host = '22222222-2222-4222-8222-222222222222';
const invitationId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';
const companionId = '55555555-5555-4555-8555-555555555555';
const packId = '66666666-6666-4666-8666-666666666666';

const visualManifest = (omitted?: string) => ({ runtime: { animations: VISUAL_VISIT_REQUIRED_ANIMATIONS.filter(name => name !== omitted).map(name => ({ name })) } });

function invitation(status = 'pending') {
  return { id: invitationId, visitorOwnerUserId: owner, hostUserId: host, networkCompanionId: companionId, assetPackSnapshotId: packId, assetPackRefId: status === 'pending' ? packId : null, companionName: 'Ann', companionDescription: 'Public', companionTags: ['kind'], status, expiresAt: new Date(now.getTime() + 60_000), respondedAt: null, cancelledAt: null, createdAt: now, updatedAt: now };
}
function session(state = 'preparing') {
  return { id: sessionId, invitationId, visitorOwnerUserId: owner, hostUserId: host, networkCompanionId: companionId, assetPackSnapshotId: packId, assetPackRefId: ['preparing', 'ready', 'active', 'ending'].includes(state) ? packId : null, state, visitorOwnerReadyAt: null, hostReadyAt: null, readyAt: null, startedAt: null, endedAt: null, endReason: null, failureCode: null, createdAt: now, updatedAt: now };
}
function service(prisma: Record<string, unknown> = {}) {
  const storage = { capability: { uploadsEnabled: true, downloadsEnabled: true }, createGetUrl: jest.fn() };
  const config = { limits: { invitationTtlHours: 24, preparationTtlMinutes: 10, sessionMaxMinutes: 30, heartbeatIntervalSeconds: 15, heartbeatTimeoutSeconds: 60 } };
  const events = { publishToUser: jest.fn() };
  return { instance: new VisitService(prisma as never, storage as never, config as never, events as never), storage, events };
}

describe('VisitService S4 lifecycle and privacy', () => {
  it('rejects a self invitation before it can inspect a Companion snapshot', async () => {
    const { instance } = service();
    await expect(instance.createInvitation(owner, owner)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VISIT_INVITATION_NOT_AVAILABLE' }) });
  });

  it('creates an immutable public snapshot without accepting client companion identifiers', async () => {
    const created = invitation();
    const tx = {
      $queryRaw: jest.fn(),
      friendship: { findUnique: jest.fn().mockResolvedValue({}) },
      blockedUser: { findFirst: jest.fn().mockResolvedValue(null) },
      visitSession: { findFirst: jest.fn().mockResolvedValue(null) },
      visitInvitation: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(created) },
      user: { findUnique: jest.fn().mockResolvedValue({ activeNetworkCompanionId: companionId }) },
      networkCompanion: { findUnique: jest.fn().mockResolvedValue({ id: companionId, ownerUserId: owner, name: 'Ann', publicDescription: 'Public', publicTags: ['kind'], published: true, visibility: 'friends_only', activeAssetPackId: packId }) },
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue({ id: packId, companionId, status: 'active', manifest: visualManifest() }) },
    };
    const prisma = {
      $transaction: jest.fn((operation) => operation(tx)),
    };
    const { instance, events } = service(prisma);
    await expect(instance.createInvitation(owner, host)).resolves.toMatchObject({ id: invitationId, assetPackId: packId, companionName: 'Ann', companionTags: ['kind'] });
    expect(tx.visitInvitation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ visitorOwnerUserId: owner, hostUserId: host, networkCompanionId: companionId, assetPackSnapshotId: packId, assetPackRefId: packId }) }));
    expect(events.publishToUser).toHaveBeenCalledWith(owner, 'visit.invitation.created', { invitationId });
  });

  it('rejects invitation creation when the immutable snapshot lacks a required Visual Visit animation', async () => {
    const tx = {
      $queryRaw: jest.fn(), friendship: { findUnique: jest.fn().mockResolvedValue({}) }, blockedUser: { findFirst: jest.fn().mockResolvedValue(null) },
      visitSession: { findFirst: jest.fn().mockResolvedValue(null) }, visitInvitation: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ activeNetworkCompanionId: companionId }) },
      networkCompanion: { findUnique: jest.fn().mockResolvedValue({ id: companionId, ownerUserId: owner, name: 'Ann', publicDescription: 'Public', publicTags: ['kind'], published: true, visibility: 'friends_only', activeAssetPackId: packId }) },
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue({ id: packId, companionId, status: 'active', manifest: visualManifest('Walk_Left') }) },
    };
    const { instance } = service({ $transaction: jest.fn((operation) => operation(tx)) });
    await expect(instance.createInvitation(owner, host)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VISIT_VISUAL_ASSETS_UNAVAILABLE' }) });
    expect(tx.visitInvitation.create).not.toHaveBeenCalled();
  });

  it('rechecks Visual Visit compatibility when the host accepts an invitation', async () => {
    const tx = {
      $queryRaw: jest.fn(), friendship: { findUnique: jest.fn().mockResolvedValue({}) }, blockedUser: { findFirst: jest.fn().mockResolvedValue(null) },
      visitSession: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      visitInvitation: { findUnique: jest.fn().mockResolvedValue({ ...invitation(), expiresAt: new Date(Date.now() + 60_000), session: null }), update: jest.fn() },
      networkCompanion: { findUnique: jest.fn().mockResolvedValue({ id: companionId, published: true, visibility: 'friends_only' }) },
      companionAssetPack: { findUnique: jest.fn().mockResolvedValue({ id: packId, companionId, status: 'active', manifest: visualManifest('Walk_Right') }) },
    };
    const { instance } = service({ $transaction: jest.fn((operation) => operation(tx)) });
    await expect(instance.acceptInvitation(host, invitationId)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VISIT_VISUAL_ASSETS_UNAVAILABLE' }) });
    expect(tx.visitInvitation.update).not.toHaveBeenCalled();
  });

  it('returns an already accepted invitation and its existing single session', async () => {
    const existingSession = session('preparing');
    const tx = { $queryRaw: jest.fn(), visitInvitation: { findUnique: jest.fn().mockResolvedValue({ ...invitation('accepted'), session: existingSession }) } };
    const { instance } = service({ $transaction: jest.fn((operation) => operation(tx)) });
    await expect(instance.acceptInvitation(host, invitationId)).resolves.toMatchObject({ invitation: { status: 'accepted' }, session: { id: sessionId, state: 'preparing' } });
  });

  it('does not permit a non-host to start a session', async () => {
    const tx = { $queryRaw: jest.fn(), visitSession: { findUnique: jest.fn().mockResolvedValue(session('ready')) } };
    const { instance } = service({ $transaction: jest.fn((operation) => operation(tx)) });
    await expect(instance.startSession(owner, sessionId)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a ready session before the host can start it', async () => {
    const tx = { $queryRaw: jest.fn(), visitSession: { findUnique: jest.fn().mockResolvedValue(session('preparing')) }, friendship: { findUnique: jest.fn().mockResolvedValue({}) }, blockedUser: { findFirst: jest.fn().mockResolvedValue(null) } };
    const { instance } = service({ $transaction: jest.fn((operation) => operation(tx)) });
    await expect(instance.startSession(host, sessionId)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'VISIT_SESSION_NOT_READY' }) });
  });

  it('keeps heartbeat timestamps out of session summaries', () => {
    const { instance } = service();
    const summary = (instance as any).sessionSummary({ ...session('active'), visitorOwnerSeenAt: now, hostSeenAt: now });
    expect(summary).not.toHaveProperty('visitorOwnerSeenAt');
    expect(summary).not.toHaveProperty('hostSeenAt');
  });

  it('allows session asset access only to the host and rejects URL batches above fifty', async () => {
    const { instance } = service({ visitSession: { findUnique: jest.fn().mockResolvedValue({ id: sessionId, hostUserId: host, visitorOwnerUserId: owner, assetPackSnapshotId: packId, assetPackRefId: packId, networkCompanionId: companionId, state: 'preparing' }) } });
    await expect(instance.getSessionManifest(owner, sessionId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(instance.createSessionDownloadUrls(host, sessionId, Array.from({ length: 51 }, () => packId))).rejects.toBeInstanceOf(ConflictException);
  });

  it('ends an active revocation as ended rather than leaving a live session', async () => {
    const updated = { ...session('ended'), endedAt: now, endReason: 'friendship_removed' };
    const prisma = { visitSession: { findMany: jest.fn().mockResolvedValue([{ id: sessionId, state: 'active' }]), findUniqueOrThrow: jest.fn().mockResolvedValue(updated), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    const { instance, events } = service(prisma);
    await instance.endSessionsBetween(owner, host, 'friendship_removed');
    expect(prisma.visitSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'ended', endReason: 'friendship_removed' }) }));
    expect(events.publishToUser).toHaveBeenCalledWith(host, 'visit.session.ended', { sessionId, state: 'ended' });
  });
});
