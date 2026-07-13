import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { SocialRateLimit } from '../common/decorators/social-rate-limit.decorator';
import { SocialRateLimitGuard } from '../common/guards/social-rate-limit.guard';
import { CompanionService } from './companion.service';
import { UpsertCompanionDto } from './dto/upsert-companion.dto';
import { InitiateAssetPackDto } from './dto/initiate-asset-pack.dto';
import { FileIdsDto } from './dto/file-ids.dto';

@Controller('companions')
@UseGuards(AuthGuard('jwt'), SocialRateLimitGuard)
export class CompanionController {
  constructor(private readonly companions: CompanionService) {}
  @Get('mine') @SocialRateLimit('read') mine(@CurrentUser() user: UserPayload) { return this.companions.getMine(user.id); }
  @Post() @SocialRateLimit('companion_profile') create(@CurrentUser() user: UserPayload, @Body() dto: UpsertCompanionDto) { return this.companions.create(user.id, dto); }
  @Patch(':id') @SocialRateLimit('companion_profile') update(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertCompanionDto) { return this.companions.update(user.id, id, dto); }
  @Post(':id/activate') @SocialRateLimit('companion_profile') activate(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.companions.activate(user.id, id); }
  @Post(':id/publish') @SocialRateLimit('companion_profile') publish(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.companions.publish(user.id, id); }
  @Post(':id/unpublish') @SocialRateLimit('companion_profile') unpublish(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.companions.unpublish(user.id, id); }
  @Get(':id/asset-packs') @SocialRateLimit('read') packs(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.companions.getAssetPacks(user.id, id); }
  @Post(':id/asset-packs') @SocialRateLimit('asset_initiate') initiate(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: InitiateAssetPackDto) { return this.companions.initiateAssetPack(user.id, id, dto); }
}

@Controller('asset-packs')
@UseGuards(AuthGuard('jwt'), SocialRateLimitGuard)
export class AssetPackController {
  constructor(private readonly companions: CompanionService) {}
  @Post(':id/upload-urls') @SocialRateLimit('asset_upload_urls') uploadUrls(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FileIdsDto) { return this.companions.createUploadUrls(user.id, id, dto.fileIds); }
  @Post(':id/complete') @SocialRateLimit('asset_complete') complete(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.companions.completeAssetPack(user.id, id); }
  @Post(':id/activate') @SocialRateLimit('mutation') activate(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.companions.activateAssetPack(user.id, id); }
  @Delete(':id') @SocialRateLimit('mutation') delete(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.companions.deleteAssetPack(user.id, id); }
  @Get(':id/manifest') @SocialRateLimit('read') manifest(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.companions.getManifest(user.id, id); }
  @Post(':id/download-urls') @SocialRateLimit('asset_download_urls') downloadUrls(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: FileIdsDto) { return this.companions.createDownloadUrls(user.id, id, dto.fileIds); }
}

@Controller('friends')
@UseGuards(AuthGuard('jwt'), SocialRateLimitGuard)
export class FriendCompanionController {
  constructor(private readonly companions: CompanionService) {}
  @Get(':friendUserId/companion') @SocialRateLimit('lookup') companion(@CurrentUser() user: UserPayload, @Param('friendUserId', ParseUUIDPipe) friendUserId: string) { return this.companions.getFriendCompanion(user.id, friendUserId); }
}
