import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IdentityService } from './identity.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthRateLimitGuard } from '../common/guards/auth-rate-limit.guard';

@Controller('auth')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Public()
  @UseGuards(AuthRateLimitGuard)
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.identityService.register(dto);
  }

  @Public()
  @UseGuards(AuthRateLimitGuard)
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.identityService.login(dto);
  }

  @Public()
  @UseGuards(AuthRateLimitGuard)
  @Post('refresh')
  async refreshToken(@Body() dto: RefreshTokenDto) {
    return this.identityService.refreshToken(dto.refreshToken, dto.deviceId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  async logout(@CurrentUser() user: UserPayload, @Body() dto: LogoutDto) {
    return this.identityService.logout(user.id, user.deviceId, dto.deviceId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async getProfile(@CurrentUser() user: UserPayload) {
    return this.identityService.getProfile(user.id);
  }
}
