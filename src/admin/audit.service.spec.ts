import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('offers append-only writes with explicit audit fields', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'audit-1' });
    const service = new AuditService({
      adminAuditLog: { create },
    } as never);
    await expect(service.record({
      adminUserId: 'admin-1',
      action: 'PROMOTE_ADMIN',
      targetType: 'User',
      targetId: 'user-1',
      reason: 'Initial caretaker setup',
      metadata: { source: 'test' },
    })).resolves.toEqual({ id: 'audit-1' });
    expect(create).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin-1',
        action: 'PROMOTE_ADMIN',
        targetType: 'User',
        targetId: 'user-1',
        reason: 'Initial caretaker setup',
        metadata: { source: 'test' },
        ipAddressHash: undefined,
      },
    });
    expect('update' in service).toBe(false);
    expect('delete' in service).toBe(false);
  });

  it('lists audit rows with bounded stable pagination', async () => {
    const findMany = jest.fn().mockReturnValue('find-query');
    const count = jest.fn().mockReturnValue('count-query');
    const transaction = jest.fn().mockResolvedValue([[{ id: 'audit-1' }], 1]);
    const service = new AuditService({
      adminAuditLog: { findMany, count },
      $transaction: transaction,
    } as never);
    await expect(service.list({ page: 2, limit: 500 })).resolves.toEqual({
      items: [{ id: 'audit-1' }],
      pagination: { page: 2, limit: 100, total: 1, totalPages: 1 },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {},
      skip: 100,
      take: 100,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });
});
