import { UnauthorizedException } from '@nestjs/common';
import { SuperadminGuard } from './superadmin.guard';

function contextFor(user?: { id?: string; role?: string }) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as never;
}

describe('SuperadminGuard', () => {
  it('rejects an authenticated USER', async () => {
    const findUnique = jest.fn().mockResolvedValue({ role: 'USER' });
    const guard = new SuperadminGuard({ user: { findUnique } } as never);
    await expect(guard.canActivate(contextFor({ id: 'user-1' })))
      .rejects.toMatchObject({ response: { code: 'SUPERADMIN_REQUIRED' } });
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: { role: true },
    });
  });

  it('allows a current SUPERADMIN and re-queries the database each time', async () => {
    const findUnique = jest.fn().mockResolvedValue({ role: 'SUPERADMIN' });
    const guard = new SuperadminGuard({ user: { findUnique } } as never);
    await expect(guard.canActivate(contextFor({ id: 'admin-1' }))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor({ id: 'admin-1' }))).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('does not trust a request/JWT role and rejects missing accounts', async () => {
    const guard = new SuperadminGuard({
      user: { findUnique: jest.fn().mockResolvedValue(null) },
    } as never);
    await expect(guard.canActivate(contextFor({
      id: 'deleted-admin',
      role: 'SUPERADMIN',
    }))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(guard.canActivate(contextFor())).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
