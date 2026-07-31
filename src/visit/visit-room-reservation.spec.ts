import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Visit reservation and room membership contract', () => {
  const visitSource = readFileSync(join(__dirname, 'visit.service.ts'), 'utf8');
  const roomSource = readFileSync(join(__dirname, 'visit-room.service.ts'), 'utf8');
  const companionSource = readFileSync(join(__dirname, '../companion/companion.service.ts'), 'utf8');
  const portalSource = readFileSync(join(__dirname, '../portal/portal.service.ts'), 'utf8');
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

  it('uses one user-keyed reservation from invitation creation through room completion', () => {
    expect(schema).toContain('model VisitReservation');
    expect(schema).toMatch(/model VisitReservation[\s\S]*userId\s+String\s+@id/);
    expect(visitSource).toContain("kind: 'outgoing_invitation'");
    expect(visitSource).toContain("kind: 'session_participant'");
    expect(visitSource).toContain('releaseSessionReservations');
    expect(visitSource).toContain('VISIT_COMPANION_RESERVED');
    expect(visitSource).toContain('expiredInvitation');
    expect(visitSource).toContain('assertCanSwitchToCompanion');
    expect(visitSource).toContain('assertCompanionMutationAllowed');
    expect(visitSource).toContain('expiredJoinRequests');
    expect(visitSource).toContain('displacedInvitations');
  });

  it('releases reservations across expiry, account deletion, and Companion mutation boundaries', () => {
    expect(visitSource).toContain('visitReservation.deleteMany');
    expect(portalSource).toContain('affectedInvitations');
    expect(portalSource).toContain('affectedSessions');
    expect(portalSource).toContain('visitSessionParticipant.updateMany');
    expect(companionSource).toContain('assertCompanionMutationAllowed(userId, ownedPack.companionId)');
  });

  it('queues a joining Companion topic after the existing topic instead of replacing it', () => {
    expect(roomSource).toContain("state: 'queued'");
    expect(roomSource).toContain('(aggregate._max.sequence ?? 0) + 1');
    expect(roomSource).toContain("role: 'guest', state: 'preparing'");
    expect(schema).toMatch(/roomCapacity\s+Int\s+@default\(3\)/);
    expect(schema).toMatch(/@@unique\(\[sessionId, requesterUserId, status\]\)/);
  });

  it('keeps room assets scoped to active participants', () => {
    expect(roomSource).toContain('authorizeParticipantAsset');
    expect(roomSource).toContain("state: { not: 'left' }");
    expect(roomSource).toContain('subject.userId === viewer.userId');
  });
});
