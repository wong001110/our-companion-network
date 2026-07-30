ALTER TABLE "NetworkCompanion"
  ADD COLUMN "randomVisitsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "randomVisitAudience" TEXT NOT NULL DEFAULT 'friends',
  ADD COLUMN "allowJoinRequests" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "NetworkCompanion"
  ADD CONSTRAINT "NetworkCompanion_randomVisitAudience_check"
  CHECK ("randomVisitAudience" IN ('friends', 'selected'));

CREATE TABLE "ShareableTopic" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "summary" VARCHAR(600) NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sourceUrl" VARCHAR(2000),
  "audience" TEXT NOT NULL DEFAULT 'friends',
  "shareScope" TEXT NOT NULL DEFAULT 'summary_only',
  "allowRecipientSave" BOOLEAN NOT NULL DEFAULT false,
  "eligibleForRandomVisit" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShareableTopic_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShareableTopic_audience_check" CHECK ("audience" IN ('friends', 'selected')),
  CONSTRAINT "ShareableTopic_shareScope_check" CHECK ("shareScope" IN ('summary_only', 'summary_and_source'))
);

ALTER TABLE "ShareableTopic" ADD CONSTRAINT "ShareableTopic_companionId_fkey"
  FOREIGN KEY ("companionId") REFERENCES "NetworkCompanion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ShareableTopic_companionId_eligibleForRandomVisit_revokedAt_idx"
  ON "ShareableTopic"("companionId", "eligibleForRandomVisit", "revokedAt");
CREATE INDEX "ShareableTopic_expiresAt_idx" ON "ShareableTopic"("expiresAt");
CREATE INDEX "ShareableTopic_lastUsedAt_idx" ON "ShareableTopic"("lastUsedAt");

ALTER TABLE "VisitInvitation"
  ADD COLUMN "visitMode" TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN "topicRefId" TEXT,
  ADD COLUMN "topicOwnerCompanionId" TEXT,
  ADD COLUMN "topicCreatedByUserId" TEXT,
  ADD COLUMN "topicTitle" VARCHAR(120),
  ADD COLUMN "topicSummary" VARCHAR(600),
  ADD COLUMN "topicTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "topicSourceUrl" VARCHAR(2000),
  ADD COLUMN "topicShareScope" TEXT,
  ADD COLUMN "topicAllowRecipientSave" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "topicSelectedAt" TIMESTAMP(3);

ALTER TABLE "VisitInvitation" ADD CONSTRAINT "VisitInvitation_topicRefId_fkey"
  FOREIGN KEY ("topicRefId") REFERENCES "ShareableTopic"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitInvitation" ADD CONSTRAINT "VisitInvitation_visitMode_check"
  CHECK ("visitMode" IN ('standard', 'random_host_topic', 'visitor_topic'));
ALTER TABLE "VisitInvitation" ADD CONSTRAINT "VisitInvitation_topicShareScope_check"
  CHECK ("topicShareScope" IS NULL OR "topicShareScope" IN ('summary_only', 'summary_and_source'));
CREATE INDEX "VisitInvitation_topicRefId_status_idx" ON "VisitInvitation"("topicRefId", "status");
CREATE INDEX "VisitInvitation_visitMode_status_idx" ON "VisitInvitation"("visitMode", "status");

ALTER TABLE "VisitSession" ADD COLUMN "visitMode" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "VisitSession" ADD CONSTRAINT "VisitSession_visitMode_check"
  CHECK ("visitMode" IN ('standard', 'random_host_topic', 'visitor_topic'));
