import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminDebugEventQueryDto,
  BatchIngestEventDto,
  DebugEventSortField,
} from './dto/developer-debug.dto';

const RETENTION_DAYS = 14;
const MAX_BATCH_SIZE = 50;
const MAX_PAYLOAD_BYTES = 64 * 1024;

const SENSITIVE_KEYS = new Set([
  'authorization',
  'apikey',
  'api_key',
  'token',
  'accesstoken',
  'refreshtoken',
  'password',
  'cookie',
  'set-cookie',
  'secret',
  'clientsecret',
]);

@Injectable()
export class DeveloperDebugService {
  private readonly logger = new Logger(DeveloperDebugService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ingestBatch(
    userId: string,
    deviceId: string,
    events: BatchIngestEventDto[],
  ) {
    if (events.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_BATCH',
        message: 'Batch must contain at least one event',
      });
    }
    if (events.length > MAX_BATCH_SIZE) {
      throw new BadRequestException({
        code: 'BATCH_TOO_LARGE',
        message: `Maximum batch size is ${MAX_BATCH_SIZE}`,
      });
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const results = await this.prisma.$transaction(
      events.map((event) =>
        this.prisma.developerDebugEvent.upsert({
          where: {
            userId_clientEventId: {
              userId,
              clientEventId: event.clientEventId,
            },
          },
          create: {
            clientEventId: event.clientEventId,
            userId,
            deviceId: event.deviceId,
            kind: event.kind,
            operation: event.operation,
            status: event.status,
            provider: event.provider,
            model: event.model,
            companionId: event.companionId,
            correlationId: event.correlationId,
            cycleId: event.cycleId,
            turnId: event.turnId,
            summary: event.summary,
            payload: event.payload as Prisma.InputJsonValue,
            errorCode: event.errorCode,
            clientCreatedAt: new Date(event.clientCreatedAt),
            receivedAt: now,
            expiresAt,
          },
          update: {
            deviceId: event.deviceId,
            kind: event.kind,
            operation: event.operation,
            status: event.status,
            provider: event.provider,
            model: event.model,
            companionId: event.companionId,
            correlationId: event.correlationId,
            cycleId: event.cycleId,
            turnId: event.turnId,
            summary: event.summary,
            payload: event.payload as Prisma.InputJsonValue,
            errorCode: event.errorCode,
          },
        }),
      ),
    );

    this.logger.log(
      `Ingested ${results.length} debug events for user ${userId}`,
    );

    return {
      accepted: results.length,
      expiresAt,
    };
  }

  async listEvents(filters: AdminDebugEventQueryDto) {
    const limit = Math.min(filters.limit, 100);

    const where: Prisma.DeveloperDebugEventWhereInput = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.kind) where.kind = filters.kind;
    if (filters.correlationId) where.correlationId = filters.correlationId;
    if (filters.cycleId) where.cycleId = filters.cycleId;
    if (filters.from || filters.to) {
      where.receivedAt = {};
      if (filters.from) where.receivedAt.gte = new Date(filters.from);
      if (filters.to) where.receivedAt.lte = new Date(filters.to);
    }

    const orderByField =
      filters.sortBy === DebugEventSortField.CLIENT_CREATED_AT
        ? 'clientCreatedAt'
        : 'receivedAt';

    const orderBy: Prisma.DeveloperDebugEventOrderByWithRelationInput = {
      [orderByField]: filters.sortDir,
      id: filters.sortDir,
    };

    const cursor = filters.cursor
      ? { id: filters.cursor }
      : undefined;

    const [items, nextCursor] = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.developerDebugEvent.findMany({
        where,
        orderBy,
        take: limit + 1,
        ...(cursor ? { cursor, skip: 1 } : {}),
        select: {
          id: true,
          clientEventId: true,
          userId: true,
          deviceId: true,
          kind: true,
          operation: true,
          status: true,
          provider: true,
          model: true,
          companionId: true,
          correlationId: true,
          cycleId: true,
          turnId: true,
          summary: true,
          errorCode: true,
          clientCreatedAt: true,
          receivedAt: true,
          expiresAt: true,
        },
      });

      const hasMore = rows.length > limit;
      const sliced = hasMore ? rows.slice(0, limit) : rows;
      const next = hasMore ? sliced[sliced.length - 1]?.id : null;

      return [sliced, next] as const;
    });

    return {
      items,
      nextCursor,
      hasMore: nextCursor !== null,
    };
  }

  async getEvent(id: string) {
    const event = await this.prisma.developerDebugEvent.findUnique({
      where: { id },
    });
    if (!event) {
      throw new NotFoundException({
        code: 'DEBUG_EVENT_NOT_FOUND',
        message: 'Debug event not found',
      });
    }
    return event;
  }

  async pruneExpired() {
    const now = new Date();
    const result = await this.prisma.developerDebugEvent.deleteMany({
      where: {
        expiresAt: { lt: now },
      },
    });
    this.logger.log(`Pruned ${result.count} expired debug events`);
    return { pruned: result.count };
  }

  buildRedactedPayload(payload: Record<string, unknown>): Record<string, unknown> {
    return this.redactObject(payload);
  }

  private redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey)) {
        result[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.redactObject(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          item && typeof item === 'object'
            ? this.redactObject(item as Record<string, unknown>)
            : item,
        );
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
