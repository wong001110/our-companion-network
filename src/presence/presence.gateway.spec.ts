import { PresenceGateway } from './presence.gateway';

const now = new Date('2026-07-13T00:00:00.000Z');

function createGateway(values: Record<string, string> = {}) {
  const presence = {
    setOnline: jest.fn().mockResolvedValue({ status: 'online', updatedAt: now }),
    setIdle: jest.fn().mockResolvedValue({ status: 'idle', updatedAt: now }),
    setOffline: jest.fn().mockResolvedValue({ status: 'offline', updatedAt: now }),
    getFriendIds: jest.fn().mockResolvedValue([]),
  };
  const config = { get: jest.fn((key: string, fallback: string) => values[key] ?? (key === 'PRESENCE_IDLE_SECONDS' ? '10' : fallback)) };
  const events = { attach: jest.fn(), publishToUser: jest.fn() };
  return { gateway: new PresenceGateway(presence as never, {} as never, config as never, events as never), presence };
}

function socket(id: string, userId = 'user-a') {
  return { id, data: { userId }, join: jest.fn(), disconnect: jest.fn() } as never;
}

describe('PresenceGateway multiple-device aggregation', () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(now); });
  afterEach(() => jest.useRealTimers());

  it('returns online when a second device connects after the first became idle', async () => {
    const { gateway, presence } = createGateway();
    await gateway.handleConnection(socket('a'));
    await jest.advanceTimersByTimeAsync(10_000);
    expect(presence.setIdle).toHaveBeenCalled();
    await gateway.handleConnection(socket('b'));
    expect(presence.setOnline).toHaveBeenLastCalledWith('user-a');
  });

  it('keeps aggregate online when one device is idle and another is active', async () => {
    const { gateway, presence } = createGateway();
    await gateway.handleConnection(socket('a'));
    await jest.advanceTimersByTimeAsync(10_000);
    await gateway.handleConnection(socket('b'));
    await jest.advanceTimersByTimeAsync(5_000);
    expect(presence.setOnline).toHaveBeenLastCalledWith('user-a');
  });

  it('becomes idle only after all connected devices are idle', async () => {
    const { gateway, presence } = createGateway();
    await gateway.handleConnection(socket('a'));
    await jest.advanceTimersByTimeAsync(5_000);
    await gateway.handleConnection(socket('b'));
    await jest.advanceTimersByTimeAsync(5_000);
    expect(presence.setOnline).toHaveBeenLastCalledWith('user-a');
    await jest.advanceTimersByTimeAsync(5_000);
    expect(presence.setIdle).toHaveBeenLastCalledWith('user-a');
  });

  it('keeps online when one device disconnects and another remains active', async () => {
    const { gateway, presence } = createGateway();
    const deviceA = socket('a');
    const deviceB = socket('b');
    await gateway.handleConnection(deviceA);
    await jest.advanceTimersByTimeAsync(5_000);
    await gateway.handleConnection(deviceB);
    await gateway.handleDisconnect(deviceA);
    expect(presence.setOnline).toHaveBeenLastCalledWith('user-a');
    expect(presence.setOffline).not.toHaveBeenCalled();
  });

  it('keeps the final disconnect online through the default 45-second grace, then publishes offline', async () => {
    const { gateway, presence } = createGateway();
    const device = socket('a');
    await gateway.handleConnection(device);

    await gateway.handleDisconnect(device);
    expect(presence.setOffline).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(44_999);
    expect(presence.setOffline).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);

    expect(presence.setOffline).toHaveBeenLastCalledWith('user-a');
  });

  it('cancels the pending offline transition when the user reconnects during grace', async () => {
    const { gateway, presence } = createGateway();
    await gateway.handleConnection(socket('a'));
    await gateway.handleDisconnect(socket('a'));
    await jest.advanceTimersByTimeAsync(20_000);
    await gateway.handleConnection(socket('b'));
    await jest.advanceTimersByTimeAsync(30_000);

    expect(presence.setOffline).not.toHaveBeenCalled();
    expect(presence.setOnline).toHaveBeenLastCalledWith('user-a');
  });

  it('supports immediate offline only when zero grace is explicitly configured', async () => {
    const { gateway, presence } = createGateway({ PRESENCE_DISCONNECT_GRACE_SECONDS: '0' });
    const device = socket('a');
    await gateway.handleConnection(device);
    await gateway.handleDisconnect(device);

    expect(presence.setOffline).toHaveBeenLastCalledWith('user-a');
  });

  it('uses the safe 45-second grace when the configured value is invalid', async () => {
    const { gateway, presence } = createGateway({ PRESENCE_DISCONNECT_GRACE_SECONDS: 'not-a-number' });
    const device = socket('a');
    await gateway.handleConnection(device);
    await gateway.handleDisconnect(device);
    await jest.advanceTimersByTimeAsync(44_999);
    expect(presence.setOffline).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(presence.setOffline).toHaveBeenLastCalledWith('user-a');
  });
});
