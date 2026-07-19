import { BrowserAuthService } from './browser-auth.service';
import { BROWSER_COOKIE_NAMES } from '../common/browser-security.service';

describe('BrowserAuthService', () => {
  it('sets secure cookies while keeping tokens out of the response body', async () => {
    const identity = {
      login: jest.fn().mockResolvedValue({
        user: { id: 'user-1', email: 'user@example.test' },
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
      }),
    };
    const security = {
      createCsrfToken: jest.fn().mockReturnValue('csrf-secret'),
      bindCsrfToken: jest.fn().mockResolvedValue(undefined),
      cookieOptions: jest.fn((maxAge: number, httpOnly = true, path = '/api') => ({
        maxAge, httpOnly, secure: true, sameSite: 'strict', path,
      })),
    };
    const response = { cookie: jest.fn(), clearCookie: jest.fn() };
    const service = new BrowserAuthService(
      identity as never,
      {} as never,
      { get: jest.fn((key: string, fallback: string) => fallback) } as never,
      security as never,
      { user: { findUnique: jest.fn().mockResolvedValue({ role: 'USER' }) } } as never,
      { record: jest.fn() } as never,
    );
    const result = await service.login({
      email: 'user@example.test',
      password: 'password123',
    }, response as never);
    expect(result).toEqual({
      user: {
        id: 'user-1',
        email: 'user@example.test',
        role: 'USER',
      },
    });
    expect(JSON.stringify(result)).not.toContain('access-secret');
    expect(JSON.stringify(result)).not.toContain('refresh-secret');
    expect(response.cookie).toHaveBeenCalledTimes(4);
    for (const [, , options] of response.cookie.mock.calls) {
      expect(options).toMatchObject({ secure: true, sameSite: 'strict' });
    }
    const csrfCookie = response.cookie.mock.calls.find(
      ([name]) => name === 'oc_csrf',
    );
    expect(csrfCookie?.[2]).toMatchObject({
      httpOnly: false,
      path: '/',
    });
  });

  it('records a browser login when the current database role is SUPERADMIN', async () => {
    const audit = { record: jest.fn().mockResolvedValue({}) };
    const service = new BrowserAuthService(
      {
        login: jest.fn().mockResolvedValue({
          user: { id: 'admin-1' },
          accessToken: 'access',
          refreshToken: 'refresh',
        }),
      } as never,
      {} as never,
      { get: jest.fn((key: string, fallback: string) => fallback) } as never,
      {
        createCsrfToken: jest.fn().mockReturnValue('csrf'),
        bindCsrfToken: jest.fn(),
        cookieOptions: jest.fn().mockReturnValue({ secure: true }),
      } as never,
      { user: { findUnique: jest.fn().mockResolvedValue({ role: 'SUPERADMIN' }) } } as never,
      audit as never,
    );
    await service.login({
      email: 'admin@example.test',
      password: 'password123',
    }, { cookie: jest.fn() } as never);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      adminUserId: 'admin-1',
      action: 'ADMIN_LOGIN',
      metadata: { source: 'browser_portal' },
    }));
  });

  it('validates refresh identity and CSRF before rotating cookie tokens', async () => {
    const identity = {
      refreshToken: jest.fn().mockResolvedValue({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      }),
    };
    const security = {
      requireCsrf: jest.fn().mockResolvedValue(undefined),
      cookieOptions: jest.fn().mockReturnValue({ secure: true }),
    };
    const response = { cookie: jest.fn() };
    const service = new BrowserAuthService(
      identity as never,
      {
        verifyAsync: jest.fn().mockResolvedValue({
          sub: 'user-1',
          deviceId: 'browser-1',
        }),
      } as never,
      { get: jest.fn((key: string, fallback: string) => fallback) } as never,
      security as never,
      {} as never,
      {} as never,
    );
    await expect(service.refresh(
      'old-refresh',
      'browser-1',
      'csrf',
      'csrf',
      response as never,
    )).resolves.toEqual({ refreshed: true });
    expect(security.requireCsrf).toHaveBeenCalledWith(
      'user-1', 'browser-1', 'csrf', 'csrf',
    );
    expect(identity.refreshToken).toHaveBeenCalledWith(
      'old-refresh', 'browser-1',
    );
    expect(response.cookie).toHaveBeenCalledTimes(2);
  });

  it('reads the current database role into the browser session response', async () => {
    const service = new BrowserAuthService(
      {
        getProfile: jest.fn().mockResolvedValue({
          id: 'admin-1',
          uid: 'OC-ADMIN001',
          email: 'admin@example.test',
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({ role: 'SUPERADMIN' }),
        },
      } as never,
      {} as never,
    );
    await expect(service.session('admin-1')).resolves.toMatchObject({
      id: 'admin-1',
      role: 'SUPERADMIN',
    });
  });

  it('logs out the authenticated device and clears every browser cookie on its original path', async () => {
    const identity = {
      logout: jest.fn().mockResolvedValue({ message: 'Logged out successfully' }),
    };
    const security = {
      cookieOptions: jest.fn((
        maxAge: number,
        httpOnly: boolean,
        path: string,
      ) => ({ maxAge, httpOnly, path, secure: true, sameSite: 'strict' })),
    };
    const response = { clearCookie: jest.fn() };
    const service = new BrowserAuthService(
      identity as never,
      {} as never,
      {} as never,
      security as never,
      {} as never,
      {} as never,
    );

    await expect(service.logout(
      'user-1',
      'browser-device',
      response as never,
    )).resolves.toEqual({ loggedOut: true });
    expect(identity.logout).toHaveBeenCalledWith(
      'user-1',
      'browser-device',
      'browser-device',
    );
    expect(response.clearCookie).toHaveBeenCalledTimes(
      Object.keys(BROWSER_COOKIE_NAMES).length,
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      BROWSER_COOKIE_NAMES.csrf,
      expect.objectContaining({ httpOnly: false, path: '/' }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      BROWSER_COOKIE_NAMES.refresh,
      expect.objectContaining({
        httpOnly: true,
        path: '/api/portal/auth',
      }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      BROWSER_COOKIE_NAMES.device,
      expect.objectContaining({
        httpOnly: true,
        path: '/api/portal/auth',
      }),
    );
    expect(response.clearCookie).toHaveBeenCalledWith(
      BROWSER_COOKIE_NAMES.access,
      expect.objectContaining({ httpOnly: true, path: '/api' }),
    );
  });
});
