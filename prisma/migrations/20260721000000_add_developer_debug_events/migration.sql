BEGIN;

CREATE TABLE "DeveloperDebugEvent" (
  "id" TEXT NOT NULL,
  "clientEventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "operation" TEXT,
  "status" TEXT,
  "provider" TEXT,
  "model" TEXT,
  "companionId" TEXT,
  "correlationId" TEXT,
  "cycleId" TEXT,
  "turnId" TEXT,
  "summary" TEXT,
  "payload" JSONB NOT NULL,
  "errorCode" TEXT,
  "clientCreatedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeveloperDebugEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeveloperDebugEvent_userId_clientEventId_key"
ON "DeveloperDebugEvent"("userId", "clientEventId");

CREATE INDEX "DeveloperDebugEvent_userId_receivedAt_idx"
ON "DeveloperDebugEvent"("userId", "receivedAt");

CREATE INDEX "DeveloperDebugEvent_kind_receivedAt_idx"
ON "DeveloperDebugEvent"("kind", "receivedAt");

CREATE INDEX "DeveloperDebugEvent_correlationId_idx"
ON "DeveloperDebugEvent"("correlationId");

CREATE INDEX "DeveloperDebugEvent_cycleId_idx"
ON "DeveloperDebugEvent"("cycleId");

CREATE INDEX "DeveloperDebugEvent_expiresAt_idx"
ON "DeveloperDebugEvent"("expiresAt");

ALTER TABLE "DeveloperDebugEvent"
ADD CONSTRAINT "DeveloperDebugEvent_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
