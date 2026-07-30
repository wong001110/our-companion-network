from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'anchor not found in {path}: {old[:120]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


def insert_before(path: str, anchor: str, content: str) -> None:
    replace_once(path, anchor, content + anchor)


# ---------------------------------------------------------------------------
# Prisma: host Companion snapshot + shared relationship aggregate.
# ---------------------------------------------------------------------------
replace_once(
    'prisma/schema.prisma',
    '''  visitInvitations  VisitInvitation[]
  visitSessions     VisitSession[]

  @@index([ownerUserId])''',
    '''  visitInvitations  VisitInvitation[]
  visitSessions     VisitSession[]
  hostedVisitSessions VisitSession[] @relation("VisitSessionHostCompanion")
  relationshipsAsLow CompanionRelationship[] @relation("CompanionRelationshipLow")
  relationshipsAsHigh CompanionRelationship[] @relation("CompanionRelationshipHigh")

  @@index([ownerUserId])''',
)
replace_once(
    'prisma/schema.prisma',
    '''  hostUserId           String
  host                 User     @relation("VisitSessionHost", fields: [hostUserId], references: [id], onDelete: Cascade)
  networkCompanionId   String''',
    '''  hostUserId           String
  host                 User     @relation("VisitSessionHost", fields: [hostUserId], references: [id], onDelete: Cascade)
  hostNetworkCompanionId String?
  hostNetworkCompanion NetworkCompanion? @relation("VisitSessionHostCompanion", fields: [hostNetworkCompanionId], references: [id], onDelete: SetNull)
  networkCompanionId   String''',
)
replace_once(
    'prisma/schema.prisma',
    '''  @@index([hostUserId, state])
  @@index([assetPackRefId, state])''',
    '''  @@index([hostUserId, state])
  @@index([hostNetworkCompanionId, state])
  @@index([assetPackRefId, state])''',
)
insert_before(
    'prisma/schema.prisma',
    'model AdminAuditLog {',
    '''model CompanionRelationship {
  id                 String   @id @default(uuid())
  companionLowId     String
  companionHighId    String
  companionLow       NetworkCompanion @relation("CompanionRelationshipLow", fields: [companionLowId], references: [id], onDelete: Cascade)
  companionHigh      NetworkCompanion @relation("CompanionRelationshipHigh", fields: [companionHighId], references: [id], onDelete: Cascade)
  stage              String   @default("new")
  visitCount         Int      @default(0)
  interactionCount   Int      @default(0)
  totalTurnCount     Int      @default(0)
  rapportScore       Float    @default(0)
  topicAffinityScore Float    @default(0)
  sharedTopicTags    String[] @default([])
  firstMetAt         DateTime @default(now())
  lastInteractionAt  DateTime @default(now())
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([companionLowId, companionHighId])
  @@index([companionLowId, lastInteractionAt])
  @@index([companionHighId, lastInteractionAt])
}

''',
)

migration = Path('prisma/migrations/20260731010000_social_journal_relationships/migration.sql')
migration.parent.mkdir(parents=True, exist_ok=True)
migration.write_text('''-- Snapshot the host Companion used by a Visit so relationship history remains stable.\nALTER TABLE "VisitSession" ADD COLUMN "hostNetworkCompanionId" TEXT;\n\nALTER TABLE "VisitSession" ADD CONSTRAINT "VisitSession_hostNetworkCompanionId_fkey"\n  FOREIGN KEY ("hostNetworkCompanionId") REFERENCES "NetworkCompanion"("id")\n  ON DELETE SET NULL ON UPDATE CASCADE;\n\nCREATE INDEX "VisitSession_hostNetworkCompanionId_state_idx"\n  ON "VisitSession"("hostNetworkCompanionId", "state");\n\n-- Existing Visits use the host's current published Companion as the best available snapshot.\nUPDATE "VisitSession" AS session\nSET "hostNetworkCompanionId" = owner."activeNetworkCompanionId"\nFROM "User" AS owner\nWHERE owner."id" = session."hostUserId"\n  AND session."hostNetworkCompanionId" IS NULL;\n\nCREATE TABLE "CompanionRelationship" (\n  "id" TEXT NOT NULL,\n  "companionLowId" TEXT NOT NULL,\n  "companionHighId" TEXT NOT NULL,\n  "stage" TEXT NOT NULL DEFAULT 'new',\n  "visitCount" INTEGER NOT NULL DEFAULT 0,\n  "interactionCount" INTEGER NOT NULL DEFAULT 0,\n  "totalTurnCount" INTEGER NOT NULL DEFAULT 0,\n  "rapportScore" DOUBLE PRECISION NOT NULL DEFAULT 0,\n  "topicAffinityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,\n  "sharedTopicTags" TEXT[] DEFAULT ARRAY[]::TEXT[],\n  "firstMetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  "lastInteractionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  "updatedAt" TIMESTAMP(3) NOT NULL,\n  CONSTRAINT "CompanionRelationship_pkey" PRIMARY KEY ("id")\n);\n\nCREATE UNIQUE INDEX "CompanionRelationship_companionLowId_companionHighId_key"\n  ON "CompanionRelationship"("companionLowId", "companionHighId");\nCREATE INDEX "CompanionRelationship_companionLowId_lastInteractionAt_idx"\n  ON "CompanionRelationship"("companionLowId", "lastInteractionAt");\nCREATE INDEX "CompanionRelationship_companionHighId_lastInteractionAt_idx"\n  ON "CompanionRelationship"("companionHighId", "lastInteractionAt");\n\nALTER TABLE "CompanionRelationship" ADD CONSTRAINT "CompanionRelationship_companionLowId_fkey"\n  FOREIGN KEY ("companionLowId") REFERENCES "NetworkCompanion"("id")\n  ON DELETE CASCADE ON UPDATE CASCADE;\nALTER TABLE "CompanionRelationship" ADD CONSTRAINT "CompanionRelationship_companionHighId_fkey"\n  FOREIGN KEY ("companionHighId") REFERENCES "NetworkCompanion"("id")\n  ON DELETE CASCADE ON UPDATE CASCADE;\n''', encoding='utf-8')

# ---------------------------------------------------------------------------
# Visit session snapshots the host Companion.
# ---------------------------------------------------------------------------
replace_once(
    'src/visit/visit.service.ts',
    '''const SESSION_SELECT = { id: true, invitationId: true, visitorOwnerUserId: true, hostUserId: true, networkCompanionId: true,''',
    '''const SESSION_SELECT = { id: true, invitationId: true, visitorOwnerUserId: true, hostUserId: true, hostNetworkCompanionId: true, networkCompanionId: true,''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''      const accepted = await tx.visitInvitation.update({ where: { id: invitation.id }, data: { status: 'accepted', respondedAt: new Date(), assetPackRefId: null }, select: INVITATION_SELECT });
      const session = await tx.visitSession.create({ data: {
        invitationId: invitation.id, visitorOwnerUserId: invitation.visitorOwnerUserId, hostUserId: invitation.hostUserId,
        networkCompanionId: invitation.networkCompanionId, assetPackSnapshotId: invitation.assetPackSnapshotId, assetPackRefId: pack.id, state: 'preparing',
      }, select: SESSION_SELECT });''',
    '''      const accepted = await tx.visitInvitation.update({ where: { id: invitation.id }, data: { status: 'accepted', respondedAt: new Date(), assetPackRefId: null }, select: INVITATION_SELECT });
      const host = await tx.user.findUnique({
        where: { id: invitation.hostUserId },
        select: { activeNetworkCompanionId: true },
      });
      const session = await tx.visitSession.create({ data: {
        invitationId: invitation.id, visitorOwnerUserId: invitation.visitorOwnerUserId, hostUserId: invitation.hostUserId,
        hostNetworkCompanionId: host?.activeNetworkCompanionId ?? null,
        networkCompanionId: invitation.networkCompanionId, assetPackSnapshotId: invitation.assetPackSnapshotId, assetPackRefId: pack.id, state: 'preparing',
      }, select: SESSION_SELECT });''',
)

# ---------------------------------------------------------------------------
# Social overview: collapse eight renderer HTTP calls into one authenticated read.
# ---------------------------------------------------------------------------
replace_once(
    'src/friend/friend.controller.ts',
    '''  @Get('lookup/uid/:uid')''',
    '''  @Get('overview')
  @SocialRateLimit('read')
  async getSocialOverview(@CurrentUser() user: UserPayload) {
    return this.friendService.getSocialOverview(user.id);
  }

  @Get('lookup/uid/:uid')''',
)
insert_before(
    'src/friend/friend.service.ts',
    '''  async removeFriend(userId: string, friendId: string) {''',
    '''  async getSocialOverview(userId: string) {
    const [friends, incoming, outgoing, blocked, presence, incomingVisits, outgoingVisits, visitSessions] = await Promise.all([
      this.getFriends(userId),
      this.getIncomingRequests(userId),
      this.getOutgoingRequests(userId),
      this.prisma.blockedUser.findMany({
        where: { blockerId: userId },
        select: {
          createdAt: true,
          blocked: { select: { id: true, uid: true, username: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.presence.findMany({
        where: { userId: { in: (await this.getFriends(userId)).map((friend) => friend.userId) } },
        select: { userId: true, status: true, updatedAt: true },
      }),
      this.visits?.listInvitations(userId, 'incoming') ?? Promise.resolve([]),
      this.visits?.listInvitations(userId, 'outgoing') ?? Promise.resolve([]),
      this.visits?.listSessions(userId) ?? Promise.resolve([]),
    ]);
    const presenceByUser = new Map(presence.map((item) => [item.userId, item]));
    return {
      friends: friends.map((friend) => ({
        ...friend,
        presence: presenceByUser.get(friend.userId)?.status ?? 'offline',
        presenceUpdatedAt: presenceByUser.get(friend.userId)?.updatedAt ?? null,
      })),
      incomingRequests: incoming.map((request) => ({
        id: request.id,
        direction: 'incoming' as const,
        userId: request.sender.id,
        username: request.sender.username,
        uid: request.sender.uid,
        friendCode: request.sender.friendCode,
        status: 'pending' as const,
        createdAt: request.createdAt,
      })),
      outgoingRequests: outgoing.map((request) => ({
        id: request.id,
        direction: 'outgoing' as const,
        userId: request.receiver.id,
        username: request.receiver.username,
        uid: request.receiver.uid,
        friendCode: request.receiver.friendCode,
        status: 'pending' as const,
        createdAt: request.createdAt,
      })),
      blockedUsers: blocked.map((item) => ({
        userId: item.blocked.id,
        username: item.blocked.username,
        uid: item.blocked.uid,
        blockedAt: item.createdAt,
      })),
      visitInvitations: { incoming: incomingVisits, outgoing: outgoingVisits },
      visitSessions,
      synchronizedAt: new Date().toISOString(),
    };
  }

''',
)
# Avoid the second getFriends query introduced above by hoisting friend IDs after the first batch.
replace_once(
    'src/friend/friend.service.ts',
    '''    const [friends, incoming, outgoing, blocked, presence, incomingVisits, outgoingVisits, visitSessions] = await Promise.all([
      this.getFriends(userId),
      this.getIncomingRequests(userId),
      this.getOutgoingRequests(userId),
      this.prisma.blockedUser.findMany({''',
    '''    const friendsPromise = this.getFriends(userId);
    const [friends, incoming, outgoing, blocked, incomingVisits, outgoingVisits, visitSessions] = await Promise.all([
      friendsPromise,
      this.getIncomingRequests(userId),
      this.getOutgoingRequests(userId),
      this.prisma.blockedUser.findMany({''',
)
replace_once(
    'src/friend/friend.service.ts',
    '''      }),
      this.prisma.presence.findMany({
        where: { userId: { in: (await this.getFriends(userId)).map((friend) => friend.userId) } },
        select: { userId: true, status: true, updatedAt: true },
      }),
      this.visits?.listInvitations(userId, 'incoming') ?? Promise.resolve([]),''',
    '''      }),
      this.visits?.listInvitations(userId, 'incoming') ?? Promise.resolve([]),''',
)
replace_once(
    'src/friend/friend.service.ts',
    '''      this.visits?.listSessions(userId) ?? Promise.resolve([]),
    ]);
    const presenceByUser = new Map(presence.map((item) => [item.userId, item]));''',
    '''      this.visits?.listSessions(userId) ?? Promise.resolve([]),
    ]);
    const presence = friends.length
      ? await this.prisma.presence.findMany({
          where: { userId: { in: friends.map((friend) => friend.userId) } },
          select: { userId: true, status: true, updatedAt: true },
        })
      : [];
    const presenceByUser = new Map(presence.map((item) => [item.userId, item]));''',
)

# ---------------------------------------------------------------------------
# Return the updated Social state from POST /turns to remove a client round trip.
# ---------------------------------------------------------------------------
replace_once(
    'src/visit-social/visit-social.controller.ts',
    '''  appendTurn(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AppendVisitTurnDto) {
    return this.social.appendTurn(user.id, id, dto);
  }''',
    '''  async appendTurn(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AppendVisitTurnDto) {
    await this.social.appendTurn(user.id, id, dto);
    return this.social.getState(user.id, id);
  }''',
)

# ---------------------------------------------------------------------------
# Relationship aggregate is updated exactly once when a Shared Moment is born.
# ---------------------------------------------------------------------------
replace_once(
    'src/visit-social/visit-social.service.ts',
    '''  hostUserId: string;
  state: string;''',
    '''  hostUserId: string;
  networkCompanionId: string;
  hostNetworkCompanionId: string | null;
  state: string;''',
)
replace_once(
    'src/visit-social/visit-social.service.ts',
    '''  private async ensureMoment(tx: Prisma.TransactionClient, sessionId: string, turnCount: number, share: ShareRow): Promise<MomentRow> {
    const id = randomUUID();
    const title = `Shared: ${share.title}`.slice(0, 160);
    const summary = `The Companions shared “${share.title}” and exchanged ${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}.`.slice(0, 600);
    const rows = await tx.$queryRaw<MomentRow[]>`
      INSERT INTO "VisitSharedMoment" ("id", "sessionId", "title", "summary", "turnCount", "createdAt")
      VALUES (${id}, ${sessionId}, ${title}, ${summary}, ${turnCount}, NOW())
      ON CONFLICT ("sessionId") DO UPDATE SET
        "title" = EXCLUDED."title", "summary" = EXCLUDED."summary", "turnCount" = EXCLUDED."turnCount"
      RETURNING "id", "sessionId", "title", "summary", "turnCount", "createdAt"
    `;
    return rows[0];
  }''',
    '''  private async ensureMoment(tx: Prisma.TransactionClient, sessionId: string, turnCount: number, share: ShareRow): Promise<MomentRow> {
    const existing = await tx.$queryRaw<MomentRow[]>`
      SELECT "id", "sessionId", "title", "summary", "turnCount", "createdAt"
      FROM "VisitSharedMoment" WHERE "sessionId" = ${sessionId}
    `;
    if (existing[0]) return existing[0];
    const id = randomUUID();
    const title = `Shared: ${share.title}`.slice(0, 160);
    const summary = `The Companions shared “${share.title}” and exchanged ${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}.`.slice(0, 600);
    const rows = await tx.$queryRaw<MomentRow[]>`
      INSERT INTO "VisitSharedMoment" ("id", "sessionId", "title", "summary", "turnCount", "createdAt")
      VALUES (${id}, ${sessionId}, ${title}, ${summary}, ${turnCount}, NOW())
      RETURNING "id", "sessionId", "title", "summary", "turnCount", "createdAt"
    `;
    await this.updateRelationship(tx, sessionId, turnCount, share);
    return rows[0];
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
    await tx.$executeRaw`
      INSERT INTO "CompanionRelationship" (
        "id", "companionLowId", "companionHighId", "stage", "visitCount", "interactionCount",
        "totalTurnCount", "rapportScore", "topicAffinityScore", "sharedTopicTags",
        "firstMetAt", "lastInteractionAt", "createdAt", "updatedAt"
      ) VALUES (
        ${relationshipId}, ${companionLowId}, ${companionHighId}, 'acquainted', 1, 1,
        ${turnCount}, 0.08, 0.05, ${tags}::text[], NOW(), NOW(), NOW(), NOW()
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
  }''',
)
replace_once(
    'src/visit-social/visit-social.service.ts',
    '''      select: { id: true, invitationId: true, visitorOwnerUserId: true, hostUserId: true, state: true, startedAt: true, endedAt: true },''',
    '''      select: { id: true, invitationId: true, visitorOwnerUserId: true, hostUserId: true, networkCompanionId: true, hostNetworkCompanionId: true, state: true, startedAt: true, endedAt: true },''',
)

# ---------------------------------------------------------------------------
# Portal API: Social Journal detail and relationship pages.
# ---------------------------------------------------------------------------
replace_once(
    'src/portal/portal.controller.ts',
    '''  @Get('devices')''',
    '''  @Get('relationships')
  relationships(
    @CurrentUser() user: UserPayload,
    @Query() query: PortalListQueryDto,
  ) {
    return this.portal.listRelationships(user.id, query);
  }

  @Get('relationships/:id')
  relationship(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.portal.getRelationship(user.id, id);
  }

  @Get('devices')''',
)
replace_once(
    'src/portal/portal.service.ts',
    '''      select: PORTAL_SESSION_SELECT,
    });
    if (session) return { kind: 'session', ...withDuration(session) };''',
    '''      select: PORTAL_SESSION_DETAIL_SELECT,
    });
    if (session) return { kind: 'session', ...withDuration(session) };''',
)
insert_before(
    'src/portal/portal.service.ts',
    '''  async listDevices(userId: string, query: PortalListQueryDto) {''',
    '''  async listRelationships(userId: string, query: PortalListQueryDto) {
    const page = boundedPage(query);
    const where: Prisma.CompanionRelationshipWhereInput = {
      OR: [
        { companionLow: { ownerUserId: userId } },
        { companionHigh: { ownerUserId: userId } },
      ],
      ...(query.search ? {
        AND: [{ OR: [
          { companionLow: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
          { companionHigh: { name: { contains: query.search.trim(), mode: 'insensitive' } } },
          { sharedTopicTags: { has: query.search.trim() } },
        ] }],
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.companionRelationship.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('lastInteractionAt', query.direction),
        select: PORTAL_RELATIONSHIP_SELECT,
      }),
      this.prisma.companionRelationship.count({ where }),
    ]);
    return pageEnvelope(items.map((item) => relationshipPerspective(item, userId)), total, page);
  }

  async getRelationship(userId: string, id: string) {
    const relationship = await this.prisma.companionRelationship.findFirst({
      where: {
        id,
        OR: [
          { companionLow: { ownerUserId: userId } },
          { companionHigh: { ownerUserId: userId } },
        ],
      },
      select: PORTAL_RELATIONSHIP_SELECT,
    });
    if (!relationship) throw new NotFoundException('Companion relationship not found');
    const visits = await this.prisma.visitSession.findMany({
      where: {
        OR: [
          { networkCompanionId: relationship.companionLowId, hostNetworkCompanionId: relationship.companionHighId },
          { networkCompanionId: relationship.companionHighId, hostNetworkCompanionId: relationship.companionLowId },
        ],
      },
      take: 20,
      orderBy: stableOrderBy('updatedAt'),
      select: {
        id: true,
        state: true,
        startedAt: true,
        endedAt: true,
        socialShare: { select: { title: true, summary: true, tags: true, sourceUrl: true } },
        sharedMoment: { select: { title: true, summary: true, turnCount: true, createdAt: true } },
      },
    });
    return { ...relationshipPerspective(relationship, userId), visits };
  }

''',
)
replace_once(
    'src/portal/portal.service.ts',
    '''  hostUserId: true,
  networkCompanionId: true,
  assetPackSnapshotId: true,''',
    '''  hostUserId: true,
  hostNetworkCompanionId: true,
  networkCompanionId: true,
  assetPackSnapshotId: true,''',
)
insert_before(
    'src/portal/portal.service.ts',
    '''function exportCursorPage(cursor?: string) {''',
    '''const PORTAL_SESSION_DETAIL_SELECT = {
  ...PORTAL_SESSION_SELECT,
  visitorOwner: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
  host: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
  hostNetworkCompanion: { select: { id: true, name: true } },
  socialShare: {
    select: { id: true, title: true, summary: true, tags: true, sourceUrl: true, createdAt: true },
  },
  socialTurns: {
    orderBy: { sequence: 'asc' as const },
    select: { id: true, sequence: true, senderUserId: true, intent: true, message: true, emotion: true, topic: true, createdAt: true },
  },
  sharedMoment: {
    select: { id: true, title: true, summary: true, turnCount: true, createdAt: true },
  },
} as const;

const PORTAL_RELATIONSHIP_SELECT = {
  id: true,
  companionLowId: true,
  companionHighId: true,
  stage: true,
  visitCount: true,
  interactionCount: true,
  totalTurnCount: true,
  rapportScore: true,
  topicAffinityScore: true,
  sharedTopicTags: true,
  firstMetAt: true,
  lastInteractionAt: true,
  createdAt: true,
  updatedAt: true,
  companionLow: { select: { id: true, name: true, ownerUserId: true } },
  companionHigh: { select: { id: true, name: true, ownerUserId: true } },
} as const;

function relationshipPerspective<T extends {
  companionLow: { id: string; name: string; ownerUserId: string };
  companionHigh: { id: string; name: string; ownerUserId: string };
}>(relationship: T, userId: string) {
  const ownCompanion = relationship.companionLow.ownerUserId === userId
    ? relationship.companionLow
    : relationship.companionHigh;
  const remoteCompanion = ownCompanion.id === relationship.companionLow.id
    ? relationship.companionHigh
    : relationship.companionLow;
  return { ...relationship, ownCompanion, remoteCompanion };
}

''',
)

# Include Social Journal and relationship aggregate in data export.
replace_once(
    'src/portal/portal.service.ts',
    '''    yield ',"notifications":';''',
    '''    yield ',"companionRelationships":';
    yield* this.streamExportArray((cursor) =>
      this.prisma.companionRelationship.findMany({
        where: {
          OR: [
            { companionLow: { ownerUserId: userId } },
            { companionHigh: { ownerUserId: userId } },
          ],
        },
        ...exportCursorPage(cursor),
        select: PORTAL_RELATIONSHIP_SELECT,
      }));
    yield ',"notifications":';''',
)

# ---------------------------------------------------------------------------
# Portal user UI.
# ---------------------------------------------------------------------------
replace_once(
    'portal/src/app/App.tsx',
    '''const VisitsPage = lazy(() => import('../pages/VisitsPage').then((module) => ({ default: module.VisitsPage })));
const SecurityPage''',
    '''const VisitsPage = lazy(() => import('../pages/VisitsPage').then((module) => ({ default: module.VisitsPage })));
const RelationshipsPage = lazy(() => import('../pages/RelationshipsPage').then((module) => ({ default: module.RelationshipsPage })));
const SecurityPage''',
)
replace_once(
    'portal/src/app/App.tsx',
    '''          <Route path="visits/:id" element={<VisitsPage />} />
          <Route path="security"''',
    '''          <Route path="visits/:id" element={<VisitsPage />} />
          <Route path="relationships" element={<RelationshipsPage />} />
          <Route path="relationships/:id" element={<RelationshipsPage />} />
          <Route path="security"''',
)
replace_once(
    'portal/src/components/AppShell.tsx',
    '''  { to: '/my-network/visits', label: 'Visits', icon: Sparkles },
  { to: '/my-network/security',''',
    '''  { to: '/my-network/visits', label: 'Visits', icon: Sparkles },
  { to: '/my-network/relationships', label: 'Relationships', icon: HeartHandshake },
  { to: '/my-network/security',''',
)

relationships_page = Path('portal/src/pages/RelationshipsPage.tsx')
relationships_page.write_text('''import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { HeartHandshake, MessageCircle, Sparkles } from 'lucide-react';
import { api, type PageEnvelope } from '../lib/api';
import { formatDate, sentenceCase } from '../lib/format';
import { EmptyState, ErrorState, PageHeader, Pagination, PaperCard, SkeletonGrid, Stamp } from '../components/ui';

interface CompanionRef { id: string; name: string; ownerUserId: string }
interface Relationship {
  id: string;
  stage: string;
  visitCount: number;
  interactionCount: number;
  totalTurnCount: number;
  rapportScore: number;
  topicAffinityScore: number;
  sharedTopicTags: string[];
  firstMetAt: string;
  lastInteractionAt: string;
  ownCompanion: CompanionRef;
  remoteCompanion: CompanionRef;
  visits?: Array<{
    id: string;
    state: string;
    startedAt?: string | null;
    endedAt?: string | null;
    socialShare?: { title: string; summary: string; tags: string[]; sourceUrl?: string | null } | null;
    sharedMoment?: { title: string; summary: string; turnCount: number; createdAt: string } | null;
  }>;
}

export function RelationshipsPage() {
  const { id } = useParams();
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['relationships', page],
    queryFn: () => api<PageEnvelope<Relationship>>(`/api/portal/relationships?page=${page}&limit=12`),
    enabled: !id,
  });
  const detail = useQuery({
    queryKey: ['relationship', id],
    queryFn: () => api<Relationship>(`/api/portal/relationships/${id}`),
    enabled: Boolean(id),
  });
  if (id) return <RelationshipDetail relationship={detail.data} loading={detail.isLoading} error={detail.error} retry={() => void detail.refetch()} />;
  return <>
    <PageHeader eyebrow="My Network · Companion connections" title="Relationships" description="See who your Companion has met, what they discussed, and how their shared history is developing." />
    {list.isLoading && <SkeletonGrid cards={4} />}
    {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
    {list.data?.items.length === 0 && <EmptyState title="No Companion relationships yet">Completed Social Visits will appear here.</EmptyState>}
    <div className="people-list">
      {list.data?.items.map((item) => <PaperCard className="person-row" key={item.id}>
        <span className="avatar avatar--letter"><HeartHandshake /></span>
        <div className="person-main">
          <strong>{item.ownCompanion.name} & {item.remoteCompanion.name}</strong>
          <small>{item.visitCount} visits · {item.totalTurnCount} turns · last met {formatDate(item.lastInteractionAt)}</small>
          {item.sharedTopicTags.length > 0 && <small>{item.sharedTopicTags.slice(0, 5).join(' · ')}</small>}
        </div>
        <Stamp tone="purple">{sentenceCase(item.stage)}</Stamp>
        <Link className="text-link" to={`/my-network/relationships/${item.id}`}>Open history →</Link>
      </PaperCard>)}
    </div>
    {list.data && <Pagination {...list.data.pagination} onPage={setPage} />}
  </>;
}

function RelationshipDetail({ relationship, loading, error, retry }: { relationship?: Relationship; loading: boolean; error: unknown; retry: () => void }) {
  return <>
    <PageHeader eyebrow="My Network · Companion connection" title={relationship ? `${relationship.ownCompanion.name} & ${relationship.remoteCompanion.name}` : 'Relationship'} description="A shared, user-visible record of completed visits. Private local reflections remain on each device." actions={<Link className="button button--quiet" to="/my-network/relationships">← Back</Link>} />
    {loading && <SkeletonGrid cards={3} />}
    {error && <ErrorState error={error} onRetry={retry} />}
    {relationship && <div className="detail-layout">
      <PaperCard className="detail-hero">
        <div className="section-heading"><div><p className="eyebrow">Current stage</p><h2>{sentenceCase(relationship.stage)}</h2></div><Stamp tone="purple">{relationship.visitCount} visits</Stamp></div>
        <dl className="detail-grid">
          <div><dt>Total turns</dt><dd>{relationship.totalTurnCount}</dd></div>
          <div><dt>First met</dt><dd>{formatDate(relationship.firstMetAt)}</dd></div>
          <div><dt>Last interaction</dt><dd>{formatDate(relationship.lastInteractionAt)}</dd></div>
          <div><dt>Shared topics</dt><dd>{relationship.sharedTopicTags.join(', ') || 'None yet'}</dd></div>
        </dl>
      </PaperCard>
      <PaperCard>
        <p className="eyebrow">Shared timeline</p><h2>What they experienced together</h2>
        <div className="travel-timeline">
          {relationship.visits?.map((visit) => <article className="travel-entry" key={visit.id}>
            <span className="timeline-pin"><MessageCircle /></span>
            <div>
              <strong>{visit.socialShare?.title || 'Companion visit'}</strong>
              <p>{visit.sharedMoment?.summary || visit.socialShare?.summary || 'No shared summary was created.'}</p>
              <small>{visit.sharedMoment?.turnCount ?? 0} turns · {formatDate(visit.startedAt || visit.endedAt)}</small><br />
              <Link className="text-link" to={`/my-network/visits/${visit.id}`}>Read conversation →</Link>
            </div>
          </article>)}
          {!relationship.visits?.length && <EmptyState title="No completed entries">The aggregate exists, but no journal entries are available.</EmptyState>}
        </div>
      </PaperCard>
    </div>}
  </>;
}
''', encoding='utf-8')

# Extend Visit details with approved topic, transcript and Shared Moment.
replace_once(
    'portal/src/pages/VisitsPage.tsx',
    '''  updatedAt: string;
}''',
    '''  updatedAt: string;
  visitorOwner?: { id: string; username: string; profile?: { displayName?: string | null } | null };
  host?: { id: string; username: string; profile?: { displayName?: string | null } | null };
  hostNetworkCompanion?: { id: string; name: string } | null;
  socialShare?: { id: string; title: string; summary: string; tags: string[]; sourceUrl?: string | null; createdAt: string } | null;
  socialTurns?: Array<{ id: string; sequence: number; senderUserId: string; intent: string; message: string; emotion?: string | null; topic?: string | null; createdAt: string }>;
  sharedMoment?: { id: string; title: string; summary: string; turnCount: number; createdAt: string } | null;
}''',
)
replace_once(
    'portal/src/pages/VisitsPage.tsx',
    '''      <PaperCard>
        <p className="eyebrow">Timeline</p>''',
    '''      {visit.socialShare && <PaperCard>
        <p className="eyebrow">Approved topic</p>
        <h2>{visit.socialShare.title}</h2>
        <p>{visit.socialShare.summary}</p>
        {visit.socialShare.tags.length > 0 && <p>{visit.socialShare.tags.join(' · ')}</p>}
        {visit.socialShare.sourceUrl && <a className="text-link" href={visit.socialShare.sourceUrl} target="_blank" rel="noreferrer">Open original source ↗</a>}
      </PaperCard>}
      {visit.sharedMoment && <PaperCard>
        <p className="eyebrow">Shared Moment</p>
        <h2>{visit.sharedMoment.title}</h2>
        <p>{visit.sharedMoment.summary}</p>
        <small>{visit.sharedMoment.turnCount} turns</small>
      </PaperCard>}
      {visit.socialTurns && visit.socialTurns.length > 0 && <PaperCard>
        <p className="eyebrow">Companion conversation</p>
        <h2>What they talked about</h2>
        <div className="social-transcript">
          {visit.socialTurns.map((turn) => {
            const visitorName = visit.networkCompanion?.name || visit.companionName || 'Visitor Companion';
            const hostName = visit.hostNetworkCompanion?.name || 'Host Companion';
            return <article className="travel-entry" key={turn.id}>
              <span className="timeline-pin"><Sparkles /></span>
              <div>
                <strong>{turn.senderUserId === visit.visitorOwnerUserId ? visitorName : hostName}</strong>
                <Stamp tone="neutral">{turn.intent}</Stamp>
                <p>{turn.message}</p>
                <small>{turn.emotion ? `${sentenceCase(turn.emotion)} · ` : ''}{formatDate(turn.createdAt)}</small>
              </div>
            </article>;
          })}
        </div>
      </PaperCard>}
      <PaperCard>
        <p className="eyebrow">Timeline</p>''',
)

# A small pure test protects relationship stage thresholds documented by the API.
relationship_test = Path('src/visit-social/relationship-stage.spec.ts')
relationship_test.write_text('''describe('Companion relationship stage policy', () => {
  const stage = (visits: number) => visits >= 12 ? 'trusted' : visits >= 8 ? 'close' : visits >= 4 ? 'friendly' : visits >= 2 ? 'familiar' : visits >= 1 ? 'acquainted' : 'new';
  it.each([[0, 'new'], [1, 'acquainted'], [2, 'familiar'], [4, 'friendly'], [8, 'close'], [12, 'trusted']])('maps %s visits to %s', (visits, expected) => {
    expect(stage(visits)).toBe(expected);
  });
});
''', encoding='utf-8')
