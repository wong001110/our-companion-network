import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('social public UID migration', () => {
  const sql = readFileSync(
    join(process.cwd(), 'prisma/migrations/20260718000000_social_public_uid/migration.sql'),
    'utf8',
  );
  const correctiveSql = readFileSync(
    join(process.cwd(), 'prisma/migrations/20260719000000_drop_legacy_identity_unique_indexes/migration.sql'),
    'utf8',
  );

  it('preflights normalized email collisions before adding constraints', () => {
    expect(sql).toContain('lower(trim("email"))');
    expect(sql).toContain('Normalized email collision detected');
    expect(sql.indexOf('Normalized email collision detected')).toBeLessThan(sql.indexOf('SET "normalizedEmail"'));
  });

  it('backfills existing users without replacing IDs, Friend Codes, or friendships', () => {
    expect(sql).toContain(`"uid" = 'OC-' || upper("friendCode")`);
    expect(sql).not.toContain('DELETE FROM "User"');
    expect(sql).not.toContain('UPDATE "Friendship"');
  });

  it('makes UID and normalized email authoritative while allowing duplicate usernames', () => {
    expect(sql).toContain('"User_uid_key" UNIQUE ("uid")');
    expect(sql).toContain('"User_normalizedEmail_key" UNIQUE ("normalizedEmail")');
    expect(sql).toContain('DROP CONSTRAINT IF EXISTS "User_username_key"');
    expect(sql).toContain('CREATE INDEX "User_username_idx"');
    expect(correctiveSql).toContain('DROP INDEX IF EXISTS "User_email_key"');
    expect(correctiveSql).toContain('DROP INDEX IF EXISTS "User_username_key"');
    expect(correctiveSql).toContain('CREATE INDEX IF NOT EXISTS "User_username_idx"');
  });
});
