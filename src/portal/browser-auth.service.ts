import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'node:crypto';
import { Response } from 'express';
import { IdentityService } from '../identity/identity.service';
import {
  BROWSER_COOKIE_NAMES,
  BrowserSecurityService,
} from '../common/browser-security.service';
import { PortalLoginDto } from './dto/portal-auth.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  ADMIN_AUDIT_ACTIONS,
  AuditService,
} from '../admin/audit.service';

interface RefreshPayload {
  sub: string;
  email: string;
  deviceId: string;
}

@Injectable()
export class BrowserAuthService {
  constructor(
    private readonly identity: IdentityService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly security: BrowserSecurityService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: PortalLoginDto, response: Response) {
    const deviceId = randomUUID();
    const result = await this.identity.login({ ...dto, deviceId });
    const csrfToken = this.security.createCsrfToken();
    await this.security.bindCsrfToken(result.user.id, deviceId, csrfToken);
    const account = await this.prisma.user.findUnique({
      where: { id: result.user.id },
      select: { role: true },
    });
    if (account?.role === 'SUPERADMIN') {
      await this.audit.record({
        adminUserId: result.user.id,
        action: ADMIN_AUDIT_ACTIONS.ADMIN_LOGIN,
        targetType: 'User',
        targetId: result.user.id,
        metadata: { source: 'browser_portal' },
      });
    }
    this.setCookies(
      response,
      result.accessToken,
      result.refreshToken,
      deviceId,
      csrfToken,
    );
    return {
      user: {
        ...result.user,
        role: account?.role ?? 'USER',
      },
    };
  }

  async session(userId: string) {
    const [profile, account] = await Promise.all([
      this.identity.getProfile(userId),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      }),
    ]);
    if (!account) throw new UnauthorizedException();
    return { ...profile, role: account.role };
  }

  async refresh(
    refreshToken: string | undefined,
    deviceId: string | undefined,
    csrfHeader: unknown,
    csrfCookie: unknown,
    response: Response,
  ) {
    if (!refreshToken || !deviceId) throw new UnauthorizedException();
    let payload: RefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (payload.deviceId !== deviceId) throw new UnauthorizedException();
    await this.security.requireCsrf(
      payload.sub,
      deviceId,
      csrfHeader,
      csrfCookie,
    );
    const tokens = await this.identity.refreshToken(refreshToken, deviceId);
    this.setTokenCookies(response, tokens.accessToken, tokens.refreshToken);
    return { refreshed: true };
  }

  async logout(
    userId: string,
    deviceId: string,
    response: Response,
  ) {
    await this.identity.logout(userId, deviceId, deviceId);
    this.clearCookies(response);
    return { loggedOut: true };
  }

  clearCookies(response: Response): void {
    for (const name of Object.values(BROWSER_COOKIE_NAMES)) {
      response.clearCookie(name, {
        ...this.security.cookieOptions(
          0,
          name !== BROWSER_COOKIE_NAMES.csrf,
          name === BROWSER_COOKIE_NAMES.csrf
            ? '/'
            : name === BROWSER_COOKIE_NAMES.refresh
              || name === BROWSER_COOKIE_NAMES.device
              ? '/api/portal/auth'
              : '/api',
        ),
      });
    }
  }

  private setCookies(
    response: Response,
    accessToken: string,
    refreshToken: string,
    deviceId: string,
    csrfToken: string,
  ): void {
    this.setTokenCookies(response, accessToken, refreshToken);
    response.cookie(
      BROWSER_COOKIE_NAMES.device,
      deviceId,
      this.security.cookieOptions(
        this.refreshMaxAge,
        true,
        '/api/portal/auth',
      ),
    );
    response.cookie(
      BROWSER_COOKIE_NAMES.csrf,
      csrfToken,
      // The double-submit token must be readable by the Portal document,
      // while the access and refresh credentials remain HTTP-only.
      this.security.cookieOptions(this.refreshMaxAge, false, '/'),
    );
  }

  private setTokenCookies(
    response: Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    response.cookie(
      BROWSER_COOKIE_NAMES.access,
      accessToken,
      this.security.cookieOptions(this.accessMaxAge),
    );
    response.cookie(
      BROWSER_COOKIE_NAMES.refresh,
      refreshToken,
      this.security.cookieOptions(
        this.refreshMaxAge,
        true,
        '/api/portal/auth',
      ),
    );
  }

  private get accessMaxAge(): number {
    return parseDuration(this.config.get<string>('JWT_EXPIRATION', '15m'));
  }

  private get refreshMaxAge(): number {
    return parseDuration(this.config.get<string>('JWT_REFRESH_EXPIRATION', '7d'));
  }
}

function parseDuration(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) throw new Error('JWT expiration must use s, m, h, or d units');
  const multiplier = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }[match[2] as 's' | 'm' | 'h' | 'd'];
  return Number(match[1]) * multiplier;
}
