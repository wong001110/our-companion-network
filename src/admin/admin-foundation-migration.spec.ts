import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { AdminRoleService } from './admin-role.service';
import { AuditService } from './audit.service';

const migrationPath = join(
  process.cwd(),
  'prisma/migrations/20260719010000_portal_admin_foundation/migration.sql',
);
const migration = readFileSync(migrationPath, 'utf8');
const enabled = process.env.RUN_POSTGRES_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;
const databaseUrl = process.env.DATABASE_URL;

function runSql(sql: string): string {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
  const psqlUrl = new URL(databaseUrl);
  psqlUrl.searchParams.delete('schema');
  return execFileSync(
    'psql',
    [psqlUrl.toString(), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql },
  );
}

describe('Portal admin foundation migration contract', () => {
  it('adds a default USER role, audit indexes, and an append-only trigger', () => {
    expect(migration).toContain(`CREATE TYPE "UserRole" AS ENUM ('USER', 'SUPERADMIN')`);
    expect(migration).toContain(`"role" "UserRole" NOT NULL DEFAULT 'USER'`);
    expect(migration).toContain('AdminAuditLog_adminUserId_createdAt_idx');
    expect(migration).toContain('AdminAuditLog_createdAt_id_idx');
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "AdminAuditLog"');
    expect(migration).toContain(`ERRCODE = '55000'`);
  });
});

describeIntegration('Portal admin foundation PostgreSQL invariants', () => {
  const schema = `portal_admin_${randomUUID().replaceAll('-', '')}`;
  let prisma: PrismaClient;
  let roles: AdminRoleService;

  beforeAll(async () => {
    runSql(`
      CREATE SCHEMA "${schema}";
      SET search_path TO "${schema}";
      CREATE TABLE "User" (
        "id" TEXT PRIMARY KEY,
        "uid" TEXT NOT NULL UNIQUE,
        "email" TEXT NOT NULL,
        "username" TEXT NOT NULL,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      ${migration}
      CREATE TYPE "UserAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
      ALTER TABLE "User"
      ADD COLUMN "accountStatus" "UserAccountStatus" NOT NULL DEFAULT 'ACTIVE';
      INSERT INTO "User" ("id", "uid", "email", "username") VALUES
        ('admin-a', 'OC-ADMINAAA', 'a@example.test', 'Admin A'),
        ('admin-b', 'OC-ADMINBBB', 'b@example.test', 'Admin B'),
        ('user-c', 'OC-USERCCCC', 'c@example.test', 'User C');
      UPDATE "User" SET "role" = 'SUPERADMIN'
      WHERE "id" IN ('admin-a', 'admin-b');
    `);
    const schemaUrl = new URL(databaseUrl!);
    schemaUrl.searchParams.set('schema', schema);
    prisma = new PrismaClient({ datasourceUrl: schemaUrl.toString() });
    await prisma.$connect();
    const audit = new AuditService(prisma as never);
    roles = new AdminRoleService(prisma as never, audit);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    runSql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`);
  });

  it('defaults new users to USER and indexes the role', () => {
    const result = runSql(`
      SET search_path TO "${schema}";
      INSERT INTO "User" ("id", "uid", "email", "username")
      VALUES ('default-user', 'OC-DEFAULT1', 'default@example.test', 'Default');
      SELECT "role" FROM "User" WHERE "id" = 'default-user';
      SELECT indexname FROM pg_indexes
      WHERE schemaname = '${schema}' AND indexname = 'User_role_idx';
    `).trim().split('\n');
    expect(result).toEqual(['USER', 'User_role_idx']);
  });

  it('rejects audit updates and deletes at the database boundary', async () => {
    await prisma.adminAuditLog.create({
      data: {
        adminUserId: 'admin-a',
        action: 'VIEW_SENSITIVE_ACCOUNT',
        targetType: 'User',
        targetId: 'user-c',
      },
    });
    await expect(prisma.adminAuditLog.updateMany({
      where: { adminUserId: 'admin-a' },
      data: { reason: 'tampered' },
    })).rejects.toThrow('AdminAuditLog is append-only');
    await expect(prisma.adminAuditLog.deleteMany({
      where: { adminUserId: 'admin-a' },
    })).rejects.toThrow('AdminAuditLog is append-only');
  });

  it('serializes concurrent demotions and preserves one Superadmin', async () => {
    const results = await Promise.allSettled([
      roles.demote({
        targetUid: 'OC-ADMINAAA',
        reason: 'Concurrent PostgreSQL invariant test A',
        actorUserId: 'admin-a',
      }),
      roles.demote({
        targetUid: 'OC-ADMINBBB',
        reason: 'Concurrent PostgreSQL invariant test B',
        actorUserId: 'admin-b',
      }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection).toMatchObject({
      status: 'rejected',
      reason: { response: { code: 'LAST_SUPERADMIN' } },
    });
    await expect(prisma.user.count({
      where: { role: 'SUPERADMIN' },
    })).resolves.toBe(1);
  });
});
