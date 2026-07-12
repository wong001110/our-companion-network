import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

interface AccessPayload { sub: string; email: string; deviceId: string; }

@Injectable()
export class SocketAuthService {
  private readonly logger = new Logger(SocketAuthService.name);
  private readonly configuredServers = new WeakSet<Server>();
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  configure(server: Server): void {
    if (this.configuredServers.has(server)) return;
    this.configuredServers.add(server);
    server.use(async (client, next) => {
      try {
        const address = client.handshake.address || 'unknown';
        if (!this.allowAttempt(address)) return next(new Error('RATE_LIMITED'));
        const token = client.handshake.auth?.token;
        const protocolVersion = client.handshake.auth?.protocolVersion;
        const deviceId = client.handshake.auth?.deviceId;
        if (typeof token !== 'string' || typeof protocolVersion !== 'string' || typeof deviceId !== 'string') {
          return next(new Error('AUTHENTICATION_REQUIRED'));
        }
        if (protocolVersion !== this.config.get<string>('PROTOCOL_VERSION', '0.1')) {
          return next(new Error('UNSUPPORTED_PROTOCOL_VERSION'));
        }
        const payload = await this.jwtService.verifyAsync<AccessPayload>(token);
        if (!payload.sub || payload.deviceId !== deviceId) return next(new Error('AUTHENTICATION_FAILED'));
        const session = await this.prisma.deviceSession.findUnique({
          where: { userId_deviceId: { userId: payload.sub, deviceId } },
          select: { revokedAt: true, expiresAt: true },
        });
        if (!session || session.revokedAt || session.expiresAt <= new Date()) return next(new Error('AUTHENTICATION_FAILED'));

        client.data.userId = payload.sub;
        client.data.deviceId = deviceId;
        client.data.protocolVersion = protocolVersion;
        next();
      } catch {
        this.logger.warn('Rejected unauthenticated socket connection');
        next(new Error('AUTHENTICATION_FAILED'));
      }
    });
  }

  private allowAttempt(address: string): boolean {
    const now = Date.now();
    const windowMs = 60_000;
    const limit = Number(this.config.get<string>('SOCKET_AUTH_RATE_LIMIT', '20'));
    const recent = (this.attempts.get(address) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= limit) return false;
    recent.push(now);
    this.attempts.set(address, recent);
    return true;
  }
}
