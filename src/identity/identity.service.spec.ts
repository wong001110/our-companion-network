import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
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
    const presence = { disconnectDevice: jest.fn().mockResolvedValue(undefined) };
    const service = new IdentityService(
      { deviceSession: { updateMany } } as never,
      {} as never,
      {} as never,
      presence as never,
    );
    await expect(service.logout('user-1', 'device-a', 'device-a')).resolves.toEqual({ message: 'Logged out successfully' });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', deviceId: 'device-a', revokedAt: null } }));
    expect(presence.disconnectDevice).toHaveBeenCalledWith(
      'user-1',
      'device-a',
    );
  });

  it('revokes a device session when a consumed refresh token is reused', async () => {
    const previousRefreshTokenHash = await bcrypt.hash('consumed-refresh-token', 4);
    const update = jest.fn().mockResolvedValue({});
    const presence = { disconnectDevice: jest.fn().mockResolvedValue(undefined) };
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
    } as never, {} as never, {} as never, presence as never);

    await expect(service.refreshToken('consumed-refresh-token', 'device-a')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'session-1' },
      data: expect.objectContaining({ revokedAt: expect.any(Date) }),
    }));
    expect(presence.disconnectDevice).toHaveBeenCalledWith(
      'user-1',
      'device-a',
    );
  });

  it('retries UID or Friend Code collisions while registering and returns the public UID', async () => {
    const create = jest.fn()
      .mockRejectedValueOnce({ code: 'P2002', meta: { target: ['uid'] } })
      .mockResolvedValueOnce({ id: 'user-1', uid: 'OC-7K4M92QX', email: 'ann@example.com', username: 'ann', friendCode: 'UNIQUE01', createdAt: new Date() });
    const service = new IdentityService(
      { user: { findUnique: jest.fn().mockResolvedValue(null), create }, deviceSession: { upsert: jest.fn() } } as never,
      { signAsync: jest.fn().mockResolvedValue('token') } as never,
      { get: jest.fn((key: string, fallback?: string) => key === 'JWT_REFRESH_EXPIRATION' ? '7d' : fallback) } as never,
    );
    jest.spyOn<any, any>(service as any, 'generateFriendCode').mockReturnValueOnce('DUPLICAT').mockReturnValueOnce('UNIQUE01');
    jest.spyOn<any, any>(service as any, 'generateUid').mockReturnValueOnce('OC-DUPLICAT').mockReturnValueOnce('OC-7K4M92QX');

    const result = await service.register({ email: 'ann@example.com', username: 'ann', password: 'password123', deviceId: 'device-1' });

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([input]) => input.data.uid)).toEqual(['OC-DUPLICAT', 'OC-7K4M92QX']);
    expect(result.user.uid).toBe('OC-7K4M92QX');
  });

  it('allows duplicate usernames while normalizing private email identity', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'user-2', uid: 'OC-ABCDEFGH', email: 'Case@Example.com', username: 'Ann', friendCode: 'ABCDEF12', createdAt: new Date(),
    });
    const findUnique = jest.fn().mockResolvedValue(null);
    const service = new IdentityService(
      { user: { findUnique, create }, deviceSession: { upsert: jest.fn() } } as never,
      { signAsync: jest.fn().mockResolvedValue('token') } as never,
      { get: jest.fn((key: string, fallback?: string) => key === 'JWT_REFRESH_EXPIRATION' ? '7d' : fallback) } as never,
    );
    await service.register({ email: ' Case@Example.com ', username: ' Ann ', password: 'password123', deviceId: 'device-1' });
    expect(findUnique).toHaveBeenCalledWith({ where: { normalizedEmail: 'case@example.com' } });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ username: 'Ann', normalizedEmail: 'case@example.com' }),
    }));
  });

  it('rejects a duplicate normalized email and logs in case-insensitively', async () => {
    const duplicate = new IdentityService(
      { user: { findUnique: jest.fn().mockResolvedValue({ id: 'existing' }) } } as never,
      {} as never,
      {} as never,
    );
    await expect(duplicate.register({
      email: 'ANN@EXAMPLE.COM', username: 'Anyone', password: 'password123', deviceId: 'device-1',
    })).rejects.toBeInstanceOf(ConflictException);

    const passwordHash = await bcrypt.hash('password123', 4);
    const findUnique = jest.fn().mockResolvedValue({
      id: 'user-1', uid: 'OC-ABCDEFGH', email: 'ann@example.com', username: 'Ann', friendCode: 'ABCDEF12', passwordHash,
      accountStatus: 'ACTIVE',
    });
    const login = new IdentityService(
      { user: { findUnique }, deviceSession: { upsert: jest.fn() } } as never,
      { signAsync: jest.fn().mockResolvedValue('token') } as never,
      { get: jest.fn((key: string, fallback?: string) => key === 'JWT_REFRESH_EXPIRATION' ? '7d' : fallback) } as never,
    );
    await expect(login.login({ email: ' ANN@EXAMPLE.COM ', password: 'password123', deviceId: 'device-1' })).resolves.toMatchObject({
      user: { uid: 'OC-ABCDEFGH' },
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { normalizedEmail: 'ann@example.com' } });
  });

  it('generates readable immutable-format UIDs', () => {
    const service = new IdentityService({} as never, {} as never, {} as never);
    const generated = new Set(Array.from({ length: 100 }, () => (service as any).generateUid()));
    expect(generated.size).toBe(100);
    for (const uid of generated) {
      expect(uid).toMatch(/^OC-[A-HJ-KM-NP-Z2-9]{8}$/);
    }
  });

  it('rejects a suspended account even with the correct password', async () => {
    const passwordHash = await bcrypt.hash('password123', 4);
    const service = new IdentityService(
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            passwordHash,
            accountStatus: 'SUSPENDED',
          }),
        },
      } as never,
      {} as never,
      {} as never,
    );
    await expect(service.login({
      email: 'user@example.test',
      password: 'password123',
      deviceId: 'device-1',
    })).rejects.toMatchObject({ response: { code: 'ACCOUNT_SUSPENDED' } });
  });
});
