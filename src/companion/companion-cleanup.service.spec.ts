import { CompanionCleanupService } from './companion-cleanup.service';

describe('CompanionCleanupService', () => {
  it('includes durable active staging cleanup in every bounded pass', async () => {
    const companions = {
      abandonExpiredUploads: jest.fn().mockResolvedValue(0),
      cleanupActivePackStaging: jest.fn().mockResolvedValue(1),
      cleanupSupersededPacks: jest.fn().mockResolvedValue(0),
    };
    const service = new CompanionCleanupService(companions as never);

    await (service as any).run();

    expect(companions.cleanupActivePackStaging).toHaveBeenCalledWith(100);
    expect(companions.abandonExpiredUploads.mock.invocationCallOrder[0])
      .toBeLessThan(companions.cleanupActivePackStaging.mock.invocationCallOrder[0]);
    expect(companions.cleanupActivePackStaging.mock.invocationCallOrder[0])
      .toBeLessThan(companions.cleanupSupersededPacks.mock.invocationCallOrder[0]);
  });

  it('continues to later phases when an earlier cleanup phase fails', async () => {
    const companions = {
      abandonExpiredUploads: jest.fn().mockRejectedValue(new Error('database unavailable')),
      cleanupActivePackStaging: jest.fn().mockResolvedValue(1),
      cleanupSupersededPacks: jest.fn().mockResolvedValue(2),
    };
    const service = new CompanionCleanupService(companions as never);

    await expect((service as any).run()).resolves.toBeUndefined();

    expect(companions.abandonExpiredUploads).toHaveBeenCalledWith(100);
    expect(companions.cleanupActivePackStaging).toHaveBeenCalledWith(100);
    expect(companions.cleanupSupersededPacks).toHaveBeenCalledWith(100);
  });
});
