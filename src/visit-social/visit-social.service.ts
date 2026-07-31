import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SocialEventPublisher } from '../common/social-event-publisher.service';
import {
  sanitizeVisitShareEnvelope,
  type SanitizedVisitShareEnvelope,
  type VisitShareEnvelopeInput,
  type VisitSocialEmotion,
  type VisitSocialIntent,
} from './visit-social.policy';

const ROOM_MAX_TURNS = 15;
const LEGACY_MAX_TURNS = 12;
const TOPIC_BOUNDARY_INTENTS = new Set(['LEAVE', 'PAUSE']);

type SessionRow = {
  id: string;
  invitationId: string;
  visitorOwnerUserId: string;
  hostUserId: string;
  networkCompanionId: string;
  hostNetworkCompanionId: string | null;
  state: string;
  startedAt: Date | null;
  endedAt: Date | null;
  currentTopicSequence?: number;
};

type ShareRow = {
  id: string;
  sessionId: string;
  roomTopicId?: string | null;
  title: string;
  summary: string;
  tags: unknown;
  sourceUrl: string | null;
  createdByUserId: string;
  createdAt: Date;
};

type TurnRow = {
  id: string;
  sessionId: string;
  sequence: number;
  clientTurnId: string;
  senderUserId: string;
  roomTopicId?: string | null;
  intent: string;
  message: string;
  emotion: string | null;
  topic: string | null;
  createdAt: Date;
};

type MomentRow = {
  id: string;
  sessionId: string;
  title: string;
  summary: string;
  turnCount: number;
  createdAt: Date;
};

type ParticipantRow = {
  id: string;
  userId: string;
  networkCompanionId: string;
  role: string;
  state: string;
  readyAt: Date | null;
  joinedAt: Date;
};

type RoomTopicRow = {
  id: string;
  sessionId: string;
  sequence: number;
  state: string;
  ownerCompanionId: string;
  createdByUserId: string;
  title: string;
  summary: string;
  tags: string[];
  sourceUrl: string | null;
  shareScope: string;
  allowRecipientSave: boolean;
  minimumTurns: number;
  maximumTurns: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface AppendVisitTurnInput {
  clientTurnId: string;
  intent: VisitSocialIntent;
  message: string;
  emotion?: VisitSocialEmotion;
  topic?: string;
}

@Injectable()
export class VisitSocialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: SocialEventPublisher,
  ) {}

  async getState(userId: string, sessionId: string) {
    const session = await this.requireParticipantSession(userId, sessionId);
    const [shares, turns, moments, topics, participants] = await Promise.all([
      this.readShares(this.prisma, sessionId),
      this.readTurns(this.prisma, sessionId),
      this.readMoments(this.prisma, sessionId),
      this.loadRoomTopics(this.prisma, sessionId),
      this.loadParticipants(this.prisma, session, false),
    ]);
    const activeTopic = topics.find((topic) => topic.state === 'active');
    const lastTurn = turns[turns.length - 1];
    const activeParticipants = participants.filter((participant) => participant.state === 'active');
    return {
      sessionId,
      maxTurns: ROOM_MAX_TURNS,
      currentTopicSequence: activeTopic?.sequence ?? session.currentTopicSequence ?? 1,
      nextActorUserId: this.nextActor(session.state, activeParticipants, lastTurn),
      share: activeTopic
        ? this.topicAsShare(activeTopic)
        : shares[0] ? this.shareSummary(shares[0]) : undefined,
      activeTopic: activeTopic ? this.topicSummary(activeTopic) : undefined,
      topics: topics.map((topic) => this.topicSummary(topic)),
      participants: participants.map((participant) => this.participantSummary(participant)),
      turns: turns.map((turn: TurnRow) => this.turnSummary(turn)),
      sharedMoment: moments[0] ? this.momentSummary(moments[0]) : undefined,
    };
  }

  async setShare(userId: string, sessionId: string, input: VisitShareEnvelopeInput) {
    const share = sanitizeVisitShareEnvelope(input);
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VisitSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const session = await this.requireParticipantSession(userId, sessionId, tx);
      if (session.visitorOwnerUserId !== userId) {
        throw new ForbiddenException({ code: 'VISIT_SHARE_NOT_OWNER', message: 'Only the visiting Companion owner may share a Discovery' });
      }
      if (session.state !== 'preparing') {
        throw new ConflictException({ code: 'VISIT_SHARE_STATE_CHANGED', message: 'The Discovery share can only be approved while preparing' });
      }
      const participants = await this.loadParticipants(tx, session, false);
      await this.assertRoomEligible(tx, participants.map((participant) => participant.userId));
      let roomTopicId: string | null = null;
      const roomTopics = (tx as any).visitRoomTopic;
      if (roomTopics) {
        const topic = await roomTopics.upsert({
          where: { sessionId_sequence: { sessionId, sequence: 1 } },
          create: {
            sessionId,
            sequence: 1,
            state: 'active',
            ownerCompanionId: session.networkCompanionId,
            createdByUserId: userId,
            title: share.title,
            summary: share.summary,
            tags: share.tags,
            sourceUrl: share.sourceUrl ?? null,
            shareScope: share.sourceUrl ? 'summary_and_source' : 'summary_only',
            allowRecipientSave: false,
            startedAt: new Date(),
          },
          update: {
            state: 'active',
            title: share.title,
            summary: share.summary,
            tags: share.tags,
            sourceUrl: share.sourceUrl ?? null,
            shareScope: share.sourceUrl ? 'summary_and_source' : 'summary_only',
          },
        });
        roomTopicId = topic.id;
      }
      const id = randomUUID();
      const rows = await tx.$queryRaw<ShareRow[]>`
        INSERT INTO "VisitShareEnvelope" (
          "id", "sessionId", "roomTopicId", "title", "summary", "tags", "sourceUrl", "createdByUserId", "createdAt"
        ) VALUES (
          ${id}, ${sessionId}, ${roomTopicId}, ${share.title}, ${share.summary}, ${JSON.stringify(share.tags)}::jsonb,
          ${share.sourceUrl ?? null}, ${userId}, NOW()
        )
        ON CONFLICT ("sessionId") DO UPDATE SET
          "roomTopicId" = EXCLUDED."roomTopicId",
          "title" = EXCLUDED."title",
          "summary" = EXCLUDED."summary",
          "tags" = EXCLUDED."tags",
          "sourceUrl" = EXCLUDED."sourceUrl",
          "createdByUserId" = EXCLUDED."createdByUserId"
        RETURNING "id", "sessionId", "roomTopicId", "title", "summary", "tags", "sourceUrl", "createdByUserId", "createdAt"
      `;
      return rows[0];
    });
    this.publish(sessionId, userId, 'visit.share.updated');
    return this.shareSummary(row);
  }

  async appendTurn(userId: string, sessionId: string, input: AppendVisitTurnInput) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VisitSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const session = await this.requireParticipantSession(userId, sessionId, tx);
      if (session.state !== 'active') {
        throw new ConflictException({ code: 'VISIT_SESSION_NOT_ACTIVE', message: 'Visit turns require an active session' });
      }
      const participants = await this.loadParticipants(tx, session, true);
      if (!participants.some((participant) => participant.userId === userId)) {
        throw new ConflictException({ code: 'VISIT_PARTICIPANT_NOT_READY', message: 'This Companion is not ready to speak' });
      }
      await this.assertRoomEligible(tx, participants.map((participant) => participant.userId));
      const shares = await this.readShares(tx, sessionId);
      if (!shares[0]) throw new ConflictException({ code: 'VISIT_SHARE_REQUIRED', message: 'An approved Discovery share is required' });
      const topics = await this.loadRoomTopics(tx, sessionId);
      const activeTopic = topics.find((topic) => topic.state === 'active');
      if (topics.length && !activeTopic) {
        throw new ConflictException({ code: 'VISIT_TOPIC_STATE_CHANGED', message: 'The room has no active topic' });
      }

      const duplicate = await tx.$queryRaw<TurnRow[]>`
        SELECT "id", "sessionId", "sequence", "clientTurnId", "senderUserId", "roomTopicId", "intent", "message", "emotion", "topic", "createdAt"
        FROM "VisitTurn" WHERE "sessionId" = ${sessionId} AND "clientTurnId" = ${input.clientTurnId}
      `;
      if (duplicate[0]) return { turn: duplicate[0], autoEnded: false, topicSwitched: false, duplicate: true };

      const latest = await tx.$queryRaw<TurnRow[]>`
        SELECT "id", "sessionId", "sequence", "clientTurnId", "senderUserId", "roomTopicId", "intent", "message", "emotion", "topic", "createdAt"
        FROM "VisitTurn" WHERE "sessionId" = ${sessionId} ORDER BY "sequence" DESC LIMIT 1
      `;
      const expectedActor = this.nextActor(session.state, participants, latest[0]);
      if (!expectedActor || expectedActor !== userId) {
        throw new ConflictException({ code: 'VISIT_TURN_ORDER_INVALID', message: 'It is another Companion’s turn' });
      }
      const sequence = (latest[0]?.sequence ?? 0) + 1;
      if (sequence > ROOM_MAX_TURNS) {
        throw new ConflictException({ code: 'VISIT_TURN_LIMIT_REACHED', message: 'The room turn limit was reached' });
      }
      const id = randomUUID();
      const message = input.message.replace(/\s+/g, ' ').trim().slice(0, 800);
      if (!message) throw new ConflictException({ code: 'VISIT_TURN_INVALID', message: 'The Visit turn is empty' });
      const topicLabel = input.topic?.replace(/\s+/g, ' ').trim().slice(0, 80) || null;
      const roomTopicId = activeTopic?.id ?? shares[0].roomTopicId ?? null;
      const rows = await tx.$queryRaw<TurnRow[]>`
        INSERT INTO "VisitTurn" (
          "id", "sessionId", "sequence", "clientTurnId", "senderUserId", "roomTopicId", "intent", "message", "emotion", "topic", "createdAt"
        ) VALUES (
          ${id}, ${sessionId}, ${sequence}, ${input.clientTurnId}, ${userId}, ${roomTopicId}, ${input.intent}, ${message},
          ${input.emotion ?? null}, ${topicLabel}, NOW()
        )
        RETURNING "id", "sessionId", "sequence", "clientTurnId", "senderUserId", "roomTopicId", "intent", "message", "emotion", "topic", "createdAt"
      `;

      const progress = activeTopic
        ? await this.progressRoom(tx, session, activeTopic, sequence, input.intent, shares[0])
        : await this.progressLegacyRoom(tx, session, sequence, shares[0]);
      return { turn: rows[0], ...progress, duplicate: false };
    });

    if (!result.duplicate) this.publish(sessionId, userId, 'visit.turn.created', { sequence: result.turn.sequence });
    if (result.topicSwitched) this.publish(sessionId, userId, 'visit.topic.changed');
    if (result.autoEnded) {
      this.publish(sessionId, userId, 'visit.shared_moment.created');
      this.publish(sessionId, userId, 'visit.session.ended', { state: 'ended' });
    }
    return this.turnSummary(result.turn);
  }

  async finalizeMoment(userId: string, sessionId: string) {
    const moment = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VisitSession" WHERE "id" = ${sessionId} FOR UPDATE`;
      const session = await this.requireParticipantSession(userId, sessionId, tx);
      if (session.state !== 'ended') {
        throw new ConflictException({ code: 'VISIT_SESSION_NOT_COMPLETED', message: 'Only a completed Visit can create a Shared Moment' });
      }
      const shares = await this.readShares(tx, sessionId);
      if (!shares[0]) throw new ConflictException({ code: 'VISIT_SHARE_REQUIRED', message: 'The Visit has no approved Discovery share' });
      const turnCount = await this.countTurns(tx, sessionId);
      if (turnCount < 2) throw new ConflictException({ code: 'VISIT_SHARED_MOMENT_TOO_SHORT', message: 'The Visit is too short for a Shared Moment' });
      return this.ensureMoment(tx, session, turnCount, shares[0]);
    });
    this.publish(sessionId, userId, 'visit.shared_moment.created');
    return this.momentSummary(moment);
  }

  private async progressRoom(
    tx: Prisma.TransactionClient,
    session: SessionRow,
    activeTopic: RoomTopicRow,
    totalTurns: number,
    intent: string,
    share: ShareRow,
  ) {
    const topicTurnCount = await (tx as any).visitTurn.count({ where: { roomTopicId: activeTopic.id } });
    const reachedRoomLimit = totalTurns >= ROOM_MAX_TURNS;
    const reachedTopicLimit = topicTurnCount >= activeTopic.maximumTurns;
    const naturalBoundary = topicTurnCount >= activeTopic.minimumTurns && TOPIC_BOUNDARY_INTENTS.has(intent);
    if (!reachedRoomLimit && !reachedTopicLimit && !naturalBoundary) {
      return { autoEnded: false, topicSwitched: false };
    }
    await (tx as any).visitRoomTopic.update({
      where: { id: activeTopic.id },
      data: { state: 'completed', completedAt: new Date() },
    });
    const nextTopic = reachedRoomLimit ? null : await (tx as any).visitRoomTopic.findFirst({
      where: { sessionId: session.id, state: 'queued', sequence: { gt: activeTopic.sequence } },
      orderBy: { sequence: 'asc' },
    });
    if (nextTopic) {
      const startedAt = new Date();
      const activated = await (tx as any).visitRoomTopic.update({
        where: { id: nextTopic.id },
        data: { state: 'active', startedAt },
      });
      await tx.visitSession.update({
        where: { id: session.id },
        data: { currentTopicSequence: activated.sequence },
      });
      await (tx as any).visitShareEnvelope.updateMany({
        where: { sessionId: session.id },
        data: {
          roomTopicId: activated.id,
          title: activated.title,
          summary: activated.summary,
          tags: activated.tags as Prisma.InputJsonValue,
          sourceUrl: activated.shareScope === 'summary_and_source' ? activated.sourceUrl : null,
          createdByUserId: activated.createdByUserId,
        },
      });
      return { autoEnded: false, topicSwitched: true };
    }
    await this.endRoom(tx, session.id, 'social_topics_completed');
    await this.ensureMoment(tx, { ...session, state: 'ended' }, totalTurns, share);
    return { autoEnded: true, topicSwitched: false };
  }

  private async progressLegacyRoom(tx: Prisma.TransactionClient, session: SessionRow, sequence: number, share: ShareRow) {
    if (sequence < LEGACY_MAX_TURNS) return { autoEnded: false, topicSwitched: false };
    await this.endRoom(tx, session.id, 'social_turn_limit');
    await this.ensureMoment(tx, { ...session, state: 'ended' }, sequence, share);
    return { autoEnded: true, topicSwitched: false };
  }

  private async endRoom(tx: Prisma.TransactionClient, sessionId: string, reason: string) {
    const endedAt = new Date();
    await tx.visitSession.update({
      where: { id: sessionId },
      data: { state: 'ended', endingAt: endedAt, endedAt, endReason: reason, assetPackRefId: null },
    });
    const reservations = (tx as any).visitReservation;
    if (reservations) await reservations.deleteMany({ where: { sessionId } });
    const participants = (tx as any).visitSessionParticipant;
    if (participants) {
      await participants.updateMany({
        where: { sessionId, state: { not: 'left' } },
        data: { state: 'left', leftAt: endedAt, assetPackRefId: null },
      });
    }
  }

  private async ensureMoment(
    tx: Prisma.TransactionClient,
    session: SessionRow,
    turnCount: number,
    share: ShareRow,
  ): Promise<MomentRow> {
    const topics = await this.loadRoomTopics(tx, session.id);
    const completedTopics = topics.filter((topic) => topic.state === 'completed');
    const topicTitles = completedTopics.length ? completedTopics.map((topic) => topic.title) : [share.title];
    const participants = await this.loadParticipants(tx, session, false);
    const participantCount = new Set(participants.filter((participant) => participant.readyAt).map((participant) => participant.networkCompanionId)).size || 2;
    const id = randomUUID();
    const title = `Shared room: ${topicTitles.slice(0, 2).join(' → ')}`.slice(0, 160);
    const summary = `${participantCount} Companions discussed ${topicTitles.map((value) => `“${value}”`).join(', ')} across ${turnCount} turns.`.slice(0, 600);
    const inserted = await tx.$queryRaw<MomentRow[]>`
      INSERT INTO "VisitSharedMoment" ("id", "sessionId", "title", "summary", "turnCount", "createdAt")
      VALUES (${id}, ${session.id}, ${title}, ${summary}, ${turnCount}, NOW())
      ON CONFLICT ("sessionId") DO NOTHING
      RETURNING "id", "sessionId", "title", "summary", "turnCount", "createdAt"
    `;
    if (inserted[0]) {
      await this.settleRelationships(tx, session, participants, completedTopics, turnCount, share);
      return inserted[0];
    }
    const existing = await this.readMoments(tx, session.id);
    if (!existing[0]) throw new ConflictException({ code: 'VISIT_SHARED_MOMENT_RACE', message: 'The Shared Moment could not be reconciled' });
    return existing[0];
  }

  private async settleRelationships(
    tx: Prisma.TransactionClient,
    session: SessionRow,
    loadedParticipants: ParticipantRow[],
    topics: RoomTopicRow[],
    roomTurnCount: number,
    share: ShareRow,
  ) {
    const settlementModel = (tx as any).visitRelationshipSettlement;
    if (!settlementModel) {
      if (session.hostNetworkCompanionId) {
        await this.updateRelationshipPair(tx, session.id, session.networkCompanionId, session.hostNetworkCompanionId, roomTurnCount, this.tagsFromShare(share));
      }
      return;
    }
    const participants = loadedParticipants.filter((participant) => participant.readyAt);
    const unique = [...new Map(participants.map((participant) => [participant.networkCompanionId, participant])).values()];
    const tags = [...new Set((topics.length ? topics.flatMap((topic) => topic.tags) : this.tagsFromShare(share)).filter(Boolean))].slice(0, 20);
    for (let left = 0; left < unique.length; left += 1) {
      for (let right = left + 1; right < unique.length; right += 1) {
        const first = unique[left];
        const second = unique[right];
        const [companionLowId, companionHighId] = [first.networkCompanionId, second.networkCompanionId].sort();
        const pairTurnCount = await (tx as any).visitTurn.count({
          where: { sessionId: session.id, senderUserId: { in: [first.userId, second.userId] } },
        });
        const settlementId = randomUUID();
        const tagArray = tags.length ? Prisma.sql`ARRAY[${Prisma.join(tags)}]::text[]` : Prisma.sql`ARRAY[]::text[]`;
        const inserted = await tx.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "VisitRelationshipSettlement" (
            "id", "sessionId", "companionLowId", "companionHighId", "turnCount", "topicTags", "createdAt"
          ) VALUES (${settlementId}, ${session.id}, ${companionLowId}, ${companionHighId}, ${pairTurnCount}, ${tagArray}, NOW())
          ON CONFLICT ("sessionId", "companionLowId", "companionHighId") DO NOTHING
          RETURNING "id"
        `;
        if (inserted[0]) {
          await this.updateRelationshipPair(tx, session.id, companionLowId, companionHighId, pairTurnCount, tags);
        }
      }
    }
  }

  private async updateRelationshipPair(
    tx: Prisma.TransactionClient,
    _sessionId: string,
    firstCompanionId: string,
    secondCompanionId: string,
    turnCount: number,
    tags: string[],
  ) {
    if (firstCompanionId === secondCompanionId) return;
    const [companionLowId, companionHighId] = [firstCompanionId, secondCompanionId].sort();
    const relationshipId = randomUUID();
    const tagArray = tags.length ? Prisma.sql`ARRAY[${Prisma.join(tags)}]::text[]` : Prisma.sql`ARRAY[]::text[]`;
    await tx.$executeRaw`
      INSERT INTO "CompanionRelationship" (
        "id", "companionLowId", "companionHighId", "stage", "visitCount", "interactionCount",
        "totalTurnCount", "rapportScore", "topicAffinityScore", "sharedTopicTags",
        "firstMetAt", "lastInteractionAt", "createdAt", "updatedAt"
      ) VALUES (
        ${relationshipId}, ${companionLowId}, ${companionHighId}, 'acquainted', 1, 1,
        ${turnCount}, 0.08, 0.05, ${tagArray}, NOW(), NOW(), NOW(), NOW()
      )
      ON CONFLICT ("companionLowId", "companionHighId") DO UPDATE SET
        "visitCount" = "CompanionRelationship"."visitCount" + 1,
        "interactionCount" = "CompanionRelationship"."interactionCount" + 1,
        "totalTurnCount" = "CompanionRelationship"."totalTurnCount" + EXCLUDED."totalTurnCount",
        "rapportScore" = LEAST(1, "CompanionRelationship"."rapportScore" + 0.08),
        "topicAffinityScore" = LEAST(1, "CompanionRelationship"."topicAffinityScore" + 0.05),
        "sharedTopicTags" = ARRAY(
          SELECT DISTINCT tag FROM unnest("CompanionRelationship"."sharedTopicTags" || EXCLUDED."sharedTopicTags") AS tag LIMIT 20
        ),
        "stage" = CASE
          WHEN "CompanionRelationship"."visitCount" + 1 >= 12 THEN 'trusted'
          WHEN "CompanionRelationship"."visitCount" + 1 >= 8 THEN 'close'
          WHEN "CompanionRelationship"."visitCount" + 1 >= 4 THEN 'friendly'
          WHEN "CompanionRelationship"."visitCount" + 1 >= 2 THEN 'familiar'
          ELSE 'acquainted'
        END,
        "lastInteractionAt" = NOW(),
        "updatedAt" = NOW()
    `;
  }

  private async requireParticipantSession(
    userId: string,
    sessionId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<SessionRow> {
    const session = await tx.visitSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        invitationId: true,
        visitorOwnerUserId: true,
        hostUserId: true,
        networkCompanionId: true,
        hostNetworkCompanionId: true,
        state: true,
        startedAt: true,
        endedAt: true,
        currentTopicSequence: true,
      },
    });
    if (!session) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
    if (session.visitorOwnerUserId === userId || session.hostUserId === userId) return session;
    const participantModel = (tx as any).visitSessionParticipant;
    const participant = participantModel
      ? await participantModel.findUnique({ where: { sessionId_userId: { sessionId, userId } }, select: { state: true } })
      : null;
    if (!participant || participant.state === 'left') {
      throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit session is not available' });
    }
    return session;
  }

  private async loadParticipants(client: any, session: SessionRow, activeOnly: boolean): Promise<ParticipantRow[]> {
    const model = client.visitSessionParticipant;
    if (model) {
      const rows = await model.findMany({
        where: { sessionId: session.id, ...(activeOnly ? { state: 'active' } : {}) },
        select: { id: true, userId: true, networkCompanionId: true, role: true, state: true, readyAt: true, joinedAt: true },
      });
      return rows.sort((a: ParticipantRow, b: ParticipantRow) => this.participantRank(a) - this.participantRank(b) || a.joinedAt.getTime() - b.joinedAt.getTime() || a.id.localeCompare(b.id));
    }
    const now = new Date(0);
    return [
      { id: 'legacy-visitor', userId: session.visitorOwnerUserId, networkCompanionId: session.networkCompanionId, role: 'visitor', state: session.state === 'active' ? 'active' : 'ready', readyAt: now, joinedAt: now },
      ...(session.hostNetworkCompanionId ? [{ id: 'legacy-host', userId: session.hostUserId, networkCompanionId: session.hostNetworkCompanionId, role: 'host', state: session.state === 'active' ? 'active' : 'ready', readyAt: now, joinedAt: now }] : []),
    ].filter((participant) => !activeOnly || participant.state === 'active');
  }

  private participantRank(participant: ParticipantRow) {
    return participant.role === 'visitor' ? 0 : participant.role === 'host' ? 1 : 2;
  }

  private async assertRoomEligible(tx: Prisma.TransactionClient, userIds: string[]) {
    const unique = [...new Set(userIds)];
    for (let left = 0; left < unique.length; left += 1) {
      for (let right = left + 1; right < unique.length; right += 1) {
        await this.assertEligible(tx, unique[left], unique[right]);
      }
    }
  }

  private async assertEligible(tx: Prisma.TransactionClient, first: string, second: string) {
    const [forward, reverse, blocked, activeParticipants] = await Promise.all([
      tx.friendship.findUnique({ where: { userId_friendId: { userId: first, friendId: second } } }),
      tx.friendship.findUnique({ where: { userId_friendId: { userId: second, friendId: first } } }),
      tx.blockedUser.findFirst({ where: { OR: [{ blockerId: first, blockedId: second }, { blockerId: second, blockedId: first }] } }),
      tx.user.count({ where: { id: { in: [first, second] }, accountStatus: 'ACTIVE', deletionRequestedAt: null } }),
    ]);
    if (!forward || !reverse || blocked || activeParticipants !== 2) {
      throw new ConflictException({ code: 'VISIT_SOCIAL_NOT_AVAILABLE', message: 'The social Visit is no longer available' });
    }
  }

  private nextActor(state: string, participants: ParticipantRow[], lastTurn?: TurnRow) {
    if (state !== 'active' || !participants.length || (lastTurn?.sequence ?? 0) >= ROOM_MAX_TURNS) return undefined;
    if (!lastTurn) return participants[0].userId;
    const index = participants.findIndex((participant) => participant.userId === lastTurn.senderUserId);
    return participants[(index < 0 ? 0 : index + 1) % participants.length].userId;
  }

  private async loadRoomTopics(client: any, sessionId: string): Promise<RoomTopicRow[]> {
    const model = client.visitRoomTopic;
    if (!model) return [];
    return model.findMany({ where: { sessionId }, orderBy: { sequence: 'asc' } });
  }

  private readShares(client: any, sessionId: string) {
    return client.$queryRaw<ShareRow[]>`
      SELECT "id", "sessionId", "roomTopicId", "title", "summary", "tags", "sourceUrl", "createdByUserId", "createdAt"
      FROM "VisitShareEnvelope" WHERE "sessionId" = ${sessionId}
    `;
  }

  private readTurns(client: any, sessionId: string) {
    return client.$queryRaw<TurnRow[]>`
      SELECT "id", "sessionId", "sequence", "clientTurnId", "senderUserId", "roomTopicId", "intent", "message", "emotion", "topic", "createdAt"
      FROM "VisitTurn" WHERE "sessionId" = ${sessionId} ORDER BY "sequence" ASC
    `;
  }

  private readMoments(client: any, sessionId: string) {
    return client.$queryRaw<MomentRow[]>`
      SELECT "id", "sessionId", "title", "summary", "turnCount", "createdAt"
      FROM "VisitSharedMoment" WHERE "sessionId" = ${sessionId}
    `;
  }

  private async countTurns(client: any, sessionId: string) {
    if (client.visitTurn?.count) return client.visitTurn.count({ where: { sessionId } });
    const rows = await client.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count" FROM "VisitTurn" WHERE "sessionId" = ${sessionId}
    `;
    return Number(rows[0]?.count ?? 0n);
  }

  private publish(sessionId: string, actorUserId: string, event: string, extra: Record<string, unknown> = {}) {
    const participantModel = (this.prisma as any).visitSessionParticipant;
    const recipients = participantModel
      ? participantModel.findMany({ where: { sessionId }, select: { userId: true } })
      : this.prisma.visitSession.findUnique({ where: { id: sessionId }, select: { visitorOwnerUserId: true, hostUserId: true } })
          .then((session) => session ? [{ userId: session.visitorOwnerUserId }, { userId: session.hostUserId }] : []);
    void recipients.then((rows: Array<{ userId: string }>) => {
      const payload = { sessionId, actorUserId, ...extra };
      for (const userId of new Set(rows.map((row) => row.userId))) this.events.publishToUser(userId, event, payload);
    }).catch(() => undefined);
  }

  private tagsFromShare(row: ShareRow) {
    return Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 20) : [];
  }

  private shareSummary(row: ShareRow): SanitizedVisitShareEnvelope & { id: string; sessionId: string; createdAt: string } {
    return { id: row.id, sessionId: row.sessionId, kind: 'discovery', title: row.title, summary: row.summary, tags: this.tagsFromShare(row).slice(0, 5), ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}), createdAt: row.createdAt.toISOString() };
  }

  private topicAsShare(row: RoomTopicRow): SanitizedVisitShareEnvelope & { id: string; sessionId: string; createdAt: string } {
    return { id: row.id, sessionId: row.sessionId, kind: 'discovery', title: row.title, summary: row.summary, tags: row.tags.slice(0, 5), ...(row.shareScope === 'summary_and_source' && row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}), createdAt: row.createdAt.toISOString() };
  }

  private topicSummary(row: RoomTopicRow) {
    return { id: row.id, sessionId: row.sessionId, sequence: row.sequence, state: row.state, ownerCompanionId: row.ownerCompanionId, title: row.title, summary: row.summary, tags: row.tags, ...(row.shareScope === 'summary_and_source' && row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}), allowRecipientSave: row.allowRecipientSave, minimumTurns: row.minimumTurns, maximumTurns: row.maximumTurns, startedAt: row.startedAt?.toISOString(), completedAt: row.completedAt?.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  private participantSummary(row: ParticipantRow) {
    return { id: row.id, userId: row.userId, networkCompanionId: row.networkCompanionId, role: row.role, state: row.state, readyAt: row.readyAt?.toISOString(), joinedAt: row.joinedAt.toISOString() };
  }

  private turnSummary(row: TurnRow) {
    return { id: row.id, sessionId: row.sessionId, sequence: row.sequence, senderUserId: row.senderUserId, roomTopicId: row.roomTopicId ?? undefined, intent: row.intent, message: row.message, emotion: row.emotion ?? undefined, topic: row.topic ?? undefined, createdAt: row.createdAt.toISOString() };
  }

  private momentSummary(row: MomentRow) {
    return { id: row.id, sessionId: row.sessionId, title: row.title, summary: row.summary, turnCount: row.turnCount, createdAt: row.createdAt.toISOString() };
  }
}
