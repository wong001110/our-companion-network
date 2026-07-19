import { ExecutionContext } from '@nestjs/common';
import { SocialRateLimitGuard } from './social-rate-limit.guard';

function contextFor(userId: string, _policy: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { id: userId } }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('SocialRateLimitGuard', () => {
  afterEach(() => {
    delete process.env.OUR_COMPANION_SMOKE_TEST;
    delete process.env.SMOKE_TEST_ALLOW_DESTRUCTIVE_ENDPOINTS;
    delete process.env.SMOKE_TEST_DATABASE;
  });

  it('bypasses limits only for the fully guarded destructive smoke runtime', () => {
    process.env.OUR_COMPANION_SMOKE_TEST = '1';
    process.env.SMOKE_TEST_ALLOW_DESTRUCTIVE_ENDPOINTS = '1';
    process.env.SMOKE_TEST_DATABASE = '1';
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('read') };
    const guard = new SocialRateLimitGuard(reflector as never);
    for (let attempt = 0; attempt < 130; attempt += 1) expect(guard.canActivate(contextFor('smoke-user', 'read'))).toBe(true);
    expect((guard as any).attempts.size).toBe(0);
  });

  it('allows normal repeated read synchronization without consuming mutation capacity', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('read') };
    const guard = new SocialRateLimitGuard(reflector as never);
    for (let attempt = 0; attempt < 15; attempt += 1) expect(guard.canActivate(contextFor('user-a', 'read'))).toBe(true);
    reflector.getAllAndOverride.mockReturnValue('friend_request_create');
    expect(guard.canActivate(contextFor('user-a', 'friend_request_create'))).toBe(true);
  });

  it('removes expired policy entries instead of retaining old limiter keys', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-13T00:00:00.000Z'));
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('lookup') };
    const guard = new SocialRateLimitGuard(reflector as never);
    guard.canActivate(contextFor('expired-user', 'lookup'));
    jest.advanceTimersByTime(60_001);
    guard.canActivate(contextFor('current-user', 'lookup'));
    expect((guard as any).attempts.has('expired-user:lookup')).toBe(false);
    jest.useRealTimers();
  });
});
