BEGIN;

ALTER TABLE "User" ADD COLUMN "uid" TEXT;
ALTER TABLE "User" ADD COLUMN "normalizedEmail" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT lower(trim("email"))
    FROM "User"
    GROUP BY lower(trim("email"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Normalized email collision detected; resolve duplicate case-insensitive emails before UID migration';
  END IF;
END $$;

UPDATE "User"
SET "normalizedEmail" = lower(trim("email")),
    "uid" = 'OC-' || upper("friendCode");

ALTER TABLE "User" ALTER COLUMN "uid" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "normalizedEmail" SET NOT NULL;

ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_key";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_username_key";
ALTER TABLE "User" ADD CONSTRAINT "User_uid_key" UNIQUE ("uid");
ALTER TABLE "User" ADD CONSTRAINT "User_normalizedEmail_key" UNIQUE ("normalizedEmail");
CREATE INDEX "User_username_idx" ON "User"("username");

COMMIT;
