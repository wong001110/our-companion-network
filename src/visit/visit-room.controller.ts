import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { SocialRateLimit } from '../common/decorators/social-rate-limit.decorator';
import { SocialRateLimitGuard } from '../common/guards/social-rate-limit.guard';
import { VisitRoomService } from './visit-room.service';

class CreateJoinRequestDto { @IsOptional() @IsUUID() topicId?: string; }
class RoomFileIdsDto { @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsUUID('4', { each: true }) fileIds: string[]; }

@UseGuards(AuthGuard('jwt'), SocialRateLimitGuard)
@Controller()
export class VisitRoomController {
  constructor(private readonly rooms: VisitRoomService) {}

  @Get('visit-reservation')
  @SocialRateLimit('visit_read')
  reservation(@CurrentUser() user: UserPayload) { return this.rooms.getReservation(user.id); }

  @Get('visit-sessions/:id/room')
  @SocialRateLimit('visit_read')
  room(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.getRoom(user.id, id); }

  @Post('visit-sessions/:id/join-requests')
  @SocialRateLimit('visit_create')
  join(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateJoinRequestDto) { return this.rooms.createJoinRequest(user.id, id, dto.topicId); }

  @Get('visit-sessions/:id/join-requests')
  @SocialRateLimit('visit_read')
  joinRequests(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.listJoinRequests(user.id, id); }

  @Post('visit-join-requests/:id/accept')
  @SocialRateLimit('visit_mutation')
  acceptJoin(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.acceptJoinRequest(user.id, id); }

  @Post('visit-join-requests/:id/decline')
  @SocialRateLimit('visit_mutation')
  declineJoin(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.declineJoinRequest(user.id, id); }

  @Post('visit-join-requests/:id/cancel')
  @SocialRateLimit('visit_mutation')
  cancelJoin(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.cancelJoinRequest(user.id, id); }

  @Post('visit-sessions/:id/participants/ready')
  @SocialRateLimit('visit_mutation')
  ready(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.markParticipantReady(user.id, id); }

  @Post('visit-sessions/:id/participants/leave')
  @SocialRateLimit('visit_mutation')
  leave(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.rooms.leaveRoom(user.id, id); }

  @Get('visit-sessions/:id/participants/:participantId/assets/manifest')
  @SocialRateLimit('visit_read')
  manifest(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Param('participantId', ParseUUIDPipe) participantId: string) { return this.rooms.getParticipantManifest(user.id, id, participantId); }

  @Post('visit-sessions/:id/participants/:participantId/assets/download-urls')
  @SocialRateLimit('visit_asset_urls')
  downloadUrls(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Param('participantId', ParseUUIDPipe) participantId: string, @Body() dto: RoomFileIdsDto) { return this.rooms.createParticipantDownloadUrls(user.id, id, participantId, dto.fileIds); }
}
