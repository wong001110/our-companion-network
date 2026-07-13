-- Enforce the S3 invariant: a companion has at most one active asset pack.
-- Normalize existing rows before the partial unique index is created.
WITH ranked_active_packs AS (
  SELECT
    cap."id",
    cap."companionId",
    nc."activeAssetPackId",
    ROW_NUMBER() OVER (
      PARTITION BY cap."companionId"
      ORDER BY
        CASE WHEN cap."id" = nc."activeAssetPackId" THEN 0 ELSE 1 END,
        cap."activatedAt" DESC NULLS LAST,
        cap."updatedAt" DESC,
        cap."id"
    ) AS active_rank
  FROM "CompanionAssetPack" cap
  JOIN "NetworkCompanion" nc ON nc."id" = cap."companionId"
  WHERE cap."status" = 'active'
)
UPDATE "CompanionAssetPack" cap
SET
  "status" = 'superseded',
  "supersededAt" = COALESCE(cap."supersededAt", CURRENT_TIMESTAMP)
FROM ranked_active_packs ranked
WHERE cap."id" = ranked."id"
  AND ranked.active_rank > 1;

UPDATE "NetworkCompanion" nc
SET "activeAssetPackId" = selected."id"
FROM (
  SELECT DISTINCT ON ("companionId")
    "companionId",
    "id"
  FROM "CompanionAssetPack"
  WHERE "status" = 'active'
  ORDER BY
    "companionId",
    "activatedAt" DESC NULLS LAST,
    "updatedAt" DESC,
    "id"
) selected
WHERE nc."id" = selected."companionId"
  AND (
    nc."activeAssetPackId" IS NULL
    OR nc."activeAssetPackId" <> selected."id"
  );

UPDATE "NetworkCompanion" nc
SET "activeAssetPackId" = NULL
WHERE nc."activeAssetPackId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "CompanionAssetPack" cap
    WHERE cap."id" = nc."activeAssetPackId"
      AND cap."companionId" = nc."id"
      AND cap."status" = 'active'
  );

CREATE UNIQUE INDEX "CompanionAssetPack_one_active_per_companion"
ON "CompanionAssetPack" ("companionId")
WHERE "status" = 'active';
