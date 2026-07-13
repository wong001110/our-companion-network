-- S4 consented Visit invitations and sessions. These rows contain only public
-- Companion snapshot fields and coordination timestamps; no local/runtime data.
CREATE TABLE "VisitInvitation" (
  "id" TEXT NOT NULL,
  "visitorOwnerUserId" TEXT NOT NULL,
  "hostUserId" TEXT NOT NULL,
  "networkCompanionId" TEXT NOT NULL,
  "assetPackId" TEXT NOT NULL,
  "companionName" TEXT NOT NULL,
  "companionDescription" TEXT,
  "companionTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "VisitSession" (
  "id" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "visitorOwnerUserId" TEXT NOT NULL,
  "hostUserId" TEXT NOT NULL,
  "networkCompanionId" TEXT NOT NULL,
  "assetPackId" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "visitorOwnerReadyAt" TIMESTAMP(3),
  "hostReadyAt" TIMESTAMP(3),
  "visitorOwnerSeenAt" TIMESTAMP(3),
  "hostSeenAt" TIMESTAMP(3),
  "readyAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "endingAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "endReason" TEXT,
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VisitSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VisitSession_invitationId_key" ON "VisitSession"("invitationId");
CREATE INDEX "VisitInvitation_visitorOwnerUserId_status_idx" ON "VisitInvitation"("visitorOwnerUserId", "status");
CREATE INDEX "VisitInvitation_hostUserId_status_idx" ON "VisitInvitation"("hostUserId", "status");
CREATE INDEX "VisitInvitation_expiresAt_status_idx" ON "VisitInvitation"("expiresAt", "status");
CREATE INDEX "VisitSession_visitorOwnerUserId_state_idx" ON "VisitSession"("visitorOwnerUserId", "state");
CREATE INDEX "VisitSession_hostUserId_state_idx" ON "VisitSession"("hostUserId", "state");
CREATE INDEX "VisitSession_assetPackId_state_idx" ON "VisitSession"("assetPackId", "state");
CREATE INDEX "VisitSession_updatedAt_state_idx" ON "VisitSession"("updatedAt", "state");

ALTER TABLE "VisitInvitation" ADD CONSTRAINT "VisitInvitation_visitorOwnerUserId_fkey" FOREIGN KEY ("visitorOwnerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitInvitation" ADD CONSTRAINT "VisitInvitation_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitInvitation" ADD CONSTRAINT "VisitInvitation_networkCompanionId_fkey" FOREIGN KEY ("networkCompanionId") REFERENCES "NetworkCompanion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitInvitation" ADD CONSTRAINT "VisitInvitation_assetPackId_fkey" FOREIGN KEY ("assetPackId") REFERENCES "CompanionAssetPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitSession" ADD CONSTRAINT "VisitSession_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "VisitInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitSession" ADD CONSTRAINT "VisitSession_visitorOwnerUserId_fkey" FOREIGN KEY ("visitorOwnerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitSession" ADD CONSTRAINT "VisitSession_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VisitSession" ADD CONSTRAINT "VisitSession_networkCompanionId_fkey" FOREIGN KEY ("networkCompanionId") REFERENCES "NetworkCompanion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VisitSession" ADD CONSTRAINT "VisitSession_assetPackId_fkey" FOREIGN KEY ("assetPackId") REFERENCES "CompanionAssetPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
