import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const enabled = process.env.RUN_POSTGRES_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;
const migrationPath = join(process.cwd(), 'prisma/migrations/20260713120000_s4_visit_invitations_and_sessions/migration.sql');

describeIntegration('S4 Visit PostgreSQL migration', () => {
  const prisma = new PrismaClient();
  afterAll(async () => { await prisma.$disconnect(); });

  it('creates restrictive snapshot relations and one session per invitation without touching application data', async () => {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE SCHEMA s4_visit_migration_test');
      await tx.$executeRawUnsafe('SET LOCAL search_path TO s4_visit_migration_test');
      await tx.$executeRawUnsafe('CREATE TABLE "User" ("id" TEXT PRIMARY KEY)');
      await tx.$executeRawUnsafe('CREATE TABLE "NetworkCompanion" ("id" TEXT PRIMARY KEY)');
      await tx.$executeRawUnsafe('CREATE TABLE "CompanionAssetPack" ("id" TEXT PRIMARY KEY)');
      const sql = readFileSync(migrationPath, 'utf8').replace(/^--.*$/gm, '');
      for (const statement of sql.split(';').map((item) => item.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe(`INSERT INTO "User" ("id") VALUES ('owner'), ('host')`);
      await tx.$executeRawUnsafe(`INSERT INTO "NetworkCompanion" ("id") VALUES ('companion')`);
      await tx.$executeRawUnsafe(`INSERT INTO "CompanionAssetPack" ("id") VALUES ('pack')`);
      await tx.$executeRawUnsafe(`INSERT INTO "VisitInvitation" ("id", "visitorOwnerUserId", "hostUserId", "networkCompanionId", "assetPackId", "companionName", "companionTags", "status", "expiresAt") VALUES ('invitation', 'owner', 'host', 'companion', 'pack', 'Ann', ARRAY['kind'], 'pending', CURRENT_TIMESTAMP + INTERVAL '1 hour')`);
      await tx.$executeRawUnsafe(`INSERT INTO "VisitSession" ("id", "invitationId", "visitorOwnerUserId", "hostUserId", "networkCompanionId", "assetPackId", "state") VALUES ('session-a', 'invitation', 'owner', 'host', 'companion', 'pack', 'preparing')`);
      await tx.$executeRawUnsafe('SAVEPOINT duplicate_visit_session');
      await expect(tx.$executeRawUnsafe(`INSERT INTO "VisitSession" ("id", "invitationId", "visitorOwnerUserId", "hostUserId", "networkCompanionId", "assetPackId", "state") VALUES ('session-b', 'invitation', 'owner', 'host', 'companion', 'pack', 'preparing')`)).rejects.toBeDefined();
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_visit_session');
      await tx.$executeRawUnsafe('SAVEPOINT delete_pinned_pack');
      await expect(tx.$executeRawUnsafe(`DELETE FROM "CompanionAssetPack" WHERE "id" = 'pack'`)).rejects.toBeDefined();
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT delete_pinned_pack');
      await tx.$executeRawUnsafe('DROP SCHEMA s4_visit_migration_test CASCADE');
    });
  });
});
