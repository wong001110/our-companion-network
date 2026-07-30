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
  assertNextVisitTurn,
  assertSharedMomentEligible,
  sanitizeVisitShareEnvelope,
  type SanitizedVisitShareEnvelope,
  type VisitShareEnvelopeInput,
  type VisitSocialEmotion,
  type VisitSocialIntent,
  VISIT_SOCIAL_MAX_TURNS,
} from './visit-social.policy';

interface VisitSessionParticipant {
  id: string;
  invitationId: string;
  visitorOwnerUserId: string;
  hostUserId: string;
  networkCompanionId: string;
  hostNetworkCompanionId: string | null;
  state: string;
  startedAt: Date | null;
  endedAt: Date | null;
}

interface ShareRow {
  id: string;
  sessionId: string;
  title: string;
  summary: string;
  tags: unknown;
  sourceUrl: string | null;
  createdByUserId: string;
  createdAt: Date;
}

interface TurnRow {
  id: string;
  sessionId: string;
  sequence: number;
  clientTurnId: string;
  senderUserId: string;
  intent: string;
  message: string;
  emotion: string | null;
  topic: string | null;
  createdAt: Date;
}

interface MomentRow {
  id: string;
  sessionId: string;
  title: string;
  summary: string;
  turnCount: number;
  createdAt: Date;
}

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
    const [shares, turns, moments] = await Promise.all([
      this.prisma.$queryRaw<ShareRow[]>`
        SELECT "id", "sessionId", "title", "summary", "tags", "sourceUrl", "createdByUserId", "createdAt"
        FROM "VisitShareEnvelope" WHERE "sessionId" = ${sessionId}
      `,
      this.prisma.$queryRaw<TurnRow[]>`
        SELECT "id", "sessionId", "sequence", "clientTurnId", "senderUserId", "intent", "message", "emotion", "topic", "createdAt"
        FROM "VisitTurn" WHERE "sessionId" = ${sessionId} ORDER BY "sequence" ASC
      `,
      this.prisma.$queryRaw<MomentRow[]>`
        SELECT "id", "sessionId", "title", "summary", "turnCount", "createdAt"
        FROM "VisitSharedMoment" WHERE "sessionId" = ${sessionId}
      `,
    ]);
    const lastTurn = turns[turns.length - 1];
    return {
      sessionId,
      maxTurns: VISIT_SOCIAL_MAX_TURNS,
      nextActorUserId: this.nextActor(session, lastTurn),
      share: shares[0] ? this.shareSummary(shares[0]) : undefined,
      turns: turns.map((turn) => this.turnSummary(turn)),
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
      await this.assertEligible(tx, session.visitorOwnerUserId, session.hostUserId);
      const id = randomUUID();
      const rows = await tx.$queryRaw<ShareRow[]>`
        INSERT INTO "VisitShareEnvelope" (
          "id", "sessionId", "title", "summary", "tags", "sourceUrl", "createdByUserId", "createdAt"
        ) VALUES (
          ${id}, ${sessionId}, ${share.title}, ${share.summary}, ${JSON.stringify(share.tags)}::jsonb,
          ${share.sourceUrl ?? null}, ${userId}, NOW()
        )
        ON CONFLICT ("sessionId") DO UPDATE SET
          "title" = EXCLUDED."title",
          "summary" = EXCLUDED."summary",
          "tags" = EXCLUDED."tags",
          "sourceUrl" = EXCLUDED."sourceUrl",
          "createdByUserId" = EXCLUDED."createdByUserId"
        RETURNING "id", "sessionId", "title", "summary", "tags", "sourceUrl", "createdByUserId", "createdAt"
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
      await this.assertEligible(tx, session.visitorOwnerUserId, session.hostUserId);
      const share = await tx.$queryRaw<ShareRow[]>`
        SELECT "id", "sessionId", "title", "summary", "tags", "sourceUrl", "createdByUserId", "createdAt"
        FROM "VisitShareEnvelope" WHERE "sessionId" = ${sessionId}
      `;
      if (!share[0]) throw new ConflictException({ code: 'VISIT_SHARE_REQUIRED', message: 'An approved Discovery share is required' });

      const duplicate = await tx.$queryRaw<TurnRow[]>`
        SELECT "id", "sessionId", "sequence", "clientTurnId", "senderUserId", "intent", "message", "emotion", "topic", "createdAt"
        FROM "VisitTurn" WHERE "sessionId" = ${sessionId} AND "clientTurnId" = ${input.clientTurnId}
      `;
      if (duplicate[0]) return { turn: duplicate[0], session, autoEnded: false, duplicate: true };

      const latest = await tx.$queryRaw<TurnRow[]>`
        SELECT "id", "sessionId", "sequence", "clientTurnId", "senderUserId", "intent", "message", "emotion", "topic", "createdAt"
        FROM "VisitTurn" WHERE "sessionId" = ${sessionId} ORDER BY "sequence" DESC LIMIT 1
      `;
      try {
        assertNextVisitTurn({
          senderUserId: userId,
          visitorOwnerUserId: session.visitorOwnerUserId,
          lastSenderUserId: latest[0]?.senderUserId,
          currentTurnCount: latest[0]?.sequence ?? 0,
        });
      } catch (error) {
        const code = error instanceof Error ? error.message : 'VISIT_TURN_INVALID';
        throw new ConflictException({ code, message: 'The Visit turn was rejected' });
      }

      const sequence = (latest[0]?.sequence ?? 0) + 1;
      const id = randomUUID();
      const message = input.message.replace(/\s+/g, ' ').trim().slice(0, 800);
      if (!message) throw new ConflictException({ code: 'VISIT_TURN_INVALID', message: 'The Visit turn is empty' });
      const topic = input.topic?.replace(/\s+/g, ' ').trim().slice(0, 80) || null;
      const rows = await tx.$queryRaw<TurnRow[]>`
        INSERT INTO "VisitTurn" (
          "id", "sessionId", "sequence", "clientTurnId", "senderUserId", "intent", "message", "emotion", "topic", "createdAt"
        ) VALUES (
          ${id}, ${sessionId}, ${sequence}, ${input.clientTurnId}, ${userId}, ${input.intent}, ${message},
          ${input.emotion ?? null}, ${topic}, NOW()
        )
        RETURNING "id", "sessionId", "sequence", "clientTurnId", "senderUserId", "intent", "message", "emotion", "topic", "createdAt"
      `;

      let autoEnded = false;
      if (sequence >= VISIT_SOCIAL_MAX_TURNS) {
        await tx.visitSession.update({
          where: { id: sessionId },
          data: { state: 'ended', endingAt: new Date(), endedAt: new Date(), endReason: 'social_turn_limit', assetPackRefId: null },
        });
        await this.ensureMoment(tx, sessionId, sequence, share[0]);
        autoEnded = true;
      }
      return { turn: rows[0], session, autoEnded, duplicate: false };
    });

    if (!result.duplicate) this.publish(sessionId, userId, 'visit.turn.created', { sequence: result.turn.sequence });
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
      const shareRows = await tx.$queryRaw<ShareRow[]>`
        SELECT "id", "sessionId", "title", "summary", "tags", "sourceUrl", "createdByUserId", "createdAt"
        FROM "VisitShareEnvelope" WHERE "sessionId" = ${sessionId}
      `;
      if (!shareRows[0]) throw new ConflictException({ code: 'VISIT_SHARE_REQUIRED', message: 'The Visit has no approved Discovery share' });
      const countRows = await tx.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS "count" FROM "VisitTurn" WHERE "sessionId" = ${sessionId}
      `;
      const turnCount = Number(countRows[0]?.count ?? 0n);
      try {
        assertSharedMomentEligible(session.state, turnCount);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'VISIT_SHARED_MOMENT_INVALID';
        throw new ConflictException({ code, message: 'The Shared Moment was rejected' });
      }
      return this.ensureMoment(tx, sessionId, turnCount, shareRows[0]);
    });
    this.publish(sessionId, userId, 'visit.shared_moment.created');
    return this.momentSummary(moment);
  }

  private async ensureMoment(tx: Prisma.TransactionClient, sessionId: string, turnCount: number, share: ShareRow): Promise<MomentRow> {
    const id = randomUUID();
    const title = `Shared: ${share.title}`.slice(0, 160);
    const summary = `The Companions shared “${share.title}” and exchanged ${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}.`.slice(0, 600);
    const inserted = await tx.$queryRaw<MomentRow[]>`
      INSERT INTO "VisitSharedMoment" ("id", "sessionId", "title", "summary", "turnCount", "createdAt")
      VALUES (${id}, ${sessionId}, ${title}, ${summary}, ${turnCount}, NOW())
      ON CONFLICT ("sessionId") DO NOTHING
      RETURNING "id", "sessionId", "title", "summary", "turnCount", "createdAt"
    `;
    if (inserted[0]) {
      await this.updateRelationship(tx, sessionId, turnCount, share);
      return inserted[0];
    }
    const existing = await tx.$queryRaw<MomentRow[]>`
      SELECT "id", "sessionId", "title", "summary", "turnCount", "createdAt"
      FROM "VisitSharedMoment" WHERE "sessionId" = ${sessionId}
    `;
    if (!existing[0]) throw new ConflictException({ code: 'VISIT_SHARED_MOMENT_RACE', message: 'The Shared Moment could not be reconciled' });
    return existing[0];
  }

  private async updateRelationship(tx: Prisma.TransactionClient, sessionId: string, turnCount: number, share: ShareRow): Promise<void> {
    const session = await tx.visitSession.findUnique({
      where: { id: sessionId },
      select: { networkCompanionId: true, hostNetworkCompanionId: true },
    });
    if (!session?.hostNetworkCompanionId || session.networkCompanionId === session.hostNetworkCompanionId) return;
    const [companionLowId, companionHighId] = [session.networkCompanionId, session.hostNetworkCompanionId].sort();
    const tags = Array.isArray(share.tags)
      ? share.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 5)
      : [];
    const relationshipId = randomUUID();
    const tagArray = tags.length
      ? Prisma.sql`ARRAY[${Prisma.join(tags)}]::text[]`
      : Prisma.sql`ARRAY[]::text[]`;
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
          SELECT DISTINCT tag FROM unnest("CompanionRelationship"."sharedTopicTags" || EXCLUDED."sharedTopicTags") AS tag
          LIMIT 20
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

  private async requireParticipantSession(userId: string, sessionId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma): Promise<VisitSessionParticipant> {
    const session = await tx.visitSession.findUnique({
      where: { id: sessionId },
      select: { id: true, invitationId: true, visitorOwnerUserId: true, hostUserId: true, networkCompanionId: true, hostNetworkCompanionId: true, state: true, startedAt: true, endedAt: true },
    });
    if (!session) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
    if (session.visitorOwnerUserId !== userId && session.hostUserId !== userId) {
      throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit session is not available' });
    }
    return session;
  }

  private async assertEligible(tx: Prisma.TransactionClient, first: string, second: string): Promise<void> {
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

  private nextActor(session: VisitSessionParticipant, lastTurn?: TurnRow): string | undefined {
    if (session.state !== 'active') return undefined;
    if (!lastTurn) return session.visitorOwnerUserId;
    if (lastTurn.sequence >= VISIT_SOCIAL_MAX_TURNS) return undefined;
    return lastTurn.senderUserId === session.visitorOwnerUserId ? session.hostUserId : session.visitorOwnerUserId;
  }

  private publish(sessionId: string, actorUserId: string, event: string, extra: Record<string, unknown> = {}): void {
    void this.prisma.visitSession.findUnique({
      where: { id: sessionId },
      select: { visitorOwnerUserId: true, hostUserId: true },
    }).then((session) => {
      if (!session) return;
      const payload = { sessionId, actorUserId, ...extra };
      this.events.publishToUser(session.visitorOwnerUserId, event, payload);
      this.events.publishToUser(session.hostUserId, event, payload);
    });
  }

  private shareSummary(row: ShareRow): SanitizedVisitShareEnvelope & { id: string; sessionId: string; createdAt: string } {
    const tags = Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 5) : [];
    return { id: row.id, sessionId: row.sessionId, kind: 'discovery', title: row.title, summary: row.summary, tags, ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}), createdAt: row.createdAt.toISOString() };
  }

  private turnSummary(row: TurnRow) {
    return { id: row.id, sessionId: row.sessionId, sequence: row.sequence, senderUserId: row.senderUserId, intent: row.intent, message: row.message, emotion: row.emotion ?? undefined, topic: row.topic ?? undefined, createdAt: row.createdAt.toISOString() };
  }

  private momentSummary(row: MomentRow) {
    return { id: row.id, sessionId: row.sessionId, title: row.title, summary: row.summary, turnCount: row.turnCount, createdAt: row.createdAt.toISOString() };
  }
}
