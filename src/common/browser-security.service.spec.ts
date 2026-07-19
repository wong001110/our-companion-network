import { ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { BrowserSecurityService } from './browser-security.service';

const configValues: Record<string, string> = {
  PORTAL_ORIGINS: 'https://portal.example.test,http://localhost:3000',
  CORS_ORIGIN: 'http://localhost:3000',
  PORTAL_COOKIE_SECURE: 'true',
  PORTAL_COOKIE_SAME_SITE: 'strict',
};

describe('BrowserSecurityService', () => {
  it('accepts only exact configured origins and emits secure cookie defaults', () => {
    const service = new BrowserSecurityService({
      get: jest.fn((key: string, fallback?: string) => configValues[key] ?? fallback),
    } as never, {} as never);
    expect(service.isAllowedOrigin('https://portal.example.test')).toBe(true);
    expect(service.isAllowedOrigin('https://portal.example.test.evil')).toBe(false);
    expect(service.isAllowedOrigin('https://portal.example.test/path')).toBe(false);
    expect(service.cookieOptions(60_000)).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api',
    });
  });

  it('parses encoded cookies without treating malformed values as trusted data', () => {
    const service = new BrowserSecurityService({
      get: jest.fn((key: string, fallback?: string) => configValues[key] ?? fallback),
    } as never, {} as never);
    expect(service.parseCookies({
      headers: { cookie: 'oc_access=a%2Eb; oc_csrf=%ZZ; ignored' },
    } as never)).toEqual({ oc_access: 'a.b', oc_csrf: '%ZZ' });
  });

  it('binds CSRF to the active device session and rejects mismatches', async () => {
    const token = 'csrf-token';
    const hash = createHash('sha256').update(token).digest('hex');
    const findUnique = jest.fn().mockResolvedValue({
      csrfTokenHash: hash,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new BrowserSecurityService({
      get: jest.fn((key: string, fallback?: string) => configValues[key] ?? fallback),
    } as never, {
      deviceSession: { findUnique },
    } as never);
    await expect(service.requireCsrf('user-1', 'device-1', token, token))
      .resolves.toBeUndefined();
    await expect(service.requireCsrf('user-1', 'device-1', token, 'wrong'))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        userId_deviceId: { userId: 'user-1', deviceId: 'device-1' },
      },
    }));
  });
});
