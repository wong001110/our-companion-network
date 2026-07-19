import { NotificationGateway } from './notification.gateway';

function socket() {
  return {
    id: 'socket-1',
    connected: true,
    data: { userId: 'user-1', deviceId: 'device-1' },
    disconnect: jest.fn(),
  } as never;
}

describe('NotificationGateway durable socket authorization', () => {
  it('revalidates the session before marking a notification read', async () => {
    const notifications = {
      markAsRead: jest.fn().mockResolvedValue({ id: 'notification-1' }),
      markAllAsRead: jest.fn(),
    };
    const presence = {
      validateClientSession: jest.fn().mockResolvedValue('user-1'),
    };
    const gateway = new NotificationGateway(
      notifications as never,
      presence as never,
    );
    const client = socket();

    await expect(gateway.handleMarkRead(client, {
      notificationId: 'notification-1',
    })).resolves.toEqual({ id: 'notification-1' });

    expect(presence.validateClientSession).toHaveBeenCalledWith(client);
    expect(notifications.markAsRead).toHaveBeenCalledWith(
      'user-1',
      'notification-1',
    );
  });

  it('does not mutate notifications when durable socket auth is revoked', async () => {
    const notifications = {
      markAsRead: jest.fn(),
      markAllAsRead: jest.fn(),
    };
    const presence = {
      validateClientSession: jest.fn().mockResolvedValue(undefined),
    };
    const gateway = new NotificationGateway(
      notifications as never,
      presence as never,
    );
    const client = socket();

    await expect(gateway.handleMarkAllRead(client)).resolves.toBeUndefined();

    expect(presence.validateClientSession).toHaveBeenCalledWith(client);
    expect(notifications.markAllAsRead).not.toHaveBeenCalled();
  });
});
