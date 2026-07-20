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
    const service = new DeveloperDebugService(prisma as never);
    return { service, prisma };
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
        deviceId: 'device-1',
        kind: 'test',
        payload: {},
        clientCreatedAt: new Date().toISOString(),
      }));
      await expect(
        service.ingestBatch('user-1', 'device-1', events),
      ).rejects.toMatchObject({ response: { code: 'BATCH_TOO_LARGE' } });
    });

    it('upserts events idempotently by (userId, clientEventId)', async () => {
      const upsert = jest.fn().mockResolvedValue({ id: 'evt-1' });
      const $transaction = jest.fn((promises: unknown[]) =>
        Promise.all(promises as Promise<unknown>[]),
      );
      const { service } = createService({
        developerDebugEvent: { upsert },
        $transaction,
      });

      const events = [
        {
          clientEventId: 'evt-1',
          deviceId: 'device-1',
          kind: 'llm_request',
          operation: 'chat',
          status: 'success',
          provider: 'openai',
          model: 'gpt-4',
          payload: { prompt: 'hello' },
          clientCreatedAt: new Date().toISOString(),
        },
      ];

      const result = await service.ingestBatch('user-1', 'device-1', events);
      expect(result.accepted).toBe(1);
      expect(result.expiresAt).toBeInstanceOf(Date);
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId_clientEventId: {
              userId: 'user-1',
              clientEventId: 'evt-1',
            },
          },
        }),
      );
    });

    it('assigns 14-day retention expiry', async () => {
      const upsert = jest.fn().mockResolvedValue({ id: 'evt-1' });
      const $transaction = jest.fn((promises: unknown[]) =>
        Promise.all(promises as Promise<unknown>[]),
      );
      const { service } = createService({
        developerDebugEvent: { upsert },
        $transaction,
      });

      const before = Date.now();
      const result = await service.ingestBatch('user-1', 'device-1', [
        {
          clientEventId: 'evt-1',
          deviceId: 'device-1',
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
        { id: 'evt-1', kind: 'test' },
        { id: 'evt-2', kind: 'test' },
      ]);
      const prisma = {
        developerDebugEvent: { findMany },
        $transaction: jest.fn(async (fn: unknown) =>
          (fn as (c: unknown) => unknown)(prisma),
        ),
      } as never;
      const service = new DeveloperDebugService(prisma);

      const result = await service.listEvents({
        limit: 10,
        sortBy: 'receivedAt',
        sortDir: 'desc',
      } as never);

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it('indicates hasMore when results exceed limit', async () => {
      const items = Array.from({ length: 11 }, (_, i) => ({
        id: `evt-${i}`,
        kind: 'test',
      }));
      const findMany = jest.fn().mockResolvedValue(items);
      const prisma = {
        developerDebugEvent: { findMany },
        $transaction: jest.fn(async (fn: unknown) =>
          (fn as (c: unknown) => unknown)(prisma),
        ),
      } as never;
      const service = new DeveloperDebugService(prisma);

      const result = await service.listEvents({
        limit: 10,
        sortBy: 'receivedAt',
        sortDir: 'desc',
      } as never);

      expect(result.items).toHaveLength(10);
      expect(result.hasMore).toBe(true);
      expect(result.nextCursor).toBe('evt-9');
    });

    it('filters by kind and correlationId', async () => {
      const findMany = jest.fn().mockResolvedValue([]);
      const prisma = {
        developerDebugEvent: { findMany },
        $transaction: jest.fn(async (fn: unknown) =>
          (fn as (c: unknown) => unknown)(prisma),
        ),
      } as never;
      const service = new DeveloperDebugService(prisma);

      await service.listEvents({
        limit: 50,
        kind: 'llm_request',
        correlationId: 'corr-1',
        sortBy: 'receivedAt',
        sortDir: 'desc',
      } as never);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            kind: 'llm_request',
            correlationId: 'corr-1',
          }),
        }),
      );
    });
  });

  describe('getEvent', () => {
    it('returns a single event', async () => {
      const findUnique = jest.fn().mockResolvedValue({
        id: 'evt-1',
        kind: 'test',
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
