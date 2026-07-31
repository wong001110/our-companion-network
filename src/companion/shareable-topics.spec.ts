import { CompanionService } from './companion.service';

describe('CompanionService shareable topics', () => {
  it('requires one active random topic before enabling random visits', async () => {
    const prisma = {
      networkCompanion: {
        findUnique: jest.fn().mockResolvedValue({ id: 'companion-1', ownerUserId: 'user-1', published: true, activeAssetPackId: 'pack-1', randomVisitsEnabled: false, randomVisitAudience: 'friends', allowJoinRequests: true }),
      },
      shareableTopic: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new CompanionService(prisma as never, {} as never, { publishToUser: jest.fn() } as never);
    await expect(service.updateSocialPolicy('user-1', 'companion-1', { randomVisitsEnabled: true }))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'RANDOM_VISIT_TOPIC_REQUIRED' }) });
  });


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
});
