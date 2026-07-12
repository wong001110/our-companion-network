import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { Server, Socket } from 'socket.io';
import { PresenceService } from './presence.service';
import { SocketAuthService } from '../common/socket-auth.service';

@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true },
})
export class PresenceGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly userSockets = new Map<string, Set<string>>();
  private readonly offlineTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly presenceService: PresenceService,
    private readonly socketAuth: SocketAuthService,
    private readonly config: ConfigService,
  ) {}

  afterInit(server: Server): void {
    this.socketAuth.configure(server);
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
    const wasOffline = sockets.size === 0;
    sockets.add(client.id);
    this.userSockets.set(userId, sockets);
    if (wasOffline) await this.presenceService.setOnline(userId);
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = client.data.userId as string | undefined;
    if (!userId) return;
    const sockets = this.userSockets.get(userId);
    if (!sockets) return;
    sockets.delete(client.id);
    if (sockets.size > 0) return;
    this.userSockets.delete(userId);
    const graceSeconds = Number(this.config.get<string>('PRESENCE_DISCONNECT_GRACE_SECONDS', '45'));
    const timer = setTimeout(() => {
      this.offlineTimers.delete(userId);
      if (!this.userSockets.has(userId)) void this.presenceService.setOffline(userId);
    }, Math.max(0, graceSeconds) * 1000);
    this.offlineTimers.set(userId, timer);
  }

  emitToUser(userId: string, event: string, data: unknown): void {
    for (const socketId of this.userSockets.get(userId) ?? []) this.server.to(socketId).emit(event, data);
  }

  isUserOnline(userId: string): boolean {
    return (this.userSockets.get(userId)?.size ?? 0) > 0;
  }
}
