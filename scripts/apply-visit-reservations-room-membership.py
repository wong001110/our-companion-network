from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'anchor not found in {path}: {old[:180]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


def insert_before(path: str, anchor: str, content: str) -> None:
    replace_once(path, anchor, content + anchor)


# ---------------------------------------------------------------------------
# Prisma: one reservation per user, room participants, join requests and topics.
# ---------------------------------------------------------------------------
replace_once(
    'prisma/schema.prisma',
    '''  visitTurnsSent             VisitTurn[]           @relation("VisitTurnSender")
  debugEvents                DeveloperDebugEvent[]''',
    '''  visitTurnsSent             VisitTurn[]                  @relation("VisitTurnSender")
  visitReservation           VisitReservation?
  visitSessionParticipants   VisitSessionParticipant[]
  visitJoinRequests          VisitJoinRequest[]           @relation("VisitJoinRequester")
  visitParticipantReadiness  VisitParticipantReadiness[]  @relation("VisitParticipantReadinessViewer")
  visitRoomTopicsCreated     VisitRoomTopic[]              @relation("VisitRoomTopicCreator")
  debugEvents                DeveloperDebugEvent[]''',
)
replace_once(
    'prisma/schema.prisma',
    '''  shareableTopics     ShareableTopic[]

  @@index([ownerUserId])''',
    '''  shareableTopics     ShareableTopic[]
  visitReservations    VisitReservation[]
  sessionParticipants  VisitSessionParticipant[]
  visitJoinRequests    VisitJoinRequest[]
  roomTopics           VisitRoomTopic[]

  @@index([ownerUserId])''',
)
replace_once(
    'prisma/schema.prisma',
    '''  visitSessionRefs      VisitSession[]       @relation("VisitSessionAssetPackRef")

  @@unique([companionId, manifestHash])''',
    '''  visitSessionRefs      VisitSession[]            @relation("VisitSessionAssetPackRef")
  sessionParticipantRefs VisitSessionParticipant[] @relation("VisitParticipantAssetPackRef")
  joinRequestRefs        VisitJoinRequest[]         @relation("VisitJoinAssetPackRef")

  @@unique([companionId, manifestHash])''',
)
replace_once(
    'prisma/schema.prisma',
    '''  visitMode              String              @default("standard")
  state                  String''',
    '''  visitMode              String              @default("standard")
  roomCapacity           Int                 @default(3)
  currentTopicSequence   Int                 @default(1)
  state                  String''',
)
replace_once(
    'prisma/schema.prisma',
    '''  socialShare            VisitShareEnvelope?
  socialTurns            VisitTurn[]
  sharedMoment           VisitSharedMoment?''',
    '''  socialShare            VisitShareEnvelope?
  socialTurns            VisitTurn[]
  sharedMoment           VisitSharedMoment?
  participants           VisitSessionParticipant[]
  joinRequests           VisitJoinRequest[]
  roomTopics             VisitRoomTopic[]
  participantReadiness   VisitParticipantReadiness[]''',
)
insert_before(
    'prisma/schema.prisma',
    'model VisitShareEnvelope {',
    '''model VisitReservation {
  userId              String           @id
  user                User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  networkCompanionId  String
  networkCompanion    NetworkCompanion @relation(fields: [networkCompanionId], references: [id], onDelete: Cascade)
  kind                String
  invitationId        String?          @unique
  sessionId           String?
  joinRequestId       String?          @unique
  expiresAt           DateTime?
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt

  @@index([sessionId])
  @@index([kind, expiresAt])
}

model VisitSessionParticipant {
  id                  String             @id @default(uuid())
  sessionId           String
  session             VisitSession       @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  userId              String
  user                User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  networkCompanionId  String
  networkCompanion    NetworkCompanion   @relation(fields: [networkCompanionId], references: [id], onDelete: Restrict)
  assetPackSnapshotId String
  assetPackRefId      String?
  assetPackRef        CompanionAssetPack? @relation("VisitParticipantAssetPackRef", fields: [assetPackRefId], references: [id], onDelete: SetNull)
  role                String
  state               String
  readyAt             DateTime?
  seenAt              DateTime?
  joinedAt            DateTime           @default(now())
  leftAt              DateTime?
  createdAt           DateTime           @default(now())
  updatedAt           DateTime           @updatedAt
  readinessAsSubject  VisitParticipantReadiness[] @relation("VisitParticipantReadinessSubject")

  @@unique([sessionId, userId])
  @@unique([sessionId, networkCompanionId])
  @@index([userId, state])
  @@index([sessionId, state, joinedAt])
}

model VisitParticipantReadiness {
  id                   String                  @id @default(uuid())
  sessionId            String
  session              VisitSession            @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  subjectParticipantId String
  subjectParticipant   VisitSessionParticipant @relation("VisitParticipantReadinessSubject", fields: [subjectParticipantId], references: [id], onDelete: Cascade)
  viewerUserId         String
  viewerUser           User                    @relation("VisitParticipantReadinessViewer", fields: [viewerUserId], references: [id], onDelete: Cascade)
  readyAt              DateTime                @default(now())

  @@unique([subjectParticipantId, viewerUserId])
  @@index([sessionId, viewerUserId])
}

model VisitJoinRequest {
  id                      String              @id @default(uuid())
  sessionId               String
  session                 VisitSession        @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  requesterUserId         String
  requester               User                @relation("VisitJoinRequester", fields: [requesterUserId], references: [id], onDelete: Cascade)
  networkCompanionId      String
  networkCompanion        NetworkCompanion    @relation(fields: [networkCompanionId], references: [id], onDelete: Restrict)
  assetPackSnapshotId     String
  assetPackRefId          String?
  assetPackRef            CompanionAssetPack? @relation("VisitJoinAssetPackRef", fields: [assetPackRefId], references: [id], onDelete: SetNull)
  status                  String
  topicRefId              String?
  topicOwnerCompanionId   String?
  topicCreatedByUserId    String?
  topicTitle              String?             @db.VarChar(120)
  topicSummary            String?             @db.VarChar(600)
  topicTags               String[]            @default([])
  topicSourceUrl          String?             @db.VarChar(2000)
  topicShareScope         String?
  topicAllowRecipientSave Boolean             @default(false)
  expiresAt               DateTime
  respondedAt             DateTime?
  cancelledAt             DateTime?
  createdAt               DateTime            @default(now())
  updatedAt               DateTime            @updatedAt

  @@unique([sessionId, requesterUserId])
  @@index([sessionId, status])
  @@index([requesterUserId, status])
  @@index([expiresAt, status])
}

model VisitRoomTopic {
  id                     String             @id @default(uuid())
  sessionId              String
  session                VisitSession       @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sequence               Int
  state                  String
  ownerCompanionId       String
  ownerCompanion         NetworkCompanion   @relation(fields: [ownerCompanionId], references: [id], onDelete: Restrict)
  createdByUserId        String
  createdByUser          User               @relation("VisitRoomTopicCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)
  title                  String             @db.VarChar(120)
  summary                String             @db.VarChar(600)
  tags                   String[]           @default([])
  sourceUrl              String?            @db.VarChar(2000)
  shareScope             String
  allowRecipientSave     Boolean            @default(false)
  minimumTurns           Int                @default(3)
  maximumTurns           Int                @default(6)
  startedAt              DateTime?
  completedAt            DateTime?
  createdAt              DateTime           @default(now())
  updatedAt              DateTime           @updatedAt
  turns                  VisitTurn[]
  activeShare            VisitShareEnvelope?

  @@unique([sessionId, sequence])
  @@index([sessionId, state, sequence])
}

''',
)
replace_once(
    'prisma/schema.prisma',
    '''  sessionId       String       @unique
  session         VisitSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  title''',
    '''  sessionId       String          @unique
  session         VisitSession    @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  roomTopicId     String?         @unique
  roomTopic       VisitRoomTopic? @relation(fields: [roomTopicId], references: [id], onDelete: SetNull)
  title''',
)
replace_once(
    'prisma/schema.prisma',
    '''  senderUserId String
  sender       User         @relation("VisitTurnSender", fields: [senderUserId], references: [id], onDelete: Restrict)
  intent''',
    '''  senderUserId String
  sender       User         @relation("VisitTurnSender", fields: [senderUserId], references: [id], onDelete: Restrict)
  roomTopicId  String?
  roomTopic    VisitRoomTopic? @relation(fields: [roomTopicId], references: [id], onDelete: SetNull)
  intent''',
)
replace_once(
    'prisma/schema.prisma',
    '''  @@index([sessionId, createdAt])
}''',
    '''  @@index([sessionId, createdAt])
  @@index([roomTopicId, sequence])
}''',
)

migration = Path('prisma/migrations/20260731050000_visit_reservations_room_membership/migration.sql')
migration.parent.mkdir(parents=True, exist_ok=True)
migration.write_text('''ALTER TABLE "VisitSession"
  ADD COLUMN "roomCapacity" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "currentTopicSequence" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "VisitShareEnvelope" ADD COLUMN "roomTopicId" TEXT;
ALTER TABLE "VisitTurn" ADD COLUMN "roomTopicId" TEXT;

CREATE TABLE "VisitReservation" (
  "userId" TEXT NOT NULL,
  "networkCompanionId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "invitationId" TEXT,
  "sessionId" TEXT,
  "joinRequestId" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisitReservation_pkey" PRIMARY KEY ("userId"),
  CONSTRAINT "VisitReservation_kind_check" CHECK ("kind" IN ('outgoing_invitation', 'session_participant', 'join_request')),
  CONSTRAINT "VisitReservation_reference_check" CHECK (
    ("kind" = 'outgoing_invitation' AND "invitationId" IS NOT NULL AND "sessionId" IS NULL AND "joinRequestId" IS NULL)
    OR ("kind" = 'session_participant' AND "invitationId" IS NULL AND "sessionId" IS NOT NULL AND "joinRequestId" IS NULL)
    OR ("kind" = 'join_request' AND "invitationId" IS NULL AND "sessionId" IS NOT NULL AND "joinRequestId" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "VisitReservation_invitationId_key" ON "VisitReservation"("invitationId");
CREATE UNIQUE INDEX "VisitReservation_joinRequestId_key" ON "VisitReservation"("joinRequestId");
CREATE INDEX "VisitReservation_sessionId_idx" ON "VisitReservation"("sessionId");
CREATE INDEX "VisitReservation_kind_expiresAt_idx" ON "VisitReservation"("kind", "expiresAt");
ALTER TABLE "VisitReservation" ADD CONSTRAINT "VisitReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitReservation" ADD CONSTRAINT "VisitReservation_networkCompanionId_fkey" FOREIGN KEY ("networkCompanionId") REFERENCES "NetworkCompanion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "VisitSessionParticipant" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "networkCompanionId" TEXT NOT NULL,
  "assetPackSnapshotId" TEXT NOT NULL,
  "assetPackRefId" TEXT,
  "role" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "readyAt" TIMESTAMP(3),
  "seenAt" TIMESTAMP(3),
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisitSessionParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisitSessionParticipant_role_check" CHECK ("role" IN ('host', 'visitor', 'guest')),
  CONSTRAINT "VisitSessionParticipant_state_check" CHECK ("state" IN ('preparing', 'ready', 'active', 'left'))
);
CREATE UNIQUE INDEX "VisitSessionParticipant_sessionId_userId_key" ON "VisitSessionParticipant"("sessionId", "userId");
CREATE UNIQUE INDEX "VisitSessionParticipant_sessionId_networkCompanionId_key" ON "VisitSessionParticipant"("sessionId", "networkCompanionId");
CREATE INDEX "VisitSessionParticipant_userId_state_idx" ON "VisitSessionParticipant"("userId", "state");
CREATE INDEX "VisitSessionParticipant_sessionId_state_joinedAt_idx" ON "VisitSessionParticipant"("sessionId", "state", "joinedAt");
ALTER TABLE "VisitSessionParticipant" ADD CONSTRAINT "VisitSessionParticipant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitSessionParticipant" ADD CONSTRAINT "VisitSessionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitSessionParticipant" ADD CONSTRAINT "VisitSessionParticipant_networkCompanionId_fkey" FOREIGN KEY ("networkCompanionId") REFERENCES "NetworkCompanion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitSessionParticipant" ADD CONSTRAINT "VisitSessionParticipant_assetPackRefId_fkey" FOREIGN KEY ("assetPackRefId") REFERENCES "CompanionAssetPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "VisitParticipantReadiness" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "subjectParticipantId" TEXT NOT NULL,
  "viewerUserId" TEXT NOT NULL,
  "readyAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitParticipantReadiness_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VisitParticipantReadiness_subjectParticipantId_viewerUserId_key" ON "VisitParticipantReadiness"("subjectParticipantId", "viewerUserId");
CREATE INDEX "VisitParticipantReadiness_sessionId_viewerUserId_idx" ON "VisitParticipantReadiness"("sessionId", "viewerUserId");
ALTER TABLE "VisitParticipantReadiness" ADD CONSTRAINT "VisitParticipantReadiness_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitParticipantReadiness" ADD CONSTRAINT "VisitParticipantReadiness_subjectParticipantId_fkey" FOREIGN KEY ("subjectParticipantId") REFERENCES "VisitSessionParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitParticipantReadiness" ADD CONSTRAINT "VisitParticipantReadiness_viewerUserId_fkey" FOREIGN KEY ("viewerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "VisitJoinRequest" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "requesterUserId" TEXT NOT NULL,
  "networkCompanionId" TEXT NOT NULL,
  "assetPackSnapshotId" TEXT NOT NULL,
  "assetPackRefId" TEXT,
  "status" TEXT NOT NULL,
  "topicRefId" TEXT,
  "topicOwnerCompanionId" TEXT,
  "topicCreatedByUserId" TEXT,
  "topicTitle" VARCHAR(120),
  "topicSummary" VARCHAR(600),
  "topicTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "topicSourceUrl" VARCHAR(2000),
  "topicShareScope" TEXT,
  "topicAllowRecipientSave" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisitJoinRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisitJoinRequest_status_check" CHECK ("status" IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  CONSTRAINT "VisitJoinRequest_topic_scope_check" CHECK ("topicShareScope" IS NULL OR "topicShareScope" IN ('summary_only', 'summary_and_source'))
);
CREATE UNIQUE INDEX "VisitJoinRequest_sessionId_requesterUserId_key" ON "VisitJoinRequest"("sessionId", "requesterUserId");
CREATE INDEX "VisitJoinRequest_sessionId_status_idx" ON "VisitJoinRequest"("sessionId", "status");
CREATE INDEX "VisitJoinRequest_requesterUserId_status_idx" ON "VisitJoinRequest"("requesterUserId", "status");
CREATE INDEX "VisitJoinRequest_expiresAt_status_idx" ON "VisitJoinRequest"("expiresAt", "status");
ALTER TABLE "VisitJoinRequest" ADD CONSTRAINT "VisitJoinRequest_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitJoinRequest" ADD CONSTRAINT "VisitJoinRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitJoinRequest" ADD CONSTRAINT "VisitJoinRequest_networkCompanionId_fkey" FOREIGN KEY ("networkCompanionId") REFERENCES "NetworkCompanion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitJoinRequest" ADD CONSTRAINT "VisitJoinRequest_assetPackRefId_fkey" FOREIGN KEY ("assetPackRefId") REFERENCES "CompanionAssetPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "VisitRoomTopic" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "ownerCompanionId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "summary" VARCHAR(600) NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sourceUrl" VARCHAR(2000),
  "shareScope" TEXT NOT NULL,
  "allowRecipientSave" BOOLEAN NOT NULL DEFAULT false,
  "minimumTurns" INTEGER NOT NULL DEFAULT 3,
  "maximumTurns" INTEGER NOT NULL DEFAULT 6,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisitRoomTopic_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisitRoomTopic_state_check" CHECK ("state" IN ('queued', 'active', 'completed')),
  CONSTRAINT "VisitRoomTopic_scope_check" CHECK ("shareScope" IN ('summary_only', 'summary_and_source')),
  CONSTRAINT "VisitRoomTopic_turn_budget_check" CHECK ("minimumTurns" >= 1 AND "maximumTurns" >= "minimumTurns" AND "maximumTurns" <= 12)
);
CREATE UNIQUE INDEX "VisitRoomTopic_sessionId_sequence_key" ON "VisitRoomTopic"("sessionId", "sequence");
CREATE INDEX "VisitRoomTopic_sessionId_state_sequence_idx" ON "VisitRoomTopic"("sessionId", "state", "sequence");
ALTER TABLE "VisitRoomTopic" ADD CONSTRAINT "VisitRoomTopic_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitRoomTopic" ADD CONSTRAINT "VisitRoomTopic_ownerCompanionId_fkey" FOREIGN KEY ("ownerCompanionId") REFERENCES "NetworkCompanion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitRoomTopic" ADD CONSTRAINT "VisitRoomTopic_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "VisitShareEnvelope_roomTopicId_key" ON "VisitShareEnvelope"("roomTopicId");
ALTER TABLE "VisitShareEnvelope" ADD CONSTRAINT "VisitShareEnvelope_roomTopicId_fkey" FOREIGN KEY ("roomTopicId") REFERENCES "VisitRoomTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "VisitTurn_roomTopicId_sequence_idx" ON "VisitTurn"("roomTopicId", "sequence");
ALTER TABLE "VisitTurn" ADD CONSTRAINT "VisitTurn_roomTopicId_fkey" FOREIGN KEY ("roomTopicId") REFERENCES "VisitRoomTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill current two-person sessions into explicit room membership.
INSERT INTO "VisitSessionParticipant" (
  "id", "sessionId", "userId", "networkCompanionId", "assetPackSnapshotId", "assetPackRefId",
  "role", "state", "readyAt", "seenAt", "joinedAt", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, s."id", s."visitorOwnerUserId", s."networkCompanionId",
  s."assetPackSnapshotId", s."assetPackRefId", 'visitor',
  CASE WHEN s."state" IN ('active','ending') THEN 'active' WHEN s."state"='ready' THEN 'ready' WHEN s."state"='preparing' THEN 'preparing' ELSE 'left' END,
  s."visitorOwnerReadyAt", s."visitorOwnerSeenAt", COALESCE(s."startedAt", s."createdAt"), s."createdAt", s."updatedAt"
FROM "VisitSession" s
ON CONFLICT ("sessionId", "userId") DO NOTHING;

INSERT INTO "VisitSessionParticipant" (
  "id", "sessionId", "userId", "networkCompanionId", "assetPackSnapshotId", "assetPackRefId",
  "role", "state", "readyAt", "seenAt", "joinedAt", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, s."id", s."hostUserId", s."hostNetworkCompanionId",
  c."activeAssetPackId", c."activeAssetPackId", 'host',
  CASE WHEN s."state" IN ('active','ending') THEN 'active' WHEN s."state"='ready' THEN 'ready' WHEN s."state"='preparing' THEN 'preparing' ELSE 'left' END,
  s."hostReadyAt", s."hostSeenAt", COALESCE(s."startedAt", s."createdAt"), s."createdAt", s."updatedAt"
FROM "VisitSession" s
JOIN "NetworkCompanion" c ON c."id" = s."hostNetworkCompanionId"
WHERE s."hostNetworkCompanionId" IS NOT NULL AND c."activeAssetPackId" IS NOT NULL
ON CONFLICT ("sessionId", "userId") DO NOTHING;

-- Backfill the existing approved share as room topic one.
INSERT INTO "VisitRoomTopic" (
  "id", "sessionId", "sequence", "state", "ownerCompanionId", "createdByUserId",
  "title", "summary", "tags", "sourceUrl", "shareScope", "allowRecipientSave",
  "startedAt", "completedAt", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, e."sessionId", 1,
  CASE WHEN s."state" IN ('ended','cancelled','failed') THEN 'completed' ELSE 'active' END,
  COALESCE(s."hostNetworkCompanionId", s."networkCompanionId"), e."createdByUserId",
  e."title", e."summary",
  CASE WHEN jsonb_typeof(e."tags")='array' THEN ARRAY(SELECT jsonb_array_elements_text(e."tags")) ELSE ARRAY[]::TEXT[] END,
  e."sourceUrl", CASE WHEN e."sourceUrl" IS NULL THEN 'summary_only' ELSE 'summary_and_source' END,
  false, COALESCE(s."startedAt", e."createdAt"), CASE WHEN s."state" IN ('ended','cancelled','failed') THEN s."endedAt" ELSE NULL END,
  e."createdAt", e."createdAt"
FROM "VisitShareEnvelope" e
JOIN "VisitSession" s ON s."id" = e."sessionId"
ON CONFLICT ("sessionId", "sequence") DO NOTHING;

UPDATE "VisitShareEnvelope" e
SET "roomTopicId" = t."id"
FROM "VisitRoomTopic" t
WHERE t."sessionId" = e."sessionId" AND t."sequence" = 1 AND e."roomTopicId" IS NULL;
UPDATE "VisitTurn" turn
SET "roomTopicId" = topic."id"
FROM "VisitRoomTopic" topic
WHERE topic."sessionId" = turn."sessionId" AND topic."sequence" = 1 AND turn."roomTopicId" IS NULL;

-- Live sessions take priority when repairing reservations.
INSERT INTO "VisitReservation" (
  "userId", "networkCompanionId", "kind", "sessionId", "createdAt", "updatedAt"
)
SELECT DISTINCT ON (p."userId") p."userId", p."networkCompanionId", 'session_participant', p."sessionId", NOW(), NOW()
FROM "VisitSessionParticipant" p
JOIN "VisitSession" s ON s."id" = p."sessionId"
WHERE s."state" IN ('preparing','ready','active','ending') AND p."state" <> 'left'
ORDER BY p."userId", s."updatedAt" DESC
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "VisitReservation" (
  "userId", "networkCompanionId", "kind", "invitationId", "expiresAt", "createdAt", "updatedAt"
)
SELECT i."visitorOwnerUserId", i."networkCompanionId", 'outgoing_invitation', i."id", i."expiresAt", NOW(), NOW()
FROM "VisitInvitation" i
WHERE i."status"='pending' AND i."expiresAt" > NOW()
ON CONFLICT ("userId") DO NOTHING;
''', encoding='utf-8')

# ---------------------------------------------------------------------------
# Visit room service and controller.
# ---------------------------------------------------------------------------
Path('src/visit/visit-room.service.ts').write_text('''import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { SocialEventPublisher } from '../common/social-event-publisher.service';
import { supportsVisualVisit } from '../companion/asset-manifest';

const LIVE_SESSION_STATES = ['preparing', 'ready', 'active', 'ending'];
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
    if (result.changed) await this.publishRoom(result.sessionId, 'visit.participant.joined', { joinRequestId, participantId: result.participant.id });
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
''', encoding='utf-8')

Path('src/visit/visit-room.controller.ts').write_text('''import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { SocialRateLimit } from '../common/decorators/social-rate-limit.decorator';
import { SocialRateLimitGuard } from '../common/guards/social-rate-limit.guard';
import { VisitRoomService } from './visit-room.service';

class CreateJoinRequestDto { @IsOptional() @IsUUID() topicId?: string; }
class RoomFileIdsDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('4', { each: true }) fileIds: string[]; }

@UseGuards(AuthGuard('jwt'), SocialRateLimitGuard)
@Controller()
export class VisitRoomController {
  constructor(private readonly rooms: VisitRoomService) {}

  @Get('visit-reservation')
  @SocialRateLimit('visit_read')
  reservation(@CurrentUser() user: UserPayload) { return this.rooms.getReservation(user.id); }

  @Get('visit-sessions/:id/room')
  @SocialRateLimit('visit_read')
  room(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.getRoom(user.id, id); }

  @Post('visit-sessions/:id/join-requests')
  @SocialRateLimit('visit_create')
  join(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateJoinRequestDto) { return this.rooms.createJoinRequest(user.id, id, dto.topicId); }

  @Get('visit-sessions/:id/join-requests')
  @SocialRateLimit('visit_read')
  joinRequests(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.listJoinRequests(user.id, id); }

  @Post('visit-join-requests/:id/accept')
  @SocialRateLimit('visit_mutation')
  acceptJoin(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.acceptJoinRequest(user.id, id); }

  @Post('visit-join-requests/:id/decline')
  @SocialRateLimit('visit_mutation')
  declineJoin(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.declineJoinRequest(user.id, id); }

  @Post('visit-join-requests/:id/cancel')
  @SocialRateLimit('visit_mutation')
  cancelJoin(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.cancelJoinRequest(user.id, id); }

  @Post('visit-sessions/:id/participants/ready')
  @SocialRateLimit('visit_mutation')
  ready(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.markParticipantReady(user.id, id); }

  @Post('visit-sessions/:id/participants/leave')
  @SocialRateLimit('visit_mutation')
  leave(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.leaveRoom(user.id, id); }

  @Get('visit-sessions/:id/participants/:participantId/assets/manifest')
  @SocialRateLimit('visit_read')
  manifest(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Param('participantId', ParseUUIDPipe) participantId: string) { return this.rooms.getParticipantManifest(user.id, id, participantId); }

  @Post('visit-sessions/:id/participants/:participantId/assets/download-urls')
  @SocialRateLimit('visit_asset_urls')
  downloadUrls(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Param('participantId', ParseUUIDPipe) participantId: string, @Body() dto: RoomFileIdsDto) { return this.rooms.createParticipantDownloadUrls(user.id, id, participantId, dto.fileIds); }
}
''', encoding='utf-8')

replace_once(
    'src/visit/visit.module.ts',
    '''import { VisitInvitationController, VisitSessionController } from './visit.controller';
import { VisitService } from './visit.service';

@Module({ imports: [CommonModule, StorageModule], controllers: [VisitInvitationController, VisitSessionController], providers: [VisitService], exports: [VisitService] })''',
    '''import { VisitInvitationController, VisitSessionController } from './visit.controller';
import { VisitRoomController } from './visit-room.controller';
import { VisitRoomService } from './visit-room.service';
import { VisitService } from './visit.service';

@Module({ imports: [CommonModule, StorageModule], controllers: [VisitInvitationController, VisitSessionController, VisitRoomController], providers: [VisitService, VisitRoomService], exports: [VisitService, VisitRoomService] })''',
)

# ---------------------------------------------------------------------------
# Existing Visit lifecycle now owns reservation creation/release and base members.
# ---------------------------------------------------------------------------
replace_once(
    'src/visit/visit.service.ts',
    '''      await this.assertEligible(tx, visitorOwnerUserId, hostUserId);
      await this.assertVisitorOwnerAvailable(tx, visitorOwnerUserId);''',
    '''      await this.assertEligible(tx, visitorOwnerUserId, hostUserId);
      await this.assertNoReservation(tx, visitorOwnerUserId);
      await this.assertVisitorOwnerAvailable(tx, visitorOwnerUserId);''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''      return tx.visitInvitation.create({ data: {
        visitorOwnerUserId, hostUserId, networkCompanionId: snapshot.companion.id, assetPackSnapshotId: snapshot.pack.id, assetPackRefId: snapshot.pack.id,
        companionName: snapshot.companion.name, companionDescription: snapshot.companion.publicDescription, companionTags: snapshot.companion.publicTags,
        visitMode,
        ...(topic ?? {}),
        status: PENDING, expiresAt: new Date(Date.now() + this.limits.invitationTtlHours * 3_600_000),
      }, select: INVITATION_SELECT });''',
    '''      const expiresAt = new Date(Date.now() + this.limits.invitationTtlHours * 3_600_000);
      const created = await tx.visitInvitation.create({ data: {
        visitorOwnerUserId, hostUserId, networkCompanionId: snapshot.companion.id, assetPackSnapshotId: snapshot.pack.id, assetPackRefId: snapshot.pack.id,
        companionName: snapshot.companion.name, companionDescription: snapshot.companion.publicDescription, companionTags: snapshot.companion.publicTags,
        visitMode,
        ...(topic ?? {}),
        status: PENDING, expiresAt,
      }, select: INVITATION_SELECT });
      await tx.visitReservation.create({
        data: {
          userId: visitorOwnerUserId, networkCompanionId: snapshot.companion.id,
          kind: 'outgoing_invitation', invitationId: created.id, expiresAt,
        },
      });
      return created;''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''      await this.assertEligible(tx, invitation.visitorOwnerUserId, invitation.hostUserId);
      await this.assertVisitorOwnerAvailable(tx, invitation.visitorOwnerUserId);
      await this.assertHostCapacity(tx, invitation.hostUserId);''',
    '''      await this.assertEligible(tx, invitation.visitorOwnerUserId, invitation.hostUserId);
      const ownerReservation = await tx.visitReservation.findUnique({ where: { userId: invitation.visitorOwnerUserId } });
      if (!ownerReservation || ownerReservation.kind !== 'outgoing_invitation' || ownerReservation.invitationId !== invitation.id) {
        throw new ConflictException({ code: 'VISIT_RESERVATION_CHANGED', message: 'The Visitor reservation changed' });
      }
      await this.assertNoReservation(tx, invitation.hostUserId);
      await this.assertVisitorOwnerAvailable(tx, invitation.visitorOwnerUserId);
      await this.assertHostCapacity(tx, invitation.hostUserId);''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''      const host = await tx.user.findUnique({
        where: { id: invitation.hostUserId },
        select: { activeNetworkCompanionId: true },
      });
      const hostNetworkCompanionId = invitation.visitMode === 'random_host_topic'
        ? invitation.topicOwnerCompanionId
        : host?.activeNetworkCompanionId;
      if (!hostNetworkCompanionId) this.notAvailable();''',
    '''      const hostSnapshot = await this.loadCurrentSnapshotInTransaction(tx, invitation.hostUserId);
      const hostNetworkCompanionId = invitation.visitMode === 'random_host_topic'
        ? invitation.topicOwnerCompanionId
        : hostSnapshot?.companion.id;
      if (!hostSnapshot || !hostNetworkCompanionId) this.notAvailable();''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''        && host?.activeNetworkCompanionId !== hostNetworkCompanionId) {''',
    '''        && hostSnapshot.companion.id !== hostNetworkCompanionId) {''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''      const session = await tx.visitSession.create({ data: {
        invitationId: invitation.id, visitorOwnerUserId: invitation.visitorOwnerUserId, hostUserId: invitation.hostUserId,
        hostNetworkCompanionId,
        networkCompanionId: invitation.networkCompanionId, assetPackSnapshotId: invitation.assetPackSnapshotId, assetPackRefId: pack.id,
        visitMode: invitation.visitMode,
        ...(invitation.topicTitle && invitation.topicSummary && invitation.topicCreatedByUserId ? {
          socialShare: { create: {
            title: invitation.topicTitle,
            summary: invitation.topicSummary,
            tags: invitation.topicTags,
            sourceUrl: invitation.topicShareScope === 'summary_and_source' ? invitation.topicSourceUrl : null,
            createdByUserId: invitation.topicCreatedByUserId,
          } },
        } : {}),
        state: 'preparing',
      }, select: SESSION_SELECT });
      return { invitation: accepted, session, changed: true, expired: false };''',
    '''      const session = await tx.visitSession.create({ data: {
        invitationId: invitation.id, visitorOwnerUserId: invitation.visitorOwnerUserId, hostUserId: invitation.hostUserId,
        hostNetworkCompanionId,
        networkCompanionId: invitation.networkCompanionId, assetPackSnapshotId: invitation.assetPackSnapshotId, assetPackRefId: pack.id,
        visitMode: invitation.visitMode, state: 'preparing',
      }, select: SESSION_SELECT });
      const participants = await Promise.all([
        tx.visitSessionParticipant.create({ data: {
          sessionId: session.id, userId: invitation.hostUserId, networkCompanionId: hostNetworkCompanionId,
          assetPackSnapshotId: hostSnapshot.pack.id, assetPackRefId: hostSnapshot.pack.id,
          role: 'host', state: 'preparing', seenAt: new Date(),
        } }),
        tx.visitSessionParticipant.create({ data: {
          sessionId: session.id, userId: invitation.visitorOwnerUserId, networkCompanionId: invitation.networkCompanionId,
          assetPackSnapshotId: invitation.assetPackSnapshotId, assetPackRefId: pack.id,
          role: 'visitor', state: 'preparing', seenAt: new Date(),
        } }),
      ]);
      await tx.visitReservation.update({
        where: { userId: invitation.visitorOwnerUserId },
        data: { kind: 'session_participant', invitationId: null, sessionId: session.id, expiresAt: null },
      });
      await tx.visitReservation.create({
        data: { userId: invitation.hostUserId, networkCompanionId: hostNetworkCompanionId, kind: 'session_participant', sessionId: session.id },
      });
      if (invitation.topicTitle && invitation.topicSummary && invitation.topicCreatedByUserId && invitation.topicOwnerCompanionId) {
        const roomTopic = await tx.visitRoomTopic.create({ data: {
          sessionId: session.id, sequence: 1, state: 'active',
          ownerCompanionId: invitation.topicOwnerCompanionId, createdByUserId: invitation.topicCreatedByUserId,
          title: invitation.topicTitle, summary: invitation.topicSummary, tags: invitation.topicTags,
          sourceUrl: invitation.topicShareScope === 'summary_and_source' ? invitation.topicSourceUrl : null,
          shareScope: invitation.topicShareScope ?? 'summary_only',
          allowRecipientSave: invitation.topicAllowRecipientSave,
          startedAt: new Date(),
        } });
        await tx.visitShareEnvelope.create({ data: {
          sessionId: session.id, roomTopicId: roomTopic.id,
          title: invitation.topicTitle, summary: invitation.topicSummary, tags: invitation.topicTags,
          sourceUrl: invitation.topicShareScope === 'summary_and_source' ? invitation.topicSourceUrl : null,
          createdByUserId: invitation.topicCreatedByUserId,
        } });
      }
      return { invitation: accepted, session, participants, changed: true, expired: false };''',
)
# Base participant readiness follows the existing two-party ready state.
replace_once(
    'src/visit/visit.service.ts',
    '''      const updated = await tx.visitSession.update({ where: { id: current.id }, data, select: { ...SESSION_SELECT, visitorOwnerSeenAt: true, hostSeenAt: true } });
      if (updated.visitorOwnerReadyAt && updated.hostReadyAt) return tx.visitSession.update({ where: { id: current.id }, data: { state: 'ready', readyAt: updated.readyAt ?? now }, select: SESSION_SELECT });''',
    '''      const updated = await tx.visitSession.update({ where: { id: current.id }, data, select: { ...SESSION_SELECT, visitorOwnerSeenAt: true, hostSeenAt: true } });
      await tx.visitSessionParticipant.updateMany({
        where: { sessionId: current.id, userId },
        data: { state: 'ready', readyAt: now, seenAt: now },
      });
      if (updated.visitorOwnerReadyAt && updated.hostReadyAt) return tx.visitSession.update({ where: { id: current.id }, data: { state: 'ready', readyAt: updated.readyAt ?? now }, select: SESSION_SELECT });''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''      return tx.visitSession.update({ where: { id: current.id }, data: { state: 'active', startedAt: new Date() }, select: SESSION_SELECT });''',
    '''      const startedAt = new Date();
      await tx.visitSessionParticipant.updateMany({ where: { sessionId: current.id, state: 'ready' }, data: { state: 'active', seenAt: startedAt } });
      return tx.visitSession.update({ where: { id: current.id }, data: { state: 'active', startedAt }, select: SESSION_SELECT });''',
)
# List sessions includes guests.
replace_once(
    'src/visit/visit.service.ts',
    '''    const sessions = await this.prisma.visitSession.findMany({ where: { OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }] }, select: SESSION_SELECT, orderBy: { updatedAt: 'desc' } });''',
    '''    const sessions = await this.prisma.visitSession.findMany({ where: { OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }, { participants: { some: { userId, state: { not: 'left' } } } }] }, select: SESSION_SELECT, orderBy: { updatedAt: 'desc' } });''',
)
# Release all room reservations when the room ends.
replace_once(
    'src/visit/visit.service.ts',
    '''    const session = await this.prisma.$transaction(tx => this.endSessionInTransaction(tx, sessionId, userId, reason));''',
    '''    const session = await this.prisma.$transaction(async tx => {
      const ended = await this.endSessionInTransaction(tx, sessionId, userId, reason);
      await this.releaseSessionReservations(tx, sessionId);
      return ended;
    });''',
)
# Invitation decline/cancel releases creator reservation.
replace_once(
    'src/visit/visit.service.ts',
    '''      return tx.visitInvitation.update({ where: { id: current.id }, data: status === 'declined' ? { status, respondedAt: new Date(), assetPackRefId: null } : { status, cancelledAt: new Date(), assetPackRefId: null }, select: INVITATION_SELECT });''',
    '''      const updated = await tx.visitInvitation.update({ where: { id: current.id }, data: status === 'declined' ? { status, respondedAt: new Date(), assetPackRefId: null } : { status, cancelledAt: new Date(), assetPackRefId: null }, select: INVITATION_SELECT });
      await tx.visitReservation.deleteMany({ where: { userId: current.visitorOwnerUserId, invitationId: current.id } });
      return updated;''',
)
# Expired invitations release creator reservation.
replace_once(
    'src/visit/visit.service.ts',
    '''          const record = await this.prisma.visitInvitation.findUniqueOrThrow({ where: { id: invitation.id }, select: INVITATION_SELECT });''',
    '''          await this.prisma.visitReservation.deleteMany({ where: { invitationId: invitation.id } });
          const record = await this.prisma.visitInvitation.findUniqueOrThrow({ where: { id: invitation.id }, select: INVITATION_SELECT });''',
)
# Timed-out sessions release participant reservations.
replace_once(
    'src/visit/visit.service.ts',
    '''        if (updated.count) this.publishSession(await this.prisma.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }), 'visit.session.ended');''',
    '''        if (updated.count) {
          await this.prisma.visitReservation.deleteMany({ where: { sessionId: session.id } });
          await this.prisma.visitSessionParticipant.updateMany({ where: { sessionId: session.id, state: { not: 'left' } }, data: { state: 'left', leftAt: now, assetPackRefId: null } });
          this.publishSession(await this.prisma.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }), 'visit.session.ended');
        }''',
)
# Public reservation guard for Companion switching and desktop/server status.
insert_before(
    'src/visit/visit.service.ts',
    '''  private async assertVisitorOwnerAvailable''',
    '''  async assertCompanionAvailable(userId: string): Promise<void> {
    const reservation = await this.prisma.visitReservation.findUnique({ where: { userId }, select: { kind: true } });
    if (reservation) throw new ConflictException({ code: 'VISIT_COMPANION_RESERVED', message: 'The active Companion is reserved for a Visit' });
  }

  private async assertNoReservation(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    const reservation = await tx.visitReservation.findUnique({ where: { userId }, select: { kind: true } });
    if (reservation) throw new ConflictException({ code: 'VISIT_RESERVATION_EXISTS', message: 'This Companion already has a Visit reservation' });
  }

  private async releaseSessionReservations(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
    await tx.visitReservation.deleteMany({ where: { sessionId } });
    await tx.visitSessionParticipant.updateMany({
      where: { sessionId, state: { not: 'left' } },
      data: { state: 'left', leftAt: new Date(), assetPackRefId: null },
    });
  }

''',
)
# Participant membership authorizes guest get/heartbeat paths.
replace_once(
    'src/visit/visit.service.ts',
    '''  private async requireParticipantSession(userId: string, sessionId: string) {
    const session = await this.prisma.visitSession.findUnique({ where: { id: sessionId }, select: SESSION_SELECT });
    if (!session) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
    if (!this.roleFor(session, userId)) throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit session is not available' });
    return session;
  }''',
    '''  private async requireParticipantSession(userId: string, sessionId: string) {
    const session = await this.prisma.visitSession.findUnique({ where: { id: sessionId }, select: SESSION_SELECT });
    if (!session) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
    if (!this.roleFor(session, userId)) {
      const participant = await this.prisma.visitSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } }, select: { state: true } });
      if (!participant || participant.state === 'left') throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit session is not available' });
    }
    return session;
  }''',
)
# Server prevents active Companion switching while reserved.
replace_once(
    'src/companion/companion.service.ts',
    '''  async activate(userId: string, companionId: string) {
    const companion = await this.requireOwnedCompanion(userId, companionId);''',
    '''  async activate(userId: string, companionId: string) {
    await this.visits?.assertCompanionAvailable(userId);
    const companion = await this.requireOwnedCompanion(userId, companionId);''',
)
replace_once(
    'src/companion/companion.service.ts',
    '''  async unpublish(userId: string, companionId: string) {
    const companion = await this.prisma.$transaction''',
    '''  async unpublish(userId: string, companionId: string) {
    await this.visits?.assertCompanionAvailable(userId);
    const companion = await this.prisma.$transaction''',
)

# ---------------------------------------------------------------------------
# Regression tests.
# ---------------------------------------------------------------------------
Path('src/visit/visit-room-reservation.spec.ts').write_text('''import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Visit reservation and room membership contract', () => {
  const visitSource = readFileSync(join(__dirname, 'visit.service.ts'), 'utf8');
  const roomSource = readFileSync(join(__dirname, 'visit-room.service.ts'), 'utf8');
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

  it('uses one user-keyed reservation from invitation creation through room completion', () => {
    expect(schema).toContain('model VisitReservation');
    expect(schema).toContain('userId              String           @id');
    expect(visitSource).toContain("kind: 'outgoing_invitation'");
    expect(visitSource).toContain("kind: 'session_participant'");
    expect(visitSource).toContain('releaseSessionReservations');
    expect(visitSource).toContain('VISIT_COMPANION_RESERVED');
  });

  it('queues a joining Companion topic after the existing topic instead of replacing it', () => {
    expect(roomSource).toContain("state: 'queued'");
    expect(roomSource).toContain('(aggregate._max.sequence ?? 0) + 1');
    expect(roomSource).toContain("role: 'guest', state: 'preparing'");
    expect(schema).toContain('roomCapacity           Int');
  });

  it('keeps room assets scoped to active participants', () => {
    expect(roomSource).toContain('authorizeParticipantAsset');
    expect(roomSource).toContain("state: { not: 'left' }");
    expect(roomSource).toContain('subject.userId === viewer.userId');
  });
});
''', encoding='utf-8')
