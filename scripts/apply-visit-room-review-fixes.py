from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'anchor not found in {path}: {old[:180]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


# One request per status allows a declined/cancelled request to be retried while
# still preventing duplicate pending requests in the same room.
replace_once(
    'prisma/schema.prisma',
    '''  @@unique([sessionId, requesterUserId])
  @@index([sessionId, status])''',
    '''  @@unique([sessionId, requesterUserId, status])
  @@index([sessionId, status])''',
)
replace_once(
    'prisma/migrations/20260731050000_visit_reservations_room_membership/migration.sql',
    '''CREATE UNIQUE INDEX "VisitJoinRequest_sessionId_requesterUserId_key" ON "VisitJoinRequest"("sessionId", "requesterUserId");''',
    '''CREATE UNIQUE INDEX "VisitJoinRequest_sessionId_requesterUserId_status_key" ON "VisitJoinRequest"("sessionId", "requesterUserId", "status");''',
)

# Completing a non-active pack activates it, so it is a blocked Companion
# mutation while that Companion is reserved for a Visit.
replace_once(
    'src/companion/companion.service.ts',
    '''    const ownedPack = await this.requireOwnedPack(userId, assetPackId, true);
    if (ownedPack.status === 'active') return this.completeEnvelopeForActivePack(ownedPack);
    this.requireStorage();''',
    '''    const ownedPack = await this.requireOwnedPack(userId, assetPackId, true);
    if (ownedPack.status === 'active') return this.completeEnvelopeForActivePack(ownedPack);
    await this.visits?.assertCompanionMutationAllowed(userId, ownedPack.companionId);
    this.requireStorage();''',
)

# Existing accepted/expired result branches expose a stable displaced list.
replace_once(
    'src/visit/visit.service.ts',
    '''      if (invitation.status === 'accepted' && invitation.session) return { invitation, session: invitation.session, changed: false };''',
    '''      if (invitation.status === 'accepted' && invitation.session) return { invitation, session: invitation.session, changed: false, displacedInvitations: [] };''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''        return { invitation: expiredInvitation, expired: true };''',
    '''        return { invitation: expiredInvitation, expired: true, displacedInvitations: [] };''',
)

# Accepting one Visit consumes the Host's only reservation slot. Decline every
# other pending incoming invitation and release those visitors immediately.
replace_once(
    'src/visit/visit.service.ts',
    '''      if (invitation.topicTitle && invitation.topicSummary && invitation.topicCreatedByUserId && invitation.topicOwnerCompanionId) {''',
    '''      const displacedInvitations = await tx.visitInvitation.findMany({
        where: { hostUserId: invitation.hostUserId, status: PENDING, id: { not: invitation.id } },
        select: INVITATION_SELECT,
      });
      if (displacedInvitations.length) {
        const displacedIds = displacedInvitations.map((item) => item.id);
        await tx.visitInvitation.updateMany({
          where: { id: { in: displacedIds }, status: PENDING },
          data: { status: 'declined', respondedAt: new Date(), assetPackRefId: null },
        });
        await tx.visitReservation.deleteMany({ where: { invitationId: { in: displacedIds } } });
      }
      if (invitation.topicTitle && invitation.topicSummary && invitation.topicCreatedByUserId && invitation.topicOwnerCompanionId) {''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''      return { invitation: accepted, session, participants, changed: true, expired: false };''',
    '''      return { invitation: accepted, session, participants, displacedInvitations, changed: true, expired: false };''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''    this.publishInvitation(result.invitation, 'visit.invitation.updated');
    if (result.changed) this.publishSession(result.session, 'visit.session.created');''',
    '''    this.publishInvitation(result.invitation, 'visit.invitation.updated');
    result.displacedInvitations.forEach((invitation) => this.publishInvitation({ ...invitation, status: 'declined' }, 'visit.invitation.updated'));
    if (result.changed) this.publishSession(result.session, 'visit.session.created');''',
)

# Expire third-party join requests and release their user-keyed reservations.
replace_once(
    'src/visit/visit.service.ts',
    '''      const sessions = await this.prisma.visitSession.findMany({ take: limit, where: { state: { in: SESSION_LIVE } }, select: { id: true, state: true, createdAt: true, readyAt: true, startedAt: true, visitorOwnerSeenAt: true, hostSeenAt: true } });''',
    '''      const expiredJoinRequests = await this.prisma.visitJoinRequest.findMany({
        take: limit,
        where: { status: PENDING, expiresAt: { lt: now } },
        select: { id: true, sessionId: true, requesterUserId: true },
      });
      for (const request of expiredJoinRequests) {
        const updated = await this.prisma.visitJoinRequest.updateMany({
          where: { id: request.id, status: PENDING, expiresAt: { lt: now } },
          data: { status: 'expired', respondedAt: now, assetPackRefId: null },
        });
        if (!updated.count) continue;
        await this.prisma.visitReservation.deleteMany({ where: { userId: request.requesterUserId, joinRequestId: request.id } });
        this.events.publishToUser(request.requesterUserId, 'visit.join_request.updated', { sessionId: request.sessionId, joinRequestId: request.id });
        const participants = await this.prisma.visitSessionParticipant.findMany({ where: { sessionId: request.sessionId, state: { not: 'left' } }, select: { userId: true } });
        for (const participant of participants) this.events.publishToUser(participant.userId, 'visit.join_request.updated', { sessionId: request.sessionId, joinRequestId: request.id });
      }
      const sessions = await this.prisma.visitSession.findMany({ take: limit, where: { state: { in: SESSION_LIVE } }, select: { id: true, state: true, createdAt: true, readyAt: true, startedAt: true, visitorOwnerSeenAt: true, hostSeenAt: true } });''',
)

# Decline/cancel notifications include the requester, who is not yet a room member.
replace_once(
    'src/visit/visit-room.service.ts',
    '''    await this.publishRoom(request.sessionId, 'visit.join_request.updated', { joinRequestId: request.id });
    return this.joinSummary(request);''',
    '''    this.events.publishToUser(request.requesterUserId, 'visit.join_request.updated', { sessionId: request.sessionId, joinRequestId: request.id });
    await this.publishRoom(request.sessionId, 'visit.join_request.updated', { joinRequestId: request.id });
    return this.joinSummary(request);''',
)

# Account deletion must release both the deleting user's reservation and every
# counterpart locked by an affected invitation/session.
replace_once(
    'src/portal/portal.service.ts',
    '''      const deletionRequestedAt = account.deletionRequestedAt ?? new Date();
      await tx.user.update({''',
    '''      const deletionRequestedAt = account.deletionRequestedAt ?? new Date();
      const [affectedInvitations, affectedSessions] = await Promise.all([
        tx.visitInvitation.findMany({
          where: { status: 'pending', OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }] },
          select: { id: true },
        }),
        tx.visitSession.findMany({
          where: { state: { in: ['preparing', 'ready', 'active', 'ending'] }, OR: [{ visitorOwnerUserId: userId }, { hostUserId: userId }, { participants: { some: { userId, state: { not: 'left' } } } }] },
          select: { id: true },
        }),
      ]);
      await tx.user.update({''',
)
replace_once(
    'src/portal/portal.service.ts',
    '''      await tx.networkCompanion.updateMany({
        where: { ownerUserId: userId },''',
    '''      await tx.visitReservation.deleteMany({
        where: {
          OR: [
            { userId },
            { invitationId: { in: affectedInvitations.map((item) => item.id) } },
            { sessionId: { in: affectedSessions.map((item) => item.id) } },
          ],
        },
      });
      await tx.visitSessionParticipant.updateMany({
        where: { sessionId: { in: affectedSessions.map((item) => item.id) }, state: { not: 'left' } },
        data: { state: 'left', leftAt: deletionRequestedAt, assetPackRefId: null },
      });
      await tx.visitJoinRequest.updateMany({
        where: { requesterUserId: userId, status: 'pending' },
        data: { status: 'cancelled', cancelledAt: deletionRequestedAt, assetPackRefId: null },
      });
      await tx.networkCompanion.updateMany({
        where: { ownerUserId: userId },''',
)

# Regression contracts for review findings.
spec = Path('src/visit/visit-room-reservation.spec.ts')
source = spec.read_text(encoding='utf-8')
old = '''    expect(visitSource).toContain('assertCompanionMutationAllowed');
  });'''
new = '''    expect(visitSource).toContain('assertCompanionMutationAllowed');
    expect(visitSource).toContain('expiredJoinRequests');
    expect(visitSource).toContain('displacedInvitations');
  });'''
if old not in source:
    raise SystemExit('Visit room review test anchor not found')
spec.write_text(source.replace(old, new, 1), encoding='utf-8')

companion_spec = Path('src/companion/shareable-topics.spec.ts')
source = companion_spec.read_text(encoding='utf-8')
if "assertCompanionMutationAllowed(userId, ownedPack.companionId)" not in Path('src/companion/companion.service.ts').read_text(encoding='utf-8'):
    raise SystemExit('Asset Pack completion reservation guard missing')
