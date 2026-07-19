import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import { PortalController } from '../src/portal/portal.controller';
import { PortalService } from '../src/portal/portal.service';
import { BrowserAuthService } from '../src/portal/browser-auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { BrowserSecurityService } from '../src/common/browser-security.service';
import { BrowserCsrfGuard } from '../src/common/guards/browser-csrf.guard';
import { PortalRateLimitGuard } from '../src/common/guards/portal-rate-limit.guard';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';

@Injectable()
class TestPortalAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization as string | undefined;
    const cookie = request.headers.cookie as string | undefined;
    const credential = authorization?.replace(/^Bearer /, '')
      ?? /(?:^|;\s*)oc_access=([^;]+)/.exec(cookie ?? '')?.[1];
    if (!credential) return false;
    request.user = {
      id: 'user-1',
      deviceId: 'browser-device',
      email: 'user@example.test',
      username: 'User',
    };
    return true;
  }
}

describe('Portal owned data controls (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const csrfToken = 'csrf-token';
  const portal = {
    deleteNotifications: jest.fn().mockResolvedValue({ deleted: 2 }),
    deleteSharedDiscoveries: jest.fn(),
    deleteSupersededAssetPacks: jest.fn(),
    deleteAccount: jest.fn().mockResolvedValue({ deleted: true }),
  };
  const browserAuth = { clearCookies: jest.fn() };

  beforeAll(async () => {
    const csrfHash = createHash('sha256').update(csrfToken).digest('hex');
    const moduleRef = await Test.createTestingModule({
      controllers: [PortalController],
      providers: [
        { provide: PortalService, useValue: portal },
        { provide: BrowserAuthService, useValue: browserAuth },
        {
          provide: PrismaService,
          useValue: {
            deviceSession: {
              findUnique: jest.fn().mockResolvedValue({
                csrfTokenHash: csrfHash,
                revokedAt: null,
                expiresAt: new Date(Date.now() + 60_000),
              }),
            },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, fallback?: string) => ({
              PORTAL_ORIGINS: 'http://localhost:4173',
              CORS_ORIGIN: 'http://localhost:4173',
              PORTAL_COOKIE_SECURE: 'false',
              PORTAL_COOKIE_SAME_SITE: 'strict',
            } as Record<string, string>)[key] ?? fallback),
          },
        },
        BrowserSecurityService,
        BrowserCsrfGuard,
        PortalRateLimitGuard,
        Reflector,
        { provide: APP_GUARD, useClass: TestPortalAuthenticationGuard },
        { provide: APP_GUARD, useClass: BrowserCsrfGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires exact confirmation before an owned cleanup call', async () => {
    const response = await fetch(`${baseUrl}/api/portal/data/notifications`, {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer user',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'delete' }),
    });
    expect(response.status).toBe(400);
    expect(portal.deleteNotifications).not.toHaveBeenCalled();

    const allowed = await fetch(`${baseUrl}/api/portal/data/notifications`, {
      method: 'DELETE',
      headers: {
        authorization: 'Bearer user',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'DELETE' }),
    });
    expect(allowed.status).toBe(200);
    expect(portal.deleteNotifications).toHaveBeenCalledWith('user-1');
  });

  it('requires session-bound CSRF for cookie account deletion', async () => {
    const cookie = `oc_access=user; oc_csrf=${csrfToken}`;
    const missing = await fetch(`${baseUrl}/api/portal/account`, {
      method: 'DELETE',
      headers: {
        cookie,
        origin: 'http://localhost:4173',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }),
    });
    expect(missing.status).toBe(403);
    expect(portal.deleteAccount).not.toHaveBeenCalled();

    const allowed = await fetch(`${baseUrl}/api/portal/account`, {
      method: 'DELETE',
      headers: {
        cookie,
        origin: 'http://localhost:4173',
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ confirmation: 'DELETE MY ACCOUNT' }),
    });
    expect(allowed.status).toBe(200);
    expect(portal.deleteAccount).toHaveBeenCalledWith('user-1');
    expect(browserAuth.clearCookies).toHaveBeenCalled();
  });
});
