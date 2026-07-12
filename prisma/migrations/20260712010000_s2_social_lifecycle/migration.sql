-- S2 keeps request history in-place. Terminal requests are reopened by the
-- application, so the existing directed-pair uniqueness rule remains valid.
ALTER TABLE "FriendRequest" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "FriendRequest_receiverId_status_idx" ON "FriendRequest"("receiverId", "status");
CREATE INDEX IF NOT EXISTS "FriendRequest_senderId_status_idx" ON "FriendRequest"("senderId", "status");
