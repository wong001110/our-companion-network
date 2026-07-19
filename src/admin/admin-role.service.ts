import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserAccountStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_AUDIT_ACTIONS, AuditService } from './audit.service';

export interface AdminRoleChangeInput {
  targetUid: string;
  reason: string;
  actorUserId?: string;
  metadata?: Prisma.InputJsonObject;
}

@Injectable()
export class AdminRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findTargetByUid(uid: string) {
    return this.prisma.user.findUnique({
      where: { uid: uid.trim().toUpperCase() },
      select: {
        id: true,
        uid: true,
        email: true,
        username: true,
        role: true,
      },
    });
  }

  async promote(input: AdminRoleChangeInput) {
    const reason = this.requireReason(input.reason);
    return this.prisma.$transaction(async (tx) => {
      await this.lockRoleChanges(tx);
      const target = await this.lockTarget(tx, input.targetUid);
      const auditActorId = await this.requireActorOrBootstrap(
        tx,
        input.actorUserId,
        target.id,
      );
      if (target.role === UserRole.SUPERADMIN) {
        return { changed: false, user: target };
      }

      const user = await tx.user.update({
        where: { id: target.id },
        data: { role: UserRole.SUPERADMIN },
        select: { id: true, uid: true, email: true, username: true, role: true },
      });
      await this.audit.record({
        adminUserId: auditActorId,
        action: ADMIN_AUDIT_ACTIONS.PROMOTE_ADMIN,
        targetType: 'User',
        targetId: user.id,
        reason,
        metadata: {
          ...(input.metadata ?? {}),
          source: 'admin_cli',
          actorType: input.actorUserId ? 'SUPERADMIN' : 'CLI_OPERATOR',
          targetUid: user.uid,
        },
      }, tx);
      return { changed: true, user };
    });
  }

  async demote(input: AdminRoleChangeInput) {
    const reason = this.requireReason(input.reason);
    return this.prisma.$transaction(async (tx) => {
      await this.lockRoleChanges(tx);
      const target = await this.lockTarget(tx, input.targetUid);
      const auditActorId = await this.requireActiveActor(
        tx,
        input.actorUserId,
      );
      if (target.role !== UserRole.SUPERADMIN) {
        return { changed: false, user: target };
      }

      // Lock every current Superadmin in stable order. Concurrent demotions
      // serialize here and each transaction then observes the latest count.
      const admins = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "User"
        WHERE "role" = 'SUPERADMIN'::"UserRole"
          AND "accountStatus" = 'ACTIVE'::"UserAccountStatus"
        ORDER BY "id"
        FOR UPDATE
      `;
      if (
        target.accountStatus === UserAccountStatus.ACTIVE
        && admins.length <= 1
      ) {
        throw new ConflictException({
          code: 'LAST_SUPERADMIN',
          message: 'The last Superadmin cannot be demoted',
        });
      }

      const user = await tx.user.update({
        where: { id: target.id },
        data: { role: UserRole.USER },
        select: { id: true, uid: true, email: true, username: true, role: true },
      });
      await this.audit.record({
        adminUserId: auditActorId,
        action: ADMIN_AUDIT_ACTIONS.DEMOTE_ADMIN,
        targetType: 'User',
        targetId: user.id,
        reason,
        metadata: {
          ...(input.metadata ?? {}),
          source: 'admin_cli',
          actorType: input.actorUserId ? 'SUPERADMIN' : 'CLI_OPERATOR',
          targetUid: user.uid,
        },
      }, tx);
      return { changed: true, user };
    });
  }

  private async lockTarget(tx: Prisma.TransactionClient, uid: string) {
    const normalizedUid = uid.trim().toUpperCase();
    const rows = await tx.$queryRaw<Array<{
      id: string;
      uid: string;
      email: string;
      username: string;
      role: UserRole;
      accountStatus: UserAccountStatus;
    }>>`
      SELECT "id", "uid", "email", "username", "role", "accountStatus"
      FROM "User"
      WHERE "uid" = ${normalizedUid}
      FOR UPDATE
    `;
    const target = rows[0];
    if (!target) {
      throw new NotFoundException({
        code: 'ADMIN_TARGET_NOT_FOUND',
        message: 'The target account was not found',
      });
    }
    return target;
  }

  private async lockRoleChanges(tx: Prisma.TransactionClient): Promise<void> {
    // One PostgreSQL transaction-scoped advisory lock serializes every role
    // mutation, including two concurrent demotions of different accounts.
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(585983374211407945)',
    );
  }

  private requireReason(reason: string): string {
    const normalized = reason.trim();
    if (normalized.length < 4 || normalized.length > 500) {
      throw new BadRequestException({
        code: 'ADMIN_REASON_REQUIRED',
        message: 'Reason must contain between 4 and 500 characters',
      });
    }
    return normalized;
  }

  private async requireActorOrBootstrap(
    tx: Prisma.TransactionClient,
    actorUserId: string | undefined,
    targetUserId: string,
  ): Promise<string> {
    if (actorUserId) return this.requireActiveActor(tx, actorUserId);
    const activeAdmins = await tx.user.count({
      where: {
        role: UserRole.SUPERADMIN,
        accountStatus: UserAccountStatus.ACTIVE,
      },
    });
    if (activeAdmins === 0) return targetUserId;
    throw new ForbiddenException({
      code: 'ADMIN_ACTOR_REQUIRED',
      message: 'A current active Superadmin actor is required',
    });
  }

  private async requireActiveActor(
    tx: Prisma.TransactionClient,
    actorUserId: string | undefined,
  ): Promise<string> {
    if (!actorUserId) {
      throw new ForbiddenException({
        code: 'ADMIN_ACTOR_REQUIRED',
        message: 'A current active Superadmin actor is required',
      });
    }
    const actor = await tx.user.findUnique({
      where: { id: actorUserId },
      select: { role: true, accountStatus: true },
    });
    if (
      actor?.role !== UserRole.SUPERADMIN
      || actor.accountStatus !== UserAccountStatus.ACTIVE
    ) {
      throw new ForbiddenException({
        code: 'SUPERADMIN_REQUIRED',
        message: 'The CLI actor is not a current active Superadmin',
      });
    }
    return actorUserId;
  }
}
