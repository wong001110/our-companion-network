BEGIN;

CREATE TYPE "UserRole" AS ENUM ('USER', 'SUPERADMIN');

ALTER TABLE "User"
ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';

CREATE INDEX "User_role_idx" ON "User"("role");

CREATE TABLE "AdminAuditLog" (
  "id" TEXT NOT NULL,
  "adminUserId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "reason" TEXT,
  "metadata" JSONB,
  "ipAddressHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AdminAuditLog_adminUserId_createdAt_idx"
ON "AdminAuditLog"("adminUserId", "createdAt");

CREATE INDEX "AdminAuditLog_targetType_targetId_idx"
ON "AdminAuditLog"("targetType", "targetId");

CREATE INDEX "AdminAuditLog_createdAt_id_idx"
ON "AdminAuditLog"("createdAt", "id");

CREATE FUNCTION "prevent_admin_audit_log_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AdminAuditLog is append-only'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "AdminAuditLog_prevent_update_delete"
BEFORE UPDATE OR DELETE ON "AdminAuditLog"
FOR EACH ROW
EXECUTE FUNCTION "prevent_admin_audit_log_mutation"();

COMMIT;
