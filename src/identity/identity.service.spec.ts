import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { IdentityService } from './identity.service';

describe('IdentityService logout', () => {
  it('rejects a body device ID that does not match the authenticated access token', async () => {
    const updateMany = jest.fn();
    const service = new IdentityService({ deviceSession: { updateMany } } as never, {} as never, {} as never);
    await expect(service.logout('user-1', 'device-a', 'device-b')).rejects.toBeInstanceOf(ForbiddenException);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('revokes only the matching active device session', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new IdentityService({ deviceSession: { updateMany } } as never, {} as never, {} as never);
    await expect(service.logout('user-1', 'device-a', 'device-a')).resolves.toEqual({ message: 'Logged out successfully' });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', deviceId: 'device-a', revokedAt: null } }));
  });

  it('revokes a device session when a consumed refresh token is reused', async () => {
    const previousRefreshTokenHash = await bcrypt.hash('consumed-refresh-token', 4);
    const update = jest.fn().mockResolvedValue({});
    const service = new IdentityService({
      deviceSession: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'session-1',
          userId: 'user-1',
          refreshTokenHash: await bcrypt.hash('current-refresh-token', 4),
          previousRefreshTokenHash,
          revokedAt: null,
          expiresAt: new Date(Date.now() + 60_000),
        }]),
        update,
      },
    } as never, {} as never, {} as never);

    await expect(service.refreshToken('consumed-refresh-token', 'device-a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-1' },
      data: { revokedAt: expect.any(Date) },
    }));
  });

  it('retries a Friend Code collision while registering so each account keeps a unique code', async () => {
    const create = jest.fn()
      .mockRejectedValueOnce({ code: 'P2002', meta: { target: ['friendCode'] } })
      .mockResolvedValueOnce({ id: 'user-1', email: 'ann@example.com', username: 'ann', friendCode: 'UNIQUE01', createdAt: new Date() });
    const service = new IdentityService(
      { user: { findFirst: jest.fn().mockResolvedValue(null), create }, deviceSession: { upsert: jest.fn() } } as never,
      { signAsync: jest.fn().mockResolvedValue('token') } as never,
      { get: jest.fn((key: string, fallback?: string) => key === 'JWT_REFRESH_EXPIRATION' ? '7d' : fallback) } as never,
    );
    jest.spyOn<any, any>(service as any, 'generateFriendCode').mockReturnValueOnce('DUPLICAT').mockReturnValueOnce('UNIQUE01');

    await service.register({ email: 'ann@example.com', username: 'ann', password: 'password123', deviceId: 'device-1' });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([input]) => input.data.friendCode)).toEqual(['DUPLICAT', 'UNIQUE01']);
  });
});
