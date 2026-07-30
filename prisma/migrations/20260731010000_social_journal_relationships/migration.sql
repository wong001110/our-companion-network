-- Snapshot the host Companion used by a Visit so relationship history remains stable.
ALTER TABLE "VisitSession" ADD COLUMN "hostNetworkCompanionId" TEXT;

ALTER TABLE "VisitSession" ADD CONSTRAINT "VisitSession_hostNetworkCompanionId_fkey"
  FOREIGN KEY ("hostNetworkCompanionId") REFERENCES "NetworkCompanion"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "VisitSession_hostNetworkCompanionId_state_idx"
  ON "VisitSession"("hostNetworkCompanionId", "state");

-- Existing Visits use the host's current published Companion as the best available snapshot.
UPDATE "VisitSession" AS session
SET "hostNetworkCompanionId" = owner."activeNetworkCompanionId"
FROM "User" AS owner
WHERE owner."id" = session."hostUserId"
  AND session."hostNetworkCompanionId" IS NULL;

CREATE TABLE "CompanionRelationship" (
  "id" TEXT NOT NULL,
  "companionLowId" TEXT NOT NULL,
  "companionHighId" TEXT NOT NULL,
  "stage" TEXT NOT NULL DEFAULT 'new',
  "visitCount" INTEGER NOT NULL DEFAULT 0,
  "interactionCount" INTEGER NOT NULL DEFAULT 0,
  "totalTurnCount" INTEGER NOT NULL DEFAULT 0,
  "rapportScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "topicAffinityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "sharedTopicTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "firstMetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastInteractionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanionRelationship_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanionRelationship_companionLowId_companionHighId_key"
  ON "CompanionRelationship"("companionLowId", "companionHighId");
CREATE INDEX "CompanionRelationship_companionLowId_lastInteractionAt_idx"
  ON "CompanionRelationship"("companionLowId", "lastInteractionAt");
CREATE INDEX "CompanionRelationship_companionHighId_lastInteractionAt_idx"
  ON "CompanionRelationship"("companionHighId", "lastInteractionAt");

ALTER TABLE "CompanionRelationship" ADD CONSTRAINT "CompanionRelationship_companionLowId_fkey"
  FOREIGN KEY ("companionLowId") REFERENCES "NetworkCompanion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanionRelationship" ADD CONSTRAINT "CompanionRelationship_companionHighId_fkey"
  FOREIGN KEY ("companionHighId") REFERENCES "NetworkCompanion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
