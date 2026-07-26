import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { migrationAction } from './railway-migrate.mjs';

test('bootstraps only a completely empty database', () => {
  assert.equal(migrationAction({ hasMigrationTable: false, applicationTableCount: 0 }), 'bootstrap');
});

test('deploys pending migrations when Prisma history exists', () => {
  assert.equal(migrationAction({ hasMigrationTable: true, applicationTableCount: 24 }), 'deploy');
});

test('refuses to guess on a non-empty unbaselined database', () => {
  assert.equal(migrationAction({ hasMigrationTable: false, applicationTableCount: 24 }), 'refuse');
});

test('Railway API config uses one ordered pre-deploy command', () => {
  const config = JSON.parse(fs.readFileSync('deploy/railway/api.railway.json', 'utf8'));
  const commands = config.deploy?.preDeployCommand;

  assert.ok(Array.isArray(commands));
  assert.equal(commands.length, 1);
  assert.match(commands[0], /node scripts\/railway-migrate\.mjs && node dist\/admin\/initial-superadmin\.cli\.js/);
});
