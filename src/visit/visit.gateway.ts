import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { VisitService } from './visit.service';
import { PresenceGateway } from '../presence/presence.gateway';
import { PrismaService } from '../prisma/prisma.service';

@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  },
})
export class VisitGateway {
  @WebSocketServer()
  server: Server;

  constructor(
    private visitService: VisitService,
    private presenceGateway: PresenceGateway,
    private prisma: PrismaService,
  ) {}

  @SubscribeMessage('visit:send')
  async handleVisitSend(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { receiverId: string; content: Record<string, any> },
  ) {
    const userId = client.data.userId;

    const visit = await this.visitService.sendVisit(userId, {
      receiverId: data.receiverId,
      content: data.content,
    });

    this.presenceGateway.emitToUser(data.receiverId, 'visit:received', {
      id: visit.id,
      sender: visit.sender,
      content: visit.content,
      createdAt: visit.createdAt,
    });

    return { success: true, visitId: visit.id };
  }

  @SubscribeMessage('visit:accept')
  async handleVisitAccept(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { visitId: string },
  ) {
    const userId = client.data.userId;

    const visit = await this.visitService.acceptVisit(userId, data.visitId);

    this.presenceGateway.emitToUser(visit.senderId, 'visit:status_updated', {
      visitId: visit.id,
      status: 'accepted',
    });

    return { success: true };
  }

  @SubscribeMessage('visit:dismiss')
  async handleVisitDismiss(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { visitId: string },
  ) {
    const userId = client.data.userId;

    const visit = await this.visitService.dismissVisit(userId, data.visitId);

    this.presenceGateway.emitToUser(visit.senderId, 'visit:status_updated', {
      visitId: visit.id,
      status: 'dismissed',
    });

    return { success: true };
  }
}
