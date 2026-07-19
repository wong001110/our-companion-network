import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class PortalRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & {
      user?: { id?: string };
    }>();
    const read = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const windowMs = 60_000;
    const limit = read ? 120 : 30;
    const key = `${request.user?.id ?? request.ip}:${read ? 'read' : 'write'}`;
    const now = Date.now();
    const recent = (this.attempts.get(key) ?? [])
      .filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= limit) {
      throw new HttpException({
        code: 'RATE_LIMITED',
        message: 'Too many portal requests',
      }, HttpStatus.TOO_MANY_REQUESTS);
    }
    recent.push(now);
    this.attempts.set(key, recent);
    if (this.attempts.size > 10_000) {
      this.attempts.delete(this.attempts.keys().next().value as string);
    }
    return true;
  }
}
