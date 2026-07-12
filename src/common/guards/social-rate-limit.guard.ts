import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';

@Injectable()
export class SocialRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { id?: string }; route?: { path?: string }; path?: string }>();
    const path = request.route?.path ?? request.path ?? '';
    const windowMs = path.includes('lookup') ? 60_000 : 3_600_000;
    const limit = path.includes('lookup') ? 30 : path.includes('blocks') ? 30 : 10;
    const key = `${request.user?.id ?? 'anonymous'}:${path}`;
    const now = Date.now();
    const recent = (this.attempts.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) throw new HttpException({ code: 'RATE_LIMITED', message: 'Too many social actions' }, HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now); this.attempts.set(key, recent);
    if (this.attempts.size > 10_000) this.attempts.delete(this.attempts.keys().next().value);
    return true;
  }
}
