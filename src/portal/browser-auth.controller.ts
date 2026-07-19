import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import {
  BROWSER_COOKIE_NAMES,
  BrowserSecurityService,
} from '../common/browser-security.service';
import { BrowserOriginGuard } from '../common/guards/browser-origin.guard';
import { PortalRateLimitGuard } from '../common/guards/portal-rate-limit.guard';
import { AuthRateLimitGuard } from '../common/guards/auth-rate-limit.guard';
import { BrowserAuthService } from './browser-auth.service';
import { PortalLoginDto } from './dto/portal-auth.dto';

@Controller('portal/auth')
@UseGuards(PortalRateLimitGuard)
export class BrowserAuthController {
  constructor(
    private readonly auth: BrowserAuthService,
    private readonly security: BrowserSecurityService,
  ) {}

  @Public()
  @UseGuards(BrowserOriginGuard, AuthRateLimitGuard)
  @Post('login')
  login(
    @Body() dto: PortalLoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.login(dto, response);
  }

  @Public()
  @UseGuards(BrowserOriginGuard, AuthRateLimitGuard)
  @Post('refresh')
  refresh(
    @Req() request: Request,
    @Headers('x-csrf-token') csrfHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    const cookies = this.security.parseCookies(request);
    return this.auth.refresh(
      cookies[BROWSER_COOKIE_NAMES.refresh],
      cookies[BROWSER_COOKIE_NAMES.device],
      csrfHeader,
      cookies[BROWSER_COOKIE_NAMES.csrf],
      response,
    );
  }

  @Post('logout')
  logout(
    @CurrentUser() user: UserPayload,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.auth.logout(user.id, user.deviceId, response);
  }

  @Get('session')
  session(@CurrentUser() user: UserPayload) {
    return this.auth.session(user.id);
  }
}
