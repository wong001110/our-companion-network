import { BrowserCsrfGuard } from './browser-csrf.guard';

function context(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as never;
}

describe('BrowserCsrfGuard', () => {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };

  it('preserves bearer-token desktop mutations without browser CSRF', async () => {
    const security = {
      parseCookies: jest.fn().mockReturnValue({}),
      requireAllowedOrigin: jest.fn(),
      requireCsrf: jest.fn(),
    };
    const guard = new BrowserCsrfGuard(reflector as never, security as never);
    await expect(guard.canActivate(context({
      method: 'POST',
      headers: { authorization: 'Bearer desktop-token' },
      user: { id: 'user-1', deviceId: 'desktop-1' },
    }))).resolves.toBe(true);
    expect(security.requireCsrf).not.toHaveBeenCalled();
  });

  it('requires origin and session-bound CSRF for cookie mutations', async () => {
    const security = {
      parseCookies: jest.fn().mockReturnValue({
        oc_access: 'access',
        oc_csrf: 'csrf',
      }),
      requireAllowedOrigin: jest.fn(),
      requireCsrf: jest.fn().mockResolvedValue(undefined),
    };
    const guard = new BrowserCsrfGuard(reflector as never, security as never);
    const request = {
      method: 'PATCH',
      headers: { origin: 'https://portal.test', 'x-csrf-token': 'csrf' },
      user: { id: 'user-1', deviceId: 'browser-1' },
    };
    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(security.requireAllowedOrigin).toHaveBeenCalledWith(request);
    expect(security.requireCsrf).toHaveBeenCalledWith(
      'user-1', 'browser-1', 'csrf', 'csrf',
    );
  });
});
