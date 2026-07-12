-- Refresh tokens were previously stored as plaintext. They are deliberately
-- discarded during this security migration: affected installations must log in
-- again, after which only bcrypt hashes are persisted.
DROP TABLE IF EXISTS "RefreshToken";

CREATE TABLE "DeviceSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "refreshTokenHash" TEXT NOT NULL,
  "previousRefreshTokenHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DeviceSession_userId_deviceId_key" ON "DeviceSession"("userId", "deviceId");
CREATE INDEX "DeviceSession_deviceId_idx" ON "DeviceSession"("deviceId");
ALTER TABLE "DeviceSession" ADD CONSTRAINT "DeviceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
