import { ForbiddenException } from '@nestjs/common';
import { UserAccountStatus, UserRole } from '@prisma/client';
import { AdminRoleService } from './admin-role.service';

const target = {
  id: 'user-1',
  uid: 'OC-ABCDEFGH',
  email: 'owner@example.test',
  username: 'Owner',
  role: UserRole.USER,
  accountStatus: UserAccountStatus.ACTIVE,
};

function serviceWith(tx: Record<string, any>, auditRecord = jest.fn().mockResolvedValue({})) {
  const prisma = {
    $transaction: jest.fn((operation: (client: unknown) => unknown) => operation(tx)),
  };
  return {
    service: new AdminRoleService(prisma as never, { record: auditRecord } as never),
    auditRecord,
  };
}

describe('AdminRoleService', () => {
  it('promotes under a row lock and writes the audit in the same transaction', async () => {
    const update = jest.fn().mockResolvedValue({ ...target, role: UserRole.SUPERADMIN });
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([target]),
      user: { update, findUnique: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    };
    const { service, auditRecord } = serviceWith(tx);
    await expect(service.promote({
      targetUid: 'oc-abcdefgh',
      reason: 'Bootstrap caretaker',
    })).resolves.toMatchObject({ changed: true, user: { role: 'SUPERADMIN' } });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: target.id },
      data: { role: UserRole.SUPERADMIN },
    }));
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: target.id,
      action: 'PROMOTE_ADMIN',
      targetId: target.id,
      reason: 'Bootstrap caretaker',
      metadata: expect.objectContaining({ actorType: 'CLI_OPERATOR' }),
    }), tx);
  });

  it('prevents demotion of the last current Superadmin before update or audit', async () => {
    const update = jest.fn();
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ ...target, role: UserRole.SUPERADMIN }])
        .mockResolvedValueOnce([{ id: target.id }]),
      user: {
        update,
        findUnique: jest.fn().mockResolvedValue({
          role: UserRole.SUPERADMIN,
          accountStatus: UserAccountStatus.ACTIVE,
        }),
      },
    };
    const { service, auditRecord } = serviceWith(tx);
    await expect(service.demote({
      targetUid: target.uid,
      actorUserId: 'admin-actor',
      reason: 'Rotate caretaker',
    })).rejects.toMatchObject({
      response: { code: 'LAST_SUPERADMIN' },
    });
    expect(update).not.toHaveBeenCalled();
    expect(auditRecord).not.toHaveBeenCalled();
  });

  it('demotes safely when another Superadmin exists and records the reason', async () => {
    const admin = { ...target, role: UserRole.SUPERADMIN };
    const update = jest.fn().mockResolvedValue({ ...target, role: UserRole.USER });
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([admin])
        .mockResolvedValueOnce([{ id: target.id }, { id: 'admin-2' }]),
      user: {
        update,
        findUnique: jest.fn().mockResolvedValue({
          role: UserRole.SUPERADMIN,
          accountStatus: UserAccountStatus.ACTIVE,
        }),
      },
    };
    const { service, auditRecord } = serviceWith(tx);
    await expect(service.demote({
      targetUid: target.uid,
      actorUserId: 'admin-2',
      reason: 'Caretaker rotation',
    })).resolves.toMatchObject({ changed: true, user: { role: 'USER' } });
    expect(auditRecord).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DEMOTE_ADMIN',
      reason: 'Caretaker rotation',
    }), tx);
  });

  it('requires a supplied actor to still be a Superadmin', async () => {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([target]),
      user: {
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          role: UserRole.USER,
          accountStatus: UserAccountStatus.ACTIVE,
        }),
      },
    };
    const { service } = serviceWith(tx);
    await expect(service.promote({
      targetUid: target.uid,
      actorUserId: 'former-admin',
      reason: 'Unauthorized attempt',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('rejects a suspended Superadmin actor', async () => {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([target]),
      user: {
        update: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({
          role: UserRole.SUPERADMIN,
          accountStatus: UserAccountStatus.SUSPENDED,
        }),
      },
    };
    const { service } = serviceWith(tx);
    await expect(service.promote({
      targetUid: target.uid,
      actorUserId: 'suspended-admin',
      reason: 'Unauthorized attempt',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('does not count a suspended Superadmin when protecting the last active caretaker', async () => {
    const update = jest.fn();
    const activeTarget = {
      ...target,
      role: UserRole.SUPERADMIN,
      accountStatus: UserAccountStatus.ACTIVE,
    };
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([activeTarget])
        .mockResolvedValueOnce([{ id: activeTarget.id }]),
      user: {
        update,
        findUnique: jest.fn().mockResolvedValue({
          role: UserRole.SUPERADMIN,
          accountStatus: UserAccountStatus.ACTIVE,
        }),
      },
    };
    const { service } = serviceWith(tx);
    await expect(service.demote({
      targetUid: activeTarget.uid,
      actorUserId: 'suspended-admin-is-not-in-active-lock-set',
      reason: 'Caretaker rotation',
    })).rejects.toMatchObject({
      response: { code: 'LAST_SUPERADMIN' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('requires an explicit active actor after bootstrap promotion', async () => {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([target]),
      user: {
        update: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
      },
    };
    const { service } = serviceWith(tx);
    await expect(service.promote({
      targetUid: target.uid,
      reason: 'Routine promotion',
    })).rejects.toMatchObject({
      response: { code: 'ADMIN_ACTOR_REQUIRED' },
    });
  });

  it('rejects a blank audit reason in the domain service', async () => {
    const tx = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
      $queryRaw: jest.fn().mockResolvedValue([target]),
      user: {
        update: jest.fn().mockResolvedValue({ ...target, role: UserRole.SUPERADMIN }),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const { service, auditRecord } = serviceWith(tx);
    await expect(service.promote({
      targetUid: target.uid,
      reason: ' ',
    })).rejects.toMatchObject({
      response: { code: 'ADMIN_REASON_REQUIRED' },
    });
    expect(auditRecord).not.toHaveBeenCalled();
  });
});
