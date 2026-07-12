import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CommunityService } from './community.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CreateDiscoveryDto } from './dto/create-discovery.dto';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller('community')
export class CommunityController {
  constructor(private readonly communityService: CommunityService) {}

  @Public()
  @Get('profile/:userId')
  async getPublicProfile(@Param('userId') userId: string) {
    return this.communityService.getPublicProfile(userId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.communityService.updateProfile(user.id, dto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('discoveries')
  async createDiscovery(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateDiscoveryDto,
  ) {
    return this.communityService.createDiscovery(user.id, dto);
  }

  @Public()
  @Get('discoveries')
  async getPublicDiscoveries(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.communityService.getPublicDiscoveries(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('discoveries/me')
  async getUserDiscoveries(@CurrentUser() user: UserPayload) {
    return this.communityService.getUserDiscoveries(user.id);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('discoveries/:id')
  async deleteDiscovery(
    @CurrentUser() user: UserPayload,
    @Param('id') discoveryId: string,
  ) {
    return this.communityService.deleteDiscovery(user.id, discoveryId);
  }
}
