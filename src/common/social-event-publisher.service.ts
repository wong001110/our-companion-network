import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

/**
 * Keeps domain services independent of a particular WebSocket gateway.
 * Events are hints only; REST remains the social source of truth.
 */
@Injectable()
export class SocialEventPublisher {
  private server?: Server;

  attach(server: Server): void { this.server = server; }

  publishToUser(userId: string, event: string, payload: unknown): void {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }
}
