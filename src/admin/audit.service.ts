import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PagePaginationDto, SortDirection } from '../common/dto/pagination.dto';
import { boundedPage, pageEnvelope, stableOrderBy } from '../common/pagination';
import { AdminListQueryDto } from './dto/admin-api.dto';

export const ADMIN_AUDIT_ACTIONS = {
  ADMIN_LOGIN: 'ADMIN_LOGIN',
  VIEW_SENSITIVE_ACCOUNT: 'VIEW_SENSITIVE_ACCOUNT',
  REVOKE_DEVICE_SESSION: 'REVOKE_DEVICE_SESSION',
  SUSPEND_ACCOUNT: 'SUSPEND_ACCOUNT',
  RESTORE_ACCOUNT: 'RESTORE_ACCOUNT',
  UNPUBLISH_COMPANION: 'UNPUBLISH_COMPANION',
  END_VISIT_SESSION: 'END_VISIT_SESSION',
  RECONCILE_VISIT_SESSION: 'RECONCILE_VISIT_SESSION',
  CANCEL_VISIT_INVITATION: 'CANCEL_VISIT_INVITATION',
  DELETE_ASSET_PACK: 'DELETE_ASSET_PACK',
  RUN_STORAGE_CLEANUP: 'RUN_STORAGE_CLEANUP',
  PROMOTE_ADMIN: 'PROMOTE_ADMIN',
  DEMOTE_ADMIN: 'DEMOTE_ADMIN',
} as const;

export type AdminAuditAction =
  typeof ADMIN_AUDIT_ACTIONS[keyof typeof ADMIN_AUDIT_ACTIONS];

export interface AuditWrite {
  adminUserId: string;
  action: AdminAuditAction | string;
  targetType: string;
  targetId?: string;
  reason?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddressHash?: string;
}

type AuditClient = Pick<Prisma.TransactionClient, 'adminAuditLog'>;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: AuditWrite, client: AuditClient = this.prisma) {
    return client.adminAuditLog.create({
      data: {
        adminUserId: input.adminUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        reason: input.reason,
        metadata: input.metadata,
        ipAddressHash: input.ipAddressHash,
      },
    });
  }

  async list(query: AdminListQueryDto | PagePaginationDto = new PagePaginationDto()) {
    const page = boundedPage(query);
    const filters = query as AdminListQueryDto;
    const where: Prisma.AdminAuditLogWhereInput = {
      ...(filters.status ? { action: filters.status } : {}),
      ...(filters.search ? {
        OR: [
          { action: { contains: filters.search, mode: 'insensitive' } },
          { targetType: { contains: filters.search, mode: 'insensitive' } },
          { targetId: { contains: filters.search, mode: 'insensitive' } },
          { adminUserId: { contains: filters.search, mode: 'insensitive' } },
          { reason: { contains: filters.search, mode: 'insensitive' } },
        ],
      } : {}),
      ...((filters.dateFrom || filters.dateTo) ? {
        createdAt: {
          ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
          ...(filters.dateTo ? { lte: endOfDate(filters.dateTo) } : {}),
        },
      } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.adminAuditLog.findMany({
        where,
        skip: page.skip,
        take: page.take,
        orderBy: stableOrderBy('createdAt', SortDirection.DESC),
      }),
      this.prisma.adminAuditLog.count({ where }),
    ]);
    return pageEnvelope(items, total, page);
  }
}

function endOfDate(value: string): Date {
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }
  return date;
}
