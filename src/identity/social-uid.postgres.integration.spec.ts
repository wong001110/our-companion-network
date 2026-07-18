import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';

const enabled = process.env.RUN_POSTGRES_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;
const databaseUrl = process.env.DATABASE_URL;

function runSql(sql: string): string {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
  const psqlUrl = new URL(databaseUrl);
  psqlUrl.searchParams.delete('schema');
  return execFileSync('psql', [psqlUrl.toString(), '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
    encoding: 'utf8',
    input: sql,
  });
}

describeIntegration('Social public UID PostgreSQL migration and constraints', () => {
  const schema = `social_uid_${randomUUID().replaceAll('-', '')}`;
  const migration = readFileSync(
    join(process.cwd(), 'prisma/migrations/20260718000000_social_public_uid/migration.sql'),
    'utf8',
  );

  beforeAll(() => {
    runSql(`
      CREATE SCHEMA "${schema}";
      SET search_path TO "${schema}";
      CREATE TABLE "User" (
        "id" TEXT PRIMARY KEY,
        "email" TEXT NOT NULL,
        "username" TEXT NOT NULL,
        "friendCode" TEXT NOT NULL
      );
      ALTER TABLE "User" ADD CONSTRAINT "User_email_key" UNIQUE ("email");
      ALTER TABLE "User" ADD CONSTRAINT "User_username_key" UNIQUE ("username");
      ALTER TABLE "User" ADD CONSTRAINT "User_friendCode_key" UNIQUE ("friendCode");
      CREATE TABLE "Friendship" (
        "userId" TEXT NOT NULL,
        "friendId" TEXT NOT NULL,
        PRIMARY KEY ("userId", "friendId")
      );
      INSERT INTO "User" ("id", "email", "username", "friendCode") VALUES
        ('user-a', 'Alex.One@example.test', 'Alex', '7K4M92QX'),
        ('user-b', 'alex.two@example.test', 'Blake', '8N5P73RW');
      INSERT INTO "Friendship" ("userId", "friendId") VALUES ('user-a', 'user-b');
      ${migration}
    `);
  });

  afterAll(() => {
    runSql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE;`);
  });

  it('backfills existing accounts without changing IDs, compatibility codes, or friendships', () => {
    const result = runSql(`
      SET search_path TO "${schema}";
      SELECT "id" || '|' || "uid" || '|' || "normalizedEmail" || '|' || "friendCode"
      FROM "User" ORDER BY "id";
      SELECT "userId" || '|' || "friendId" FROM "Friendship";
    `).trim().split('\n');
    expect(result).toEqual([
      'user-a|OC-7K4M92QX|alex.one@example.test|7K4M92QX',
      'user-b|OC-8N5P73RW|alex.two@example.test|8N5P73RW',
      'user-a|user-b',
    ]);
  });

  it('allows duplicate usernames while enforcing case-normalized email and UID uniqueness', () => {
    runSql(`
      SET search_path TO "${schema}";
      INSERT INTO "User" ("id", "uid", "email", "normalizedEmail", "username", "friendCode")
      VALUES ('user-c', 'OC-9Q6R84TX', 'alex.three@example.test', 'alex.three@example.test', 'Alex', '9Q6R84TX');
    `);
    expect(() => runSql(`
      SET search_path TO "${schema}";
      INSERT INTO "User" ("id", "uid", "email", "normalizedEmail", "username", "friendCode")
      VALUES ('uid-copy', 'OC-9Q6R84TX', 'unique@example.test', 'unique@example.test', 'Other', '2Q6R84TX');
    `)).toThrow();
    expect(() => runSql(`
      SET search_path TO "${schema}";
      INSERT INTO "User" ("id", "uid", "email", "normalizedEmail", "username", "friendCode")
      VALUES ('email-copy', 'OC-3Q6R84TX', 'ALEX.THREE@example.test', 'alex.three@example.test', 'Other', '3Q6R84TX');
    `)).toThrow();
  });

  it('resolves the same account by either UID casing after normalization', () => {
    const lookup = runSql(`
      SET search_path TO "${schema}";
      SELECT "id" FROM "User" WHERE "uid" = upper('oc-7k4m92qx');
    `).trim();
    expect(lookup).toBe('user-a');
  });
});
