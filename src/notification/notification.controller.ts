import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { NotificationService } from './notification.service';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(AuthGuard('jwt'))
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  async getNotifications(
    @CurrentUser() user: UserPayload,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    return this.notificationService.getNotifications(
      user.id,
      unreadOnly === 'true',
    );
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: UserPayload) {
    return this.notificationService.getUnreadCount(user.id);
  }

  @Patch(':id/read')
  async markAsRead(
    @CurrentUser() user: UserPayload,
    @Param('id') notificationId: string,
  ) {
    return this.notificationService.markAsRead(user.id, notificationId);
  }

  @Patch('read-all')
  async markAllAsRead(@CurrentUser() user: UserPayload) {
    return this.notificationService.markAllAsRead(user.id);
  }

  @Delete(':id')
  async deleteNotification(
    @CurrentUser() user: UserPayload,
    @Param('id') notificationId: string,
  ) {
    return this.notificationService.deleteNotification(user.id, notificationId);
  }
}
