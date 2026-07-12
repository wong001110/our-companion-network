import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsUUID } from 'class-validator';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { FriendService } from './friend.service';
import { SocialRateLimitGuard } from '../common/guards/social-rate-limit.guard';

class BlockUserDto { @IsUUID() userId: string; }

@Controller('blocks')
@UseGuards(AuthGuard('jwt'))
@UseGuards(SocialRateLimitGuard)
export class BlockController {
  constructor(private readonly friends: FriendService) {}

  @Get()
  getAll(@CurrentUser() user: UserPayload) { return this.friends.getBlockedUsers(user.id); }

  @Post()
  block(@CurrentUser() user: UserPayload, @Body() dto: BlockUserDto) { return this.friends.blockUser(user.id, dto.userId); }

  @Delete(':userId')
  unblock(@CurrentUser() user: UserPayload, @Param('userId') userId: string) { return this.friends.unblockUser(user.id, userId); }
}
