import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FriendService } from './friend.service';
import { FriendRequestDto } from './dto/friend-request.dto';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { SocialRateLimitGuard } from '../common/guards/social-rate-limit.guard';

@Controller('friends')
@UseGuards(AuthGuard('jwt'))
@UseGuards(SocialRateLimitGuard)
export class FriendController {
  constructor(private readonly friendService: FriendService) {}

  @Get('lookup/:friendCode')
  async lookupByFriendCode(@CurrentUser() user: UserPayload, @Param('friendCode') code: string) {
    return this.friendService.lookupByFriendCode(code, user.id);
  }

  @Post('requests')
  async sendFriendRequest(
    @CurrentUser() user: UserPayload,
    @Body() dto: FriendRequestDto,
  ) {
    return this.friendService.sendFriendRequest(user.id, dto);
  }

  @Get('requests/incoming')
  async getIncomingRequests(@CurrentUser() user: UserPayload) {
    return this.friendService.getIncomingRequests(user.id);
  }

  @Get('requests/outgoing')
  async getOutgoingRequests(@CurrentUser() user: UserPayload) {
    return this.friendService.getOutgoingRequests(user.id);
  }

  @Post('requests/:id/accept')
  async acceptFriendRequest(
    @CurrentUser() user: UserPayload,
    @Param('id') requestId: string,
  ) {
    return this.friendService.acceptFriendRequest(user.id, requestId);
  }

  @Post('requests/:id/reject')
  async rejectFriendRequest(
    @CurrentUser() user: UserPayload,
    @Param('id') requestId: string,
  ) {
    return this.friendService.rejectFriendRequest(user.id, requestId);
  }

  @Post('requests/:id/cancel')
  async cancelFriendRequest(
    @CurrentUser() user: UserPayload,
    @Param('id') requestId: string,
  ) {
    return this.friendService.cancelFriendRequest(user.id, requestId);
  }

  @Get()
  async getFriends(@CurrentUser() user: UserPayload) {
    return this.friendService.getFriends(user.id);
  }

  @Delete(':id')
  async removeFriend(
    @CurrentUser() user: UserPayload,
    @Param('id') friendId: string,
  ) {
    return this.friendService.removeFriend(user.id, friendId);
  }

}
