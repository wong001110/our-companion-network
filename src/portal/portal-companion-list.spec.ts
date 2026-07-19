import { PortalService } from './portal.service';

describe('Portal Companion passport list', () => {
  it('labels the active Companion without exposing the relation object', async () => {
    const prisma = {
      networkCompanion: {
        findMany: jest.fn().mockReturnValue('companions-query'),
        count: jest.fn().mockReturnValue('count-query'),
      },
      $transaction: jest.fn().mockResolvedValue([[
        {
          id: 'companion-active',
          name: 'Mochi',
          totalBytes: 10n,
          activeForUser: { id: 'user-1' },
        },
        {
          id: 'companion-other',
          name: 'Pip',
          totalBytes: 20n,
          activeForUser: null,
        },
      ], 2]),
    };
    const service = new PortalService(
      prisma as never,
      {} as never,
      {} as never,
    );

    const result = await service.listCompanions('user-1', {
      page: 1,
      limit: 20,
      direction: 'desc',
    } as never);

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'companion-active',
        isActive: true,
        totalBytes: 10,
      }),
      expect.objectContaining({
        id: 'companion-other',
        isActive: false,
        totalBytes: 20,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain('activeForUser');
  });
});
