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
});
