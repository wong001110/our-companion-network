import { ConflictException, ForbiddenException } from '@nestjs/common';
import { VisitSocialService } from './visit-social.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('VisitSocialService security boundaries', () => {
  it('uses an insert-winner Shared Moment contract before updating relationships', () => {
    const source = readFileSync(join(__dirname, 'visit-social.service.ts'), 'utf8');
    expect(source).toContain('ON CONFLICT ("sessionId") DO NOTHING');
    expect(source).toContain('if (inserted[0])');
    expect(source.indexOf('if (inserted[0])')).toBeLessThan(source.indexOf('await this.updateRelationship'));
    expect(source).toContain('Prisma.join(tags)');
  });

  const session = {
    id: 'session-1',
    invitationId: 'invitation-1',
    visitorOwnerUserId: 'owner',
    hostUserId: 'host',
    state: 'active',
    startedAt: new Date(),
    endedAt: null,
  };

  it('rejects a non-participant before reading social content', async () => {
    const prisma = {
      visitSession: { findUnique: jest.fn().mockResolvedValue(session) },
      $queryRaw: jest.fn(),
    };
    const events = { publishToUser: jest.fn() };
    const service = new VisitSocialService(prisma as never, events as never);

    await expect(service.getState('intruder', session.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('allows only the visiting Companion owner to attach the approved Discovery', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      visitSession: { findUnique: jest.fn().mockResolvedValue(session) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)),
    };
    const events = { publishToUser: jest.fn() };
    const service = new VisitSocialService(prisma as never, events as never);

    await expect(service.setShare('host', session.id, {
      title: 'Approved Discovery',
      summary: 'Only the approved public copy.',
    })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stops the next turn after either participant blocks the other', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      visitSession: { findUnique: jest.fn().mockResolvedValue(session) },
      friendship: { findUnique: jest.fn().mockResolvedValue({ id: 'friendship' }) },
      blockedUser: { findFirst: jest.fn().mockResolvedValue({ id: 'block' }) },
      user: { count: jest.fn().mockResolvedValue(2) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)),
    };
    const events = { publishToUser: jest.fn() };
    const service = new VisitSocialService(prisma as never, events as never);

    await expect(service.appendTurn('owner', session.id, {
      clientTurnId: 'b9377d18-d93e-4f35-ae02-e3c9ddfd469e',
      intent: 'SHARE',
      message: 'This must not be relayed after a block.',
    })).rejects.toBeInstanceOf(ConflictException);
  });

  it('returns an existing turn for a replayed clientTurnId without publishing twice', async () => {
    const existingTurn = {
      id: 'turn-1',
      sessionId: session.id,
      sequence: 1,
      clientTurnId: 'b9377d18-d93e-4f35-ae02-e3c9ddfd469e',
      senderUserId: 'owner',
      intent: 'SHARE',
      message: 'Already relayed.',
      emotion: 'gentle',
      topic: 'music',
      createdAt: new Date(),
    };
    const queryRaw = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'share-1', sessionId: session.id, title: 'Discovery', summary: 'Approved.', tags: [],
        sourceUrl: null, createdByUserId: 'owner', createdAt: new Date(),
      }])
      .mockResolvedValueOnce([existingTurn]);
    const tx = {
      $queryRaw: queryRaw,
      visitSession: { findUnique: jest.fn().mockResolvedValue(session) },
      friendship: { findUnique: jest.fn().mockResolvedValue({ id: 'friendship' }) },
      blockedUser: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { count: jest.fn().mockResolvedValue(2) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: unknown) => unknown) => callback(tx)),
      visitSession: { findUnique: jest.fn() },
    };
    const events = { publishToUser: jest.fn() };
    const service = new VisitSocialService(prisma as never, events as never);

    await expect(service.appendTurn('owner', session.id, {
      clientTurnId: existingTurn.clientTurnId,
      intent: 'SHARE',
      message: 'Replay attempt.',
    })).resolves.toMatchObject({ id: 'turn-1', sequence: 1, message: 'Already relayed.' });
    expect(events.publishToUser).not.toHaveBeenCalled();
  });
});
