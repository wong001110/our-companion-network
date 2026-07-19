BEGIN;

ALTER TABLE "User"
ADD COLUMN "deletionNextAttemptAt" TIMESTAMP(3),
ADD COLUMN "deletionAttemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "User_deletionNextAttemptAt_id_idx"
ON "User"("deletionNextAttemptAt", "id");

COMMIT;
