ALTER TABLE "VisitSession"
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
