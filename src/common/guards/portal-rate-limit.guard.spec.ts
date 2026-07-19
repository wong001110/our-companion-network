import { PortalRateLimitGuard } from './portal-rate-limit.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminController } from '../../admin/admin.controller';
import { SuperadminGuard } from '../../admin/superadmin.guard';

function context(method: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        ip: '127.0.0.1',
        user: { id: 'user-1' },
      }),
    }),
  } as never;
}

describe('PortalRateLimitGuard', () => {
  it('runs before the database-backed Superadmin guard on admin routes', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminController)).toEqual([
      PortalRateLimitGuard,
      SuperadminGuard,
    ]);
  });

  it('bounds write requests independently from reads', () => {
    const guard = new PortalRateLimitGuard();
    for (let index = 0; index < 30; index += 1) {
      expect(guard.canActivate(context('POST'))).toBe(true);
    }
    expect(() => guard.canActivate(context('POST'))).toThrow('Too many portal requests');
    expect(guard.canActivate(context('GET'))).toBe(true);
  });
});
