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
  const socketAuth = {
    isSessionActive: jest.fn().mockResolvedValue(true),
  };
  return {
    gateway: new PresenceGateway(
      presence as never,
      socketAuth as never,
      config as never,
      events as never,
    ),
    presence,
    socketAuth,
  };
}

function socket(id: string, userId = 'user-a') {
  return {
    id,
    data: { userId, deviceId: `device-${id}` },
    connected: true,
    join: jest.fn(),
    disconnect: jest.fn(function(this: { connected: boolean }) {
      this.connected = false;
    }),
  } as never;
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

  it('reports reconnects in a bounded rolling operational window', async () => {
    const { gateway } = createGateway();
    await gateway.handleConnection(socket('a'));
    await gateway.handleDisconnect(socket('a'));
    await gateway.handleConnection(socket('b'));

    expect(gateway.getOperationalSnapshot()).toMatchObject({
      reconnectCount: 1,
      reconnectWindowMinutes: 15,
    });

    await jest.advanceTimersByTimeAsync(15 * 60_000 + 1);
    expect(gateway.getOperationalSnapshot()).toMatchObject({
      reconnectCount: 0,
    });
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

  it('disconnects a revoked long-lived socket before accepting activity', async () => {
    const { gateway, socketAuth, presence } = createGateway();
    const device = socket('a') as any;
    socketAuth.isSessionActive
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await gateway.handleConnection(device);
    await gateway.handleActivity(device);

    expect(device.disconnect).toHaveBeenCalledWith(true);
    expect(presence.setOnline).toHaveBeenCalledTimes(1);
  });

  it('periodically disconnects a passive socket after its session is revoked', async () => {
    const { gateway, socketAuth } = createGateway();
    const device = socket('a') as any;
    socketAuth.isSessionActive
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await gateway.handleConnection(device);
    await jest.advanceTimersByTimeAsync(30_000);

    expect(device.disconnect).toHaveBeenCalledWith(true);
  });

  it('force-disconnects every socket and immediately publishes offline', async () => {
    const { gateway, presence } = createGateway();
    const first = socket('a') as any;
    const second = socket('b') as any;
    (gateway as any).server = {
      sockets: {
        sockets: new Map([
          [first.id, first],
          [second.id, second],
        ]),
      },
    };
    await gateway.handleConnection(first);
    await gateway.handleConnection(second);

    await gateway.disconnectUser('user-a');

    expect(first.disconnect).toHaveBeenCalledWith(true);
    expect(second.disconnect).toHaveBeenCalledWith(true);
    expect(presence.setOffline).toHaveBeenLastCalledWith('user-a');
    expect(gateway.isUserOnline('user-a')).toBe(false);
  });

  it('can force an offline state before the Socket.IO server is attached', async () => {
    const { gateway, presence } = createGateway();

    await expect(gateway.disconnectUser('user-a')).resolves.toBeUndefined();

    expect(presence.setOffline).toHaveBeenCalledWith('user-a');
  });

  it('does not register a socket that disconnects while durable auth is pending', async () => {
    const { gateway, socketAuth, presence } = createGateway();
    let resolveAuth!: (active: boolean) => void;
    socketAuth.isSessionActive.mockImplementationOnce(() =>
      new Promise<boolean>((resolve) => { resolveAuth = resolve; }));
    const device = socket('a') as any;

    const connecting = gateway.handleConnection(device);
    device.connected = false;
    resolveAuth(true);
    await connecting;

    expect(gateway.isUserOnline('user-a')).toBe(false);
    expect(device.join).not.toHaveBeenCalled();
    expect(presence.setOnline).not.toHaveBeenCalled();
  });

  it('does not schedule timers when disconnect occurs during online publication', async () => {
    const { gateway, presence, socketAuth } = createGateway();
    let resolvePresence!: (value: { status: string; updatedAt: Date }) => void;
    presence.setOnline.mockImplementationOnce(() =>
      new Promise((resolve) => { resolvePresence = resolve; }));
    const device = socket('a') as any;

    const connecting = gateway.handleConnection(device);
    while (!resolvePresence) await Promise.resolve();
    device.connected = false;
    await gateway.handleDisconnect(device);
    resolvePresence({ status: 'online', updatedAt: now });
    await connecting;
    await jest.advanceTimersByTimeAsync(30_000);

    expect(socketAuth.isSessionActive).toHaveBeenCalledTimes(1);
    expect(gateway.isUserOnline('user-a')).toBe(false);
  });

  it('does not reschedule a watchdog after disconnect during revalidation', async () => {
    const { gateway, socketAuth } = createGateway();
    const device = socket('a') as any;
    await gateway.handleConnection(device);
    let resolveAuth!: (active: boolean) => void;
    socketAuth.isSessionActive.mockImplementationOnce(() =>
      new Promise<boolean>((resolve) => { resolveAuth = resolve; }));

    jest.advanceTimersByTime(30_000);
    await Promise.resolve();
    device.connected = false;
    await gateway.handleDisconnect(device);
    resolveAuth(true);
    await Promise.resolve();
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(30_000);

    // connect validation + post-online reconciliation + one watchdog tick
    expect(socketAuth.isSessionActive).toHaveBeenCalledTimes(3);
    expect(gateway.isUserOnline('user-a')).toBe(false);
  });

  it('disconnects a pending socket when the user is revoked during durable validation', async () => {
    const { gateway, socketAuth, presence } = createGateway();
    let resolveAuth!: (active: boolean) => void;
    socketAuth.isSessionActive.mockImplementationOnce(() =>
      new Promise<boolean>((resolve) => { resolveAuth = resolve; }));
    const device = socket('a') as any;

    const connecting = gateway.handleConnection(device);
    while ((gateway as any).pendingSockets.size === 0) await Promise.resolve();
    await gateway.disconnectUser('user-a');
    resolveAuth(true);
    await connecting;

    expect(device.disconnect).toHaveBeenCalledWith(true);
    expect(device.join).not.toHaveBeenCalled();
    expect(gateway.isUserOnline('user-a')).toBe(false);
    expect((gateway as any).userSockets.has('user-a')).toBe(false);
    expect((gateway as any).pendingSockets.has(device.id)).toBe(false);
    expect(presence.setOnline).not.toHaveBeenCalled();
    expect((gateway as any).activityTimers.has('user-a')).toBe(false);
    expect((gateway as any).validationTimers.has(device.id)).toBe(false);
  });

  it('disconnects only the revoked device while a pending peer remains eligible', async () => {
    const { gateway, socketAuth, presence } = createGateway();
    let resolveAuthA!: (active: boolean) => void;
    let resolveAuthB!: (active: boolean) => void;
    socketAuth.isSessionActive
      .mockImplementationOnce(() =>
        new Promise<boolean>((resolve) => { resolveAuthA = resolve; }))
      .mockImplementationOnce(() =>
        new Promise<boolean>((resolve) => { resolveAuthB = resolve; }))
      .mockResolvedValue(true);
    const deviceA = socket('a') as any;
    const deviceB = socket('b') as any;
    deviceA.data.deviceId = 'device-a';
    deviceB.data.deviceId = 'device-b';

    const connectingA = gateway.handleConnection(deviceA);
    const connectingB = gateway.handleConnection(deviceB);
    while ((gateway as any).pendingSockets.size < 2) await Promise.resolve();
    await gateway.disconnectDevice('user-a', 'device-a');
    resolveAuthA(true);
    resolveAuthB(true);
    await Promise.all([connectingA, connectingB]);

    expect(deviceA.disconnect).toHaveBeenCalledWith(true);
    expect(deviceA.join).not.toHaveBeenCalled();
    expect(deviceB.disconnect).not.toHaveBeenCalled();
    expect(deviceB.join).toHaveBeenCalledWith('user:user-a');
    expect(gateway.isUserOnline('user-a')).toBe(true);
    expect(presence.setOnline).toHaveBeenCalledWith('user-a');
    expect(presence.setOffline).not.toHaveBeenCalled();
  });

  it('reconciles offline when revocation races an in-flight online publish', async () => {
    const { gateway, presence, socketAuth } = createGateway();
    let resolvePresence!: (value: { status: string; updatedAt: Date }) => void;
    presence.setOnline.mockImplementationOnce(() =>
      new Promise((resolve) => { resolvePresence = resolve; }));
    const device = socket('a') as any;
    (gateway as any).server = {
      sockets: { sockets: new Map([[device.id, device]]) },
    };

    const connecting = gateway.handleConnection(device);
    while (!resolvePresence) await Promise.resolve();
    await gateway.disconnectUser('user-a');
    resolvePresence({ status: 'online', updatedAt: now });
    await connecting;

    expect(device.disconnect).toHaveBeenCalledWith(true);
    expect(gateway.isUserOnline('user-a')).toBe(false);
    expect((gateway as any).userSockets.has('user-a')).toBe(false);
    expect(presence.setOffline).toHaveBeenCalledWith('user-a');
    expect((gateway as any).activityTimers.has('user-a')).toBe(false);
    expect((gateway as any).validationTimers.has(device.id)).toBe(false);
    expect(socketAuth.isSessionActive).toHaveBeenCalledTimes(1);
  });

  it('keeps a second valid device online when only one device is revoked', async () => {
    const { gateway, presence } = createGateway();
    const deviceA = socket('a') as any;
    const deviceB = socket('b') as any;
    deviceA.data.deviceId = 'device-a';
    deviceB.data.deviceId = 'device-b';
    (gateway as any).server = {
      sockets: {
        sockets: new Map([
          [deviceA.id, deviceA],
          [deviceB.id, deviceB],
        ]),
      },
    };
    await gateway.handleConnection(deviceA);
    await gateway.handleConnection(deviceB);

    await gateway.disconnectDevice('user-a', 'device-a');
    await gateway.handleDisconnect(deviceA);

    expect(deviceA.disconnect).toHaveBeenCalledWith(true);
    expect(deviceB.disconnect).not.toHaveBeenCalled();
    expect(gateway.isUserOnline('user-a')).toBe(true);
    expect(presence.setOnline).toHaveBeenCalled();
    expect(presence.setOffline).not.toHaveBeenCalled();
  });

  it('reconciles offline when disconnectUser races an aggregate online publish', async () => {
    const { gateway, presence } = createGateway({ PRESENCE_IDLE_SECONDS: '3600' });
    const device = socket('a') as any;
    (gateway as any).server = {
      sockets: { sockets: new Map([[device.id, device]]) },
    };
    await gateway.handleConnection(device);

    let resolvePresence!: (value: { status: string; updatedAt: Date }) => void;
    presence.setOnline.mockImplementationOnce(() =>
      new Promise((resolve) => { resolvePresence = resolve; }));

    await jest.advanceTimersByTimeAsync(15_000);
    const publishing = gateway.handleActivity(device);
    while (!resolvePresence) await Promise.resolve();
    await gateway.disconnectUser('user-a');
    resolvePresence({ status: 'online', updatedAt: now });
    await publishing;

    expect(device.disconnect).toHaveBeenCalledWith(true);
    expect(gateway.isUserOnline('user-a')).toBe(false);
    expect((gateway as any).userSockets.has('user-a')).toBe(false);
    expect(presence.setOffline).toHaveBeenCalledWith('user-a');
    expect(presence.setOffline).toHaveBeenLastCalledWith('user-a');
    const lastOnline = Math.max(...presence.setOnline.mock.invocationCallOrder);
    const lastOffline = Math.max(...presence.setOffline.mock.invocationCallOrder);
    expect(lastOffline).toBeGreaterThan(lastOnline);
    expect((gateway as any).activityTimers.has('user-a')).toBe(false);
    expect((gateway as any).validationTimers.has(device.id)).toBe(false);
    expect((gateway as any).offlineTimers.has('user-a')).toBe(false);
  });
});
