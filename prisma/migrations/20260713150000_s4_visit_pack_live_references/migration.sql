-- S4 closure repair: retain immutable Pack snapshot IDs while allowing terminal
-- Visit history to release the actual Pack row for normal S3 retention cleanup.
ALTER TABLE "VisitInvitation" ADD COLUMN "assetPackSnapshotId" TEXT;
ALTER TABLE "VisitInvitation" ADD COLUMN "assetPackRefId" TEXT;
ALTER TABLE "VisitSession" ADD COLUMN "assetPackSnapshotId" TEXT;
ALTER TABLE "VisitSession" ADD COLUMN "assetPackRefId" TEXT;

UPDATE "VisitInvitation"
SET
  "assetPackSnapshotId" = "assetPackId",
  "assetPackRefId" = CASE WHEN "status" = 'pending' THEN "assetPackId" ELSE NULL END;

UPDATE "VisitSession"
SET
  "assetPackSnapshotId" = "assetPackId",
  "assetPackRefId" = CASE WHEN "state" IN ('preparing', 'ready', 'active', 'ending') THEN "assetPackId" ELSE NULL END;

ALTER TABLE "VisitInvitation" ALTER COLUMN "assetPackSnapshotId" SET NOT NULL;
ALTER TABLE "VisitSession" ALTER COLUMN "assetPackSnapshotId" SET NOT NULL;

ALTER TABLE "VisitInvitation" DROP CONSTRAINT "VisitInvitation_assetPackId_fkey";
ALTER TABLE "VisitSession" DROP CONSTRAINT "VisitSession_assetPackId_fkey";
ALTER TABLE "VisitInvitation" DROP COLUMN "assetPackId";
ALTER TABLE "VisitSession" DROP COLUMN "assetPackId";

ALTER TABLE "VisitInvitation" ADD CONSTRAINT "VisitInvitation_assetPackRefId_fkey"
  FOREIGN KEY ("assetPackRefId") REFERENCES "CompanionAssetPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitSession" ADD CONSTRAINT "VisitSession_assetPackRefId_fkey"
  FOREIGN KEY ("assetPackRefId") REFERENCES "CompanionAssetPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "VisitInvitation_assetPackRefId_status_idx" ON "VisitInvitation"("assetPackRefId", "status");
CREATE INDEX "VisitSession_assetPackRefId_state_idx" ON "VisitSession"("assetPackRefId", "state");
