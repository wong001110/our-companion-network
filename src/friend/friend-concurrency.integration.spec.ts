import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { FriendService } from './friend.service';

const enabled = process.env.RUN_POSTGRES_INTEGRATION === '1';
const describeIntegration = enabled ? describe : describe.skip;
const databaseUrl = process.env.DATABASE_URL;

function schemaUrl(schema: string): string {
  if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests');
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

describeIntegration('Friend request terminal mutation concurrency', () => {
  const schema = `friend_concurrency_${randomUUID().replaceAll('-', '')}`;
  const admin = new PrismaClient();
  let first: PrismaClient;
  let second: PrismaClient;
  let events: { publishToUser: jest.Mock };

  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    await admin.$executeRawUnsafe(`
      CREATE TYPE "${schema}"."UserAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED')
    `);
    await admin.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."User" (
        "id" TEXT PRIMARY KEY,
        "accountStatus" "${schema}"."UserAccountStatus" NOT NULL DEFAULT 'ACTIVE',
        "deletionRequestedAt" TIMESTAMP(3)
      )
    `);
    await admin.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."FriendRequest" (
        "id" TEXT PRIMARY KEY,
        "senderId" TEXT NOT NULL,
        "receiverId" TEXT NOT NULL,
        "status" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await admin.$executeRawUnsafe(`
      CREATE TABLE "${schema}"."Friendship" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "friendId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE ("userId", "friendId")
      )
    `);
    await admin.$executeRawUnsafe(`
      INSERT INTO "${schema}"."User" ("id") VALUES ('user-a'), ('user-b')
    `);
    first = new PrismaClient({ datasources: { db: { url: schemaUrl(schema) } } });
    second = new PrismaClient({ datasources: { db: { url: schemaUrl(schema) } } });
  });

  beforeEach(async () => {
    events = { publishToUser: jest.fn() };
    await admin.$executeRawUnsafe(`TRUNCATE TABLE "${schema}"."Friendship"`);
    await admin.$executeRawUnsafe(`TRUNCATE TABLE "${schema}"."FriendRequest"`);
    await admin.$executeRawUnsafe(
      `UPDATE "${schema}"."User" SET "accountStatus" = 'ACTIVE', "deletionRequestedAt" = NULL`,
    );
    await admin.$executeRawUnsafe(`
      INSERT INTO "${schema}"."FriendRequest" ("id", "senderId", "receiverId", "status")
      VALUES ('request-1', 'user-a', 'user-b', 'pending')
    `);
  });

  afterAll(async () => {
    await Promise.all([first?.$disconnect(), second?.$disconnect(), admin.$disconnect()]);
    const cleanup = new PrismaClient();
    await cleanup.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      .finally(() => cleanup.$disconnect());
  });

  function serviceFor(client: PrismaClient) {
    return new FriendService(client as never, events as never);
  }

  async function assertConsistentTerminalState() {
    const request = await admin.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT "status" FROM "${schema}"."FriendRequest" WHERE "id" = 'request-1'`,
    );
    const friendships = await admin.$queryRawUnsafe<Array<{ userId: string; friendId: string }>>(
      `SELECT "userId", "friendId" FROM "${schema}"."Friendship" ORDER BY "userId"`,
    );
    expect(['accepted', 'rejected', 'cancelled']).toContain(request[0].status);
    if (request[0].status === 'accepted') {
      expect(friendships).toEqual([
        { userId: 'user-a', friendId: 'user-b' },
        { userId: 'user-b', friendId: 'user-a' },
      ]);
    } else {
      expect(friendships).toEqual([]);
    }
    return request[0].status;
  }

  it('lets exactly one of accept and reject win without contradictory state', async () => {
    const results = await Promise.allSettled([
      serviceFor(first).acceptFriendRequest('user-b', 'request-1'),
      serviceFor(second).rejectFriendRequest('user-b', 'request-1'),
    ]);

    expect(results.every((result) => result.status === 'fulfilled'
      || (result.status === 'rejected' && result.reason instanceof ConflictException)))
      .toBe(true);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const status = await assertConsistentTerminalState();
    expect(['accepted', 'rejected']).toContain(status);
  });

  it('lets exactly one of accept and cancel win without contradictory state', async () => {
    const results = await Promise.allSettled([
      serviceFor(first).acceptFriendRequest('user-b', 'request-1'),
      serviceFor(second).cancelFriendRequest('user-a', 'request-1'),
    ]);

    expect(results.every((result) => result.status === 'fulfilled'
      || (result.status === 'rejected' && result.reason instanceof ConflictException)))
      .toBe(true);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);

    const status = await assertConsistentTerminalState();
    expect(['accepted', 'cancelled']).toContain(status);
  });

  it('does not deadlock friend rejection behind account deletion', async () => {
    let deletionLocked!: () => void;
    const deletionHasUserLock = new Promise<void>((resolve) => {
      deletionLocked = resolve;
    });
    let finishDeletion!: () => void;
    const deletionMayContinue = new Promise<void>((resolve) => {
      finishDeletion = resolve;
    });
    let rejectingBackendPid = 0;
    let rejectionStarted!: () => void;
    const rejectionHasRoute = new Promise<void>((resolve) => {
      rejectionStarted = resolve;
    });

    const deletion = second.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '2s'`);
      await tx.$executeRawUnsafe(`SELECT "id" FROM "User" WHERE "id" = 'user-b' FOR UPDATE`);
      deletionLocked();
      await deletionMayContinue;
      await tx.$executeRawUnsafe(
        `UPDATE "User" SET "accountStatus" = 'SUSPENDED', "deletionRequestedAt" = CURRENT_TIMESTAMP WHERE "id" = 'user-b'`,
      );
      await tx.$executeRawUnsafe(
        `UPDATE "FriendRequest" SET "status" = 'cancelled' WHERE "id" = 'request-1' AND "status" = 'pending'`,
      );
    });
    await deletionHasUserLock;

    const rejection = first.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '2s'`);
      rejectingBackendPid = await tx.$queryRawUnsafe<Array<{ pid: number }>>(
        `SELECT pg_backend_pid() AS "pid"`,
      ).then((rows) => rows[0].pid);
      const route = await tx.$queryRawUnsafe<Array<{
        senderId: string;
        receiverId: string;
      }>>(`SELECT "senderId", "receiverId" FROM "FriendRequest" WHERE "id" = 'request-1'`);
      rejectionStarted();
      await tx.$executeRawUnsafe(
        `SELECT "id" FROM "User" WHERE "id" IN ('${route[0].senderId}', '${route[0].receiverId}') ORDER BY "id" FOR UPDATE`,
      );
      await tx.$executeRawUnsafe(
        `SELECT "id" FROM "FriendRequest" WHERE "id" = 'request-1' FOR UPDATE`,
      );
      const current = await tx.$queryRawUnsafe<Array<{ status: string }>>(
        `SELECT "status" FROM "FriendRequest" WHERE "id" = 'request-1'`,
      );
      if (current[0].status !== 'pending') return false;
      const participants = await tx.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS "count" FROM "User"
         WHERE "id" IN ('${route[0].senderId}', '${route[0].receiverId}')
           AND "accountStatus" = 'ACTIVE'
           AND "deletionRequestedAt" IS NULL`,
      );
      if (participants[0].count !== BigInt(2)) return false;
      await tx.$executeRawUnsafe(
        `UPDATE "FriendRequest" SET "status" = 'rejected'
         WHERE "id" = 'request-1' AND "status" = 'pending'`,
      );
      return true;
    });
    await rejectionHasRoute;

    let observedParticipantLockWait = false;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const activity = await admin.$queryRawUnsafe<Array<{
        waitEventType: string | null;
      }>>(`SELECT "wait_event_type" AS "waitEventType" FROM pg_stat_activity WHERE pid = ${rejectingBackendPid}`);
      if (activity[0]?.waitEventType === 'Lock') {
        observedParticipantLockWait = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    finishDeletion();

    await expect(Promise.all([deletion, rejection]))
      .resolves.toEqual([undefined, false]);
    expect(observedParticipantLockWait).toBe(true);
    const request = await admin.$queryRawUnsafe<Array<{ status: string }>>(
      `SELECT "status" FROM "${schema}"."FriendRequest" WHERE "id" = 'request-1'`,
    );
    expect(request[0].status).toBe('cancelled');
    const friendships = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS "count" FROM "${schema}"."Friendship"`,
    );
    expect(friendships[0].count).toBe(BigInt(0));
  });
});
