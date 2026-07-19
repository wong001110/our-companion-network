import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import 'dotenv/config';

const migration = readFileSync(join(
  process.cwd(),
  'prisma/migrations/20260719020000_portal_browser_sessions/migration.sql',
), 'utf8');
const enabled = process.env.RUN_POSTGRES_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;
const databaseUrl = process.env.DATABASE_URL;

function runSql(sql: string): string {
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const url = new URL(databaseUrl);
  url.searchParams.delete('schema');
  return execFileSync(
    'psql',
    [url.toString(), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { encoding: 'utf8', input: sql },
  );
}

describe('browser session migration contract', () => {
  it('adds account state and a nullable desktop-compatible CSRF binding', () => {
    expect(migration).toContain(`('ACTIVE', 'SUSPENDED')`);
    expect(migration).toContain(`DEFAULT 'ACTIVE'`);
    expect(migration).toContain('User_accountStatus_idx');
    expect(migration).toContain('ADD COLUMN "csrfTokenHash" TEXT');
  });
});

describeIntegration('browser session PostgreSQL migration', () => {
  const schema = `browser_session_${randomUUID().replaceAll('-', '')}`;

  beforeAll(() => {
    runSql(`
      CREATE SCHEMA "${schema}";
      SET search_path TO "${schema}";
      CREATE TABLE "User" ("id" TEXT PRIMARY KEY);
      CREATE TABLE "DeviceSession" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL
      );
      INSERT INTO "User" ("id") VALUES ('existing-user');
      INSERT INTO "DeviceSession" ("id", "userId")
      VALUES ('desktop-session', 'existing-user');
      ${migration}
    `);
  });

  afterAll(() => {
    runSql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`);
  });

  it('backfills ACTIVE without invalidating existing desktop sessions', () => {
    const result = runSql(`
      SET search_path TO "${schema}";
      SELECT "accountStatus" FROM "User" WHERE "id" = 'existing-user';
      SELECT COALESCE("csrfTokenHash", 'NULL')
      FROM "DeviceSession" WHERE "id" = 'desktop-session';
    `).trim().split('\n');
    expect(result).toEqual(['ACTIVE', 'NULL']);
  });
});
