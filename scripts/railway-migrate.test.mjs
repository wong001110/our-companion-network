import assert from 'node:assert/strict';
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
