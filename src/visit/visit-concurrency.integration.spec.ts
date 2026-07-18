import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';

const enabled = process.env.RUN_POSTGRES_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;
const databaseUrl = process.env.DATABASE_URL;

function schemaUrl(schema: string): string {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

describeIntegration('S4 Visit participant concurrency', () => {
  const schema = `s4_visit_concurrency_${randomUUID().replaceAll('-', '')}`;
  const admin = new PrismaClient();
  let first: PrismaClient;
  let second: PrismaClient;

  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await admin.$executeRawUnsafe(`CREATE TABLE "${schema}"."User" ("id" TEXT PRIMARY KEY)`);
    await admin.$executeRawUnsafe(`CREATE TABLE "${schema}"."VisitSession" ("id" TEXT PRIMARY KEY, "visitorOwnerUserId" TEXT NOT NULL, "hostUserId" TEXT NOT NULL, "state" TEXT NOT NULL)`);
    await admin.$executeRawUnsafe(`INSERT INTO "${schema}"."User" ("id") VALUES ('A'), ('B'), ('C'), ('D')`);
    first = new PrismaClient({ datasources: { db: { url: schemaUrl(schema) } } });
    second = new PrismaClient({ datasources: { db: { url: schemaUrl(schema) } } });
  });

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect(), admin.$disconnect()]);
    const cleanup = new PrismaClient();
    await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).finally(() => cleanup.$disconnect());
  });

  async function accept(client: PrismaClient, id: string, owner: string, host: string): Promise<boolean> {
    return client.$transaction(async tx => {
      // This is the same deterministic participant-row lock used by VisitService.
      await tx.$executeRawUnsafe(`SELECT "id" FROM "User" WHERE "id" IN ('${owner}', '${host}') ORDER BY "id" FOR UPDATE`);
      const ownerSession = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "VisitSession" WHERE "state" IN ('preparing', 'ready', 'active', 'ending') AND ("visitorOwnerUserId" = '${owner}' OR "hostUserId" = '${owner}') LIMIT 1`);
      const hostOutgoing = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "VisitSession" WHERE "state" IN ('preparing', 'ready', 'active', 'ending') AND "visitorOwnerUserId" = '${host}' LIMIT 1`);
      const hostSessions = await tx.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "VisitSession" WHERE "state" IN ('preparing', 'ready', 'active', 'ending') AND "hostUserId" = '${host}' LIMIT 2`);
      if (ownerSession.length || hostOutgoing.length || hostSessions.length >= 2) return false;
      await tx.$executeRawUnsafe(`INSERT INTO "VisitSession" ("id", "visitorOwnerUserId", "hostUserId", "state") VALUES ('${id}', '${owner}', '${host}', 'preparing')`);
      return true;
    });
  }

  it('admits exactly two concurrent Visitor owners for one host and rejects the third', async () => {
    const accepted = await Promise.all([
      accept(first, `session-${randomUUID()}`, 'A', 'B'),
      accept(second, `session-${randomUUID()}`, 'C', 'B'),
      accept(second, `session-${randomUUID()}`, 'D', 'B'),
    ]);
    expect(accepted.filter(Boolean)).toHaveLength(2);
    const sessions = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT count(*)::bigint AS "count" FROM "${schema}"."VisitSession" WHERE "state" IN ('preparing', 'ready', 'active', 'ending')`);
    expect(sessions[0].count).toBe(BigInt(2));
    await admin.$executeRawUnsafe(`TRUNCATE TABLE "${schema}"."VisitSession"`);
  });

  it('rejects an outgoing Visit from a user who is already hosting', async () => {
    const accepted = await Promise.all([
      accept(first, `session-${randomUUID()}`, 'A', 'B'),
      accept(second, `session-${randomUUID()}`, 'B', 'C'),
    ]);
    expect(accepted.filter(Boolean)).toHaveLength(1);
  });
});
