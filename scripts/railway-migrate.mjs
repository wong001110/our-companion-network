import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';

const prismaExecutable = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'prisma.cmd' : 'prisma',
);

export function migrationAction({ hasMigrationTable, applicationTableCount }) {
  if (hasMigrationTable) return 'deploy';
  if (applicationTableCount === 0) return 'bootstrap';
  return 'refuse';
}

export function validateDatabaseUrl(value) {
  const databaseUrl = value?.trim();

  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. In Railway, add it to network-api as a Reference Variable from the PostgreSQL service.',
    );
  }

  if (databaseUrl.includes('${{')) {
    throw new Error(
      'DATABASE_URL contains an unresolved Railway reference. Remove the plain-text value and use Variables → Add Reference Variable → <PostgreSQL service> → DATABASE_URL.',
    );
  }

  if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    throw new Error(
      'DATABASE_URL must resolve to a PostgreSQL URL beginning with postgresql:// or postgres://. Configure it as a Railway Reference Variable from the PostgreSQL service; do not paste a service reference as ordinary text.',
    );
  }

  return databaseUrl;
}

export function listMigrationNames(migrationsRoot = path.join(process.cwd(), 'prisma', 'migrations')) {
  if (!fs.existsSync(migrationsRoot)) return [];
  return fs.readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(migrationsRoot, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort();
}

function runPrisma(args) {
  execFileSync(prismaExecutable, args, {
    stdio: 'inherit',
    env: process.env,
  });
}

async function readDatabaseState(client) {
  const [state] = await client.$queryRawUnsafe(`
    SELECT
      EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = '_prisma_migrations'
      ) AS "hasMigrationTable",
      COUNT(*) FILTER (
        WHERE table_schema = 'public'
          AND table_type = 'BASE TABLE'
          AND table_name <> '_prisma_migrations'
      )::int AS "applicationTableCount"
    FROM information_schema.tables
    WHERE table_schema = 'public'
  `);
  return state;
}

async function main() {
  process.env.DATABASE_URL = validateDatabaseUrl(process.env.DATABASE_URL);

  if (!fs.existsSync(prismaExecutable)) {
    throw new Error(`Prisma CLI was not found at ${prismaExecutable}.`);
  }

  const client = new PrismaClient();
  try {
    const state = await readDatabaseState(client);
    const action = migrationAction(state);

    if (action === 'deploy') {
      console.log('[railway-migrate] Managed database detected; applying pending migrations.');
      runPrisma(['migrate', 'deploy']);
      return;
    }

    if (action === 'refuse') {
      throw new Error(
        'The database contains application tables but has no Prisma migration history. Refusing to baseline automatically. Back up the database and baseline it explicitly before deploying.',
      );
    }

    const migrationNames = listMigrationNames();
    if (migrationNames.length === 0) {
      throw new Error('No Prisma migration directories were found.');
    }

    console.log('[railway-migrate] Empty database detected; creating the current schema.');
    runPrisma(['db', 'push', '--skip-generate']);

    console.log(`[railway-migrate] Recording ${migrationNames.length} existing migrations as the production baseline.`);
    for (const migrationName of migrationNames) {
      runPrisma(['migrate', 'resolve', '--applied', migrationName]);
    }

    console.log('[railway-migrate] Verifying that no migrations remain pending.');
    runPrisma(['migrate', 'deploy']);
  } finally {
    await client.$disconnect();
  }
}

const executedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (executedDirectly) {
  main().catch((error) => {
    console.error('[railway-migrate]', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
