import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { NotificationService } from './notification.service';
import { PresenceGateway } from '../presence/presence.gateway';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
})
export class NotificationGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private notificationService: NotificationService,
    private presenceGateway: PresenceGateway,
  ) {}

  async sendNotification(
    userId: string,
    type: string,
    title: string,
    message: string,
    data?: any,
  ) {
    const notification = await this.notificationService.create(
      userId,
      type,
      title,
      message,
      data,
    );

    this.presenceGateway.emitToUser(userId, 'notification:new', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      data: notification.data,
      createdAt: notification.createdAt,
    });

    return notification;
  }

  @SubscribeMessage('notification:mark_read')
  async handleMarkRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { notificationId: string },
  ) {
    const userId = await this.presenceGateway.validateClientSession(client);
    if (!userId) return;
    return this.notificationService.markAsRead(userId, data.notificationId);
  }

  @SubscribeMessage('notification:mark_all_read')
  async handleMarkAllRead(@ConnectedSocket() client: Socket) {
    const userId = await this.presenceGateway.validateClientSession(client);
    if (!userId) return;
    return this.notificationService.markAllAsRead(userId);
  }
}
