import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PresenceService } from './presence.service';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
})
export class PresenceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userSockets = new Map<string, Set<string>>();
  private socketUsers = new Map<string, string>();

  constructor(
    private jwtService: JwtService,
    private presenceService: PresenceService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.query?.token;

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token as string);
      const userId = payload.sub;

      client.data.userId = userId;

      if (!this.userSockets.has(userId)) {
        this.userSockets.set(userId, new Set());
      }
      this.userSockets.get(userId)!.add(client.id);
      this.socketUsers.set(client.id, userId);

      await this.presenceService.setOnline(userId);

      const friends = await this.prisma.friendship.findMany({
        where: { userId },
        select: { friendId: true },
      });

      for (const friend of friends) {
        const friendSockets = this.userSockets.get(friend.friendId);
        if (friendSockets) {
          for (const socketId of friendSockets) {
            this.server.to(socketId).emit('presence:updated', {
              userId,
              status: 'online',
            });
          }
        }
      }

      const onlineFriends = await this.presenceService.getOnlineFriends(userId);
      client.emit('presence:friends_online', onlineFriends);
    } catch (error) {
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = this.socketUsers.get(client.id);

    if (userId) {
      const sockets = this.userSockets.get(userId);
      if (sockets) {
        sockets.delete(client.id);
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
          await this.presenceService.setOffline(userId);

          const friends = await this.prisma.friendship.findMany({
            where: { userId },
            select: { friendId: true },
          });

          for (const friend of friends) {
            const friendSockets = this.userSockets.get(friend.friendId);
            if (friendSockets) {
              for (const socketId of friendSockets) {
                this.server.to(socketId).emit('presence:updated', {
                  userId,
                  status: 'offline',
                });
              }
            }
          }
        }
      }
      this.socketUsers.delete(client.id);
    }
  }

  @SubscribeMessage('presence:update')
  async handlePresenceUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { status: 'online' | 'idle' },
  ) {
    const userId = client.data.userId;

    if (data.status === 'idle') {
      await this.presenceService.setIdle(userId);
    } else {
      await this.presenceService.setOnline(userId);
    }

    const friends = await this.prisma.friendship.findMany({
      where: { userId },
      select: { friendId: true },
    });

    for (const friend of friends) {
      const friendSockets = this.userSockets.get(friend.friendId);
      if (friendSockets) {
        for (const socketId of friendSockets) {
          this.server.to(socketId).emit('presence:updated', {
            userId,
            status: data.status,
          });
        }
      }
    }
  }

  emitToUser(userId: string, event: string, data: any) {
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      for (const socketId of sockets) {
        this.server.to(socketId).emit(event, data);
      }
    }
  }

  isUserOnline(userId: string): boolean {
    const sockets = this.userSockets.get(userId);
    return sockets !== undefined && sockets.size > 0;
  }
}
