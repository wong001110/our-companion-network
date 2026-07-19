import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy account and device state', () => {
  const payload = {
    sub: 'user-1',
    email: 'user@example.test',
    deviceId: 'device-1',
  };

  it('accepts an active account with a current device session', async () => {
    const strategy = new JwtStrategy(
      { get: jest.fn().mockReturnValue('secret') } as never,
      {
        deviceSession: {
          findUnique: jest.fn().mockResolvedValue({
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          }),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            email: 'user@example.test',
            username: 'User',
            accountStatus: 'ACTIVE',
          }),
        },
      } as never,
    );
    await expect(strategy.validate(payload)).resolves.toEqual({
      id: 'user-1',
      email: 'user@example.test',
      username: 'User',
      deviceId: 'device-1',
    });
  });

  it('rejects a suspended account even when its JWT and session are current', async () => {
    const strategy = new JwtStrategy(
      { get: jest.fn().mockReturnValue('secret') } as never,
      {
        deviceSession: {
          findUnique: jest.fn().mockResolvedValue({
            revokedAt: null,
            expiresAt: new Date(Date.now() + 60_000),
          }),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'user-1',
            accountStatus: 'SUSPENDED',
          }),
        },
      } as never,
    );
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
