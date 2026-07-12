import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { PresenceService } from './presence.service';

@Controller('presence')
@UseGuards(AuthGuard('jwt'))
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get('friends')
  getFriends(@CurrentUser() user: UserPayload) { return this.presence.getFriendsPresence(user.id); }
}
