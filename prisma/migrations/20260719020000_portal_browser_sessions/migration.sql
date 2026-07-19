BEGIN;

CREATE TYPE "UserAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

ALTER TABLE "User"
ADD COLUMN "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "suspendedAt" TIMESTAMP(3);

CREATE INDEX "User_accountStatus_idx" ON "User"("accountStatus");

ALTER TABLE "DeviceSession"
ADD COLUMN "csrfTokenHash" TEXT;

COMMIT;
