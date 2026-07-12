import { ForbiddenException } from '@nestjs/common';
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
});
