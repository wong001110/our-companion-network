import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  ConnectedSocket,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { PresenceService } from './presence.service';
import { SocketAuthService } from '../common/socket-auth.service';
import { SocialEventPublisher } from '../common/social-event-publisher.service';

const RECONNECT_WINDOW_MS = 15 * 60_000;
const MAX_RECONNECT_EVENTS = 10_000;

interface PendingSocketConnection {
  socketId: string;
  userId: string;
  deviceId: string;
  invalidated: boolean;
  userGeneration: number;
  deviceGeneration: number;
  socket: Socket;
}

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true },
})
export class PresenceGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly userSockets = new Map<string, Set<string>>();
  private readonly pendingSockets = new Map<string, PendingSocketConnection>();
  private readonly userRevocationGeneration = new Map<string, number>();
  private readonly deviceRevocationGeneration = new Map<string, number>();
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();
  private readonly activityTimers = new Map<string, NodeJS.Timeout>();
  private readonly validationTimers = new Map<string, NodeJS.Timeout>();
  private readonly socketActivity = new Map<string, number>();
  private readonly reconnectEvents: number[] = [];

  constructor(
    private readonly presenceService: PresenceService,
    private readonly socketAuth: SocketAuthService,
    private readonly config: ConfigService,
    private readonly events: SocialEventPublisher,
  ) {}

  afterInit(server: Server): void {
    this.socketAuth.configure(server);
    this.events.attach(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    const userId = client.data.userId as string | undefined;
    const deviceId = client.data.deviceId as string | undefined;
    if (!userId || !deviceId) {
      client.disconnect(true);
      return;
    }

    const pending = this.registerPendingConnection(client, userId, deviceId);
    const active = await this.isClientSessionActive(userId, deviceId);
    if (!active) {
      this.dropPendingConnection(client.id, true);
      return;
    }
    if (!this.canPromotePendingConnection(client, pending)) {
      this.dropPendingConnection(client.id, true);
      return;
    }

    const timer = this.offlineTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.offlineTimers.delete(userId);
      this.recordReconnect();
    }

    if (!this.canPromotePendingConnection(client, pending)) {
      this.dropPendingConnection(client.id, true);
      return;
    }

    const sockets = this.userSockets.get(userId) ?? new Set<string>();
    sockets.add(client.id);
    client.join(`user:${userId}`);
    this.socketActivity.set(client.id, Date.now());
    this.userSockets.set(userId, sockets);

    if (!this.canPromotePendingConnection(client, pending)
      || !this.userSockets.get(userId)?.has(client.id)) {
      this.removeRegisteredSocket(userId, client.id);
      this.dropPendingConnection(client.id, true);
      await this.reconcilePresenceAfterAbort(userId);
      return;
    }

    await this.publishPresence(userId, 'online');

    if (!this.canPromotePendingConnection(client, pending)
      || !this.userSockets.get(userId)?.has(client.id)) {
      this.removeRegisteredSocket(userId, client.id);
      this.dropPendingConnection(client.id, true);
      await this.reconcilePresenceAfterAbort(userId);
      return;
    }

    // Durable revalidation closes the window where revocation committed while
    // setOnline was still in flight and overwrote the offline write.
    const stillActive = await this.isClientSessionActive(userId, deviceId);
    if (!stillActive
      || !this.canPromotePendingConnection(client, pending)
      || !this.userSockets.get(userId)?.has(client.id)) {
      this.removeRegisteredSocket(userId, client.id);
      this.dropPendingConnection(client.id, true);
      await this.reconcilePresenceAfterAbort(userId);
      return;
    }

    this.pendingSockets.delete(client.id);
    this.scheduleIdleCheck(userId);
    this.scheduleSessionValidation(client);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.pendingSockets.delete(client.id);
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    sockets.delete(client.id);
    this.socketActivity.delete(client.id);
    const validationTimer = this.validationTimers.get(client.id);
    if (validationTimer) {
      clearTimeout(validationTimer);
      this.validationTimers.delete(client.id);
    }
    if (sockets.size > 0) {
      await this.publishAggregatePresence(userId);
      this.scheduleIdleCheck(userId);
      return;
    }
    this.userSockets.delete(userId);
    const idleTimer = this.activityTimers.get(userId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.activityTimers.delete(userId);
    }
    const configuredGrace = Number(this.config.get<string>('PRESENCE_DISCONNECT_GRACE_SECONDS', '45'));
    const graceSeconds = Number.isFinite(configuredGrace) && configuredGrace >= 0 ? configuredGrace : 45;
    if (graceSeconds === 0) {
      await this.publishPresence(userId, 'offline');
      return;
    }
    const timer = setTimeout(() => {
      this.offlineTimers.delete(userId);
      if (!this.userSockets.has(userId)) void this.publishPresence(userId, 'offline');
    }, Math.max(0, graceSeconds) * 1000);
    this.offlineTimers.set(userId, timer);
  }

  emitToUser(userId: string, event: string, data: unknown): void {
    this.events.publishToUser(userId, event, data);
  }

  async disconnectUser(userId: string): Promise<void> {
    this.bumpUserRevocationGeneration(userId);
    const pendingIds = [...this.pendingSockets.values()]
      .filter((pending) => pending.userId === userId)
      .map((pending) => pending.socketId);
    for (const socketId of pendingIds) {
      this.dropPendingConnection(socketId, true);
    }

    const socketIds = [...(this.userSockets.get(userId) ?? [])];
    this.clearUserTimers(userId);
    this.userSockets.delete(userId);
    for (const socketId of socketIds) {
      this.socketActivity.delete(socketId);
      const timer = this.validationTimers.get(socketId);
      if (timer) clearTimeout(timer);
      this.validationTimers.delete(socketId);
      this.server?.sockets.sockets.get(socketId)?.disconnect(true);
    }
    await this.publishPresence(userId, 'offline');
  }

  async disconnectDevice(userId: string, deviceId: string): Promise<void> {
    this.bumpDeviceRevocationGeneration(userId, deviceId);
    const pendingIds = [...this.pendingSockets.values()]
      .filter((pending) => pending.userId === userId && pending.deviceId === deviceId)
      .map((pending) => pending.socketId);
    for (const socketId of pendingIds) {
      this.dropPendingConnection(socketId, true);
    }

    const sockets = [...(this.userSockets.get(userId) ?? [])];
    for (const socketId of sockets) {
      const socket = this.server?.sockets.sockets.get(socketId);
      if (socket?.data.deviceId === deviceId) socket.disconnect(true);
    }
  }

  isUserOnline(userId: string): boolean {
    return (this.userSockets.get(userId)?.size ?? 0) > 0;
  }

  getOperationalSnapshot() {
    this.pruneReconnectEvents();
    return {
      status: this.server ? 'ok' : 'unavailable',
      connectionCount: [...this.userSockets.values()]
        .reduce((total, sockets) => total + sockets.size, 0),
      connectedUsers: this.userSockets.size,
      reconnectCount: this.reconnectEvents.length,
      reconnectWindowMinutes: RECONNECT_WINDOW_MS / 60_000,
    };
  }

  @SubscribeMessage('presence.activity')
  async handleActivity(@ConnectedSocket() client: Socket): Promise<void> {
    const userId = await this.validateClientSession(client);
    if (!userId || !this.userSockets.get(userId)?.has(client.id)) return;
    const now = Date.now();
    if (now - (this.socketActivity.get(client.id) ?? 0) < 15_000) return;
    this.socketActivity.set(client.id, now);
    await this.publishAggregatePresence(userId);
    if ((this.userSockets.get(userId)?.size ?? 0) > 0) {
      this.scheduleIdleCheck(userId);
    }
  }

  async validateClientSession(client: Socket): Promise<string | undefined> {
    const userId = client.data.userId as string | undefined;
    const deviceId = client.data.deviceId as string | undefined;
    if (!userId || !deviceId) {
      client.disconnect(true);
      return undefined;
    }
    const active = await this.isClientSessionActive(userId, deviceId);
    if (!active) client.disconnect(true);
    if (!active || !this.isConnected(client)) return undefined;
    return userId;
  }

  private registerPendingConnection(
    client: Socket,
    userId: string,
    deviceId: string,
  ): PendingSocketConnection {
    const pending: PendingSocketConnection = {
      socketId: client.id,
      userId,
      deviceId,
      invalidated: false,
      userGeneration: this.userRevocationGeneration.get(userId) ?? 0,
      deviceGeneration: this.deviceRevocationGeneration.get(
        this.deviceRevocationKey(userId, deviceId),
      ) ?? 0,
      socket: client,
    };
    this.pendingSockets.set(client.id, pending);
    return pending;
  }

  private canPromotePendingConnection(
    client: Socket,
    pending: PendingSocketConnection,
  ): boolean {
    const current = this.pendingSockets.get(client.id);
    if (!current || current !== pending || current.invalidated) return false;
    if (!this.isConnected(client)) return false;
    if ((this.userRevocationGeneration.get(pending.userId) ?? 0)
      !== pending.userGeneration) {
      return false;
    }
    if ((this.deviceRevocationGeneration.get(
      this.deviceRevocationKey(pending.userId, pending.deviceId),
    ) ?? 0) !== pending.deviceGeneration) {
      return false;
    }
    return true;
  }

  private dropPendingConnection(socketId: string, disconnect: boolean): void {
    const pending = this.pendingSockets.get(socketId);
    if (pending) {
      pending.invalidated = true;
      this.pendingSockets.delete(socketId);
    }
    if (!disconnect) return;
    const socket = pending?.socket
      ?? this.server?.sockets.sockets.get(socketId);
    socket?.disconnect(true);
  }

  private removeRegisteredSocket(userId: string, socketId: string): void {
    const sockets = this.userSockets.get(userId);
    sockets?.delete(socketId);
    if (sockets && sockets.size === 0) this.userSockets.delete(userId);
    this.socketActivity.delete(socketId);
    const timer = this.validationTimers.get(socketId);
    if (timer) clearTimeout(timer);
    this.validationTimers.delete(socketId);
  }

  private async reconcilePresenceAfterAbort(userId: string): Promise<void> {
    if ((this.userSockets.get(userId)?.size ?? 0) > 0) {
      await this.publishAggregatePresence(userId);
      this.scheduleIdleCheck(userId);
      return;
    }
    this.clearUserTimers(userId);
    await this.publishPresence(userId, 'offline');
  }

  private bumpUserRevocationGeneration(userId: string): void {
    this.userRevocationGeneration.set(
      userId,
      (this.userRevocationGeneration.get(userId) ?? 0) + 1,
    );
  }

  private bumpDeviceRevocationGeneration(userId: string, deviceId: string): void {
    const key = this.deviceRevocationKey(userId, deviceId);
    this.deviceRevocationGeneration.set(
      key,
      (this.deviceRevocationGeneration.get(key) ?? 0) + 1,
    );
  }

  private deviceRevocationKey(userId: string, deviceId: string): string {
    return `${userId}:${deviceId}`;
  }

  private scheduleIdleCheck(userId: string): void {
    const existing = this.activityTimers.get(userId);
    if (existing) clearTimeout(existing);
    const idleMs = Math.max(1, Number(this.config.get<string>('PRESENCE_IDLE_SECONDS', '300'))) * 1000;
    const expiryTimes = [...(this.userSockets.get(userId) ?? [])]
      .map((socketId) => (this.socketActivity.get(socketId) ?? 0) + idleMs)
      .filter((expiryTime) => expiryTime > Date.now());
    if (!expiryTimes.length) return;
    const nextEvaluationMs = Math.max(0, Math.min(...expiryTimes) - Date.now());
    const timer = setTimeout(() => {
      this.activityTimers.delete(userId);
      void this.publishAggregatePresence(userId).then(() => {
        if ((this.userSockets.get(userId)?.size ?? 0) > 0) {
          this.scheduleIdleCheck(userId);
        }
      });
    }, nextEvaluationMs);
    this.activityTimers.set(userId, timer);
  }

  private async publishAggregatePresence(userId: string): Promise<void> {
    const generation = this.userRevocationGeneration.get(userId) ?? 0;
    if (!await this.revalidateUserSockets(userId)) return;
    if (!this.isPresencePublicationCurrent(userId, generation)) return;
    const idleMs = Math.max(1, Number(this.config.get<string>('PRESENCE_IDLE_SECONDS', '300'))) * 1000;
    const sockets = this.userSockets.get(userId);
    if (!sockets?.size) return;
    const isAnyActive = [...sockets].some((socketId) => Date.now() - (this.socketActivity.get(socketId) ?? 0) < idleMs);
    await this.publishPresence(userId, isAnyActive ? 'online' : 'idle');
    await this.reconcilePresencePublication(userId, generation);
  }

  /**
   * Corrects a stale online/idle DB write that finished after disconnectUser()
   * (or an equivalent revocation) already cleared sockets and published offline.
   */
  private async reconcilePresencePublication(
    userId: string,
    generation: number,
  ): Promise<void> {
    if (this.isPresencePublicationCurrent(userId, generation)) return;
    if ((this.userSockets.get(userId)?.size ?? 0) > 0) return;
    this.clearUserTimers(userId);
    await this.publishPresence(userId, 'offline');
  }

  private isPresencePublicationCurrent(
    userId: string,
    generation: number,
  ): boolean {
    return (this.userRevocationGeneration.get(userId) ?? 0) === generation
      && (this.userSockets.get(userId)?.size ?? 0) > 0;
  }

  private async publishPresence(userId: string, status: 'online' | 'idle' | 'offline'): Promise<void> {
    const presence = status === 'online'
      ? await this.presenceService.setOnline(userId)
      : status === 'idle' ? await this.presenceService.setIdle(userId) : await this.presenceService.setOffline(userId);
    const payload = { userId, status: presence.status, updatedAt: presence.updatedAt.toISOString() };
    for (const friendId of await this.presenceService.getFriendIds(userId)) this.events.publishToUser(friendId, 'presence.updated', payload);
  }

  private recordReconnect(): void {
    const now = Date.now();
    this.pruneReconnectEvents(now);
    this.reconnectEvents.push(now);
    if (this.reconnectEvents.length > MAX_RECONNECT_EVENTS) {
      this.reconnectEvents.splice(
        0,
        this.reconnectEvents.length - MAX_RECONNECT_EVENTS,
      );
    }
  }

  private pruneReconnectEvents(now = Date.now()): void {
    const cutoff = now - RECONNECT_WINDOW_MS;
    while (
      this.reconnectEvents.length > 0
      && this.reconnectEvents[0] < cutoff
    ) {
      this.reconnectEvents.shift();
    }
  }

  private scheduleSessionValidation(client: Socket): void {
    const configured = Number(this.config.get<string>('SOCKET_SESSION_REVALIDATE_SECONDS', '30'));
    const delayMs = Math.max(5, Number.isFinite(configured) ? configured : 30) * 1000;
    const timer = setTimeout(async () => {
      this.validationTimers.delete(client.id);
      const userId = await this.validateClientSession(client);
      if (!userId || !this.userSockets.get(userId)?.has(client.id)) return;
      this.scheduleSessionValidation(client);
    }, delayMs);
    this.validationTimers.set(client.id, timer);
  }

  private async revalidateUserSockets(userId: string): Promise<boolean> {
    const socketIds = [...(this.userSockets.get(userId) ?? [])];
    const invalidSocketIds: string[] = [];
    for (const socketId of socketIds) {
      const socket = this.server?.sockets.sockets.get(socketId);
      if (!socket) continue;
      const deviceId = socket.data.deviceId as string | undefined;
      if (!deviceId || !await this.isClientSessionActive(userId, deviceId)) {
        invalidSocketIds.push(socketId);
      }
    }
    const sockets = this.userSockets.get(userId);
    for (const socketId of invalidSocketIds) {
      sockets?.delete(socketId);
      this.socketActivity.delete(socketId);
      const timer = this.validationTimers.get(socketId);
      if (timer) clearTimeout(timer);
      this.validationTimers.delete(socketId);
      this.server?.sockets.sockets.get(socketId)?.disconnect(true);
    }
    if (sockets?.size) return true;
    if (invalidSocketIds.length) {
      this.userSockets.delete(userId);
      this.clearUserTimers(userId);
      await this.publishPresence(userId, 'offline');
    }
    return false;
  }

  private clearUserTimers(userId: string): void {
    const offline = this.offlineTimers.get(userId);
    if (offline) clearTimeout(offline);
    this.offlineTimers.delete(userId);
    const activity = this.activityTimers.get(userId);
    if (activity) clearTimeout(activity);
    this.activityTimers.delete(userId);
  }

  private async isClientSessionActive(
    userId: string,
    deviceId: string,
  ): Promise<boolean> {
    return this.socketAuth.isSessionActive(userId, deviceId)
      .catch(() => false);
  }

  private isConnected(client: Socket): boolean {
    return client.connected !== false;
  }
}
