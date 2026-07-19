import { UserAccountStatus, UserRole } from '@prisma/client';
import {
  readInitialSuperadminConfig,
  setupInitialSuperadmin,
} from './initial-superadmin.cli';

describe('initial Superadmin setup CLI', () => {
  it('uses development defaults and rejects missing production configuration', () => {
    expect(readInitialSuperadminConfig({ NODE_ENV: 'development' })).toMatchObject({
      email: 'superadmin@example.test',
      username: 'superadmin',
      password: '12345678',
    });
    expect(() => readInitialSuperadminConfig({ NODE_ENV: 'production' }))
      .toThrow('INITIAL_SUPERADMIN_EMAIL');
  });

  it('creates an audited Superadmin account', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'admin-1', uid: 'OC-ABCDEFGH', email: 'superadmin@example.test',
    });
    const auditCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((operation) => operation({
        user: { create },
        adminAuditLog: { create: auditCreate },
      })),
    } as never;

    await expect(setupInitialSuperadmin(
      prisma,
      readInitialSuperadminConfig({ NODE_ENV: 'development' }),
      jest.fn().mockResolvedValue('hash'),
    )).resolves.toEqual({ created: true, uid: 'OC-ABCDEFGH', email: 'superadmin@example.test' });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: UserRole.SUPERADMIN, passwordHash: 'hash' }),
    }));
    expect(auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PROMOTE_ADMIN', adminUserId: 'admin-1' }),
    }));
  });

  it('promotes an existing active account without resetting its password by default', async () => {
    const update = jest.fn().mockResolvedValue({});
    const auditCreate = jest.fn().mockResolvedValue({});
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'admin-1', uid: 'OC-ABCDEFGH', email: 'superadmin@example.test',
          role: UserRole.USER, accountStatus: UserAccountStatus.ACTIVE, deletionRequestedAt: null,
        }),
      },
      $transaction: jest.fn((operation) => operation({
        user: { update },
        adminAuditLog: { create: auditCreate },
      })),
    } as never;

    await setupInitialSuperadmin(
      prisma,
      readInitialSuperadminConfig({ NODE_ENV: 'development' }),
      jest.fn(),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'admin-1' },
      data: { role: UserRole.SUPERADMIN },
    });
  });
});
