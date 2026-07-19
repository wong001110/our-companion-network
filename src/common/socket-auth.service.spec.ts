import { SocketAuthService } from './socket-auth.service';

function service(session: unknown) {
  const findUnique = jest.fn().mockResolvedValue(session);
  return {
    instance: new SocketAuthService(
      {} as never,
      { deviceSession: { findUnique } } as never,
      {} as never,
      {} as never,
    ),
    findUnique,
  };
}

describe('SocketAuthService durable session revalidation', () => {
  it('accepts only an unrevoked session for an active, non-deleting account', async () => {
    const { instance, findUnique } = service({
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: { accountStatus: 'ACTIVE', deletionRequestedAt: null },
    });

    await expect(instance.isSessionActive('user-1', 'device-1'))
      .resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        userId_deviceId: { userId: 'user-1', deviceId: 'device-1' },
      },
      select: {
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            accountStatus: true,
            deletionRequestedAt: true,
          },
        },
      },
    });
  });

  it('rejects a deletion-pending account even if its socket session row is not yet revoked', async () => {
    const { instance } = service({
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        accountStatus: 'ACTIVE',
        deletionRequestedAt: new Date(),
      },
    });

    await expect(instance.isSessionActive('user-1', 'device-1'))
      .resolves.toBe(false);
  });
});
