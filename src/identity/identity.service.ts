import {
  Injectable,
  ConflictException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcryptjs';
import { randomBytes, randomUUID } from 'crypto';

const REFRESH_TOKEN_COST = 12;

@Injectable()
export class IdentityService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { username: dto.username }] },
    });
    if (existingUser) throw new ConflictException('Email or username already exists');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        username: dto.username,
        passwordHash,
        friendCode: this.generateFriendCode(),
        profile: { create: { displayName: dto.username } },
      },
      select: { id: true, email: true, username: true, friendCode: true, createdAt: true },
    });

    return { user, ...(await this.createSessionTokens(user.id, user.email, dto.deviceId)) };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return {
      user: { id: user.id, email: user.email, username: user.username, friendCode: user.friendCode },
      ...(await this.createSessionTokens(user.id, user.email, dto.deviceId)),
    };
  }

  async refreshToken(refreshToken: string, deviceId: string) {
    const sessions = await this.prisma.deviceSession.findMany({
      where: { deviceId },
      include: { user: true },
    });
    const reused = await this.findMatchingSession(sessions, refreshToken, 'previousRefreshTokenHash');
    if (reused) {
      await this.prisma.deviceSession.update({
        where: { id: reused.id }, data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }
    const activeSession = await this.findMatchingSession(sessions, refreshToken, 'refreshTokenHash');
    if (!activeSession || activeSession.revokedAt || activeSession.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.rotateSessionTokens(activeSession.id, activeSession.userId, activeSession.user.email, deviceId);
  }

  async logout(userId: string, accessTokenDeviceId: string, deviceId: string) {
    if (accessTokenDeviceId !== deviceId) {
      throw new ForbiddenException({ code: 'DEVICE_SESSION_MISMATCH', message: 'Device ID does not match this access token' });
    }
    await this.prisma.deviceSession.updateMany({
      where: { userId, deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out successfully' };
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, friendCode: true, createdAt: true, profile: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    return user;
  }

  private async createSessionTokens(userId: string, email: string, deviceId: string) {
    const tokens = await this.issueTokens(userId, email, deviceId);
    const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, REFRESH_TOKEN_COST);
    await this.prisma.deviceSession.upsert({
      where: { userId_deviceId: { userId, deviceId } },
      create: { userId, deviceId, refreshTokenHash, expiresAt: tokens.refreshExpiresAt },
      update: {
        refreshTokenHash,
        previousRefreshTokenHash: null,
        expiresAt: tokens.refreshExpiresAt,
        revokedAt: null,
      },
    });
    return tokens.publicTokens;
  }

  private async rotateSessionTokens(sessionId: string, userId: string, email: string, deviceId: string) {
    const tokens = await this.issueTokens(userId, email, deviceId);
    const refreshTokenHash = await bcrypt.hash(tokens.refreshToken, REFRESH_TOKEN_COST);
    const session = await this.prisma.deviceSession.findUniqueOrThrow({ where: { id: sessionId } });
    await this.prisma.deviceSession.update({
      where: { id: sessionId },
      data: {
        refreshTokenHash,
        previousRefreshTokenHash: session.refreshTokenHash,
        expiresAt: tokens.refreshExpiresAt,
        revokedAt: null,
      },
    });
    return tokens.publicTokens;
  }

  private async issueTokens(userId: string, email: string, deviceId: string) {
    const payload = { sub: userId, email, deviceId };
    const refreshExpiry = this.configService.get<string>('JWT_REFRESH_EXPIRATION', '7d');
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload),
      this.jwtService.signAsync({ ...payload, jti: randomUUID() }, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshExpiry,
      }),
    ]);
    return {
      publicTokens: { accessToken, refreshToken },
      refreshToken,
      refreshExpiresAt: this.parseExpiry(refreshExpiry),
    };
  }

  private async findMatchingSession<T extends Record<string, unknown>>(
    sessions: T[], token: string, field: 'refreshTokenHash' | 'previousRefreshTokenHash',
  ): Promise<T | undefined> {
    for (const session of sessions) {
      const hash = session[field];
      if (typeof hash === 'string' && await bcrypt.compare(token, hash)) return session;
    }
    return undefined;
  }

  private parseExpiry(value: string): Date {
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) throw new Error('JWT_REFRESH_EXPIRATION must use s, m, h, or d units');
    const amount = Number(match[1]);
    const multiplier = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
    return new Date(Date.now() + amount * multiplier);
  }

  private generateFriendCode(): string {
    return randomBytes(4).toString('hex').toUpperCase();
  }
}
