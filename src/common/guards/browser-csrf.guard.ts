import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import {
  BROWSER_COOKIE_NAMES,
  BrowserSecurityService,
} from '../browser-security.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class BrowserCsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly security: BrowserSecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & {
      user?: { id?: string; deviceId?: string };
    }>();
    if (SAFE_METHODS.has(request.method)) return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    const cookies = this.security.parseCookies(request);
    if (!cookies[BROWSER_COOKIE_NAMES.access]) return true;

    this.security.requireAllowedOrigin(request);
    await this.security.requireCsrf(
      request.user?.id ?? '',
      request.user?.deviceId ?? '',
      request.headers['x-csrf-token'],
      cookies[BROWSER_COOKIE_NAMES.csrf],
    );
    return true;
  }
}
