CREATE TABLE "VisitRelationshipSettlement" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "companionLowId" TEXT NOT NULL,
  "companionHighId" TEXT NOT NULL,
  "turnCount" INTEGER NOT NULL,
  "topicTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitRelationshipSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VisitRelationshipSettlement_pair_check" CHECK ("companionLowId" < "companionHighId"),
  CONSTRAINT "VisitRelationshipSettlement_turn_count_check" CHECK ("turnCount" >= 0)
);
CREATE UNIQUE INDEX "VisitRelSettlement_session_low_high_key"
  ON "VisitRelationshipSettlement"("sessionId", "companionLowId", "companionHighId");
CREATE INDEX "VisitRelationshipSettlement_companionLowId_createdAt_idx"
  ON "VisitRelationshipSettlement"("companionLowId", "createdAt");
CREATE INDEX "VisitRelationshipSettlement_companionHighId_createdAt_idx"
  ON "VisitRelationshipSettlement"("companionHighId", "createdAt");
ALTER TABLE "VisitRelationshipSettlement" ADD CONSTRAINT "VisitRelationshipSettlement_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "VisitSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitRelationshipSettlement" ADD CONSTRAINT "VisitRelationshipSettlement_companionLowId_fkey"
  FOREIGN KEY ("companionLowId") REFERENCES "NetworkCompanion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitRelationshipSettlement" ADD CONSTRAINT "VisitRelationshipSettlement_companionHighId_fkey"
  FOREIGN KEY ("companionHighId") REFERENCES "NetworkCompanion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
