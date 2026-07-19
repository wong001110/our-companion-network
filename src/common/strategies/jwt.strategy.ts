import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { Request } from 'express';
import { BROWSER_COOKIE_NAMES } from '../browser-security.service';

export interface JwtPayload {
  sub: string;
  email: string;
  deviceId: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request: Request) => {
          const cookie = request?.headers?.cookie;
          if (!cookie) return null;
          for (const part of cookie.split(';')) {
            const [name, ...value] = part.trim().split('=');
            if (name === BROWSER_COOKIE_NAMES.access) {
              try {
                return decodeURIComponent(value.join('='));
              } catch {
                return null;
              }
            }
          }
          return null;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload) {
    if (!payload.deviceId) throw new UnauthorizedException();
    const session = await this.prisma.deviceSession.findUnique({
      where: { userId_deviceId: { userId: payload.sub, deviceId: payload.deviceId } },
      select: { revokedAt: true, expiresAt: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException();
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, username: true, accountStatus: true },
    });

    if (!user || user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedException();
    }

    const { accountStatus: _accountStatus, ...safeUser } = user;
    return { ...safeUser, deviceId: payload.deviceId };
  }
}
