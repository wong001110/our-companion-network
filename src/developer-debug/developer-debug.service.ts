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
const MAX_TIMELINE_SIZE = 200;

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
  'client_secret',
  'access_token',
  'refresh_token',
]);

const REDACT_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/Cookie:\s*[^\r\n]*/gi, 'Cookie: [REDACTED]'],
  [/Set-Cookie:\s*[^\r\n]*/gi, 'Set-Cookie: [REDACTED]'],
  [/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: Bearer [REDACTED]'],
  [/Authorization:\s*Basic\s+\S+/gi, 'Authorization: Basic [REDACTED]'],
  [/Authorization:\s*(?!Bearer\s|Basic\s)\S+/gi, 'Authorization: [REDACTED]'],
  [/Bearer\s+\S+/gi, 'Bearer [REDACTED]'],
  [/\brefreshToken\s*[=:]\s*\S+/gi, 'refreshToken=[REDACTED]'],
  [/\brefresh_token\s*[=:]\s*\S+/gi, 'refresh_token=[REDACTED]'],
  [/\baccessToken\s*[=:]\s*\S+/gi, 'accessToken=[REDACTED]'],
  [/\baccess_token\s*[=:]\s*\S+/gi, 'access_token=[REDACTED]'],
  [/\bapiKey\s*[=:]\s*\S+/gi, 'apiKey=[REDACTED]'],
  [/\bapi_key\s*[=:]\s*\S+/gi, 'api_key=[REDACTED]'],
  [/\bclientSecret\s*[=:]\s*\S+/gi, 'clientSecret=[REDACTED]'],
  [/\bclient_secret\s*[=:]\s*\S+/gi, 'client_secret=[REDACTED]'],
  [/\bpassword\s*[=:]\s*\S+/gi, 'password=[REDACTED]'],
  [/eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]'],
];

export function sanitizeText(value: string): string {
  let result = value;
  for (const [pattern, replacement] of REDACT_TEXT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    result[key] = sanitizeValue(val);
  }
  return result;
}

interface DebugEventRow {
  id: string;
  clientEventId: string;
  userId: string;
  user?: { username: string } | null;
  deviceId: string;
  kind: string;
  operation: string | null;
  status: string | null;
  provider: string | null;
  model: string | null;
  companionId: string | null;
  correlationId: string | null;
  cycleId: string | null;
  turnId: string | null;
  summary: string | null;
  payload: Prisma.JsonValue;
  errorCode: string | null;
  errorMessage: string | null;
  clientCreatedAt: Date;
  receivedAt: Date;
  expiresAt: Date;
}

export interface DebugEventListResponse {
  id: string;
  kind: string;
  operation: string | null;
  status: string | null;
  userId: string;
  username: string | undefined;
  deviceId: string;
  provider: string | null;
  model: string | null;
  correlationId: string | null;
  cycleId: string | null;
  turnId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  receivedAt: string;
  expiresAt: string;
}

export interface DebugEventDetailResponse {
  id: string;
  clientEventId: string;
  kind: string;
  operation: string | null;
  status: string | null;
  userId: string;
  deviceId: string;
  provider: string | null;
  model: string | null;
  companionId: string | null;
  correlationId: string | null;
  cycleId: string | null;
  turnId: string | null;
  summary: string | null;
  payload: Prisma.JsonValue;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  receivedAt: string;
  expiresAt: string;
  relatedEvents: DebugTimelineItem[];
}

export interface DebugTimelineItem {
  id: string;
  kind: string;
  operation: string | null;
  status: string | null;
  summary: string | null;
  errorMessage: string | null;
  createdAt: string;
}

function toDebugEventDetailResponse(event: DebugEventRow): DebugEventDetailResponse {
  return {
    id: event.id,
    clientEventId: event.clientEventId,
    kind: event.kind,
    operation: event.operation,
    status: event.status,
    userId: event.userId,
    deviceId: event.deviceId,
    provider: event.provider,
    model: event.model,
    companionId: event.companionId,
    correlationId: event.correlationId,
    cycleId: event.cycleId,
    turnId: event.turnId,
    summary: event.summary,
    payload: event.payload,
    errorCode: event.errorCode,
    errorMessage: event.errorMessage,
    createdAt: event.clientCreatedAt.toISOString(),
    receivedAt: event.receivedAt.toISOString(),
    expiresAt: event.expiresAt.toISOString(),
    relatedEvents: [],
  };
}

function toDebugTimelineItem(row: { id: string; kind: string; operation: string | null; status: string | null; summary: string | null; errorMessage: string | null; clientCreatedAt: Date }): DebugTimelineItem {
  return {
    id: row.id,
    kind: row.kind,
    operation: row.operation,
    status: row.status,
    summary: row.summary,
    errorMessage: row.errorMessage,
    createdAt: row.clientCreatedAt.toISOString(),
  };
}

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
        const sanitizedSummary = event.summary ? sanitizeText(event.summary) : event.summary;
        const sanitizedErrorMessage = this.sanitizeErrorMessage(event.errorMessage);
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
            summary: sanitizedSummary,
            payload: redactedPayload as Prisma.InputJsonValue,
            errorCode: event.errorCode,
            errorMessage: sanitizedErrorMessage,
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
            summary: sanitizedSummary,
            payload: redactedPayload as Prisma.InputJsonValue,
            errorCode: event.errorCode,
            errorMessage: sanitizedErrorMessage,
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

    const rows = await this.prisma.developerDebugEvent.findMany({
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

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? sliced[sliced.length - 1]?.id : null;

    const items: DebugEventListResponse[] = sliced.map((row) => ({
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

  async getEvent(id: string, adminUserId?: string): Promise<DebugEventDetailResponse> {
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

    const relatedRows = event.correlationId || event.cycleId
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
          take: MAX_TIMELINE_SIZE - 1,
        })
      : [];

    const currentTimelineItem = toDebugTimelineItem({
      id: event.id,
      kind: event.kind,
      operation: event.operation,
      status: event.status,
      summary: event.summary,
      errorMessage: event.errorMessage,
      clientCreatedAt: event.clientCreatedAt,
    });

    const relatedTimeline = relatedRows.map(toDebugTimelineItem);
    const timeline = [currentTimelineItem, ...relatedTimeline]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .slice(0, MAX_TIMELINE_SIZE);

    const response = toDebugEventDetailResponse(event);
    response.relatedEvents = timeline;
    return response;
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

  sanitizeErrorMessage(message: string | undefined): string | undefined {
    if (!message) return undefined;
    return sanitizeText(message).slice(0, 1000);
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
      } else if (typeof value === 'string') {
        result[key] = sanitizeText(value);
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.redactObject(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        result[key] = value.map((item) => {
          if (item && typeof item === 'object') {
            if (Array.isArray(item)) return item.map((i) => i && typeof i === 'object' ? this.redactObject(i as Record<string, unknown>) : i);
            return this.redactObject(item as Record<string, unknown>);
          }
          if (typeof item === 'string') return sanitizeText(item);
          return item;
        });
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
