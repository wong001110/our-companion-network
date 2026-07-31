from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'anchor not found in {path}: {old[:160]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


# Until a selected-friends allowlist exists, expose only the implemented friends audience.
replace_once(
    'src/companion/dto/shareable-topic.dto.ts',
    "  @IsOptional() @IsIn(['friends', 'selected']) audience?: 'friends' | 'selected';",
    "  @IsOptional() @IsIn(['friends']) audience?: 'friends';",
)
replace_once(
    'src/companion/dto/shareable-topic.dto.ts',
    "  @IsOptional() @IsIn(['friends', 'selected']) randomVisitAudience?: 'friends' | 'selected';",
    "  @IsOptional() @IsIn(['friends']) randomVisitAudience?: 'friends';",
)

# Revoking the last active random topic must close the random-visit policy atomically.
replace_once(
    'src/companion/companion.service.ts',
    '''  async revokeShareableTopic(userId: string, companionId: string, topicId: string) {
    await this.requireOwnedTopic(userId, companionId, topicId);
    const topic = await this.prisma.shareableTopic.update({
      where: { id: topicId },
      data: { revokedAt: new Date(), eligibleForRandomVisit: false },
      select: TOPIC_SELECT,
    });
    await this.publishInvalidation(userId, 'companion.topic.revoked', { ownerUserId: userId, companionId, topicId });
    return this.shareableTopic(topic);
  }''',
    '''  async revokeShareableTopic(userId: string, companionId: string, topicId: string) {
    await this.requireOwnedTopic(userId, companionId, topicId);
    const now = new Date();
    const result = await this.prisma.$transaction(async tx => {
      const topic = await tx.shareableTopic.update({
        where: { id: topicId },
        data: { revokedAt: now, eligibleForRandomVisit: false },
        select: TOPIC_SELECT,
      });
      const remainingRandomTopics = await tx.shareableTopic.count({
        where: {
          companionId,
          eligibleForRandomVisit: true,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      const disabled = remainingRandomTopics === 0
        ? await tx.networkCompanion.updateMany({
            where: { id: companionId, ownerUserId: userId, randomVisitsEnabled: true },
            data: { randomVisitsEnabled: false },
          })
        : { count: 0 };
      return { topic, randomVisitsDisabled: disabled.count === 1 };
    });
    await this.publishInvalidation(userId, 'companion.topic.revoked', { ownerUserId: userId, companionId, topicId });
    if (result.randomVisitsDisabled) {
      await this.publishInvalidation(userId, 'companion.profile.updated', { ownerUserId: userId, companionId });
    }
    return this.shareableTopic(result.topic);
  }''',
)

# One route may have only one pending invitation, regardless of topic or mode.
replace_once(
    'src/visit/visit.service.ts',
    '''      const existing = await tx.visitInvitation.findFirst({ where: {
        visitorOwnerUserId, hostUserId, networkCompanionId: snapshot.companion.id,
        visitMode, topicRefId: topic?.topicRefId ?? null,
        status: PENDING, expiresAt: { gt: new Date() },
      }, select: INVITATION_SELECT });
      if (existing) throw new ConflictException({ code: 'VISIT_INVITATION_ALREADY_EXISTS', message: 'An equivalent Visit invitation is already pending' });''',
    '''      // A visitor/host/Companion route can reserve only one pending invitation.
      const existing = await tx.visitInvitation.findFirst({ where: {
        visitorOwnerUserId, hostUserId, networkCompanionId: snapshot.companion.id,
        status: PENDING, expiresAt: { gt: new Date() },
      }, select: { id: true } });
      if (existing) throw new ConflictException({ code: 'VISIT_INVITATION_ALREADY_EXISTS', message: 'A Visit invitation is already pending for this route' });''',
)

# A Host-owned random topic is tied to the Host Companion selected when invited.
replace_once(
    'src/visit/visit.service.ts',
    '''      const host = await tx.user.findUnique({
        where: { id: invitation.hostUserId },
        select: { activeNetworkCompanionId: true },
      });
      const session = await tx.visitSession.create({ data: {
        invitationId: invitation.id, visitorOwnerUserId: invitation.visitorOwnerUserId, hostUserId: invitation.hostUserId,
        hostNetworkCompanionId: host?.activeNetworkCompanionId ?? null,''',
    '''      const host = await tx.user.findUnique({
        where: { id: invitation.hostUserId },
        select: { activeNetworkCompanionId: true },
      });
      const hostNetworkCompanionId = invitation.visitMode === 'random_host_topic'
        ? invitation.topicOwnerCompanionId
        : host?.activeNetworkCompanionId;
      if (!hostNetworkCompanionId) this.notAvailable();
      if (invitation.visitMode === 'random_host_topic'
        && host?.activeNetworkCompanionId !== hostNetworkCompanionId) {
        throw new ConflictException({ code: 'VISIT_HOST_COMPANION_CHANGED', message: 'The Host Companion changed after this invitation was created' });
      }
      const session = await tx.visitSession.create({ data: {
        invitationId: invitation.id, visitorOwnerUserId: invitation.visitorOwnerUserId, hostUserId: invitation.hostUserId,
        hostNetworkCompanionId,''',
)

# Visitor topics are currently shareable only to friends; selected recipients are not implemented.
replace_once(
    'src/visit/visit.service.ts',
    '''          id: topicId,
          companionId: visitorCompanionId,
          revokedAt: null,''',
    '''          id: topicId,
          companionId: visitorCompanionId,
          audience: 'friends',
          revokedAt: null,''',
)

# Return one canonical nested topic object; never leak raw snapshot bookkeeping fields.
replace_once(
    'src/visit/visit.service.ts',
    '''    const { assetPackSnapshotId, assetPackRefId: _assetPackRefId, topicRefId: _topicRefId, topicCreatedByUserId: _topicCreatedByUserId, ...summary } = value;
    return {
      ...summary,
      assetPackId: assetPackSnapshotId,
      companionDescription: value.companionDescription ?? undefined,
      topic: value.topicTitle ? {
        ownerCompanionId: value.topicOwnerCompanionId,
        title: value.topicTitle,
        summary: value.topicSummary,
        tags: value.topicTags,
        sourceUrl: value.topicShareScope === 'summary_and_source' ? value.topicSourceUrl ?? undefined : undefined,
        shareScope: value.topicShareScope,
        allowRecipientSave: value.topicAllowRecipientSave,
      } : undefined,''',
    '''    const {
      assetPackSnapshotId,
      assetPackRefId: _assetPackRefId,
      topicRefId: _topicRefId,
      topicCreatedByUserId: _topicCreatedByUserId,
      topicOwnerCompanionId,
      topicTitle,
      topicSummary,
      topicTags,
      topicSourceUrl,
      topicShareScope,
      topicAllowRecipientSave,
      ...summary
    } = value;
    return {
      ...summary,
      assetPackId: assetPackSnapshotId,
      companionDescription: value.companionDescription ?? undefined,
      topic: topicTitle ? {
        ownerCompanionId: topicOwnerCompanionId,
        title: topicTitle,
        summary: topicSummary,
        tags: topicTags,
        sourceUrl: topicShareScope === 'summary_and_source' ? topicSourceUrl ?? undefined : undefined,
        shareScope: topicShareScope,
        allowRecipientSave: topicAllowRecipientSave,
      } : undefined,''',
)

# Behavioral regression for last-topic revocation.
spec = Path('src/companion/shareable-topics.spec.ts')
source = spec.read_text(encoding='utf-8')
anchor = "});\n"
addition = '''

  it('disables random visits when the final eligible topic is revoked', async () => {
    const topic = {
      id: 'topic-1', companionId: 'companion-1', title: 'Topic', summary: 'Summary', tags: [],
      sourceUrl: null, audience: 'friends', shareScope: 'summary_only', allowRecipientSave: false,
      eligibleForRandomVisit: false, expiresAt: null, revokedAt: new Date(), lastUsedAt: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const tx = {
      shareableTopic: {
        update: jest.fn().mockResolvedValue(topic),
        count: jest.fn().mockResolvedValue(0),
      },
      networkCompanion: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      shareableTopic: {
        findUnique: jest.fn().mockResolvedValue({
          id: topic.id, companionId: 'companion-1', companion: { ownerUserId: 'user-1' },
        }),
      },
      friendship: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((operation: (client: typeof tx) => unknown) => operation(tx)),
    };
    const events = { publishToUser: jest.fn() };
    const service = new CompanionService(prisma as never, {} as never, events as never);

    await service.revokeShareableTopic('user-1', 'companion-1', topic.id);

    expect(tx.networkCompanion.updateMany).toHaveBeenCalledWith({
      where: { id: 'companion-1', ownerUserId: 'user-1', randomVisitsEnabled: true },
      data: { randomVisitsEnabled: false },
    });
    expect(events.publishToUser).toHaveBeenCalledWith(
      'user-1', 'companion.profile.updated', expect.objectContaining({ companionId: 'companion-1' }),
    );
  });
'''
if 'disables random visits when the final eligible topic is revoked' not in source:
    index = source.rfind(anchor)
    if index < 0:
        raise SystemExit('shareable topics spec closing anchor not found')
    source = source[:index] + addition + source[index:]
    spec.write_text(source, encoding='utf-8')

# Static contract guards for invitation privacy and Host identity consistency.
visit_spec = Path('src/visit/random-visit-topic.spec.ts')
source = visit_spec.read_text(encoding='utf-8')
old = '''    expect(source).toContain('visitMode: invitation.visitMode');
  });'''
new = '''    expect(source).toContain('visitMode: invitation.visitMode');
    expect(source).toContain("audience: 'friends'");
    expect(source).toContain('A visitor/host/Companion route can reserve only one pending invitation');
    expect(source).toContain('VISIT_HOST_COMPANION_CHANGED');
    expect(source).toContain('topicOwnerCompanionId,');
    expect(source).toContain('topicTitle,');
  });'''
if old not in source:
    raise SystemExit('random Visit topic spec anchor not found')
visit_spec.write_text(source.replace(old, new, 1), encoding='utf-8')
