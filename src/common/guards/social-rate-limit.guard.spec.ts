import { ExecutionContext } from '@nestjs/common';
import { SocialRateLimitGuard } from './social-rate-limit.guard';

function contextFor(userId: string, policy: string): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { id: userId } }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('SocialRateLimitGuard', () => {
  it('allows normal repeated read synchronization without consuming mutation capacity', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue('read') };
    const guard = new SocialRateLimitGuard(reflector as never);
    for (let attempt = 0; attempt < 15; attempt += 1) expect(guard.canActivate(contextFor('user-a', 'read'))).toBe(true);
    reflector.getAllAndOverride.mockReturnValue('friend_request_create');
    expect(guard.canActivate(contextFor('user-a', 'friend_request_create'))).toBe(true);
  });
});
