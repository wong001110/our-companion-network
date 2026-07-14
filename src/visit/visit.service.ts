import { ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SocialEventPublisher } from '../common/social-event-publisher.service';
import { VisitConfigService } from '../common/visit-config.service';
import { supportsVisualVisit } from '../companion/asset-manifest';

const PENDING = 'pending';
const INVITATION_TERMINAL = ['accepted', 'declined', 'cancelled', 'expired'];
const SESSION_LIVE = ['preparing', 'ready', 'active', 'ending'];
const SESSION_HEARTBEAT = ['preparing', 'ready', 'active'];
const SESSION_TERMINAL = ['ended', 'cancelled', 'failed'];
const INVITATION_SELECT = { id: true, visitorOwnerUserId: true, hostUserId: true, networkCompanionId: true, assetPackSnapshotId: true, assetPackRefId: true, companionName: true, companionDescription: true, companionTags: true, status: true, expiresAt: true, respondedAt: true, cancelledAt: true, createdAt: true, updatedAt: true } as const;
const SESSION_SELECT = { id: true, invitationId: true, visitorOwnerUserId: true, hostUserId: true, networkCompanionId: true, assetPackSnapshotId: true, assetPackRefId: true, state: true, visitorOwnerReadyAt: true, hostReadyAt: true, readyAt: true, startedAt: true, endedAt: true, endReason: true, failureCode: true, createdAt: true, updatedAt: true } as const;

@Injectable()
export class VisitService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private cleanupRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly visitConfig: VisitConfigService,
    private readonly events: SocialEventPublisher,
  ) {}

  onModuleInit() { void this.cleanupExpiredAndTimedOut(); this.timer = setInterval(() => void this.cleanupExpiredAndTimedOut(), 15 * 60_000); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async listInvitations(userId: string, direction?: string, status?: string) {
    const where: any = { ...(direction === 'incoming' ? { hostUserId: userId } : direction === 'outgoing' ? { visitorOwnerUserId: userId } : { OR: [{ hostUserId: userId }, { visitorOwnerUserId: userId }] }), ...(status ? { status } : {}) };
    const invitations = await this.prisma.visitInvitation.findMany({ where, select: INVITATION_SELECT, orderBy: { updatedAt: 'desc' } });
    return invitations.map(invitation => this.invitationSummary(invitation));
  }

  async createInvitation(visitorOwnerUserId: string, hostUserId: string) {
    this.requireFeature();
    if (visitorOwnerUserId === hostUserId) throw new ConflictException({ code: 'VISIT_INVITATION_NOT_AVAILABLE', message: 'Visit invitation is not available' });
    const invitation = await this.prisma.$transaction(async tx => {
      await this.lockParticipants(tx, visitorOwnerUserId, hostUserId);
      await this.assertEligible(tx, visitorOwnerUserId, hostUserId);
      await this.assertNoLiveSession(tx, visitorOwnerUserId, hostUserId);
      const snapshot = await this.loadCurrentSnapshotInTransaction(tx, visitorOwnerUserId);
      if (!snapshot) this.notAvailable();
      if (!supportsVisualVisit(snapshot.pack.manifest)) this.visualAssetsUnavailable();
      const existing = await tx.visitInvitation.findFirst({ where: { visitorOwnerUserId, hostUserId, networkCompanionId: snapshot.companion.id, status: PENDING, expiresAt: { gt: new Date() } }, select: INVITATION_SELECT });
      if (existing) throw new ConflictException({ code: 'VISIT_INVITATION_ALREADY_EXISTS', message: 'An equivalent Visit invitation is already pending' });
      return tx.visitInvitation.create({ data: {
        visitorOwnerUserId, hostUserId, networkCompanionId: snapshot.companion.id, assetPackSnapshotId: snapshot.pack.id, assetPackRefId: snapshot.pack.id,
        companionName: snapshot.companion.name, companionDescription: snapshot.companion.publicDescription, companionTags: snapshot.companion.publicTags,
        status: PENDING, expiresAt: new Date(Date.now() + this.limits.invitationTtlHours * 3_600_000),
      }, select: INVITATION_SELECT });
    });
    this.publishInvitation(invitation, 'visit.invitation.created');
    return this.invitationSummary(invitation);
  }

  async acceptInvitation(hostUserId: string, invitationId: string) {
    const result = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "VisitInvitation" WHERE "id" = ${invitationId} FOR UPDATE`;
      const invitation = await tx.visitInvitation.findUnique({ where: { id: invitationId }, select: { ...INVITATION_SELECT, session: { select: SESSION_SELECT } } });
      if (!invitation) throw new NotFoundException({ code: 'VISIT_INVITATION_NOT_FOUND', message: 'Visit invitation was not found' });
      if (invitation.hostUserId !== hostUserId) throw new ForbiddenException({ code: 'VISIT_INVITATION_NOT_HOST', message: 'Visit invitation is not available' });
      if (invitation.status === 'accepted' && invitation.session) return { invitation, session: invitation.session, changed: false };
      if (invitation.status !== PENDING) throw new ConflictException({ code: 'VISIT_INVITATION_NOT_PENDING', message: 'Visit invitation is no longer pending' });
      if (invitation.expiresAt <= new Date()) {
        return { invitation: await tx.visitInvitation.update({ where: { id: invitation.id }, data: { status: 'expired', respondedAt: new Date(), assetPackRefId: null }, select: INVITATION_SELECT }), expired: true };
      }
      await this.lockParticipants(tx, invitation.visitorOwnerUserId, invitation.hostUserId);
      await this.assertEligible(tx, invitation.visitorOwnerUserId, invitation.hostUserId);
      await this.assertNoLiveSession(tx, invitation.visitorOwnerUserId, invitation.hostUserId);
      await this.lockCompanion(tx, invitation.networkCompanionId);
      const companion = await tx.networkCompanion.findUnique({ where: { id: invitation.networkCompanionId }, select: { id: true, published: true, visibility: true } });
      if (!companion || !companion.published || companion.visibility !== 'friends_only' || !invitation.assetPackRefId) this.notAvailable();
      const pack = await tx.companionAssetPack.findUnique({ where: { id: invitation.assetPackRefId }, select: { id: true, companionId: true, status: true, manifest: true } });
      if (!pack || pack.id !== invitation.assetPackSnapshotId || pack.companionId !== invitation.networkCompanionId || !['active', 'superseded'].includes(pack.status)) this.notAvailable();
      if (!supportsVisualVisit(pack.manifest)) this.visualAssetsUnavailable();
      const accepted = await tx.visitInvitation.update({ where: { id: invitation.id }, data: { status: 'accepted', respondedAt: new Date(), assetPackRefId: null }, select: INVITATION_SELECT });
      const session = await tx.visitSession.create({ data: {
        invitationId: invitation.id, visitorOwnerUserId: invitation.visitorOwnerUserId, hostUserId: invitation.hostUserId,
        networkCompanionId: invitation.networkCompanionId, assetPackSnapshotId: invitation.assetPackSnapshotId, assetPackRefId: pack.id, state: 'preparing',
      }, select: SESSION_SELECT });
      return { invitation: accepted, session, changed: true, expired: false };
    });
    if (result.expired) {
      this.publishInvitation(result.invitation, 'visit.invitation.updated');
      throw new ConflictException({ code: 'VISIT_INVITATION_EXPIRED', message: 'Visit invitation expired' });
    }
    this.publishInvitation(result.invitation, 'visit.invitation.updated');
    if (result.changed) this.publishSession(result.session, 'visit.session.created');
    return { invitation: this.invitationSummary(result.invitation), session: this.sessionSummary(result.session) };
  }

  async declineInvitation(hostUserId: string, invitationId: string) { return this.respondToInvitation(hostUserId, invitationId, 'host', 'declined'); }
  async cancelInvitation(visitorOwnerUserId: string, invitationId: string) { return this.respondToInvitation(visitorOwnerUserId, invitationId, 'owner', 'cancelled'); }

  async listSessions(userId: string) {
    const sessions = await this.prisma.visitSession.findMany({ where: { OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }] }, select: SESSION_SELECT, orderBy: { updatedAt: 'desc' } });
    return sessions.map(session => this.sessionSummary(session));
  }

  async getSession(userId: string, sessionId: string) { return this.sessionSummary(await this.requireParticipantSession(userId, sessionId)); }

  async markReady(userId: string, sessionId: string) {
    const session = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "VisitSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const current = await tx.visitSession.findUnique({ where: { id: sessionId }, select: { ...SESSION_SELECT, visitorOwnerSeenAt: true, hostSeenAt: true } });
      if (!current) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
      const role = this.roleFor(current, userId);
      if (!role) throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit session is not available' });
      await this.assertEligible(tx, current.visitorOwnerUserId, current.hostUserId);
      if (current.state === 'ready' || current.state === 'active') return current;
      if (current.state !== 'preparing') throw new ConflictException({ code: 'VISIT_SESSION_NOT_PREPARING', message: 'Visit session is not preparing' });
      const now = new Date();
      const data: any = role === 'owner' ? { visitorOwnerReadyAt: current.visitorOwnerReadyAt ?? now, visitorOwnerSeenAt: now } : { hostReadyAt: current.hostReadyAt ?? now, hostSeenAt: now };
      const updated = await tx.visitSession.update({ where: { id: current.id }, data, select: { ...SESSION_SELECT, visitorOwnerSeenAt: true, hostSeenAt: true } });
      if (updated.visitorOwnerReadyAt && updated.hostReadyAt) return tx.visitSession.update({ where: { id: current.id }, data: { state: 'ready', readyAt: updated.readyAt ?? now }, select: SESSION_SELECT });
      return updated;
    });
    this.publishSession(session, 'visit.session.updated');
    return this.sessionSummary(session);
  }

  async startSession(hostUserId: string, sessionId: string) {
    const session = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "VisitSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const current = await tx.visitSession.findUnique({ where: { id: sessionId }, select: SESSION_SELECT });
      if (!current) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
      if (current.hostUserId !== hostUserId) throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit session is not available' });
      await this.assertEligible(tx, current.visitorOwnerUserId, current.hostUserId);
      if (current.state === 'active') return current;
      if (current.state !== 'ready') throw new ConflictException({ code: 'VISIT_SESSION_NOT_READY', message: 'Visit session is not ready' });
      return tx.visitSession.update({ where: { id: current.id }, data: { state: 'active', startedAt: new Date() }, select: SESSION_SELECT });
    });
    this.publishSession(session, 'visit.session.updated');
    return this.sessionSummary(session);
  }

  async endSession(userId: string, sessionId: string, reason?: string) {
    const session = await this.prisma.$transaction(tx => this.endSessionInTransaction(tx, sessionId, userId, reason));
    this.publishSession(session, 'visit.session.ended');
    return this.sessionSummary(session);
  }

  async heartbeat(userId: string, sessionId: string) {
    const session = await this.prisma.visitSession.findUnique({ where: { id: sessionId }, select: { id: true, visitorOwnerUserId: true, hostUserId: true, state: true } });
    if (!session) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
    const role = this.roleFor(session, userId);
    if (!role) throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit session is not available' });
    if (!SESSION_HEARTBEAT.includes(session.state)) throw new ConflictException({ code: 'VISIT_SESSION_STATE_CHANGED', message: 'Visit session is not available' });
    await this.assertEligible(this.prisma as any, session.visitorOwnerUserId, session.hostUserId);
    const updated = await this.prisma.visitSession.update({ where: { id: session.id }, data: role === 'owner' ? { visitorOwnerSeenAt: new Date() } : { hostSeenAt: new Date() }, select: SESSION_SELECT });
    return this.sessionSummary(updated);
  }

  async getSessionManifest(hostUserId: string, sessionId: string) {
    const pack = await this.authorizeSessionAsset(hostUserId, sessionId);
    return { manifest: pack.manifest, files: pack.files.map((file: any) => ({ id: file.id, relativePath: file.relativePath, sizeBytes: Number(file.sizeBytes), sha256: file.sha256, mimeType: file.mimeType })) };
  }

  async createSessionDownloadUrls(hostUserId: string, sessionId: string, fileIds: string[]) {
    if (!fileIds.length || fileIds.length > 50 || new Set(fileIds).size !== fileIds.length) throw new ConflictException({ code: 'VISIT_ASSET_NOT_AVAILABLE', message: 'Visit Asset Pack is not available' });
    const pack = await this.authorizeSessionAsset(hostUserId, sessionId);
    const files = pack.files.filter((file: any) => fileIds.includes(file.id));
    if (files.length !== fileIds.length) this.assetNotAvailable();
    return { downloads: await Promise.all(files.map(async (file: any) => {
      const signed = await this.storage.createGetUrl(file.objectKey);
      return { fileId: file.id, relativePath: file.relativePath, downloadUrl: signed.url, expiresAt: signed.expiresAt, sizeBytes: Number(file.sizeBytes), sha256: file.sha256, mimeType: file.mimeType };
    })) };
  }

  async endSessionsBetween(userA: string, userB: string, reason: string) {
    const sessions = await this.prisma.visitSession.findMany({ where: { state: { in: SESSION_LIVE }, OR: [{ visitorOwnerUserId: userA, hostUserId: userB }, { visitorOwnerUserId: userB, hostUserId: userA }] }, select: { id: true, state: true } });
    for (const session of sessions) {
      const claimed = await this.prisma.visitSession.updateMany({ where: { id: session.id, state: session.state }, data: { state: session.state === 'active' ? 'ended' : 'cancelled', endedAt: new Date(), endReason: reason, assetPackRefId: null } });
      if (claimed.count) this.publishSession(await this.prisma.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }), 'visit.session.ended');
    }
  }

  async endSessionsForCompanion(companionId: string, reason: string) {
    const sessions = await this.prisma.visitSession.findMany({ where: { networkCompanionId: companionId, state: { in: SESSION_LIVE } }, select: { id: true, state: true } });
    for (const session of sessions) {
      const claimed = await this.prisma.visitSession.updateMany({ where: { id: session.id, state: session.state }, data: { state: session.state === 'active' ? 'ended' : 'cancelled', endedAt: new Date(), endReason: reason, assetPackRefId: null } });
      if (claimed.count) this.publishSession(await this.prisma.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }), 'visit.session.ended');
    }
  }

  async revokeCompanionVisits(companionId: string, reason: string) {
    const [invitations, sessions] = await this.prisma.$transaction(async tx => {
      const now = new Date();
      const pending = await tx.visitInvitation.findMany({ where: { networkCompanionId: companionId, status: PENDING }, select: { id: true } });
      const live = await tx.visitSession.findMany({ where: { networkCompanionId: companionId, state: { in: SESSION_LIVE } }, select: { id: true, state: true } });
      const changedInvitations: any[] = [];
      const changedSessions: any[] = [];
      for (const invitation of pending) {
        const changed = await tx.visitInvitation.updateMany({ where: { id: invitation.id, status: PENDING }, data: { status: 'cancelled', cancelledAt: now, assetPackRefId: null } });
        if (changed.count) changedInvitations.push(await tx.visitInvitation.findUniqueOrThrow({ where: { id: invitation.id }, select: INVITATION_SELECT }));
      }
      for (const session of live) {
        const changed = await tx.visitSession.updateMany({ where: { id: session.id, state: session.state }, data: { state: session.state === 'active' ? 'ended' : 'cancelled', endedAt: now, endReason: reason, assetPackRefId: null } });
        if (changed.count) changedSessions.push(await tx.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }));
      }
      return [changedInvitations, changedSessions] as const;
    });
    invitations.forEach(invitation => this.publishInvitation(invitation, 'visit.invitation.updated'));
    sessions.forEach(session => this.publishSession(session, 'visit.session.ended'));
  }

  async cleanupExpiredAndTimedOut(limit = 500) {
    if (this.cleanupRunning) return;
    this.cleanupRunning = true;
    try {
      const now = new Date();
      const expired = await this.prisma.visitInvitation.findMany({ take: limit, where: { status: PENDING, expiresAt: { lt: now } }, select: { id: true } });
      for (const invitation of expired) {
        const updated = await this.prisma.visitInvitation.updateMany({ where: { id: invitation.id, status: PENDING, expiresAt: { lt: now } }, data: { status: 'expired', respondedAt: now, assetPackRefId: null } });
        if (updated.count) {
          const record = await this.prisma.visitInvitation.findUniqueOrThrow({ where: { id: invitation.id }, select: INVITATION_SELECT });
          this.publishInvitation(record, 'visit.invitation.updated');
        }
      }
      const sessions = await this.prisma.visitSession.findMany({ take: limit, where: { state: { in: SESSION_LIVE } }, select: { id: true, state: true, createdAt: true, readyAt: true, startedAt: true, visitorOwnerSeenAt: true, hostSeenAt: true } });
      for (const session of sessions) {
        const reason = this.timeoutReason(session, now);
        if (!reason) continue;
        const state = session.state === 'active' ? 'ended' : 'cancelled';
        const updated = await this.prisma.visitSession.updateMany({ where: { id: session.id, state: session.state }, data: { state, endedAt: now, endReason: reason, assetPackRefId: null } });
        if (updated.count) this.publishSession(await this.prisma.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }), 'visit.session.ended');
      }
    } finally { this.cleanupRunning = false; }
  }

  private async respondToInvitation(userId: string, invitationId: string, role: 'host' | 'owner', status: 'declined' | 'cancelled') {
    const invitation = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "VisitInvitation" WHERE "id" = ${invitationId} FOR UPDATE`;
      const current = await tx.visitInvitation.findUnique({ where: { id: invitationId }, select: INVITATION_SELECT });
      if (!current) throw new NotFoundException({ code: 'VISIT_INVITATION_NOT_FOUND', message: 'Visit invitation was not found' });
      if ((role === 'host' ? current.hostUserId : current.visitorOwnerUserId) !== userId) throw new ForbiddenException({ code: role === 'host' ? 'VISIT_INVITATION_NOT_HOST' : 'VISIT_INVITATION_NOT_OWNED', message: 'Visit invitation is not available' });
      if (current.status === status) return current;
      if (current.status !== PENDING) throw new ConflictException({ code: 'VISIT_INVITATION_NOT_PENDING', message: 'Visit invitation is no longer pending' });
      return tx.visitInvitation.update({ where: { id: current.id }, data: status === 'declined' ? { status, respondedAt: new Date(), assetPackRefId: null } : { status, cancelledAt: new Date(), assetPackRefId: null }, select: INVITATION_SELECT });
    });
    this.publishInvitation(invitation, 'visit.invitation.updated');
    return this.invitationSummary(invitation);
  }

  private async endSessionInTransaction(tx: Prisma.TransactionClient, sessionId: string, userId: string, requestedReason?: string) {
    await tx.$queryRaw`SELECT "id" FROM "VisitSession" WHERE "id" = ${sessionId} FOR UPDATE`;
    const current = await tx.visitSession.findUnique({ where: { id: sessionId }, select: SESSION_SELECT });
    if (!current) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
    const role = this.roleFor(current, userId);
    if (!role) throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit session is not available' });
    if (SESSION_TERMINAL.includes(current.state)) return current;
    if (!SESSION_LIVE.includes(current.state)) throw new ConflictException({ code: 'VISIT_SESSION_STATE_CHANGED', message: 'Visit session state changed' });
    const reason = requestedReason ?? (role === 'owner' ? 'visitor_owner_ended' : 'host_ended');
    return tx.visitSession.update({ where: { id: current.id }, data: { state: current.state === 'preparing' || current.state === 'ready' ? 'cancelled' : 'ended', endingAt: current.state === 'active' || current.state === 'ending' ? new Date() : null, endedAt: new Date(), endReason: reason, assetPackRefId: null }, select: SESSION_SELECT });
  }

  private async authorizeSessionAsset(hostUserId: string, sessionId: string): Promise<any> {
    this.requireFeature();
    const session = await this.prisma.visitSession.findUnique({ where: { id: sessionId }, select: { id: true, hostUserId: true, visitorOwnerUserId: true, assetPackSnapshotId: true, assetPackRefId: true, networkCompanionId: true, state: true } });
    if (!session || session.hostUserId !== hostUserId || !SESSION_HEARTBEAT.includes(session.state)) this.assetNotAvailable();
    await this.assertEligible(this.prisma as any, session.visitorOwnerUserId, session.hostUserId).catch(() => this.assetNotAvailable());
    if (!session.assetPackRefId) this.assetNotAvailable();
    const pack = await this.prisma.companionAssetPack.findUnique({ where: { id: session.assetPackRefId }, include: { files: true } });
    if (!pack || pack.id !== session.assetPackSnapshotId || pack.companionId !== session.networkCompanionId || !['active', 'superseded'].includes(pack.status)) this.assetNotAvailable();
    return pack;
  }

  private async requireParticipantSession(userId: string, sessionId: string) {
    const session = await this.prisma.visitSession.findUnique({ where: { id: sessionId }, select: SESSION_SELECT });
    if (!session) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
    if (!this.roleFor(session, userId)) throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit session is not available' });
    return session;
  }

  private async loadCurrentSnapshotInTransaction(tx: Prisma.TransactionClient, ownerId: string): Promise<any | undefined> {
    const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { activeNetworkCompanionId: true } });
    if (!owner?.activeNetworkCompanionId) return undefined;
    await this.lockCompanion(tx, owner.activeNetworkCompanionId);
    const companion = await tx.networkCompanion.findUnique({ where: { id: owner.activeNetworkCompanionId }, select: { id: true, ownerUserId: true, name: true, publicDescription: true, publicTags: true, visibility: true, published: true, activeAssetPackId: true } });
    if (!companion || companion.ownerUserId !== ownerId || !companion.published || companion.visibility !== 'friends_only' || !companion.activeAssetPackId) return undefined;
    await tx.$queryRaw`SELECT "id" FROM "CompanionAssetPack" WHERE "id" = ${companion.activeAssetPackId} FOR UPDATE`;
    const pack = await tx.companionAssetPack.findUnique({ where: { id: companion.activeAssetPackId }, select: { id: true, companionId: true, status: true, manifest: true } });
    if (!pack || pack.companionId !== companion.id || pack.status !== 'active') return undefined;
    return { companion, pack };
  }

  private async assertEligible(tx: any, first: string, second: string) {
    const [forward, reverse, blocked] = await Promise.all([
      tx.friendship.findUnique({ where: { userId_friendId: { userId: first, friendId: second } } }),
      tx.friendship.findUnique({ where: { userId_friendId: { userId: second, friendId: first } } }),
      tx.blockedUser.findFirst({ where: { OR: [{ blockerId: first, blockedId: second }, { blockerId: second, blockedId: first }] } }),
    ]);
    if (!forward || !reverse || blocked) this.notAvailable();
  }

  private async assertNoLiveSession(tx: any, first: string, second: string) {
    const session = await tx.visitSession.findFirst({ where: { state: { in: SESSION_LIVE }, OR: [{ visitorOwnerUserId: { in: [first, second] } }, { hostUserId: { in: [first, second] } }] }, select: { id: true, visitorOwnerUserId: true, hostUserId: true } });
    if (session) throw new ConflictException({ code: 'VISIT_SESSION_ALREADY_ACTIVE', message: 'A participant already has an active Visit session' });
  }

  private async lockParticipants(tx: Prisma.TransactionClient, first: string, second: string) { await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${first}, ${second}) ORDER BY "id" FOR UPDATE`; }
  private async lockCompanion(tx: Prisma.TransactionClient, companionId: string) { await tx.$queryRaw`SELECT "id" FROM "NetworkCompanion" WHERE "id" = ${companionId} FOR UPDATE`; }
  private roleFor(session: { visitorOwnerUserId: string; hostUserId: string }, userId: string): 'owner' | 'host' | undefined { return session.visitorOwnerUserId === userId ? 'owner' : session.hostUserId === userId ? 'host' : undefined; }
  private invitationSummary(value: any) { const { assetPackSnapshotId, assetPackRefId: _assetPackRefId, ...summary } = value; return { ...summary, assetPackId: assetPackSnapshotId, companionDescription: value.companionDescription ?? undefined, respondedAt: value.respondedAt?.toISOString(), cancelledAt: value.cancelledAt?.toISOString(), expiresAt: value.expiresAt.toISOString(), createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() }; }
  private sessionSummary(value: any) { return { id: value.id, invitationId: value.invitationId, visitorOwnerUserId: value.visitorOwnerUserId, hostUserId: value.hostUserId, networkCompanionId: value.networkCompanionId, assetPackId: value.assetPackSnapshotId, state: value.state, visitorOwnerReady: Boolean(value.visitorOwnerReadyAt), hostReady: Boolean(value.hostReadyAt), readyAt: value.readyAt?.toISOString(), startedAt: value.startedAt?.toISOString(), endedAt: value.endedAt?.toISOString(), endReason: value.endReason ?? undefined, failureCode: value.failureCode ?? undefined, createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() }; }
  private publishInvitation(invitation: any, event: string) { this.events.publishToUser(invitation.visitorOwnerUserId, event, { invitationId: invitation.id }); this.events.publishToUser(invitation.hostUserId, event, { invitationId: invitation.id }); }
  private publishSession(session: any, event: string) { const payload = { sessionId: session.id, state: session.state }; this.events.publishToUser(session.visitorOwnerUserId, event, payload); this.events.publishToUser(session.hostUserId, event, payload); }
  private timeoutReason(session: any, now: Date): string | undefined {
    if (session.state === 'active' && session.startedAt && now.getTime() - session.startedAt.getTime() > this.limits.sessionMaxMinutes * 60_000) return 'session_timeout';
    if (session.state !== 'active' && now.getTime() - (session.readyAt ?? session.createdAt).getTime() > this.limits.preparationTtlMinutes * 60_000) return 'preparation_timeout';
    const threshold = now.getTime() - this.limits.heartbeatTimeoutSeconds * 1000;
    const fallback = session.startedAt ?? session.readyAt ?? session.createdAt;
    if ((session.visitorOwnerSeenAt ?? fallback).getTime() < threshold || (session.hostSeenAt ?? fallback).getTime() < threshold) return 'heartbeat_timeout';
    return undefined;
  }
  private get limits() { return this.visitConfig.limits; }
  private requireFeature() { if (!this.storage.capability.uploadsEnabled || !this.storage.capability.downloadsEnabled) throw new ServiceUnavailableException({ code: 'VISIT_FEATURE_UNAVAILABLE', message: 'Visit feature is unavailable' }); }
  private notAvailable(): never { throw new ConflictException({ code: 'VISIT_INVITATION_NOT_AVAILABLE', message: 'Visit invitation is not available' }); }
  private visualAssetsUnavailable(): never { throw new ConflictException({ code: 'VISIT_VISUAL_ASSETS_UNAVAILABLE', message: 'Visit visual assets are unavailable' }); }
  private assetNotAvailable(): never { throw new NotFoundException({ code: 'VISIT_ASSET_NOT_AVAILABLE', message: 'Visit Asset Pack is not available' }); }
}
