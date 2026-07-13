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

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true },
})
export class PresenceGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly userSockets = new Map<string, Set<string>>();
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();
  private readonly activityTimers = new Map<string, NodeJS.Timeout>();
  private readonly socketActivity = new Map<string, number>();

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
    if (!userId) {
      client.disconnect(true);
      return;
    }
    const timer = this.offlineTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.offlineTimers.delete(userId);
    }
    const sockets = this.userSockets.get(userId) ?? new Set<string>();
    sockets.add(client.id);
    client.join(`user:${userId}`);
    this.socketActivity.set(client.id, Date.now());
    this.userSockets.set(userId, sockets);
    await this.publishPresence(userId, 'online');
    this.scheduleIdleCheck(userId);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    sockets.delete(client.id);
    this.socketActivity.delete(client.id);
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
    // A normal app close is a deliberate disconnect, so friends should see the
    // user as offline without a delay. Deployments may still opt into a grace
    // period when transient-disconnect smoothing is more important.
    const graceSeconds = Number(this.config.get<string>('PRESENCE_DISCONNECT_GRACE_SECONDS', '0'));
    if (!Number.isFinite(graceSeconds) || graceSeconds <= 0) {
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

  isUserOnline(userId: string): boolean {
    return (this.userSockets.get(userId)?.size ?? 0) > 0;
  }

  @SubscribeMessage('presence.activity')
  async handleActivity(@ConnectedSocket() client: Socket): Promise<void> {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const now = Date.now();
    if (now - (this.socketActivity.get(client.id) ?? 0) < 15_000) return;
    this.socketActivity.set(client.id, now);
    await this.publishAggregatePresence(userId);
    this.scheduleIdleCheck(userId);
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
      void this.publishAggregatePresence(userId).then(() => this.scheduleIdleCheck(userId));
    }, nextEvaluationMs);
    this.activityTimers.set(userId, timer);
  }

  private async publishAggregatePresence(userId: string): Promise<void> {
    const idleMs = Math.max(1, Number(this.config.get<string>('PRESENCE_IDLE_SECONDS', '300'))) * 1000;
    const sockets = this.userSockets.get(userId);
    if (!sockets?.size) return;
    const isAnyActive = [...sockets].some((socketId) => Date.now() - (this.socketActivity.get(socketId) ?? 0) < idleMs);
    await this.publishPresence(userId, isAnyActive ? 'online' : 'idle');
  }

  private async publishPresence(userId: string, status: 'online' | 'idle' | 'offline'): Promise<void> {
    const presence = status === 'online'
      ? await this.presenceService.setOnline(userId)
      : status === 'idle' ? await this.presenceService.setIdle(userId) : await this.presenceService.setOffline(userId);
    const payload = { userId, status: presence.status, updatedAt: presence.updatedAt.toISOString() };
    for (const friendId of await this.presenceService.getFriendIds(userId)) this.events.publishToUser(friendId, 'presence.updated', payload);
  }
}
