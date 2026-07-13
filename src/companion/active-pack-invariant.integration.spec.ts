import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const enabled = process.env.RUN_POSTGRES_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;
const migrationPath = join(process.cwd(), 'prisma/migrations/20260713100000_s3_one_active_asset_pack_per_companion/migration.sql');

describeIntegration('active Asset Pack PostgreSQL invariant migration', () => {
  const prisma = new PrismaClient();

  afterAll(async () => { await prisma.$disconnect(); });

  it('normalizes pointers and duplicate active rows, then enforces one active Pack per Companion', async () => {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "NetworkCompanion" ("id" TEXT PRIMARY KEY, "activeAssetPackId" TEXT) ON COMMIT DROP');
      await tx.$executeRawUnsafe('CREATE TEMP TABLE "CompanionAssetPack" ("id" TEXT PRIMARY KEY, "companionId" TEXT NOT NULL, "status" TEXT NOT NULL, "activatedAt" TIMESTAMP(3), "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "supersededAt" TIMESTAMP(3)) ON COMMIT DROP');

      await tx.$executeRawUnsafe(`
        INSERT INTO "NetworkCompanion" ("id", "activeAssetPackId") VALUES
          ('companion-x', 'pack-b'),
          ('companion-y', 'pack-y-stale'),
          ('companion-z', 'missing-pack')
      `);
      await tx.$executeRawUnsafe(`
        INSERT INTO "CompanionAssetPack" ("id", "companionId", "status", "activatedAt") VALUES
          ('pack-a', 'companion-x', 'active', CURRENT_TIMESTAMP - INTERVAL '2 hours'),
          ('pack-b', 'companion-x', 'active', CURRENT_TIMESTAMP - INTERVAL '1 hour'),
          ('pack-y-active', 'companion-y', 'active', CURRENT_TIMESTAMP),
          ('pack-y-stale', 'companion-y', 'superseded', CURRENT_TIMESTAMP - INTERVAL '1 hour')
      `);

      const statements = readFileSync(migrationPath, 'utf8').split(';').map(statement => statement.trim()).filter(Boolean);
      for (const statement of statements) await tx.$executeRawUnsafe(statement);

      const packs = await tx.$queryRawUnsafe<Array<{ id: string; companionId: string; status: string }>>('SELECT "id", "companionId", "status" FROM "CompanionAssetPack" ORDER BY "id"');
      expect(packs).toEqual([
        { id: 'pack-a', companionId: 'companion-x', status: 'superseded' },
        { id: 'pack-b', companionId: 'companion-x', status: 'active' },
        { id: 'pack-y-active', companionId: 'companion-y', status: 'active' },
        { id: 'pack-y-stale', companionId: 'companion-y', status: 'superseded' },
      ]);
      const pointers = await tx.$queryRawUnsafe<Array<{ id: string; activeAssetPackId: string | null }>>('SELECT "id", "activeAssetPackId" FROM "NetworkCompanion" ORDER BY "id"');
      expect(pointers).toEqual([
        { id: 'companion-x', activeAssetPackId: 'pack-b' },
        { id: 'companion-y', activeAssetPackId: 'pack-y-active' },
        { id: 'companion-z', activeAssetPackId: null },
      ]);

      await tx.$executeRawUnsafe(`INSERT INTO "CompanionAssetPack" ("id", "companionId", "status") VALUES ('pack-other', 'companion-z', 'active')`);
      await expect(tx.$executeRawUnsafe(`INSERT INTO "CompanionAssetPack" ("id", "companionId", "status") VALUES ('pack-different-companion', 'companion-y', 'superseded')`)).resolves.toBeGreaterThanOrEqual(1);
      await tx.$executeRawUnsafe('SAVEPOINT duplicate_active_pack');
      await expect(tx.$executeRawUnsafe(`INSERT INTO "CompanionAssetPack" ("id", "companionId", "status") VALUES ('pack-conflict', 'companion-z', 'active')`)).rejects.toBeDefined();
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_active_pack');
    });
  });
});
