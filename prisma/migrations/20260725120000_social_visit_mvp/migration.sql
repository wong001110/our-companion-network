CREATE TABLE "VisitShareEnvelope" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "summary" VARCHAR(600) NOT NULL,
  "tags" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "sourceUrl" VARCHAR(2000),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitShareEnvelope_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitShareEnvelope_sessionId_key" ON "VisitShareEnvelope"("sessionId");
CREATE INDEX "VisitShareEnvelope_createdByUserId_idx" ON "VisitShareEnvelope"("createdByUserId");
ALTER TABLE "VisitShareEnvelope" ADD CONSTRAINT "VisitShareEnvelope_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "VisitSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitShareEnvelope" ADD CONSTRAINT "VisitShareEnvelope_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "VisitTurn" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "clientTurnId" TEXT NOT NULL,
  "senderUserId" TEXT NOT NULL,
  "intent" VARCHAR(40) NOT NULL,
  "message" VARCHAR(800) NOT NULL,
  "emotion" VARCHAR(40),
  "topic" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitTurn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitTurn_sessionId_sequence_key" ON "VisitTurn"("sessionId", "sequence");
CREATE UNIQUE INDEX "VisitTurn_sessionId_clientTurnId_key" ON "VisitTurn"("sessionId", "clientTurnId");
CREATE INDEX "VisitTurn_sessionId_createdAt_idx" ON "VisitTurn"("sessionId", "createdAt");
ALTER TABLE "VisitTurn" ADD CONSTRAINT "VisitTurn_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "VisitSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitTurn" ADD CONSTRAINT "VisitTurn_senderUserId_fkey"
  FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "VisitSharedMoment" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "title" VARCHAR(160) NOT NULL,
  "summary" VARCHAR(600) NOT NULL,
  "turnCount" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitSharedMoment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitSharedMoment_sessionId_key" ON "VisitSharedMoment"("sessionId");
ALTER TABLE "VisitSharedMoment" ADD CONSTRAINT "VisitSharedMoment_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "VisitSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
