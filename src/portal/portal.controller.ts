import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { PortalRateLimitGuard } from '../common/guards/portal-rate-limit.guard';
import { UpdateProfileDto } from '../community/dto/update-profile.dto';
import { BrowserAuthService } from './browser-auth.service';
import {
  ChangePasswordDto,
  PortalAccountDeleteDto,
  PortalDataDeleteDto,
} from './dto/portal-auth.dto';
import {
  FriendRequestQueryDto,
  PortalListQueryDto,
  PortalVisitQueryDto,
} from './dto/portal-query.dto';
import { PortalService } from './portal.service';

@Controller('portal')
@UseGuards(PortalRateLimitGuard)
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly browserAuth: BrowserAuthService,
  ) {}

  @Get('summary')
  summary(@CurrentUser() user: UserPayload) {
    return this.portal.summary(user.id);
  }

  @Get('profile')
  profile(@CurrentUser() user: UserPayload) {
    return this.portal.getProfile(user.id);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: UserPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.portal.updateProfile(user.id, dto);
  }

  @Get('companions')
  companions(
    @CurrentUser() user: UserPayload,
    @Query() query: PortalListQueryDto,
  ) {
    return this.portal.listCompanions(user.id, query);
  }

  @Get('companions/:id')
  companion(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.portal.getCompanion(user.id, id);
  }

  @Get('companions/:id/asset-packs')
  assetPacks(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PortalListQueryDto,
  ) {
    return this.portal.listAssetPacks(user.id, id, query);
  }

  @Post('companions/:id/publish')
  publish(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.portal.publishCompanion(user.id, id);
  }

  @Post('companions/:id/unpublish')
  unpublish(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.portal.unpublishCompanion(user.id, id);
  }

  @Get('friends')
  friends(
    @CurrentUser() user: UserPayload,
    @Query() query: PortalListQueryDto,
  ) {
    return this.portal.listFriends(user.id, query);
  }

  @Get('friend-requests')
  friendRequests(
    @CurrentUser() user: UserPayload,
    @Query() query: FriendRequestQueryDto,
  ) {
    return this.portal.listFriendRequests(user.id, query);
  }

  @Get('blocks')
  blocks(
    @CurrentUser() user: UserPayload,
    @Query() query: PortalListQueryDto,
  ) {
    return this.portal.listBlocks(user.id, query);
  }

  @Get('visits')
  visits(
    @CurrentUser() user: UserPayload,
    @Query() query: PortalVisitQueryDto,
  ) {
    return this.portal.listVisits(user.id, query);
  }

  @Get('visits/:id')
  visit(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.portal.getVisit(user.id, id);
  }

  @Get('devices')
  devices(
    @CurrentUser() user: UserPayload,
    @Query() query: PortalListQueryDto,
  ) {
    return this.portal.listDevices(user.id, query);
  }

  @Post('devices/revoke-others')
  revokeOtherDevices(@CurrentUser() user: UserPayload) {
    return this.portal.revokeOtherDevices(user.id, user.deviceId);
  }

  @Delete('devices/:id')
  async revokeDevice(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.portal.revokeDevice(user.id, id, user.deviceId);
    if (result.revokedCurrent) this.browserAuth.clearCookies(response);
    return result;
  }

  @Post('password')
  changePassword(
    @CurrentUser() user: UserPayload,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.portal.changePassword(user.id, user.deviceId, dto);
  }

  @Get('data-export')
  dataExport(@CurrentUser() user: UserPayload) {
    return this.portal.dataExport(user.id);
  }

  @Delete('data/notifications')
  deleteNotifications(
    @CurrentUser() user: UserPayload,
    @Body() _dto: PortalDataDeleteDto,
  ) {
    return this.portal.deleteNotifications(user.id);
  }

  @Delete('data/discoveries')
  deleteSharedDiscoveries(
    @CurrentUser() user: UserPayload,
    @Body() _dto: PortalDataDeleteDto,
  ) {
    return this.portal.deleteSharedDiscoveries(user.id);
  }

  @Delete('data/packs')
  deleteSupersededAssetPacks(
    @CurrentUser() user: UserPayload,
    @Body() _dto: PortalDataDeleteDto,
  ) {
    return this.portal.deleteSupersededAssetPacks(user.id);
  }

  @Delete('account')
  async deleteAccount(
    @CurrentUser() user: UserPayload,
    @Body() _dto: PortalAccountDeleteDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.portal.deleteAccount(user.id);
    this.browserAuth.clearCookies(response);
    return result;
  }
}
