import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { SocialRateLimit } from '../common/decorators/social-rate-limit.decorator';
import { SocialRateLimitGuard } from '../common/guards/social-rate-limit.guard';
import { VisitService } from './visit.service';

class CreateInvitationDto { @IsUUID() hostUserId: string; }
class ListVisitInvitationsDto {
  @IsOptional() @IsIn(['incoming', 'outgoing']) direction?: 'incoming' | 'outgoing';
  @IsOptional() @IsIn(['pending', 'accepted', 'declined', 'cancelled', 'expired']) status?: string;
}
class VisitFileIdsDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('4', { each: true }) fileIds: string[]; }

@UseGuards(AuthGuard('jwt'), SocialRateLimitGuard)
@Controller('visit-invitations')
export class VisitInvitationController {
  constructor(private readonly visits: VisitService) {}
  @Get() @SocialRateLimit('visit_read') list(@CurrentUser() user: UserPayload, @Query() query: ListVisitInvitationsDto) { return this.visits.listInvitations(user.id, query.direction, query.status); }
  @Post() @SocialRateLimit('visit_create') create(@CurrentUser() user: UserPayload, @Body() dto: CreateInvitationDto) { return this.visits.createInvitation(user.id, dto.hostUserId); }
  @Post(':id/accept') @SocialRateLimit('visit_mutation') accept(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.visits.acceptInvitation(user.id, id); }
  @Post(':id/decline') @SocialRateLimit('visit_mutation') decline(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.visits.declineInvitation(user.id, id); }
  @Post(':id/cancel') @SocialRateLimit('visit_mutation') cancel(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.visits.cancelInvitation(user.id, id); }
}

@UseGuards(AuthGuard('jwt'), SocialRateLimitGuard)
@Controller('visit-sessions')
export class VisitSessionController {
  constructor(private readonly visits: VisitService) {}
  @Get() @SocialRateLimit('visit_read') list(@CurrentUser() user: UserPayload) { return this.visits.listSessions(user.id); }
  @Get(':id') @SocialRateLimit('visit_read') get(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.visits.getSession(user.id, id); }
  @Post(':id/ready') @SocialRateLimit('visit_mutation') ready(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.visits.markReady(user.id, id); }
  @Post(':id/start') @SocialRateLimit('visit_mutation') start(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.visits.startSession(user.id, id); }
  @Post(':id/end') @SocialRateLimit('visit_mutation') end(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.visits.endSession(user.id, id); }
  @Post(':id/heartbeat') @SocialRateLimit('visit_heartbeat') heartbeat(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.visits.heartbeat(user.id, id); }
  @Get(':id/assets/manifest') @SocialRateLimit('visit_read') manifest(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.visits.getSessionManifest(user.id, id); }
  @Post(':id/assets/download-urls') @SocialRateLimit('visit_asset_urls') urls(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VisitFileIdsDto) { return this.visits.createSessionDownloadUrls(user.id, id, dto.fileIds); }
}
