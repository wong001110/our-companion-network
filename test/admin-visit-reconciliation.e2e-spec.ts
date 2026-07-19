import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
  ValidationPipe,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AdminApiService } from '../src/admin/admin-api.service';
import { AdminController } from '../src/admin/admin.controller';
import { AuditService } from '../src/admin/audit.service';
import { PortalRateLimitGuard } from '../src/common/guards/portal-rate-limit.guard';
import { PrismaService } from '../src/prisma/prisma.service';
import { SuperadminGuard } from '../src/admin/superadmin.guard';

@Injectable()
class TestAuthenticationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const credential = String(request.headers.authorization ?? '')
      .replace(/^Bearer /, '');
    request.user = {
      id: credential === 'admin' ? 'admin-1' : 'user-1',
      email: 'actor@example.test',
      username: 'Actor',
      deviceId: 'browser-device',
    };
    return true;
  }
}

describe('Admin Visit reconciliation HTTP contract (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const sessionId = '40000000-0000-4000-8000-000000000001';
  const reconcileVisitSession = jest.fn().mockResolvedValue({
    id: sessionId,
    state: 'ended',
    assetPackRefId: null,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController],
      providers: [
        {
          provide: AdminApiService,
          useValue: { reconcileVisitSession },
        },
        { provide: AuditService, useValue: { list: jest.fn() } },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(({ where }) => Promise.resolve({
                role: where.id === 'admin-1' ? 'SUPERADMIN' : 'USER',
              })),
            },
          },
        },
        PortalRateLimitGuard,
        SuperadminGuard,
        { provide: APP_GUARD, useClass: TestAuthenticationGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('requires a DB-current SUPERADMIN and a meaningful reason', async () => {
    const rejected = await fetch(
      `${baseUrl}/api/admin/visit-sessions/${sessionId}/reconcile`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer user',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Session is stale' }),
      },
    );
    expect(rejected.status).toBe(403);

    const invalid = await fetch(
      `${baseUrl}/api/admin/visit-sessions/${sessionId}/reconcile`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'no' }),
      },
    );
    expect(invalid.status).toBe(400);
    expect(reconcileVisitSession).not.toHaveBeenCalled();

    const accepted = await fetch(
      `${baseUrl}/api/admin/visit-sessions/${sessionId}/reconcile`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer admin',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ reason: 'Both participant heartbeats are stale' }),
      },
    );
    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toMatchObject({
      id: sessionId,
      state: 'ended',
      assetPackRefId: null,
    });
    expect(reconcileVisitSession).toHaveBeenCalledWith(
      'admin-1',
      sessionId,
      'Both participant heartbeats are stale',
    );
  });
});
