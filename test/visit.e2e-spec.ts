import { INestApplication, Injectable, Module, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportModule, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Test } from '@nestjs/testing';
import { SocialRateLimitGuard } from '../src/common/guards/social-rate-limit.guard';
import { VisitInvitationController, VisitSessionController } from '../src/visit/visit.controller';
import { VisitService } from '../src/visit/visit.service';

const ownerId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';
const invitationId = '33333333-3333-4333-8333-333333333333';
const sessionId = '44444444-4444-4444-8444-444444444444';

@Injectable()
class E2eJwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() { super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: 'visit-e2e-secret' }); }
  validate(payload: { sub: string }) { return { id: payload.sub }; }
}

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
  controllers: [VisitInvitationController, VisitSessionController],
  providers: [E2eJwtStrategy, SocialRateLimitGuard, { provide: VisitService, useValue: {} }],
})
class VisitE2eModule {}

describe('Visit HTTP contract (e2e)', () => {
  let app: INestApplication;
  let baseUrl: string;
  const visits = {
    listInvitations: jest.fn(), createInvitation: jest.fn(), acceptInvitation: jest.fn(), declineInvitation: jest.fn(), cancelInvitation: jest.fn(),
    listSessions: jest.fn(), getSession: jest.fn(), markReady: jest.fn(), startSession: jest.fn(), endSession: jest.fn(), heartbeat: jest.fn(), getSessionManifest: jest.fn(), createSessionDownloadUrls: jest.fn(),
  };
  const token = new JwtService({ secret: 'visit-e2e-secret' }).sign({ sub: ownerId });
  const headers = { authorization: `Bearer ${token}` };

  beforeEach(() => { Object.values(visits).forEach((fn) => fn.mockReset()); });
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [VisitE2eModule] }).overrideProvider(VisitService).useValue(visits).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });
  afterAll(async () => { await app?.close(); });

  it('authenticates, validates, and forwards invitation routes without client-owned snapshot fields', async () => {
    visits.createInvitation.mockResolvedValue({ id: invitationId, status: 'pending' });
    const response = await fetch(`${baseUrl}/api/visit-invitations`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ hostUserId: hostId }) });
    expect(response.status).toBe(201);
    expect(visits.createInvitation).toHaveBeenCalledWith(ownerId, hostId);

    const rejectedSnapshot = await fetch(`${baseUrl}/api/visit-invitations`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ hostUserId: hostId, assetPackId: invitationId }) });
    expect(rejectedSnapshot.status).toBe(400);

    const invalid = await fetch(`${baseUrl}/api/visit-invitations`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ hostUserId: 'not-a-uuid' }) });
    expect(invalid.status).toBe(400);
  });

  it('exposes the complete session lifecycle and session-scoped asset routes to authenticated callers', async () => {
    visits.listInvitations.mockResolvedValue([]); visits.listSessions.mockResolvedValue([]); visits.getSession.mockResolvedValue({ id: sessionId }); visits.markReady.mockResolvedValue({ id: sessionId }); visits.startSession.mockResolvedValue({ id: sessionId }); visits.endSession.mockResolvedValue({ id: sessionId }); visits.heartbeat.mockResolvedValue({ id: sessionId }); visits.getSessionManifest.mockResolvedValue({ manifest: {}, files: [] }); visits.createSessionDownloadUrls.mockResolvedValue({ downloads: [] });
    expect((await fetch(`${baseUrl}/api/visit-invitations?direction=incoming`, { headers })).status).toBe(200);
    expect(visits.listInvitations).toHaveBeenCalledWith(ownerId, 'incoming', undefined);
    expect((await fetch(`${baseUrl}/api/visit-sessions`, { headers })).status).toBe(200);
    for (const action of ['ready', 'start', 'end', 'heartbeat']) expect((await fetch(`${baseUrl}/api/visit-sessions/${sessionId}/${action}`, { method: 'POST', headers })).status).toBe(201);
    expect((await fetch(`${baseUrl}/api/visit-sessions/${sessionId}/assets/manifest`, { headers })).status).toBe(200);
    const urls = await fetch(`${baseUrl}/api/visit-sessions/${sessionId}/assets/download-urls`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ fileIds: [invitationId] }) });
    expect(urls.status).toBe(201);
    expect(visits.createSessionDownloadUrls).toHaveBeenCalledWith(ownerId, sessionId, [invitationId]);
  });
});
