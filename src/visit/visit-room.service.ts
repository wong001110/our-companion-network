import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SocialEventPublisher } from '../common/social-event-publisher.service';
import { supportsVisualVisit } from '../companion/asset-manifest';

const PARTICIPANT_SELECT = {
  id: true, sessionId: true, userId: true, networkCompanionId: true,
  assetPackSnapshotId: true, assetPackRefId: true, role: true, state: true,
  readyAt: true, seenAt: true, joinedAt: true, leftAt: true, createdAt: true, updatedAt: true,
  networkCompanion: { select: { name: true } },
} as const;
const JOIN_SELECT = {
  id: true, sessionId: true, requesterUserId: true, networkCompanionId: true,
  assetPackSnapshotId: true, assetPackRefId: true, status: true,
  topicRefId: true, topicOwnerCompanionId: true, topicCreatedByUserId: true,
  topicTitle: true, topicSummary: true, topicTags: true, topicSourceUrl: true,
  topicShareScope: true, topicAllowRecipientSave: true,
  expiresAt: true, respondedAt: true, cancelledAt: true, createdAt: true, updatedAt: true,
  networkCompanion: { select: { name: true } },
} as const;
const TOPIC_SELECT = {
  id: true, sessionId: true, sequence: true, state: true, ownerCompanionId: true,
  createdByUserId: true, title: true, summary: true, tags: true, sourceUrl: true,
  shareScope: true, allowRecipientSave: true, minimumTurns: true, maximumTurns: true,
  startedAt: true, completedAt: true, createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class VisitRoomService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: SocialEventPublisher,
  ) {}

  async getReservation(userId: string) {
    const reservation = await this.prisma.visitReservation.findUnique({ where: { userId } });
    if (!reservation) return { locked: false as const };
    return {
      locked: true as const,
      kind: reservation.kind,
      networkCompanionId: reservation.networkCompanionId,
      invitationId: reservation.invitationId ?? undefined,
      sessionId: reservation.sessionId ?? undefined,
      joinRequestId: reservation.joinRequestId ?? undefined,
      expiresAt: reservation.expiresAt?.toISOString(),
      createdAt: reservation.createdAt.toISOString(),
      updatedAt: reservation.updatedAt.toISOString(),
    };
  }

  async getRoom(userId: string, sessionId: string) {
    await this.requireParticipant(userId, sessionId, ['preparing', 'ready', 'active', 'left']);
    const [session, participants, topics, joinRequests] = await Promise.all([
      this.prisma.visitSession.findUnique({
        where: { id: sessionId },
        select: { id: true, state: true, hostUserId: true, roomCapacity: true, currentTopicSequence: true, createdAt: true, updatedAt: true },
      }),
      this.prisma.visitSessionParticipant.findMany({
        where: { sessionId }, select: PARTICIPANT_SELECT, orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.visitRoomTopic.findMany({
        where: { sessionId }, select: TOPIC_SELECT, orderBy: { sequence: 'asc' },
      }),
      this.prisma.visitJoinRequest.findMany({
        where: { sessionId, status: 'pending' }, select: JOIN_SELECT, orderBy: { createdAt: 'asc' },
      }),
    ]);
    if (!session) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
    return {
      session: {
        ...session,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      },
      participants: participants.map((item) => this.participantSummary(item)),
      topics: topics.map((item) => this.topicSummary(item)),
      activeTopic: topics.find((item) => item.state === 'active') ? this.topicSummary(topics.find((item) => item.state === 'active')!) : undefined,
      pendingJoinRequests: joinRequests.map((item) => this.joinSummary(item)),
    };
  }

  async createJoinRequest(userId: string, sessionId: string, topicId?: string) {
    const request = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "VisitSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const session = await tx.visitSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true, hostUserId: true, hostNetworkCompanionId: true, state: true, roomCapacity: true,
          participants: { where: { state: { not: 'left' } }, select: { userId: true, networkCompanionId: true } },
        },
      });
      if (!session || !['ready', 'active'].includes(session.state)) this.notAvailable('VISIT_ROOM_NOT_JOINABLE');
      if (session.participants.some((participant) => participant.userId === userId)) {
        throw new ConflictException({ code: 'VISIT_ROOM_ALREADY_PARTICIPANT', message: 'This Companion is already in the room' });
      }
      if (session.participants.length >= session.roomCapacity) this.notAvailable('VISIT_ROOM_CAPACITY_REACHED');
      if (await tx.visitReservation.findUnique({ where: { userId } })) {
        throw new ConflictException({ code: 'VISIT_RESERVATION_EXISTS', message: 'This Companion already has a Visit reservation' });
      }
      const hostCompanion = session.hostNetworkCompanionId
        ? await tx.networkCompanion.findUnique({ where: { id: session.hostNetworkCompanionId }, select: { allowJoinRequests: true } })
        : null;
      if (!hostCompanion?.allowJoinRequests) this.notAvailable('VISIT_JOIN_REQUESTS_DISABLED');
      for (const participant of session.participants) await this.assertEligible(tx, userId, participant.userId);
      const snapshot = await this.loadCurrentSnapshot(tx, userId);
      if (!snapshot || !supportsVisualVisit(snapshot.pack.manifest)) this.notAvailable('VISIT_PARTICIPANT_UNAVAILABLE');
      if (session.participants.some((participant) => participant.networkCompanionId === snapshot.companion.id)) {
        throw new ConflictException({ code: 'VISIT_ROOM_COMPANION_DUPLICATE', message: 'This Companion is already represented in the room' });
      }
      const existing = await tx.visitJoinRequest.findFirst({ where: { sessionId, requesterUserId: userId, status: 'pending', expiresAt: { gt: new Date() } } });
      if (existing) throw new ConflictException({ code: 'VISIT_JOIN_REQUEST_EXISTS', message: 'A join request is already pending' });
      const topic = topicId ? await this.resolveOwnedTopic(tx, userId, snapshot.companion.id, topicId) : undefined;
      const expiresAt = new Date(Date.now() + 2 * 60 * 60_000);
      const created = await tx.visitJoinRequest.create({
        data: {
          sessionId, requesterUserId: userId, networkCompanionId: snapshot.companion.id,
          assetPackSnapshotId: snapshot.pack.id, assetPackRefId: snapshot.pack.id, status: 'pending', expiresAt,
          ...(topic ?? {}),
        },
        select: JOIN_SELECT,
      });
      await tx.visitReservation.create({
        data: {
          userId, networkCompanionId: snapshot.companion.id, kind: 'join_request',
          sessionId, joinRequestId: created.id, expiresAt,
        },
      });
      return created;
    });
    await this.publishRoom(request.sessionId, 'visit.join_request.created', { joinRequestId: request.id });
    return this.joinSummary(request);
  }

  async listJoinRequests(userId: string, sessionId: string) {
    await this.requireParticipant(userId, sessionId, ['preparing', 'ready', 'active']);
    const requests = await this.prisma.visitJoinRequest.findMany({ where: { sessionId }, select: JOIN_SELECT, orderBy: { createdAt: 'desc' } });
    return requests.map((item) => this.joinSummary(item));
  }

  async acceptJoinRequest(hostUserId: string, joinRequestId: string) {
    const result = await this.prisma.$transaction(async tx => {
      const route = await tx.visitJoinRequest.findUnique({ where: { id: joinRequestId }, select: { sessionId: true, requesterUserId: true } });
      if (!route) throw new NotFoundException({ code: 'VISIT_JOIN_REQUEST_NOT_FOUND', message: 'Join request was not found' });
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" IN (${hostUserId}, ${route.requesterUserId}) ORDER BY "id" FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "VisitSession" WHERE "id" = ${route.sessionId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "VisitJoinRequest" WHERE "id" = ${joinRequestId} FOR UPDATE`;
      const request = await tx.visitJoinRequest.findUnique({ where: { id: joinRequestId }, select: JOIN_SELECT });
      const session = await tx.visitSession.findUnique({
        where: { id: route.sessionId },
        select: {
          id: true, hostUserId: true, state: true, roomCapacity: true,
          participants: { where: { state: { not: 'left' } }, select: { id: true, userId: true } },
        },
      });
      if (!request || !session) throw new NotFoundException({ code: 'VISIT_JOIN_REQUEST_NOT_FOUND', message: 'Join request was not found' });
      if (session.hostUserId !== hostUserId) throw new ForbiddenException({ code: 'VISIT_JOIN_REQUEST_NOT_HOST', message: 'Join request is not available' });
      if (request.status === 'accepted') return { request, sessionId: session.id, changed: false };
      if (request.status !== 'pending') throw new ConflictException({ code: 'VISIT_JOIN_REQUEST_NOT_PENDING', message: 'Join request is no longer pending' });
      if (request.expiresAt <= new Date()) {
        await tx.visitJoinRequest.update({ where: { id: request.id }, data: { status: 'expired', respondedAt: new Date(), assetPackRefId: null } });
        await tx.visitReservation.deleteMany({ where: { userId: request.requesterUserId, joinRequestId: request.id } });
        throw new ConflictException({ code: 'VISIT_JOIN_REQUEST_EXPIRED', message: 'Join request expired' });
      }
      if (!['ready', 'active'].includes(session.state)) this.notAvailable('VISIT_ROOM_NOT_JOINABLE');
      if (session.participants.length >= session.roomCapacity) this.notAvailable('VISIT_ROOM_CAPACITY_REACHED');
      for (const participant of session.participants) await this.assertEligible(tx, request.requesterUserId, participant.userId);
      const reservation = await tx.visitReservation.findUnique({ where: { userId: request.requesterUserId } });
      if (!reservation || reservation.joinRequestId !== request.id || reservation.kind !== 'join_request') {
        throw new ConflictException({ code: 'VISIT_RESERVATION_CHANGED', message: 'The requester reservation changed' });
      }
      if (!request.assetPackRefId) this.notAvailable('VISIT_PARTICIPANT_UNAVAILABLE');
      const participant = await tx.visitSessionParticipant.create({
        data: {
          sessionId: session.id, userId: request.requesterUserId, networkCompanionId: request.networkCompanionId,
          assetPackSnapshotId: request.assetPackSnapshotId, assetPackRefId: request.assetPackRefId,
          role: 'guest', state: 'preparing', seenAt: new Date(),
        },
        select: PARTICIPANT_SELECT,
      });
      const accepted = await tx.visitJoinRequest.update({
        where: { id: request.id }, data: { status: 'accepted', respondedAt: new Date(), assetPackRefId: null }, select: JOIN_SELECT,
      });
      await tx.visitReservation.update({
        where: { userId: request.requesterUserId },
        data: { kind: 'session_participant', sessionId: session.id, joinRequestId: null, expiresAt: null },
      });
      if (request.topicTitle && request.topicSummary && request.topicOwnerCompanionId && request.topicCreatedByUserId) {
        const aggregate = await tx.visitRoomTopic.aggregate({ where: { sessionId: session.id }, _max: { sequence: true } });
        await tx.visitRoomTopic.create({
          data: {
            sessionId: session.id, sequence: (aggregate._max.sequence ?? 0) + 1, state: 'queued',
            ownerCompanionId: request.topicOwnerCompanionId, createdByUserId: request.topicCreatedByUserId,
            title: request.topicTitle, summary: request.topicSummary, tags: request.topicTags,
            sourceUrl: request.topicShareScope === 'summary_and_source' ? request.topicSourceUrl : null,
            shareScope: request.topicShareScope ?? 'summary_only',
            allowRecipientSave: request.topicAllowRecipientSave,
          },
        });
      }
      return { request: accepted, participant, sessionId: session.id, changed: true };
    });
    if (result.changed && result.participant) await this.publishRoom(result.sessionId, 'visit.participant.joined', { joinRequestId, participantId: result.participant.id });
    return this.getRoom(hostUserId, result.sessionId);
  }

  async declineJoinRequest(hostUserId: string, joinRequestId: string) {
    return this.respondJoinRequest(hostUserId, joinRequestId, 'host', 'declined');
  }

  async cancelJoinRequest(requesterUserId: string, joinRequestId: string) {
    return this.respondJoinRequest(requesterUserId, joinRequestId, 'requester', 'cancelled');
  }

  async markParticipantReady(userId: string, sessionId: string) {
    const participant = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "VisitSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const current = await tx.visitSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } }, select: PARTICIPANT_SELECT });
      if (!current) throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit room is not available' });
      if (current.state === 'active') return current;
      if (!['preparing', 'ready'].includes(current.state)) throw new ConflictException({ code: 'VISIT_PARTICIPANT_STATE_CHANGED', message: 'Participant is not preparing' });
      const peers = await tx.visitSessionParticipant.findMany({ where: { sessionId, state: { in: ['ready', 'active'] }, userId: { not: userId } }, select: { id: true } });
      for (const peer of peers) {
        await tx.visitParticipantReadiness.upsert({
          where: { subjectParticipantId_viewerUserId: { subjectParticipantId: peer.id, viewerUserId: userId } },
          create: { sessionId, subjectParticipantId: peer.id, viewerUserId: userId },
          update: { readyAt: new Date() },
        });
      }
      return tx.visitSessionParticipant.update({ where: { id: current.id }, data: { state: 'active', readyAt: new Date(), seenAt: new Date() }, select: PARTICIPANT_SELECT });
    });
    await this.publishRoom(sessionId, 'visit.participant.ready', { participantId: participant.id });
    return this.participantSummary(participant);
  }

  async leaveRoom(userId: string, sessionId: string) {
    const participant = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "VisitSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const session = await tx.visitSession.findUnique({ where: { id: sessionId }, select: { hostUserId: true, state: true } });
      const current = await tx.visitSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } }, select: PARTICIPANT_SELECT });
      if (!session || !current) throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit room is not available' });
      if (session.hostUserId === userId) throw new ConflictException({ code: 'VISIT_HOST_MUST_END_ROOM', message: 'The Host must end the room instead of leaving it' });
      if (current.state === 'left') return current;
      const updated = await tx.visitSessionParticipant.update({
        where: { id: current.id }, data: { state: 'left', leftAt: new Date(), assetPackRefId: null }, select: PARTICIPANT_SELECT,
      });
      await tx.visitReservation.deleteMany({ where: { userId, sessionId } });
      return updated;
    });
    await this.publishRoom(sessionId, 'visit.participant.left', { participantId: participant.id });
    return this.participantSummary(participant);
  }

  async getParticipantManifest(userId: string, sessionId: string, participantId: string) {
    const pack = await this.authorizeParticipantAsset(userId, sessionId, participantId);
    return { manifest: pack.manifest, files: pack.files.map((file: any) => ({ id: file.id, relativePath: file.relativePath, sizeBytes: Number(file.sizeBytes), sha256: file.sha256, mimeType: file.mimeType })) };
  }

  async createParticipantDownloadUrls(userId: string, sessionId: string, participantId: string, fileIds: string[]) {
    if (!fileIds.length || fileIds.length > 50 || new Set(fileIds).size !== fileIds.length) this.notAvailable('VISIT_ASSET_NOT_AVAILABLE');
    const pack = await this.authorizeParticipantAsset(userId, sessionId, participantId);
    const files = pack.files.filter((file: any) => fileIds.includes(file.id));
    if (files.length !== fileIds.length) this.notAvailable('VISIT_ASSET_NOT_AVAILABLE');
    return { downloads: await Promise.all(files.map(async (file: any) => {
      const signed = await this.storage.createGetUrl(file.objectKey);
      return { fileId: file.id, relativePath: file.relativePath, downloadUrl: signed.url, expiresAt: signed.expiresAt, sizeBytes: Number(file.sizeBytes), sha256: file.sha256, mimeType: file.mimeType };
    })) };
  }

  private async respondJoinRequest(userId: string, joinRequestId: string, role: 'host' | 'requester', status: 'declined' | 'cancelled') {
    const request = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "VisitJoinRequest" WHERE "id" = ${joinRequestId} FOR UPDATE`;
      const current = await tx.visitJoinRequest.findUnique({ where: { id: joinRequestId }, select: { ...JOIN_SELECT, session: { select: { hostUserId: true } } } });
      if (!current) throw new NotFoundException({ code: 'VISIT_JOIN_REQUEST_NOT_FOUND', message: 'Join request was not found' });
      const allowed = role === 'host' ? current.session.hostUserId === userId : current.requesterUserId === userId;
      if (!allowed) throw new ForbiddenException({ code: 'VISIT_JOIN_REQUEST_NOT_AVAILABLE', message: 'Join request is not available' });
      if (current.status === status) return current;
      if (current.status !== 'pending') throw new ConflictException({ code: 'VISIT_JOIN_REQUEST_NOT_PENDING', message: 'Join request is no longer pending' });
      const updated = await tx.visitJoinRequest.update({
        where: { id: current.id },
        data: status === 'declined' ? { status, respondedAt: new Date(), assetPackRefId: null } : { status, cancelledAt: new Date(), assetPackRefId: null },
        select: JOIN_SELECT,
      });
      await tx.visitReservation.deleteMany({ where: { userId: current.requesterUserId, joinRequestId: current.id } });
      return updated;
    });
    this.events.publishToUser(request.requesterUserId, 'visit.join_request.updated', { sessionId: request.sessionId, joinRequestId: request.id });
    await this.publishRoom(request.sessionId, 'visit.join_request.updated', { joinRequestId: request.id });
    return this.joinSummary(request);
  }

  private async authorizeParticipantAsset(userId: string, sessionId: string, participantId: string): Promise<any> {
    const viewer = await this.requireParticipant(userId, sessionId, ['preparing', 'ready', 'active']);
    const subject = await this.prisma.visitSessionParticipant.findFirst({ where: { id: participantId, sessionId, state: { not: 'left' } } });
    if (!subject || subject.userId === viewer.userId || !subject.assetPackRefId) this.notAvailable('VISIT_ASSET_NOT_AVAILABLE');
    const pack = await this.prisma.companionAssetPack.findUnique({ where: { id: subject.assetPackRefId }, include: { files: true } });
    if (!pack || pack.id !== subject.assetPackSnapshotId || pack.companionId !== subject.networkCompanionId || !['active', 'superseded'].includes(pack.status)) this.notAvailable('VISIT_ASSET_NOT_AVAILABLE');
    return pack;
  }

  private async requireParticipant(userId: string, sessionId: string, states: string[]) {
    const participant = await this.prisma.visitSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } } });
    if (!participant || !states.includes(participant.state)) throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit room is not available' });
    return participant;
  }

  private async loadCurrentSnapshot(tx: Prisma.TransactionClient, ownerId: string): Promise<any | undefined> {
    const owner = await tx.user.findUnique({ where: { id: ownerId }, select: { accountStatus: true, deletionRequestedAt: true, activeNetworkCompanionId: true } });
    if (owner?.accountStatus !== 'ACTIVE' || owner.deletionRequestedAt || !owner.activeNetworkCompanionId) return undefined;
    await tx.$queryRaw`SELECT "id" FROM "NetworkCompanion" WHERE "id" = ${owner.activeNetworkCompanionId} FOR UPDATE`;
    const companion = await tx.networkCompanion.findUnique({ where: { id: owner.activeNetworkCompanionId }, select: { id: true, ownerUserId: true, published: true, visibility: true, activeAssetPackId: true } });
    if (!companion || companion.ownerUserId !== ownerId || !companion.published || companion.visibility !== 'friends_only' || !companion.activeAssetPackId) return undefined;
    const pack = await tx.companionAssetPack.findUnique({ where: { id: companion.activeAssetPackId }, select: { id: true, companionId: true, status: true, manifest: true } });
    if (!pack || pack.companionId !== companion.id || pack.status !== 'active') return undefined;
    return { companion, pack };
  }

  private async resolveOwnedTopic(tx: Prisma.TransactionClient, userId: string, companionId: string, topicId: string) {
    const topic = await tx.shareableTopic.findFirst({
      where: { id: topicId, companionId, audience: 'friends', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
    if (!topic) this.notAvailable('VISIT_TOPIC_NOT_AVAILABLE');
    return {
      topicRefId: topic.id, topicOwnerCompanionId: topic.companionId, topicCreatedByUserId: userId,
      topicTitle: topic.title, topicSummary: topic.summary, topicTags: topic.tags,
      topicSourceUrl: topic.shareScope === 'summary_and_source' ? topic.sourceUrl : null,
      topicShareScope: topic.shareScope, topicAllowRecipientSave: topic.allowRecipientSave,
    };
  }

  private async assertEligible(tx: Prisma.TransactionClient, first: string, second: string) {
    const [forward, reverse, blocked, active] = await Promise.all([
      tx.friendship.findUnique({ where: { userId_friendId: { userId: first, friendId: second } } }),
      tx.friendship.findUnique({ where: { userId_friendId: { userId: second, friendId: first } } }),
      tx.blockedUser.findFirst({ where: { OR: [{ blockerId: first, blockedId: second }, { blockerId: second, blockedId: first }] } }),
      tx.user.count({ where: { id: { in: [first, second] }, accountStatus: 'ACTIVE', deletionRequestedAt: null } }),
    ]);
    if (!forward || !reverse || blocked || active !== 2) this.notAvailable('VISIT_ROOM_NOT_AVAILABLE');
  }

  private async publishRoom(sessionId: string, event: string, payload: Record<string, string>) {
    const participants = await this.prisma.visitSessionParticipant.findMany({ where: { sessionId, state: { not: 'left' } }, select: { userId: true } });
    for (const participant of participants) this.events.publishToUser(participant.userId, event, { sessionId, ...payload });
  }

  private participantSummary(value: any) {
    return {
      id: value.id, sessionId: value.sessionId, userId: value.userId,
      networkCompanionId: value.networkCompanionId, companionName: value.networkCompanion?.name,
      assetPackId: value.assetPackSnapshotId, role: value.role, state: value.state,
      readyAt: value.readyAt?.toISOString(), seenAt: value.seenAt?.toISOString(),
      joinedAt: value.joinedAt.toISOString(), leftAt: value.leftAt?.toISOString(),
      createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(),
    };
  }

  private topicSummary(value: any) {
    return {
      ...value,
      sourceUrl: value.shareScope === 'summary_and_source' ? value.sourceUrl ?? undefined : undefined,
      startedAt: value.startedAt?.toISOString(), completedAt: value.completedAt?.toISOString(),
      createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(),
    };
  }

  private joinSummary(value: any) {
    const { assetPackSnapshotId, assetPackRefId: _assetPackRefId, topicRefId: _topicRefId, topicCreatedByUserId: _topicCreatedByUserId, ...summary } = value;
    return {
      ...summary,
      assetPackId: assetPackSnapshotId,
      companionName: value.networkCompanion?.name,
      topic: value.topicTitle ? {
        ownerCompanionId: value.topicOwnerCompanionId, title: value.topicTitle,
        summary: value.topicSummary, tags: value.topicTags,
        sourceUrl: value.topicShareScope === 'summary_and_source' ? value.topicSourceUrl ?? undefined : undefined,
        shareScope: value.topicShareScope, allowRecipientSave: value.topicAllowRecipientSave,
      } : undefined,
      expiresAt: value.expiresAt.toISOString(), respondedAt: value.respondedAt?.toISOString(),
      cancelledAt: value.cancelledAt?.toISOString(), createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString(),
    };
  }

  private notAvailable(code: string): never {
    throw new ConflictException({ code, message: 'Visit room is not available' });
  }
}
