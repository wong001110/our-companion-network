import { createInterface, Interface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { PrismaService } from '../prisma/prisma.service';
import { AdminRoleService } from './admin-role.service';
import { AuditService } from './audit.service';

export type AdminRoleCliAction = 'promote' | 'demote';

export interface AdminRoleCliOptions {
  action: AdminRoleCliAction;
  uid: string;
  actorUid?: string;
  reason?: string;
  confirm?: string;
  environment?: string;
  confirmProduction?: string;
}

export function parseAdminRoleCliArgs(args: string[]): AdminRoleCliOptions {
  const [actionValue, ...rest] = args;
  if (actionValue !== 'promote' && actionValue !== 'demote') {
    throw new Error('The first argument must be "promote" or "demote"');
  }
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index];
    const value = rest[index + 1];
    if (!name?.startsWith('--') || !value || value.startsWith('--')) {
      throw new Error(`Invalid CLI argument near "${name ?? ''}"`);
    }
    if (values.has(name)) throw new Error(`Duplicate CLI argument "${name}"`);
    values.set(name, value);
  }
  const uid = values.get('--uid')?.trim().toUpperCase();
  if (!uid) throw new Error('--uid is required');
  const allowed = new Set([
    '--uid',
    '--actor-uid',
    '--reason',
    '--confirm',
    '--environment',
    '--confirm-production',
  ]);
  for (const name of values.keys()) {
    if (!allowed.has(name)) throw new Error(`Unknown CLI argument "${name}"`);
  }
  return {
    action: actionValue,
    uid,
    actorUid: values.get('--actor-uid')?.trim().toUpperCase(),
    reason: values.get('--reason')?.trim(),
    confirm: values.get('--confirm')?.trim().toUpperCase(),
    environment: values.get('--environment')?.trim().toLowerCase(),
    confirmProduction: values.get('--confirm-production')?.trim(),
  };
}

export function productionConfirmationToken(
  action: AdminRoleCliAction,
  uid: string,
): string {
  return `PRODUCTION-${action.toUpperCase()}-${uid.toUpperCase()}`;
}

export function validateEnvironmentConfirmation(
  options: AdminRoleCliOptions,
  nodeEnv = process.env.NODE_ENV,
): void {
  const runtimeIsProduction = nodeEnv === 'production';
  if (runtimeIsProduction && options.environment !== 'production') {
    throw new Error(
      'Production requires the explicit flag "--environment production"',
    );
  }
  if (options.environment === 'production') {
    const expected = productionConfirmationToken(options.action, options.uid);
    if (options.confirmProduction !== expected) {
      throw new Error(
        `Production requires "--confirm-production ${expected}"`,
      );
    }
  }
}

export function validateTargetConfirmation(
  uid: string,
  confirmation: string,
): void {
  if (confirmation.trim().toUpperCase() !== uid.trim().toUpperCase()) {
    throw new Error('Target confirmation did not match the selected account');
  }
}

async function requireExactConfirmation(
  options: AdminRoleCliOptions,
  prompt: (question: string) => Promise<string>,
): Promise<void> {
  const confirmation = options.confirm
    ?? (await prompt(`Type the exact target UID (${options.uid}) to continue: `))
      .trim()
      .toUpperCase();
  validateTargetConfirmation(options.uid, confirmation);
}

async function requireReason(
  options: AdminRoleCliOptions,
  prompt: (question: string) => Promise<string>,
): Promise<string> {
  const reason = options.reason
    ?? (await prompt('Reason for this role change: ')).trim();
  if (reason.length < 4 || reason.length > 500) {
    throw new Error('Reason must contain between 4 and 500 characters');
  }
  return reason;
}

async function execute(
  options: AdminRoleCliOptions,
  prompt: (question: string) => Promise<string>,
): Promise<void> {
  validateEnvironmentConfirmation(options);
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const audit = new AuditService(prisma);
    const roles = new AdminRoleService(prisma, audit);
    const target = await roles.findTargetByUid(options.uid);
    if (!target) throw new Error(`No account found for UID ${options.uid}`);

    stdout.write(
      [
        'Selected account:',
        `  UID: ${target.uid}`,
        `  Username: ${target.username}`,
        `  Email: ${target.email}`,
        `  Current role: ${target.role}`,
        `  Requested role: ${options.action === 'promote' ? 'SUPERADMIN' : 'USER'}`,
        '',
      ].join('\n'),
    );
    await requireExactConfirmation(options, prompt);
    const reason = await requireReason(options, prompt);

    let actorUserId: string | undefined;
    if (options.actorUid) {
      const actor = await roles.findTargetByUid(options.actorUid);
      if (!actor) throw new Error(`No actor account found for UID ${options.actorUid}`);
      actorUserId = actor.id;
    }
    const input = {
      targetUid: options.uid,
      actorUserId,
      reason,
      metadata: {
        environment: options.environment ?? process.env.NODE_ENV ?? 'development',
        cliOperator: process.env.USER ?? 'unknown',
      },
    };
    const result = options.action === 'promote'
      ? await roles.promote(input)
      : await roles.demote(input);
    stdout.write(
      `${result.changed ? 'Updated' : 'No change'}: ${result.user.uid} is ${result.user.role}\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  let reader: Interface | undefined;
  try {
    const options = parseAdminRoleCliArgs(process.argv.slice(2));
    reader = createInterface({ input: stdin, output: stdout });
    await execute(options, (question) => reader!.question(question));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown admin CLI failure';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  } finally {
    reader?.close();
  }
}

if (require.main === module) {
  void main();
}
