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
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller('auth')
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.identityService.register(dto);
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.identityService.login(dto);
  }

  @Public()
  @Post('refresh')
  async refreshToken(@Body() dto: RefreshTokenDto) {
    return this.identityService.refreshToken(dto.refreshToken);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  async logout(@Body() dto: RefreshTokenDto) {
    return this.identityService.logout(dto.refreshToken);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async getProfile(@CurrentUser() user: UserPayload) {
    return this.identityService.getProfile(user.id);
  }
}
