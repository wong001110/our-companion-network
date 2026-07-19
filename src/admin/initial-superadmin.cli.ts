import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { UserAccountStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ADMIN_AUDIT_ACTIONS } from './audit.service';

const UID_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const UID_LENGTH = 8;
const DEVELOPMENT_DEFAULTS = {
  email: 'superadmin@example.test',
  username: 'superadmin',
  password: '12345678',
};

export interface InitialSuperadminConfig {
  email: string;
  normalizedEmail: string;
  username: string;
  password: string;
  resetPassword: boolean;
}

export function readInitialSuperadminConfig(
  environment: NodeJS.ProcessEnv = process.env,
): InitialSuperadminConfig {
  const production = environment.NODE_ENV === 'production';
  const email = (environment.INITIAL_SUPERADMIN_EMAIL
    ?? (production ? '' : DEVELOPMENT_DEFAULTS.email)).trim();
  const username = (environment.INITIAL_SUPERADMIN_USERNAME
    ?? (production ? '' : DEVELOPMENT_DEFAULTS.username)).trim();
  const password = environment.INITIAL_SUPERADMIN_PASSWORD
    ?? (production ? '' : DEVELOPMENT_DEFAULTS.password);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('INITIAL_SUPERADMIN_EMAIL must be a valid email address');
  }
  if (username.length < 3 || username.length > 30) {
    throw new Error('INITIAL_SUPERADMIN_USERNAME must contain between 3 and 30 characters');
  }
  if (password.length < 8 || password.length > 128) {
    throw new Error('INITIAL_SUPERADMIN_PASSWORD must contain between 8 and 128 characters');
  }
  if (production && password.length < 12) {
    throw new Error('Production INITIAL_SUPERADMIN_PASSWORD must contain at least 12 characters');
  }

  return {
    email,
    normalizedEmail: email.toLowerCase(),
    username,
    password,
    resetPassword: environment.INITIAL_SUPERADMIN_RESET_PASSWORD === 'true',
  };
}

export async function setupInitialSuperadmin(
  prisma: PrismaService,
  config: InitialSuperadminConfig,
  hashPassword: (password: string) => Promise<string>,
): Promise<{ created: boolean; uid: string; email: string }> {
  const existing = await prisma.user.findUnique({
    where: { normalizedEmail: config.normalizedEmail },
    select: {
      id: true,
      uid: true,
      email: true,
      role: true,
      accountStatus: true,
      deletionRequestedAt: true,
    },
  });

  if (existing) {
    if (existing.accountStatus !== UserAccountStatus.ACTIVE || existing.deletionRequestedAt) {
      throw new Error('INITIAL_SUPERADMIN_ACCOUNT_UNAVAILABLE');
    }
    const passwordHash = config.resetPassword ? await hashPassword(config.password) : undefined;
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: existing.id },
        data: { role: UserRole.SUPERADMIN, ...(passwordHash ? { passwordHash } : {}) },
      });
      if (existing.role !== UserRole.SUPERADMIN || passwordHash) {
        await tx.adminAuditLog.create({
          data: {
            adminUserId: existing.id,
            action: ADMIN_AUDIT_ACTIONS.PROMOTE_ADMIN,
            targetType: 'User',
            targetId: existing.id,
            reason: 'initial_superadmin_setup',
            metadata: { source: 'initial_superadmin_cli', passwordReset: Boolean(passwordHash) },
          },
        });
      }
    });
    return { created: false, uid: existing.uid, email: existing.email };
  }

  const passwordHash = await hashPassword(config.password);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            uid: generateUid(),
            email: config.email,
            normalizedEmail: config.normalizedEmail,
            username: config.username,
            passwordHash,
            friendCode: generateFriendCode(),
            role: UserRole.SUPERADMIN,
            profile: { create: { displayName: config.username } },
          },
          select: { id: true, uid: true, email: true },
        });
        await tx.adminAuditLog.create({
          data: {
            adminUserId: user.id,
            action: ADMIN_AUDIT_ACTIONS.PROMOTE_ADMIN,
            targetType: 'User',
            targetId: user.id,
            reason: 'initial_superadmin_setup',
            metadata: { source: 'initial_superadmin_cli', created: true },
          },
        });
        return user;
      });
      return { created: true, uid: created.uid, email: created.email };
    } catch (error) {
      const prismaError = error as { code?: string; meta?: { target?: unknown } };
      const target = prismaError.meta?.target;
      const retryable = prismaError.code === 'P2002'
        && (Array.isArray(target)
          ? target.includes('uid') || target.includes('friendCode')
          : target === 'uid' || target === 'friendCode');
      if (!retryable || attempt === 4) throw error;
    }
  }
  throw new Error('INITIAL_SUPERADMIN_PUBLIC_ID_GENERATION_FAILED');
}

function generateUid(): string {
  const limit = Math.floor(256 / UID_ALPHABET.length) * UID_ALPHABET.length;
  let value = '';
  while (value.length < UID_LENGTH) {
    for (const byte of randomBytes(UID_LENGTH)) {
      if (byte < limit) value += UID_ALPHABET[byte % UID_ALPHABET.length];
      if (value.length === UID_LENGTH) break;
    }
  }
  return `OC-${value}`;
}

function generateFriendCode(): string {
  return randomBytes(4).toString('hex').toUpperCase();
}

async function main(): Promise<void> {
  const bcrypt = await import('bcryptjs');
  const config = readInitialSuperadminConfig();
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const result = await setupInitialSuperadmin(
      prisma,
      config,
      (password) => bcrypt.hash(password, 12),
    );
    process.stdout.write(
      `${result.created ? 'Created' : 'Configured'} initial Superadmin: ${result.email} (${result.uid})\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Initial Superadmin setup failed'}\n`);
    process.exitCode = 1;
  });
}
