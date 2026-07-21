import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DeveloperDebugService } from './developer-debug.service';

describe('DeveloperDebugService', () => {
  function createService(overrides: Record<string, unknown> = {}) {
    const prisma = {
      developerDebugEvent: {
        upsert: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
      },
      $transaction: jest.fn(),
      ...overrides,
    };
    const auditService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    const service = new DeveloperDebugService(prisma as never, auditService as never);
    return { service, prisma, auditService };
  }

  describe('ingestBatch', () => {
    it('rejects empty batches', async () => {
      const { service } = createService();
      await expect(
        service.ingestBatch('user-1', 'device-1', []),
      ).rejects.toMatchObject({ response: { code: 'EMPTY_BATCH' } });
    });

    it('rejects batches exceeding 50 events', async () => {
      const { service } = createService();
      const events = Array.from({ length: 51 }, (_, i) => ({
        clientEventId: `evt-${i}`,
        kind: 'test',
        payload: {},
        clientCreatedAt: new Date().toISOString(),
      }));
      await expect(
        service.ingestBatch('user-1', 'device-1', events),
      ).rejects.toMatchObject({ response: { code: 'BATCH_TOO_LARGE' } });
    });

    it('rejects non-object payloads', async () => {
      const { service } = createService();
      await expect(
        service.ingestBatch('user-1', 'device-1', [
          {
            clientEventId: 'evt-1',
            kind: 'test',
            payload: null as never,
            clientCreatedAt: new Date().toISOString(),
          },
        ]),
      ).rejects.toMatchObject({ response: { code: 'INVALID_PAYLOAD' } });
    });

    it('rejects array payloads', async () => {
      const { service } = createService();
      await expect(
        service.ingestBatch('user-1', 'device-1', [
          {
            clientEventId: 'evt-1',
            kind: 'test',
            payload: [1, 2, 3] as never,
            clientCreatedAt: new Date().toISOString(),
          },
        ]),
      ).rejects.toMatchObject({ response: { code: 'INVALID_PAYLOAD' } });
    });

    it('upserts events using authenticated deviceId, not event.deviceId', async () => {
      const upsert = jest.fn().mockResolvedValue({ id: 'evt-1' });
      const $transaction = jest.fn((promises: unknown[]) =>
        Promise.all(promises as Promise<unknown>[]),
      );
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const { service } = createService({
        developerDebugEvent: { upsert, deleteMany },
        $transaction,
      });

      const events = [
        {
          clientEventId: 'evt-1',
          kind: 'llm_request',
          operation: 'chat',
          status: 'success',
          provider: 'openai',
          model: 'gpt-4',
          payload: { prompt: 'hello' },
          clientCreatedAt: new Date().toISOString(),
        },
      ];

      const result = await service.ingestBatch('user-1', 'jwt-device-1', events);
      expect(result.accepted).toBe(1);

      const upsertCall = upsert.mock.calls[0][0];
      expect(upsertCall.create.deviceId).toBe('jwt-device-1');
      expect(upsertCall.update.deviceId).toBe('jwt-device-1');
    });

    it('redacts payload before persistence', async () => {
      const upsert = jest.fn().mockResolvedValue({ id: 'evt-1' });
      const $transaction = jest.fn((promises: unknown[]) =>
        Promise.all(promises as Promise<unknown>[]),
      );
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const { service } = createService({
        developerDebugEvent: { upsert, deleteMany },
        $transaction,
      });

      const events = [
        {
          clientEventId: 'evt-1',
          kind: 'llm_request',
          payload: { authorization: 'Bearer secret', safe: 'ok' },
          clientCreatedAt: new Date().toISOString(),
        },
      ];

      await service.ingestBatch('user-1', 'device-1', events);

      const upsertCall = upsert.mock.calls[0][0];
      expect(upsertCall.create.payload).toEqual({
        authorization: '[REDACTED]',
        safe: 'ok',
      });
      expect(upsertCall.update.payload).toEqual({
        authorization: '[REDACTED]',
        safe: 'ok',
      });
    });

    it('assigns 14-day retention expiry', async () => {
      const upsert = jest.fn().mockResolvedValue({ id: 'evt-1' });
      const $transaction = jest.fn((promises: unknown[]) =>
        Promise.all(promises as Promise<unknown>[]),
      );
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const { service } = createService({
        developerDebugEvent: { upsert, deleteMany },
        $transaction,
      });

      const before = Date.now();
      const result = await service.ingestBatch('user-1', 'device-1', [
        {
          clientEventId: 'evt-1',
          kind: 'test',
          payload: {},
          clientCreatedAt: new Date().toISOString(),
        },
      ]);
      const after = Date.now();

      const expectedMin = before + 14 * 24 * 60 * 60 * 1000;
      const expectedMax = after + 14 * 24 * 60 * 60 * 1000;
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(expectedMin);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(expectedMax);
    });
  });

  describe('listEvents', () => {
    it('returns paginated results with cursor', async () => {
      const findMany = jest.fn().mockResolvedValue([
        { id: 'evt-1', kind: 'test', user: { username: 'alice' }, clientCreatedAt: new Date(), receivedAt: new Date(), expiresAt: new Date() },
        { id: 'evt-2', kind: 'test', user: { username: 'bob' }, clientCreatedAt: new Date(), receivedAt: new Date(), expiresAt: new Date() },
      ]);
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const prisma = {
        developerDebugEvent: { findMany, deleteMany },
        $transaction: jest.fn(async (fn: unknown) =>
          (fn as (c: unknown) => unknown)(prisma),
        ),
      } as never;
      const service = new DeveloperDebugService(prisma, { record: jest.fn() } as never);

      const result = await service.listEvents({
        limit: 10,
        sortBy: 'receivedAt',
        sortDir: 'desc',
      } as never);

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
      expect(result.items[0]).toHaveProperty('username');
    });

    it('indicates hasMore when results exceed limit', async () => {
      const items = Array.from({ length: 11 }, (_, i) => ({
        id: `evt-${i}`,
        kind: 'test',
        user: { username: `user${i}` },
        clientCreatedAt: new Date(),
        receivedAt: new Date(),
        expiresAt: new Date(),
      }));
      const findMany = jest.fn().mockResolvedValue(items);
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const prisma = {
        developerDebugEvent: { findMany, deleteMany },
        $transaction: jest.fn(async (fn: unknown) =>
          (fn as (c: unknown) => unknown)(prisma),
        ),
      } as never;
      const service = new DeveloperDebugService(prisma, { record: jest.fn() } as never);

      const result = await service.listEvents({
        limit: 10,
        sortBy: 'receivedAt',
        sortDir: 'desc',
      } as never);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('evt-9');
    });

    it('filters by kind, deviceId, operation, status, provider', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = {
        developerDebugEvent: { findMany, deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        $transaction: jest.fn(async (fn: unknown) =>
          (fn as (c: unknown) => unknown)(prisma),
        ),
      } as never;
      const service = new DeveloperDebugService(prisma, { record: jest.fn() } as never);

      await service.listEvents({
        limit: 50,
        kind: 'llm_request',
        deviceId: 'dev-1',
        operation: 'chat',
        status: 'success',
        provider: 'openai',
        correlationId: 'corr-1',
        sortBy: 'receivedAt',
        sortDir: 'desc',
      } as never);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            kind: 'llm_request',
            deviceId: 'dev-1',
            operation: 'chat',
            status: 'success',
            provider: 'openai',
            correlationId: 'corr-1',
            expiresAt: { gt: expect.any(Date) },
          }),
        }),
      );
    });

    it('excludes expired records', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = {
        developerDebugEvent: { findMany, deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        $transaction: jest.fn(async (fn: unknown) =>
          (fn as (c: unknown) => unknown)(prisma),
        ),
      } as never;
      const service = new DeveloperDebugService(prisma, { record: jest.fn() } as never);

      await service.listEvents({
        limit: 50,
        sortBy: 'receivedAt',
        sortDir: 'desc',
      } as never);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expiresAt: { gt: expect.any(Date) },
          }),
        }),
      );
    });

    it('does not return total in response', async () => {
      const findMany = jest.fn().mockResolvedValue([
        { id: 'evt-1', kind: 'test', user: null, clientCreatedAt: new Date(), receivedAt: new Date(), expiresAt: new Date() },
      ]);
      const prisma = {
        developerDebugEvent: { findMany, deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        $transaction: jest.fn(async (fn: unknown) =>
          (fn as (c: unknown) => unknown)(prisma),
        ),
      } as never;
      const service = new DeveloperDebugService(prisma, { record: jest.fn() } as never);

      const result = await service.listEvents({
        limit: 10,
        sortBy: 'receivedAt',
        sortDir: 'desc',
      } as never);

      expect(result).not.toHaveProperty('total');
      expect(result).toHaveProperty('items');
      expect(result).toHaveProperty('nextCursor');
      expect(result).toHaveProperty('hasMore');
    });
  });

  describe('getEvent', () => {
    it('returns a single event', async () => {
      const findUnique = jest.fn().mockResolvedValue({
        id: 'evt-1',
        kind: 'test',
        expiresAt: new Date(Date.now() + 86400000),
      });
      const { service } = createService({
        developerDebugEvent: { findUnique },
      });

      const result = await service.getEvent('evt-1');
      expect(result.id).toBe('evt-1');
    });

    it('throws NotFoundException for missing event', async () => {
      const findUnique = jest.fn().mockResolvedValue(null);
      const { service } = createService({
        developerDebugEvent: { findUnique },
      });

      await expect(service.getEvent('missing')).rejects.toMatchObject({
        response: { code: 'DEBUG_EVENT_NOT_FOUND' },
      });
    });

    it('throws NotFoundException for expired event', async () => {
      const findUnique = jest.fn().mockResolvedValue({
        id: 'evt-1',
        kind: 'test',
        expiresAt: new Date(Date.now() - 1000),
      });
      const { service } = createService({
        developerDebugEvent: { findUnique },
      });

      await expect(service.getEvent('evt-1')).rejects.toMatchObject({
        response: { code: 'DEBUG_EVENT_NOT_FOUND' },
      });
    });

    it('records audit when adminUserId is provided', async () => {
      const findUnique = jest.fn().mockResolvedValue({
        id: 'evt-1',
        kind: 'test',
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 86400000),
      });
      const { service, auditService } = createService({
        developerDebugEvent: { findUnique },
      });

      await service.getEvent('evt-1', 'admin-1');
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          adminUserId: 'admin-1',
          action: 'developer_debug_event_viewed',
          targetType: 'DeveloperDebugEvent',
          targetId: 'evt-1',
        }),
      );
    });
  });

  describe('pruneExpired', () => {
    it('deletes expired events and returns count', async () => {
      const deleteMany = jest.fn().mockResolvedValue({ count: 5 });
      const { service } = createService({
        developerDebugEvent: { deleteMany },
      });

      const result = await service.pruneExpired();
      expect(result.pruned).toBe(5);
      expect(deleteMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) } },
      });
    });
  });

  describe('buildRedactedPayload', () => {
    it('redacts sensitive keys case-insensitively', () => {
      const { service } = createService();
      const payload = {
        authorization: 'Bearer secret-token',
        API_KEY: 'sk-123',
        Token: 'abc',
        safeKey: 'visible',
        nested: {
          password: 'hunter2',
          Cookie: 'session=xyz',
          normal: 'keep',
        },
        headers: [
          { 'Set-Cookie': 'a=b', Authorization: 'Bearer x' },
        ],
      };

      const redacted = service.buildRedactedPayload(payload);
      expect(redacted.authorization).toBe('[REDACTED]');
      expect(redacted.API_KEY).toBe('[REDACTED]');
      expect(redacted.Token).toBe('[REDACTED]');
      expect(redacted.safeKey).toBe('visible');
      expect((redacted.nested as Record<string, unknown>).password).toBe('[REDACTED]');
      expect((redacted.nested as Record<string, unknown>).Cookie).toBe('[REDACTED]');
      expect((redacted.nested as Record<string, unknown>).normal).toBe('keep');
      expect((redacted.headers as Record<string, unknown>[])[0]['Set-Cookie']).toBe('[REDACTED]');
      expect((redacted.headers as Record<string, unknown>[])[0]['Authorization']).toBe('[REDACTED]');
    });

    it('preserves non-sensitive values', () => {
      const { service } = createService();
      const payload = {
        kind: 'llm_request',
        status: 'success',
        count: 42,
        tags: ['a', 'b'],
      };

      const redacted = service.buildRedactedPayload(payload);
      expect(redacted).toEqual(payload);
    });
  });
});
