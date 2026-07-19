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
import { AdminController } from '../src/admin/admin.controller';
import { AdminApiService } from '../src/admin/admin-api.service';
import { AuditService } from '../src/admin/audit.service';
import { SuperadminGuard } from '../src/admin/superadmin.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { BrowserSecurityService } from '../src/common/browser-security.service';
import { BrowserCsrfGuard } from '../src/common/guards/browser-csrf.guard';
import { PortalRateLimitGuard } from '../src/common/guards/portal-rate-limit.guard';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';

@Injectable()
class TestAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization as string | undefined;
    const cookie = request.headers.cookie as string | undefined;
    const credential = authorization?.replace(/^Bearer /, '')
      ?? /(?:^|;\s*)oc_access=([^;]+)/.exec(cookie ?? '')?.[1];
    if (!credential) return false;
    request.user = {
      id: credential === 'user' ? 'user-1' : 'admin-1',
      deviceId: 'browser-device',
      email: 'actor@example.test',
      username: 'Actor',
    };
    return true;
  }
}

describe('Portal/admin security HTTP contract (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const csrfToken = 'csrf-token';
  const csrfHash = createHash('sha256').update(csrfToken).digest('hex');
  const adminApi = {
    overview: jest.fn().mockResolvedValue({ totalAccounts: 2 }),
    cleanupStorage: jest.fn().mockResolvedValue({ abandoned: 0, removed: 0 }),
  };

  beforeAll(async () => {
    const prisma = {
      user: {
        findUnique: jest.fn(({ where }: any) => Promise.resolve({
          role: where.id === 'admin-1' ? 'SUPERADMIN' : 'USER',
        })),
      },
      deviceSession: {
        findUnique: jest.fn().mockResolvedValue({
          csrfTokenHash: csrfHash,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
    };
    const config = {
      get: jest.fn((key: string, fallback?: string) => ({
        PORTAL_ORIGINS: 'http://localhost:3000',
        CORS_ORIGIN: 'http://localhost:3000',
        PORTAL_COOKIE_SECURE: 'true',
        PORTAL_COOKIE_SAME_SITE: 'strict',
      } as Record<string, string>)[key] ?? fallback),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: config },
        { provide: AdminApiService, useValue: adminApi },
        { provide: AuditService, useValue: { list: jest.fn() } },
        BrowserSecurityService,
        BrowserCsrfGuard,
        SuperadminGuard,
        PortalRateLimitGuard,
        Reflector,
        { provide: APP_GUARD, useClass: TestAuthenticationGuard },
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

  it('rejects USER and permits a DB-current SUPERADMIN', async () => {
    const rejected = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { authorization: 'Bearer user' },
    });
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({
      error: { code: 'SUPERADMIN_REQUIRED' },
    });

    const allowed = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { authorization: 'Bearer admin' },
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ totalAccounts: 2 });
  });

  it('requires allowed origin and session-bound CSRF for cookie mutations', async () => {
    const cookie = `oc_access=admin; oc_csrf=${csrfToken}`;
    const missing = await fetch(`${baseUrl}/api/admin/storage/cleanup`, {
      method: 'POST',
      headers: {
        cookie,
        origin: 'http://localhost:3000',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Routine cleanup' }),
    });
    expect(missing.status).toBe(403);
    expect(await missing.json()).toMatchObject({
      error: { code: 'CSRF_VALIDATION_FAILED' },
    });

    const wrongOrigin = await fetch(`${baseUrl}/api/admin/storage/cleanup`, {
      method: 'POST',
      headers: {
        cookie,
        origin: 'https://evil.example',
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Routine cleanup' }),
    });
    expect(wrongOrigin.status).toBe(403);
    expect(await wrongOrigin.json()).toMatchObject({
      error: { code: 'ORIGIN_NOT_ALLOWED' },
    });

    const allowed = await fetch(`${baseUrl}/api/admin/storage/cleanup`, {
      method: 'POST',
      headers: {
        cookie,
        origin: 'http://localhost:3000',
        'x-csrf-token': csrfToken,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ reason: 'Routine cleanup' }),
    });
    expect(allowed.status).toBe(201);
    expect(adminApi.cleanupStorage).toHaveBeenCalledWith(
      'admin-1',
      'Routine cleanup',
    );
  });

  it('preserves bearer mutations and validates required reasons', async () => {
    const missingReason = await fetch(`${baseUrl}/api/admin/storage/cleanup`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin',
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    expect(missingReason.status).toBe(400);
    expect(await missingReason.json()).toMatchObject({
      error: { code: 'VALIDATION_ERROR' },
    });
  });

  it('returns a secure generic response for unexpected failures', async () => {
    adminApi.overview.mockRejectedValueOnce(
      new Error('DATABASE_URL=postgresql://secret stack trace'),
    );
    const response = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { authorization: 'Bearer admin' },
    });
    expect(response.status).toBe(500);
    const text = await response.text();
    expect(text).toContain('Internal server error');
    expect(text).not.toContain('DATABASE_URL');
    expect(text).not.toContain('stack trace');
  });
});
