from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'anchor not found in {path}: {old[:180]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


# ---------------------------------------------------------------------------
# Runtime: release reservations on every terminal transition.
# ---------------------------------------------------------------------------
replace_once(
    'src/visit/visit.service.ts',
    '''      if (invitation.expiresAt <= new Date()) {
        return { invitation: await tx.visitInvitation.update({ where: { id: invitation.id }, data: { status: 'expired', respondedAt: new Date(), assetPackRefId: null }, select: INVITATION_SELECT }), expired: true };
      }''',
    '''      if (invitation.expiresAt <= new Date()) {
        const expiredInvitation = await tx.visitInvitation.update({ where: { id: invitation.id }, data: { status: 'expired', respondedAt: new Date(), assetPackRefId: null }, select: INVITATION_SELECT });
        await tx.visitReservation.deleteMany({ where: { userId: invitation.visitorOwnerUserId, invitationId: invitation.id } });
        return { invitation: expiredInvitation, expired: true };
      }''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''      if (claimed.count) this.publishSession(await this.prisma.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }), 'visit.session.ended');
    }
  }

  async endSessionsForCompanion''',
    '''      if (claimed.count) {
        await this.prisma.visitReservation.deleteMany({ where: { sessionId: session.id } });
        await this.prisma.visitSessionParticipant.updateMany({ where: { sessionId: session.id, state: { not: 'left' } }, data: { state: 'left', leftAt: new Date(), assetPackRefId: null } });
        this.publishSession(await this.prisma.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }), 'visit.session.ended');
      }
    }
  }

  async endSessionsForCompanion''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''      if (claimed.count) this.publishSession(await this.prisma.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }), 'visit.session.ended');
    }
  }

  async revokeCompanionVisits''',
    '''      if (claimed.count) {
        await this.prisma.visitReservation.deleteMany({ where: { sessionId: session.id } });
        await this.prisma.visitSessionParticipant.updateMany({ where: { sessionId: session.id, state: { not: 'left' } }, data: { state: 'left', leftAt: new Date(), assetPackRefId: null } });
        this.publishSession(await this.prisma.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }), 'visit.session.ended');
      }
    }
  }

  async revokeCompanionVisits''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''        if (changed.count) changedInvitations.push(await tx.visitInvitation.findUniqueOrThrow({ where: { id: invitation.id }, select: INVITATION_SELECT }));''',
    '''        if (changed.count) {
          await tx.visitReservation.deleteMany({ where: { invitationId: invitation.id } });
          changedInvitations.push(await tx.visitInvitation.findUniqueOrThrow({ where: { id: invitation.id }, select: INVITATION_SELECT }));
        }''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''        if (changed.count) changedSessions.push(await tx.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }));''',
    '''        if (changed.count) {
          await this.releaseSessionReservations(tx, session.id);
          changedSessions.push(await tx.visitSession.findUniqueOrThrow({ where: { id: session.id }, select: SESSION_SELECT }));
        }''',
)

# Guest heartbeat keeps a newly accepted third Companion present before and after start.
replace_once(
    'src/visit/visit.service.ts',
    '''  async heartbeat(userId: string, sessionId: string) {
    const session = await this.prisma.visitSession.findUnique({ where: { id: sessionId }, select: { id: true, visitorOwnerUserId: true, hostUserId: true, state: true } });
    if (!session) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
    const role = this.roleFor(session, userId);
    if (!role) throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit session is not available' });
    if (!SESSION_HEARTBEAT.includes(session.state)) throw new ConflictException({ code: 'VISIT_SESSION_STATE_CHANGED', message: 'Visit session is not available' });
    await this.assertEligible(this.prisma as any, session.visitorOwnerUserId, session.hostUserId);
    const updated = await this.prisma.visitSession.update({ where: { id: session.id }, data: role === 'owner' ? { visitorOwnerSeenAt: new Date() } : { hostSeenAt: new Date() }, select: SESSION_SELECT });
    return this.sessionSummary(updated);
  }''',
    '''  async heartbeat(userId: string, sessionId: string) {
    const session = await this.prisma.visitSession.findUnique({ where: { id: sessionId }, select: SESSION_SELECT });
    if (!session) throw new NotFoundException({ code: 'VISIT_SESSION_NOT_FOUND', message: 'Visit session was not found' });
    if (!SESSION_HEARTBEAT.includes(session.state)) throw new ConflictException({ code: 'VISIT_SESSION_STATE_CHANGED', message: 'Visit session is not available' });
    const role = this.roleFor(session, userId);
    const participant = await this.prisma.visitSessionParticipant.findUnique({ where: { sessionId_userId: { sessionId, userId } }, select: { id: true, state: true } });
    if (!role && (!participant || participant.state === 'left')) throw new ForbiddenException({ code: 'VISIT_SESSION_NOT_PARTICIPANT', message: 'Visit session is not available' });
    const peers = await this.prisma.visitSessionParticipant.findMany({ where: { sessionId, state: { not: 'left' }, userId: { not: userId } }, select: { userId: true } });
    for (const peer of peers) await this.assertEligible(this.prisma as any, userId, peer.userId);
    const seenAt = new Date();
    await this.prisma.visitSessionParticipant.updateMany({ where: { sessionId, userId, state: { not: 'left' } }, data: { seenAt } });
    if (!role) return this.sessionSummary(session);
    const updated = await this.prisma.visitSession.update({ where: { id: session.id }, data: role === 'owner' ? { visitorOwnerSeenAt: seenAt } : { hostSeenAt: seenAt }, select: SESSION_SELECT });
    return this.sessionSummary(updated);
  }''',
)

# Reservation-aware Companion mutation boundaries: no-op activation is allowed,
# but switching, unpublishing, or activating another Asset Pack is blocked.
replace_once(
    'src/visit/visit.service.ts',
    '''  async assertCompanionAvailable(userId: string): Promise<void> {
    const reservation = await this.prisma.visitReservation.findUnique({ where: { userId }, select: { kind: true } });
    if (reservation) throw new ConflictException({ code: 'VISIT_COMPANION_RESERVED', message: 'The active Companion is reserved for a Visit' });
  }''',
    '''  async assertCanSwitchToCompanion(userId: string, companionId: string): Promise<void> {
    const reservation = await this.prisma.visitReservation.findUnique({ where: { userId }, select: { networkCompanionId: true } });
    if (reservation && reservation.networkCompanionId !== companionId) throw new ConflictException({ code: 'VISIT_COMPANION_RESERVED', message: 'The active Companion is reserved for a Visit' });
  }

  async assertCompanionMutationAllowed(userId: string, companionId: string): Promise<void> {
    const reservation = await this.prisma.visitReservation.findUnique({ where: { userId }, select: { networkCompanionId: true } });
    if (reservation?.networkCompanionId === companionId) throw new ConflictException({ code: 'VISIT_COMPANION_RESERVED', message: 'The active Companion is reserved for a Visit' });
  }''',
)
replace_once(
    'src/companion/companion.service.ts',
    '''    await this.visits?.assertCompanionAvailable(userId);
    const companion = await this.requireOwnedCompanion(userId, companionId);''',
    '''    await this.visits?.assertCanSwitchToCompanion(userId, companionId);
    const companion = await this.requireOwnedCompanion(userId, companionId);''',
)
replace_once(
    'src/companion/companion.service.ts',
    '''    await this.visits?.assertCompanionAvailable(userId);
    const companion = await this.prisma.$transaction''',
    '''    await this.visits?.assertCompanionMutationAllowed(userId, companionId);
    const companion = await this.prisma.$transaction''',
)
replace_once(
    'src/companion/companion.service.ts',
    '''  async activateAssetPack(userId: string, assetPackId: string) {
    const ownedPack = await this.requireOwnedPack(userId, assetPackId, true);''',
    '''  async activateAssetPack(userId: string, assetPackId: string) {
    const ownedPack = await this.requireOwnedPack(userId, assetPackId, true);
    await this.visits?.assertCompanionMutationAllowed(userId, ownedPack.companionId);''',
)

# ---------------------------------------------------------------------------
# Existing lifecycle fixtures now include the reservation model.
# ---------------------------------------------------------------------------
spec = Path('src/visit/visit.service.spec.ts')
source = spec.read_text(encoding='utf-8')
helper_anchor = '''function service(prisma: Record<string, unknown> = {}) {'''
helpers = '''function emptyReservationModel() {
  return {
    findUnique: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
}

function acceptanceReservationModel() {
  return {
    findUnique: jest.fn(({ where }: { where: { userId: string } }) => Promise.resolve(
      where.userId === owner
        ? { userId: owner, kind: 'outgoing_invitation', invitationId, networkCompanionId: companionId }
        : null,
    )),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
}

'''
if helpers.strip() not in source:
    if helper_anchor not in source:
        raise SystemExit('VisitService spec helper anchor not found')
    source = source.replace(helper_anchor, helpers + helper_anchor, 1)

source = source.replace(
    '''      visitSession: { findFirst: jest.fn().mockResolvedValue(null) },
      visitInvitation: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(created) },''',
    '''      visitSession: { findFirst: jest.fn().mockResolvedValue(null) },
      visitReservation: emptyReservationModel(),
      visitInvitation: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue(created) },''',
    1,
)
source = source.replace(
    '''      visitSession: { findFirst: jest.fn().mockResolvedValue(null) }, visitInvitation: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },''',
    '''      visitSession: { findFirst: jest.fn().mockResolvedValue(null) }, visitReservation: emptyReservationModel(), visitInvitation: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },''',
    1,
)
for anchor in [
    '''      visitSession: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create: jest.fn() },
      visitInvitation:''',
    '''      visitSession: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(2), create: jest.fn() },
      visitInvitation:''',
    '''      visitSession: { findFirst: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'host-outgoing' }), count: jest.fn().mockResolvedValue(0), create: jest.fn() },
      visitInvitation:''',
]:
    if anchor not in source:
        raise SystemExit(f'VisitService acceptance fixture anchor not found: {anchor[:100]!r}')
    source = source.replace(anchor, anchor.replace('\n      visitInvitation:', '\n      visitReservation: acceptanceReservationModel(),\n      visitInvitation:'), 1)

# Revocation fixture models reservation/participant cleanup.
source = source.replace(
    '''    const prisma = { visitSession: { findMany: jest.fn().mockResolvedValue([{ id: sessionId, state: 'active' }]), findUniqueOrThrow: jest.fn().mockResolvedValue(updated), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };''',
    '''    const prisma = {
      visitSession: { findMany: jest.fn().mockResolvedValue([{ id: sessionId, state: 'active' }]), findUniqueOrThrow: jest.fn().mockResolvedValue(updated), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      visitReservation: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      visitSessionParticipant: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };''',
    1,
)
spec.write_text(source, encoding='utf-8')

# Static contract assertions must survive prisma format and the new Room Topic path.
room_spec = Path('src/visit/visit-room-reservation.spec.ts')
source = room_spec.read_text(encoding='utf-8')
source = source.replace(
    "expect(schema).toContain('userId              String           @id');",
    "expect(schema).toMatch(/model VisitReservation[\\s\\S]*userId\\s+String\\s+@id/);",
)
room_spec.write_text(source, encoding='utf-8')

topic_spec = Path('src/visit/random-visit-topic.spec.ts')
source = topic_spec.read_text(encoding='utf-8')
source = source.replace(
    "expect(source).toContain('socialShare: { create:');",
    "expect(source).toContain('tx.visitRoomTopic.create');\n    expect(source).toContain('tx.visitShareEnvelope.create');",
)
topic_spec.write_text(source, encoding='utf-8')

# Runtime static guards.
room_contract = Path('src/visit/visit-room-reservation.spec.ts')
source = room_contract.read_text(encoding='utf-8')
old = '''    expect(visitSource).toContain('VISIT_COMPANION_RESERVED');
  });'''
new = '''    expect(visitSource).toContain('VISIT_COMPANION_RESERVED');
    expect(visitSource).toContain('expiredInvitation');
    expect(visitSource).toContain('assertCanSwitchToCompanion');
    expect(visitSource).toContain('assertCompanionMutationAllowed');
  });'''
if old not in source:
    raise SystemExit('Visit room runtime contract anchor not found')
room_contract.write_text(source.replace(old, new, 1), encoding='utf-8')
