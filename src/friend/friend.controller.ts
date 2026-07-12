import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FriendService } from './friend.service';
import { FriendRequestDto } from './dto/friend-request.dto';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';

@Controller('friends')
@UseGuards(AuthGuard('jwt'))
export class FriendController {
  constructor(private readonly friendService: FriendService) {}

  @Public()
  @Get('lookup/:code')
  async lookupByFriendCode(@Param('code') code: string) {
    return this.friendService.lookupByFriendCode(code);
  }

  @Post('request')
  async sendFriendRequest(
    @CurrentUser() user: UserPayload,
    @Body() dto: FriendRequestDto,
  ) {
    return this.friendService.sendFriendRequest(user.id, dto);
  }

  @Get('pending')
  async getPendingRequests(@CurrentUser() user: UserPayload) {
    return this.friendService.getPendingRequests(user.id);
  }

  @Patch('request/:id/accept')
  async acceptFriendRequest(
    @CurrentUser() user: UserPayload,
    @Param('id') requestId: string,
  ) {
    return this.friendService.acceptFriendRequest(user.id, requestId);
  }

  @Patch('request/:id/reject')
  async rejectFriendRequest(
    @CurrentUser() user: UserPayload,
    @Param('id') requestId: string,
  ) {
    return this.friendService.rejectFriendRequest(user.id, requestId);
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

  @Post('block/:id')
  async blockUser(
    @CurrentUser() user: UserPayload,
    @Param('id') blockedId: string,
  ) {
    return this.friendService.blockUser(user.id, blockedId);
  }

  @Delete('block/:id')
  async unblockUser(
    @CurrentUser() user: UserPayload,
    @Param('id') blockedId: string,
  ) {
    return this.friendService.unblockUser(user.id, blockedId);
  }
}
