import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly attempts = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const key = `${request.ip}:${request.route?.path ?? request.path}`;
    const now = Date.now();
    const recent = (this.attempts.get(key) ?? []).filter((time) => now - time < 60_000);
    if (recent.length === 0) this.attempts.delete(key);
    if (recent.length >= 10) throw new HttpException('Too many authentication attempts', HttpStatus.TOO_MANY_REQUESTS);
    recent.push(now);
    this.attempts.set(key, recent);
    if (this.attempts.size > 10_000) this.attempts.delete(this.attempts.keys().next().value);
    return true;
  }
}
