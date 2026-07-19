BEGIN;

-- Prisma represents @unique fields as unique indexes in PostgreSQL. The
-- preceding migration used DROP CONSTRAINT, which did not remove indexes
-- created by the original Prisma schema.
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_email_key";
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_username_key";
DROP INDEX IF EXISTS "User_email_key";
DROP INDEX IF EXISTS "User_username_key";

CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username");

COMMIT;
