import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FriendService } from './friend.service';
import { FriendRequestDto } from './dto/friend-request.dto';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { SocialRateLimitGuard } from '../common/guards/social-rate-limit.guard';
import { SocialRateLimit } from '../common/decorators/social-rate-limit.decorator';

@Controller('friends')
@UseGuards(AuthGuard('jwt'), SocialRateLimitGuard)
export class FriendController {
  constructor(private readonly friendService: FriendService) {}

  @Get('lookup/uid/:uid')
  @SocialRateLimit('lookup')
  async lookupByUid(@CurrentUser() user: UserPayload, @Param('uid') uid: string) {
    return this.friendService.lookupByUid(uid, user.id);
  }

  @Get('lookup/:friendCode')
  @SocialRateLimit('lookup')
  async lookupByFriendCode(@CurrentUser() user: UserPayload, @Param('friendCode') code: string) {
    return this.friendService.lookupByFriendCode(code, user.id);
  }

  @Post('requests')
  @SocialRateLimit('friend_request_create')
  async sendFriendRequest(
    @CurrentUser() user: UserPayload,
    @Body() dto: FriendRequestDto,
  ) {
    return this.friendService.sendFriendRequest(user.id, dto);
  }

  @Get('requests/incoming')
  @SocialRateLimit('read')
  async getIncomingRequests(@CurrentUser() user: UserPayload) {
    return this.friendService.getIncomingRequests(user.id);
  }

  @Get('requests/outgoing')
  @SocialRateLimit('read')
  async getOutgoingRequests(@CurrentUser() user: UserPayload) {
    return this.friendService.getOutgoingRequests(user.id);
  }

  @Post('requests/:id/accept')
  @SocialRateLimit('mutation')
  async acceptFriendRequest(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) requestId: string,
  ) {
    return this.friendService.acceptFriendRequest(user.id, requestId);
  }

  @Post('requests/:id/reject')
  @SocialRateLimit('mutation')
  async rejectFriendRequest(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) requestId: string,
  ) {
    return this.friendService.rejectFriendRequest(user.id, requestId);
  }

  @Post('requests/:id/cancel')
  @SocialRateLimit('mutation')
  async cancelFriendRequest(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) requestId: string,
  ) {
    return this.friendService.cancelFriendRequest(user.id, requestId);
  }

  @Get()
  @SocialRateLimit('read')
  async getFriends(@CurrentUser() user: UserPayload) {
    return this.friendService.getFriends(user.id);
  }

  @Delete(':id')
  @SocialRateLimit('block_mutation')
  async removeFriend(
    @CurrentUser() user: UserPayload,
    @Param('id', ParseUUIDPipe) friendId: string,
  ) {
    return this.friendService.removeFriend(user.id, friendId);
  }

}
