BEGIN;

ALTER TABLE "User"
ADD COLUMN "deletionRequestedAt" TIMESTAMP(3);

CREATE INDEX "User_deletionRequestedAt_idx"
ON "User"("deletionRequestedAt");

ALTER TABLE "CompanionAssetPack"
ADD COLUMN "lastUploadUrlIssuedAt" TIMESTAMP(3);

COMMIT;
