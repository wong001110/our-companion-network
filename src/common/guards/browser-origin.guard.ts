import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { BrowserSecurityService } from '../browser-security.service';

@Injectable()
export class BrowserOriginGuard implements CanActivate {
  constructor(private readonly security: BrowserSecurityService) {}

  canActivate(context: ExecutionContext): boolean {
    this.security.requireAllowedOrigin(context.switchToHttp().getRequest());
    return true;
  }
}
