import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsUUID } from 'class-validator';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { FriendService } from './friend.service';
import { SocialRateLimitGuard } from '../common/guards/social-rate-limit.guard';
import { SocialRateLimit } from '../common/decorators/social-rate-limit.decorator';

class BlockUserDto { @IsUUID() userId: string; }

@Controller('blocks')
@UseGuards(AuthGuard('jwt'), SocialRateLimitGuard)
export class BlockController {
  constructor(private readonly friends: FriendService) {}

  @Get()
  @SocialRateLimit('read')
  getAll(@CurrentUser() user: UserPayload) { return this.friends.getBlockedUsers(user.id); }

  @Post()
  @SocialRateLimit('block_mutation')
  block(@CurrentUser() user: UserPayload, @Body() dto: BlockUserDto) { return this.friends.blockUser(user.id, dto.userId); }

  @Delete(':userId')
  @SocialRateLimit('block_mutation')
  unblock(@CurrentUser() user: UserPayload, @Param('userId', ParseUUIDPipe) userId: string) { return this.friends.unblockUser(user.id, userId); }
}
