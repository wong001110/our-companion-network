import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../admin/audit.service';
import {
  AdminDebugEventQueryDto,
  BatchIngestEventDto,
  DebugEventSortField,
} from './dto/developer-debug.dto';

const RETENTION_DAYS = 14;
const MAX_BATCH_SIZE = 50;
const BOUNDED_PRUNE_LIMIT = 100;

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async ingestBatch(
    userId: string,
    authenticatedDeviceId: string,
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

    for (const event of events) {
      if (
        event.payload === null ||
        Array.isArray(event.payload) ||
        typeof event.payload !== 'object'
      ) {
        throw new BadRequestException({
          code: 'INVALID_PAYLOAD',
          message: `Event ${event.clientEventId}: payload must be a non-null object`,
        });
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const results = await this.prisma.$transaction(
      events.map((event) => {
        const redactedPayload = this.buildRedactedPayload(event.payload);
        return this.prisma.developerDebugEvent.upsert({
          where: {
            userId_clientEventId: {
              userId,
              clientEventId: event.clientEventId,
            },
          },
          create: {
            clientEventId: event.clientEventId,
            userId,
            deviceId: authenticatedDeviceId,
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
            payload: redactedPayload as Prisma.InputJsonValue,
            errorCode: event.errorCode,
            errorMessage: this.sanitizeErrorMessage(event.errorMessage),
            clientCreatedAt: new Date(event.clientCreatedAt),
            receivedAt: now,
            expiresAt,
          },
          update: {
            deviceId: authenticatedDeviceId,
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
            payload: redactedPayload as Prisma.InputJsonValue,
            errorCode: event.errorCode,
            errorMessage: this.sanitizeErrorMessage(event.errorMessage),
          },
        });
      }),
    );

    this.logger.log(
      `Ingested ${results.length} debug events for user ${userId}`,
    );

    void this.pruneExpiredBounded();

    return {
      accepted: results.length,
      expiresAt,
    };
  }

  async listEvents(filters: AdminDebugEventQueryDto) {
    const limit = Math.min(filters.limit, 100);

    const where: Prisma.DeveloperDebugEventWhereInput = {
      expiresAt: { gt: new Date() },
    };

    if (filters.search) {
      where.OR = [
        { summary: { contains: filters.search, mode: 'insensitive' } },
        { operation: { contains: filters.search, mode: 'insensitive' } },
        { correlationId: { contains: filters.search, mode: 'insensitive' } },
        { cycleId: { contains: filters.search, mode: 'insensitive' } },
        { errorCode: { contains: filters.search, mode: 'insensitive' } },
        { errorMessage: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    if (filters.userId) where.userId = filters.userId;
    if (filters.deviceId) where.deviceId = filters.deviceId;
    if (filters.kind) where.kind = filters.kind;
    if (filters.operation) where.operation = filters.operation;
    if (filters.status) where.status = filters.status;
    if (filters.provider) where.provider = filters.provider;
    if (filters.correlationId) where.correlationId = filters.correlationId;
    if (filters.cycleId) where.cycleId = filters.cycleId;
    if (filters.turnId) where.turnId = filters.turnId;
    if (filters.from || filters.to) {
      where.clientCreatedAt = {};
      if (filters.from) where.clientCreatedAt.gte = new Date(filters.from);
      if (filters.to) where.clientCreatedAt.lte = new Date(filters.to);
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

    const rows = await this.prisma.$transaction(async (tx) => {
      const r = await tx.developerDebugEvent.findMany({
        where,
        orderBy,
        take: limit + 1,
        ...(cursor ? { cursor, skip: 1 } : {}),
        select: {
          id: true,
          clientEventId: true,
          userId: true,
          user: { select: { username: true } },
          deviceId: true,
          kind: true,
          operation: true,
          status: true,
          provider: true,
          model: true,
          correlationId: true,
          cycleId: true,
          turnId: true,
          errorCode: true,
          errorMessage: true,
          clientCreatedAt: true,
          receivedAt: true,
          expiresAt: true,
        },
      });

      return r;
    });

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : null;

    const items = sliced.map((row) => ({
      id: row.id,
      kind: row.kind,
      operation: row.operation,
      status: row.status,
      userId: row.userId,
      username: row.user?.username,
      deviceId: row.deviceId,
      provider: row.provider,
      model: row.model,
      correlationId: row.correlationId,
      cycleId: row.cycleId,
      turnId: row.turnId,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      createdAt: row.clientCreatedAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    }));

    void this.pruneExpiredBounded();

    return {
      items,
      nextCursor,
      hasMore: nextCursor !== null,
    };
  }

  async getEvent(id: string, adminUserId?: string) {
    const event = await this.prisma.developerDebugEvent.findUnique({
      where: { id },
    });
    if (!event) {
      throw new NotFoundException({
        code: 'DEBUG_EVENT_NOT_FOUND',
        message: 'Debug event not found',
      });
    }
    if (event.expiresAt <= new Date()) {
      throw new NotFoundException({
        code: 'DEBUG_EVENT_NOT_FOUND',
        message: 'Debug event not found',
      });
    }

    if (adminUserId) {
      void this.auditService.record({
        adminUserId,
        action: 'developer_debug_event_viewed',
        targetType: 'DeveloperDebugEvent',
        targetId: id,
        metadata: {
          eventId: id,
          kind: event.kind,
          userId: event.userId,
        } as Prisma.InputJsonValue,
      });
    }

    const now = new Date();
    const relatedWhere: Prisma.DeveloperDebugEventWhereInput = {
      userId: event.userId,
      expiresAt: { gt: now },
      id: { not: id },
      ...(event.correlationId
        ? { correlationId: event.correlationId }
        : event.cycleId
          ? { cycleId: event.cycleId }
          : {}),
    };

    const relatedEvents = event.correlationId || event.cycleId
      ? await this.prisma.developerDebugEvent.findMany({
          where: relatedWhere,
          select: {
            id: true,
            kind: true,
            operation: true,
            status: true,
            summary: true,
            clientCreatedAt: true,
            errorMessage: true,
          },
          orderBy: { clientCreatedAt: 'asc' },
          take: 200,
        })
      : [];

    const currentEvent = {
      id: event.id,
      kind: event.kind,
      operation: event.operation,
      status: event.status,
      summary: event.summary,
      clientCreatedAt: event.clientCreatedAt,
      errorMessage: event.errorMessage,
    };

    return {
      ...event,
      relatedEvents: [currentEvent, ...relatedEvents].sort(
        (a, b) => a.clientCreatedAt.getTime() - b.clientCreatedAt.getTime(),
      ),
    };
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

  async pruneExpiredBounded() {
    try {
      const now = new Date();
      const expired = await this.prisma.developerDebugEvent.findMany({
        where: { expiresAt: { lt: now } },
        select: { id: true },
        take: BOUNDED_PRUNE_LIMIT,
      });
      if (expired.length === 0) return { pruned: 0 };

      const ids = expired.map((e) => e.id);
      const result = await this.prisma.developerDebugEvent.deleteMany({
        where: { id: { in: ids } },
      });
      if (result.count > 0) {
        this.logger.log(`Opportunistically pruned ${result.count} expired debug events`);
      }
      return { pruned: result.count };
    } catch {
      return { pruned: 0 };
    }
  }

  async recordExportAudit(adminUserId: string, eventId: string, event: { kind: string; userId: string }) {
    void this.auditService.record({
      adminUserId,
      action: 'developer_debug_event_exported',
      targetType: 'DeveloperDebugEvent',
      targetId: eventId,
      metadata: {
        eventId,
        kind: event.kind,
        userId: event.userId,
      } as Prisma.InputJsonValue,
    });
  }

  async recordExpiredDeleteAudit(adminUserId: string, count: number) {
    void this.auditService.record({
      adminUserId,
      action: 'developer_debug_events_expired_deleted',
      targetType: 'DeveloperDebugEvent',
      metadata: {
        count,
      } as Prisma.InputJsonValue,
    });
  }

  private sanitizeErrorMessage(message: string | undefined): string | undefined {
    if (!message) return undefined;
    let result = message;
    result = result.replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
    result = result.replace(/Authorization:\s*\S+/gi, 'Authorization: [REDACTED]');
    result = result.replace(/Cookie:\s*[^;\s]+/gi, 'Cookie: [REDACTED]');
    result = result.replace(/refreshToken\s*[=:]\s*\S+/gi, 'refreshToken=[REDACTED]');
    result = result.replace(/apiKey\s*[=:]\s*\S+/gi, 'apiKey=[REDACTED]');
    return result.slice(0, 1000);
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
