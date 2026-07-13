import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SOCIAL_RATE_LIMIT_POLICY, SocialRateLimitPolicy } from '../decorators/social-rate-limit.decorator';

const POLICIES: Record<SocialRateLimitPolicy, { windowMs: number; limit: number }> = {
  read: { windowMs: 60_000, limit: 120 },
  lookup: { windowMs: 60_000, limit: 30 },
  friend_request_create: { windowMs: 3_600_000, limit: 10 },
  mutation: { windowMs: 3_600_000, limit: 60 },
  block_mutation: { windowMs: 3_600_000, limit: 30 },
  companion_profile: { windowMs: 3_600_000, limit: 30 },
  asset_initiate: { windowMs: 3_600_000, limit: 10 },
  asset_upload_urls: { windowMs: 60_000, limit: 120 },
  asset_complete: { windowMs: 3_600_000, limit: 20 },
  asset_download_urls: { windowMs: 60_000, limit: 120 },
};

@Injectable()
export class SocialRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, number[]>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: { id?: string } }>();
    const policy = this.reflector.getAllAndOverride<SocialRateLimitPolicy>(SOCIAL_RATE_LIMIT_POLICY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? 'mutation';
    const { windowMs, limit } = POLICIES[policy];
    const key = `${request.user?.id ?? 'anonymous'}:${policy}`;
    const now = Date.now();
    const recent = (this.attempts.get(key) ?? []).filter((time) => now - time < windowMs);
    if (recent.length >= limit) throw new HttpException({ code: 'RATE_LIMITED', message: 'Too many social actions' }, HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.attempts.set(key, recent);
    this.cleanup(now);
    return true;
  }

  private cleanup(now: number): void {
    for (const [key, timestamps] of this.attempts) {
      const policy = key.slice(key.lastIndexOf(':') + 1) as SocialRateLimitPolicy;
      const retained = timestamps.filter((time) => now - time < (POLICIES[policy]?.windowMs ?? POLICIES.mutation.windowMs));
      if (retained.length) this.attempts.set(key, retained);
      else this.attempts.delete(key);
    }
    while (this.attempts.size > 10_000) this.attempts.delete(this.attempts.keys().next().value as string);
  }
}
