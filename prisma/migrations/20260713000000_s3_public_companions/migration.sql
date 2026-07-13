-- S3 public companion identity and private R2 asset-pack metadata.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "activeNetworkCompanionId" TEXT;

CREATE TABLE IF NOT EXISTS "NetworkCompanion" (
  "id" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "publicDescription" TEXT,
  "publicTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "visibility" TEXT NOT NULL DEFAULT 'friends_only',
  "published" BOOLEAN NOT NULL DEFAULT false,
  "activeAssetPackId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "publishedAt" TIMESTAMP(3),
  CONSTRAINT "NetworkCompanion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CompanionAssetPack" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "manifestHash" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "manifest" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "objectPrefix" TEXT NOT NULL,
  "totalFiles" INTEGER NOT NULL,
  "totalBytes" BIGINT NOT NULL,
  "failureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "supersededAt" TIMESTAMP(3),
  CONSTRAINT "CompanionAssetPack_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CompanionAssetFile" (
  "id" TEXT NOT NULL,
  "assetPackId" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "sha256" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "uploaded" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3),
  CONSTRAINT "CompanionAssetFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "User_activeNetworkCompanionId_key" ON "User"("activeNetworkCompanionId");
CREATE INDEX IF NOT EXISTS "NetworkCompanion_ownerUserId_idx" ON "NetworkCompanion"("ownerUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "NetworkCompanion_activeAssetPackId_key" ON "NetworkCompanion"("activeAssetPackId");
CREATE UNIQUE INDEX IF NOT EXISTS "CompanionAssetPack_companionId_manifestHash_key" ON "CompanionAssetPack"("companionId", "manifestHash");
CREATE INDEX IF NOT EXISTS "CompanionAssetPack_companionId_status_idx" ON "CompanionAssetPack"("companionId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "CompanionAssetFile_assetPackId_relativePath_key" ON "CompanionAssetFile"("assetPackId", "relativePath");
CREATE UNIQUE INDEX IF NOT EXISTS "CompanionAssetFile_objectKey_key" ON "CompanionAssetFile"("objectKey");

DO $$ BEGIN
  ALTER TABLE "NetworkCompanion" ADD CONSTRAINT "NetworkCompanion_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CompanionAssetPack" ADD CONSTRAINT "CompanionAssetPack_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "NetworkCompanion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CompanionAssetFile" ADD CONSTRAINT "CompanionAssetFile_assetPackId_fkey" FOREIGN KEY ("assetPackId") REFERENCES "CompanionAssetPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_activeNetworkCompanionId_fkey" FOREIGN KEY ("activeNetworkCompanionId") REFERENCES "NetworkCompanion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "NetworkCompanion" ADD CONSTRAINT "NetworkCompanion_activeAssetPackId_fkey" FOREIGN KEY ("activeAssetPackId") REFERENCES "CompanionAssetPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
