ALTER TABLE "CompanionAssetPack"
ADD COLUMN "stagingCleanedAt" TIMESTAMP(3);

CREATE INDEX "CompanionAssetPack_status_stagingCleanedAt_idx"
ON "CompanionAssetPack"("status", "stagingCleanedAt");
