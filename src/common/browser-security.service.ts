import {
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

export const BROWSER_COOKIE_NAMES = {
  access: 'oc_access',
  refresh: 'oc_refresh',
  device: 'oc_device',
  csrf: 'oc_csrf',
} as const;

@Injectable()
export class BrowserSecurityService {
  private readonly origins: Set<string>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const configured = [
      ...(config.get<string>('PORTAL_ORIGINS') ?? '').split(','),
      ...(config.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000').split(','),
    ].map((value) => value.trim()).filter(Boolean);
    this.origins = new Set(configured.map((value) => this.normalizeOrigin(value)));
  }

  get allowedOrigins(): string[] {
    return [...this.origins];
  }

  isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    try {
      return this.origins.has(this.normalizeOrigin(origin));
    } catch {
      return false;
    }
  }

  requireAllowedOrigin(request: Pick<Request, 'headers'>): void {
    const origin = request.headers.origin;
    if (typeof origin !== 'string' || !this.isAllowedOrigin(origin)) {
      throw new ForbiddenException({
        code: 'ORIGIN_NOT_ALLOWED',
        message: 'Request origin is not allowed',
      });
    }
  }

  parseCookies(request: Pick<Request, 'headers'>): Record<string, string> {
    const header = request.headers.cookie;
    if (!header) return {};
    return header.split(';').reduce<Record<string, string>>((cookies, part) => {
      const separator = part.indexOf('=');
      if (separator < 1) return cookies;
      const key = part.slice(0, separator).trim();
      const raw = part.slice(separator + 1).trim();
      try {
        cookies[key] = decodeURIComponent(raw);
      } catch {
        cookies[key] = raw;
      }
      return cookies;
    }, {});
  }

  accessTokenFromRequest(request: Request): string | null {
    return this.parseCookies(request)[BROWSER_COOKIE_NAMES.access] ?? null;
  }

  createCsrfToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashCsrfToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  async bindCsrfToken(userId: string, deviceId: string, token: string) {
    await this.prisma.deviceSession.update({
      where: { userId_deviceId: { userId, deviceId } },
      data: { csrfTokenHash: this.hashCsrfToken(token) },
    });
  }

  async requireCsrf(
    userId: string,
    deviceId: string,
    headerToken: unknown,
    cookieToken: unknown,
  ): Promise<void> {
    if (typeof headerToken !== 'string' || typeof cookieToken !== 'string') {
      throw this.csrfFailure();
    }
    const headerHash = this.hashCsrfToken(headerToken);
    const cookieHash = this.hashCsrfToken(cookieToken);
    if (!this.safeEqual(headerHash, cookieHash)) throw this.csrfFailure();
    const session = await this.prisma.deviceSession.findUnique({
      where: { userId_deviceId: { userId, deviceId } },
      select: { csrfTokenHash: true, revokedAt: true, expiresAt: true },
    });
    if (!session
      || session.revokedAt
      || session.expiresAt <= new Date()
      || !session.csrfTokenHash
      || !this.safeEqual(headerHash, session.csrfTokenHash)) {
      throw this.csrfFailure();
    }
  }

  cookieOptions(maxAgeMs: number, httpOnly = true, path = '/api') {
    const configuredSameSite = this.config.get<string>('PORTAL_COOKIE_SAME_SITE', 'strict').toLowerCase();
    const sameSite = configuredSameSite === 'lax' ? 'lax' as const : 'strict' as const;
    return {
      httpOnly,
      secure: this.config.get<string>('PORTAL_COOKIE_SECURE', 'true') !== 'false',
      sameSite,
      maxAge: maxAgeMs,
      path,
    };
  }

  private normalizeOrigin(value: string): string {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)
      || parsed.username
      || parsed.password
      || parsed.pathname !== '/'
      || parsed.search
      || parsed.hash) {
      throw new Error(`Invalid portal origin: ${value}`);
    }
    return parsed.origin;
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private csrfFailure() {
    return new ForbiddenException({
      code: 'CSRF_VALIDATION_FAILED',
      message: 'CSRF validation failed',
    });
  }
}
